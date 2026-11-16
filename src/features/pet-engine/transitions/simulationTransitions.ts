/**
 * GitHub Profile Pet - Simulation Transitions
 * Deterministic offline inactivity simulation, passive energy recovery, and safe ethical floors.
 */

import {
  INACTIVITY_HAPPINESS_FLOOR,
  INACTIVITY_HUNGER_FLOOR,
  MIN_INACTIVITY_FOR_WELCOME_BONUS_SEC,
  PASSIVE_OFFLINE_ENERGY_RATE_PER_SEC,
  WELCOME_BACK_BONUS_COOLDOWN_MS,
} from '../domain/constants.ts';
import type { PetStateDocument } from '../domain/types.ts';
import { resolveSimulationCheckpoint } from '../simulation/simulationCheckpoint.ts';
import { derivePetMoodFromVitals } from './progressionEngine.ts';

export const DECAY_FIXED_POINT_SCALE = 10_000_000; // 10M units = 1 vitals point (1 ms = 1 decay unit at 0.0001 points/sec)

export interface InactivitySimulationResult {
  nextPetState: PetStateDocument;
  elapsedSeconds: number;
  energyRestored: number;
  hungerDecayed: number;
  happinessDecayed: number;
  welcomeBackBonusEligible: boolean;
  notes: string;
}

