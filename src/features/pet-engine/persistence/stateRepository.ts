/**
 * GitHub Profile Pet - Repository State Persistence Manager
 * Coordinates generation consistency, multi-document atomic commit, transaction recovery,
 * concurrency locking, and optimistic CAS conflict detection.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import type {
  ActionLedgerDocument,
  ContributionLedgerDocument,
  PetStateDocument,
} from '../domain/types.ts';
import {
  assertValidActionLedger,
  assertValidContributionLedger,
} from '../validation/ledgerValidator.ts';
import { assertValidPetState } from '../validation/stateValidator.ts';
import { atomicWriteFile } from './atomicFileWriter.ts';

export class GenerationMismatchError extends Error {
  readonly petGeneration: number;
  readonly contributionsGeneration: number;
  readonly actionsGeneration: number;

  constructor(
    petGeneration: number,
    contributionsGeneration: number,
    actionsGeneration: number
  ) {
    super(
      `Generation Mismatch Detected across repository state documents:\n` +
        ` - pet.json generation: ${petGeneration}\n` +
        ` - contributions.json generation: ${contributionsGeneration}\n` +
        ` - actions.json generation: ${actionsGeneration}\n` +
        `State documents must share an identical atomic generation number.`
    );
    this.name = 'GenerationMismatchError';
    this.petGeneration = petGeneration;
    this.contributionsGeneration = contributionsGeneration;
    this.actionsGeneration = actionsGeneration;
  }
}

export class ConcurrencyLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyLockError';
  }
}

export class GenerationConflictError extends Error {
  readonly expectedGeneration: number;
  readonly actualGeneration: number;

  constructor(expectedGeneration: number, actualGeneration: number) {
    super(
      `Optimistic Concurrency Conflict: Expected generation ${expectedGeneration}, but found generation ${actualGeneration}.`
    );
    this.name = 'GenerationConflictError';
    this.expectedGeneration = expectedGeneration;
    this.actualGeneration = actualGeneration;
  }
}

export interface CompleteRepositoryState {
  pet: PetStateDocument;
  contributions: ContributionLedgerDocument;
  actions: ActionLedgerDocument;
  generation: number;
}

export interface TransactionJournalMeta {
  sourceGeneration: number;
  targetGeneration: number;
  status: 'preparing' | 'committed';
  timestamp: string;
}

export interface RecoveryResult {
  recovered: boolean;
  action: 'none' | 'roll_forward' | 'roll_back';
  generation: number;
  details?: string;
}

export interface SaveStateOptions {
  expectedGeneration?: number;
  lockTimeoutMs?: number;
  existingLock?: LockReleaseFn;
}

export function getStatePaths(baseDir: string) {
  return {
    petPath: path.join(baseDir, 'pet', 'state', 'pet.json'),
    contributionsPath: path.join(baseDir, 'pet', 'ledger', 'contributions.json'),
    actionsPath: path.join(baseDir, 'pet', 'ledger', 'actions.json'),
    journalDir: path.join(baseDir, 'pet', '.journal'),
    journalMetaPath: path.join(baseDir, 'pet', '.journal', 'meta.json'),
    journalSourceDir: path.join(baseDir, 'pet', '.journal', 'source'),
    journalTargetDir: path.join(baseDir, 'pet', '.journal', 'target'),
    lockPath: path.join(baseDir, 'pet', '.lock'),
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface LockData {
  ownerId: string;
  pid: number;
  hostname: string;
  createdAt: number;
  updatedAt?: number;
}

export type LockReleaseFn = (() => Promise<void>) & {
  readonly ownerId: string;
};

export interface RecoverOptions {
  lockOwnerId?: string;
}

/**
 * Cross-platform process liveness probe using signal 0.
 * Returns true if the process is alive or owned by another user.
 * Returns false if the process definitely does not exist (ESRCH).
 */
export function isProcessAlive(pid: number): boolean {
  if (typeof pid !== 'number' || pid <= 0 || !Number.isInteger(pid)) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    return error.code === 'EPERM';
  }
}

export async function readLockData(lockPath: string): Promise<LockData | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf-8');
    const data = JSON.parse(raw);
    if (typeof data === 'object' && data !== null && typeof data.ownerId === 'string') {
      return data as LockData;
    }
    return null;
  } catch {
    return null;
  }
}

