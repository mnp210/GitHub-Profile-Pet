import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  compactContributionLedger,
  computeExpiryAtForSyncDate,
  getUtcHourKey,
  reconcileContributions,
  verifyAccountingInvariant,
} from '../../src/features/pet-engine/accounting/contributionEngine.ts';
import type {
  ContributionLedgerDocument,
  ContributionSlice,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import {
  loadRepositoryState,
  recoverRepositoryState,
  saveRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';

function createTestPet(generation: number = 1): PetStateDocument {
  return {
    schemaVersion: 1,
    generation,
    name: 'Shadow Claw',
    species: 'cat',
    level: 1,
    xp: 0,
    maxExp: 100,
    energy: 100,
    energyAccumulator: 0,
    hunger: 20,
    happiness: 100,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-15T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T00:00:00.000Z',
  };
}

function createAuditLedger(params?: {
  dailyAccruedXp?: Record<string, number>;
  hourlyIncrementUsage?: Record<string, number>;
  slices?: ContributionSlice[];
  hwm?: Record<string, number>;
  ordinals?: Record<string, number>;
}): ContributionLedgerDocument {
  const syncDate = '2026-11-16';
  return {
    schemaVersion: 1,
    generation: 1,
    ownerDatabaseId: 12345,
    ownerLogin: 'mnp210',
    installationBaseline: {
      completed: true,
      installedAt: '2026-11-15T12:00:00.000Z',
      baselineDateUtc: '2026-11-15',
      initialCounts: { yesterday: 10, today: 14 },
    },
    dailyHwm: params?.hwm ?? { [syncDate]: 100 },
    dailyRewardOrdinal: params?.ordinals ?? { [syncDate]: 100 },
    dailyAccruedXp: params?.dailyAccruedXp ?? {},
    hourlyIncrementUsage: params?.hourlyIncrementUsage ?? {},
    slices: params?.slices ?? [],
    monthlyHistoricalSummary: [],
  };
}

describe('Phase 3C2.2.1-R1 Consistency Audit Test Suite', () => {
  // Scenario 1 & 2: 100 pending increments after daily cap exhaustion & hourly quota consumption
  it('Audit Scenario 1 & 2: 100 pending increments after cap exhaustion and hourly quota consumption', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';
    const expiryAt = computeExpiryAtForSyncDate(syncDate);

    // Create 100 pending slices for 2026-11-16
    const pendingSlices: ContributionSlice[] = [];
    for (let ord = 1; ord <= 100; ord++) {
      pendingSlices.push({
        sliceId: `slice_${syncDate}_ord_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt,
        evaluatedAt: null,
      });
    }

    // Ledger has 300 XP already accrued on 2026-11-16 (daily cap exhausted)
    const ledger = createAuditLedger({
      dailyAccruedXp: { [syncDate]: 300 },
      hwm: { [syncDate]: 150 },
      ordinals: { [syncDate]: 150 },
      slices: pendingSlices,
    });

    const nowMs = new Date('2026-11-16T10:30:00.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 100 }],
      nowMs,
    });

    const hourKey = getUtcHourKey(nowMs);
    const hourlyUsage = result.nextContributionLedger.hourlyIncrementUsage?.[hourKey] || 0;
    const forfeitedCount = result.nextContributionLedger.slices.filter((s) => s.status === 'forfeited').length;
    const remainingPendingCount = result.nextContributionLedger.slices.filter((s) => s.status === 'pending').length;

    // Record observed behaviors under Phase 3C2.2.1-R2 Immediate Cap-Exhaustion Forfeiture:
    // 1. Did cap-exhaustion forfeitures consume hourly quota? Strictly 0 consumed!
    assert.equal(hourlyUsage, 0, 'R2 engine consumes 0 hourly quota units for cap-exhausted bulk forfeitures');
    // 2. All 100 increments were immediately marked forfeited in this single run
    assert.equal(forfeitedCount, 100, 'All 100 increments were marked forfeited in this single run');
    // 3. Exactly 0 increments remain pending
    assert.equal(remainingPendingCount, 0, '0 increments remain in pending status');
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.invariantSatisfied, true);

    // Verify all forfeited slices have correct reason, zero rewards, and preserved ordinals
    const forfeitedSlices = result.nextContributionLedger.slices.filter((s) => s.status === 'forfeited');
    assert.equal(forfeitedSlices.length, 100);
    for (const slice of forfeitedSlices) {
      assert.equal(slice.forfeitureReason, 'daily_cap_exhausted');
      assert.equal(slice.rewardedXp, 0);
      assert.equal(slice.rewardedSatiety, 0);
      assert.ok(slice.dailyOrdinal !== undefined && slice.dailyOrdinal >= 1 && slice.dailyOrdinal <= 100);
      assert.equal(slice.syncDate, syncDate);
    }
  });

  // Scenario 3: Larger increment forfeited while smaller later increment fits
  it('Audit Scenario 3: Larger increment forfeited while smaller later increment fits', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';
    // 290 XP accrued. Allowance = 10 XP
    const ledger = createAuditLedger({
      dailyAccruedXp: { [syncDate]: 290 },
      hwm: { [syncDate]: 0 },
      ordinals: { [syncDate]: 0 },
    });

    // 3 increments discovered:
    // Ordinal 1 (25 XP) -> 25 > 10 -> FORFEITED
    // Ordinal 2 (15 XP) -> 15 > 10 -> FORFEITED
    // Ordinal 3 (10 XP) -> 10 <= 10 -> REWARDED (Reaches 300 XP)
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 3 }],
      nowMs: new Date('2026-11-16T12:00:00.000Z').getTime(),
    });

    const slices = result.nextContributionLedger.slices;
    const s1 = slices.find((s) => s.dailyOrdinal === 1);
    const s2 = slices.find((s) => s.dailyOrdinal === 2);
    const s3 = slices.find((s) => s.dailyOrdinal === 3);

    assert.equal(s1?.status, 'forfeited');
    assert.equal(s1?.forfeitureReason, 'whole_increment_overflow');
    assert.equal(s2?.status, 'forfeited');
    assert.equal(s2?.forfeitureReason, 'whole_increment_overflow');
    assert.equal(s3?.status, 'rewarded');
    assert.equal(s3?.rewardedXp, 10);
    assert.equal(result.totalXpAwarded, 10);
    assert.equal(result.nextContributionLedger.dailyAccruedXp[syncDate], 300);
    assert.equal(result.invariantSatisfied, true);
  });

  // Scenario 4: Daily XP cap remaining enforced after process restart
  it('Audit Scenario 4: Daily XP cap remains strictly enforced after process restart', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-audit-restart-'));
    try {
      const pet = createTestPet(1);
      const syncDate = '2026-11-16';
      const contributions = createAuditLedger({
        dailyAccruedXp: { [syncDate]: 300 },
        hwm: { [syncDate]: 50 },
        ordinals: { [syncDate]: 50 },
      });
      const actions = {
        schemaVersion: 1,
        generation: 1,
        recentActions: [],
        processedRequestRegistry: {
          highWaterIssueNumber: 0,
          sparseProcessedIssueNumbers: [],
          retiredNonActionGaps: [],
          unresolvedGaps: [],
        },
      };

      await saveRepositoryState(tmpDir, { pet, contributions, actions });

      // Restart process: load state from disk
      const loaded = await loadRepositoryState(tmpDir);
      assert.equal(loaded.contributions.dailyAccruedXp[syncDate], 300);

      // Reconcile new increments after restart
      const result = reconcileContributions({
        pet: loaded.pet,
        ledger: loaded.contributions,
        snapshots: [{ date: syncDate, observedTotal: 52 }],
        nowMs: new Date('2026-11-16T15:00:00.000Z').getTime(),
      });

      assert.equal(result.totalXpAwarded, 0);
      assert.equal(result.nextContributionLedger.dailyAccruedXp[syncDate], 300);
      const newSlices = result.nextContributionLedger.slices;
      assert.ok(newSlices.every((s) => s.status === 'forfeited'));
      assert.equal(result.invariantSatisfied, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // Scenario 5: Daily XP cap remaining enforced after monthly compaction
  it('Audit Scenario 5: Daily XP cap remains strictly enforced after monthly compaction', () => {
    const pet = createTestPet();
    const syncDate = '2026-10-31'; // End of previous month
    const expiryAt = computeExpiryAtForSyncDate(syncDate);

    // 300 XP accrued on 2026-10-31
    const finalizedSlice: ContributionSlice = {
      sliceId: 'slice_oct31_ord_1',
      syncDate,
      dailyOrdinal: 1,
      discoveredAt: '2026-10-31T10:00:00.000Z',
      units: 1,
      status: 'rewarded',
      rewardedXp: 25,
      rewardedSatiety: 10,
      expiryAt,
      evaluatedAt: '2026-10-31T10:00:00.000Z',
    };

    const ledger = createAuditLedger({
      dailyAccruedXp: { [syncDate]: 300 },
      hwm: { [syncDate]: 50 },
      ordinals: { [syncDate]: 50 },
      slices: [finalizedSlice],
    });

    // Run monthly compaction for November (cutoff: 2026-11-01)
    const compacted = compactContributionLedger(ledger, new Date('2026-11-01T00:00:00.000Z').getTime());

    // Verified: dailyAccruedXp is preserved on compacted ledger
    assert.equal(compacted.dailyAccruedXp[syncDate], 300);
    assert.equal(compacted.monthlyHistoricalSummary.length, 1);
    assert.equal(compacted.monthlyHistoricalSummary[0].rewardedXp, 25);

    // Reconcile on 2026-10-31 post-compaction: cap of 300 remains enforced!
    const result = reconcileContributions({
      pet,
      ledger: compacted,
      snapshots: [{ date: syncDate, observedTotal: 52 }],
      nowMs: new Date('2026-11-01T12:00:00.000Z').getTime(),
    });

    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.nextContributionLedger.dailyAccruedXp[syncDate], 300);
    assert.equal(result.invariantSatisfied, true);
  });

  // Scenario 6: Pending increments retaining original dates and ordinals after compaction
  it('Audit Scenario 6: Pending increments retain original dates and ordinals after compaction', () => {
    const syncDate = '2026-10-31';
    const expiryAt = computeExpiryAtForSyncDate(syncDate);

    const finalizedSlice: ContributionSlice = {
      sliceId: 'slice_oct_finalized',
      syncDate,
      dailyOrdinal: 1,
      discoveredAt: '2026-10-31T10:00:00.000Z',
      units: 1,
      status: 'rewarded',
      rewardedXp: 25,
      rewardedSatiety: 10,
      expiryAt,
      evaluatedAt: '2026-10-31T10:00:00.000Z',
    };

    const pendingSlice: ContributionSlice = {
      sliceId: 'slice_oct_pending',
      syncDate,
      dailyOrdinal: 2,
      discoveredAt: '2026-10-31T23:55:00.000Z',
      units: 1,
      status: 'pending',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt,
      evaluatedAt: null,
    };

    const ledger = createAuditLedger({
      dailyAccruedXp: { [syncDate]: 25 },
      slices: [finalizedSlice, pendingSlice],
    });

    // Run compaction on Nov 1
    const compacted = compactContributionLedger(ledger, new Date('2026-11-01T00:00:00.000Z').getTime());

    // Verified: finalized slice was compacted, but pending slice is NEVER compacted!
    assert.equal(compacted.slices.length, 1);
    const retainedPending = compacted.slices[0];
    assert.equal(retainedPending.sliceId, 'slice_oct_pending');
    assert.equal(retainedPending.syncDate, '2026-10-31');
    assert.equal(retainedPending.dailyOrdinal, 2);
    assert.equal(retainedPending.status, 'pending');

    // Evaluate retained pending slice in November
    const pet = createTestPet();
    const result = reconcileContributions({
      pet,
      ledger: compacted,
      snapshots: [{ date: '2026-11-01', observedTotal: 0 }],
      nowMs: new Date('2026-11-01T01:00:00.000Z').getTime(),
    });

    const evaluated = result.nextContributionLedger.slices.find((s) => s.sliceId === 'slice_oct_pending');
    assert.equal(evaluated?.status, 'rewarded');
    assert.equal(evaluated?.rewardedXp, 15); // Ordinal 2 awards 15 XP
    // Accrued to original date 2026-10-31
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-10-31'], 40);
    assert.equal(result.invariantSatisfied, true);
  });

  // Scenario 7: Recovery from interrupted compaction/accounting persistence
  it('Audit Scenario 7: Recovery from interrupted compaction/accounting persistence rolls back cleanly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-audit-recovery-'));
    try {
      const pet = createTestPet(1);
      const contributions = createAuditLedger({
        dailyAccruedXp: { '2026-11-16': 60 },
      });
      const actions = {
        schemaVersion: 1,
        generation: 1,
        recentActions: [],
        processedRequestRegistry: {
          highWaterIssueNumber: 0,
          sparseProcessedIssueNumbers: [],
          retiredNonActionGaps: [],
          unresolvedGaps: [],
        },
      };

      await saveRepositoryState(tmpDir, { pet, contributions, actions });

      // Simulate crash during journal preparation of compacted generation 2
      const journalDir = path.join(tmpDir, 'pet', '.journal');
      await fs.mkdir(path.join(journalDir, 'target'), { recursive: true });
      await fs.writeFile(
        path.join(journalDir, 'meta.json'),
        JSON.stringify({
          sourceGeneration: 1,
          targetGeneration: 2,
          status: 'preparing',
          timestamp: new Date().toISOString(),
        }),
        'utf-8'
      );

      const recovery = await recoverRepositoryState(tmpDir);
      assert.equal(recovery.recovered, true);
      assert.equal(recovery.action, 'roll_back');
      assert.equal(recovery.generation, 1);

      const loaded = await loadRepositoryState(tmpDir);
      assert.equal(loaded.generation, 1);
      assert.equal(loaded.contributions.dailyAccruedXp['2026-11-16'], 60);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // Scenario 8: Conservation after bulk forfeiture, if supported
  it('Audit Scenario 8: Unit-level conservation holds under large-volume forfeitures', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';
    const expiryAt = computeExpiryAtForSyncDate(syncDate);

    // Create 150 pending slices
    const pendingSlices: ContributionSlice[] = [];
    for (let ord = 1; ord <= 150; ord++) {
      pendingSlices.push({
        sliceId: `slice_${syncDate}_bulk_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt,
        evaluatedAt: null,
      });
    }

    const ledger = createAuditLedger({
      dailyAccruedXp: { [syncDate]: 300 },
      hwm: { [syncDate]: 150 },
      ordinals: { [syncDate]: 150 },
      slices: pendingSlices,
    });

    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 150 }],
      nowMs: new Date('2026-11-16T10:15:00.000Z').getTime(),
    });

    // Invariant check across all slices
    const inv = verifyAccountingInvariant(result.nextContributionLedger);
    assert.equal(inv.satisfied, true);
    assert.equal(inv.totalObserved, 150);
    assert.equal(inv.breakdown.forfeited + inv.breakdown.pending + inv.breakdown.rewarded + inv.breakdown.expired, 150);
  });
});
