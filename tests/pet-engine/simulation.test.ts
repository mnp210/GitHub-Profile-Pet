import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  simulatePet,
  resolveSimulationCheckpoint,
  CorruptedCheckpointError,
  isValidUtcIsoDateString,
  isNewInstallation,
} from '../../src/features/pet-engine/simulation/index.ts';
import {
  saveRepositoryState,
  loadRepositoryState,
  getStatePaths,
  acquireLock,
  ConcurrencyLockError,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import {
  executeCareActionTransaction,
  processInbox,
} from '../../src/features/pet-engine/inbox/index.ts';
import type { GitHubInboxClient } from '../../src/features/pet-engine/inbox/types.ts';
import { README_MARKER_START, README_MARKER_END } from '../../src/features/pet-engine/publication/index.ts';
import { applyInactivitySimulation } from '../../src/features/pet-engine/transitions/simulationTransitions.ts';
import type {
  PetStateDocument,
  ContributionLedgerDocument,
  ActionLedgerDocument,
} from '../../src/features/pet-engine/domain/types.ts';

function createCanonicalPet(overrides: Partial<PetStateDocument> = {}): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 5,
    xp: 250,
    maxExp: 500,
    energy: 50,
    energyAccumulator: 0,
    hunger: 70,
    happiness: 80,
    mood: 'Happy',
    evolutionStage: 'Juvenile',
    lastInteractionTime: '2026-11-15T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T00:00:00.000Z',
    lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T00:00:00.000Z',
    ...overrides,
  };
}

function createCanonicalContributions(generation: number = 1): ContributionLedgerDocument {
  return {
    schemaVersion: 1,
    generation,
    monotonicPublicHwm: 0,
    dailyAccruedXp: {},
    hourlySliceUsage: {},
    slices: [],
    monthlyHistoricalSummary: [],
  };
}

function createCanonicalActions(generation: number = 1): ActionLedgerDocument {
  return {
    schemaVersion: 1,
    generation,
    recentActions: [],
    processedRequestRegistry: {
      highWaterIssueNumber: 0,
      sparseProcessedIssueNumbers: [],
      retiredNonActionGaps: [],
      unresolvedGaps: [],
    },
  };
}

async function createTempRepoDir(petOverrides: Partial<PetStateDocument> = {}): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sim-test-'));
  const pet = createCanonicalPet(petOverrides);
  const contributions = createCanonicalContributions(pet.generation);
  const actions = createCanonicalActions(pet.generation);

  await saveRepositoryState(tmpDir, { pet, contributions, actions });

  const readmeContent = `# My Profile\n\n${README_MARKER_START}\n<img src="./public/pet.svg" />\n${README_MARKER_END}\n\nFooter note.`;
  await fs.writeFile(path.join(tmpDir, 'README.md'), readmeContent, 'utf-8');

  return tmpDir;
}