export function applyInactivitySimulation(
  pet: PetStateDocument,
  nowMs: number
): InactivitySimulationResult {
  const { checkpointMs } = resolveSimulationCheckpoint(pet, nowMs);

  if (nowMs < checkpointMs) {
    return {
      nextPetState: { ...pet },
      elapsedSeconds: 0,
      energyRestored: 0,
      hungerDecayed: 0,
      happinessDecayed: 0,
      welcomeBackBonusEligible: false,
      notes: 'Clock regression detected: current time is earlier than simulation checkpoint; state left unchanged.',
    };
  }

  const elapsedMs = nowMs - checkpointMs;

  if (elapsedMs <= 0) {
    return {
      nextPetState: { ...pet },
      elapsedSeconds: 0,
      energyRestored: 0,
      hungerDecayed: 0,
      happinessDecayed: 0,
      welcomeBackBonusEligible: false,
      notes: 'No elapsed time since last simulation.',
    };
  }

  const elapsedSeconds = elapsedMs / 1000;

  // 1. Passive Energy Recovery (+0.05 energy/sec up to 100) with persistent fractional accumulator
  const currentAccumulator =
    typeof pet.energyAccumulator === 'number' && !Number.isNaN(pet.energyAccumulator)
      ? pet.energyAccumulator
      : 0;

  const totalEnergyUnits = elapsedSeconds * PASSIVE_OFFLINE_ENERGY_RATE_PER_SEC + currentAccumulator;
  let newEnergy = pet.energy;
  let newAccumulator = currentAccumulator;
  let energyRestored = 0;

  if (pet.energy >= 100) {
    newEnergy = 100;
    newAccumulator = 0;
  } else {
    const integerGain = Math.floor(totalEnergyUnits);
    const fractionalRemainder = totalEnergyUnits - integerGain;
    const clampedGain = Math.min(100 - pet.energy, integerGain);
    newEnergy = pet.energy + clampedGain;
    energyRestored = clampedGain;

    if (newEnergy >= 100) {
      newAccumulator = 0;
    } else {
      newAccumulator = Math.round(fractionalRemainder * 1_000_000) / 1_000_000;
      if (newAccumulator >= 1.0) {
        newAccumulator = 0.999999;
      }
    }
  }

  // 2. Safe Hunger Decay (Floors at 20) with exact fixed-point integer sub-second arithmetic
  const currentHungerAcc =
    typeof pet.hungerDecayAccumulator === 'number' && !Number.isNaN(pet.hungerDecayAccumulator)
      ? pet.hungerDecayAccumulator
      : 0;

  let newHunger = pet.hunger;
  let newHungerAcc = 0;
  let hungerDecayed = 0;

  if (pet.hunger <= INACTIVITY_HUNGER_FLOOR) {
    newHunger = INACTIVITY_HUNGER_FLOOR;
    newHungerAcc = 0;
    hungerDecayed = 0;
  } else {
    // 1 ms = 1 decay unit at 0.0001 points/sec (scale: 10,000,000 units/point)
    const currentHungerUnits = Math.round(currentHungerAcc * DECAY_FIXED_POINT_SCALE);
    const totalHungerUnits = elapsedMs + currentHungerUnits;
    const integerHungerLoss = Math.floor(totalHungerUnits / DECAY_FIXED_POINT_SCALE);
    const remainderHungerUnits = totalHungerUnits % DECAY_FIXED_POINT_SCALE;

    if (pet.hunger - integerHungerLoss <= INACTIVITY_HUNGER_FLOOR) {
      newHunger = INACTIVITY_HUNGER_FLOOR;
      hungerDecayed = pet.hunger - INACTIVITY_HUNGER_FLOOR;
      newHungerAcc = 0;
    } else {
      newHunger = pet.hunger - integerHungerLoss;
      hungerDecayed = integerHungerLoss;
      newHungerAcc = remainderHungerUnits / DECAY_FIXED_POINT_SCALE;
    }
  }

  // 3. Safe Happiness Decay (Floors at 40) with exact fixed-point integer sub-second arithmetic
  const currentHappinessAcc =
    typeof pet.happinessDecayAccumulator === 'number' && !Number.isNaN(pet.happinessDecayAccumulator)
      ? pet.happinessDecayAccumulator
      : 0;

  let newHappiness = pet.happiness;
  let newHappinessAcc = 0;
  let happinessDecayed = 0;

  if (pet.happiness <= INACTIVITY_HAPPINESS_FLOOR) {
    newHappiness = INACTIVITY_HAPPINESS_FLOOR;
    newHappinessAcc = 0;
    happinessDecayed = 0;
  } else {
    // 1 ms = 1 decay unit at 0.0001 points/sec (scale: 10,000,000 units/point)
    const currentHappinessUnits = Math.round(currentHappinessAcc * DECAY_FIXED_POINT_SCALE);
    const totalHappinessUnits = elapsedMs + currentHappinessUnits;
    const integerHappinessLoss = Math.floor(totalHappinessUnits / DECAY_FIXED_POINT_SCALE);
    const remainderHappinessUnits = totalHappinessUnits % DECAY_FIXED_POINT_SCALE;

    if (pet.happiness - integerHappinessLoss <= INACTIVITY_HAPPINESS_FLOOR) {
      newHappiness = INACTIVITY_HAPPINESS_FLOOR;
      happinessDecayed = pet.happiness - INACTIVITY_HAPPINESS_FLOOR;
      newHappinessAcc = 0;
    } else {
      newHappiness = pet.happiness - integerHappinessLoss;
      happinessDecayed = integerHappinessLoss;
      newHappinessAcc = remainderHappinessUnits / DECAY_FIXED_POINT_SCALE;
    }
  }

  // 4. Welcome-Back Bonus Eligibility Check
  const lastBonusMs = pet.lastWelcomeBonusClaimedAt
    ? new Date(pet.lastWelcomeBonusClaimedAt).getTime()
    : null;
  const isAbsentLongEnough = elapsedSeconds >= MIN_INACTIVITY_FOR_WELCOME_BONUS_SEC;
  const isCooldownElapsed =
    lastBonusMs === null || nowMs - lastBonusMs >= WELCOME_BACK_BONUS_COOLDOWN_MS;
  const welcomeBackBonusEligible = isAbsentLongEnough && isCooldownElapsed;

  const newMood = derivePetMoodFromVitals({
    energy: newEnergy,
    hunger: newHunger,
    happiness: newHappiness,
  });

  const nextIso = new Date(nowMs).toISOString();

  const nextPetState: PetStateDocument = {
    ...pet,
    energy: newEnergy,
    energyAccumulator: newAccumulator,
    hunger: newHunger,
    hungerDecayAccumulator: newHungerAcc,
    happiness: newHappiness,
    happinessDecayAccumulator: newHappinessAcc,
    mood: newMood,
    lastSimulatedAt: nextIso,
    lastOfflineResolutionTime: nextIso,
    updatedAt: nextIso,
  };

  return {
    nextPetState,
    elapsedSeconds,
    energyRestored,
    hungerDecayed,
    happinessDecayed,
    welcomeBackBonusEligible,
    notes:
      elapsedSeconds > 86400 * 7
        ? 'Extended absence resolved: Vitals safely maintained above ethical floors with zero regression.'
        : 'Normal offline recovery applied.',
  };
}
