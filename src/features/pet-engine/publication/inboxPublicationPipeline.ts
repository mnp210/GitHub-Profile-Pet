/**
 * GitHub Profile Pet — Safe Inbox Publication Pipeline (Phase 3C2.3-B0)
 *
 * Implements the atomic, fast-forward-only Git publication protocol for Path A (Issue Care Actions)
 * with strict generation fencing and recoverable two-phase side-effect delivery:
 *
 * Phase 1 (Atomic & Fenced):
 * 1. Preflight F-01: Verifies 100% clean working tree before execution.
 * 2. Preflight F-02: Verifies checked-out branch against destination ref (rejects detached HEAD).
 * 3. Preflight F-03: Verifies required authoritative runtime documents exist and are readable.
 * 4. Captures source checkout commit SHA (S_0) and state generation (G_0).
 * 5. In-memory action execution with deferFeedback=true:
 *    - Applies care transitions to pet vitals and records high-water marks.
 *    - Records durable ActionFeedbackRecord in actions.json BEFORE external feedback occurs.
 * 6. Atomic lockstep save to generation G_0 + 1 and visual badge rendering.
 * 7. Stage 1 Pre-push Remote Generation Fence:
 *    - Verifies remote branch still matches S_0.
 *    - If remote moved, discards local state, fetches latest remote, and re-evaluates actions fresh.
 * 8. Stages only the 5-file allowlisted manifest; verifies staged paths.
 * 9. Commits changes with standard bot author identity and [skip ci].
 * 10. Fast-forward-only push: git push origin HEAD:main (Strictly NO --force, NO git rebase).
 *     On rejection, rolls back to source commit and safely retries against fresh remote state.
 *
 * Phase 2 (Recoverable Side Effects):
 * 11. Executes post-publication feedback delivery (deliverPendingFeedback):
 *     - Inspects issue comments for deterministic bot marker.
 *     - Posts comment only if marker is absent.
 *     - Closes issue with explicit outcome label.
 *     - If network/API fails, state remains safely published in Git; retried on subsequent sweep.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  processInbox,
  deliverPendingFeedback,
  type GitHubInboxClient,
  type InboxProcessResult,
  type DeliverPendingFeedbackResult,
  DefaultGitHubInboxClient,
} from '../inbox/index.ts';
import { redactSensitiveData, resolveOwnerIdentity } from '../contribution/index.ts';
import {
  PUBLICATION_MANIFEST_PATHS,
  verifyRequiredAuthoritativeFiles,
  verifyStagedManifest,
  type PublicationManifestPath,
  type PublicationPipelineStatus,
} from './publishPipeline.ts';

const execFileAsync = promisify(execFile);

export interface InboxPublicationOptions {
  baseDir?: string;
  refName?: string;
  gitRemote?: string;
  sourceCommitSha?: string;
  token?: string;
  env?: Record<string, string | undefined>;
  nowMs?: number;
  maxCommentPages?: number;
  deadlineMs?: number;
  dryRun?: boolean;
  skipPush?: boolean;
  client?: GitHubInboxClient;
  maxRetries?: number;
  maxIssuesPerBatch?: number;
  botLogin?: string;
  allowAnyAuthor?: boolean;
  trustedAuthorId?: number;
  remoteFenceCheck?: (sourceCommitSha: string) => Promise<{ matches: boolean; currentRemoteSha: string }>;
  gitExecutor?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  skipCleanPreflight?: boolean;
  skipBranchCheck?: boolean;
  skipAuthoritativeFileCheck?: boolean;
}

export interface InboxPublicationResult {
  success: boolean;
  status: PublicationPipelineStatus;
  commitSha?: string;
  stagedFiles?: string[];
  destinationRef?: string;
  sourceCommitSha?: string;
  details: string;
  error?: Error;
  inboxResult?: InboxProcessResult;
  attemptsMade: number;
}

/**
 * Executes the safe publication pipeline for Path A.
 */