export async function acquireLock(
  lockPath: string,
  timeoutMs: number = 30_000
): Promise<LockReleaseFn> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  const ownerId = crypto.randomUUID();
  const hostname = os.hostname();
  const now = Date.now();
  const lockData: LockData = {
    ownerId,
    pid: process.pid,
    hostname,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(JSON.stringify(lockData, null, 2), 'utf-8');
    await handle.close();
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EEXIST') {
      const existing = await readLockData(lockPath);
      let mtimeMs = now;
      try {
        const stats = await fs.stat(lockPath);
        mtimeMs = stats.mtimeMs;
      } catch {
        // Ignored if stat fails
      }

      const lockTime = existing?.updatedAt ?? existing?.createdAt ?? mtimeMs;
      const age = Date.now() - lockTime;
      const isSameHost = !existing?.hostname || existing.hostname === hostname;

      // 1. If owner is alive on same host, NEVER reclaim the lock regardless of age
      if (existing?.pid && isSameHost && isProcessAlive(existing.pid)) {
        throw new ConcurrencyLockError(
          `Concurrent local mutation in progress. Active lock held by running process (PID: ${existing.pid}, age: ${age}ms).`
        );
      }

      // 2. Determine if the lock is genuinely stale from a terminated process or expired unparseable state
      const isDeadOwner = existing?.pid && isSameHost && !isProcessAlive(existing.pid);
      const isExpiredOrCorrupt = age > timeoutMs;

      if (isDeadOwner || isExpiredOrCorrupt) {
        try {
          await fs.unlink(lockPath);
        } catch {
          // File may have been unlinked concurrently
        }

        try {
          const handle = await fs.open(lockPath, 'wx');
          await handle.writeFile(JSON.stringify(lockData, null, 2), 'utf-8');
          await handle.close();
        } catch {
          throw new ConcurrencyLockError(
            'Concurrent local mutation in progress. Unable to acquire lock after reclaiming stale lock.'
          );
        }
      } else {
        throw new ConcurrencyLockError(
          `Concurrent local mutation in progress. Active lock detected (age: ${age}ms).`
        );
      }
    } else {
      throw error;
    }
  }

  // Heartbeat lease renewal: refreshes lock's updatedAt periodically
  const heartbeatIntervalMs = Math.max(500, Math.min(5000, Math.floor(timeoutMs / 3)));
  const timer = setInterval(async () => {
    try {
      const current = await readLockData(lockPath);
      if (current?.ownerId === ownerId) {
        current.updatedAt = Date.now();
        await fs.writeFile(lockPath, JSON.stringify(current, null, 2), 'utf-8');
      }
    } catch {
      // Ignore heartbeat update errors
    }
  }, heartbeatIntervalMs);
  timer.unref();

  const releaseFn = async () => {
    clearInterval(timer);
    try {
      const current = await readLockData(lockPath);
      if (current?.ownerId === ownerId) {
        await fs.unlink(lockPath);
      }
    } catch {
      // Ignore cleanup error if already removed
    }
  };

  return Object.assign(releaseFn, { ownerId });
}

/**
 * Idempotently inspects transaction journal and recovers from interrupted writes.
 * If status === 'committed', rolls forward to target generation.
 * If status === 'preparing' or incomplete uncommitted, rolls back cleanly.
 */
