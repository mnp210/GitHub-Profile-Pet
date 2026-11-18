/**
 * GitHub Profile Pet — Dedicated Contribution Baseline Pipeline (Phase 3C2.3-B2-R3)
 *
 * Provides strict, isolated baseline initialization execution.
 *
 * Guarantees:
 * 1. Isolation from ordinary publication: does NOT simulate pet vitals,
 *    does NOT process actions, does NOT award rewards, does NOT render SVG,
 *    and does NOT modify README.md.
 * 2. Manifest Restriction: stages and commits ONLY the 3 core state documents
 *    (pet/state/pet.json, pet/ledger/contributions.json, pet/ledger/actions.json).
 * 3. Fail-Closed Invariants: fails closed if working tree is dirty, destination
 *    branch is mismatched, state files are missing, ledger is not pristine,
 *    or baseline has already been established.
 * 4. Fast-Forward Only: strictly pushes via atomic fast-forward refspec.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  syncContributions,
  type ContributionSyncResult,
  BaselineAlreadyEstablishedError,
} from '../sync/index.ts';
import type { GitHubContributionProvider } from '../contribution/index.ts';
import { redactSensitiveData } from '../contribution/index.ts';
import { isPristineContributionLedger } from '../validation/ledgerValidator.ts';
import type { ContributionLedgerDocument } from '../domain/types.ts';

const execFileAsync = promisify(execFile);

export const BASELINE_MANIFEST_PATHS = [
  'pet/state/pet.json',
  'pet/ledger/contributions.json',
  'pet/ledger/actions.json',
] as const;

export type BaselineManifestPath = (typeof BASELINE_MANIFEST_PATHS)[number];

export type BaselinePipelineStatus =
  | 'baseline_established'
  | 'baseline_refused'
  | 'integrity_failed'
  | 'dirty_working_tree'
  | 'branch_mismatch'
  | 'missing_authoritative_file'
  | 'manifest_violation'
  | 'push_rejected'
  | 'stage_1_fence_conflict'
  | 'committed_dry_run'
  | 'provider_failed'
  | 'error';

export interface BaselinePipelineOptions {
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
  remoteFenceCheck?: (sourceCommitSha: string) => Promise<{ matches: boolean; currentRemoteSha: string }>;
  gitExecutor?: (cmd: string, args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  skipCleanPreflight?: boolean;
  skipBranchCheck?: boolean;
  skipAuthoritativeFileCheck?: boolean;
  expectedOwnerDatabaseId?: number;
}

export interface BaselinePipelineResult {
  success: boolean;
  status: BaselinePipelineStatus;
  commitSha?: string;
  stagedFiles?: string[];
  destinationRef?: string;
  sourceCommitSha?: string;
  details: string;
  error?: Error;
  syncResult?: ContributionSyncResult;
}

/**
 * Validates that all required authoritative runtime state files exist and are readable.
 */
export async function verifyBaselineStateFiles(
  baseDir: string
): Promise<{
  valid: boolean;
  missingFiles: string[];
  message?: string;
}> {
  const missingFiles: string[] = [];

  for (const relPath of BASELINE_MANIFEST_PATHS) {
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
      message: `Required authoritative baseline document(s) missing or unreadable: ${missingFiles.join(', ')}.`,
    };
  }

  return {
    valid: true,
    missingFiles: [],
  };
}

/**
 * Executes the dedicated, isolated baseline establishment pipeline.
 */
