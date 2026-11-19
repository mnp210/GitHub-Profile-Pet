/**
 * GitHub Profile Pet — Contribution Synchronization Runtime Integration Service (Phase 3C2.2.3.3)
 *
 * Coordinates:
 * 1. Target owner identity resolution (personal user vs. organization).
 * 2. Unlocked 2-day GraphQL contribution snapshot fetch (never hold local lock during network I/O).
 * 3. Rate-limit telemetry validation with conservative 1,000 pt/hr planning ceiling and 50 pt deferral threshold.
 * 4. Local concurrency locking and crash-safe transaction journal recovery.
 * 5. Strict pristine-ledger predicate classification vs established ledger reconciliation.
 * 6. Deterministic contribution accounting (XP, satiety, daily caps, hourly throttle, pending queues, 48h expiry).
 * 7. Passive inactivity simulation transitions coordination.
 * 8. Multi-document atomic generation lockstep commit across pet, contributions, and actions.
 * 9. Post-commit lock-held SVG asset publication.
 * 10. Stage 1 pre-push remote generation fencing check.
 */

import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  GitHubContributionProvider,
  resolveTargetOwner,
  verifyOwnerIdentity,
  redactSensitiveData,
  IdentityMismatchError,
  MissingOwnerConfigurationError,
} from '../contribution/index.ts';
import type { GitHub2DayContributionSnapshot } from '../contribution/types.ts';
import {
  reconcileContributions,
  type ContributionReconciliationResult,
} from '../accounting/contributionEngine.ts';
import {
  acquireLock,
  getStatePaths,
  loadRepositoryState,
  recoverRepositoryState,
  saveRepositoryState,
  type CompleteRepositoryState,
  type LockReleaseFn,
} from '../persistence/stateRepository.ts';
import { publishPetSvg } from '../publication/index.ts';
import { applyInactivitySimulation } from '../transitions/simulationTransitions.ts';
import { isPristineContributionLedger, assertValidContributionLedger } from '../validation/ledgerValidator.ts';
import type {
  ActionLedgerDocument,
  ContributionLedgerDocument,
  PetStateDocument,
} from '../domain/types.ts';

const execFileAsync = promisify(execFile);

export const DEFAULT_PLANNING_CEILING_POINTS = 1000;
export const DEFAULT_DEFER_THRESHOLD_POINTS = 50;

export class MissingBaselineError extends Error {
  constructor(
    message = 'Installation baseline has not been established. Runtime contribution synchronization cannot proceed until explicit one-time baseline initialization is performed.'
  ) {
    super(message);
    this.name = 'MissingBaselineError';
  }
}

export class BaselineAlreadyEstablishedError extends Error {
  constructor(
    message = 'Installation baseline has already been established and cannot be overwritten.'
  ) {
    super(message);
    this.name = 'BaselineAlreadyEstablishedError';
  }
}

export type SyncExecutionMode = 'runtime' | 'baseline_only';

export type ContributionSyncStatus =
  | 'completed'
  | 'baseline_established'
  | 'noop'
  | 'deferred'
  | 'provider_failed'
  | 'integrity_failed'
  | 'conflict'
  | 'baseline_missing'
  | 'baseline_refused';

export interface ContributionSyncOptions {
  baseDir?: string;
  token?: string;
  env?: Record<string, string | undefined>;
  nowMs?: number;
  dryRun?: boolean;
  forcePublish?: boolean;
  deferThresholdPoints?: number;
  planningCeilingPoints?: number;
  sourceCommitSha?: string;
  remoteFenceCheck?: (sourceCommitSha: string) => Promise<{ matches: boolean; currentRemoteSha: string }>;
  provider?: GitHubContributionProvider;
  skipSimulation?: boolean;
  targetOwnerLogin?: string;
  mode?: SyncExecutionMode;
  expectedOwnerDatabaseId?: number;
  existingLock?: LockReleaseFn;
  initialPristineState?: CompleteRepositoryState;
}

export interface ContributionSyncResult {
  status: ContributionSyncStatus;
  incrementsEvaluated: number;
  xpAwarded: number;
  satietyAwarded: number;
  deltaObserved: number;
  savedGeneration?: number;
  svgPublished: boolean;
  queryCost?: number;
  rateLimitRemaining?: number;
  latencyMs?: number;
  notes: string;
  error?: Error;
  reconciliation?: ContributionReconciliationResult;
}