export async function recoverRepositoryState(
  baseDir: string,
  options?: RecoverOptions
): Promise<RecoveryResult> {
  const {
    petPath,
    contributionsPath,
    actionsPath,
    journalDir,
    journalMetaPath,
    journalSourceDir,
    journalTargetDir,
    lockPath,
  } = getStatePaths(baseDir);

  // If a lock is currently held, ensure we don't interfere with an active, live process
  const hasLock = await fileExists(lockPath);
  if (hasLock) {
    const currentLock = await readLockData(lockPath);
    if (
      currentLock &&
      currentLock.ownerId !== options?.lockOwnerId &&
      currentLock.pid &&
      (!currentLock.hostname || currentLock.hostname === os.hostname()) &&
      isProcessAlive(currentLock.pid)
    ) {
      throw new ConcurrencyLockError(
        `Concurrent local mutation in progress. Active lock held by running process (PID: ${currentLock.pid}). Cannot perform recovery concurrently.`
      );
    }
  }

  const hasJournalDir = await fileExists(journalDir);

  if (hasJournalDir) {
    const hasJournalMeta = await fileExists(journalMetaPath);

    if (hasJournalMeta) {
      let meta: TransactionJournalMeta | null = null;
      try {
        const raw = await fs.readFile(journalMetaPath, 'utf-8');
        meta = JSON.parse(raw);
      } catch {
        // Corrupted / unparseable meta defaults to null (uncommitted)
        meta = null;
      }

      if (meta && meta.status === 'committed') {
        // Roll forward: target generation MUST have all 3 files
        const targetPetPath = path.join(journalTargetDir, 'pet.json');
        const targetContribPath = path.join(journalTargetDir, 'contributions.json');
        const targetActionsPath = path.join(journalTargetDir, 'actions.json');

        const [hasPet, hasContrib, hasActions] = await Promise.all([
          fileExists(targetPetPath),
          fileExists(targetContribPath),
          fileExists(targetActionsPath),
        ]);

        if (!hasPet || !hasContrib || !hasActions) {
          throw new Error(
            `Recovery Failure: Transaction journal is marked 'committed' (generation ${meta.targetGeneration}), but staged target files in '${journalTargetDir}' are missing or incomplete. Aborting recovery to prevent corrupting state.`
          );
        }

        const [petRaw, contribRaw, actionsRaw] = await Promise.all([
          fs.readFile(targetPetPath, 'utf-8'),
          fs.readFile(targetContribPath, 'utf-8'),
          fs.readFile(targetActionsPath, 'utf-8'),
        ]);

        const targetPet = JSON.parse(petRaw);
        const targetContrib = JSON.parse(contribRaw);
        const targetActions = JSON.parse(actionsRaw);

        if (
          targetPet.generation !== meta.targetGeneration ||
          targetContrib.generation !== meta.targetGeneration ||
          targetActions.generation !== meta.targetGeneration
        ) {
          throw new Error(
            `Recovery Failure: Target documents generation mismatch with committed metadata generation (${meta.targetGeneration}).`
          );
        }

        await Promise.all([
          atomicWriteFile(petPath, petRaw),
          atomicWriteFile(contributionsPath, contribRaw),
          atomicWriteFile(actionsPath, actionsRaw),
        ]);

        await fs.rm(journalDir, { recursive: true, force: true });

        return {
          recovered: true,
          action: 'roll_forward',
          generation: meta.targetGeneration,
          details: `Rolled forward to committed generation ${meta.targetGeneration}.`,
        };
      } else {
        // Uncommitted transaction (status === 'preparing' or corrupt meta): roll back
        const sourcePetPath = path.join(journalSourceDir, 'pet.json');
        const sourceContribPath = path.join(journalSourceDir, 'contributions.json');
        const sourceActionsPath = path.join(journalSourceDir, 'actions.json');

        const [hasSourcePet, hasSourceContrib, hasSourceActions] = await Promise.all([
          fileExists(sourcePetPath),
          fileExists(sourceContribPath),
          fileExists(sourceActionsPath),
        ]);

        if (hasSourcePet && hasSourceContrib && hasSourceActions) {
          const [petRaw, contribRaw, actionsRaw] = await Promise.all([
            fs.readFile(sourcePetPath, 'utf-8'),
            fs.readFile(sourceContribPath, 'utf-8'),
            fs.readFile(sourceActionsPath, 'utf-8'),
          ]);

          const sourcePet = JSON.parse(petRaw);
          const sourceContrib = JSON.parse(contribRaw);
          const sourceActions = JSON.parse(actionsRaw);

          if (
            sourcePet.generation !== sourceContrib.generation ||
            sourcePet.generation !== sourceActions.generation
          ) {
            throw new GenerationMismatchError(
              sourcePet.generation,
              sourceContrib.generation,
              sourceActions.generation
            );
          }

          await Promise.all([
            atomicWriteFile(petPath, petRaw),
            atomicWriteFile(contributionsPath, contribRaw),
            atomicWriteFile(actionsPath, actionsRaw),
          ]);

          await fs.rm(journalDir, { recursive: true, force: true });

          return {
            recovered: true,
            action: 'roll_back',
            generation: sourcePet.generation,
            details: `Rolled back uncommitted staged generation to source generation ${sourcePet.generation}.`,
          };
        }

        // If source backup in journal was incomplete, verify and preserve intact active files
        const [hasActivePet, hasActiveContrib, hasActiveActions] = await Promise.all([
          fileExists(petPath),
          fileExists(contributionsPath),
          fileExists(actionsPath),
        ]);

        if (hasActivePet && hasActiveContrib && hasActiveActions) {
          const [petRaw, contribRaw, actionsRaw] = await Promise.all([
            fs.readFile(petPath, 'utf-8'),
            fs.readFile(contributionsPath, 'utf-8'),
            fs.readFile(actionsPath, 'utf-8'),
          ]);

          const activePet = JSON.parse(petRaw);
          const activeContrib = JSON.parse(contribRaw);
          const activeActions = JSON.parse(actionsRaw);

          if (
            activePet.generation !== activeContrib.generation ||
            activePet.generation !== activeActions.generation
          ) {
            throw new GenerationMismatchError(
              activePet.generation,
              activeContrib.generation,
              activeActions.generation
            );
          }

          await fs.rm(journalDir, { recursive: true, force: true });

          return {
            recovered: true,
            action: 'roll_back',
            generation: activePet.generation,
            details: `Cleaned up uncommitted preparing journal; verified intact active generation ${activePet.generation}.`,
          };
        }

        // No complete source backup and no active files (e.g. crash during brand new initialization)
        await fs.rm(journalDir, { recursive: true, force: true });
        return {
          recovered: false,
          action: 'none',
          generation: 0,
          details: 'Discarded incomplete uncommitted journal with no existing active state.',
        };
      }
    } else {
      // journalDir exists, but meta.json does NOT exist (crashed during boundaries 1 to 6)
      // Transaction was never committed. Active files were not yet modified.
      const [hasActivePet, hasActiveContrib, hasActiveActions] = await Promise.all([
        fileExists(petPath),
        fileExists(contributionsPath),
        fileExists(actionsPath),
      ]);

      if (hasActivePet && hasActiveContrib && hasActiveActions) {
        const [petRaw, contribRaw, actionsRaw] = await Promise.all([
          fs.readFile(petPath, 'utf-8'),
          fs.readFile(contributionsPath, 'utf-8'),
          fs.readFile(actionsPath, 'utf-8'),
        ]);

        const activePet = JSON.parse(petRaw);
        const activeContrib = JSON.parse(contribRaw);
        const activeActions = JSON.parse(actionsRaw);

        if (
          activePet.generation !== activeContrib.generation ||
          activePet.generation !== activeActions.generation
        ) {
          throw new GenerationMismatchError(
            activePet.generation,
            activeContrib.generation,
            activeActions.generation
          );
        }

        await fs.rm(journalDir, { recursive: true, force: true });

        return {
          recovered: true,
          action: 'roll_back',
          generation: activePet.generation,
          details: `Cleaned up incomplete uncommitted journal created before metadata initialization; active generation ${activePet.generation} preserved.`,
        };
      }

      await fs.rm(journalDir, { recursive: true, force: true });
      return {
        recovered: false,
        action: 'none',
        generation: 0,
        details: 'Discarded incomplete uncommitted journal with no active state.',
      };
    }
  }

  // If no journal directory exists, verify current active files
  const [hasPet, hasContrib, hasActions] = await Promise.all([
    fileExists(petPath),
    fileExists(contributionsPath),
    fileExists(actionsPath),
  ]);

  if (hasPet && hasContrib && hasActions) {
    const [petRaw, contributionsRaw, actionsRaw] = await Promise.all([
      fs.readFile(petPath, 'utf-8'),
      fs.readFile(contributionsPath, 'utf-8'),
      fs.readFile(actionsPath, 'utf-8'),
    ]);

    const petData = JSON.parse(petRaw);
    const contributionsData = JSON.parse(contributionsRaw);
    const actionsData = JSON.parse(actionsRaw);

    if (
      petData.generation !== contributionsData.generation ||
      petData.generation !== actionsData.generation
    ) {
      throw new GenerationMismatchError(
        petData.generation,
        contributionsData.generation,
        actionsData.generation
      );
    }

    return {
      recovered: false,
      action: 'none',
      generation: petData.generation,
    };
  }

  return {
    recovered: false,
    action: 'none',
    generation: 0,
  };
}

