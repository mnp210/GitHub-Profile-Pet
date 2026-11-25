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
import { fileURLToPath } from 'node:url';
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
  type ActivityPublicationTelemetry,
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

export function isPrContext(eventName?: string, targetRef?: string): boolean {
  if (eventName === 'pull_request' || eventName === 'pull_request_review') {
    return true;
  }
  if (targetRef) {
    const clean = targetRef.trim().toLowerCase();
    if (
      clean.startsWith('refs/pull/') ||
      clean.startsWith('pull/') ||
      clean.includes('/merge') ||
      clean.endsWith('/merge') ||
      /(^|\/)head$/.test(clean) ||
      /^[0-9]+(\/|$)/.test(clean)
    ) {
      return true;
    }
  }
  return false;
}

export function isPermittedPushRef(targetRef: string): boolean {
  if (!targetRef || targetRef.trim().length === 0) return false;
  const clean = targetRef.trim().replace(/^refs\/heads\//, '').toLowerCase();
  if (
    clean.startsWith('refs/pull/') ||
    clean.startsWith('pull/') ||
    clean.includes('/merge') ||
    clean.endsWith('/merge') ||
    /(^|\/)head$/.test(clean) ||
    /^[0-9]+(\/|$)/.test(clean)
  ) {
    return false;
  }
  return true;
}

async function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, { cwd });
}

export interface RunProcessingCycleOptions {
  baseDir: string;
  targetRef: string;
  dryRun: boolean;
  cliEvents: ProcessActivityEventInput[];
  eventName?: string;
  execGitFn?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
}