export async function executeBaselinePipeline(
  options: BaselinePipelineOptions = {}
): Promise<BaselinePipelineResult> {
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
        error: new Error('Provided sourceCommitSha does not match HEAD'),
      };
    }
  } catch (err: unknown) {
    if (options.dryRun && options.skipCleanPreflight) {
      sourceCommitSha = sourceCommitSha ?? '0000000000000000000000000000000000000000';
    } else {
      return {
        success: false,
        status: 'error',
        details: `Failed to determine checkout HEAD commit SHA: ${(err as Error).message}`,
        error: err as Error,
      };
    }
  }

  // 2. Preflight Check: Clean Working Tree (F-01)
  if (!options.skipCleanPreflight) {
    let rawStatusOut = '';
    try {
      const { stdout: statusOut } = await execGit(['status', '--porcelain', '--untracked-files=all']);
      rawStatusOut = statusOut;
    } catch (err: unknown) {
      return {
        success: false,
        status: 'error',
        sourceCommitSha,
        details: `Failed to inspect working tree preflight status: ${(err as Error).message}`,
        error: err as Error,
      };
    }

    if (rawStatusOut.trim().length > 0) {
      const dirtyEntries = rawStatusOut
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => (l.length >= 4 ? l.substring(3).trim() : l.trim()));
      return {
        success: false,
        status: 'dirty_working_tree',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-01): Dirty working tree detected with ${dirtyEntries.length} uncommitted or untracked changes: ${dirtyEntries.slice(0, 5).join('; ')}. Clean working tree is required before baseline establishment.`,
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
        details: `Failed to inspect current git branch: ${(err as Error).message}`,
        error: err as Error,
      };
    }

    if (!currentBranch) {
      return {
        success: false,
        status: 'branch_mismatch',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-02): Repository is in detached HEAD state. Baseline establishment must be executed from local branch "${targetBranch}".`,
        error: new Error('Detached HEAD state detected.'),
      };
    }

    if (currentBranch !== targetBranch) {
      return {
        success: false,
        status: 'branch_mismatch',
        sourceCommitSha,
        destinationRef: targetBranch,
        details: `Preflight Check Failed (F-02): Local branch "${currentBranch}" does not match destination branch "${targetBranch}".`,
        error: new Error(`Branch mismatch: local is "${currentBranch}", destination is "${targetBranch}".`),
      };
    }
  }

  // 4. Preflight Check: Required Baseline State Files Exist (F-03)
  if (!options.skipAuthoritativeFileCheck) {
    const fileCheck = await verifyBaselineStateFiles(baseDir);
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

  // 5. Preflight Check: Baseline Guard (F-04)
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

  const rawExpectedDbId =
    options.expectedOwnerDatabaseId ??
    (env.PET_OWNER_DATABASE_ID ? parseInt(env.PET_OWNER_DATABASE_ID, 10) : undefined);

  if (!isPristineContributionLedger(contribDoc, rawExpectedDbId)) {
    return {
      success: false,
      status: 'integrity_failed',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: 'Baseline Refused (F-04): Contribution ledger is not in a valid pristine state (partially initialized, corrupt, or ownerDatabaseId mismatch).',
      error: new Error('Contribution ledger is not in a valid pristine state.'),
    };
  }

  // 6. Execute Isolated Contribution Synchronization in baseline_only mode
  let syncResult: ContributionSyncResult | undefined;
  const remoteFenceCheck =
    options.remoteFenceCheck ??
    (options.skipCleanPreflight || dryRun
      ? async (sha: string) => ({ matches: true, currentRemoteSha: sha })
      : undefined);

  try {
    syncResult = await syncContributions({
      baseDir,
      token,
      env: options.env,
      nowMs: options.nowMs,
      dryRun,
      sourceCommitSha,
      provider: options.provider,
      remoteFenceCheck,
      mode: 'baseline_only',
      skipSimulation: true,
      expectedOwnerDatabaseId: rawExpectedDbId,
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

  if (syncResult.status === 'conflict') {
    await execGit(['checkout', '--', ...BASELINE_MANIFEST_PATHS]).catch(() => {});
    return {
      success: false,
      status: 'stage_1_fence_conflict',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: syncResult.notes,
      syncResult,
    };
  }

  if (syncResult.status === 'provider_failed') {
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

  // 7. Verify Working Tree: Baseline Isolation Enforcement
  let statusOut = '';
  try {
    const res = await execGit(['status', '--porcelain']);
    statusOut = res.stdout;
  } catch (err: unknown) {
    if (options.dryRun && options.skipCleanPreflight) {
      statusOut = '';
    } else {
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
  }

  const porcelainLines = statusOut.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const modifiedManifestPaths: string[] = [];
  const unauthorizedModifiedPaths: string[] = [];
  const allowedSet = new Set<string>(BASELINE_MANIFEST_PATHS);

  for (const line of porcelainLines) {
    if (line.length < 4) continue;
    const filePath = line.substring(3).trim().replace(/\\/g, '/');
    if (allowedSet.has(filePath as BaselineManifestPath)) {
      modifiedManifestPaths.push(filePath);
    } else {
      unauthorizedModifiedPaths.push(filePath);
    }
  }

  // Strict isolation check: public/pet.svg, README.md, or any file outside baseline manifest must NOT be touched
  if (unauthorizedModifiedPaths.length > 0) {
    await execGit(['checkout', '--', ...modifiedManifestPaths, ...unauthorizedModifiedPaths]).catch(() => {});
    return {
      success: false,
      status: 'manifest_violation',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Baseline Isolation Violation: Baseline establishment modified unauthorized files: ${unauthorizedModifiedPaths.join(', ')}. Baseline-only operation must never modify SVG, README, or non-baseline files.`,
      error: new Error(`Unauthorized files modified during baseline: ${unauthorizedModifiedPaths.join(', ')}`),
      syncResult,
    };
  }

  // 8. Dry-Run Short Circuit
  if (dryRun) {
    return {
      success: true,
      status: 'baseline_established',
      commitSha: sourceCommitSha,
      stagedFiles: modifiedManifestPaths.length > 0 ? modifiedManifestPaths : [...BASELINE_MANIFEST_PATHS],
      destinationRef: targetBranch,
      sourceCommitSha,
      details: 'Baseline dry-run execution succeeded; git commit and push skipped.',
      syncResult,
    };
  }

  // 9. Stage ONLY Explicit Baseline Manifest Paths
  try {
    await execGit(['add', ...modifiedManifestPaths]);
  } catch (err: unknown) {
    return {
      success: false,
      status: 'error',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Failed to stage baseline manifest files: ${(err as Error).message}`,
      error: err as Error,
      syncResult,
    };
  }

  // 10. Create Dedicated Baseline Commit
  let commitSha: string;
  try {
    await execGit(['commit', '-m', 'chore(pet): initialize contribution baseline [skip ci]']);
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

  // 11. Skip-Push Short Circuit
  if (skipPush) {
    return {
      success: true,
      status: 'baseline_established',
      commitSha,
      stagedFiles: modifiedManifestPaths,
      destinationRef: targetBranch,
      sourceCommitSha,
      details: `Baseline established and committed locally (${commitSha}); remote push skipped by options.`,
      syncResult,
    };
  }

  // 11. Atomic Fast-Forward Push: git push <gitRemote> HEAD:<targetBranch>
  try {
    await execGit(['push', gitRemote, `HEAD:${targetBranch}`]);
  } catch (err: unknown) {
    const pushError = err as Error & { stderr?: string };
    const errText = `${pushError.message} ${pushError.stderr ?? ''}`;

    // On non-fast-forward push rejection: roll back local commit to S_0
    await execGit(['reset', '--hard', sourceCommitSha]).catch(() => {});

    return {
      success: false,
      status: 'push_rejected',
      sourceCommitSha,
      destinationRef: targetBranch,
      details: `Atomic push rejected by remote (non-fast-forward conflict): ${errText}. Local baseline commit rolled back to ${sourceCommitSha}.`,
      error: pushError,
      syncResult,
    };
  }

  return {
    success: true,
    status: 'baseline_established',
    commitSha,
    stagedFiles: modifiedManifestPaths,
    destinationRef: targetBranch,
    sourceCommitSha,
    details: `Contribution baseline successfully established and published at commit ${commitSha}.`,
    syncResult,
  };
}