describe('Passive Pet Simulation & Checkpoint Hardening (Phase 3C1 & 3C1.1)', () => {
  // ==========================================
  // Section 1: Care-Action Integration (Tests 1-5)
  // ==========================================

  it('1. Eight hours offline followed by Feed', async () => {
    // 8 hours = 28,800 seconds.
    // Passive simulation:
    // Energy: +0.05 * 28800 = +1440 -> capped at 100
    // Hunger decays: 28800 * 0.0001 = 2.88 -> floor = 2 (70 - 2 = 68)
    // Happiness decays: 28800 * 0.0001 = 2.88 -> floor = 2 (80 - 2 = 78)
    // Care action: Feed (+24 hunger, +10 XP)
    // Expected final: hunger = 68 + 24 = 92, energy = 100, xp = 250 + 10 = 260
    const tmpDir = await createTempRepoDir({ hunger: 70, energy: 50, xp: 250 });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const actionTimeMs = t0 + 8 * 3600 * 1000;

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: actionTimeMs,
      });

      assert.equal(result.success, true);
      assert.equal(result.simulatedSeconds, 28800);
      assert.equal(result.petState.hunger, 92);
      assert.equal(result.petState.energy, 100);
      assert.equal(result.petState.xp, 260);
      assert.equal(result.petState.lastSimulatedAt, new Date(actionTimeMs).toISOString());
      assert.equal(result.petState.lastInteractionTime, new Date(actionTimeMs).toISOString());
      assert.equal(result.savedGeneration, 2);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.generation, 2);
      assert.equal(onDisk.pet.hunger, 92);
      assert.equal(onDisk.pet.energy, 100);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('2. Eight hours offline followed by Train', async () => {
    // 8 hours:
    // Energy: restores from initial 10 to 100 (+1440 potential)
    // Happiness: decays by 2 (80 - 2 = 78)
    // Care action: Train (costs 18 energy, adds 4 happiness, adds 30 XP)
    // Expected final: energy = 100 - 18 = 82, happiness = 78 + 4 = 82, xp = 250 + 30 = 280
    const tmpDir = await createTempRepoDir({ energy: 10, happiness: 80, xp: 250 });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const actionTimeMs = t0 + 8 * 3600 * 1000;

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'train',
        nowMs: actionTimeMs,
      });

      assert.equal(result.success, true);
      assert.equal(result.simulatedSeconds, 28800);
      assert.equal(result.petState.energy, 82);
      assert.equal(result.petState.happiness, 82);
      assert.equal(result.petState.xp, 280);
      assert.equal(result.petState.lastSimulatedAt, new Date(actionTimeMs).toISOString());
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('3. Eight hours offline followed by Rest', async () => {
    // 8 hours:
    // Energy restores to 100.
    // Care action: Rest restores +25 energy (capped at 100), awards strictly 0 XP.
    const tmpDir = await createTempRepoDir({ energy: 20, xp: 250 });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const actionTimeMs = t0 + 8 * 3600 * 1000;

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'rest',
        nowMs: actionTimeMs,
      });

      assert.equal(result.success, true);
      assert.equal(result.simulatedSeconds, 28800);
      assert.equal(result.petState.energy, 100);
      assert.equal(result.petState.xp, 250); // strictly 0 XP gained
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('4. Eight hours offline followed by Pet', async () => {
    // 8 hours:
    // Happiness decays by 2 (60 - 2 = 58)
    // Care action: Pet adds +12 happiness, awards +6 XP (baseExp = 6)
    // Expected final: happiness = 58 + 12 = 70, xp = 250 + 6 = 256
    const tmpDir = await createTempRepoDir({ happiness: 60, xp: 250 });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const actionTimeMs = t0 + 8 * 3600 * 1000;

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'pet',
        nowMs: actionTimeMs,
      });

      assert.equal(result.success, true);
      assert.equal(result.simulatedSeconds, 28800);
      assert.equal(result.petState.happiness, 70);
      assert.equal(result.petState.xp, 256);
      assert.equal(result.petState.lastSimulatedAt, new Date(actionTimeMs).toISOString());
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('5. Multiple care actions at the same captured timestamp', async () => {
    // Two actions submitted at the exact same timestamp t = t0 + 1h
    const tmpDir = await createTempRepoDir({ hunger: 70 });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const actionTimeMs = t0 + 3600 * 1000;

      // Action 1: Feed -> succeeds
      const res1 = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: actionTimeMs,
        requestId: 'action-1',
      });
      assert.equal(res1.success, true);
      assert.equal(res1.simulatedSeconds, 3600);

      // Action 2: Train at the EXACT SAME timestamp -> rejected due to 60s cooldown!
      const res2 = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'train',
        nowMs: actionTimeMs,
        requestId: 'action-2',
      });
      assert.equal(res2.success, false);
      assert.match(res2.rejectionReason ?? '', /Action Cooldown/i);

      // Verification: State is NOT altered by rejected action 2, and checkpoint remains at actionTimeMs
      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.generation, 2);
      assert.equal(onDisk.pet.lastSimulatedAt, new Date(actionTimeMs).toISOString());
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ==========================================
  // Section 2: Crash Recovery & Durability (Tests 6-8)
  // ==========================================

  it('6. Care action transaction interrupted before commit', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const paths = getStatePaths(tmpDir);

      // Simulate a crashed care transaction at boundary 5 ('preparing' journal)
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      const petData = createCanonicalPet({ generation: 1 });
      const contribData = createCanonicalContributions(1);
      const actionsData = createCanonicalActions(1);

      await Promise.all([
        fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), JSON.stringify(petData), 'utf-8'),
        fs.writeFile(path.join(paths.journalSourceDir, 'contributions.json'), JSON.stringify(contribData), 'utf-8'),
        fs.writeFile(path.join(paths.journalSourceDir, 'actions.json'), JSON.stringify(actionsData), 'utf-8'),
      ]);

      const prepMeta = {
        sourceGeneration: 1,
        targetGeneration: 2,
        status: 'preparing',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(prepMeta), 'utf-8');

      // Now run executeCareActionTransaction — it must roll back to generation 1, then execute feed
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: t0 + 60_000,
      });

      assert.equal(result.success, true);
      assert.equal(result.savedGeneration, 2);

      const stateOnDisk = await loadRepositoryState(tmpDir);
      assert.equal(stateOnDisk.generation, 2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('7. Care action transaction interrupted after commit', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const paths = getStatePaths(tmpDir);

      // Simulate a crashed transaction at boundary 6 ('committed' journal with target generation 2)
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      const targetPet = createCanonicalPet({ generation: 2, energy: 60 });
      const targetContrib = createCanonicalContributions(2);
      const targetActions = createCanonicalActions(2);

      await Promise.all([
        fs.writeFile(path.join(paths.journalTargetDir, 'pet.json'), JSON.stringify(targetPet), 'utf-8'),
        fs.writeFile(path.join(paths.journalTargetDir, 'contributions.json'), JSON.stringify(targetContrib), 'utf-8'),
        fs.writeFile(path.join(paths.journalTargetDir, 'actions.json'), JSON.stringify(targetActions), 'utf-8'),
      ]);

      const commitMeta = {
        sourceGeneration: 1,
        targetGeneration: 2,
        status: 'committed',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(commitMeta), 'utf-8');

      // Execute next action — recovery rolls forward to generation 2, then executes feed to produce generation 3
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: t0 + 120_000,
      });

      assert.equal(result.success, true);
      assert.equal(result.savedGeneration, 3);

      const stateOnDisk = await loadRepositoryState(tmpDir);
      assert.equal(stateOnDisk.generation, 3);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('8. Duplicate action delivery after recovery', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      // Mock client that returns issue #5, which is already marked as processed in registry
      const state = await loadRepositoryState(tmpDir);
      state.actions.processedRequestRegistry.highWaterIssueNumber = 10;
      await saveRepositoryState(tmpDir, state);

      const mockClient: GitHubInboxClient = {
        async listPendingIssues() {
          return [
            {
              number: 5,
              title: '[Care]: Feed Shadow Claw',
              body: '### Action Type\n\nfeed\n\n### Companion Name\n\nShadow Claw',
              state: 'open',
              user: { login: 'trainer', id: 100 },
              labels: [{ name: 'pet-action:pending' }],
              created_at: '2026-11-15T01:00:00.000Z',
              updated_at: '2026-11-15T01:00:00.000Z',
            },
          ];
        },
        async commentIssue() {},
        async closeIssue() {},
        async listIssueComments() {
          return [];
        },
        async getIssue() {
          return { status: 200 };
        },
        async addLabels() {},
        async removeLabel() {},
      };

      const result = await processInbox({
        baseDir: tmpDir,
        client: mockClient,
      });

      assert.equal(result.duplicateCount, 1);
      assert.equal(result.acceptedCount, 0);

      // Verify zero state mutation: generation and pet stats are untouched
      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.generation, 1);
      assert.equal(onDisk.pet.hunger, 70);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ==========================================
  // Section 3: Checkpoint Migration & Corruption (Tests 9-13)
  // ==========================================

  it('9. Missing checkpoint in a new installation', () => {
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();
    // Fresh unevolved new installation
    const newPet = createCanonicalPet({
      generation: 1,
      level: 1,
      xp: 0,
      evolutionStage: 'Hatchling',
      lastSimulatedAt: undefined,
      lastOfflineResolutionTime: undefined as unknown as string,
      updatedAt: undefined as unknown as string,
    });

    assert.equal(isNewInstallation(newPet), true);
    const res = resolveSimulationCheckpoint(newPet, nowMs);

    assert.equal(res.source, 'initialization_now');
    assert.equal(res.checkpointMs, nowMs);
    assert.equal(res.checkpointIso, new Date(nowMs).toISOString());
  });

  it('10. Missing checkpoint in an existing installation', () => {
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();
    // Existing installation (generation 3, level 5) lacking lastSimulatedAt
    const existingPet = createCanonicalPet({
      generation: 3,
      level: 5,
      xp: 250,
      evolutionStage: 'Juvenile',
      lastSimulatedAt: undefined,
      lastOfflineResolutionTime: '2026-11-15T06:00:00.000Z',
      updatedAt: '2026-11-15T06:00:00.000Z',
    });

    assert.equal(isNewInstallation(existingPet), false);
    const res = resolveSimulationCheckpoint(existingPet, nowMs);

    // Safely falls back to trustworthy legacy lastOfflineResolutionTime
    assert.equal(res.source, 'lastOfflineResolutionTime');
    assert.equal(res.checkpointIso, '2026-11-15T06:00:00.000Z');
    assert.equal(res.checkpointMs, new Date('2026-11-15T06:00:00.000Z').getTime());
  });

  it('11. Corrupted checkpoint with valid legacy fallback', () => {
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();
    const petWithCorruptedSim = createCanonicalPet({
      generation: 2,
      lastSimulatedAt: 'invalid-non-date',
      lastOfflineResolutionTime: '2026-11-15T08:00:00.000Z',
      updatedAt: '2026-11-15T08:00:00.000Z',
    });

    const res = resolveSimulationCheckpoint(petWithCorruptedSim, nowMs);
    // Skips corrupted lastSimulatedAt and uses trustworthy legacy fallback
    assert.equal(res.source, 'lastOfflineResolutionTime');
    assert.equal(res.checkpointIso, '2026-11-15T08:00:00.000Z');
  });

  it('12. Corrupted checkpoint without a valid fallback', () => {
    // Validates that strict UTC strings pass, but malformed or non-UTC strings fail
    assert.equal(isValidUtcIsoDateString('2026-11-15T12:00:00.000Z'), true);
    assert.equal(isValidUtcIsoDateString('2026-11-15 12:00:00'), false);

    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();
    const unrecoverablePet = createCanonicalPet({
      generation: 4,
      level: 10,
      xp: 1500,
      evolutionStage: 'Ascended',
      lastSimulatedAt: 'garbage-sim-time',
      lastOfflineResolutionTime: 'garbage-offline-time',
      updatedAt: '2026-11-15 10:00:00', // Non-UTC (missing T and Z)
    });

    // Must fail closed with CorruptedCheckpointError without modifying state
    assert.throws(
      () => resolveSimulationCheckpoint(unrecoverablePet, nowMs),
      (err: unknown) => {
        assert(err instanceof CorruptedCheckpointError);
        assert.equal(err.generation, 4);
        assert.equal(err.petName, 'Shadow Claw');
        return true;
      }
    );
  });

  it('13. Clock regression', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const pastTimeMs = t0 - 3600_000; // 1 hour earlier than checkpoint

      // 1. Simulation clock regression test
      const simResult = await simulatePet({
        baseDir: tmpDir,
        nowMs: pastTimeMs,
      });

      assert.equal(simResult.simulated, false);
      assert.equal(simResult.elapsedSeconds, 0);
      assert.match(simResult.notes, /Clock regression detected/i);

      // 2. Care action clock regression test
      const actionResult = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: pastTimeMs,
      });

      assert.equal(actionResult.success, false);
      assert.match(actionResult.rejectionReason ?? '', /Stale Action/i);

      // Verify checkpoint is untouched
      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.lastSimulatedAt, '2026-11-15T00:00:00.000Z');
      assert.equal(onDisk.generation, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ==========================================
  // Section 4: Concurrency & Serializability (Tests 14-15)
  // ==========================================

  it('14. Concurrent simulation and care-action execution', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const paths = getStatePaths(tmpDir);

      // Step 1: Simulate active process lock held on repository
      const releaseLock = await acquireLock(paths.lockPath);

      // Step 2: While lock is active, another operation attempting to mutate fails closed
      await assert.rejects(
        () => simulatePet({ baseDir: tmpDir, nowMs: Date.now() }),
        (err: unknown) => {
          assert(err instanceof ConcurrencyLockError);
          return true;
        }
      );

      // Step 3: Release lock
      await releaseLock();

      // Step 4: After release, operation succeeds normally
      const simRes = await simulatePet({ baseDir: tmpDir, nowMs: Date.now() });
      assert.equal(typeof simRes.simulated, 'boolean');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('15. Repeated execution after a successful care-action transaction', async () => {
    const tmpDir = await createTempRepoDir({ hunger: 70 });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const actionTimeMs = t0 + 7200 * 1000; // 2 hours

      // Execute care action at actionTimeMs
      const actionRes = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: actionTimeMs,
      });
      assert.equal(actionRes.success, true);
      assert.equal(actionRes.savedGeneration, 2);

      // Immediately run passive simulation at the exact same timestamp
      const simRes = await simulatePet({
        baseDir: tmpDir,
        nowMs: actionTimeMs,
      });

      // Verification: elapsed seconds is strictly 0, simulation is no-op, disk is untouched
      assert.equal(simRes.simulated, false);
      assert.equal(simRes.elapsedSeconds, 0);
      assert.equal(simRes.energyRestored, 0);
      assert.equal(simRes.hungerDecayed, 0);
      assert.equal(simRes.happinessDecayed, 0);
      assert.equal(simRes.savedGeneration, 2);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.generation, 2);
      assert.equal(onDisk.pet.lastSimulatedAt, new Date(actionTimeMs).toISOString());
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ==========================================
  // Section 5: Invariant Preservation
  // ==========================================

  it('16. 30-day absence clamps hunger and happiness at ethical floors without catch-up cap', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const thirtyDaysLater = t0 + 30 * 86400 * 1000;

      const result = await simulatePet({
        baseDir: tmpDir,
        nowMs: thirtyDaysLater,
      });

      assert.equal(result.simulated, true);
      assert.equal(result.elapsedSeconds, 30 * 86400);
      assert.equal(result.energyAfter, 100);
      assert.equal(result.hungerAfter, 20); // Ethical hunger floor
      assert.equal(result.happinessAfter, 40); // Ethical happiness floor
      assert.equal(result.welcomeBackBonusEligible, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('17. Fractional energy precision preserves accumulator and resets when capped', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      const res1 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 10_000 });
      assert.equal(res1.energyAfter, 50);
      assert.equal(res1.energyAccumulatorAfter, 0.5);

      const res2 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 20_000 });
      assert.equal(res2.energyAfter, 51);
      assert.equal(res2.energyAccumulatorAfter, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('18. Zero XP invariant: passive simulation never awards XP or modifies level/evolution', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 10 * 86400 * 1000 });

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.xp, 250);
      assert.equal(onDisk.pet.level, 5);
      assert.equal(onDisk.pet.evolutionStage, 'Juvenile');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('19. Dry-run mode projects simulation without disk modifications or generation change', async () => {
    const tmpDir = await createTempRepoDir();
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const result = await simulatePet({
        baseDir: tmpDir,
        nowMs: t0 + 7200_000,
        dryRun: true,
      });

      assert.equal(result.simulated, true);
      assert.equal(result.savedGeneration, undefined);
      assert.equal(result.svgPublished, false);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.generation, 1);
      assert.equal(onDisk.pet.energy, 50);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('20. Workflow configuration enforces least-privilege, shared concurrency, and hourly cron 47', async () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'pet-publisher.yml');
    const content = await fs.readFile(workflowPath, 'utf-8');

    assert(
      content.includes('permissions:\n  contents: write') ||
        content.includes('permissions:\r\n  contents: write')
    );
    assert(!content.includes('write-all'));
    assert(content.includes('group: pet-runtime-${{ github.repository }}'));
    assert(content.includes('cancel-in-progress: false'));
    assert(content.includes("cron: '47 * * * *'"));
    assert(content.includes('scripts/simulate-pet.ts'));
    assert(content.includes('scripts/publish-pet.ts'));
    assert(content.includes('pet/state/pet.json'));
  });

  // ==========================================
  // Section 4: Phase 3C1.1.1 Numerical Decay Reconciliation
  // ==========================================

  it('21. Exact 1-hour numerical decay reconciliation', () => {
    // 1 hour = 3600 seconds
    // Potential decay: Math.floor(3600 * 0.0001) = Math.floor(0.36) = 0
    // Energy restoration: 3600 * 0.05 = 180 (capped at 100)
    const pet = createCanonicalPet({
      hunger: 70,
      happiness: 80,
      energy: 20,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const nowMs = new Date('2026-11-15T01:00:00.000Z').getTime();

    const result = applyInactivitySimulation(pet, nowMs);
    assert.equal(result.elapsedSeconds, 3600);
    assert.equal(result.hungerDecayed, 0);
    assert.equal(result.happinessDecayed, 0);
    assert.equal(result.nextPetState.hunger, 70);
    assert.equal(result.nextPetState.hungerDecayAccumulator, 0.36);
    assert.equal(result.nextPetState.happiness, 80);
    assert.equal(result.nextPetState.happinessDecayAccumulator, 0.36);
    assert.equal(result.energyRestored, 80); // 20 + 80 = 100
    assert.equal(result.nextPetState.energy, 100);
    assert.equal(result.welcomeBackBonusEligible, false); // < 24h
  });

  it('22. Exact 8-hour numerical decay reconciliation', () => {
    // 8 hours = 28,800 seconds
    // Potential decay: Math.floor(28800 * 0.0001) = Math.floor(2.88) = 2
    // Reconciles authoritative rate (2 points, not 12 points)
    const pet = createCanonicalPet({
      hunger: 70,
      happiness: 80,
      energy: 50,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const nowMs = new Date('2026-11-15T08:00:00.000Z').getTime();

    const result = applyInactivitySimulation(pet, nowMs);
    assert.equal(result.elapsedSeconds, 28800);
    assert.equal(result.hungerDecayed, 2);
    assert.equal(result.happinessDecayed, 2);
    assert.equal(result.nextPetState.hunger, 68);
    assert.equal(result.nextPetState.hungerDecayAccumulator, 0.88);
    assert.equal(result.nextPetState.happiness, 78);
    assert.equal(result.nextPetState.happinessDecayAccumulator, 0.88);
    assert.equal(result.nextPetState.energy, 100);
    assert.equal(result.welcomeBackBonusEligible, false); // < 24h
  });

  it('23. Exact 24-hour numerical decay reconciliation', () => {
    // 24 hours = 86,400 seconds
    // Potential decay: Math.floor(86400 * 0.0001) = Math.floor(8.64) = 8
    const pet = createCanonicalPet({
      hunger: 70,
      happiness: 80,
      energy: 50,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const nowMs = new Date('2026-11-16T00:00:00.000Z').getTime();

    const result = applyInactivitySimulation(pet, nowMs);
    assert.equal(result.elapsedSeconds, 86400);
    assert.equal(result.hungerDecayed, 8);
    assert.equal(result.happinessDecayed, 8);
    assert.equal(result.nextPetState.hunger, 62);
    assert.equal(result.nextPetState.hungerDecayAccumulator, 0.64);
    assert.equal(result.nextPetState.happiness, 72);
    assert.equal(result.nextPetState.happinessDecayAccumulator, 0.64);
    assert.equal(result.welcomeBackBonusEligible, true); // >= 24h
  });

  it('24. Exact 48-hour numerical decay reconciliation', () => {
    // 48 hours = 172,800 seconds
    // Potential decay: Math.floor(172800 * 0.0001) = Math.floor(17.28) = 17
    const pet = createCanonicalPet({
      hunger: 70,
      happiness: 80,
      energy: 50,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const nowMs = new Date('2026-11-17T00:00:00.000Z').getTime();

    const result = applyInactivitySimulation(pet, nowMs);
    assert.equal(result.elapsedSeconds, 172800);
    assert.equal(result.hungerDecayed, 17);
    assert.equal(result.happinessDecayed, 17);
    assert.equal(result.nextPetState.hunger, 53);
    assert.equal(result.nextPetState.hungerDecayAccumulator, 0.28);
    assert.equal(result.nextPetState.happiness, 63);
    assert.equal(result.nextPetState.happinessDecayAccumulator, 0.28);
    assert.equal(result.welcomeBackBonusEligible, true);
  });

  it('25. Exact multi-day interval numerical decay reconciliation (7 days)', () => {
    // 7 days = 604,800 seconds
    // Potential decay: Math.floor(604800 * 0.0001) = Math.floor(60.48) = 60
    // Hunger: 70 - 60 = 10 -> clamped to INACTIVITY_HUNGER_FLOOR (20)
    // Happiness: 80 - 60 = 20 -> clamped to INACTIVITY_HAPPINESS_FLOOR (40)
    const pet = createCanonicalPet({
      hunger: 70,
      happiness: 80,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const nowMs = new Date('2026-11-22T00:00:00.000Z').getTime();

    const result = applyInactivitySimulation(pet, nowMs);
    assert.equal(result.elapsedSeconds, 604800);
    assert.equal(result.nextPetState.hunger, 20); // Clamped at floor
    assert.equal(result.hungerDecayed, 50); // 70 - 20
    assert.equal(result.nextPetState.happiness, 40); // Clamped at floor
    assert.equal(result.happinessDecayed, 40); // 80 - 40
  });

  it('26. Extended absence floor enforcement (30 days)', () => {
    // 30 days = 2,592,000 seconds
    // Potential decay: Math.floor(2592000 * 0.0001) = 259
    // Even starting from 100/100, vitals clamp strictly at 20 and 40
    const pet = createCanonicalPet({
      hunger: 100,
      happiness: 100,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const nowMs = new Date('2026-12-15T00:00:00.000Z').getTime();

    const result = applyInactivitySimulation(pet, nowMs);
    assert.equal(result.nextPetState.hunger, 20);
    assert.equal(result.hungerDecayed, 80);
    assert.equal(result.nextPetState.happiness, 40);
    assert.equal(result.happinessDecayed, 60);
  });

  // ==========================================
  // Section 5: Timestamp Ordering & Monotonicity Verification
  // ==========================================

  it('27. Timestamp ordering: Issue created before current simulation checkpoint cannot rewind checkpoint', async () => {
    // Scheduled simulation ran at 12:00:00Z, setting checkpoint to 12:00:00Z.
    // An issue was created earlier at 10:00:00Z.
    const tmpDir = await createTempRepoDir({
      hunger: 70,
      energy: 50,
      lastSimulatedAt: '2026-11-15T12:00:00.000Z',
      lastOfflineResolutionTime: '2026-11-15T12:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
      updatedAt: '2026-11-15T12:00:00.000Z',
    });
    try {
      const issueTimeMs = new Date('2026-11-15T10:00:00.000Z').getTime();

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: issueTimeMs,
      });

      assert.equal(result.success, true);
      assert.equal(result.simulatedSeconds, 0); // 0 elapsed (regression relative to 12:00Z checkpoint)
      // Feed succeeds: 70 + 24 = 94 hunger
      assert.equal(result.petState.hunger, 94);
      // Crucial: lastSimulatedAt MUST NOT be rewound to 10:00:00Z!
      assert.equal(result.petState.lastSimulatedAt, '2026-11-15T12:00:00.000Z');

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.lastSimulatedAt, '2026-11-15T12:00:00.000Z');
      assert.equal(onDisk.pet.hunger, 94);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('28. Timestamp ordering: Delayed issue processing simulates up to creation time and leaves remaining duration', async () => {
    // Checkpoint at 00:00:00Z. Issue created 8h later (08:00:00Z).
    // Workflow runs at 24:00:00Z.
    const tmpDir = await createTempRepoDir({
      hunger: 70,
      happiness: 80,
      energy: 10,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const issueCreationMs = new Date('2026-11-15T08:00:00.000Z').getTime();

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'train',
        nowMs: issueCreationMs,
      });

      assert.equal(result.success, true);
      assert.equal(result.simulatedSeconds, 28800); // exactly 8 hours simulated
      // 8h simulation: happiness decays by 2 (80 - 2 = 78), energy recovers to 100
      // Train: costs 18 energy (100 - 18 = 82), adds 4 happiness (78 + 4 = 82)
      assert.equal(result.petState.energy, 82);
      assert.equal(result.petState.happiness, 82);
      assert.equal(result.petState.lastSimulatedAt, '2026-11-15T08:00:00.000Z');

      // Now run subsequent simulation at 24:00:00Z (16 hours later = 57,600s)
      // 57600 * 0.0001 = 5.76 + 0.88 (acc from 8h run) = 6.64 -> floor = 6 points decay, 0.64 acc
      const sim2 = await simulatePet({
        baseDir: tmpDir,
        nowMs: new Date('2026-11-16T00:00:00.000Z').getTime(),
      });

      assert.equal(sim2.simulated, true);
      assert.equal(sim2.elapsedSeconds, 57600);
      assert.equal(sim2.hungerBefore - sim2.hungerAfter, 6); // exactly 6 points with accumulated remainder
      assert.equal(sim2.hungerDecayAccumulatorAfter, 0.64);
      assert.equal(sim2.checkpointAfter, '2026-11-16T00:00:00.000Z');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('29. Timestamp ordering: Multiple issues processed in chronological sequence accumulate exact intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 70,
      happiness: 80,
      energy: 50,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
    });
    try {
      // Action 1 at +4h (14,400s -> decay = Math.floor(1.44) = 1)
      const t1 = new Date('2026-11-15T04:00:00.000Z').getTime();
      const res1 = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: t1,
        requestId: 'issue-1',
      });
      assert.equal(res1.success, true);
      assert.equal(res1.simulatedSeconds, 14400);
      // hunger: 70 - 1 + 24 = 93
      assert.equal(res1.petState.hunger, 93);
      assert.equal(res1.petState.lastSimulatedAt, '2026-11-15T04:00:00.000Z');

      // Action 2 at +8h (14,400s -> decay = Math.floor(1.44) = 1)
      const t2 = new Date('2026-11-15T08:00:00.000Z').getTime();
      const res2 = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'pet',
        nowMs: t2,
        requestId: 'issue-2',
      });
      assert.equal(res2.success, true);
      assert.equal(res2.simulatedSeconds, 14400);
      // hunger decays by 1 from 93 -> 92
      assert.equal(res2.petState.hunger, 92);
      assert.equal(res2.petState.lastSimulatedAt, '2026-11-15T08:00:00.000Z');
      // Total decay across both actions: 1 + 1 = 2 (matches 28,800s * 0.0001 = 2)
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('30. Timestamp ordering: Older unresolved issue encountered after newer action already processed is rejected as Stale Action', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 70,
      lastInteractionTime: '2026-11-15T08:00:00.000Z', // already interacted at 08:00Z
      lastSimulatedAt: '2026-11-15T08:00:00.000Z',
    });
    try {
      // Encounter older issue from 04:00Z during gap recovery
      const olderTimeMs = new Date('2026-11-15T04:00:00.000Z').getTime();
      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: olderTimeMs,
        requestId: 'issue-gap-4',
      });

      assert.equal(result.success, false);
      assert(result.rejectionReason?.includes('Stale Action'));
      assert.equal(result.transitionOutcome.reaction, 'Time moves forward, not backward!');

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 70); // zero mutation
      assert.equal(onDisk.pet.lastSimulatedAt, '2026-11-15T08:00:00.000Z'); // checkpoint unrewound
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('31. Production care-action entry point: processInbox acquires lock and rejects concurrent simulation', async () => {
    const tmpDir = await createTempRepoDir();
    const paths = getStatePaths(tmpDir);
    // Acquire lock externally to simulate concurrent runner
    const externalLock = await acquireLock(paths.lockPath);
    try {
      // processInbox must fail fast with ConcurrencyLockError
      await assert.rejects(
        async () => {
          await processInbox({
            baseDir: tmpDir,
            allowAnyAuthor: true,
          });
        },
        (err: unknown) => {
          assert(err instanceof ConcurrencyLockError);
          return true;
        }
      );
    } finally {
      await externalLock();
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ==========================================
  // Section 6: Fractional Decay Conservation (Phase 3C1.1.2)
  // ==========================================

  it('32. One uninterrupted 24-hour interval', async () => {
    // 24h = 86,400s -> 86400 * 0.0001 = 8.64
    // Initial: hunger = 100, happiness = 100, accumulators = 0
    // Expected: hunger = 92, happiness = 92, accumulators = 0.64
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-16T00:00:00.000Z').getTime();
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.simulated, true);
      assert.equal(res.elapsedSeconds, 86400);
      assert.equal(res.hungerAfter, 92);
      assert.equal(res.hungerDecayAccumulatorAfter, 0.64);
      assert.equal(res.happinessAfter, 92);
      assert.equal(res.happinessDecayAccumulatorAfter, 0.64);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 92);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.64);
      assert.equal(onDisk.pet.happiness, 92);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.64);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('33. Twenty-four consecutive one-hour intervals', async () => {
    // 24 x 1h = 24 x 3600s
    // Must produce the exact same final state as 1 uninterrupted 24h run:
    // hunger = 92, happiness = 92, accumulators = 0.64
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      for (let i = 1; i <= 24; i++) {
        const stepMs = t0 + i * 3600 * 1000;
        await simulatePet({ baseDir: tmpDir, nowMs: stepMs });
      }

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 92);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.64);
      assert.equal(onDisk.pet.happiness, 92);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.64);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('34. Two 12-hour intervals', async () => {
    // Interval 1: 12h = 43,200s -> 43200 * 0.0001 = 4.32 (decay 4, acc 0.32, vitals 96)
    // Interval 2: 12h = 43,200s -> 4.32 + 0.32 = 4.64 (decay 4, acc 0.64, vitals 92)
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const res1 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 12 * 3600 * 1000 });
      assert.equal(res1.hungerAfter, 96);
      assert.equal(res1.hungerDecayAccumulatorAfter, 0.32);

      const res2 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 24 * 3600 * 1000 });
      assert.equal(res2.hungerAfter, 92);
      assert.equal(res2.hungerDecayAccumulatorAfter, 0.64);
      assert.equal(res2.happinessAfter, 92);
      assert.equal(res2.happinessDecayAccumulatorAfter, 0.64);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('35. Forty-eight consecutive one-hour intervals', async () => {
    // 48 x 1h = 48 x 3600s = 172,800s -> 172800 * 0.0001 = 17.28
    // Final vitals: 100 - 17 = 83, accumulator = 0.28
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      for (let i = 1; i <= 48; i++) {
        const stepMs = t0 + i * 3600 * 1000;
        await simulatePet({ baseDir: tmpDir, nowMs: stepMs });
      }

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 83);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.28);
      assert.equal(onDisk.pet.happiness, 83);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.28);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('36. Irregular intervals whose sum is exactly 24 hours', async () => {
    // 3.5h (12,600s), 7.25h (26,100s), 1.25h (4,500s), 12h (43,200s) -> sum = 24h
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      let currentMs = t0;
      const stepHours = [3.5, 7.25, 1.25, 12];

      for (const hours of stepHours) {
        currentMs += hours * 3600 * 1000;
        await simulatePet({ baseDir: tmpDir, nowMs: currentMs });
      }

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 92);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.64);
      assert.equal(onDisk.pet.happiness, 92);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.64);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('37. Repeated calls at identical timestamps', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 95,
      hungerDecayAccumulator: 0.45,
      happiness: 90,
      happinessDecayAccumulator: 0.35,
      lastSimulatedAt: '2026-11-15T05:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T05:00:00.000Z').getTime();
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.simulated, false);
      assert.equal(res.elapsedSeconds, 0);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 95);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.45);
      assert.equal(onDisk.pet.happiness, 90);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.35);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('38. Process restart between fractional intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Step 1: Run 1 hour -> acc = 0.36
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 3600 * 1000 });

      // Simulate process restart: completely re-read state from disk
      const diskAfterStep1 = await loadRepositoryState(tmpDir);
      assert.equal(diskAfterStep1.pet.hunger, 100);
      assert.equal(diskAfterStep1.pet.hungerDecayAccumulator, 0.36);

      // Step 2: Next hour -> 0.36 + 0.36 = 0.72
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 7200 * 1000 });

      const diskAfterStep2 = await loadRepositoryState(tmpDir);
      assert.equal(diskAfterStep2.pet.hunger, 100);
      assert.equal(diskAfterStep2.pet.hungerDecayAccumulator, 0.72);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('39. Journal interruption while updating accumulators', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0.36,
      lastSimulatedAt: '2026-11-15T01:00:00.000Z',
    });
    const paths = getStatePaths(tmpDir);
    try {
      // Simulate partial journal write with in-flight preparing state at generation 2
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      const petData = createCanonicalPet({
        generation: 1,
        hunger: 100,
        hungerDecayAccumulator: 0.36,
        lastSimulatedAt: '2026-11-15T01:00:00.000Z',
      });
      const contribData = createCanonicalContributions(1);
      const actionsData = createCanonicalActions(1);

      await Promise.all([
        fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), JSON.stringify(petData), 'utf-8'),
        fs.writeFile(path.join(paths.journalSourceDir, 'contributions.json'), JSON.stringify(contribData), 'utf-8'),
        fs.writeFile(path.join(paths.journalSourceDir, 'actions.json'), JSON.stringify(actionsData), 'utf-8'),
      ]);

      const prepMeta = {
        sourceGeneration: 1,
        targetGeneration: 2,
        status: 'preparing',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(prepMeta), 'utf-8');

      // Next run must recover cleanly without corrupting the accumulator
      const res = await simulatePet({
        baseDir: tmpDir,
        nowMs: new Date('2026-11-15T02:00:00.000Z').getTime(),
      });

      assert.equal(res.simulated, true);
      assert.equal(res.hungerAfter, 100);
      assert.equal(res.hungerDecayAccumulatorAfter, 0.72); // 0.36 + 0.36
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('40. Hunger reaches its floor', async () => {
    // Initial hunger: 22, acc: 0.5.
    // 30,000 seconds decay -> 30,000 * 0.0001 = 3.0 points.
    // 22 - 3.5 = 18.5 -> hits floor 20.
    // Accumulator must reset to 0 (does not accumulate below floor).
    const tmpDir = await createTempRepoDir({
      hunger: 22,
      hungerDecayAccumulator: 0.5,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T00:00:00.000Z').getTime() + 30_000 * 1000;
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.hungerAfter, 20); // Clamped at floor
      assert.equal(res.hungerDecayed, 2); // 22 - 20
      assert.equal(res.hungerDecayAccumulatorAfter, 0); // Residual discarded at floor

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 20);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('41. Happiness reaches its floor', async () => {
    // Initial happiness: 42, acc: 0.5.
    // 30,000 seconds decay -> 3.0 points.
    // 42 - 3.5 = 38.5 -> hits floor 40.
    // Accumulator must reset to 0.
    const tmpDir = await createTempRepoDir({
      happiness: 42,
      happinessDecayAccumulator: 0.5,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T00:00:00.000Z').getTime() + 30_000 * 1000;
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.happinessAfter, 40); // Clamped at floor
      assert.equal(res.happinessDecayed, 2); // 42 - 40
      assert.equal(res.happinessDecayAccumulatorAfter, 0); // Reset to 0

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.happiness, 40);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('42. Care action raises hunger above its floor', async () => {
    // Pet is at floor (hunger: 20, acc: 0).
    // Feed action adds +24 hunger -> 44.
    // Future elapsed time accumulates from 0 without consuming suppressed floor decay.
    const tmpDir = await createTempRepoDir({
      hunger: 20,
      hungerDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Feed at t0
      const feedRes = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: t0,
      });
      assert.equal(feedRes.success, true);
      assert.equal(feedRes.petState.hunger, 44);
      assert.equal(feedRes.petState.hungerDecayAccumulator, 0);

      // Now 1 hour passes (3600s -> 0.36 decay units)
      const simRes = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 3600 * 1000 });
      assert.equal(simRes.hungerAfter, 44); // 0 integer decay
      assert.equal(simRes.hungerDecayAccumulatorAfter, 0.36); // accumulates normally from 0
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('43. Care action raises happiness above its floor', async () => {
    // Pet is at floor (happiness: 40, acc: 0).
    // Pet action adds +12 happiness -> 52.
    // Future elapsed time accumulates from 0 without consuming suppressed floor decay.
    const tmpDir = await createTempRepoDir({
      happiness: 40,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Pet at t0
      const petRes = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'pet',
        nowMs: t0,
      });
      assert.equal(petRes.success, true);
      assert.equal(petRes.petState.happiness, 52);
      assert.equal(petRes.petState.happinessDecayAccumulator, 0);

      // Now 1 hour passes (3600s -> 0.36 decay units)
      const simRes = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 3600 * 1000 });
      assert.equal(simRes.happinessAfter, 52);
      assert.equal(simRes.happinessDecayAccumulatorAfter, 0.36);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('44. Both accumulators remain independent', async () => {
    // Hunger is at 70 (above floor), happiness is at 40 (at floor).
    // After 1 hour: hunger gains 0.36 accumulator; happiness remains 0.
    const tmpDir = await createTempRepoDir({
      hunger: 70,
      hungerDecayAccumulator: 0,
      happiness: 40,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T01:00:00.000Z').getTime();
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.hungerAfter, 70);
      assert.equal(res.hungerDecayAccumulatorAfter, 0.36);
      assert.equal(res.happinessAfter, 40);
      assert.equal(res.happinessDecayAccumulatorAfter, 0); // strictly independent
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('45. Fractional accounting with a delayed scheduled run', async () => {
    // Delayed by 2.5 hours (9,000s -> 0.90 decay units).
    // Followed by standard 1-hour run (3600s -> 0.36 decay units).
    // Cumulative: 0.90 + 0.36 = 1.26 -> 1 integer decay, 0.26 accumulator.
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Delayed run at +2.5h (9,000s)
      const res1 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 9000 * 1000 });
      assert.equal(res1.hungerAfter, 100);
      assert.equal(res1.hungerDecayAccumulatorAfter, 0.9);

      // Next run at +3.5h (+3600s)
      const res2 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 12600 * 1000 });
      assert.equal(res2.hungerAfter, 99); // 1 point integer decay
      assert.equal(res2.hungerDecayAccumulatorAfter, 0.26);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('46. Fractional accounting after a care action', async () => {
    // Pet experiences 1 hour simulation -> hunger: 100, acc: 0.36
    // Care action: Train (costs 18 energy, doesn't touch hunger).
    // Train must preserve hungerDecayAccumulator (0.36).
    // Next 1h simulation accumulates: 0.36 + 0.36 = 0.72.
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      energy: 50,
      hungerDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Run 1h simulation -> acc = 0.36
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 3600 * 1000 });

      // Care action Train at t0 + 3600s
      const trainRes = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'train',
        nowMs: t0 + 3600 * 1000,
      });
      assert.equal(trainRes.success, true);
      assert.equal(trainRes.petState.hungerDecayAccumulator, 0.36); // preserved

      // Run next 1h simulation at t0 + 7200s
      const simRes = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 7200 * 1000 });
      assert.equal(simRes.hungerAfter, 100);
      assert.equal(simRes.hungerDecayAccumulatorAfter, 0.72); // 0.36 + 0.36
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ==========================================
  // Section 7: Sub-Second Elapsed-Time Conservation (Phase 3C1.1.3)
  // ==========================================

  it('47. One uninterrupted 1s interval', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T00:00:01.000Z').getTime(); // +1000 ms
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.simulated, true);
      assert.equal(res.elapsedSeconds, 1);
      assert.equal(res.hungerAfter, 100);
      assert.equal(res.hungerDecayAccumulatorAfter, 0.0001);
      assert.equal(res.happinessAfter, 100);
      assert.equal(res.happinessDecayAccumulatorAfter, 0.0001);
      assert.equal(res.energyAfter, 50);
      assert.equal(res.energyAccumulatorAfter, 0.05);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 100);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.happiness, 100);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.energy, 50);
      assert.equal(onDisk.pet.energyAccumulator, 0.05);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('48. Two consecutive 500-ms intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      const res1 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 500 });
      assert.equal(res1.simulated, true);
      assert.equal(res1.elapsedSeconds, 0.5);
      assert.equal(res1.hungerAfter, 100);
      assert.equal(res1.hungerDecayAccumulatorAfter, 0.00005);
      assert.equal(res1.happinessAfter, 100);
      assert.equal(res1.happinessDecayAccumulatorAfter, 0.00005);
      assert.equal(res1.energyAfter, 50);
      assert.equal(res1.energyAccumulatorAfter, 0.025);

      const res2 = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 1000 });
      assert.equal(res2.simulated, true);
      assert.equal(res2.elapsedSeconds, 0.5);
      assert.equal(res2.hungerAfter, 100);
      assert.equal(res2.hungerDecayAccumulatorAfter, 0.0001);
      assert.equal(res2.happinessAfter, 100);
      assert.equal(res2.happinessDecayAccumulatorAfter, 0.0001);
      assert.equal(res2.energyAfter, 50);
      assert.equal(res2.energyAccumulatorAfter, 0.05);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 100);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.happiness, 100);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.energy, 50);
      assert.equal(onDisk.pet.energyAccumulator, 0.05);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('49. Ten consecutive 100-ms intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      for (let i = 1; i <= 10; i++) {
        await simulatePet({ baseDir: tmpDir, nowMs: t0 + i * 100 });
      }

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 100);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.happiness, 100);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.energy, 50);
      assert.equal(onDisk.pet.energyAccumulator, 0.05);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('50. One hundred consecutive 10-ms intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      for (let i = 1; i <= 100; i++) {
        await simulatePet({ baseDir: tmpDir, nowMs: t0 + i * 10 });
      }

      const onDisk = await loadRepositoryState(tmpDir);
      // Assert 100% identical state across tests 47, 48, 49, and 50!
      assert.equal(onDisk.pet.hunger, 100);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.happiness, 100);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.energy, 50);
      assert.equal(onDisk.pet.energyAccumulator, 0.05);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('51. Mixed sub-second and whole-second intervals totaling 24 hours', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
      let currentMs = t0;
      const intervalsMs = [
        500,
        1500,
        3500,
        4500,
        990,
        10,
        3599000,
        10000000,
        20000000,
        52790000,
      ];
      // Total sum = 86,400,000 ms = 24h
      const totalInterval = intervalsMs.reduce((sum, v) => sum + v, 0);
      assert.equal(totalInterval, 86400 * 1000);

      for (const delta of intervalsMs) {
        currentMs += delta;
        await simulatePet({ baseDir: tmpDir, nowMs: currentMs });
      }

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 92);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.64);
      assert.equal(onDisk.pet.happiness, 92);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.64);
      assert.equal(onDisk.pet.energy, 100);
      assert.equal(onDisk.pet.energyAccumulator, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('52. Uninterrupted 24 hours vs identical mixed sub-second/hourly intervals', async () => {
    const tmpDirA = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    const tmpDirB = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      energy: 50,
      energyAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Run A: Single uninterrupted 24-hour step
      await simulatePet({ baseDir: tmpDirA, nowMs: t0 + 86400 * 1000 });
      const stateA = await loadRepositoryState(tmpDirA);

      // Run B: Mixed sub-second and hourly intervals summing to 24 hours
      let currentMs = t0;
      const intervalsMs = [500, 1500, 3500, 4500, 990, 10, 3599000, 10000000, 20000000, 52790000];
      for (const delta of intervalsMs) {
        currentMs += delta;
        await simulatePet({ baseDir: tmpDirB, nowMs: currentMs });
      }
      const stateB = await loadRepositoryState(tmpDirB);

      // Verify 100% identical state
      assert.equal(stateA.pet.hunger, stateB.pet.hunger);
      assert.equal(stateA.pet.hungerDecayAccumulator, stateB.pet.hungerDecayAccumulator);
      assert.equal(stateA.pet.happiness, stateB.pet.happiness);
      assert.equal(stateA.pet.happinessDecayAccumulator, stateB.pet.happinessDecayAccumulator);
      assert.equal(stateA.pet.energy, stateB.pet.energy);
      assert.equal(stateA.pet.energyAccumulator, stateB.pet.energyAccumulator);
      assert.equal(stateB.pet.hunger, 92);
      assert.equal(stateB.pet.hungerDecayAccumulator, 0.64);
      assert.equal(stateB.pet.happiness, 92);
      assert.equal(stateB.pet.happinessDecayAccumulator, 0.64);
    } finally {
      await fs.rm(tmpDirA, { recursive: true, force: true }).catch(() => {});
      await fs.rm(tmpDirB, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('53. Process restart between sub-second intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0,
      happiness: 100,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Step 1: 500 ms simulation
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 500 });

      // Emulate process restart: fresh load from repository
      const diskAfterStep1 = await loadRepositoryState(tmpDir);
      assert.equal(diskAfterStep1.pet.hunger, 100);
      assert.equal(diskAfterStep1.pet.hungerDecayAccumulator, 0.00005);

      // Step 2: Next 500 ms simulation from cold start
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 1000 });

      const diskAfterStep2 = await loadRepositoryState(tmpDir);
      assert.equal(diskAfterStep2.pet.hunger, 100);
      assert.equal(diskAfterStep2.pet.hungerDecayAccumulator, 0.0001);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('54. Journal interruption and recovery between sub-second intervals', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 100,
      hungerDecayAccumulator: 0.00005,
      lastSimulatedAt: '2026-11-15T00:00:00.500Z',
    });
    const paths = getStatePaths(tmpDir);
    try {
      // Simulate partial journal write during an interrupted sub-second simulation at +750ms
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      const petData = createCanonicalPet({
        generation: 1,
        hunger: 100,
        hungerDecayAccumulator: 0.00005,
        lastSimulatedAt: '2026-11-15T00:00:00.500Z',
      });
      const contribData = createCanonicalContributions(1);
      const actionsData = createCanonicalActions(1);

      await Promise.all([
        fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), JSON.stringify(petData), 'utf-8'),
        fs.writeFile(path.join(paths.journalSourceDir, 'contributions.json'), JSON.stringify(contribData), 'utf-8'),
        fs.writeFile(path.join(paths.journalSourceDir, 'actions.json'), JSON.stringify(actionsData), 'utf-8'),
      ]);

      const prepMeta = {
        sourceGeneration: 1,
        targetGeneration: 2,
        status: 'preparing',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(prepMeta), 'utf-8');

      // Next simulation at +1000ms must recover cleanly and accumulate 500 ms accurately
      const res = await simulatePet({
        baseDir: tmpDir,
        nowMs: new Date('2026-11-15T00:00:01.000Z').getTime(),
      });

      assert.equal(res.simulated, true);
      assert.equal(res.elapsedSeconds, 0.5);
      assert.equal(res.hungerAfter, 100);
      assert.equal(res.hungerDecayAccumulatorAfter, 0.0001); // 0.00005 + 0.00005
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('55. Repeated calls at identical timestamps', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 95,
      hungerDecayAccumulator: 0.00025,
      happiness: 90,
      happinessDecayAccumulator: 0.00015,
      lastSimulatedAt: '2026-11-15T00:00:00.500Z',
    });
    try {
      const nowMs = new Date('2026-11-15T00:00:00.500Z').getTime();
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.simulated, false);
      assert.equal(res.elapsedSeconds, 0);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 95);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.00025);
      assert.equal(onDisk.pet.happiness, 90);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0.00015);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('56. Clock regression', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 95,
      hungerDecayAccumulator: 0.00025,
      happiness: 90,
      happinessDecayAccumulator: 0.00015,
      lastSimulatedAt: '2026-11-15T00:00:01.500Z',
    });
    try {
      // 300 ms earlier than checkpoint
      const earlierMs = new Date('2026-11-15T00:00:01.200Z').getTime();
      const res = await simulatePet({ baseDir: tmpDir, nowMs: earlierMs });

      assert.equal(res.simulated, false);
      assert.equal(res.elapsedSeconds, 0);
      assert(res.notes.includes('Clock regression detected'));

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 95);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.00025);
      assert.equal(onDisk.pet.lastSimulatedAt, '2026-11-15T00:00:01.500Z'); // Not rewound
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('57. Sub-second intervals while at ethical floor', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 20,
      hungerDecayAccumulator: 0,
      happiness: 40,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T00:00:00.500Z').getTime();
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.simulated, true);
      assert.equal(res.elapsedSeconds, 0.5);
      assert.equal(res.hungerAfter, 20); // Held at floor
      assert.equal(res.hungerDecayAccumulatorAfter, 0); // Residual discarded
      assert.equal(res.happinessAfter, 40); // Held at floor
      assert.equal(res.happinessDecayAccumulatorAfter, 0); // Residual discarded

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 20);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0);
      assert.equal(onDisk.pet.happiness, 40);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('58. Care action raising vital above floor after period at floor', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 20,
      hungerDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
    });
    try {
      const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();

      // Sub-second simulation while at floor (discarded)
      await simulatePet({ baseDir: tmpDir, nowMs: t0 + 200 });
      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hunger, 20);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0);

      // Feed care action at t0 + 500 ms raises hunger to 44
      const feedRes = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'feed',
        nowMs: t0 + 500,
      });
      assert.equal(feedRes.success, true);
      assert.equal(feedRes.petState.hunger, 44);
      assert.equal(feedRes.petState.hungerDecayAccumulator, 0);

      // Next sub-second simulation at t0 + 1000 ms (+500ms since feed)
      const simRes = await simulatePet({ baseDir: tmpDir, nowMs: t0 + 1000 });
      assert.equal(simRes.hungerAfter, 44);
      assert.equal(simRes.hungerDecayAccumulatorAfter, 0.00005); // starts clean from 0
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('59. Rejected care action after sub-second interval', async () => {
    const tmpDir = await createTempRepoDir({
      hunger: 70,
      energy: 5, // Insufficient energy for training (requires 18)
      hungerDecayAccumulator: 0.0001,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
    });
    try {
      const actionTimeMs = new Date('2026-11-15T00:00:00.500Z').getTime();

      const result = await executeCareActionTransaction({
        baseDir: tmpDir,
        action: 'train', // will be rejected due to insufficient energy
        nowMs: actionTimeMs,
      });

      assert.equal(result.success, false);
      assert(result.rejectionReason?.includes('Insufficient Energy'));

      const onDisk = await loadRepositoryState(tmpDir);
      // Verify checkpoint DID NOT advance to actionTimeMs
      assert.equal(onDisk.pet.lastSimulatedAt, '2026-11-15T00:00:00.000Z');
      // Verify decay accumulator was NOT mutated
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.0001);
      assert.equal(onDisk.pet.hunger, 70);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('60. Independent hunger and happiness remainder preservation', async () => {
    // Hunger at 80 (acc 0.0001), Happiness at 40 (floor, acc 0)
    const tmpDir = await createTempRepoDir({
      hunger: 80,
      hungerDecayAccumulator: 0.0001,
      happiness: 40,
      happinessDecayAccumulator: 0,
      lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    });
    try {
      const nowMs = new Date('2026-11-15T00:00:00.500Z').getTime(); // +500 ms
      const res = await simulatePet({ baseDir: tmpDir, nowMs });

      assert.equal(res.simulated, true);
      assert.equal(res.elapsedSeconds, 0.5);
      // Hunger accumulates 500 units: 0.0001 + 0.00005 = 0.00015
      assert.equal(res.hungerAfter, 80);
      assert.equal(res.hungerDecayAccumulatorAfter, 0.00015);
      // Happiness remains strictly at floor, accumulator strictly 0
      assert.equal(res.happinessAfter, 40);
      assert.equal(res.happinessDecayAccumulatorAfter, 0);

      const onDisk = await loadRepositoryState(tmpDir);
      assert.equal(onDisk.pet.hungerDecayAccumulator, 0.00015);
      assert.equal(onDisk.pet.happinessDecayAccumulator, 0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
