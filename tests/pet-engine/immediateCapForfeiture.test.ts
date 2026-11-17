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
  saveRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import { validateContributionLedger } from '../../src/features/pet-engine/validation/ledgerValidator.ts';

function createTestPet(): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
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

function createEstablishedLedger(params?: {
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

describe('Phase 3C2.2.1-R2 Immediate Cap-Exhaustion Forfeiture Test Suite', () => {
  // Test 1: 100 pending increments with date at 300 XP immediately forfeit in 1 single run with 0 quota consumed
  it('1. 100 pending increments with date at 300 XP forfeit immediately in 1 run with 0 hourly quota consumed', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';
    const expiryAt = computeExpiryAtForSyncDate(syncDate);

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

    const ledger = createEstablishedLedger({
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
    const forfeitedSlices = result.nextContributionLedger.slices.filter((s) => s.status === 'forfeited');
    const remainingPending = result.nextContributionLedger.slices.filter((s) => s.status === 'pending');

    // Invariant: zero hourly quota consumed by bulk forfeitures
    assert.equal(hourlyUsage, 0, 'Zero hourly quota consumed by cap-exhausted bulk forfeitures');
    assert.equal(result.incrementsEvaluatedThisRun, 0, 'No ordinary increment evaluation occurred');

    // Invariant: all 100 transitioned to forfeited immediately
    assert.equal(forfeitedSlices.length, 100, 'All 100 increments transitioned to forfeited');
    assert.equal(remainingPending.length, 0, 'Zero pending increments remain');
    assert.equal(result.totalXpAwarded, 0, 'Zero XP awarded');
    assert.equal(result.totalSatietyAwarded, 0, 'Zero satiety awarded');
    assert.equal(result.invariantSatisfied, true, 'Accounting conservation invariant satisfied');

    // Invariant: each slice retains original date & ordinal, has 0 rewards, and explicit reason
    for (const slice of forfeitedSlices) {
      assert.equal(slice.syncDate, syncDate);
      assert.ok(slice.dailyOrdinal !== undefined && slice.dailyOrdinal >= 1 && slice.dailyOrdinal <= 100);
      assert.equal(slice.rewardedXp, 0);
      assert.equal(slice.rewardedSatiety, 0);
      assert.equal(slice.forfeitureReason, 'daily_cap_exhausted');
      assert.equal(slice.evaluatedAt, new Date(nowMs).toISOString());
    }
  });

  // Test 2: Non-blocking multi-day processing
  it('2. Bulk-forfeited increments from exhausted date do not block newer date evaluation', () => {
    const pet = createTestPet();
    const day1 = '2026-11-15';
    const day2 = '2026-11-16';

    const day1Slices: ContributionSlice[] = [];
    for (let ord = 1; ord <= 50; ord++) {
      day1Slices.push({
        sliceId: `slice_${day1}_ord_${ord}`,
        syncDate: day1,
        dailyOrdinal: ord,
        discoveredAt: '2026-11-15T10:00:00.000Z',
        units: 1,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(day1),
        evaluatedAt: null,
      });
    }

    const day2Slices: ContributionSlice[] = [];
    for (let ord = 1; ord <= 8; ord++) {
      day2Slices.push({
        sliceId: `slice_${day2}_ord_${ord}`,
        syncDate: day2,
        dailyOrdinal: ord,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(day2),
        evaluatedAt: null,
      });
    }

    const ledger = createEstablishedLedger({
      dailyAccruedXp: { [day1]: 300, [day2]: 0 },
      hwm: { [day1]: 50, [day2]: 8 },
      ordinals: { [day1]: 50, [day2]: 8 },
      slices: [...day1Slices, ...day2Slices],
    });

    const nowMs = new Date('2026-11-16T10:30:00.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [
        { date: day1, observedTotal: 50 },
        { date: day2, observedTotal: 8 },
      ],
      nowMs,
    });

    const hourKey = getUtcHourKey(nowMs);
    const hourlyUsage = result.nextContributionLedger.hourlyIncrementUsage?.[hourKey] || 0;

    // Day 1 should be completely forfeited
    const day1Final = result.nextContributionLedger.slices.filter((s) => s.syncDate === day1);
    assert.equal(day1Final.length, 50);
    assert.ok(day1Final.every((s) => s.status === 'forfeited' && s.forfeitureReason === 'daily_cap_exhausted'));

    // Day 2 should have 5 increments evaluated (consumed hourly quota) and 3 remaining pending
    const day2Rewarded = result.nextContributionLedger.slices.filter((s) => s.syncDate === day2 && s.status === 'rewarded');
    const day2Pending = result.nextContributionLedger.slices.filter((s) => s.syncDate === day2 && s.status === 'pending');
    assert.equal(day2Rewarded.length, 5, 'Exactly 5 Day 2 increments evaluated');
    assert.equal(day2Pending.length, 3, 'Remaining 3 Day 2 increments deferred to next hour');
    assert.equal(hourlyUsage, 5, 'Exactly 5 hourly quota consumed by Day 2');
    assert.equal(result.incrementsEvaluatedThisRun, 5);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 3: Mid-run cap reach immediately forfeits subsequent increments of same date
  it('3. Reaching 300 XP during a run immediately transitions subsequent increments to forfeited', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';

    // 295 XP already accrued on 2026-11-16. Allowance = 5 XP.
    // 5 increments in queue:
    // Ordinal 4: 5 XP -> fits! Reaches 300 XP.
    // Ordinals 5, 6, 7, 8: should immediately bulk-forfeit as daily_cap_exhausted without consuming quota!
    const pendingSlices: ContributionSlice[] = [];
    for (let ord = 4; ord <= 8; ord++) {
      pendingSlices.push({
        sliceId: `slice_${syncDate}_ord_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: null,
      });
    }

    const ledger = createEstablishedLedger({
      dailyAccruedXp: { [syncDate]: 295 },
      hwm: { [syncDate]: 8 },
      ordinals: { [syncDate]: 8 },
      slices: pendingSlices,
    });

    const nowMs = new Date('2026-11-16T10:30:00.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 8 }],
      nowMs,
    });

    const hourKey = getUtcHourKey(nowMs);
    const hourlyUsage = result.nextContributionLedger.hourlyIncrementUsage?.[hourKey] || 0;

    // Only ordinal 4 consumed hourly quota (1 unit)
    assert.equal(hourlyUsage, 1, 'Only the rewarded increment consumed hourly quota');
    assert.equal(result.incrementsEvaluatedThisRun, 1);
    assert.equal(result.totalXpAwarded, 5);
    assert.equal(result.nextContributionLedger.dailyAccruedXp[syncDate], 300);

    const s4 = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 4);
    assert.equal(s4?.status, 'rewarded');
    assert.equal(s4?.rewardedXp, 5);

    // Ordinals 5, 6, 7, 8 must all be forfeited with daily_cap_exhausted
    for (let ord = 5; ord <= 8; ord++) {
      const s = result.nextContributionLedger.slices.find((sl) => sl.dailyOrdinal === ord);
      assert.equal(s?.status, 'forfeited');
      assert.equal(s?.forfeitureReason, 'daily_cap_exhausted');
      assert.equal(s?.rewardedXp, 0);
    }

    assert.equal(result.invariantSatisfied, true);
  });

  // Test 4: Date at 290 XP evaluates individually under whole-increment overflow
  it('4. Date at 290 XP evaluates individually, whole-increment overflow consumes quota, and does not bulk-forfeit early', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';

    // 290 XP accrued. Allowance = 10 XP.
    // Ordinal 1 (25 XP) -> 25 > 10 -> whole_increment_overflow (forfeited, quota 1, accrued XP stays 290)
    // Ordinal 2 (15 XP) -> 15 > 10 -> whole_increment_overflow (forfeited, quota 2, accrued XP stays 290)
    // Ordinal 3 (10 XP) -> 10 <= 10 -> rewarded 10 XP (reaches 300 XP, quota 3)
    // Ordinal 4 (5 XP) -> cap is now 300! -> daily_cap_exhausted (forfeited, 0 quota consumed)
    // Ordinal 5 (5 XP) -> cap is 300! -> daily_cap_exhausted (forfeited, 0 quota consumed)
    const pendingSlices: ContributionSlice[] = [];
    for (let ord = 1; ord <= 5; ord++) {
      pendingSlices.push({
        sliceId: `slice_${syncDate}_ord_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'pending',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: null,
      });
    }

    const ledger = createEstablishedLedger({
      dailyAccruedXp: { [syncDate]: 290 },
      hwm: { [syncDate]: 5 },
      ordinals: { [syncDate]: 5 },
      slices: pendingSlices,
    });

    const nowMs = new Date('2026-11-16T10:30:00.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 5 }],
      nowMs,
    });

    const hourKey = getUtcHourKey(nowMs);
    const hourlyUsage = result.nextContributionLedger.hourlyIncrementUsage?.[hourKey] || 0;

    // Exactly 3 quota units consumed: ordinals 1, 2, 3
    assert.equal(hourlyUsage, 3, 'Ordinals 1, 2, and 3 consumed hourly quota');
    assert.equal(result.incrementsEvaluatedThisRun, 3);
    assert.equal(result.totalXpAwarded, 10);
    assert.equal(result.nextContributionLedger.dailyAccruedXp[syncDate], 300);

    const s1 = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 1);
    const s2 = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 2);
    const s3 = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 3);
    const s4 = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 4);
    const s5 = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 5);

    assert.equal(s1?.status, 'forfeited');
    assert.equal(s1?.forfeitureReason, 'whole_increment_overflow');

    assert.equal(s2?.status, 'forfeited');
    assert.equal(s2?.forfeitureReason, 'whole_increment_overflow');

    assert.equal(s3?.status, 'rewarded');
    assert.equal(s3?.rewardedXp, 10);

    assert.equal(s4?.status, 'forfeited');
    assert.equal(s4?.forfeitureReason, 'daily_cap_exhausted');

    assert.equal(s5?.status, 'forfeited');
    assert.equal(s5?.forfeitureReason, 'daily_cap_exhausted');

    assert.equal(result.invariantSatisfied, true);
  });

  // Test 5: Expired slices retain 'expired' status and are never marked forfeited
  it('5. Expired slices retain status "expired" even if date is at cap', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-10'; // Older date
    const expiryAt = '2026-11-12T00:00:00.000Z'; // Already expired

    const slice: ContributionSlice = {
      sliceId: `slice_${syncDate}_ord_1`,
      syncDate,
      dailyOrdinal: 1,
      discoveredAt: '2026-11-10T05:00:00.000Z',
      units: 1,
      status: 'pending',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt,
      evaluatedAt: null,
    };

    const ledger = createEstablishedLedger({
      dailyAccruedXp: { [syncDate]: 300 }, // Cap is exhausted
      hwm: { [syncDate]: 1 },
      ordinals: { [syncDate]: 1 },
      slices: [slice],
    });

    const nowMs = new Date('2026-11-16T10:00:00.000Z').getTime(); // Well past expiry
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 1 }],
      nowMs,
    });

    const evaluatedSlice = result.nextContributionLedger.slices[0];
    assert.equal(evaluatedSlice.status, 'expired', 'Expired status takes precedence over cap exhaustion');
    assert.equal(evaluatedSlice.forfeitureReason, undefined, 'No forfeiture reason for expired slice');
    assert.equal(result.pendingSlicesExpired, 1);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 6: Permanent terminal status across repeated syncs
  it('6. Bulk-forfeited slices are never re-awarded on subsequent syncs or new dates', () => {
    const pet = createTestPet();
    const syncDate = '2026-11-16';

    const slice: ContributionSlice = {
      sliceId: `slice_${syncDate}_ord_1`,
      syncDate,
      dailyOrdinal: 1,
      discoveredAt: '2026-11-16T10:00:00.000Z',
      units: 1,
      status: 'forfeited',
      forfeitureReason: 'daily_cap_exhausted',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt: computeExpiryAtForSyncDate(syncDate),
      evaluatedAt: '2026-11-16T10:05:00.000Z',
    };

    const ledger = createEstablishedLedger({
      dailyAccruedXp: { [syncDate]: 300, '2026-11-17': 0 },
      hwm: { [syncDate]: 1 },
      ordinals: { [syncDate]: 1 },
      slices: [slice],
    });

    // Run reconciliation on the next day with 0 XP accrued
    const nextDayMs = new Date('2026-11-17T10:00:00.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [
        { date: syncDate, observedTotal: 1 },
        { date: '2026-11-17', observedTotal: 0 },
      ],
      nowMs: nextDayMs,
    });

    const historicalSlice = result.nextContributionLedger.slices.find((s) => s.sliceId === slice.sliceId);
    assert.equal(historicalSlice?.status, 'forfeited');
    assert.equal(historicalSlice?.forfeitureReason, 'daily_cap_exhausted');
    assert.equal(historicalSlice?.rewardedXp, 0);
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 7: Persistence and load durability of forfeiture reason
  it('7. Ledger with forfeitureReason persists and reloads cleanly via stateRepository', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-r2-persistence-'));
    try {
      const pet = createTestPet();
      const syncDate = '2026-11-16';

      const slice1: ContributionSlice = {
        sliceId: `slice_${syncDate}_ord_1`,
        syncDate,
        dailyOrdinal: 1,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'forfeited',
        forfeitureReason: 'daily_cap_exhausted',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: '2026-11-16T10:05:00.000Z',
      };

      const slice2: ContributionSlice = {
        sliceId: `slice_${syncDate}_ord_2`,
        syncDate,
        dailyOrdinal: 2,
        discoveredAt: '2026-11-16T10:00:00.000Z',
        units: 1,
        status: 'forfeited',
        forfeitureReason: 'whole_increment_overflow',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: '2026-11-16T10:05:00.000Z',
      };

      const ledger = createEstablishedLedger({
        dailyAccruedXp: { [syncDate]: 300 },
        hwm: { [syncDate]: 2 },
        ordinals: { [syncDate]: 2 },
        slices: [slice1, slice2],
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

      await saveRepositoryState(tmpDir, { pet, contributions: ledger, actions });
      const loaded = await loadRepositoryState(tmpDir);

      assert.equal(loaded.contributions.slices.length, 2);
      assert.equal(loaded.contributions.slices[0].forfeitureReason, 'daily_cap_exhausted');
      assert.equal(loaded.contributions.slices[1].forfeitureReason, 'whole_increment_overflow');

      const validation = validateContributionLedger(loaded.contributions);
      assert.equal(validation.valid, true, `Validation failed: ${validation.errors.join(', ')}`);
      assert.equal(verifyAccountingInvariant(loaded.contributions).satisfied, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // Test 8: Compaction consistency with bulk-forfeited slices
  it('8. Monthly compaction accurately aggregates bulk-forfeited slices into forfeitedUnits', () => {
    const syncDate = '2026-10-15'; // Prior month
    const slices: ContributionSlice[] = [];

    // 10 rewarded, 20 bulk-forfeited, 5 expired
    for (let ord = 1; ord <= 10; ord++) {
      slices.push({
        sliceId: `slice_${syncDate}_ord_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: `${syncDate}T10:00:00.000Z`,
        units: 1,
        status: 'rewarded',
        rewardedXp: 5,
        rewardedSatiety: 1,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: `${syncDate}T10:05:00.000Z`,
      });
    }

    for (let ord = 11; ord <= 30; ord++) {
      slices.push({
        sliceId: `slice_${syncDate}_ord_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: `${syncDate}T10:00:00.000Z`,
        units: 1,
        status: 'forfeited',
        forfeitureReason: 'daily_cap_exhausted',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: `${syncDate}T10:05:00.000Z`,
      });
    }

    for (let ord = 31; ord <= 35; ord++) {
      slices.push({
        sliceId: `slice_${syncDate}_ord_${ord}`,
        syncDate,
        dailyOrdinal: ord,
        discoveredAt: `${syncDate}T10:00:00.000Z`,
        units: 1,
        status: 'expired',
        rewardedXp: 0,
        rewardedSatiety: 0,
        expiryAt: computeExpiryAtForSyncDate(syncDate),
        evaluatedAt: `${syncDate}T10:05:00.000Z`,
      });
    }

    const ledger = createEstablishedLedger({
      dailyAccruedXp: { [syncDate]: 300 },
      hwm: { [syncDate]: 35 },
      ordinals: { [syncDate]: 35 },
      slices,
    });

    const cutoffMs = new Date('2026-11-01T00:00:00.000Z').getTime();
    const compacted = compactContributionLedger(ledger, cutoffMs);

    assert.equal(compacted.slices.length, 0, 'All slices compacted');
    assert.equal(compacted.monthlyHistoricalSummary.length, 1);

    const summary = compacted.monthlyHistoricalSummary[0];
    assert.equal(summary.month, '2026-10');
    assert.equal(summary.totalObservedUnits, 35);
    assert.equal(summary.rewardedUnits, 10);
    assert.equal(summary.forfeitedUnits, 20, 'Forfeited units accurately aggregated');
    assert.equal(summary.expiredUnits, 5);
    assert.equal(summary.rewardedXp, 50);

    const invariant = verifyAccountingInvariant(compacted);
    assert.equal(invariant.satisfied, true);
  });

  // Test 9: Strict ledger validator enforcement for forfeitureReason
  it('9. Ledger validator enforces valid forfeitureReason enum and rejects invalid combinations', () => {
    const syncDate = '2026-11-16';

    // Valid forfeited slice with valid reason
    const validSlice: ContributionSlice = {
      sliceId: 'valid_slice',
      syncDate,
      discoveredAt: '2026-11-16T10:00:00.000Z',
      units: 1,
      status: 'forfeited',
      forfeitureReason: 'daily_cap_exhausted',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt: computeExpiryAtForSyncDate(syncDate),
      evaluatedAt: '2026-11-16T10:05:00.000Z',
    };

    const validLedger = createEstablishedLedger({ slices: [validSlice] });
    const rValid = validateContributionLedger(validLedger);
    assert.equal(rValid.valid, true);

    // Invalid reason
    const invalidReasonSlice = {
      ...validSlice,
      forfeitureReason: 'not_a_real_reason',
    };
    const rInvalidReason = validateContributionLedger(createEstablishedLedger({ slices: [invalidReasonSlice as unknown as ContributionSlice] }));
    assert.equal(rInvalidReason.valid, false);
    assert.ok(rInvalidReason.errors.some((e) => e.includes('invalid forfeitureReason')));

    // forfeitureReason present on a rewarded slice -> invalid
    const invalidRewardedSlice = {
      ...validSlice,
      status: 'rewarded',
      rewardedXp: 10,
      forfeitureReason: 'daily_cap_exhausted',
    };
    const rInvalidStatus = validateContributionLedger(createEstablishedLedger({ slices: [invalidRewardedSlice as unknown as ContributionSlice] }));
    assert.equal(rInvalidStatus.valid, false);
    assert.ok(rInvalidStatus.errors.some((e) => e.includes('has forfeitureReason but status is rewarded')));
  });
});
