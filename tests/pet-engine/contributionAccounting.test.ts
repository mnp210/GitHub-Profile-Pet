import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compactContributionLedger,
  computeExpiryAtForSyncDate,
  reconcileContributions,
  verifyAccountingInvariant,
} from '../../src/features/pet-engine/accounting/contributionEngine.ts';
import type {
  ContributionLedgerDocument,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';

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

function createEmptyLedger(hwm: number = 0): ContributionLedgerDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    monotonicPublicHwm: hwm,
    dailyAccruedXp: {},
    hourlySliceUsage: {},
    slices: [],
    monthlyHistoricalSummary: [],
  };
}

describe('Contribution Accounting Engine (Tests 11-16)', () => {
  it('TC-CONTRIB-01: Monotonic HWM never regresses when API returns transient lower count', () => {
    const pet = createTestPet();
    const ledger = createEmptyLedger(50);
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();

    // External count drops from 50 to 30
    const result = reconcileContributions({
      pet,
      ledger,
      observedPublicTotal: 30,
      nowMs,
    });

    assert.equal(result.deltaObserved, 0);
    assert.equal(result.nextContributionLedger.monotonicPublicHwm, 50);
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.invariantSatisfied, true);
  });

  it('TC-CONTRIB-02: Hourly throttle limits rewarded slices to 5 per UTC hour, excess enters pending', () => {
    const pet = createTestPet();
    const ledger = createEmptyLedger(0);
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();

    // Discover 40 units in one hour = 8 slices of 5 units each
    const result = reconcileContributions({
      pet,
      ledger,
      observedPublicTotal: 40,
      nowMs,
    });

    assert.equal(result.deltaObserved, 40);
    assert.equal(result.newSlicesCreated, 8);

    // 5 slices rewarded (5 * 5 = 25 units rewarded)
    const rewarded = result.nextContributionLedger.slices.filter((s) => s.status === 'rewarded');
    assert.equal(rewarded.length, 5);
    const rewardedUnits = rewarded.reduce((sum, s) => sum + s.units, 0);
    assert.equal(rewardedUnits, 25);

    // 3 slices placed into pending (3 * 5 = 15 units pending)
    const pending = result.nextContributionLedger.slices.filter((s) => s.status === 'pending');
    assert.equal(pending.length, 3);
    const pendingUnits = pending.reduce((sum, s) => sum + s.units, 0);
    assert.equal(pendingUnits, 15);

    // Strict conservation
    assert.equal(rewardedUnits + pendingUnits, 40);
    assert.equal(result.invariantSatisfied, true);
  });

  it('TC-CONTRIB-03: Daily 300 XP cap is enforced and excess units enter forfeited status', () => {
    const pet = createTestPet();
    // Start with 280 XP already accrued on 2026-11-15
    const ledger: ContributionLedgerDocument = {
      ...createEmptyLedger(0),
      dailyAccruedXp: { '2026-11-15': 280 },
    };
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();

    // 5 units discovered = potential 60 XP. But only 20 XP room remains today.
    // 20 XP room = 1 unit can be rewarded (12 XP). Or if 20 XP allows 1 unit:
    // 1 unit rewarded (12 XP), remaining 4 units forfeited (0 XP).
    const result = reconcileContributions({
      pet,
      ledger,
      observedPublicTotal: 5,
      nowMs,
    });

    const rewarded = result.nextContributionLedger.slices.filter((s) => s.status === 'rewarded');
    const forfeited = result.nextContributionLedger.slices.filter((s) => s.status === 'forfeited');

    const rewardedUnits = rewarded.reduce((acc, s) => acc + s.units, 0);
    const forfeitedUnits = forfeited.reduce((acc, s) => acc + s.units, 0);

    assert.equal(rewardedUnits + forfeitedUnits, 5);
    assert.equal(result.totalXpAwarded, 12);
    assert.equal(result.nextContributionLedger.dailyAccruedXp['2026-11-15'], 292);
    assert.equal(result.invariantSatisfied, true);
  });

  it('TC-CONTRIB-04: Pending slices expire at sync date midnight + 48h UTC', () => {
    const syncDate = '2026-11-15';
    const expiryAt = computeExpiryAtForSyncDate(syncDate);
    assert.equal(expiryAt, '2026-11-17T00:00:00.000Z');

    const pet = createTestPet();
    const ledger: ContributionLedgerDocument = {
      ...createEmptyLedger(10),
      slices: [
        {
          sliceId: 'slice_pending_1',
          syncDate,
          discoveredAt: '2026-11-15T10:00:00.000Z',
          units: 5,
          status: 'pending',
          rewardedXp: 0,
          rewardedSatiety: 0,
          expiryAt,
          evaluatedAt: '2026-11-15T10:00:00.000Z',
        },
      ],
    };

    // Run reconciliation after expiry: 2026-11-17T00:00:01.000Z
    const afterExpiryMs = new Date('2026-11-17T00:00:01.000Z').getTime();
    const result = reconcileContributions({
      pet,
      ledger,
      observedPublicTotal: 10,
      nowMs: afterExpiryMs,
    });

    assert.equal(result.pendingSlicesExpired, 1);
    const expiredSlice = result.nextContributionLedger.slices.find(
      (s) => s.sliceId === 'slice_pending_1'
    );
    assert.equal(expiredSlice?.status, 'expired');
    assert.equal(result.totalXpAwarded, 0);
    assert.equal(result.invariantSatisfied, true);
  });

  it('TC-CONTRIB-05: 5-increment math awards strictly 60 XP and 19 satiety', () => {
    const pet = createTestPet();
    const ledger = createEmptyLedger(0);
    const nowMs = new Date('2026-11-15T12:00:00.000Z').getTime();

    // 5 units discovered
    const result = reconcileContributions({
      pet,
      ledger,
      observedPublicTotal: 5,
      nowMs,
    });

    assert.equal(result.totalXpAwarded, 60);
    assert.equal(result.totalSatietyAwarded, 19);
    assert.equal(result.nextPetState.xp, 60);
    assert.equal(result.nextPetState.hunger, 39); // 20 + 19
  });

  it('TC-CONTRIB-06: Strict accounting conservation invariant across multiple complex batches', () => {
    let pet = createTestPet();
    let ledger = createEmptyLedger(0);

    const checkpoints = [
      { total: 10, time: '2026-11-15T10:00:00.000Z' },
      { total: 35, time: '2026-11-15T10:30:00.000Z' }, // Exceeds hourly throttle
      { total: 50, time: '2026-11-15T11:00:00.000Z' }, // New hour claims pending
      { total: 90, time: '2026-11-15T12:00:00.000Z' }, // Hits daily cap
      { total: 90, time: '2026-11-17T02:00:00.000Z' }, // Expiry rollover
      { total: 110, time: '2026-11-17T03:00:00.000Z' },
    ];

    for (const cp of checkpoints) {
      const nowMs = new Date(cp.time).getTime();
      const res = reconcileContributions({
        pet,
        ledger,
        observedPublicTotal: cp.total,
        nowMs,
      });

      pet = res.nextPetState;
      ledger = res.nextContributionLedger;

      const invariant = verifyAccountingInvariant(ledger);
      assert.equal(invariant.satisfied, true);
      assert.equal(invariant.totalObserved, ledger.monotonicPublicHwm);
    }
  });

  it('TC-CONTRIB-07: Compaction into monthlyHistoricalSummary strictly preserves conservation invariant', () => {
    const ledger: ContributionLedgerDocument = {
      schemaVersion: 1,
      generation: 1,
      monotonicPublicHwm: 45,
      dailyAccruedXp: {},
      hourlySliceUsage: {},
      slices: [
        {
          sliceId: 'slice_oct_1',
          syncDate: '2026-10-01',
          discoveredAt: '2026-10-01T10:00:00.000Z',
          units: 5,
          status: 'rewarded',
          rewardedXp: 60,
          rewardedSatiety: 19,
          expiryAt: '2026-10-03T00:00:00.000Z',
          evaluatedAt: '2026-10-01T10:00:00.000Z',
        },
        {
          sliceId: 'slice_oct_2',
          syncDate: '2026-10-02',
          discoveredAt: '2026-10-02T10:00:00.000Z',
          units: 5,
          status: 'forfeited',
          rewardedXp: 0,
          rewardedSatiety: 0,
          expiryAt: '2026-10-04T00:00:00.000Z',
          evaluatedAt: '2026-10-02T10:00:00.000Z',
        },
        {
          sliceId: 'slice_oct_3',
          syncDate: '2026-10-05',
          discoveredAt: '2026-10-05T10:00:00.000Z',
          units: 5,
          status: 'expired',
          rewardedXp: 0,
          rewardedSatiety: 0,
          expiryAt: '2026-10-07T00:00:00.000Z',
          evaluatedAt: '2026-10-07T00:00:00.000Z',
        },
        {
          sliceId: 'slice_nov_recent',
          syncDate: '2026-11-15',
          discoveredAt: '2026-11-15T10:00:00.000Z',
          units: 15,
          status: 'rewarded',
          rewardedXp: 180,
          rewardedSatiety: 57,
          expiryAt: '2026-11-17T00:00:00.000Z',
          evaluatedAt: '2026-11-15T10:00:00.000Z',
        },
        {
          sliceId: 'slice_nov_pending',
          syncDate: '2026-11-15',
          discoveredAt: '2026-11-15T10:00:00.000Z',
          units: 15,
          status: 'pending',
          rewardedXp: 0,
          rewardedSatiety: 0,
          expiryAt: '2026-11-17T00:00:00.000Z',
          evaluatedAt: '2026-11-15T10:00:00.000Z',
        },
      ],
      monthlyHistoricalSummary: [],
    };

    // Pre-compaction invariant check
    const preInv = verifyAccountingInvariant(ledger);
    assert.equal(preInv.satisfied, true);
    assert.equal(preInv.totalObserved, 45);

    // Compact slices older than 2026-11-01
    const cutoffMs = new Date('2026-11-01T00:00:00.000Z').getTime();
    const compacted = compactContributionLedger(ledger, cutoffMs);

    // Slices from October should be compacted into monthlyHistoricalSummary
    assert.equal(compacted.monthlyHistoricalSummary.length, 1);
    const octSummary = compacted.monthlyHistoricalSummary[0];
    assert.equal(octSummary.month, '2026-10');
    assert.equal(octSummary.totalObservedUnits, 15);
    assert.equal(octSummary.rewardedUnits, 5);
    assert.equal(octSummary.forfeitedUnits, 5);
    assert.equal(octSummary.expiredUnits, 5);
    assert.equal(octSummary.rewardedXp, 60);

    // Active slices retained: recent rewarded slice (15) + pending slice (15)
    assert.equal(compacted.slices.length, 2);
    assert.equal(compacted.slices.find((s) => s.sliceId === 'slice_nov_pending')?.status, 'pending');

    // Post-compaction invariant check
    const postInv = verifyAccountingInvariant(compacted);
    assert.equal(postInv.satisfied, true);
    assert.equal(postInv.totalObserved, 45);
    assert.equal(postInv.sumCategorized, 45);
  });
});
