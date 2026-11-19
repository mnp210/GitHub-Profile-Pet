/**
 * GitHub Profile Pet - GitHub Activity Processor CLI & Action Entrypoint
 *
 * Automatically parses incoming GitHub Actions events (push, issues, pull_request,
 * pull_request_review) or CLI arguments, runs complete activity reconciliation across
 * Git commits and GitHub API, awards activity XP, updates pet state, renders the SVG badge,
 * updates the README menu, and commits via atomic fast-forward push.
 *
 * Usage:
 *   node --experimental-strip-types scripts/process-activity.ts [--ref main]
 *   node --experimental-strip-types scripts/process-activity.ts --event-type commit --event-id commit:abc123 --actor octocat
 */

import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  executeActivityProcessing,
  performCompleteReconciliation,
  type ActivityType,
  type ProcessActivityEventInput,
  type ProcessActivityResult,
  type ActivityLedgerDocument,
  type ActivityArchiveDocument,
} from '../src/features/pet-engine/activity/index.ts';
import type { PetStateDocument } from '../src/features/pet-engine/domain/types.ts';

export const ACTIVITY_PUBLICATION_MANIFEST_PATHS = [
  'pet/state/pet.json',
  'pet/ledger/activity.json',
  'pet/ledger/archive/activity_archive.json',
  'public/pet.svg',
  'README.md',
] as const;

const execFileAsync = promisify(execFile);

interface GitHubPushEvent {
  ref?: string;
  pusher?: { name?: string };
  commits?: Array<{
    id: string;
    message: string;
    author: { name: string; email?: string; username?: string };
    distinct?: boolean;
  }>;
}

interface GitHubIssueEvent {
  action: string;
  issue: {
    number: number;
    title: string;
    user: { login: string; type?: string };
    labels?: Array<{ name: string }>;
  };
}

interface GitHubPullRequestEvent {
  action: string;
  pull_request: {
    number: number;
    title: string;
    merged?: boolean;
    user: { login: string; type?: string };
    merged_by?: { login: string };
  };
}

