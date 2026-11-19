import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  initDefaultActivityLedger,
  evaluateActivityEvent,
} from '../../src/features/pet-engine/activity/index.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

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
    lastInteractionTime: '2026-11-19T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-19T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T12:00:00.000Z',
    ...overrides,
  };
}

describe('XP Accounting & Boundary Clamping Accuracy (Sprint 4.0)', () => {
  it('20 commits at 15 XP each produce exactly 300 XP from zero daily balance, and 21st gets 0 XP', () => {
    let pet = createMockPet({ level: 1, xp: 0 });
    let ledger = initDefaultActivityLedger();
    const today = '2026-11-19T12:00:00Z';
    const dateKey = '2026-11-19';

    let totalAwarded = 0;

    // Process exactly 20 commits
    for (let i = 1; i <= 20; i++) {
      const sha = i.toString(16).padStart(40, 'a');
      const outcome = evaluateActivityEvent(
        pet,
        ledger,
        {
          eventType: 'commit',
          eventId: `commit:${sha}`,
          actor: 'mnp210',
        },
        today
      );

      assert.equal(outcome.result.status, 'rewarded', `Commit ${i} should be rewarded`);
      assert.equal(outcome.result.xpAwarded, 15, `Commit ${i} should award 15 XP`);

      totalAwarded += outcome.result.xpAwarded;
      pet = outcome.updatedPet;
      ledger = outcome.updatedLedger;
    }

    assert.equal(totalAwarded, 300, '20 commits at 15 XP must equal exactly 300 XP');
    assert.equal(ledger.dailyAccruedXp[dateKey], 300, 'Daily accrued XP must be exactly 300');

    // 21st commit must receive 0 XP and status skipped_daily_cap
    const sha21 = (21).toString(16).padStart(40, 'a');
    const outcome21 = evaluateActivityEvent(
      pet,
      ledger,
      {
        eventType: 'commit',
        eventId: `commit:${sha21}`,
        actor: 'mnp210',
      },
      today
    );

    assert.equal(outcome21.result.status, 'skipped_daily_cap');
    assert.equal(outcome21.result.xpAwarded, 0);
    assert.equal(outcome21.updatedPet.xp, pet.xp, 'Pet XP must remain unchanged on 21st commit');
  });

  it('starting at 135 XP, a new 15 XP event produces exactly 150 XP', () => {
    const pet = createMockPet({ level: 2, xp: 135, maxExp: 200 });
    const ledger = initDefaultActivityLedger();
    const today = '2026-11-19T12:00:00Z';

    const outcome = evaluateActivityEvent(
      pet,
      ledger,
      {
        eventType: 'commit',
        eventId: 'commit:b1c2d3e4f5a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
        actor: 'mnp210',
      },
      today
    );

    assert.equal(outcome.result.status, 'rewarded');
    assert.equal(outcome.result.xpAwarded, 15);
    assert.equal(outcome.result.previousXp, 135);
    assert.equal(outcome.result.newXp, 150);
    assert.equal(outcome.updatedPet.xp, 150);
  });

  it('an event crossing the daily cap is clamped to the exact remaining budget', () => {
    const pet = createMockPet({ level: 2, xp: 50 });
    const ledger = initDefaultActivityLedger();
    const today = '2026-11-19T12:00:00Z';
    const dateKey = '2026-11-19';

    // Set daily accrued to 290 XP (10 XP remaining under the 300 cap)
    ledger.dailyAccruedXp[dateKey] = 290;

    // A commit would normally give 15 XP, but only 10 XP remaining
    const outcome = evaluateActivityEvent(
      pet,
      ledger,
      {
        eventType: 'commit',
        eventId: 'commit:clamp1234567890123456789012345678901234',
        actor: 'mnp210',
      },
      today
    );

    assert.equal(outcome.result.status, 'rewarded');
    assert.equal(outcome.result.xpAwarded, 10, 'Must clamp 15 XP down to remaining 10 XP');
    assert.equal(outcome.updatedPet.xp, 60);
    assert.equal(outcome.updatedLedger.dailyAccruedXp[dateKey], 300);

    // Next event arrives: daily cap is at 300, so must be skipped
    const outcomeNext = evaluateActivityEvent(
      outcome.updatedPet,
      outcome.updatedLedger,
      {
        eventType: 'commit',
        eventId: 'commit:afterclamp1234567890123456789012345678',
        actor: 'mnp210',
      },
      today
    );

    assert.equal(outcomeNext.result.status, 'skipped_daily_cap');
    assert.equal(outcomeNext.result.xpAwarded, 0);
  });

  it('UTC day boundary reset allows a fresh 300 XP on the new date', () => {
    const pet = createMockPet({ level: 1, xp: 0 });
    const ledger = initDefaultActivityLedger();

    const day1Time = '2026-11-19T23:55:00Z';
    ledger.dailyAccruedXp['2026-11-19'] = 300; // Cap reached on day 1

    // Attempt on Day 1: rejected
    const outcomeDay1 = evaluateActivityEvent(
      pet,
      ledger,
      {
        eventType: 'commit',
        eventId: 'commit:latecommit1234567890123456789012345678',
        actor: 'mnp210',
      },
      day1Time
    );
    assert.equal(outcomeDay1.result.status, 'skipped_daily_cap');

    // Attempt on Day 2: allowed full budget
    const day2Time = '2026-11-20T00:05:00Z';
    const outcomeDay2 = evaluateActivityEvent(
      pet,
      ledger,
      {
        eventType: 'commit',
        eventId: 'commit:earlycommit1234567890123456789012345678',
        actor: 'mnp210',
      },
      day2Time
    );

    assert.equal(outcomeDay2.result.status, 'rewarded');
    assert.equal(outcomeDay2.result.xpAwarded, 15);
    assert.equal(outcomeDay2.updatedLedger.dailyAccruedXp['2026-11-20'], 15);
  });
});
