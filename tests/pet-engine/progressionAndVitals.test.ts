import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyExperience,
  calculateCumulativeXpForLevel,
  calculateLevelFromTotalXp,
  deriveEvolutionStage,
  derivePetMoodFromVitals,
} from '../../src/features/pet-engine/transitions/progressionEngine.ts';
import { applyInactivitySimulation } from '../../src/features/pet-engine/transitions/simulationTransitions.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

describe('Progression & Vitals Simulation (Tests 9-10)', () => {
  it('TC-PROG-01: Multi-level overflow carryover accurately handles multi-level jumps', () => {
    // Level 1: needs 100 XP to reach Level 2.
    // Level 2: needs 200 XP to reach Level 3.
    // Adding 350 XP to Level 1 (0 XP):
    // 350 - 100 = 250 (Level 2)
    // 250 - 200 = 50 (Level 3, with 50 current XP, maxExp 300)
    const result = applyExperience(1, 0, 350);

    assert.equal(result.didLevelUp, true);
    assert.equal(result.levelsGained, 2);
    assert.equal(result.newLevel, 3);
    assert.equal(result.newXp, 50);
    assert.equal(result.newMaxExp, 300);
    assert.equal(result.newEvolutionStage, 'Hatchling');
  });

  it('TC-PROG-02: Cumulative total XP matches TotalXP(L) = 50 * L * (L - 1)', () => {
    // L1 -> 0 XP
    assert.equal(calculateCumulativeXpForLevel(1), 0);
    // L2 -> 100 XP
    assert.equal(calculateCumulativeXpForLevel(2), 100);
    // L5 -> 1000 XP
    assert.equal(calculateCumulativeXpForLevel(5), 1000);
    // L10 -> 4500 XP
    assert.equal(calculateCumulativeXpForLevel(10), 4500);
    // L20 -> 19000 XP
    assert.equal(calculateCumulativeXpForLevel(20), 19000);

    // Exact inverse function verification
    const stateAt1000 = calculateLevelFromTotalXp(1000);
    assert.equal(stateAt1000.level, 5);
    assert.equal(stateAt1000.currentXp, 0);

    const stateAt1050 = calculateLevelFromTotalXp(1050);
    assert.equal(stateAt1050.level, 5);
    assert.equal(stateAt1050.currentXp, 50);
    assert.equal(stateAt1050.maxExp, 500);
  });

  it('TC-PROG-03: Evolution stage transitions at exact level milestones', () => {
    assert.equal(deriveEvolutionStage(1), 'Hatchling');
    assert.equal(deriveEvolutionStage(4), 'Hatchling');
    assert.equal(deriveEvolutionStage(5), 'Juvenile');
    assert.equal(deriveEvolutionStage(9), 'Juvenile');
    assert.equal(deriveEvolutionStage(10), 'Ascended');
    assert.equal(deriveEvolutionStage(19), 'Ascended');
    assert.equal(deriveEvolutionStage(20), 'Celestial');
    assert.equal(deriveEvolutionStage(50), 'Celestial');
  });

  it('TC-PROG-04: Deterministic mood derivation across diverse vital combinations', () => {
    // Energy <= 20 -> Resting
    assert.equal(derivePetMoodFromVitals({ energy: 15, hunger: 80, happiness: 80 }), 'Resting');
    // Hunger <= 25 -> Curious
    assert.equal(derivePetMoodFromVitals({ energy: 50, hunger: 20, happiness: 80 }), 'Curious');
    // Happiness >= 80 & Energy >= 50 -> Energetic
    assert.equal(derivePetMoodFromVitals({ energy: 60, hunger: 60, happiness: 85 }), 'Energetic');
    // Happiness >= 60 -> Happy
    assert.equal(derivePetMoodFromVitals({ energy: 40, hunger: 60, happiness: 65 }), 'Happy');
    // Default -> Focused
    assert.equal(derivePetMoodFromVitals({ energy: 40, hunger: 60, happiness: 45 }), 'Focused');
  });

  it('TC-PROG-05: Offline inactivity simulation enforces ethical floors and passive recovery', () => {
    const pet: PetStateDocument = {
      schemaVersion: 1,
      generation: 1,
      name: 'Shadow Claw',
      species: 'cat',
      level: 5,
      xp: 0,
      maxExp: 500,
      energy: 10,
      energyAccumulator: 0,
      hunger: 30,
      happiness: 45,
      mood: 'Resting',
      evolutionStage: 'Juvenile',
      lastInteractionTime: '2026-11-01T00:00:00.000Z',
      lastOfflineResolutionTime: '2026-11-01T00:00:00.000Z',
      lastWelcomeBonusClaimedAt: null,
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    // Simulate 30 days of offline absence (2,592,000 seconds)
    const thirtyDaysLaterMs = new Date('2026-12-01T00:00:00.000Z').getTime();
    const result = applyInactivitySimulation(pet, thirtyDaysLaterMs);

    // Energy recovered passively to 100
    assert.equal(result.nextPetState.energy, 100);
    // Hunger decayed but safely stopped at ethical floor of 20
    assert.equal(result.nextPetState.hunger, 20);
    // Happiness decayed but safely stopped at ethical floor of 40
    assert.equal(result.nextPetState.happiness, 40);
    // Zero death, zero negative stats, welcome back bonus eligible
    assert.equal(result.welcomeBackBonusEligible, true);
  });

  it('TC-PROG-06: Fractional energy precision produces identical results regardless of update frequency', () => {
    // Initial state: energy 50, accumulator 0, t0 = 0s
    const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
    const initialPet: PetStateDocument = {
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
    };

    // Scenario A: 6 consecutive simulation updates of 10 seconds each (total 60s)
    let petA = { ...initialPet };
    for (let i = 1; i <= 6; i++) {
      const stepTime = t0 + i * 10_000;
      const res = applyInactivitySimulation(petA, stepTime);
      petA = res.nextPetState;
    }

    // Scenario B: 1 single simulation update of 60 seconds
    const petB = applyInactivitySimulation(initialPet, t0 + 60_000).nextPetState;

    // Both scenarios must yield identical energy and identical accumulator!
    // 60s * 0.05 energy/sec = 3.0 energy gained
    assert.equal(petA.energy, 53);
    assert.equal(petB.energy, 53);
    assert.equal(petA.energyAccumulator, 0);
    assert.equal(petB.energyAccumulator, 0);
    assert.equal(petA.energy, petB.energy);
    assert.equal(petA.energyAccumulator, petB.energyAccumulator);
  });

  it('TC-PROG-07: Energy accumulator resets to 0 when energy reaches maximum ceiling of 100', () => {
    const t0 = new Date('2026-11-15T00:00:00.000Z').getTime();
    const petNearCap: PetStateDocument = {
      schemaVersion: 1,
      generation: 1,
      name: 'Shadow Claw',
      species: 'cat',
      level: 1,
      xp: 0,
      maxExp: 100,
      energy: 99,
      energyAccumulator: 0.8,
      hunger: 50,
      happiness: 50,
      mood: 'Happy',
      evolutionStage: 'Hatchling',
      lastInteractionTime: '2026-11-15T00:00:00.000Z',
      lastOfflineResolutionTime: '2026-11-15T00:00:00.000Z',
      lastWelcomeBonusClaimedAt: null,
      updatedAt: '2026-11-15T00:00:00.000Z',
    };

    // 10s elapsed: 10 * 0.05 = 0.5. Total = 0.5 + 0.8 = 1.3 -> energy +1 hits 100.
    const res = applyInactivitySimulation(petNearCap, t0 + 10_000);
    assert.equal(res.nextPetState.energy, 100);
    assert.equal(res.nextPetState.energyAccumulator, 0);
  });
});
