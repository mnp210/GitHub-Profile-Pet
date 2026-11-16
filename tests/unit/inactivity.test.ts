import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOfflineInactivity,
  claimWelcomeBackBonus,
  INACTIVITY_HUNGER_FLOOR,
  INACTIVITY_HAPPINESS_FLOOR,
} from '../../src/features/gamification/inactivity.ts';
import type { PetState } from '../../src/types/pet.ts';

const createMockPet = (overrides?: Partial<PetState>): PetState => ({
  name: 'Shadow Familiar',
  species: 'cat',
  level: 4,
  xp: 318,
  maxExp: 400,
  mood: 'Focused',
  evolutionStage: 'Hatchling',
  hunger: 80,
  happiness: 75,
  energy: 10,
  ...overrides,
});

describe('Inactivity Resolution & Anti-Exploit Mechanics', () => {
  it('handles normal short offline recovery (30 minutes) by restoring energy to full', () => {
    const pet = createMockPet({ energy: 10, hunger: 80, happiness: 75 });
    const elapsedSeconds = 1800; // 30 mins -> 1800 * 0.05 = +90 energy
    const nowMs = 1700000000000;

    const res = resolveOfflineInactivity(pet, elapsedSeconds, null, nowMs);
    // 10 + 90 = 100 (Full energy)
    assert.equal(res.updatedPet.energy, 100);
    assert.equal(res.energyRestored, 90);
    // 30 mins is not enough for welcome-back bonus (requires 24h)
    assert.equal(res.welcomeBackBonusAvailable, false);
  });

  it('guarantees zero-death and floor clamping during 14 days of inactivity', () => {
    const pet = createMockPet({ energy: 5, hunger: 90, happiness: 80, level: 4, xp: 318 });
    const elapsedSeconds = 14 * 86400; // 14 days
    const nowMs = 1700000000000;

    const res = resolveOfflineInactivity(pet, elapsedSeconds, null, nowMs);

    // Energy recovers to 100
    assert.equal(res.updatedPet.energy, 100);
    // Hunger never drops below ethical floor (20)
    assert.ok(res.updatedPet.hunger >= INACTIVITY_HUNGER_FLOOR);
    assert.equal(res.updatedPet.hunger, 20);
    // Happiness never drops below ethical floor (40)
    assert.ok(res.updatedPet.happiness >= INACTIVITY_HAPPINESS_FLOOR);
    assert.equal(res.updatedPet.happiness, 40);
    // Level and XP remain completely untouched (Zero regression)
    assert.equal(res.updatedPet.level, 4);
    assert.equal(res.updatedPet.xp, 318);
    // Welcome back bonus is available
    assert.equal(res.welcomeBackBonusAvailable, true);
  });

  it('guarantees zero-death and floor clamping during 30 days of inactivity', () => {
    const pet = createMockPet({ energy: 0, hunger: 50, happiness: 50, level: 10, xp: 500 });
    const elapsedSeconds = 30 * 86400; // 30 days
    const nowMs = 1700000000000;

    const res = resolveOfflineInactivity(pet, elapsedSeconds, null, nowMs);

    assert.equal(res.updatedPet.energy, 100);
    assert.equal(res.updatedPet.hunger, INACTIVITY_HUNGER_FLOOR);
    assert.equal(res.updatedPet.happiness, INACTIVITY_HAPPINESS_FLOOR);
    assert.equal(res.updatedPet.level, 10);
    assert.equal(res.updatedPet.xp, 500);
    assert.equal(res.welcomeBackBonusAvailable, true);
  });

  it('prevents welcome-back bonus exploitation across repeated logins and logouts', () => {
    const absentSeconds = 14 * 86400; // User was gone 14 days
    let nowMs = 1700000000000;

    // First login: Welcome back bonus is claimed successfully
    const claim1 = claimWelcomeBackBonus(absentSeconds, null, nowMs);
    assert.equal(claim1.claimed, true);
    assert.equal(claim1.xpAwarded, 25);
    const lastClaimAt = claim1.updatedLastWelcomeBonusAt;

    // Immediate logout & login 10 seconds later:
    const relogin1 = claimWelcomeBackBonus(10, lastClaimAt, nowMs + 10_000);
    assert.equal(relogin1.claimed, false);
    assert.match(relogin1.reason || '', /Absence too short/);

    // Relogin after 2 hours:
    const relogin2 = claimWelcomeBackBonus(7200, lastClaimAt, nowMs + 7_200_000);
    assert.equal(relogin2.claimed, false);
    assert.match(relogin2.reason || '', /Absence too short/);

    // Relogin after 25 hours (absence >= 24h AND cooldown >= 24h):
    nowMs += 25 * 3600 * 1000;
    const legitimateSecondBonus = claimWelcomeBackBonus(25 * 3600, lastClaimAt, nowMs);
    assert.equal(legitimateSecondBonus.claimed, true);
    assert.equal(legitimateSecondBonus.xpAwarded, 25);
  });
});
