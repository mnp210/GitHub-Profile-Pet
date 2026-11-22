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
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  executeActivityProcessing,
  performCompleteReconciliation,
  recoverActivityTransaction,
  type ActivityType,
  type ProcessActivityEventInput,
  type ProcessActivityResult,
  type ActivityLedgerDocument,
  type ActivityArchiveDocument,
} from '../src/features/pet-engine/activity/index.ts';
import type { PetStateDocument } from '../src/features/pet-engine/domain/types.ts';
import {
  writeStepSummary,
  formatActivitySummary,
  formatActivityFailureSummary,
  type ProcessedEventTelemetry,
  type ActivityReconciliationTelemetry,
} from '../src/features/pet-engine/reporting/index.ts';

export const ACTIVITY_PUBLICATION_MANIFEST_PATHS = [
  'pet/state/pet.json',
  'pet/ledger/contributions.json',
  'pet/ledger/actions.json',
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

async function runProcessingCycle(options: {
  baseDir: string;
  targetRef: string;
  dryRun: boolean;
  cliEvents: ProcessActivityEventInput[];
}): Promise<void> {
  const { baseDir, targetRef, dryRun, cliEvents } = options;

  // 1. Recover any unapplied transactions from interrupted executions
  if (!dryRun) {
    await recoverActivityTransaction(baseDir);
  }

  // 2. Load current ledger and state to read reconciliation checkpoints and baseline
  let initialLedger: ActivityLedgerDocument | null = null;
  let initialPet: PetStateDocument | null = null;
  try {
    const raw = await fs.readFile(path.join(baseDir, 'pet/ledger/activity.json'), 'utf-8');
    initialLedger = JSON.parse(raw);
  } catch {}
  try {
    const rawState = await fs.readFile(path.join(baseDir, 'pet/state/pet.json'), 'utf-8');
    initialPet = JSON.parse(rawState);
  } catch {}

  const stopAtSha = initialLedger?.checkpoints?.lastCommitSha;
  const stopAtIssueNumber = initialLedger?.checkpoints?.lastIssueNumber;
  const stopAtPrNumber = initialLedger?.checkpoints?.lastPrNumber;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const eventsToProcess: ProcessActivityEventInput[] = [...cliEvents];

  // 3. Complete Activity Reconciliation (Git Commits + GitHub API Issues/PRs/Reviews)
  let reconciliationCheckpoints: { lastCommitSha?: string; lastIssueNumber?: number; lastPrNumber?: number; reconciledAt: string } | undefined;
  let reconCompletedFully = true;
  let reconTelemetry: ActivityReconciliationTelemetry | undefined;
  try {
    const gitToken = process.env.GITHUB_TOKEN;
    const gitRepo = process.env.GITHUB_REPOSITORY;

    const recon = await performCompleteReconciliation({
      baseDir,
      targetRef,
      token: gitToken,
      repository: gitRepo,
      maxCommits: 5000,
      sinceIso: fourteenDaysAgo,
      stopAtSha,
      stopAtIssueNumber,
      stopAtPrNumber,
    });

    reconciliationCheckpoints = recon.checkpoints;
    reconCompletedFully = recon.completedFully;
    reconTelemetry = {
      commitsDiscovered: recon.discoveredEvents.filter((e) => e.eventType === 'commit').length,
      issuesDiscovered: recon.discoveredEvents.filter((e) => e.eventType === 'issue_opened').length,
      prsDiscovered: recon.discoveredEvents.filter((e) => e.eventType === 'pr_opened' || e.eventType === 'pr_merged').length,
      reviewsDiscovered: recon.discoveredEvents.filter((e) => e.eventType === 'review_submitted').length,
      lastCommitSha: recon.checkpoints?.lastCommitSha,
      lastIssueNumber: recon.checkpoints?.lastIssueNumber,
      lastPrNumber: recon.checkpoints?.lastPrNumber,
      completedFully: recon.completedFully,
      warnings: recon.warnings,
    };

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
    writeStepSummary(
      formatActivitySummary({
        eventName: process.env.GITHUB_EVENT_NAME || 'manual',
        targetRef,
        dryRun,
        eventsCount: 0,
        totalXpAwarded: 0,
        initialPetState: initialPet,
        updatedPetState: initialPet,
        processedEvents: [],
        reconciliation: reconTelemetry,
        publication: {
          status: 'NO_CHANGES_COMMITTED',
        },
        notes: 'No qualifying activity events found in execution context.',
      })
    );
    return;
  }

  console.log(`[START] Processing ${eventsToProcess.length} activity event(s)...`);

  let totalXpAwarded = 0;
  const processedResults: ProcessActivityResult[] = [];
  const processedTelemetry: ProcessedEventTelemetry[] = [];
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

      processedTelemetry.push({
        eventType: eventInput.eventType,
        eventId: eventInput.eventId,
        actor: eventInput.actor,
        xpAwarded: outcome.result.xpAwarded,
        status: outcome.result.status,
        details: outcome.result.reason || eventInput.details,
        ref: eventInput.ref,
      });

      console.log(
        ` - [${outcome.result.status.toUpperCase()}] ${eventInput.eventType} (${eventInput.eventId}): +${outcome.result.xpAwarded} XP (Level ${outcome.result.newLevel}, ${outcome.result.evolutionStage})`
      );
    } catch (err) {
      console.error(`[ERROR] Processing event ${eventInput.eventId} failed:`, (err as Error).message);
      processedTelemetry.push({
        eventType: eventInput.eventType,
        eventId: eventInput.eventId,
        actor: eventInput.actor,
        xpAwarded: 0,
        status: 'invalid',
        details: (err as Error).message,
        ref: eventInput.ref,
      });
    }
  }

  // Update checkpoints in ledger only if available AND reconciliation completed fully
  if (currentLedger && reconciliationCheckpoints && reconCompletedFully) {
    currentLedger.checkpoints = reconciliationCheckpoints;
    if (!dryRun) {
      await fs.writeFile(
        path.join(baseDir, 'pet/ledger/activity.json'),
        JSON.stringify(currentLedger, null, 2) + '\n',
        'utf-8'
      );
    }
  } else if (!reconCompletedFully) {
    console.log('[RECONCILIATION NOTICE] Checkpoints preserved without advancement due to incomplete reconciliation sweep.');
  }

  console.log(`[COMPLETE] Total Activity XP awarded: ${totalXpAwarded}`);

  // Publication state tracking
  let pubTelemetry: {
    status: 'COMMITTED_AND_PUSHED' | 'NO_CHANGES_COMMITTED' | 'DRY_RUN' | 'SKIPPED';
    commitSha?: string;
    modifiedFiles?: string[];
    destinationRef?: string;
  } = {
    status: 'NO_CHANGES_COMMITTED',
  };

  // If in Git workspace, publish changes
  if (totalXpAwarded > 0 && !dryRun) {
    // Harmonize generation across contributions and actions ledgers so atomic triplet stays synchronized
    if (currentPet?.generation) {
      try {
        const contribPath = path.join(baseDir, 'pet/ledger/contributions.json');
        const actionsPath = path.join(baseDir, 'pet/ledger/actions.json');
        const [contribRaw, actionsRaw] = await Promise.all([
          fs.readFile(contribPath, 'utf-8').catch(() => null),
          fs.readFile(actionsPath, 'utf-8').catch(() => null),
        ]);
        if (contribRaw) {
          const contribData = JSON.parse(contribRaw);
          contribData.generation = currentPet.generation;
          await fs.writeFile(contribPath, JSON.stringify(contribData, null, 2) + '\n', 'utf-8');
        }
        if (actionsRaw) {
          const actionsData = JSON.parse(actionsRaw);
          actionsData.generation = currentPet.generation;
          await fs.writeFile(actionsPath, JSON.stringify(actionsData, null, 2) + '\n', 'utf-8');
        }
      } catch (err) {
        console.log('[WARN] Failed to harmonize ledger generations:', (err as Error).message);
      }
    }

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

      const { stdout: headShaOut } = await execGit(['rev-parse', 'HEAD'], baseDir);
      const commitSha = headShaOut.trim();

      const gitToken = process.env.GITHUB_TOKEN;
      if (gitToken) {
        console.log(`[GIT] Pushing update to origin/${targetRef}...`);
        await execGit(['push', 'origin', `HEAD:${targetRef}`], baseDir);
        console.log('[GIT] Push successful.');
        pubTelemetry = {
          status: 'COMMITTED_AND_PUSHED',
          commitSha,
          modifiedFiles: modified,
          destinationRef: targetRef,
        };
      } else {
        console.log('[INFO] No GITHUB_TOKEN present; skipped push.');
        pubTelemetry = {
          status: 'SKIPPED',
          commitSha,
          modifiedFiles: modified,
          destinationRef: targetRef,
        };
      }
    }
  } else if (dryRun) {
    pubTelemetry = {
      status: 'DRY_RUN',
    };
  }

  // Write finalized Step Summary
  writeStepSummary(
    formatActivitySummary({
      eventName: process.env.GITHUB_EVENT_NAME || 'manual',
      targetRef,
      dryRun,
      eventsCount: eventsToProcess.length,
      totalXpAwarded,
      initialPetState: initialPet,
      updatedPetState: currentPet || initialPet,
      processedEvents: processedTelemetry,
      reconciliation: reconTelemetry,
      publication: pubTelemetry,
      notes: totalXpAwarded === 0
        ? 'Evaluated events resulted in zero XP (all filtered, duplicate, or capped).'
        : undefined,
    })
  );
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

  const cliEvents: ProcessActivityEventInput[] = [];

  // 1. Direct CLI Arguments
  if (cliEventType && cliEventId && cliActor) {
    cliEvents.push({
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
          cliEvents.push({
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
          cliEvents.push({
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
          cliEvents.push({
            eventType: 'pr_opened',
            eventId: `pr_opened:${prEvent.pull_request.number}`,
            actor: prEvent.pull_request.user.login,
            isBot: prEvent.pull_request.user.type === 'Bot',
            details: prEvent.pull_request.title,
          });
        } else if (prEvent.action === 'closed' && prEvent.pull_request.merged === true) {
          const actor = prEvent.pull_request.merged_by?.login || prEvent.pull_request.user.login;
          cliEvents.push({
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
          cliEvents.push({
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
      writeStepSummary(
        formatActivityFailureSummary({
          eventName: process.env.GITHUB_EVENT_NAME || 'manual',
          targetRef,
          stage: 'event_payload_parsing',
          error: err,
        })
      );
      process.exit(1);
    }
  }

  // Execute processing cycle with automatic reset-and-retry on push collision
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runProcessingCycle({ baseDir, targetRef, dryRun, cliEvents });
      break;
    } catch (err) {
      console.warn(`[WARN] Processing cycle attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}`);
      if (attempt === maxAttempts) {
        writeStepSummary(
          formatActivityFailureSummary({
            eventName: process.env.GITHUB_EVENT_NAME || 'manual',
            targetRef,
            stage: 'push_collision_retry_exhausted',
            error: err,
            eventsAttempted: cliEvents.length,
          })
        );
        if (process.env.GITHUB_ACTIONS) {
          process.exit(1);
        }
        throw err;
      }
      console.log(`[GIT] Resetting to latest origin/${targetRef} and re-evaluating...`);
      try {
        await recoverActivityTransaction(baseDir);
        await execGit(['fetch', 'origin', targetRef], baseDir);
        await execGit(['reset', '--hard', `origin/${targetRef}`], baseDir);
        await recoverActivityTransaction(baseDir);
      } catch (resetErr) {
        console.error('[GIT ERROR] Failed to fetch and reset to remote:', (resetErr as Error).message);
        throw err;
      }
    }
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  try {
    writeStepSummary(
      formatActivityFailureSummary({
        eventName: process.env.GITHUB_EVENT_NAME || 'manual',
        targetRef: process.env.GITHUB_REF_NAME || 'main',
        stage: 'unhandled_fatal_exception',
        error: err,
      })
    );
  } catch {}
  process.exit(1);
});