export async function loadRepositoryState(
  baseDir: string,
  options?: RecoverOptions
): Promise<CompleteRepositoryState> {
  // Idempotently run transaction recovery before loading
  await recoverRepositoryState(baseDir, options);

  const { petPath, contributionsPath, actionsPath } = getStatePaths(baseDir);

  const [petRaw, contributionsRaw, actionsRaw] = await Promise.all([
    fs.readFile(petPath, 'utf-8'),
    fs.readFile(contributionsPath, 'utf-8'),
    fs.readFile(actionsPath, 'utf-8'),
  ]);

  const petData = JSON.parse(petRaw);
  const contributionsData = JSON.parse(contributionsRaw);
  const actionsData = JSON.parse(actionsRaw);

  assertValidPetState(petData);
  assertValidContributionLedger(contributionsData);
  assertValidActionLedger(actionsData);

  if (
    petData.generation !== contributionsData.generation ||
    petData.generation !== actionsData.generation
  ) {
    throw new GenerationMismatchError(
      petData.generation,
      contributionsData.generation,
      actionsData.generation
    );
  }

  return {
    pet: petData,
    contributions: contributionsData,
    actions: actionsData,
    generation: petData.generation,
  };
}

export async function saveRepositoryState(
  baseDir: string,
  state: {
    pet: PetStateDocument;
    contributions: ContributionLedgerDocument;
    actions: ActionLedgerDocument;
  },
  options?: SaveStateOptions
): Promise<void> {
  const { pet, contributions, actions } = state;

  if (
    pet.generation !== contributions.generation ||
    pet.generation !== actions.generation
  ) {
    throw new GenerationMismatchError(
      pet.generation,
      contributions.generation,
      actions.generation
    );
  }

  assertValidPetState(pet);
  assertValidContributionLedger(contributions);
  assertValidActionLedger(actions);

  const paths = getStatePaths(baseDir);

  // 1. Acquire exclusive mutation lock (or reuse existing caller lock)
  const isCallerLock = Boolean(options?.existingLock);
  const releaseLock =
    options?.existingLock ?? (await acquireLock(paths.lockPath, options?.lockTimeoutMs));

  try {
    // 2. Recover any interrupted journal before starting, passing caller's lock ownership
    await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });

    // 3. Optimistic CAS check
    let currentGen = 0;
    const hasActivePet = await fileExists(paths.petPath);
    if (hasActivePet) {
      const activeRaw = await fs.readFile(paths.petPath, 'utf-8');
      const activePet = JSON.parse(activeRaw);
      currentGen = activePet.generation;
    }

    if (
      options?.expectedGeneration !== undefined &&
      currentGen !== options.expectedGeneration
    ) {
      throw new GenerationConflictError(options.expectedGeneration, currentGen);
    }

    // 4. Prepare Journal directories
    await fs.mkdir(paths.journalSourceDir, { recursive: true });
    await fs.mkdir(paths.journalTargetDir, { recursive: true });

    // Copy current active documents to source backup
    if (hasActivePet) {
      const [activePetRaw, activeContribRaw, activeActionsRaw] = await Promise.all([
        fs.readFile(paths.petPath, 'utf-8'),
        fs.readFile(paths.contributionsPath, 'utf-8'),
        fs.readFile(paths.actionsPath, 'utf-8'),
      ]);

      await Promise.all([
        fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), activePetRaw, 'utf-8'),
        fs.writeFile(
          path.join(paths.journalSourceDir, 'contributions.json'),
          activeContribRaw,
          'utf-8'
        ),
        fs.writeFile(
          path.join(paths.journalSourceDir, 'actions.json'),
          activeActionsRaw,
          'utf-8'
        ),
      ]);
    }

    // Stage new generation files in target directory
    const petFormatted = JSON.stringify(pet, null, 2) + '\n';
    const contributionsFormatted = JSON.stringify(contributions, null, 2) + '\n';
    const actionsFormatted = JSON.stringify(actions, null, 2) + '\n';

    await Promise.all([
      atomicWriteFile(path.join(paths.journalTargetDir, 'pet.json'), petFormatted),
      atomicWriteFile(
        path.join(paths.journalTargetDir, 'contributions.json'),
        contributionsFormatted
      ),
      atomicWriteFile(path.join(paths.journalTargetDir, 'actions.json'), actionsFormatted),
    ]);

    // Stage journal metadata as 'preparing'
    const prepMeta: TransactionJournalMeta = {
      sourceGeneration: currentGen,
      targetGeneration: pet.generation,
      status: 'preparing',
      timestamp: new Date().toISOString(),
    };
    await atomicWriteFile(paths.journalMetaPath, JSON.stringify(prepMeta, null, 2) + '\n');

    // 5. ATOMIC COMMIT POINT: transition meta status to 'committed'
    const commitMeta: TransactionJournalMeta = {
      ...prepMeta,
      status: 'committed',
    };
    await atomicWriteFile(paths.journalMetaPath, JSON.stringify(commitMeta, null, 2) + '\n');

    // 6. Replace active files
    await Promise.all([
      atomicWriteFile(paths.petPath, petFormatted),
      atomicWriteFile(paths.contributionsPath, contributionsFormatted),
      atomicWriteFile(paths.actionsPath, actionsFormatted),
    ]);

    // 7. Complete transaction: clean up journal directory
    await fs.rm(paths.journalDir, { recursive: true, force: true });
  } finally {
    // 8. Release lock only if acquired within this call
    if (!isCallerLock) {
      await releaseLock();
    }
  }
}
