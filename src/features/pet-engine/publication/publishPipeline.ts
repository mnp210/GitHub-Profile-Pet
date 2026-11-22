/**
 * GitHub Profile Pet — Safe Git Publication Pipeline (Phase 3C2.2.4 & 3C2.2.4-R2)
 *
 * Implements the atomic, fast-forward-only Git publication protocol with safety hardening:
 * 1. Captures source checkout commit SHA (S_0).
 * 2. Preflight F-01: Verifies 100% clean working tree (git status --porcelain --untracked-files=all).
 *    Fails closed if any tracked or untracked changes exist prior to execution.
 * 3. Preflight F-02: Verifies checked-out branch against publication destination ref.
 *    Rejects detached HEAD and branch mismatches before any state mutation.
 * 4. Preflight F-03: Verifies required authoritative runtime documents exist and are readable
 *    (pet/state/pet.json, pet/ledger/contributions.json, pet/ledger/actions.json, public/pet.svg).
 * 5. Executes ContributionSyncService (unlocked fetch, mutex lock, deterministic accounting,
 *    passive simulation, atomic journal save, lock-held SVG rendering, and Stage 1 remote fence).
 * 6. Enforces Stage 1 fence: if remote advanced, aborts cleanly without staging or pushing.
 * 7. Checks clean no-op: if no files in publication manifest changed, exits cleanly (exit 0, no commit).
 * 8. Explicitly stages only the exact 5-file manifest (pet/state/pet.json, pet/ledger/contributions.json,
 *    pet/ledger/actions.json, public/pet.svg, README.md). Never runs `git add -A` or `git add .`.
 * 9. Verifies staged path list against manifest. Aborts if unexpected file staged or expected file missing.
 * 10. Commits changes with standard bot author identity and `[skip ci]`.
 * 11. Stage 2: Executes atomic fast-forward-only push: `git push origin HEAD:${targetBranch}`.
 *     Strictly NO `--force`, NO `--force-with-lease`, NO `+HEAD`, NO `git rebase`!
 * 12. Detects non-fast-forward push rejection: logs explicit publication-conflict error,
 *     rolls back local commit to S_0 (proven clean by Preflight F-01), skips success reporting,
 *     and terminates with non-zero exit code.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  syncContributions,
  checkRemoteGenerationFence,
  type ContributionSyncResult,
  type SyncExecutionMode,
  MissingBaselineError,
  BaselineAlreadyEstablishedError,
} from '../sync/index.ts';
import type { GitHubContributionProvider } from '../contribution/index.ts';
import { redactSensitiveData, resolveOwnerIdentity } from '../contribution/index.ts';
import { isPristineContributionLedger } from '../validation/ledgerValidator.ts';
import type { ContributionLedgerDocument } from '../domain/types.ts';

export {
  type SyncExecutionMode,
  MissingBaselineError,
  BaselineAlreadyEstablishedError,
};

const execFileAsync = promisify(execFile);

export const PUBLICATION_MANIFEST_PATHS = [
  'pet/state/pet.json',
  'pet/ledger/contributions.json',
  'pet/ledger/actions.json',
  'public/pet.svg',
  'README.md',
] as const;

export type PublicationManifestPath = (typeof PUBLICATION_MANIFEST_PATHS)[number];

export const REQUIRED_AUTHORITATIVE_PATHS = [
  'pet/state/pet.json',
  'pet/ledger/contributions.json',
  'pet/ledger/actions.json',
  'public/pet.svg',
] as const;

export type RequiredAuthoritativePath = (typeof REQUIRED_AUTHORITATIVE_PATHS)[number];

export type PublicationPipelineStatus =
  | 'published'
  | 'noop'
  | 'committed_dry_run'
  | 'stage_1_fence_conflict'
  | 'push_rejected'
  | 'manifest_violation'
  | 'dirty_working_tree'
  | 'branch_mismatch'
  | 'missing_authoritative_file'
  | 'integrity_failed'
  | 'provider_failed'
  | 'baseline_missing'
  | 'baseline_refused'
  | 'error';

export interface PublicationPipelineOptions {
  baseDir?: string;
  refName?: string;
  gitRemote?: string;
  sourceCommitSha?: string;
  token?: string;
  env?: Record<string, string | undefined>;
  nowMs?: number;
  dryRun?: boolean;
  skipPush?: boolean;
  provider?: GitHubContributionProvider;
  expectedModifiedPaths?: string[];
  remoteFenceCheck?: (sourceCommitSha: string) => Promise<{ matches: boolean; currentRemoteSha: string }>;
  gitExecutor?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  skipCleanPreflight?: boolean;
  skipBranchCheck?: boolean;
  skipAuthoritativeFileCheck?: boolean;
  mode?: SyncExecutionMode;
  expectedOwnerDatabaseId?: number;
  targetOwnerLogin?: string;
}

export interface PublicationPipelineResult {
  success: boolean;
  status: PublicationPipelineStatus;
  commitSha?: string;
  stagedFiles?: string[];
  destinationRef?: string;
  sourceCommitSha?: string;
  details: string;
  error?: Error;
  syncResult?: ContributionSyncResult;
}

/**
 * Validates that all staged paths strictly belong to the allowed 5-file manifest
 * and that any expected modified paths are included in the staged set.
 */
