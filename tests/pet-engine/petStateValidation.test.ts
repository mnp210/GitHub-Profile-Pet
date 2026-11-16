import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertValidPetState,
  validatePetState,
} from '../../src/features/pet-engine/validation/stateValidator.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

function createValidPet(): PetStateDocument {
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
    lastInteractionTime: '2026-11-15T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T00:00:00.000Z',
  };
}

describe('Pet State Schema Validation (Tests 1-3)', () => {
  it('TC-STATE-01: Validates a canonical valid pet state document', () => {
    const pet = createValidPet();
    const result = validatePetState(pet);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.doesNotThrow(() => assertValidPetState(pet));
  });

  it('TC-STATE-02: Rejects invalid or out-of-bound vitals', () => {
    const petWithHighEnergy = { ...createValidPet(), energy: 101 };
    const resHigh = validatePetState(petWithHighEnergy);
    assert.equal(resHigh.valid, false);
    assert.match(resHigh.errors[0], /energy must be an integer between 0 and 100/);

    const petWithNegativeHunger = { ...createValidPet(), hunger: -1 };
    const resNeg = validatePetState(petWithNegativeHunger);
    assert.equal(resNeg.valid, false);
    assert.match(resNeg.errors[0], /hunger must be an integer between 0 and 100/);

    const petWithFloatingHappiness = { ...createValidPet(), happiness: 50.5 };
    const resFloat = validatePetState(petWithFloatingHappiness);
    assert.equal(resFloat.valid, false);
    assert.match(resFloat.errors[0], /happiness must be an integer/);
  });

  it('TC-STATE-03: Rejects unsupported schema versions', () => {
    const petV2 = { ...createValidPet(), schemaVersion: 2 };
    const resV2 = validatePetState(petV2);
    assert.equal(resV2.valid, false);
    assert.match(resV2.errors[0], /Unsupported schemaVersion: expected 1, received 2/);

    const petV0 = { ...createValidPet(), schemaVersion: 0 };
    const resV0 = validatePetState(petV0);
    assert.equal(resV0.valid, false);
    assert.match(resV0.errors[0], /Unsupported schemaVersion: expected 1, received 0/);
  });

  it('TC-STATE-04: Rejects invalid or out-of-bound energyAccumulator', () => {
    const petNegativeAcc = { ...createValidPet(), energyAccumulator: -0.1 };
    const resNeg = validatePetState(petNegativeAcc);
    assert.equal(resNeg.valid, false);
    assert.match(resNeg.errors[0], /energyAccumulator must be a number between 0 and 1/);

    const petOverAcc = { ...createValidPet(), energyAccumulator: 1.5 };
    const resOver = validatePetState(petOverAcc);
    assert.equal(resOver.valid, false);
    assert.match(resOver.errors[0], /energyAccumulator must be a number between 0 and 1/);
  });
});
