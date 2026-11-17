import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  compactContributionLedger,
  computeExpiryAtForSyncDate,
  CorruptHwmError,
  CorruptOrdinalError,
  getRewardForOrdinal,
  getUtcDateString,
  getUtcHourKey,
  IdentityMismatchError,
  InvalidSnapshotError,
  reconcileContributions,
  verifyAccountingInvariant,
} from '../../src/features/pet-engine/accounting/contributionEngine.ts';
import type {
  ContributionLedgerDocument,
  ContributionSlice,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import type { GitHubContributionSnapshot } from '../../src/features/pet-engine/contribution/types.ts';
import {
  GenerationConflictError,
  loadRepositoryState,
  recoverRepositoryState,
  saveRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';

// ---------------------------------------------------------------------------
// Test Fixture Helpers
// ---------------------------------------------------------------------------

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

function createUninitializedLedger(generation: number = 1): ContributionLedgerDocument {
  return {
    schemaVersion: 1,
    generation,
    dailyAccruedXp: {},
    hourlyIncrementUsage: {},
    slices: [],
    monthlyHistoricalSummary: [],
  };
}

function createEstablishedLedger(params?: {
  generation?: number;
  ownerDatabaseId?: number;
  ownerLogin?: string;
  baselineDate?: string;
  initialCounts?: { yesterday: number; today: number };
  hwm?: Record<string, number>;
  ordinals?: Record<string, number>;
  dailyAccruedXp?: Record<string, number>;
  hourlyIncrementUsage?: Record<string, number>;
  slices?: ContributionSlice[];
}): ContributionLedgerDocument {
  const baselineDateUtc = params?.baselineDate ?? '2026-11-15';
  const yesterday = '2026-11-14';
  const initialCounts = params?.initialCounts ?? { yesterday: 10, today: 14 };

  const defaultHwm: Record<string, number> = {
    [yesterday]: initialCounts.yesterday,
    [baselineDateUtc]: initialCounts.today,
    ...(params?.hwm ?? {}),
  };

  const defaultOrdinals: Record<string, number> = {
    [yesterday]: 0,
    [baselineDateUtc]: 0,
    ...(params?.ordinals ?? {}),
  };

  return {
    schemaVersion: 1,
    generation: params?.generation ?? 1,
    ownerDatabaseId: params?.ownerDatabaseId ?? 12345,
    ownerLogin: params?.ownerLogin ?? 'mnp210',
    installationBaseline: {
      completed: true,
      installedAt: `${baselineDateUtc}T12:00:00.000Z`,
      baselineDateUtc,
      initialCounts,
    },
    dailyHwm: defaultHwm,
    dailyRewardOrdinal: defaultOrdinals,
    dailyAccruedXp: params?.dailyAccruedXp ?? {},
    hourlyIncrementUsage: params?.hourlyIncrementUsage ?? {},
    slices: params?.slices ?? [],
    monthlyHistoricalSummary: [],
  };
}

function createMockSnapshot(params: {
  date: string;
  commits?: number;
  issues?: number;
  pullRequests?: number;
  reviews?: number;
  restricted?: number;
  ownerDatabaseId?: number;
  ownerLogin?: string;
  isPersonalAccount?: boolean;
}): GitHubContributionSnapshot {
  const c = params.commits ?? 0;
  const i = params.issues ?? 0;
  const pr = params.pullRequests ?? 0;
  const rev = params.reviews ?? 0;
  const restricted = params.restricted ?? 0;
  const publicCategoryTotal = c + i + pr + rev;

  return {
    ownerDatabaseId: params.ownerDatabaseId ?? 12345,
    ownerLogin: params.ownerLogin ?? 'mnp210',
    isPersonalAccount: params.isPersonalAccount ?? true,
    fromIso: `${params.date}T00:00:00.000Z`,
    toIso: `${params.date}T23:59:59.999Z`,
    retrievedAtIso: `${params.date}T12:00:00.000Z`,
    counts: {
      commits: c,
      issues: i,
      pullRequests: pr,
      pullRequestReviews: rev,
      restricted,
      publicCategoryTotal,
      calendarReportedTotal: publicCategoryTotal + restricted,
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 120,
  };
}

// ---------------------------------------------------------------------------
// Test Suite: Phase 3C2.2.1 Mandatory Invariants
// ---------------------------------------------------------------------------

describe('Deterministic Contribution Accounting Engine (Phase 3C2.2.1)', () => {
  // Test 1: First-installation baseline with no retroactive rewards
  it('1. First-installation baseline with no retroactive rewards', () => {
    const pet = createTestPet();
    const ledger = createUninitializedLedger();
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // Initial snapshot: 10 yesterday, 14 today
    const snapshots = [
      { date: '2026-11-15', observedTotal: 10 },
      { date: '2026-11-16', observedTotal: 14 },
    ];

    const result = reconcileContributions({
      pet,
      ledger,
      snapshots,
      ownerDatabaseId: 12345,
      ownerLogin: 'mnp210',
      nowMs,
    });

    // Baseline metadata established
    assert.equal(result.nextContributionLedger.installationBaseline?.completed, true);
    assert.equal(result.nextContributionLedger.installationBaseline?.baselineDateUtc, '2026-11-16');
    assert.equal(result.nextContributionLedger.installationBaseline?.initialCounts.yesterday, 10);
    assert.equal(result.nextContributionLedger.installationBaseline?.initialCounts.today, 14);

    // Initial HWM matches snapshot counts
    assert.equal(result.nextContributionLedger.dailyHwm?.['2026-11-15'], 10);
    assert.equal(result.nextContributionLedger.dailyHwm?.['2026-11-16'], 14);

    // Initial ordinals start strictly at 0
    assert.equal(result.nextContributionLedger.dailyRewardOrdinal?.['2026-11-15'], 0);
    assert.equal(result.nextContributionLedger.dailyRewardOrdinal?.['2026-11-16'], 0);

    // Zero retroactive slices, zero XP, zero satiety
    assert.equal(result.deltaObserved, 0);
    assert.equal(result.newSlicesCreated, 0);
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.totalSatietyAwarded, 0);
    assert.equal(result.nextContributionLedger.slices.length, 0);

    // Pet vitals unchanged
    assert.equal(result.nextPetState.xp, 0);
    assert.equal(result.nextPetState.hunger, 20);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 2: First increment after baseline receiving ordinal 1
  it('2. First increment after baseline receiving ordinal 1', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 14 },
      ordinals: { '2026-11-16': 0 },
    });
    const nowMs = new Date('2026-11-16T13:00:00.000Z').getTime();

    // Next observation: 15 contributions (+1 increment)
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 15 }],
      nowMs,
    });

    assert.equal(result.deltaObserved, 1);
    assert.equal(result.nextContributionLedger.dailyHwm?.['2026-11-16'], 15);
    assert.equal(result.nextContributionLedger.dailyRewardOrdinal?.['2026-11-16'], 1);

    // Evaluated slice has ordinal 1 and awards 25 XP, 10 satiety
    assert.equal(result.nextContributionLedger.slices.length, 1);
    const slice = result.nextContributionLedger.slices[0];
    assert.equal(slice.dailyOrdinal, 1);
    assert.equal(slice.status, 'rewarded');
    assert.equal(slice.rewardedXp, 25);
    assert.equal(slice.rewardedSatiety, 10);
    assert.equal(slice.units, 1);

    assert.equal(result.totalXpAwarded, 25);
    assert.equal(result.totalSatietyAwarded, 10);
    assert.equal(result.nextPetState.xp, 25);
    assert.equal(result.nextPetState.hunger, 30); // 20 + 10
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 3: Independent ordinals across different UTC dates
  it('3. Independent ordinals across different UTC dates', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-15': 10, '2026-11-16': 14 },
      ordinals: { '2026-11-15': 0, '2026-11-16': 0 },
    });
    const nowMs = new Date('2026-11-16T13:00:00.000Z').getTime();

    // 2026-11-15 discovers 2 increments (10 -> 12)
    // 2026-11-16 discovers 1 increment (14 -> 15)
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [
        { date: '2026-11-15', observedTotal: 12 },
        { date: '2026-11-16', observedTotal: 15 },
      ],
      nowMs,
    });

    assert.equal(result.deltaObserved, 3);
    assert.equal(result.nextContributionLedger.dailyRewardOrdinal?.['2026-11-15'], 2);
    assert.equal(result.nextContributionLedger.dailyRewardOrdinal?.['2026-11-16'], 1);

    const slices = result.nextContributionLedger.slices;
    assert.equal(slices.length, 3);

    // Yesterday increments: ordinals 1 and 2
    const y1 = slices.find((s) => s.syncDate === '2026-11-15' && s.dailyOrdinal === 1);
    const y2 = slices.find((s) => s.syncDate === '2026-11-15' && s.dailyOrdinal === 2);
    assert.ok(y1 && y1.status === 'rewarded' && y1.rewardedXp === 25);
    assert.ok(y2 && y2.status === 'rewarded' && y2.rewardedXp === 15);

    // Today increment: ordinal 1 (independent from yesterday's ordinal!)
    const t1 = slices.find((s) => s.syncDate === '2026-11-16' && s.dailyOrdinal === 1);
    assert.ok(t1 && t1.status === 'rewarded' && t1.rewardedXp === 25);

    // Total XP awarded: 25 + 15 + 25 = 65 XP
    assert.equal(result.totalXpAwarded, 65);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 4: Repeated identical snapshots
  it('4. Repeated identical snapshots produce zero mutation or duplicate slices', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 15 },
      ordinals: { '2026-11-16': 1 },
      slices: [
        {
          sliceId: 'slice_2026-11-16_ord_1',
          syncDate: '2026-11-16',
          dailyOrdinal: 1,
          discoveredAt: '2026-11-16T12:00:00.000Z',
          units: 1,
          status: 'rewarded',
          rewardedXp: 25,
          rewardedSatiety: 10,
          expiryAt: '2026-11-18T00:00:00.000Z',
          evaluatedAt: '2026-11-16T12:00:00.000Z',
        },
      ],
      dailyAccruedXp: { '2026-11-16': 25 },
    });
    const nowMs = new Date('2026-11-16T13:00:00.000Z').getTime();

    // Snapshot repeats 15
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 15 }],
      nowMs,
    });

    assert.equal(result.deltaObserved, 0);
    assert.equal(result.newSlicesCreated, 0);
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.totalSatietyAwarded, 0);
    assert.equal(result.nextContributionLedger.dailyHwm?.['2026-11-16'], 15);
    assert.equal(result.nextContributionLedger.dailyRewardOrdinal?.['2026-11-16'], 1);
    assert.equal(result.nextContributionLedger.slices.length, 1);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 5: Monotonic high-water marks after observed decreases
  it('5. Monotonic high-water marks after observed decreases', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 15 },
      ordinals: { '2026-11-16': 1 },
      slices: [
        {
          sliceId: 'slice_2026-11-16_ord_1',
          syncDate: '2026-11-16',
          dailyOrdinal: 1,
          discoveredAt: '2026-11-16T12:00:00.000Z',
          units: 1,
          status: 'rewarded',
          rewardedXp: 25,
          rewardedSatiety: 10,
          expiryAt: '2026-11-18T00:00:00.000Z',
          evaluatedAt: '2026-11-16T12:00:00.000Z',
        },
      ],
    });
    const nowMs = new Date('2026-11-16T13:00:00.000Z').getTime();

    // Observed count decreases from 15 to 12 (e.g. rebase/squash)
    const result1 = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 12 }],
      nowMs,
    });

    assert.equal(result1.deltaObserved, 0);
    assert.equal(result1.totalXpAwarded, 0);
    // HWM remains 15, does not regress to 12
    assert.equal(result1.nextContributionLedger.dailyHwm?.['2026-11-16'], 15);
    assert.equal(result1.nextContributionLedger.dailyRewardOrdinal?.['2026-11-16'], 1);

    // Later recovery to 17 (+2 from peak 15)
    const result2 = reconcileContributions({
      pet: result1.nextPetState,
      ledger: result1.nextContributionLedger,
      snapshots: [{ date: '2026-11-16', observedTotal: 17 }],
      nowMs: nowMs + 3600000,
    });

    assert.equal(result2.deltaObserved, 2);
    assert.equal(result2.nextContributionLedger.dailyHwm?.['2026-11-16'], 17);
    assert.equal(result2.nextContributionLedger.dailyRewardOrdinal?.['2026-11-16'], 3);
    assert.equal(result2.newSlicesCreated, 2);
    assert.equal(result2.invariantSatisfied, true);
  });

  // Test 6: Multiple increments in one snapshot
  it('6. Multiple increments in one snapshot receive diminishing reward schedule', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 14 },
      ordinals: { '2026-11-16': 0 },
    });
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // 5 increments discovered in one snapshot (14 -> 19)
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 19 }],
      nowMs,
    });

    assert.equal(result.deltaObserved, 5);
    assert.equal(result.newSlicesCreated, 5);
    assert.equal(result.nextContributionLedger.slices.length, 5);

    // Verify exact diminishing schedule: 25, 15, 10, 5, 5
    const ordinals = result.nextContributionLedger.slices.map((s) => s.dailyOrdinal);
    const xpAwards = result.nextContributionLedger.slices.map((s) => s.rewardedXp);
    const satietyAwards = result.nextContributionLedger.slices.map((s) => s.rewardedSatiety);

    assert.deepEqual(ordinals, [1, 2, 3, 4, 5]);
    assert.deepEqual(xpAwards, [25, 15, 10, 5, 5]);
    assert.deepEqual(satietyAwards, [10, 5, 2, 1, 1]);

    // Sum strictly equals 60 XP and 19 satiety
    assert.equal(result.totalXpAwarded, 60);
    assert.equal(result.totalSatietyAwarded, 19);
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-16'], 60);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 7: Five individual increments per hour throttle
  it('7. Five individual increments per hour throttle enters excess into pending', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 10 },
      ordinals: { '2026-11-16': 0 },
    });
    const nowMs = new Date('2026-11-16T10:15:00.000Z').getTime();

    // Discover 8 increments at 10:15 UTC (10 -> 18)
    const result1 = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 18 }],
      nowMs,
    });

    assert.equal(result1.deltaObserved, 8);
    assert.equal(result1.newSlicesCreated, 8);

    // Exactly 5 evaluated and rewarded in hour 10
    const rewarded = result1.nextContributionLedger.slices.filter((s) => s.status === 'rewarded');
    assert.equal(rewarded.length, 5);
    assert.deepEqual(
      rewarded.map((s) => s.dailyOrdinal),
      [1, 2, 3, 4, 5]
    );

    // Remaining 3 queued in pending
    const pending = result1.nextContributionLedger.slices.filter((s) => s.status === 'pending');
    assert.equal(pending.length, 3);
    assert.deepEqual(
      pending.map((s) => s.dailyOrdinal),
      [6, 7, 8]
    );

    const hourKey10 = getUtcHourKey(nowMs);
    assert.equal(result1.nextContributionLedger.hourlyIncrementUsage?.[hourKey10], 5);

    // Another sync within the SAME hour (10:45 UTC) observing 2 more increments (18 -> 20)
    const result2 = reconcileContributions({
      pet: result1.nextPetState,
      ledger: result1.nextContributionLedger,
      snapshots: [{ date: '2026-11-16', observedTotal: 20 }],
      nowMs: nowMs + 30 * 60 * 1000, // 10:45 UTC
    });

    assert.equal(result2.deltaObserved, 2);
    // 0 increments evaluated because hour 10 quota is 0
    assert.equal(result2.incrementsEvaluatedThisRun, 0);
    assert.equal(result2.totalXpAwarded, 0);
    // Pending now contains 5 increments (ordinals 6, 7, 8, 9, 10)
    const pending2 = result2.nextContributionLedger.slices.filter((s) => s.status === 'pending');
    assert.equal(pending2.length, 5);

    // Next hour (11:00 UTC) evaluates up to 5 pending increments
    const result3 = reconcileContributions({
      pet: result2.nextPetState,
      ledger: result2.nextContributionLedger,
      snapshots: [{ date: '2026-11-16', observedTotal: 20 }],
      nowMs: new Date('2026-11-16T11:00:00.000Z').getTime(),
    });

    assert.equal(result3.incrementsEvaluatedThisRun, 5);
    const rewarded3 = result3.nextContributionLedger.slices.filter((s) => s.status === 'rewarded');
    assert.equal(rewarded3.length, 10); // All 10 are now rewarded!
    assert.equal(result3.nextContributionLedger.slices.filter((s) => s.status === 'pending').length, 0);
    assert.equal(result3.invariantSatisfied, true);
  });

  // Test 8: Pending increments retaining original dates and ordinals
  it('8. Pending increments retaining original dates and ordinals', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-15': 10 },
      ordinals: { '2026-11-15': 0 },
    });

    // Discovered on 2026-11-15: 7 increments. Hour limit 5 leaves ordinals 6 and 7 pending
    const run1 = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-15', observedTotal: 17 }],
      nowMs: new Date('2026-11-15T23:45:00.000Z').getTime(),
    });

    const pendingSlice = run1.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 6);
    assert.ok(pendingSlice);
    assert.equal(pendingSlice.syncDate, '2026-11-15');
    assert.equal(pendingSlice.dailyOrdinal, 6);
    assert.equal(pendingSlice.status, 'pending');

    // Evaluated on 2026-11-16 at 00:05 UTC (next day)
    const run2 = reconcileContributions({
      pet: run1.nextPetState,
      ledger: run1.nextContributionLedger,
      snapshots: [{ date: '2026-11-15', observedTotal: 17 }, { date: '2026-11-16', observedTotal: 0 }],
      nowMs: new Date('2026-11-16T00:05:00.000Z').getTime(),
    });

    const evaluatedSlice = run2.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 6);
    assert.ok(evaluatedSlice);
    // Retains original syncDate and ordinal
    assert.equal(evaluatedSlice.syncDate, '2026-11-15');
    assert.equal(evaluatedSlice.dailyOrdinal, 6);
    assert.equal(evaluatedSlice.status, 'rewarded');
    assert.equal(evaluatedSlice.rewardedXp, 5); // Ordinal 6 awards 5 XP
    // XP charged to original date 2026-11-15, NOT 2026-11-16!
    assert.equal(run2.nextContributionLedger.dailyAccruedXp['2026-11-15'], 60 + 5 + 5);
    assert.equal(run2.invariantSatisfied, true);
  });

  // Test 9: Exact 48-hour expiry boundary
  it('9. Exact 48-hour expiry boundary (syncDate midnight + 48h UTC)', () => {
    const syncDate = '2026-11-15';
    const expiryAtIso = computeExpiryAtForSyncDate(syncDate);
    assert.equal(expiryAtIso, '2026-11-17T00:00:00.000Z');

    const expiryMs = new Date(expiryAtIso).getTime();

    const pendingSlice: ContributionSlice = {
      sliceId: 'slice_test_expiry',
      syncDate,
      dailyOrdinal: 6,
      discoveredAt: '2026-11-15T12:00:00.000Z',
      units: 1,
      status: 'pending',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt: expiryAtIso,
      evaluatedAt: null,
    };

    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { [syncDate]: 10 },
      ordinals: { [syncDate]: 6 },
      slices: [pendingSlice],
    });

    // 1 ms BEFORE expiry: 2026-11-16T23:59:59.999Z -> NOT expired (evaluates or stays pending)
    const beforeResult = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 10 }],
      nowMs: expiryMs - 1,
    });
    const beforeSlice = beforeResult.nextContributionLedger.slices.find((s) => s.sliceId === 'slice_test_expiry');
    // Hourly quota allowed it to be evaluated or stay pending; definitely NOT expired
    assert.notEqual(beforeSlice?.status, 'expired');

    // AT exact expiry: 2026-11-17T00:00:00.000Z -> EXPIRES
    const atResult = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: syncDate, observedTotal: 10 }],
      nowMs: expiryMs,
    });
    const atSlice = atResult.nextContributionLedger.slices.find((s) => s.sliceId === 'slice_test_expiry');
    assert.equal(atSlice?.status, 'expired');
    assert.equal(atSlice?.rewardedXp, 0);
    assert.equal(atSlice?.rewardedSatiety, 0);
    assert.equal(atResult.pendingSlicesExpired, 1);
    assert.equal(atResult.invariantSatisfied, true);
  });

  // Test 10: XP cap reached exactly
  it('10. XP cap reached exactly (daily allowance hits 300 XP)', () => {
    const pet = createTestPet();
    // 295 XP already accrued on 2026-11-16
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 50 },
      ordinals: { '2026-11-16': 4 },
      dailyAccruedXp: { '2026-11-16': 295 },
    });
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // 1 increment discovered (ordinal 5 awards 5 XP). 295 + 5 = 300 exactly
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 51 }],
      nowMs,
    });

    assert.equal(result.totalXpAwarded, 5);
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-16'], 300);
    const slice = result.nextContributionLedger.slices.find((s) => s.dailyOrdinal === 5);
    assert.equal(slice?.status, 'rewarded');
    assert.equal(slice?.rewardedXp, 5);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 11: Increment exceeding remaining XP allowance being forfeited
  it('11. Increment exceeding remaining XP allowance is forfeited (whole-increment policy)', () => {
    const pet = createTestPet();
    // 290 XP accrued today. Allowance = 10 XP
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 0 },
      ordinals: { '2026-11-16': 0 },
      dailyAccruedXp: { '2026-11-16': 290 },
    });
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // 1 increment discovered: receives ordinal 1 (reward: 25 XP).
    // 25 XP > 10 XP remaining allowance -> FORFEITED!
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 1 }],
      nowMs,
    });

    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.totalSatietyAwarded, 0);
    const slice = result.nextContributionLedger.slices[0];
    assert.equal(slice.dailyOrdinal, 1);
    assert.equal(slice.status, 'forfeited');
    assert.equal(slice.forfeitureReason, 'whole_increment_overflow');
    assert.equal(slice.rewardedXp, 0);
    assert.equal(slice.rewardedSatiety, 0);
    // Daily accrued XP remains 290
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-16'], 290);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 12: Smaller later increment fitting after a larger increment is forfeited
  it('12. Smaller later increment fits after larger increments are forfeited', () => {
    const pet = createTestPet();
    // 290 XP accrued. Allowance = 10 XP. Ordinal starts at 0.
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 0 },
      ordinals: { '2026-11-16': 0 },
      dailyAccruedXp: { '2026-11-16': 290 },
    });
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // 3 increments discovered in one batch:
    // Ordinal 1: 25 XP -> 25 > 10 -> FORFEITED
    // Ordinal 2: 15 XP -> 15 > 10 -> FORFEITED
    // Ordinal 3: 10 XP -> 10 <= 10 -> REWARDED! (Reaches 300 XP)
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 3 }],
      nowMs,
    });

    const slices = result.nextContributionLedger.slices;
    assert.equal(slices.length, 3);

    const s1 = slices.find((s) => s.dailyOrdinal === 1);
    const s2 = slices.find((s) => s.dailyOrdinal === 2);
    const s3 = slices.find((s) => s.dailyOrdinal === 3);

    assert.equal(s1?.status, 'forfeited');
    assert.equal(s1?.forfeitureReason, 'whole_increment_overflow');
    assert.equal(s1?.rewardedXp, 0);

    assert.equal(s2?.status, 'forfeited');
    assert.equal(s2?.forfeitureReason, 'whole_increment_overflow');
    assert.equal(s2?.rewardedXp, 0);

    assert.equal(s3?.status, 'rewarded');
    assert.equal(s3?.rewardedXp, 10);
    assert.equal(s3?.rewardedSatiety, 2);

    assert.equal(result.totalXpAwarded, 10);
    assert.equal(result.totalSatietyAwarded, 2);
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-16'], 300);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 13: All remaining increments forfeited after the cap is reached
  it('13. All remaining increments forfeited after the cap is reached', () => {
    const pet = createTestPet();
    // 300 XP already accrued on 2026-11-16 (cap exhausted)
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 50 },
      ordinals: { '2026-11-16': 50 },
      dailyAccruedXp: { '2026-11-16': 300 },
    });
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // 2 increments discovered (50 -> 52)
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 52 }],
      nowMs,
    });

    assert.equal(result.deltaObserved, 2);
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.totalSatietyAwarded, 0);

    const slices = result.nextContributionLedger.slices;
    assert.equal(slices.length, 2);
    assert.ok(slices.every((s) => s.status === 'forfeited' && s.rewardedXp === 0 && s.forfeitureReason === 'daily_cap_exhausted'));
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-16'], 300);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 14: No partial XP or satiety awards
  it('14. No partial XP or satiety awards (atomic all-or-nothing evaluation)', () => {
    const pet = createTestPet();
    // 292 XP accrued today. Allowance = 8 XP
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 0 },
      ordinals: { '2026-11-16': 0 },
      dailyAccruedXp: { '2026-11-16': 292 },
    });
    const nowMs = new Date('2026-11-16T12:00:00.000Z').getTime();

    // Increment with ordinal 3 requires 10 XP. Allowance is only 8 XP.
    // In Sprint 2.5, it would split the slice. In Phase 3C2, it MUST forfeit completely!
    const slice: ContributionSlice = {
      sliceId: 'slice_test_no_partial',
      syncDate: '2026-11-16',
      dailyOrdinal: 3,
      discoveredAt: '2026-11-16T12:00:00.000Z',
      units: 1,
      status: 'pending',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt: '2026-11-18T00:00:00.000Z',
      evaluatedAt: null,
    };

    const result = reconcileContributions({
      pet,
      ledger: { ...ledger, slices: [slice] },
      snapshots: [{ date: '2026-11-16', observedTotal: 0 }],
      nowMs,
    });

    const evaluated = result.nextContributionLedger.slices[0];
    assert.equal(evaluated.status, 'forfeited');
    assert.equal(evaluated.forfeitureReason, 'whole_increment_overflow');
    assert.equal(evaluated.rewardedXp, 0);
    assert.equal(evaluated.rewardedSatiety, 0);
    assert.equal(evaluated.units, 1); // Strictly preserved as 1 unit
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-16'], 292);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 15: No re-awarding forfeited increments after restart
  it('15. No re-awarding forfeited increments after process restart or subsequent sync', () => {
    const pet = createTestPet();
    const forfeitedSlice: ContributionSlice = {
      sliceId: 'slice_forfeited_perm',
      syncDate: '2026-11-16',
      dailyOrdinal: 1,
      discoveredAt: '2026-11-16T12:00:00.000Z',
      units: 1,
      status: 'forfeited',
      rewardedXp: 0,
      rewardedSatiety: 0,
      expiryAt: '2026-11-18T00:00:00.000Z',
      evaluatedAt: '2026-11-16T12:00:00.000Z',
    };

    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 1 },
      ordinals: { '2026-11-16': 1 },
      slices: [forfeitedSlice],
      dailyAccruedXp: { '2026-11-16': 290 },
    });

    // Simulate restart and run next hour
    const nowMs = new Date('2026-11-16T13:00:00.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-16', observedTotal: 1 }],
      nowMs,
    });

    const slice = result.nextContributionLedger.slices.find((s) => s.sliceId === 'slice_forfeited_perm');
    assert.equal(slice?.status, 'forfeited');
    assert.equal(slice?.rewardedXp, 0);
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.invariantSatisfied, true);
  });

  // Test 16: Conservation invariant after every transition
  it('16. Conservation invariant holds across all transitions (rewarded, forfeited, pending, expired, compaction)', () => {
    let pet = createTestPet();
    let ledger = createEstablishedLedger({
      hwm: { '2026-11-15': 10 },
      ordinals: { '2026-11-15': 0 },
    });

    // Step 1: Discover 8 increments (5 rewarded, 3 pending)
    let res = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-15', observedTotal: 18 }],
      nowMs: new Date('2026-11-15T10:00:00.000Z').getTime(),
    });
    pet = res.nextPetState;
    ledger = res.nextContributionLedger;
    let inv = verifyAccountingInvariant(ledger);
    assert.equal(inv.satisfied, true);
    assert.equal(inv.totalObserved, 8);
    assert.equal(inv.breakdown.rewarded, 5);
    assert.equal(inv.breakdown.pending, 3);

    // Step 2: Next hour drains remaining 3 pending increments
    res = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-15', observedTotal: 18 }],
      nowMs: new Date('2026-11-15T11:00:00.000Z').getTime(),
    });
    pet = res.nextPetState;
    ledger = res.nextContributionLedger;
    inv = verifyAccountingInvariant(ledger);
    assert.equal(inv.satisfied, true);
    assert.equal(inv.breakdown.rewarded, 8);
    assert.equal(inv.breakdown.pending, 0);

    // Step 3: Massive burst on 2026-11-16 that exceeds daily cap
    res = reconcileContributions({
      pet,
      ledger,
      snapshots: [{ date: '2026-11-15', observedTotal: 18 }, { date: '2026-11-16', observedTotal: 60 }],
      nowMs: new Date('2026-11-16T12:00:00.000Z').getTime(),
    });
    pet = res.nextPetState;
    ledger = res.nextContributionLedger;
    inv = verifyAccountingInvariant(ledger);
    assert.equal(inv.satisfied, true);
    assert.equal(inv.totalObserved, 8 + 60);

    // Step 4: Compaction into monthly summary
    const compacted = compactContributionLedger(ledger, new Date('2026-11-16T00:00:00.000Z').getTime());
    const compactedInv = verifyAccountingInvariant(compacted);
    assert.equal(compactedInv.satisfied, true);
    assert.equal(compactedInv.totalObserved, 8 + 60);
  });

  // Test 17: Concurrent or stale snapshot protection
  it('17. Concurrent or stale snapshot protection throws GenerationConflictError', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-accounting-cas-'));
    try {
      const pet = createTestPet(1);
      const contributions = createEstablishedLedger({ generation: 1 });
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

      // Initial save at generation 1
      await saveRepositoryState(tmpDir, { pet, contributions, actions });

      // Simulate concurrent transaction advancing generation to 2
      const loaded = await loadRepositoryState(tmpDir);
      assert.equal(loaded.generation, 1);

      await saveRepositoryState(tmpDir, {
        pet: { ...loaded.pet, generation: 2 },
        contributions: { ...loaded.contributions, generation: 2 },
        actions: { ...loaded.actions, generation: 2 },
      });

      // Stale attempt expecting generation 1 must throw GenerationConflictError
      await assert.rejects(
        async () => {
          await saveRepositoryState(
            tmpDir,
            {
              pet: { ...loaded.pet, generation: 2 },
              contributions: { ...loaded.contributions, generation: 2 },
              actions: { ...loaded.actions, generation: 2 },
            },
            { expectedGeneration: 1 }
          );
        },
        (err) => err instanceof GenerationConflictError
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // Test 18: Corrupt or missing established ordinal counter failing closed
  it('18. Corrupt or missing established ordinal counter fails closed', () => {
    const pet = createTestPet();

    // Established ledger missing dailyRewardOrdinal entirely
    const corruptLedger1 = createEstablishedLedger();
    delete corruptLedger1.dailyRewardOrdinal;

    assert.throws(
      () => {
        reconcileContributions({
          pet,
          ledger: corruptLedger1,
          snapshots: [{ date: '2026-11-16', observedTotal: 10 }],
          nowMs: Date.now(),
        });
      },
      (err) => err instanceof CorruptOrdinalError
    );

    // Established ledger missing dailyHwm entirely
    const corruptLedger2 = createEstablishedLedger();
    delete corruptLedger2.dailyHwm;

    assert.throws(
      () => {
        reconcileContributions({
          pet,
          ledger: corruptLedger2,
          snapshots: [{ date: '2026-11-16', observedTotal: 10 }],
          nowMs: Date.now(),
        });
      },
      (err) => err instanceof CorruptHwmError
    );

    // Corrupt negative ordinal value on established date
    const corruptLedger3 = createEstablishedLedger({
      ordinals: { '2026-11-16': -5 },
    });

    assert.throws(
      () => {
        reconcileContributions({
          pet,
          ledger: corruptLedger3,
          snapshots: [{ date: '2026-11-16', observedTotal: 10 }],
          nowMs: Date.now(),
        });
      },
      (err) => err instanceof CorruptOrdinalError
    );
  });

  // Test 19: Invalid or partial provider snapshots causing no mutation
  it('19. Invalid or partial provider snapshots cause zero mutation', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger();
    const nowMs = Date.now();

    // 19.1 Organization account rejected
    assert.throws(
      () => {
        reconcileContributions({
          pet,
          ledger,
          snapshot: createMockSnapshot({ date: '2026-11-16', isPersonalAccount: false }),
          nowMs,
        });
      },
      (err) => err instanceof InvalidSnapshotError
    );

    // 19.2 Mismatched ownerDatabaseId rejected
    assert.throws(
      () => {
        reconcileContributions({
          pet,
          ledger,
          snapshot: createMockSnapshot({ date: '2026-11-16', ownerDatabaseId: 999999 }),
          nowMs,
        });
      },
      (err) => err instanceof IdentityMismatchError
    );

    // 19.3 Malformed negative snapshot count rejected
    assert.throws(
      () => {
        reconcileContributions({
          pet,
          ledger,
          snapshots: [{ date: '2026-11-16', observedTotal: -10 }],
          nowMs,
        });
      },
      (err) => err instanceof InvalidSnapshotError
    );

    // Pet and ledger remain completely unmutated
    assert.equal(pet.xp, 0);
    assert.equal(pet.hunger, 20);
    assert.equal(ledger.slices.length, 0);
  });

  // Test 20: Crash recovery during accounting persistence
  it('20. Crash recovery during accounting persistence rolls back cleanly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-accounting-recovery-'));
    try {
      const pet = createTestPet(1);
      const contributions = createEstablishedLedger({ generation: 1 });
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

      // 1. Establish valid state at generation 1
      await saveRepositoryState(tmpDir, { pet, contributions, actions });

      // 2. Simulate crash during two-phase journal commit:
      // Create .journal with preparing meta and partial target files
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

      // 3. Recovery must detect uncommitted preparing transaction and roll back cleanly
      const recovery = await recoverRepositoryState(tmpDir);
      assert.equal(recovery.recovered, true);
      assert.equal(recovery.action, 'roll_back');
      assert.equal(recovery.generation, 1);

      // 4. Verify state loads cleanly at intact generation 1
      const loaded = await loadRepositoryState(tmpDir);
      assert.equal(loaded.generation, 1);
      assert.equal(loaded.pet.level, 1);
      assert.equal(loaded.contributions.generation, 1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // Additional Boundary and Helper Tests
  // -------------------------------------------------------------------------

  it('21. getRewardForOrdinal validates input ordinal bounds', () => {
    assert.deepEqual(getRewardForOrdinal(1), { xp: 25, satiety: 10 });
    assert.deepEqual(getRewardForOrdinal(2), { xp: 15, satiety: 5 });
    assert.deepEqual(getRewardForOrdinal(3), { xp: 10, satiety: 2 });
    assert.deepEqual(getRewardForOrdinal(4), { xp: 5, satiety: 1 });
    assert.deepEqual(getRewardForOrdinal(5), { xp: 5, satiety: 1 });
    assert.deepEqual(getRewardForOrdinal(100), { xp: 5, satiety: 1 });

    assert.throws(() => getRewardForOrdinal(0));
    assert.throws(() => getRewardForOrdinal(-1));
    assert.throws(() => getRewardForOrdinal(1.5));
  });

  it('22. getUtcHourKey and getUtcDateString format accurately', () => {
    const ms = new Date('2026-11-16T14:35:10.123Z').getTime();
    assert.equal(getUtcDateString(ms), '2026-11-16');
    assert.equal(getUtcHourKey(ms), '2026-11-16T14');
  });

  it('23. Public-only contribution calculation ignores restricted counts', () => {
    const pet = createTestPet();
    const ledger = createEstablishedLedger({
      hwm: { '2026-11-16': 10 },
      ordinals: { '2026-11-16': 0 },
    });

    // 12 public contributions, 100 restricted contributions
    const snapshot = createMockSnapshot({
      date: '2026-11-16',
      commits: 6,
      issues: 2,
      pullRequests: 2,
      reviews: 2,
      restricted: 100, // Must be strictly ignored
    });

    assert.equal(snapshot.counts.publicCategoryTotal, 12);
    assert.equal(snapshot.counts.restricted, 100);

    const result = reconcileContributions({
      pet,
      ledger,
      snapshot,
      nowMs: new Date('2026-11-16T12:00:00.000Z').getTime(),
    });

    // Delta is 12 - 10 = 2 (NOT 112 - 10 = 102!)
    assert.equal(result.deltaObserved, 2);
    assert.equal(result.newSlicesCreated, 2);
    assert.equal(result.nextContributionLedger.dailyHwm?.['2026-11-16'], 12);
    assert.equal(result.invariantSatisfied, true);
  });
});