/**
 * Stage 1 Pre-Push Remote Generation Fence Check
 * Queries remote HEAD commit SHA and confirms it matches expected checkout commit.
 */
export async function checkRemoteGenerationFence(
  expectedCommitSha: string,
  gitRemote: string = 'origin',
  branch: string = 'refs/heads/main',
  baseDir?: string
): Promise<{ matches: boolean; currentRemoteSha: string }> {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', gitRemote, branch], {
      cwd: baseDir ?? process.cwd(),
    });
    const trimmed = stdout.trim();
    const currentRemoteSha = trimmed.split(/\s+/)[0] || '';
    return {
      matches: currentRemoteSha.toLowerCase() === expectedCommitSha.trim().toLowerCase(),
      currentRemoteSha,
    };
  } catch (err) {
    return {
      matches: false,
      currentRemoteSha: `ERROR: ${(err as Error).message}`,
    };
  }
}

/**
 * Main runtime synchronization orchestrator.
 */
export async function syncContributions(
  options: ContributionSyncOptions = {}
): Promise<ContributionSyncResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const isDryRun = options.dryRun === true;
  const deferThreshold = options.deferThresholdPoints ?? DEFAULT_DEFER_THRESHOLD_POINTS;
  const planningCeiling = options.planningCeilingPoints ?? DEFAULT_PLANNING_CEILING_POINTS;
  const mode: SyncExecutionMode = options.mode ?? 'runtime';

  // 0. Preflight Baseline Guard Check (Zero network calls, zero simulation, zero state mutation)
  const paths = getStatePaths(baseDir);
  let localLedgerRaw: ContributionLedgerDocument | null = null;
  if (options.initialPristineState) {
    localLedgerRaw = options.initialPristineState.contributions;
  } else {
    try {
      const rawContent = await fs.readFile(paths.contributionsPath, 'utf-8');
      localLedgerRaw = JSON.parse(rawContent) as ContributionLedgerDocument;
      assertValidContributionLedger(localLedgerRaw);
    } catch (err: unknown) {
      const error = err as Error;
      return {
        status: 'integrity_failed',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: `Failed to read contribution ledger document: ${error.message}`,
        error,
      };
    }
  }

  if (mode === 'runtime') {
    if (!localLedgerRaw.installationBaseline || localLedgerRaw.installationBaseline.completed !== true) {
      return {
        status: 'baseline_missing',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: 'Installation baseline has not been established. Runtime contribution synchronization cannot proceed until explicit one-time baseline initialization is performed.',
        error: new MissingBaselineError(),
      };
    }
  } else if (mode === 'baseline_only') {
    if (localLedgerRaw.installationBaseline?.completed === true) {
      return {
        status: 'baseline_refused',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: 'Installation baseline has already been established and cannot be overwritten.',
        error: new BaselineAlreadyEstablishedError(),
      };
    }

    if (!isPristineContributionLedger(localLedgerRaw)) {
      return {
        status: 'integrity_failed',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: 'Contribution ledger is not in a valid pristine state (partially initialized or corrupt). Baseline initialization refused.',
        error: new Error('Contribution ledger is not in a valid pristine state.'),
      };
    }
  }

  // 1. Resolve Target Owner Identity
  let targetOwner: string;
  try {
    if (options.targetOwnerLogin) {
      targetOwner = options.targetOwnerLogin.trim();
    } else {
      const resolved = resolveTargetOwner(env);
      targetOwner = resolved.login;
    }
  } catch (err: unknown) {
    const error = err as Error;
    return {
      status: 'provider_failed',
      incrementsEvaluated: 0,
      xpAwarded: 0,
      satietyAwarded: 0,
      deltaObserved: 0,
      svgPublished: false,
      notes: `Target owner resolution failed: ${error.message}`,
      error,
    };
  }

  // 1b. Resolve and Validate Immutable Numeric Owner Identity
  let expectedOwnerDatabaseId: number | undefined =
    options.expectedOwnerDatabaseId ??
    (env.PET_OWNER_DATABASE_ID ? parseInt(env.PET_OWNER_DATABASE_ID, 10) : undefined);

  if (expectedOwnerDatabaseId !== undefined && (!Number.isInteger(expectedOwnerDatabaseId) || expectedOwnerDatabaseId <= 0)) {
    return {
      status: 'integrity_failed',
      incrementsEvaluated: 0,
      xpAwarded: 0,
      satietyAwarded: 0,
      deltaObserved: 0,
      svgPublished: false,
      notes: `Invalid expectedOwnerDatabaseId (${String(options.expectedOwnerDatabaseId ?? env.PET_OWNER_DATABASE_ID)}). Expected a positive integer.`,
      error: new MissingOwnerConfigurationError('Invalid expectedOwnerDatabaseId: must be a positive integer.'),
    };
  }

  if (mode === 'runtime') {
    const isValidLedgerOwnerId =
      typeof localLedgerRaw.ownerDatabaseId === 'number' &&
      Number.isInteger(localLedgerRaw.ownerDatabaseId) &&
      localLedgerRaw.ownerDatabaseId > 0;

    if (!isValidLedgerOwnerId) {
      return {
        status: 'integrity_failed',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: `Established contribution ledger has absent or invalid ownerDatabaseId (${String(localLedgerRaw.ownerDatabaseId)}). Runtime contribution synchronization requires a valid positive integer ownerDatabaseId in the established ledger.`,
        error: new IdentityMismatchError(
          `Established contribution ledger has absent or invalid ownerDatabaseId: ${String(localLedgerRaw.ownerDatabaseId)}`
        ),
      };
    }

    if (expectedOwnerDatabaseId !== undefined) {
      if (expectedOwnerDatabaseId !== localLedgerRaw.ownerDatabaseId) {
        return {
          status: 'integrity_failed',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: `Immutable owner ID mismatch: expectedOwnerDatabaseId (${expectedOwnerDatabaseId}) does not match established ledger ownerDatabaseId (${localLedgerRaw.ownerDatabaseId}). Synchronization aborted.`,
          error: new IdentityMismatchError(
            `Expected owner database ID (${expectedOwnerDatabaseId}) does not match established ledger ownerDatabaseId (${localLedgerRaw.ownerDatabaseId}).`
          ),
        };
      }
    } else {
      // Intentional and explicitly documented behavior:
      // When expectedOwnerDatabaseId is not explicitly injected via options or PET_OWNER_DATABASE_ID,
      // runtime contribution sync adopts the immutable numeric ownerDatabaseId already persisted in the established ledger.
      // Because the ledger's ownerDatabaseId was validated as a positive integer above,
      // this is guaranteed to be an immutable numeric ID and can never be confused with a mutable login.
      expectedOwnerDatabaseId = localLedgerRaw.ownerDatabaseId ?? undefined;
    }
  }

  // 2. Token Resolution & Unlocked Network Request
  // Rule: Network calls are NEVER made while holding local mutex locks (AC-18).
  const token = (options.token ?? env.GITHUB_TOKEN)?.trim();
  if (!token) {
    if (mode === 'baseline_only') {
      return {
        status: 'provider_failed',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: 'GITHUB_TOKEN is missing. Baseline initialization skipped; zero ledger mutation.',
        error: new Error('GITHUB_TOKEN environment variable is required for contribution baseline initialization.'),
      };
    }

    // Missing token in runtime mode: skip accounting with zero ledger mutation.
    // Passive simulation may proceed independently if conditions permit (AC-19).
    let simSvgPublished = false;
    let simSavedGen: number | undefined;
    if (!options.skipSimulation && !isDryRun) {
      try {
        const { simulatePet } = await import('../simulation/index.ts');
        const simResult = await simulatePet({ baseDir, nowMs, dryRun: isDryRun });
        simSvgPublished = simResult.svgPublished;
        simSavedGen = simResult.savedGeneration;
      } catch {
        // Simulation error does not mask provider failure
      }
    }

    return {
      status: 'provider_failed',
      incrementsEvaluated: 0,
      xpAwarded: 0,
      satietyAwarded: 0,
      deltaObserved: 0,
      savedGeneration: simSavedGen,
      svgPublished: simSvgPublished,
      notes: 'GITHUB_TOKEN is missing. Contribution accounting skipped; passive simulation ran independently.',
      error: new Error('GITHUB_TOKEN environment variable is required for contribution synchronization.'),
    };
  }

  const provider = options.provider ?? new GitHubContributionProvider();
  let snapshot2Day: GitHub2DayContributionSnapshot;

  try {
    snapshot2Day = await provider.fetchUserContributionSnapshot2Day(
      targetOwner,
      token,
      {
        now: nowMs,
        expectedOwnerDatabaseId,
      }
    );
  } catch (err: unknown) {
    const error = err as Error;
    const sanitizedMsg = redactSensitiveData(error.message, token);

    if (error instanceof IdentityMismatchError) {
      return {
        status: 'integrity_failed',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: `Immutable owner identity mismatch: ${sanitizedMsg}`,
        error,
      };
    }

    if (mode === 'baseline_only') {
      return {
        status: 'provider_failed',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        svgPublished: false,
        notes: `Baseline provider query failed: ${sanitizedMsg}. Baseline initialization skipped; zero ledger mutation.`,
        error,
      };
    }

    // If provider fails in runtime mode, accounting is skipped with zero ledger mutation.
    // Passive simulation proceeds independently (AC-19).
    let simSvgPublished = false;
    let simSavedGen: number | undefined;
    if (!options.skipSimulation && !isDryRun) {
      try {
        const { simulatePet } = await import('../simulation/index.ts');
        const simResult = await simulatePet({ baseDir, nowMs, dryRun: isDryRun });
        simSvgPublished = simResult.svgPublished;
        simSavedGen = simResult.savedGeneration;
      } catch {
        // Ignored; report provider failure
      }
    }

    return {
      status: 'provider_failed',
      incrementsEvaluated: 0,
      xpAwarded: 0,
      satietyAwarded: 0,
      deltaObserved: 0,
      savedGeneration: simSavedGen,
      svgPublished: simSvgPublished,
      notes: `Provider query failed: ${sanitizedMsg}. Accounting skipped; zero ledger mutation.`,
      error: new Error(sanitizedMsg),
    };
  }

  // 3. Rate-Limit Telemetry & Deferral Threshold (AC-36)
  const queryCost = snapshot2Day.rateLimit?.cost ?? 1;
  const remainingPoints = snapshot2Day.rateLimit?.remaining ?? null;

  if (remainingPoints !== null && remainingPoints < deferThreshold) {
    // Rate limit exhausted below safe threshold: defer cleanly without error
    let simSvgPublished = false;
    let simSavedGen: number | undefined;
    if (!options.skipSimulation && !isDryRun) {
      try {
        const { simulatePet } = await import('../simulation/index.ts');
        const simResult = await simulatePet({ baseDir, nowMs, dryRun: isDryRun });
        simSvgPublished = simResult.svgPublished;
        simSavedGen = simResult.savedGeneration;
      } catch {
        // Ignored
      }
    }

    return {
      status: 'deferred',
      incrementsEvaluated: 0,
      xpAwarded: 0,
      satietyAwarded: 0,
      deltaObserved: 0,
      savedGeneration: simSavedGen,
      svgPublished: simSvgPublished,
      queryCost,
      rateLimitRemaining: remainingPoints,
      latencyMs: snapshot2Day.providerLatencyMs,
      notes: `GraphQL rate-limit points remaining (${remainingPoints}) is below safe deferral threshold (${deferThreshold} pts against ${planningCeiling} pt ceiling). Accounting deferred; zero ledger mutation.`,
    };
  }

  // 4. Local Mutex Lock Acquisition
  const releaseLock = options.existingLock ?? (isDryRun ? null : await acquireLock(paths.lockPath));

  try {
    // 5. Recover Journal and Load Authoritative Repository State
    if (releaseLock) {
      await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });
    } else {
      await recoverRepositoryState(baseDir).catch(() => {});
    }

    const state =
      options.initialPristineState ??
      (await loadRepositoryState(baseDir, {
        lockOwnerId: releaseLock?.ownerId,
      }));

    // 6. Strict Pristine Predicate vs. Established Identity Verification
    const isPristine = isPristineContributionLedger(
      state.contributions,
      expectedOwnerDatabaseId ?? snapshot2Day.ownerDatabaseId
    );

    const isBaselineCompleted =
      state.contributions.installationBaseline?.completed === true;

    if (mode === 'runtime') {
      if (!isBaselineCompleted) {
        return {
          status: 'baseline_missing',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: 'Installation baseline has not been established. Runtime synchronization cannot proceed until explicit one-time baseline initialization is performed.',
          error: new MissingBaselineError(),
        };
      }
      if (!state.contributions.ownerDatabaseId || state.contributions.ownerDatabaseId <= 0) {
        return {
          status: 'integrity_failed',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: 'Established contribution ledger is missing immutable numeric ownerDatabaseId. Accounting aborted.',
          error: new IdentityMismatchError('Missing established ownerDatabaseId in contribution ledger.'),
        };
      }
      if (expectedOwnerDatabaseId && state.contributions.ownerDatabaseId !== expectedOwnerDatabaseId) {
        return {
          status: 'integrity_failed',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: `Immutable owner ID mismatch: snapshot ownerDatabaseId (${snapshot2Day.ownerDatabaseId}) does not match expected (${expectedOwnerDatabaseId}). Synchronization aborted.`,
          error: new IdentityMismatchError(
            `Established ledger ownerDatabaseId (${state.contributions.ownerDatabaseId}) does not match expected ownerDatabaseId (${expectedOwnerDatabaseId}).`
          ),
        };
      }
      // Established ledger: verify immutable numeric database ID
      verifyOwnerIdentity(snapshot2Day.today, state.contributions.ownerDatabaseId);
    } else if (mode === 'baseline_only') {
      if (isBaselineCompleted) {
        return {
          status: 'baseline_refused',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: 'Installation baseline has already been established and cannot be overwritten.',
          error: new BaselineAlreadyEstablishedError(),
        };
      }
      if (expectedOwnerDatabaseId && snapshot2Day.ownerDatabaseId !== expectedOwnerDatabaseId) {
        return {
          status: 'integrity_failed',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: `Immutable owner ID mismatch: snapshot ownerDatabaseId (${snapshot2Day.ownerDatabaseId}) does not match expected (${expectedOwnerDatabaseId}). Baseline initialization aborted.`,
          error: new IdentityMismatchError(
            `Queried GitHub databaseId (${snapshot2Day.ownerDatabaseId}) does not match expected ownerDatabaseId (${expectedOwnerDatabaseId}).`
          ),
        };
      }
      if (!isPristine) {
        return {
          status: 'integrity_failed',
          incrementsEvaluated: 0,
          xpAwarded: 0,
          satietyAwarded: 0,
          deltaObserved: 0,
          svgPublished: false,
          notes: 'Contribution ledger is not in a valid pristine state (partially initialized or corrupt). Baseline initialization refused.',
          error: new Error('Contribution ledger is not in a valid pristine state.'),
        };
      }
    }

    // 7. Deterministic Contribution Reconciliation
    const reconciliation = reconcileContributions({
      pet: state.pet,
      ledger: state.contributions,
      snapshots: [snapshot2Day.yesterday, snapshot2Day.today],
      ownerDatabaseId: snapshot2Day.ownerDatabaseId,
      ownerLogin: snapshot2Day.ownerLogin,
      nowMs,
    });

    let syncStatus: ContributionSyncStatus;
    if (mode === 'baseline_only') {
      syncStatus = 'baseline_established';
    } else if (
      reconciliation.deltaObserved > 0 ||
      reconciliation.incrementsEvaluatedThisRun > 0
    ) {
      syncStatus = 'completed';
    } else {
      syncStatus = 'noop';
    }

    // 8. Inactivity Simulation Transitions Coordination
    let finalPetState: PetStateDocument = reconciliation.nextPetState;
    let vitalsChanged = false;
    if (!options.skipSimulation && mode !== 'baseline_only') {
      const simResult = applyInactivitySimulation(finalPetState, nowMs);
      finalPetState = simResult.nextPetState;
      vitalsChanged =
        simResult.elapsedSeconds > 0 &&
        (simResult.energyRestored > 0 ||
          simResult.hungerDecayed > 0 ||
          simResult.happinessDecayed > 0 ||
          simResult.welcomeBackBonusEligible);
    }

    // Determine if state or assets actually changed
    const hasStateChanges =
      syncStatus !== 'noop' ||
      vitalsChanged ||
      reconciliation.deltaObserved > 0 ||
      reconciliation.incrementsEvaluatedThisRun > 0 ||
      options.forcePublish === true;

    if (!hasStateChanges) {
      return {
        status: 'noop',
        incrementsEvaluated: 0,
        xpAwarded: 0,
        satietyAwarded: 0,
        deltaObserved: 0,
        savedGeneration: state.generation,
        svgPublished: false,
        queryCost,
        rateLimitRemaining: remainingPoints ?? undefined,
        latencyMs: snapshot2Day.providerLatencyMs,
        notes: 'Snapshot evaluated: zero delta observed and vitals unchanged (noop).',
        reconciliation,
      };
    }

    // 9. Atomic Multi-Document Generation Lockstep Commit (AC-27)
    const nextGeneration = state.generation + 1;
    const nowIso = new Date(nowMs).toISOString();
    const nextPet: PetStateDocument = {
      ...finalPetState,
      generation: nextGeneration,
      lastOfflineResolutionTime: finalPetState.lastOfflineResolutionTime ?? nowIso,
      updatedAt: nowIso,
    };
    const nextContributions: ContributionLedgerDocument = {
      ...reconciliation.nextContributionLedger,
      generation: nextGeneration,
    };
    const nextActions: ActionLedgerDocument = {
      ...state.actions,
      generation: nextGeneration,
    };

    if (!isDryRun) {
      await saveRepositoryState(
        baseDir,
        {
          pet: nextPet,
          contributions: nextContributions,
          actions: nextActions,
        },
        {
          expectedGeneration: options.initialPristineState ? undefined : state.generation,
          existingLock: releaseLock!,
        }
      );
    }

    // 10. Post-Commit Lock-Held SVG Asset Publication (AC-26, AC-31)
    let svgPublished = false;
    if (!isDryRun && mode !== 'baseline_only') {
      try {
        const pubResult = await publishPetSvg({ baseDir });
        svgPublished = pubResult.svgChanged || pubResult.readmeChanged;
      } catch (pubErr) {
        // Asset rendering error does not invalidate committed state
        console.error('Lock-held asset publication error:', pubErr);
      }
    }

    // 11. Stage 1 Pre-Push Remote Generation Fence Check (AC-28, AC-29)
    if (options.sourceCommitSha) {
      const fenceCheckFn =
        options.remoteFenceCheck ??
        ((sha: string) => checkRemoteGenerationFence(sha, 'origin', 'refs/heads/main', baseDir));
      const fenceResult = await fenceCheckFn(options.sourceCommitSha);
      if (!fenceResult.matches) {
        return {
          status: 'conflict',
          incrementsEvaluated: reconciliation.incrementsEvaluatedThisRun,
          xpAwarded: reconciliation.totalXpAwarded,
          satietyAwarded: reconciliation.totalSatietyAwarded,
          deltaObserved: reconciliation.deltaObserved,
          savedGeneration: nextGeneration,
          svgPublished,
          queryCost,
          rateLimitRemaining: remainingPoints ?? undefined,
          latencyMs: snapshot2Day.providerLatencyMs,
          notes: `Remote generation advanced after checkout (Remote: ${fenceResult.currentRemoteSha}, Source: ${options.sourceCommitSha}). Publication safely aborted without blind rebase.`,
          reconciliation,
        };
      }
    }

    return {
      status: syncStatus,
      incrementsEvaluated: reconciliation.incrementsEvaluatedThisRun,
      xpAwarded: reconciliation.totalXpAwarded,
      satietyAwarded: reconciliation.totalSatietyAwarded,
      deltaObserved: reconciliation.deltaObserved,
      savedGeneration: isDryRun ? undefined : nextGeneration,
      svgPublished,
      queryCost,
      rateLimitRemaining: remainingPoints ?? undefined,
      latencyMs: snapshot2Day.providerLatencyMs,
      notes:
        syncStatus === 'baseline_established'
          ? 'Installation baseline established with zero retroactive rewards.'
          : syncStatus === 'completed'
            ? `Sync completed. Evaluated ${reconciliation.incrementsEvaluatedThisRun} increments (+${reconciliation.totalXpAwarded} XP, +${reconciliation.totalSatietyAwarded} satiety).`
            : 'Snapshot evaluated: zero delta observed (noop).',
      reconciliation,
    };
  } catch (err: unknown) {
    const error = err as Error;
    const isIntegrityError =
      error.name === 'LedgerIntegrityError' ||
      error.name === 'CorruptOrdinalError' ||
      error.name === 'CorruptHwmError' ||
      error.name === 'IdentityMismatchError' ||
      error.message.includes('validation failed');

    const isConflict =
      error.name === 'ConcurrencyLockError' ||
      error.name === 'GenerationConflictError';

    return {
      status: isIntegrityError
        ? 'integrity_failed'
        : isConflict
          ? 'conflict'
          : 'provider_failed',
      incrementsEvaluated: 0,
      xpAwarded: 0,
      satietyAwarded: 0,
      deltaObserved: 0,
      svgPublished: false,
      notes: `Sync failed closed: ${error.name}: ${error.message}`,
      error,
    };
  } finally {
    if (releaseLock && !options.existingLock) {
      await releaseLock();
    }
  }
}
