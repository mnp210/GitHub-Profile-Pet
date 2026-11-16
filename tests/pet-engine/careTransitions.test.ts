import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeCareAction } from '../../src/features/pet-engine/transitions/careTransitions.ts';
import type { PetStateDocument, RecentActionEntry } from '../../src/features/pet-engine/domain/types.ts';

function createTestPet(overrides: Partial<PetStateDocument> = {}): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 1,
    xp: 0,
    maxExp: 100,
    energy: 50,
    energyAccumulator: 0,
    hunger: 50,
    happiness: 50,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-15T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T00:00:00.000Z',
    ...overrides,
  };
}

const BASE_TEST_MS = new Date('2026-11-15T12:00:00.000Z').getTime();

describe('Care Transitions Engine (Tests 4-8)', () => {
  it('TC-CARE-01: Feeding increases satiety (hunger) and awards base XP', () => {
    const pet = createTestPet({ hunger: 50, xp: 0 });
    const nowMs = BASE_TEST_MS;
    const history: RecentActionEntry[] = [];

    const result = executeCareAction({
      pet,
      action: 'feed',
      history,
      nowMs,
      requestId: 'issue-10',
    });

    assert.equal(result.outcome.success, true);
    assert.equal(result.outcome.xpGained, 10);
    assert.equal(result.nextPetState.hunger, 74); // 50 + 24
    assert.equal(result.nextPetState.xp, 10);
    assert.equal(result.nextRecentActions.length, 1);
  });

  it('TC-CARE-02: Feeding is rejected when pet is at maximum satiety (100)', () => {
    const pet = createTestPet({ hunger: 100 });
    const nowMs = BASE_TEST_MS;
    const history: RecentActionEntry[] = [];

    const result = executeCareAction({
      pet,
      action: 'feed',
      history,
      nowMs,
      requestId: 'issue-11',
    });

    assert.equal(result.outcome.success, false);
    assert.match(result.outcome.rejectedReason || '', /Satiety Full/);
    assert.equal(result.nextPetState.hunger, 100);
    assert.equal(result.nextPetState.xp, pet.xp);
  });

  it('TC-CARE-03: Training costs 18 energy, increases happiness and awards XP', () => {
    const pet = createTestPet({ energy: 50, happiness: 50, xp: 0 });
    const nowMs = BASE_TEST_MS;
    const history: RecentActionEntry[] = [];

    const result = executeCareAction({
      pet,
      action: 'train',
      history,
      nowMs,
      requestId: 'issue-12',
    });

    assert.equal(result.outcome.success, true);
    assert.equal(result.outcome.xpGained, 30);
    assert.equal(result.nextPetState.energy, 32); // 50 - 18
    assert.equal(result.nextPetState.happiness, 54); // 50 + 4
    assert.equal(result.nextPetState.xp, 30);
  });

  it('TC-CARE-04: Training is rejected when pet has insufficient energy (< 18)', () => {
    const pet = createTestPet({ energy: 15 });
    const nowMs = BASE_TEST_MS;
    const history: RecentActionEntry[] = [];

    const result = executeCareAction({
      pet,
      action: 'train',
      history,
      nowMs,
      requestId: 'issue-13',
    });

    assert.equal(result.outcome.success, false);
    assert.match(result.outcome.rejectedReason || '', /Insufficient Energy/);
    assert.equal(result.nextPetState.energy, 15);
    assert.equal(result.nextPetState.xp, pet.xp);
  });

  it('TC-CARE-05: Resting restores energy (+25) and awards strictly 0 XP', () => {
    const pet = createTestPet({ energy: 20, xp: 50 });
    const nowMs = BASE_TEST_MS;
    const history: RecentActionEntry[] = [];

    const result = executeCareAction({
      pet,
      action: 'rest',
      history,
      nowMs,
      requestId: 'issue-14',
    });

    assert.equal(result.outcome.success, true);
    assert.equal(result.outcome.xpGained, 0); // Strictly 0 XP
    assert.equal(result.nextPetState.energy, 45); // 20 + 25
    assert.equal(result.nextPetState.xp, 50); // Unchanged XP
  });

  it('TC-CARE-06: Strict 60-second cooldown is enforced between consecutive care actions', () => {
    const pet = createTestPet({ energy: 80, hunger: 50 });
    const t0 = BASE_TEST_MS;
    const history: RecentActionEntry[] = [{ action: 'feed', timestamp: t0, requestId: 'issue-15' }];

    // Attempt action at T + 30 seconds (< 60s cooldown)
    const t30s = t0 + 30_000;
    const resultRejected = executeCareAction({
      pet,
      action: 'train',
      history,
      nowMs: t30s,
      requestId: 'issue-16',
    });

    assert.equal(resultRejected.outcome.success, false);
    assert.match(resultRejected.outcome.rejectedReason || '', /Action Cooldown/);

    // Attempt action at T + 61 seconds (>= 60s cooldown)
    const t61s = t0 + 61_000;
    const resultAllowed = executeCareAction({
      pet,
      action: 'train',
      history,
      nowMs: t61s,
      requestId: 'issue-17',
    });

    assert.equal(resultAllowed.outcome.success, true);
  });

  it('TC-CARE-07: Diminishing returns apply to repeated actions within rolling 60s window', () => {
    const pet = createTestPet({ hunger: 20, xp: 0 });
    const baseTime = BASE_TEST_MS;

    // Simulate 1st use: multiplier 1.0 (baseExp 10)
    const r1 = executeCareAction({
      pet,
      action: 'feed',
      history: [],
      nowMs: baseTime,
      requestId: 'issue-21',
    });
    assert.equal(r1.outcome.diminishingMultiplier, 1.0);
    assert.equal(r1.outcome.xpGained, 10);

    // If second action occurs after cooldown outside 60s window, multiplier is 1.0 again
    const r2AfterWindow = executeCareAction({
      pet: r1.nextPetState,
      action: 'feed',
      history: r1.nextRecentActions,
      nowMs: baseTime + 65_000,
      requestId: 'issue-22',
    });
    assert.equal(r2AfterWindow.outcome.diminishingMultiplier, 1.0);
    assert.equal(r2AfterWindow.outcome.xpGained, 10);
  });

  it('TC-CARE-08: Stale event is rejected when created_at < lastInteractionTime', () => {
    // Pet was interacted with at 10:15:00 UTC
    const pet = createTestPet({
      lastInteractionTime: '2026-11-15T10:15:00.000Z',
    });

    // Stale action arrived late with creation timestamp 10:00:00 UTC
    const staleTimeMs = new Date('2026-11-15T10:00:00.000Z').getTime();
    const result = executeCareAction({
      pet,
      action: 'feed',
      history: [],
      nowMs: staleTimeMs,
      requestId: 'issue-51',
    });

    assert.equal(result.outcome.success, false);
    assert.match(result.outcome.rejectedReason || '', /Stale Action/);
    assert.match(result.outcome.rejectedReason || '', /Actions must be processed in chronological sequence/);
    // State unchanged
    assert.equal(result.nextPetState.generation, pet.generation);
    assert.equal(result.nextPetState.hunger, pet.hunger);
    assert.equal(result.nextPetState.lastInteractionTime, pet.lastInteractionTime);
  });

  it('TC-CARE-09: Care actions preserve energyAccumulator and exact energy costs', () => {
    const pet = createTestPet({
      energy: 50,
      energyAccumulator: 0.75,
    });

    const nowMs = new Date('2026-11-15T10:30:00.000Z').getTime();
    const result = executeCareAction({
      pet,
      action: 'train',
      history: [],
      nowMs,
      requestId: 'issue-60',
    });

    assert.equal(result.outcome.success, true);
    // Training costs exact 18 energy: 50 - 18 = 32
    assert.equal(result.nextPetState.energy, 32);
    // Fractional recovery accumulator is completely preserved
    assert.equal(result.nextPetState.energyAccumulator, 0.75);
  });
});