export async function executeInboxPublicationPipeline(
  options: InboxPublicationOptions = {}
): Promise<InboxPublicationResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const env = options.env ?? process.env;
  const rawRefName = options.refName ?? env.GITHUB_REF_NAME ?? 'main';
  const targetBranch = rawRefName.trim().replace(/^refs\/heads\//, '');
  const gitRemote = options.gitRemote ?? 'origin';
  const dryRun = options.dryRun === true;
  const skipPush = options.skipPush === true;
  const token = (options.token ?? env.GITHUB_TOKEN)?.trim();
  const repository = env.GITHUB_REPOSITORY ?? 'owner/github-profile-pet';
  const maxRetries = Math.max(1, options.maxRetries ?? 3);
  const client = options.client ?? new DefaultGitHubInboxClient(token || '');

  let trustedAuthorId = options.trustedAuthorId;
  if (trustedAuthorId === undefined && options.allowAnyAuthor !== true) {
    try {
      const identity = resolveOwnerIdentity({ baseDir, env, allowLedgerFallback: true });
      if (typeof identity.databaseId === 'number' && Number.isInteger(identity.databaseId) && identity.databaseId > 0) {
        trustedAuthorId = identity.databaseId;
      }
    } catch {
      // Best-effort resolution: if identity is unresolvable, trustedAuthorId remains undefined and processInbox fails closed
    }
  }

  const gitEnv: Record<string, string | undefined> = {
    ...process.env,
    ...(options.env ?? {}),
    GIT_AUTHOR_NAME: options.env?.GIT_AUTHOR_NAME ?? process.env.GIT_AUTHOR_NAME ?? 'github-actions[bot]',
    GIT_AUTHOR_EMAIL:
      options.env?.GIT_AUTHOR_EMAIL ??
      process.env.GIT_AUTHOR_EMAIL ??
      '41898282+github-actions[bot]@users.noreply.github.com',
    GIT_COMMITTER_NAME:
      options.env?.GIT_COMMITTER_NAME ?? process.env.GIT_COMMITTER_NAME ?? 'github-actions[bot]',
    GIT_COMMITTER_EMAIL:
      options.env?.GIT_COMMITTER_EMAIL ??
      process.env.GIT_COMMITTER_EMAIL ??
      '41898282+github-actions[bot]@users.noreply.github.com',
  };

  const execGit = async (args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (options.gitExecutor) {
      return options.gitExecutor('git', args, baseDir);
    }
    try {
      return await execFileAsync('git', args, { cwd: baseDir, env: gitEnv as NodeJS.ProcessEnv });
    } catch (err: unknown) {
      const error = err as Error & { stderr?: string; stdout?: string };
      const rawMsg = `${error.message} ${error.stderr ?? ''}`;
      const sanitized = token ? redactSensitiveData(rawMsg, token) : rawMsg;
      const wrapped = new Error(sanitized);
      (wrapped as unknown as { stderr?: string }).stderr = error.stderr;
      (wrapped as unknown as { stdout?: string }).stdout = error.stdout;
      throw wrapped;
    }
  };

  // 1. Capture and Verify Initial Source Commit SHA (S_0)
  let initialSourceSha = options.sourceCommitSha;
  try {
    const { stdout } = await execGit(['rev-parse', 'HEAD']);
    const currentHead = stdout.trim();
    if (!initialSourceSha) {
      initialSourceSha = currentHead;
    } else if (initialSourceSha.trim().toLowerCase() !== currentHead.toLowerCase()) {
      return {
        success: false,
        status: 'error',
        sourceCommitSha: initialSourceSha,
        details: `Source commit SHA mismatch: provided "${initialSourceSha}" does not match repository HEAD "${currentHead}".`,
        error: new Error('Provided sourceCommitSha does not match HEAD'),
        attemptsMade: 0,
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      details: `Failed to determine checkout HEAD commit SHA: ${(err as Error).message}`,
      error: err as Error,
      attemptsMade: 0,
    };
  }

  // 2. Preflight Check: Clean Working Tree (F-01)
  if (!options.skipCleanPreflight) {
    let preflightStatus = '';
    let rawStatusOut = '';
    try {
      const { stdout: statusOut } = await execGit(['status', '--porcelain', '--untracked-files=all']);
      rawStatusOut = statusOut;
      preflightStatus = statusOut.trim();
    } catch (err: unknown) {
      return {
        success: false,
        status: 'error',
        sourceCommitSha: initialSourceSha,
        details: `Failed to inspect working tree preflight status: ${(err as Error).message}`,
        error: err as Error,
        attemptsMade: 0,
      };
    }

    if (preflightStatus.length > 0) {
      const dirtyEntries = rawStatusOut
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => (l.length >= 4 ? l.substring(3).trim() : l.trim()));
      return {
        success: false,
        status: 'dirty_working_tree',
        sourceCommitSha: initialSourceSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-01): Dirty working tree detected with ${dirtyEntries.length} uncommitted or untracked changes: ${dirtyEntries.slice(0, 5).join('; ')}. Clean working tree is required before publication.`,
        error: new Error(`Dirty working tree detected: ${dirtyEntries.slice(0, 5).join('; ')}`),
        attemptsMade: 0,
      };
    }
  }

  // 3. Preflight Check: Branch and Destination Verification (F-02)
  if (!targetBranch) {
    return {
      success: false,
      status: 'branch_mismatch',
      sourceCommitSha: initialSourceSha,
      details: 'Preflight Check Failed (F-02): Invalid or empty destination branch ref.',
      error: new Error('Invalid or empty destination branch ref.'),
      attemptsMade: 0,
    };
  }

  if (!options.skipBranchCheck) {
    let currentBranch = '';
    try {
      const { stdout: branchOut } = await execGit(['branch', '--show-current']);
      currentBranch = branchOut.trim();
    } catch (err: unknown) {
      return {
        success: false,
        status: 'error',
        sourceCommitSha: initialSourceSha,
        details: `Failed to determine current git branch: ${(err as Error).message}`,
        error: err as Error,
        attemptsMade: 0,
      };
    }

    if (!currentBranch || currentBranch === 'HEAD') {
      return {
        success: false,
        status: 'branch_mismatch',
        sourceCommitSha: initialSourceSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-02): Repository is in detached HEAD state. Publication requires an attached named branch matching "${targetBranch}".`,
        error: new Error('Detached HEAD state detected during publication preflight.'),
        attemptsMade: 0,
      };
    }

    if (currentBranch !== targetBranch) {
      return {
        success: false,
        status: 'branch_mismatch',
        sourceCommitSha: initialSourceSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-02): Checked-out branch "${currentBranch}" does not match target destination branch "${targetBranch}". Aborting to prevent cross-branch contamination.`,
        error: new Error(`Branch mismatch: "${currentBranch}" !== "${targetBranch}"`),
        attemptsMade: 0,
      };
    }
  }

  // 4. Preflight Check: Required Authoritative Runtime Documents (F-03)
  if (!options.skipAuthoritativeFileCheck) {
    const fileCheck = await verifyRequiredAuthoritativeFiles(baseDir);
    if (!fileCheck.valid) {
      return {
        success: false,
        status: 'missing_authoritative_file',
        sourceCommitSha: initialSourceSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-03): ${fileCheck.message}`,
        error: new Error(fileCheck.message),
        attemptsMade: 0,
      };
    }
  }

