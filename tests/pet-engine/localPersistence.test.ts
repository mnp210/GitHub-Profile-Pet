import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { atomicWriteFile } from '../../src/features/pet-engine/persistence/atomicFileWriter.ts';
import {
  acquireLock,
  ConcurrencyLockError,
  GenerationConflictError,
  GenerationMismatchError,
  getStatePaths,
  loadRepositoryState,
  readLockData,
  recoverRepositoryState,
  saveRepositoryState,
  type TransactionJournalMeta,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import { isRequestProcessed } from '../../src/features/pet-engine/accounting/deduplicationRegistry.ts';
import { applyInactivitySimulation } from '../../src/features/pet-engine/transitions/simulationTransitions.ts';
import type {
  ActionLedgerDocument,
  ContributionLedgerDocument,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';

describe('Local Persistence, Transaction Recovery & Conflict Coordination', () => {
  let testDir: string;

  before(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-persist-'));
  });

  after(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  function createSampleState(gen: number): {
    pet: PetStateDocument;
    contributions: ContributionLedgerDocument;
    actions: ActionLedgerDocument;
  } {
    return {
      pet: {
        schemaVersion: 1,
        generation: gen,
        name: 'Shadow Claw',
        species: 'cat',
        level: 2,
        xp: 20,
        maxExp: 200,
        energy: 90,
        energyAccumulator: 0,
        hunger: 80,
        happiness: 85,
        mood: 'Energetic',
        evolutionStage: 'Hatchling',
        lastInteractionTime: '2026-11-15T12:00:00.000Z',
        lastOfflineResolutionTime: '2026-11-15T12:00:00.000Z',
        lastWelcomeBonusClaimedAt: null,
        updatedAt: '2026-11-15T12:00:00.000Z',
      },
      contributions: {
        schemaVersion: 1,
        generation: gen,
        monotonicPublicHwm: 15,
        dailyAccruedXp: { '2026-11-15': 60 },
        hourlySliceUsage: { '2026-11-15T12': 1 },
        slices: [],
        monthlyHistoricalSummary: [],
      },
      actions: {
        schemaVersion: 1,
        generation: gen,
        recentActions: [{ action: 'feed', timestamp: 1763164800000, requestId: 'issue-5' }],
        processedRequestRegistry: {
          highWaterIssueNumber: 5,
          sparseProcessedIssueNumbers: [],
          retiredNonActionGaps: [],
          unresolvedGaps: [],
        },
      },
    };
  }

  it('TC-PERSIST-01: Atomic file write writes content atomically without leaving tmp files', async () => {
    const targetFile = path.join(testDir, 'atomic-test.txt');
    await atomicWriteFile(targetFile, 'Hello Atomic World');

    const read = await fs.readFile(targetFile, 'utf-8');
    assert.equal(read, 'Hello Atomic World');

    const files = await fs.readdir(testDir);
    const tmpFiles = files.filter((f) => f.includes('.tmp'));
    assert.equal(tmpFiles.length, 0);
  });

  it('TC-PERSIST-02: Saves and loads complete repository state with generation consistency', async () => {
    const state5 = createSampleState(5);
    await saveRepositoryState(testDir, state5);

    const loaded = await loadRepositoryState(testDir);
    assert.equal(loaded.generation, 5);
    assert.equal(loaded.pet.name, 'Shadow Claw');
    assert.equal(loaded.contributions.monotonicPublicHwm, 15);
    assert.equal(loaded.actions.recentActions.length, 1);
  });

  it('TC-PERSIST-03: Throws GenerationMismatchError when document generations do not match and no journal exists', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-mismatch-'));
    try {
      const state = createSampleState(5);
      await saveRepositoryState(isolatedDir, state);

      // Tamper with contributions.json generation to 6 without journal
      const paths = getStatePaths(isolatedDir);
      const raw = await fs.readFile(paths.contributionsPath, 'utf-8');
      const parsed = JSON.parse(raw);
      parsed.generation = 6;
      await fs.writeFile(paths.contributionsPath, JSON.stringify(parsed, null, 2), 'utf-8');

      await assert.rejects(
        async () => {
          await loadRepositoryState(isolatedDir);
        },
        (err: unknown) => {
          assert(err instanceof GenerationMismatchError);
          assert.equal(err.petGeneration, 5);
          assert.equal(err.contributionsGeneration, 6);
          assert.equal(err.actionsGeneration, 5);
          return true;
        }
      );
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-04: Multi-document recovery rolls back uncommitted staged generation after crash during preparing', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-rollback-'));
    try {
      // 1. Establish stable generation 10
      const state10 = createSampleState(10);
      await saveRepositoryState(isolatedDir, state10);

      // 2. Simulate interrupted write of generation 11 in preparing phase
      const paths = getStatePaths(isolatedDir);
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      // Copy gen 10 to source
      await fs.writeFile(
        path.join(paths.journalSourceDir, 'pet.json'),
        JSON.stringify(state10.pet),
        'utf-8'
      );
      await fs.writeFile(
        path.join(paths.journalSourceDir, 'contributions.json'),
        JSON.stringify(state10.contributions),
        'utf-8'
      );
      await fs.writeFile(
        path.join(paths.journalSourceDir, 'actions.json'),
        JSON.stringify(state10.actions),
        'utf-8'
      );

      // Stage gen 11 in target
      const state11 = createSampleState(11);
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'pet.json'),
        JSON.stringify(state11.pet),
        'utf-8'
      );
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'contributions.json'),
        JSON.stringify(state11.contributions),
        'utf-8'
      );
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'actions.json'),
        JSON.stringify(state11.actions),
        'utf-8'
      );

      // Meta is in "preparing" state (NOT committed)
      const meta: TransactionJournalMeta = {
        sourceGeneration: 10,
        targetGeneration: 11,
        status: 'preparing',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(meta), 'utf-8');

      // 3. Run recovery
      const recResult = await recoverRepositoryState(isolatedDir);
      assert.equal(recResult.recovered, true);
      assert.equal(recResult.action, 'roll_back');
      assert.equal(recResult.generation, 10);

      // Active state must be intact generation 10
      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 10);
      assert.equal(loaded.pet.generation, 10);
      assert.equal(loaded.contributions.generation, 10);
      assert.equal(loaded.actions.generation, 10);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-05: Multi-document recovery rolls forward committed generation after crash midway through active replacement', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-rollforward-'));
    try {
      // 1. Establish stable generation 20
      const state20 = createSampleState(20);
      await saveRepositoryState(isolatedDir, state20);

      // 2. Simulate crash after commit point where only pet.json was replaced to gen 21,
      // but contributions and actions are still at gen 20!
      const paths = getStatePaths(isolatedDir);
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      const state21 = createSampleState(21);
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'pet.json'),
        JSON.stringify(state21.pet),
        'utf-8'
      );
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'contributions.json'),
        JSON.stringify(state21.contributions),
        'utf-8'
      );
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'actions.json'),
        JSON.stringify(state21.actions),
        'utf-8'
      );

      // Commit marker exists: status === 'committed'
      const meta: TransactionJournalMeta = {
        sourceGeneration: 20,
        targetGeneration: 21,
        status: 'committed',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(meta), 'utf-8');

      // Replace pet.json to 21 (simulating asymmetric replacement before runner killed)
      await fs.writeFile(paths.petPath, JSON.stringify(state21.pet), 'utf-8');

      // 3. Calling loadRepositoryState should automatically recover and roll forward to 21
      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 21);
      assert.equal(loaded.pet.generation, 21);
      assert.equal(loaded.contributions.generation, 21);
      assert.equal(loaded.actions.generation, 21);

      // Journal should now be cleaned up
      const journalExists = await fs
        .access(paths.journalDir)
        .then(() => true)
        .catch(() => false);
      assert.equal(journalExists, false);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-06: Repeated recovery is completely idempotent', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-idem-'));
    try {
      const state = createSampleState(30);
      await saveRepositoryState(isolatedDir, state);

      const r1 = await recoverRepositoryState(isolatedDir);
      assert.equal(r1.recovered, false);
      assert.equal(r1.generation, 30);

      const r2 = await recoverRepositoryState(isolatedDir);
      assert.equal(r2.recovered, false);
      assert.equal(r2.generation, 30);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-07: Concurrency lock prevents concurrent local mutations', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-lock-'));
    try {
      const state = createSampleState(1);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate an active lock held by another process
      await fs.writeFile(paths.lockPath, JSON.stringify({ pid: 99999, createdAt: Date.now() }));

      // Attempting to save while lock is active should throw ConcurrencyLockError
      await assert.rejects(
        async () => {
          await saveRepositoryState(isolatedDir, createSampleState(2));
        },
        (err: unknown) => {
          assert(err instanceof ConcurrencyLockError);
          assert.match(err.message, /Concurrent local mutation in progress/);
          return true;
        }
      );
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-08: Optimistic CAS check detects generation conflict', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-cas-'));
    try {
      const state = createSampleState(10);
      await saveRepositoryState(isolatedDir, state);

      // Caller expects generation 9 (stale), but actual is 10
      await assert.rejects(
        async () => {
          await saveRepositoryState(isolatedDir, createSampleState(11), { expectedGeneration: 9 });
        },
        (err: unknown) => {
          assert(err instanceof GenerationConflictError);
          assert.equal(err.expectedGeneration, 9);
          assert.equal(err.actualGeneration, 10);
          return true;
        }
      );
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-09: Duplicate requests after recovery are recognized and rejected', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-dedup-'));
    try {
      const state = createSampleState(15);
      // Registry contains issue 42 in processed list
      state.actions.processedRequestRegistry.sparseProcessedIssueNumbers = [42];
      await saveRepositoryState(isolatedDir, state);

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(isRequestProcessed(loaded.actions.processedRequestRegistry, 42), true);
      assert.equal(isRequestProcessed(loaded.actions.processedRequestRegistry, 43), false);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-10: Fractional energy recovery carries across restarts and file reloads', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-restart-energy-'));
    try {
      // 1. Initial pet state: energy 50, accumulator 0, t0 = 0s
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const state = createSampleState(1);
      state.pet.energy = 50;
      state.pet.energyAccumulator = 0;
      state.pet.lastOfflineResolutionTime = '2026-11-15T00:00:00.000Z';
      await saveRepositoryState(isolatedDir, state);

      // 2. Step 1: 10s elapsed -> gain 0.5 -> energy 50, acc 0.5. Save to disk.
      const loaded1 = await loadRepositoryState(isolatedDir);
      const res1 = applyInactivitySimulation(loaded1.pet, t0 + 10_000);
      assert.equal(res1.nextPetState.energy, 50);
      assert.equal(res1.nextPetState.energyAccumulator, 0.5);
      await saveRepositoryState(isolatedDir, {
        pet: { ...res1.nextPetState, generation: 2 },
        contributions: { ...loaded1.contributions, generation: 2 },
        actions: { ...loaded1.actions, generation: 2 },
      });

      // 3. Step 2 (Simulating fresh process restart): reload from disk
      const loaded2 = await loadRepositoryState(isolatedDir);
      assert.equal(loaded2.pet.energy, 50);
      assert.equal(loaded2.pet.energyAccumulator, 0.5);

      // Another 10s elapsed -> gain 0.5 + 0.5 = 1.0 -> energy 51, acc 0.0
      const res2 = applyInactivitySimulation(loaded2.pet, t0 + 20_000);
      assert.equal(res2.nextPetState.energy, 51);
      assert.equal(res2.nextPetState.energyAccumulator, 0.0);
      assert.equal(res2.energyRestored, 1);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-11: Active-owner protection prevents reclaiming lock of live process even if age exceeds timeout', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-active-lock-'));
    try {
      const state = createSampleState(1);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate an old lock (> 30s) held by the current running process (which is definitely alive!)
      const oldTime = Date.now() - 45_000;
      await fs.writeFile(
        paths.lockPath,
        JSON.stringify({
          ownerId: 'active-owner-token',
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: oldTime,
          updatedAt: oldTime,
        })
      );

      // Attempting to acquire lock or save state must throw ConcurrencyLockError and NOT reclaim
      await assert.rejects(
        async () => {
          await saveRepositoryState(isolatedDir, createSampleState(2), { lockTimeoutMs: 30_000 });
        },
        (err: unknown) => {
          assert(err instanceof ConcurrencyLockError);
          assert.match(err.message, /Active lock held by running process/);
          return true;
        }
      );

      // Lock file must still exist and belong to the active owner
      const lockData = await readLockData(paths.lockPath);
      assert.equal(lockData?.ownerId, 'active-owner-token');
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-12: Genuinely stale lock from terminated process is safely reclaimed after timeout', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-stale-lock-'));
    try {
      const state = createSampleState(1);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate a lock held by a dead process PID (999999) older than timeout
      const oldTime = Date.now() - 40_000;
      await fs.writeFile(
        paths.lockPath,
        JSON.stringify({
          ownerId: 'dead-process-token',
          pid: 999999,
          hostname: os.hostname(),
          createdAt: oldTime,
          updatedAt: oldTime,
        })
      );

      // Saving state must detect that PID 999999 is dead, reclaim the lock, and successfully commit
      await saveRepositoryState(isolatedDir, createSampleState(2), { lockTimeoutMs: 30_000 });

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 2);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-13: Lock release verifies ownership and never releases a lock owned by another process', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-safe-release-'));
    try {
      const paths = getStatePaths(isolatedDir);
      // Process A acquires lock
      const releaseA = await acquireLock(paths.lockPath, 30_000);
      assert(typeof releaseA.ownerId === 'string');

      // Simulate lock file being replaced by Process B (with different ownerId)
      await fs.writeFile(
        paths.lockPath,
        JSON.stringify({
          ownerId: 'process-b-token',
          pid: process.pid,
          hostname: os.hostname(),
          createdAt: Date.now(),
        })
      );

      // Process A calls its release function
      await releaseA();

      // Process B's lock must still exist on disk untouched!
      const lockData = await readLockData(paths.lockPath);
      assert.equal(lockData?.ownerId, 'process-b-token');

      // Cleanup
      await fs.unlink(paths.lockPath);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-14: Interrupted at Boundary 1 (empty journalDir exists, no meta.json) cleans up journal and preserves state', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-bound1-'));
    try {
      const state = createSampleState(5);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate crash right after journalDir was created
      await fs.mkdir(paths.journalDir, { recursive: true });

      const res = await recoverRepositoryState(isolatedDir);
      assert.equal(res.recovered, true);
      assert.equal(res.action, 'roll_back');
      assert.equal(res.generation, 5);

      // journalDir should be removed
      const journalExists = await fs.access(paths.journalDir).then(() => true).catch(() => false);
      assert.equal(journalExists, false);

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 5);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-15: Interrupted at Boundary 2/3 (source backup in journal, no meta.json) discards uncommitted journal', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-bound2-'));
    try {
      const state = createSampleState(7);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate crash after source backup was partially or fully written, but before meta.json
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), JSON.stringify(state.pet));

      const res = await recoverRepositoryState(isolatedDir);
      assert.equal(res.recovered, true);
      assert.equal(res.action, 'roll_back');
      assert.equal(res.generation, 7);

      const journalExists = await fs.access(paths.journalDir).then(() => true).catch(() => false);
      assert.equal(journalExists, false);

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 7);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-16: Interrupted at Boundary 4/5/6 (target generation staged, no meta.json) never treats uncommitted target as committed', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-bound4-'));
    try {
      const state = createSampleState(8);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate crash after target files were staged for generation 9, but before meta.json was written
      await fs.mkdir(paths.journalTargetDir, { recursive: true });
      const stagedTarget = createSampleState(9);
      await fs.writeFile(path.join(paths.journalTargetDir, 'pet.json'), JSON.stringify(stagedTarget.pet));
      await fs.writeFile(path.join(paths.journalTargetDir, 'contributions.json'), JSON.stringify(stagedTarget.contributions));
      await fs.writeFile(path.join(paths.journalTargetDir, 'actions.json'), JSON.stringify(stagedTarget.actions));

      const res = await recoverRepositoryState(isolatedDir);
      assert.equal(res.recovered, true);
      assert.equal(res.action, 'roll_back');
      // Must NOT be rolled forward to 9; must remain 8!
      assert.equal(res.generation, 8);

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 8);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-17: Interrupted at Boundary 7 (corrupt or unparseable meta.json) rolls back safely to source generation', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-bound7-'));
    try {
      const state = createSampleState(12);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate crash while writing meta.json (corrupted file) with source backup present
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), JSON.stringify(state.pet));
      await fs.writeFile(path.join(paths.journalSourceDir, 'contributions.json'), JSON.stringify(state.contributions));
      await fs.writeFile(path.join(paths.journalSourceDir, 'actions.json'), JSON.stringify(state.actions));
      await fs.writeFile(paths.journalMetaPath, '{"status": "prep...TRUNCATED_CORRUPT_DATA');

      const res = await recoverRepositoryState(isolatedDir);
      assert.equal(res.recovered, true);
      assert.equal(res.action, 'roll_back');
      assert.equal(res.generation, 12);

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 12);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-18: Interrupted at Boundary 10 (cleanup phase: meta.json deleted but journal dir remnants remain) cleans remnants', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-bound10-'));
    try {
      const state = createSampleState(20);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate crash during journal cleanup: meta.json unlinked, but empty subdirectories remain
      await fs.mkdir(path.join(paths.journalDir, 'target'), { recursive: true });

      const res = await recoverRepositoryState(isolatedDir);
      assert.equal(res.recovered, true);
      assert.equal(res.action, 'roll_back');
      assert.equal(res.generation, 20);

      const journalExists = await fs.access(paths.journalDir).then(() => true).catch(() => false);
      assert.equal(journalExists, false);

      const loaded = await loadRepositoryState(isolatedDir);
      assert.equal(loaded.generation, 20);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });

  it('TC-PERSIST-19: Unsafe recovery guard throws explicit error if meta is committed but target files are missing', async () => {
    const isolatedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-engine-unsafe-guard-'));
    try {
      const state = createSampleState(15);
      await saveRepositoryState(isolatedDir, state);

      const paths = getStatePaths(isolatedDir);
      // Simulate corrupted journal where meta is committed to gen 16, but target files are missing
      await fs.mkdir(paths.journalDir, { recursive: true });
      await fs.writeFile(
        paths.journalMetaPath,
        JSON.stringify({
          sourceGeneration: 15,
          targetGeneration: 16,
          status: 'committed',
          timestamp: new Date().toISOString(),
        })
      );

      // Recovery must fail explicitly with an Error rather than destroying active files or writing partial data
      await assert.rejects(
        async () => {
          await recoverRepositoryState(isolatedDir);
        },
        (err: unknown) => {
          assert(err instanceof Error);
          assert.match(err.message, /Recovery Failure/);
          assert.match(err.message, /target files.*missing/);
          return true;
        }
      );

      // Active state must remain completely uncorrupted at generation 15
      const activeRaw = await fs.readFile(paths.petPath, 'utf-8');
      assert.equal(JSON.parse(activeRaw).generation, 15);
    } finally {
      await fs.rm(isolatedDir, { recursive: true, force: true });
    }
  });
});