interface GitHubReviewEvent {
  action: string;
  review: {
    id: number;
    state: string;
    user: { login: string; type?: string };
  };
  pull_request: {
    number: number;
  };
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

async function pushWithRetry(targetRef: string, baseDir: string, maxAttempts = 4): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[GIT] Pushing fast-forward update to origin/${targetRef} (attempt ${attempt}/${maxAttempts})...`);
      await execGit(['push', 'origin', `HEAD:${targetRef}`], baseDir);
      console.log('[GIT] Push successful.');
      return;
    } catch (err) {
      console.warn(`[GIT WARN] Push attempt ${attempt} failed: ${(err as Error).message}`);
      if (attempt === maxAttempts) {
        throw new Error(`Failed to push activity updates after ${maxAttempts} attempts: ${(err as Error).message}`);
      }
      console.log(`[GIT] Fetching and rebasing on latest origin/${targetRef}...`);
      try {
        await execGit(['fetch', 'origin', targetRef], baseDir);
        await execGit(['rebase', `origin/${targetRef}`], baseDir);
      } catch (rebaseErr) {
        await execGit(['rebase', '--abort'], baseDir).catch(() => {});
        throw new Error(`Rebase failed after rejected push: ${(rebaseErr as Error).message}`);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = process.cwd();

  let targetRef = process.env.GITHUB_REF_NAME || 'main';
  let cliEventType: ActivityType | undefined;
  let cliEventId: string | undefined;
  let cliActor: string | undefined;
  let cliDetails: string | undefined;
  let cliCommitMessage: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ref' && args[i + 1]) {
      targetRef = args[i + 1].trim().replace(/^refs\/heads\//, '');
      i++;
    } else if (args[i] === '--event-type' && args[i + 1]) {
      cliEventType = args[i + 1] as ActivityType;
      i++;
    } else if (args[i] === '--event-id' && args[i + 1]) {
      cliEventId = args[i + 1];
      i++;
    } else if (args[i] === '--actor' && args[i + 1]) {
      cliActor = args[i + 1];
      i++;
    } else if (args[i] === '--details' && args[i + 1]) {
      cliDetails = args[i + 1];
      i++;
    } else if (args[i] === '--commit-message' && args[i + 1]) {
      cliCommitMessage = args[i + 1];
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  const eventsToProcess: ProcessActivityEventInput[] = [];

  // 1. Direct CLI Arguments
  if (cliEventType && cliEventId && cliActor) {
    eventsToProcess.push({
      eventType: cliEventType,
      eventId: cliEventId,
      actor: cliActor,
      details: cliDetails,
      commitMessage: cliCommitMessage,
      ref: targetRef,
    });
  }
  // 2. GitHub Actions Context (GITHUB_EVENT_PATH & GITHUB_EVENT_NAME)
  else if (process.env.GITHUB_EVENT_PATH) {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const eventName = process.env.GITHUB_EVENT_NAME || '';

    try {
      const rawEvent = await fs.readFile(eventPath, 'utf-8');
      const eventJson = JSON.parse(rawEvent);

      if (eventName === 'push') {
        const pushEvent = eventJson as GitHubPushEvent;
        const commits = pushEvent.commits || [];

        for (const commit of commits) {
          if (commit.distinct === false) continue;

          const actor = commit.author.username || commit.author.name || pushEvent.pusher?.name || 'unknown';
          eventsToProcess.push({
            eventType: 'commit',
            eventId: `commit:${commit.id}`,
            actor,
            commitMessage: commit.message,
            details: commit.message.split('\n')[0].slice(0, 100),
            ref: pushEvent.ref || targetRef,
          });
        }
      } else if (eventName === 'issues') {
        const issueEvent = eventJson as GitHubIssueEvent;
        if (issueEvent.action === 'opened') {
          eventsToProcess.push({
            eventType: 'issue_opened',
            eventId: `issue:${issueEvent.issue.number}`,
            actor: issueEvent.issue.user.login,
            isBot: issueEvent.issue.user.type === 'Bot',
            issueLabels: issueEvent.issue.labels?.map((l) => l.name) || [],
            details: issueEvent.issue.title,
          });
        }
      } else if (eventName === 'pull_request') {
        const prEvent = eventJson as GitHubPullRequestEvent;
        if (prEvent.action === 'opened') {
          eventsToProcess.push({
            eventType: 'pr_opened',
            eventId: `pr_opened:${prEvent.pull_request.number}`,
            actor: prEvent.pull_request.user.login,
            isBot: prEvent.pull_request.user.type === 'Bot',
            details: prEvent.pull_request.title,
          });
        } else if (prEvent.action === 'closed' && prEvent.pull_request.merged === true) {
          const actor = prEvent.pull_request.merged_by?.login || prEvent.pull_request.user.login;
          eventsToProcess.push({
            eventType: 'pr_merged',
            eventId: `pr_merged:${prEvent.pull_request.number}`,
            actor,
            details: `Merged PR: ${prEvent.pull_request.title}`,
            prMerged: true,
          });
        }
      } else if (eventName === 'pull_request_review') {
        const reviewEvent = eventJson as GitHubReviewEvent;
        const state = (reviewEvent.review?.state || '').toLowerCase();
        if (reviewEvent.action === 'submitted' && (state === 'approved' || state === 'changes_requested')) {
          eventsToProcess.push({
            eventType: 'review_submitted',
            eventId: `review:${reviewEvent.review.id}`,
            actor: reviewEvent.review.user.login,
            isBot: reviewEvent.review.user.type === 'Bot',
            details: `Review (${state.toUpperCase()}) on PR #${reviewEvent.pull_request.number}`,
          });
        }
      }
    } catch (err) {
      console.error(`[ERROR] Failed to parse GitHub event payload from ${eventPath}:`, (err as Error).message);
      process.exit(1);
    }
  }

  // 3. Complete Activity Reconciliation (Git Commits + GitHub API Issues/PRs/Reviews)
  let reconciliationCheckpoints: { lastCommitSha?: string; lastIssueNumber?: number; lastPrNumber?: number; reconciledAt: string } | undefined;
  try {
    const gitToken = process.env.GITHUB_TOKEN;
    const gitRepo = process.env.GITHUB_REPOSITORY;

    const recon = await performCompleteReconciliation({
      baseDir,
      targetRef,
      token: gitToken,
      repository: gitRepo,
      maxCommits: 30,
    });

    reconciliationCheckpoints = recon.checkpoints;
    if (recon.warnings.length > 0) {
      for (const w of recon.warnings) {
        console.log(`[RECONCILIATION NOTICE] ${w}`);
      }
    }

    for (const discovered of recon.discoveredEvents) {
      const alreadyQueued = eventsToProcess.some(
        (e) => e.eventType === discovered.eventType && e.eventId.toLowerCase() === discovered.eventId.toLowerCase()
      );
      if (!alreadyQueued) {
        eventsToProcess.push(discovered);
      }
    }
  } catch (err) {
    console.log('[INFO] Reconciliation sweep skipped or encountered error:', (err as Error).message);
  }

  if (eventsToProcess.length === 0) {
    console.log('[NO-OP] No qualifying activity events found in execution context.');
    return;
  }

  console.log(`[START] Processing ${eventsToProcess.length} activity event(s)...`);

  let totalXpAwarded = 0;
  const processedResults: ProcessActivityResult[] = [];
  let currentPet: PetStateDocument | undefined;
  let currentLedger: ActivityLedgerDocument | undefined;
  let currentArchive: ActivityArchiveDocument | undefined;

  for (const eventInput of eventsToProcess) {
    try {
      const outcome = await executeActivityProcessing({
        baseDir,
        event: eventInput,
        dryRun,
        currentPetState: currentPet,
        currentActivityLedger: currentLedger,
        currentArchive,
      });

      currentPet = outcome.petState;
      currentLedger = outcome.activityLedger;
      currentArchive = outcome.activityArchive;
      processedResults.push(outcome.result);
      totalXpAwarded += outcome.result.xpAwarded;

      console.log(
        ` - [${outcome.result.status.toUpperCase()}] ${eventInput.eventType} (${eventInput.eventId}): +${outcome.result.xpAwarded} XP (Level ${outcome.result.newLevel}, ${outcome.result.evolutionStage})`
      );
    } catch (err) {
      console.error(`[ERROR] Processing event ${eventInput.eventId} failed:`, (err as Error).message);
    }
  }

  // Update checkpoints in ledger if available
  if (currentLedger && reconciliationCheckpoints) {
    currentLedger.checkpoints = reconciliationCheckpoints;
  }

  console.log(`[COMPLETE] Total Activity XP awarded: ${totalXpAwarded}`);

  // If in Git workspace, publish changes
  if (totalXpAwarded > 0 && !dryRun) {
    try {
      const { stdout: statusOut } = await execGit(['status', '--porcelain'], baseDir);
      const modified = statusOut
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.substring(3).trim().replace(/\\/g, '/'))
        .filter((f) => ACTIVITY_PUBLICATION_MANIFEST_PATHS.includes(f as (typeof ACTIVITY_PUBLICATION_MANIFEST_PATHS)[number]));

      if (modified.length > 0) {
        console.log(`[GIT] Staging ${modified.length} manifest file(s): ${modified.join(', ')}`);
        await execGit(['add', ...modified], baseDir);

        const commitMessage = `pet: record activity progression (+${totalXpAwarded} XP) [skip ci]`;
        await execGit(['commit', '-m', commitMessage], baseDir);
        console.log(`[GIT] Committed: ${commitMessage}`);

        const gitToken = process.env.GITHUB_TOKEN;
        if (gitToken) {
          await pushWithRetry(targetRef, baseDir, 4);
        } else {
          console.log('[INFO] No GITHUB_TOKEN present; skipped push.');
        }
      }
    } catch (err) {
      console.error('[GIT ERROR] Failed to commit/push activity changes:', (err as Error).message);
      if (process.env.GITHUB_ACTIONS) {
        process.exit(1);
      }
    }
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