export function verifyStagedManifest(
  stagedPaths: string[],
  expectedModifiedPaths?: string[]
): {
  valid: boolean;
  unexpectedPaths: string[];
  missingPaths: string[];
  message?: string;
} {
  const normalizedStaged = stagedPaths.map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean);
  const allowedSet = new Set<string>(PUBLICATION_MANIFEST_PATHS);

  const unexpectedPaths = normalizedStaged.filter((p) => !allowedSet.has(p));
  const missingPaths: string[] = [];

  if (expectedModifiedPaths && expectedModifiedPaths.length > 0) {
    const stagedSet = new Set(normalizedStaged);
    for (const exp of expectedModifiedPaths) {
      const normExp = exp.trim().replace(/\\/g, '/');
      if (!stagedSet.has(normExp)) {
        missingPaths.push(normExp);
      }
    }
  }

  if (unexpectedPaths.length > 0) {
    return {
      valid: false,
      unexpectedPaths,
      missingPaths,
      message: `Publication Manifest Violation: Unexpected files staged outside allowed manifest: ${unexpectedPaths.join(', ')}. Only the 5 allowed manifest files may be staged.`,
    };
  }

  if (missingPaths.length > 0) {
    return {
      valid: false,
      unexpectedPaths,
      missingPaths,
      message: `Publication Manifest Violation: Expected modified manifest files are missing from staging: ${missingPaths.join(', ')}.`,
    };
  }

  return {
    valid: true,
    unexpectedPaths: [],
    missingPaths: [],
  };
}

/**
 * Validates that all required authoritative runtime state files exist and are readable (F-03).
 */
export async function verifyRequiredAuthoritativeFiles(
  baseDir: string
): Promise<{
  valid: boolean;
  missingFiles: string[];
  message?: string;
}> {
  const missingFiles: string[] = [];

  for (const relPath of REQUIRED_AUTHORITATIVE_PATHS) {
    const fullPath = path.join(baseDir, relPath);
    try {
      await fs.access(fullPath, fs.constants.R_OK);
    } catch {
      missingFiles.push(relPath);
    }
  }

  if (missingFiles.length > 0) {
    return {
      valid: false,
      missingFiles,
      message: `Required authoritative runtime document(s) missing or unreadable: ${missingFiles.join(', ')}.`,
    };
  }

  return {
    valid: true,
    missingFiles: [],
  };
}

/**
 * Executes the full safe publication pipeline.
 */