function isNonFastForwardError(errorMsg: string): boolean {
  return (
    errorMsg.includes('non-fast-forward') ||
    errorMsg.includes('fetch first') ||
    errorMsg.includes('failed to push some refs') ||
    errorMsg.includes('Updates were rejected') ||
    errorMsg.includes('[rejected]')
  );
}

async function checkRemoteFence(
  execGit: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  gitRemote: string,
  targetBranch: string,
  expectedSourceSha: string,
  remoteFenceCheck?: (sourceSha: string) => Promise<{ matches: boolean; currentRemoteSha: string }>
): Promise<{ matches: boolean; currentRemoteSha: string }> {
  if (remoteFenceCheck) {
    return remoteFenceCheck(expectedSourceSha);
  }
  try {
    const { stdout } = await execGit(['ls-remote', gitRemote, `refs/heads/${targetBranch}`]);
    const trimmed = stdout.trim();
    const currentRemoteSha = trimmed.split(/\s+/)[0] || '';
    const matches = currentRemoteSha.toLowerCase() === expectedSourceSha.toLowerCase();
    return { matches, currentRemoteSha };
  } catch (err: unknown) {
    return { matches: false, currentRemoteSha: `ERROR: ${(err as Error).message}` };
  }
}

async function stageAndCommitManifest(
  execGit: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  commitMessage: string
): Promise<{
  success: boolean;
  status?: PublicationPipelineStatus;
  details?: string;
  commitSha?: string;
  stagedFiles?: string[];
  error?: Error;
}> {
  let statusOut = '';
  try {
    const res = await execGit(['status', '--porcelain']);
    statusOut = res.stdout;
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      details: `Failed to query git status: ${(err as Error).message}`,
      error: err as Error,
    };
  }

  const porcelainLines = statusOut.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const modifiedManifestPaths: string[] = [];

  for (const line of porcelainLines) {
    if (line.length < 4) continue;
    const filePath = line.substring(3).trim().replace(/\\/g, '/');
    if (PUBLICATION_MANIFEST_PATHS.includes(filePath as PublicationManifestPath)) {
      modifiedManifestPaths.push(filePath);
    }
  }

  if (modifiedManifestPaths.length === 0) {
    return {
      success: true,
      status: 'noop',
      details: 'No manifest files modified after processing. Clean no-op; skipping commit and push.',
      stagedFiles: [],
    };
  }

  try {
    await execGit(['add', ...modifiedManifestPaths]);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      details: `Failed to stage manifest files: ${(err as Error).message}`,
      error: err as Error,
    };
  }

  let stagedPaths: string[] = [];
  try {
    const res = await execGit(['diff', '--name-only', '--cached']);
    stagedPaths = res.stdout.trim().split(/\r?\n/).map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      details: `Failed to query staged git diff: ${(err as Error).message}`,
      error: err as Error,
    };
  }

  const manifestCheck = verifyStagedManifest(stagedPaths, modifiedManifestPaths);
  if (!manifestCheck.valid) {
    await execGit(['reset', 'HEAD']).catch(() => {});
    return {
      success: false,
      status: 'manifest_violation',
      details: manifestCheck.message!,
      stagedFiles: stagedPaths,
      error: new Error(manifestCheck.message),
    };
  }

  let commitSha = '';
  try {
    await execGit(['commit', '-m', commitMessage]);
    const headRes = await execGit(['rev-parse', 'HEAD']);
    commitSha = headRes.stdout.trim();
  } catch (err: unknown) {
    await execGit(['reset', 'HEAD']).catch(() => {});
    return {
      success: false,
      status: 'error',
      details: `Git commit failed: ${(err as Error).message}`,
      error: err as Error,
    };
  }

  return {
    success: true,
    commitSha,
    stagedFiles: stagedPaths,
  };
}

  // 5. Bounded State Ingestion & Publication Retry Loop
  let attemptsMade = 0;
  let currentSourceSha = initialSourceSha;
  let lastInboxResult: InboxProcessResult | undefined;

  while (attemptsMade < maxRetries) {
    attemptsMade++;

    // A. Capture current HEAD commit SHA
    try {
      const { stdout } = await execGit(['rev-parse', 'HEAD']);
      currentSourceSha = stdout.trim();
    } catch {
      // Keep existing currentSourceSha
    }

    // B. Process Inbox in Memory with Defer Feedback
    let inboxResult: InboxProcessResult;
    try {
      inboxResult = await processInbox({
        baseDir,
        repository,
        client,
        deferFeedback: true,
        botLogin: options.botLogin,
        allowAnyAuthor: options.allowAnyAuthor,
        trustedAuthorId,
        maxIssuesPerBatch: options.maxIssuesPerBatch,
        nowMs: options.nowMs,
      });
      lastInboxResult = inboxResult;
    } catch (err: unknown) {
      return {
        success: false,
        status: 'error',
        sourceCommitSha: currentSourceSha,
        destinationRef: targetBranch,
        details: `Inbox processing execution failed: ${(err as Error).message}`,
        error: err as Error,
        attemptsMade,
      };
    }

    let careActionsPublished = false;
    let careActionCommitSha: string | undefined;
    let careActionStagedFiles: string[] | undefined;

    // C. Phase 1: Publish Care Action State (if any care action was processed)
    if (inboxResult.savedGeneration !== undefined) {
      // Stage 1 Remote Fence Check
      const fence = await checkRemoteFence(execGit, gitRemote, targetBranch, currentSourceSha, options.remoteFenceCheck);
      if (!fence.matches) {
        // Remote moved! Discard unpublished state immediately without leaking side effects
        await execGit(['checkout', '--', ...PUBLICATION_MANIFEST_PATHS]).catch(() => {});
        await execGit(['reset', '--hard', currentSourceSha]).catch(() => {});

        if (attemptsMade < maxRetries) {
          try {
            await execGit(['fetch', gitRemote, targetBranch]);
            await execGit(['reset', '--hard', `${gitRemote}/${targetBranch}`]);
            continue;
          } catch {
            // Fall through to stage_1_fence_conflict
          }
        }

        return {
          success: false,
          status: 'stage_1_fence_conflict',
          sourceCommitSha: currentSourceSha,
          destinationRef: targetBranch,
          details: `Remote branch advanced before publication (Remote: ${fence.currentRemoteSha}, Source: ${currentSourceSha}). Stale action state safely aborted without blind rebase.`,
          inboxResult,
          attemptsMade,
        };
      }

      // Stage and commit care action changes
      const commitRes = await stageAndCommitManifest(execGit, 'pet: process care actions [skip ci]');
      if (!commitRes.success) {
        return {
          success: false,
          status: commitRes.status ?? 'error',
          sourceCommitSha: currentSourceSha,
          destinationRef: targetBranch,
          stagedFiles: commitRes.stagedFiles,
          details: commitRes.details ?? 'Failed to stage and commit care action changes',
          error: commitRes.error,
          inboxResult,
          attemptsMade,
        };
      }

      if (commitRes.status !== 'noop') {
        careActionCommitSha = commitRes.commitSha;
        careActionStagedFiles = commitRes.stagedFiles;

        if (dryRun || skipPush) {
          return {
            success: true,
            status: 'committed_dry_run',
            sourceCommitSha: currentSourceSha,
            commitSha: careActionCommitSha,
            stagedFiles: careActionStagedFiles,
            destinationRef: targetBranch,
            details: `Dry run / push skipped: Committed ${careActionStagedFiles?.length ?? 0} files as ${careActionCommitSha}. Push skipped.`,
            inboxResult,
            attemptsMade,
          };
        }

        // Fast-forward push
        try {
          await execGit(['push', gitRemote, `HEAD:${targetBranch}`]);
          careActionsPublished = true;
          currentSourceSha = careActionCommitSha!;
        } catch (err: unknown) {
          const errorMsg = (err as Error).message;
          const isNonFastForward = isNonFastForwardError(errorMsg);

          await execGit(['reset', '--hard', currentSourceSha]).catch(() => {});

          if (isNonFastForward && attemptsMade < maxRetries) {
            try {
              await execGit(['fetch', gitRemote, targetBranch]);
              await execGit(['reset', '--hard', `${gitRemote}/${targetBranch}`]);
              continue;
            } catch {
              // Fall through to push_rejected
            }
          }

          const conflictMessage = isNonFastForward
            ? `Publication Conflict: Git server rejected non-fast-forward push to "${targetBranch}". Remote branch advanced after local checkout. Stale state aborted without rebase or force-push.`
            : `Push Failure: Failed to push commit ${careActionCommitSha} to ${gitRemote} HEAD:${targetBranch}: ${errorMsg}`;

          return {
            success: false,
            status: 'push_rejected',
            sourceCommitSha: currentSourceSha,
            stagedFiles: careActionStagedFiles,
            destinationRef: targetBranch,
            details: conflictMessage,
            error: new Error(conflictMessage),
            inboxResult,
            attemptsMade,
          };
        }
      }
    }

    // D. Phase 2: Post-Publication Recoverable Feedback Delivery & Bounded Compaction
    let feedbackDeliveryRes: DeliverPendingFeedbackResult = {
      deliveredCount: 0,
      failedCount: 0,
      prunedCount: 0,
      stateModified: false,
      results: [],
    };

    try {
      feedbackDeliveryRes = await deliverPendingFeedback({
        baseDir,
        repository,
        client,
        botLogin: options.botLogin,
        nowMs: options.nowMs,
        maxCommentPages: options.maxCommentPages,
        deadlineMs: options.deadlineMs,
        persist: true,
        autoCompact: true,
      });
    } catch {
      // Feedback delivery errors in Phase 2 are non-fatal
    }

    // E. Phase 2b: Publish Feedback Completion State to Git (F-B0-01)
    let completionCommitSha: string | undefined;
    let completionStagedFiles: string[] | undefined;

    if (feedbackDeliveryRes.stateModified && !dryRun && !skipPush) {
      const completionFence = await checkRemoteFence(
        execGit,
        gitRemote,
        targetBranch,
        currentSourceSha,
        options.remoteFenceCheck
      );

      if (completionFence.matches) {
        const completionCommit = await stageAndCommitManifest(
          execGit,
          'pet: record feedback delivery completion [skip ci]'
        );

        if (
          completionCommit.success &&
          completionCommit.commitSha &&
          completionCommit.stagedFiles &&
          completionCommit.stagedFiles.length > 0
        ) {
          try {
            await execGit(['push', gitRemote, `HEAD:${targetBranch}`]);
            completionCommitSha = completionCommit.commitSha;
            completionStagedFiles = completionCommit.stagedFiles;
            currentSourceSha = completionCommitSha;
          } catch (err: unknown) {
            // Push failed (e.g. concurrent push or network issue)
            await execGit(['reset', '--hard', currentSourceSha]).catch(() => {});

            if (!careActionsPublished) {
              const errorMsg = (err as Error).message;
              const isNonFastForward = isNonFastForwardError(errorMsg);
              if (isNonFastForward && attemptsMade < maxRetries) {
                try {
                  await execGit(['fetch', gitRemote, targetBranch]);
                  await execGit(['reset', '--hard', `${gitRemote}/${targetBranch}`]);
                  continue;
                } catch {
                  // Fall through
                }
              }
            }
          }
        }
      } else {
        // Remote advanced before completion push. Roll back completion modifications to currentSourceSha
        await execGit(['checkout', '--', ...PUBLICATION_MANIFEST_PATHS]).catch(() => {});
        await execGit(['reset', '--hard', currentSourceSha]).catch(() => {});

        if (!careActionsPublished && attemptsMade < maxRetries) {
          try {
            await execGit(['fetch', gitRemote, targetBranch]);
            await execGit(['reset', '--hard', `${gitRemote}/${targetBranch}`]);
            continue;
          } catch {
            // Fall through
          }
        }
      }
    }

    // F. Final Outcome Resolution
    if (careActionsPublished || (feedbackDeliveryRes.stateModified && completionCommitSha)) {
      const finalCommitSha = currentSourceSha;
      const finalStagedFiles = completionStagedFiles ?? careActionStagedFiles ?? [];
      return {
        success: true,
        status: 'published',
        sourceCommitSha: initialSourceSha,
        commitSha: finalCommitSha,
        stagedFiles: finalStagedFiles,
        destinationRef: targetBranch,
        details: `Successfully published inbox state transitions to ${gitRemote}/${targetBranch} (${finalCommitSha}).`,
        inboxResult,
        attemptsMade,
      };
    }

    if (inboxResult.savedGeneration === undefined && !feedbackDeliveryRes.stateModified) {
      return {
        success: true,
        status: 'noop',
        sourceCommitSha: currentSourceSha,
        destinationRef: targetBranch,
        details: 'No care action changes or pending feedback detected. Clean no-op; skipping commit and push.',
        inboxResult,
        attemptsMade,
      };
    }

    if (careActionCommitSha) {
      return {
        success: true,
        status: 'published',
        sourceCommitSha: initialSourceSha,
        commitSha: careActionCommitSha,
        stagedFiles: careActionStagedFiles,
        destinationRef: targetBranch,
        details: `Successfully published care action artifacts to ${gitRemote}/${targetBranch} (${careActionCommitSha}).`,
        inboxResult,
        attemptsMade,
      };
    }
  }

  return {
    success: false,
    status: 'push_rejected',
    sourceCommitSha: currentSourceSha,
    destinationRef: targetBranch,
    details: `Unable to publish after ${maxRetries} retry attempts due to continuous remote concurrency movement.`,
    error: new Error(`Push rejected: concurrency retries exhausted (${maxRetries})`),
    attemptsMade,
    inboxResult: lastInboxResult,
  };
}

export const runInboxPublicationPipeline = executeInboxPublicationPipeline;