export async function runProcessingCycle(options: RunProcessingCycleOptions): Promise<void> {
  const { baseDir, targetRef, dryRun, cliEvents, eventName } = options;
  const execGitCmd = options.execGitFn || execGit;
  const prContext = isPrContext(eventName, targetRef);

  // Take snapshot backups of all publication manifest files in case cycle crashes or throws
  const manifestBackups = new Map<string, string>();
  for (const relPath of ACTIVITY_PUBLICATION_MANIFEST_PATHS) {
    const fullPath = path.join(baseDir, relPath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      manifestBackups.set(fullPath, content);
    } catch {}
  }

  try {
    // 1. Recover any unapplied transactions from interrupted executions (only on non-PR runs)
  if (!dryRun && !prContext) {
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
  const lastReconciledIso = initialLedger?.checkpoints?.reconciledAt;
  const activeHistoricalCursor = initialLedger?.checkpoints?.historicalRecoveryCursor;
  const historicalPrCompleted = initialLedger?.checkpoints?.historicalPrCompleted;
  const historicalPrContinuationPage = initialLedger?.checkpoints?.historicalPrContinuationPage;
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const ninetyDaysAgo = new Date(Date.now() - ninetyDaysMs).toISOString();

  let effectiveSinceIso = fourteenDaysAgo;
  let isCappedAtLookbackCeiling = false;
  let nextHistoricalRecoveryCursor: string | undefined = undefined;

  if (activeHistoricalCursor) {
    const cursorTime = new Date(activeHistoricalCursor).getTime();
    if (!Number.isNaN(cursorTime)) {
      // Historical recovery mode: process a bounded batch starting from cursorTime
      effectiveSinceIso = new Date(cursorTime).toISOString();
      const batchEndTarget = cursorTime + ninetyDaysMs;
      if (batchEndTarget >= Date.now() - ninetyDaysMs) {
        // This batch covers the remaining historical gap up to the recent window
        nextHistoricalRecoveryCursor = undefined;
      } else {
        // Advance cursor by 90 days for next run
        nextHistoricalRecoveryCursor = new Date(batchEndTarget).toISOString();
      }
    }
  } else if (lastReconciledIso) {
    const lastTime = new Date(lastReconciledIso).getTime();
    if (!Number.isNaN(lastTime)) {
      // Lookback includes 2-day overlap before last successful reconciliation
      const candidateSinceTime = lastTime - 2 * 24 * 60 * 60 * 1000;
      const candidateSince = new Date(candidateSinceTime).toISOString();
      if (candidateSinceTime < Date.now() - 14 * 24 * 60 * 60 * 1000) {
        if (candidateSinceTime < Date.now() - ninetyDaysMs) {
          // Outage lasted > 90 days: scan recent 90-day window now, and store cursor for older work
          effectiveSinceIso = ninetyDaysAgo;
          isCappedAtLookbackCeiling = true;
          nextHistoricalRecoveryCursor = candidateSince;
        } else {
          effectiveSinceIso = candidateSince;
        }
      }
    }
  }

  const eventsToProcess: ProcessActivityEventInput[] = [...cliEvents];

  // 3. Complete Activity Reconciliation (Git Commits + GitHub API Issues/PRs/Reviews)
  // Skip full reconciliation sweep in PR context to prevent sweeping repository history or advancing checkpoints
  let reconciliationCheckpoints: {
    lastCommitSha?: string;
    lastIssueNumber?: number;
    lastPrNumber?: number;
    reconciledAt: string;
    historicalRecoveryCursor?: string;
    historicalPrCompleted?: boolean;
    historicalPrContinuationPage?: number;
  } | undefined;
  let reconCompletedFully = true;
  let reconTelemetry: ActivityReconciliationTelemetry | undefined;

  if (!prContext) {
    try {
      const gitToken = process.env.GITHUB_TOKEN;
      const gitRepo = process.env.GITHUB_REPOSITORY;

      const recon = await performCompleteReconciliation({
        baseDir,
        targetRef,
        token: gitToken,
        repository: gitRepo,
        maxCommits: 5000,
        sinceIso: effectiveSinceIso,
        stopAtSha,
        stopAtIssueNumber,
        stopAtPrNumber,
        historicalRecoveryCursor: nextHistoricalRecoveryCursor,
        activeHistoricalCursor,
        historicalPrCompleted,
        historicalPrContinuationPage,
        processedPrOpenedNumbers: initialLedger?.processedRegistry?.prOpenedNumbers,
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

      if (isCappedAtLookbackCeiling && nextHistoricalRecoveryCursor) {
        const ceilingMsg = `Reconciliation lookback window reached 90-day ceiling. Outage began at ${lastReconciledIso}. Processed recent 90-day batch; historical recovery cursor saved to ${nextHistoricalRecoveryCursor} for resumption on subsequent cycles.`;
        recon.warnings.push(ceilingMsg);
      }

      if (activeHistoricalCursor) {
        if (!nextHistoricalRecoveryCursor) {
          console.log(`[RECONCILIATION NOTICE] Historical recovery batch complete. All historical periods reconciled.`);
        } else {
          console.log(`[RECONCILIATION NOTICE] Historical recovery batch complete. Advanced cursor to ${nextHistoricalRecoveryCursor}.`);
        }
      }

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
  } else {
    console.log(`[PR SAFETY] Full reconciliation sweep skipped in PR context (ref: ${targetRef}, event: ${eventName || 'pull_request'}).`);
  }

  if (eventsToProcess.length === 0) {
    if (!prContext && initialLedger && reconciliationCheckpoints && reconCompletedFully) {
      if (
        reconciliationCheckpoints.historicalRecoveryCursor !== undefined ||
        activeHistoricalCursor !== undefined ||
        isCappedAtLookbackCeiling
      ) {
        initialLedger.checkpoints = reconciliationCheckpoints;
        if (!dryRun) {
          await fs.writeFile(
            path.join(baseDir, 'pet/ledger/activity.json'),
            JSON.stringify(initialLedger, null, 2) + '\n',
            'utf-8'
          );
        }
      }
    }
    console.log('[NO-OP] No qualifying activity events found in execution context.');
    writeStepSummary(
      formatActivitySummary({
        eventName: eventName || process.env.GITHUB_EVENT_NAME || 'manual',
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
        notes: prContext
          ? 'PR activity event evaluated as non-qualifying (e.g. unmerged close or bot action).'
          : 'No qualifying activity events found in execution context.',
      })
    );
    return;
  }

  console.log(`[START] Processing ${eventsToProcess.length} activity event(s)...`);

  let totalXpAwarded = 0;
  const processedResults: ProcessActivityResult[] = [];
  const processedTelemetry: ProcessedEventTelemetry[] = [];
  let currentPet: PetStateDocument | undefined;
  let currentLedger: ActivityLedgerDocument | undefined = initialLedger ?? undefined;
  let currentArchive: ActivityArchiveDocument | undefined;

  // In PR context, force dryRun for individual event processing so working tree is never dirtied on the runner
  const effectiveDryRun = dryRun || prContext;

  for (const eventInput of eventsToProcess) {
    try {
      const outcome = await executeActivityProcessing({
        baseDir,
        event: eventInput,
        dryRun: effectiveDryRun,
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

  // Update checkpoints in ledger only if NOT in PR context
  if (!prContext && currentLedger && reconciliationCheckpoints) {
    if (reconCompletedFully) {
      currentLedger.checkpoints = reconciliationCheckpoints;
    } else {
      console.log('[RECONCILIATION NOTICE] Primary checkpoints preserved without advancement due to incomplete reconciliation sweep.');
      if (reconciliationCheckpoints.historicalPrContinuationPage !== undefined) {
        currentLedger.checkpoints = {
          ...currentLedger.checkpoints,
          reconciledAt: currentLedger.checkpoints?.reconciledAt ?? reconciliationCheckpoints.reconciledAt,
          historicalPrContinuationPage: reconciliationCheckpoints.historicalPrContinuationPage,
        };
      }
    }
    if (!dryRun) {
      await fs.writeFile(
        path.join(baseDir, 'pet/ledger/activity.json'),
        JSON.stringify(currentLedger, null, 2) + '\n',
        'utf-8'
      );
    }
  }

  console.log(`[COMPLETE] Total Activity XP calculated: ${totalXpAwarded}`);

  // Publication state tracking
  let pubTelemetry: ActivityPublicationTelemetry = {
    status: 'NO_CHANGES_COMMITTED',
  };

  if (prContext) {
    // PR Context Safety Guarantee: NEVER commit or push to remote!
    console.log(`[PR SAFETY] Event validated in PR context (${targetRef}). Direct push omitted.`);
    console.log(`[PR RECONCILIATION] Durable persistence safely deferred to default-branch reconciliation.`);
    pubTelemetry = {
      status: 'DEFERRED_TO_RECONCILIATION',
      destinationRef: targetRef,
      reason: 'PR context active. Direct push skipped to prevent creating unintended branches or mutating unmerged refs. Persistence deferred to default-branch sweep.',
    };
  } else if (totalXpAwarded > 0 && !dryRun) {
    if (!isPermittedPushRef(targetRef)) {
      console.warn(`[SAFETY] Target ref '${targetRef}' is not a permitted push ref. Skipping push.`);
      pubTelemetry = {
        status: 'SKIPPED',
        destinationRef: targetRef,
        reason: `Target ref '${targetRef}' is not permitted for remote publication.`,
      };
    } else {
      // Normal default branch push flow
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

      const { stdout: statusOut } = await execGitCmd(['status', '--porcelain'], baseDir);
      const modified = statusOut
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => l.substring(3).trim().replace(/\\/g, '/'))
        .filter((f) => ACTIVITY_PUBLICATION_MANIFEST_PATHS.includes(f as (typeof ACTIVITY_PUBLICATION_MANIFEST_PATHS)[number]));

      if (modified.length > 0) {
        console.log(`[GIT] Staging ${modified.length} manifest file(s): ${modified.join(', ')}`);
        await execGitCmd(['add', ...modified], baseDir);

        const commitMessage = `pet: record activity progression (+${totalXpAwarded} XP) [skip ci]`;
        await execGitCmd(['commit', '-m', commitMessage], baseDir);
        console.log(`[GIT] Committed: ${commitMessage}`);

        const { stdout: headShaOut } = await execGitCmd(['rev-parse', 'HEAD'], baseDir);
        const commitSha = headShaOut.trim();

        const gitToken = process.env.GITHUB_TOKEN;
        if (gitToken) {
          console.log(`[GIT] Pushing update to origin/${targetRef}...`);
          await execGitCmd(['push', 'origin', `HEAD:${targetRef}`], baseDir);
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
            reason: 'GITHUB_TOKEN not present in environment.',
          };
        }
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
      eventName: eventName || process.env.GITHUB_EVENT_NAME || 'manual',
      targetRef,
      dryRun,
      eventsCount: eventsToProcess.length,
      totalXpAwarded,
      initialPetState: initialPet,
      updatedPetState: currentPet || initialPet,
      processedEvents: processedTelemetry,
      reconciliation: reconTelemetry,
      publication: pubTelemetry,
      notes: prContext
        ? `Event verified in PR context. Eligible XP (+${totalXpAwarded} XP) will be durably persisted to the ledger during the next default-branch reconciliation sweep (next push or scheduled cron).`
        : totalXpAwarded === 0
          ? 'Evaluated events resulted in zero XP (all filtered, duplicate, or capped).'
          : undefined,
    })
  );
  } catch (err) {
    if (!dryRun && !prContext) {
      for (const [fullPath, content] of manifestBackups) {
        await fs.writeFile(fullPath, content, 'utf-8').catch(() => {});
      }
    }
    throw err;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const baseDir = process.cwd();

  const eventName = process.env.GITHUB_EVENT_NAME || '';
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

  const prContext = isPrContext(eventName, targetRef);
  if (prContext) {
    // Single-pass processing for PR events: no retries against remote branches
    await runProcessingCycle({ baseDir, targetRef, dryRun, cliEvents, eventName });
    return;
  }

  // Execute processing cycle with automatic reset-and-retry on push collision
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runProcessingCycle({ baseDir, targetRef, dryRun, cliEvents, eventName });
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
      if (!isPermittedPushRef(targetRef)) {
        console.error(`[GIT ERROR] Ref '${targetRef}' is not permitted for remote fetch/reset.`);
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

const isMainModule = Boolean(
  process.argv[1] &&
  fileURLToPath(import.meta.url).replace(/\\/g, '/').toLowerCase() ===
    path.resolve(process.argv[1]).replace(/\\/g, '/').toLowerCase()
);

if (isMainModule) {
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
}