export async function executePublicationPipeline(
  options: PublicationPipelineOptions = {}
): Promise<PublicationPipelineResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const env = options.env ?? process.env;
  const rawRefName = options.refName ?? env.GITHUB_REF_NAME ?? 'main';
  const targetBranch = rawRefName.trim().replace(/^refs\/heads\//, '');
  const gitRemote = options.gitRemote ?? 'origin';
  const dryRun = options.dryRun === true;
  const skipPush = options.skipPush === true;
  const token = (options.token ?? env.GITHUB_TOKEN)?.trim();

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
  let sourceCommitSha = options.sourceCommitSha;
  try {
    const { stdout } = await execGit(['rev-parse', 'HEAD']);
    const currentHead = stdout.trim();
    if (!sourceCommitSha) {
      sourceCommitSha = currentHead;
    } else if (sourceCommitSha.trim().toLowerCase() !== currentHead.toLowerCase()) {
      return {
        success: false,
        status: 'error',
        sourceCommitSha,
        details: `Source commit SHA mismatch: provided "${sourceCommitSha}" does not match repository HEAD "${currentHead}".`,
        error: new Error(`Provided sourceCommitSha does not match HEAD`),
      };
    }
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      details: `Failed to determine checkout HEAD commit SHA: ${(err as Error).message}`,
      error: err as Error,
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
        sourceCommitSha,
        details: `Failed to inspect working tree preflight status: ${(err as Error).message}`,
        error: err as Error,
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
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-01): Dirty working tree detected with ${dirtyEntries.length} uncommitted or untracked changes: ${dirtyEntries.slice(0, 5).join('; ')}. Clean working tree is required before publication.`,
        error: new Error(`Dirty working tree detected: ${dirtyEntries.slice(0, 5).join('; ')}`),
      };
    }
  }

  // 3. Preflight Check: Branch and Destination Verification (F-02)
  if (!targetBranch) {
    return {
      success: false,
      status: 'branch_mismatch',
      sourceCommitSha,
      details: 'Preflight Check Failed (F-02): Invalid or empty destination branch ref.',
      error: new Error('Invalid or empty destination branch ref.'),
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
        sourceCommitSha,
        details: `Failed to determine current git branch: ${(err as Error).message}`,
        error: err as Error,
      };
    }

    if (!currentBranch || currentBranch === 'HEAD') {
      return {
        success: false,
        status: 'branch_mismatch',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-02): Repository is in detached HEAD state. Publication requires an attached named branch matching "${targetBranch}".`,
        error: new Error('Detached HEAD state detected during publication preflight.'),
      };
    }

    if (currentBranch !== targetBranch) {
      return {
        success: false,
        status: 'branch_mismatch',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-02): Checked-out branch "${currentBranch}" does not match target destination branch "${targetBranch}". Aborting to prevent cross-branch contamination.`,
        error: new Error(`Branch mismatch: "${currentBranch}" !== "${targetBranch}"`),
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
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-03): ${fileCheck.message}`,
        error: new Error(fileCheck.message),
      };
    }
  }

  // 5. Preflight Check: Installation Baseline Guard (F-04)
  const mode: SyncExecutionMode = options.mode ?? 'runtime';
  const resolvedId = (() => {
    try {
      return resolveOwnerIdentity({ baseDir, env, allowLedgerFallback: true });
    } catch {
      return undefined;
    }
  })();

  const expectedOwnerDatabaseId =
    options.expectedOwnerDatabaseId ??
    resolvedId?.databaseId ??
    (options.env?.PET_OWNER_DATABASE_ID
      ? parseInt(options.env.PET_OWNER_DATABASE_ID, 10)
      : options.env?.GITHUB_REPOSITORY_OWNER_ID
        ? parseInt(options.env.GITHUB_REPOSITORY_OWNER_ID, 10)
        : process.env.PET_OWNER_DATABASE_ID
          ? parseInt(process.env.PET_OWNER_DATABASE_ID, 10)
          : process.env.GITHUB_REPOSITORY_OWNER_ID
            ? parseInt(process.env.GITHUB_REPOSITORY_OWNER_ID, 10)
            : undefined);

  const targetOwnerLogin = options.targetOwnerLogin ?? resolvedId?.login;

  const contribPath = path.join(baseDir, 'pet', 'ledger', 'contributions.json');
  let contribDoc: ContributionLedgerDocument | null = null;
  try {
    const rawContent = await fs.readFile(contribPath, 'utf-8');
    contribDoc = JSON.parse(rawContent);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'integrity_failed',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Preflight Check Failed (F-04): Could not read contribution ledger at ${contribPath}: ${(err as Error).message}`,
      error: err as Error,
    };
  }

  if (!contribDoc) {
    return {
      success: false,
      status: 'integrity_failed',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Preflight Check Failed (F-04): Contribution ledger document is empty at ${contribPath}`,
      error: new Error('Empty contribution ledger document'),
    };
  }

  if (mode === 'runtime') {
    if (!contribDoc.installationBaseline || contribDoc.installationBaseline.completed !== true) {
      return {
        success: false,
        status: 'baseline_missing',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: 'Baseline Prerequisite Failed (F-04): Installation baseline is absent or incomplete. Ordinary publication cannot initialize baseline. Run with --baseline-only to establish baseline.',
        error: new MissingBaselineError(),
      };
    }

    const isValidLedgerOwnerId =
      typeof contribDoc.ownerDatabaseId === 'number' &&
      Number.isInteger(contribDoc.ownerDatabaseId) &&
      contribDoc.ownerDatabaseId > 0;

    if (!isValidLedgerOwnerId) {
      return {
        success: false,
        status: 'integrity_failed',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-04): Established contribution ledger has absent or invalid ownerDatabaseId (${String(contribDoc.ownerDatabaseId)}). Runtime publication requires a valid positive integer ownerDatabaseId.`,
        error: new Error(
          `Established contribution ledger has absent or invalid ownerDatabaseId: ${String(contribDoc.ownerDatabaseId)}`
        ),
      };
    }

    if (expectedOwnerDatabaseId !== undefined) {
      if (!Number.isInteger(expectedOwnerDatabaseId) || expectedOwnerDatabaseId <= 0) {
        return {
          success: false,
          status: 'integrity_failed',
          sourceCommitSha,
          destinationRef: targetBranch,
          details: `Preflight Check Failed (F-04): Configured expected owner database ID is invalid (${String(expectedOwnerDatabaseId)}). Expected a positive integer.`,
          error: new Error(`Invalid expected owner database ID: ${String(expectedOwnerDatabaseId)}`),
        };
      }
      if (contribDoc.ownerDatabaseId !== expectedOwnerDatabaseId) {
        return {
          success: false,
          status: 'integrity_failed',
          sourceCommitSha,
          destinationRef: targetBranch,
          details: `Preflight Check Failed (F-04): Expected owner database ID (${expectedOwnerDatabaseId}) does not match established ledger ownerDatabaseId (${contribDoc.ownerDatabaseId}).`,
          error: new Error(
            `Owner ID mismatch: expected ${expectedOwnerDatabaseId}, ledger has ${contribDoc.ownerDatabaseId}`
          ),
        };
      }
    }
  } else if (mode === 'baseline_only') {
    if (contribDoc.installationBaseline?.completed === true) {
      return {
        success: false,
        status: 'baseline_refused',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: 'Baseline Refused (F-04): Installation baseline has already been established and cannot be overwritten.',
        error: new BaselineAlreadyEstablishedError(),
      };
    }
    if (!isPristineContributionLedger(contribDoc)) {
      return {
        success: false,
        status: 'integrity_failed',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: 'Baseline Refused (F-04): Contribution ledger is not in a valid pristine state (partially initialized or corrupt).',
        error: new Error('Contribution ledger is not in a valid pristine state.'),
      };
    }
  }

  // 6. Execute ContributionSyncService
  let syncResult: ContributionSyncResult | undefined;
  try {
    syncResult = await syncContributions({
      baseDir,
      token,
      env: options.env,
      nowMs: options.nowMs,
      dryRun,
      sourceCommitSha,
      provider: options.provider,
      remoteFenceCheck:
        options.remoteFenceCheck ??
        ((sha: string) =>
          checkRemoteGenerationFence(sha, gitRemote, `refs/heads/${targetBranch}`, baseDir)),
      mode,
      expectedOwnerDatabaseId,
      targetOwnerLogin,
    });
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Sync service execution failed: ${(err as Error).message}`,
      error: err as Error,
    };
  }

  if (syncResult.status === 'baseline_missing') {
    return {
      success: false,
      status: 'baseline_missing',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: 'Baseline Prerequisite Failed: Installation baseline is absent or incomplete. Ordinary publication cannot proceed. Run with --baseline-only to establish baseline.',
      error: syncResult.error ?? new MissingBaselineError(),
      syncResult,
    };
  }

  if (syncResult.status === 'baseline_refused') {
    return {
      success: false,
      status: 'baseline_refused',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: 'Baseline Refused: Installation baseline has already been established and cannot be overwritten.',
      error: syncResult.error ?? new BaselineAlreadyEstablishedError(),
      syncResult,
    };
  }

  // 7. Stage 1 Remote Generation Fence Conflict Check
  if (syncResult.status === 'conflict') {
    // Stage 1 fence failed: remote moved after checkout. Clean working tree and abort immediately.
    await execGit(['checkout', '--', ...PUBLICATION_MANIFEST_PATHS]).catch(() => {});
    return {
      success: false,
      status: 'stage_1_fence_conflict',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: syncResult.notes,
      syncResult,
    };
  }

  if (syncResult.status === 'integrity_failed') {
    return {
      success: false,
      status: 'integrity_failed',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: syncResult.notes,
      error: syncResult.error,
      syncResult,
    };
  }

  if (syncResult.status === 'provider_failed' && !syncResult.svgPublished && !syncResult.savedGeneration) {
    return {
      success: false,
      status: 'provider_failed',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: syncResult.notes,
      error: syncResult.error,
      syncResult,
    };
  }

  // 7. Inspect Working Tree for Changes in Allowed Manifest
  let statusOut = '';
  try {
    const res = await execGit(['status', '--porcelain']);
    statusOut = res.stdout;
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Failed to query git status: ${(err as Error).message}`,
      error: err as Error,
      syncResult,
    };
  }

  // Do not use statusOut.trim() before splitting because unstaged changes have a leading space at column 0
  const porcelainLines = statusOut.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const modifiedManifestPaths: string[] = [];

  for (const line of porcelainLines) {
    if (line.length < 4) continue;
    // Porcelain line format: "XY path/to/file" -> path begins at index 3
    const filePath = line.substring(3).trim().replace(/\\/g, '/');
    if (PUBLICATION_MANIFEST_PATHS.includes(filePath as PublicationManifestPath)) {
      modifiedManifestPaths.push(filePath);
    }
  }

  // 8. Clean No-Op Check
  if (modifiedManifestPaths.length === 0) {
    return {
      success: true,
      status: 'noop',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: 'No changes detected in publication manifest files. Clean no-op; skipping commit and push.',
      syncResult,
    };
  }

  // 9. Stage ONLY Explicit Manifest Paths (Never git add . or -A)
  try {
    await execGit(['add', ...modifiedManifestPaths]);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Failed to stage manifest files: ${(err as Error).message}`,
      error: err as Error,
      syncResult,
    };
  }

  // 10. Verify Staged Paths Against Allowed Manifest
  let stagedPaths: string[] = [];
  try {
    const res = await execGit(['diff', '--name-only', '--cached']);
    stagedPaths = res.stdout.trim().split(/\r?\n/).map((p) => p.trim().replace(/\\/g, '/')).filter(Boolean);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Failed to query staged git diff: ${(err as Error).message}`,
      error: err as Error,
      syncResult,
    };
  }

  const manifestCheck = verifyStagedManifest(
    stagedPaths,
    options.expectedModifiedPaths ?? modifiedManifestPaths
  );

  if (!manifestCheck.valid) {
    // Unstage everything on violation to leave staging area clean
    await execGit(['reset', 'HEAD']).catch(() => {});
    return {
      success: false,
      status: 'manifest_violation',
      sourceCommitSha,
      destinationRef: targetBranch,
      stagedFiles: stagedPaths,
      details: manifestCheck.message!,
      error: new Error(manifestCheck.message),
      syncResult,
    };
  }

  // 11. Create Publication Commit
  let commitSha: string;
  try {
    await execGit(['commit', '-m', 'pet: update state and visual badge [skip ci]']);
    const headRes = await execGit(['rev-parse', 'HEAD']);
    commitSha = headRes.stdout.trim();
  } catch (err: unknown) {
    await execGit(['reset', 'HEAD']).catch(() => {});
    return {
      success: false,
      status: 'error',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Git commit failed: ${(err as Error).message}`,
      error: err as Error,
      syncResult,
    };
  }

  // 12. Dry-Run / Skip-Push Short Circuit
  if (dryRun || skipPush) {
    return {
      success: true,
      status: 'committed_dry_run',
      sourceCommitSha,
      commitSha,
      stagedFiles: stagedPaths,
      destinationRef: targetBranch,
      details: `Dry run / push skipped: Committed ${stagedPaths.length} files as ${commitSha}. Push skipped.`,
      syncResult,
    };
  }

  // 13. Stage 2 Server-Side Fast-Forward Push
  try {
    await execGit(['push', gitRemote, `HEAD:${targetBranch}`]);
  } catch (err: unknown) {
    const error = err as Error;
    const errorMsg = error.message;
    const isNonFastForward =
      errorMsg.includes('non-fast-forward') ||
      errorMsg.includes('fetch first') ||
      errorMsg.includes('failed to push some refs') ||
      errorMsg.includes('Updates were rejected') ||
      errorMsg.includes('[rejected]');

    const conflictMessage = isNonFastForward
      ? `Publication Conflict: Git server rejected non-fast-forward push to "${targetBranch}". Remote branch advanced after local checkout. Stale state aborted without rebase or force-push.`
      : `Push Failure: Failed to push commit ${commitSha} to ${gitRemote} HEAD:${targetBranch}: ${errorMsg}`;

    // Roll back local commit so working tree is restored to initial S_0 commit
    // (Preflight F-01 guarantees working tree was clean at S_0, so no user data is lost)
    await execGit(['reset', '--hard', sourceCommitSha]).catch(() => {});

    return {
      success: false,
      status: 'push_rejected',
      sourceCommitSha,
      stagedFiles: stagedPaths,
      destinationRef: targetBranch,
      details: conflictMessage,
      error: new Error(conflictMessage),
      syncResult,
    };
  }

  return {
    success: true,
    status: 'published',
    sourceCommitSha,
    commitSha,
    stagedFiles: stagedPaths,
    destinationRef: targetBranch,
    details: `Successfully published ${stagedPaths.length} artifacts to ${gitRemote}/${targetBranch} (${commitSha}).`,
    syncResult,
  };
}

export const runPublicationPipeline = executePublicationPipeline;
