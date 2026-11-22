import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateActivityEvent,
  initDefaultActivityLedger,
} from '../../src/features/pet-engine/activity/index.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';
import type { ActivityLedgerDocument } from '../../src/features/pet-engine/activity/types.ts';

function createMockPet(overrides: Partial<PetStateDocument> = {}): PetStateDocument {
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
    hunger: 100,
    happiness: 100,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-19T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-19T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('Activity Delivery Reliability & Burst Processing', () => {
  const baseTimestamp = '2026-11-19T10:00:00.000Z';

  it('processes a rapid burst of 5 unique commits sequentially without losing XP', () => {
    let pet = createMockPet();
    let ledger: ActivityLedgerDocument = initDefaultActivityLedger(1);

    const commits = [
      'sha1_1111111111111111111111111111111111111',
      'sha2_2222222222222222222222222222222222222',
      'sha3_3333333333333333333333333333333333333',
      'sha4_4444444444444444444444444444444444444',
      'sha5_5555555555555555555555555555555555555',
    ];

    let totalXpAwarded = 0;

    for (const sha of commits) {
      const outcome = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: sha,
          eventType: 'commit',
          actor: 'developer1',
          commitMessage: `feat: commit ${sha.slice(0, 4)}`,
        },
        baseTimestamp
      );

      pet = outcome.updatedPet;
      ledger = outcome.updatedLedger;
      totalXpAwarded += outcome.result.xpAwarded;

      assert.equal(outcome.result.status, 'rewarded');
      assert.equal(outcome.result.xpAwarded, 15);
    }

    // 5 commits * 15 XP = 75 XP
    assert.equal(totalXpAwarded, 75);
    assert.equal(pet.xp, 75);
    assert.equal(ledger.dailyAccruedXp['2026-11-19'], 75);
    assert.equal(ledger.processedRegistry.commitShas.length, 5);
  });

  it('enforces the daily XP cap across a large burst of 25 commits in one execution', () => {
    let pet = createMockPet();
    let ledger: ActivityLedgerDocument = initDefaultActivityLedger(1);

    // 25 commits * 15 XP = 375 XP potential. Cap is 300 XP.
    let totalXpAwarded = 0;
    let rewardedCount = 0;
    let cappedCount = 0;

    for (let i = 1; i <= 25; i++) {
      const sha = `sha_burst_${i.toString().padStart(4, '0')}_0000000000000000000000`;
      const outcome = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventId: sha,
          eventType: 'commit',
          actor: 'busyDev',
          commitMessage: `commit #${i}`,
        },
        baseTimestamp
      );

      pet = outcome.updatedPet;
      ledger = outcome.updatedLedger;
      totalXpAwarded += outcome.result.xpAwarded;

      if (outcome.result.status === 'rewarded') {
        rewardedCount++;
      } else if (outcome.result.status === 'skipped_daily_cap') {
        cappedCount++;
      }
    }

    // Exactly 20 commits * 15 XP = 300 XP awarded.
    // 5 commits skipped due to daily cap.
    assert.equal(totalXpAwarded, 300);
    assert.equal(rewardedCount, 20);
    assert.equal(cappedCount, 5);
    assert.equal(ledger.dailyAccruedXp['2026-11-19'], 300);
    // All 25 commits are recorded in the registry to prevent replay
    assert.equal(ledger.processedRegistry.commitShas.length, 25);
  });

  it('reconciliation pass detects already processed commits and skips them without double-awarding', () => {
    const pet = createMockPet();
    const ledger: ActivityLedgerDocument = initDefaultActivityLedger(1);

    const sha = 'reconcile_test_sha_1234567890123456789012';

    // 1. Initial processing
    const firstPass = evaluateActivityEvent(
      pet,
      ledger,
      {
        eventId: sha,
        eventType: 'commit',
        actor: 'dev',
        commitMessage: 'feat: something new',
      },
      baseTimestamp
    );

    assert.equal(firstPass.result.status, 'rewarded');
    assert.equal(firstPass.result.xpAwarded, 15);

    // 2. Scheduled reconciliation sweep attempts to process the same commit again
    const sweepPass = evaluateActivityEvent(
      firstPass.updatedPet,
      firstPass.updatedLedger,
      {
        eventId: sha,
        eventType: 'commit',
        actor: 'dev',
        commitMessage: 'feat: something new',
      },
      '2026-11-19T10:30:00.000Z'
    );

    assert.equal(sweepPass.result.status, 'skipped_duplicate');
    assert.equal(sweepPass.result.xpAwarded, 0);
    assert.equal(sweepPass.updatedPet.xp, 15); // Unchanged
  });
});
