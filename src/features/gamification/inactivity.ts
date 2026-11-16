import { clampVital } from './progression.ts';
import type { PetState } from '../../types/pet.ts';

export const PASSIVE_OFFLINE_ENERGY_RATE_PER_SEC = 0.05; // 3 energy per minute
export const HUNGER_DECAY_RATE_PER_SEC = 0.0001; // ~8.6 points / day
export const HAPPINESS_DECAY_RATE_PER_SEC = 0.0001;

// Ethical gaming bounds (Zero death, zero negative vitals)
export const INACTIVITY_HUNGER_FLOOR = 20;
export const INACTIVITY_HAPPINESS_FLOOR = 40;

// Anti-Exploit thresholds for Welcome-Back Bonus
export const MIN_INACTIVITY_FOR_WELCOME_BONUS_SEC = 24 * 3600; // 24 hours
export const WELCOME_BACK_BONUS_COOLDOWN_MS = 24 * 3600 * 1000; // 24 hours

export interface InactivityResolutionResult {
  elapsedSeconds: number;
  updatedPet: PetState;
  energyRestored: number;
  hungerDecayed: number;
  happinessDecayed: number;
  welcomeBackBonusAvailable: boolean;
  notes: string;
}

export interface WelcomeBackBonusResult {
  claimed: boolean;
  xpAwarded: number;
  happinessRestored: number;
  satietyRestored: number;
  energyRestored: number;
  updatedLastWelcomeBonusAt: number;
  reason?: string;
}

/**
 * Pure function to resolve pet vitals following an offline period.
 * Strictly guarantees that vitals never drop below ethical floors, and energy restores passively.
 */
export function resolveOfflineInactivity(
  pet: PetState,
  elapsedSeconds: number,
  lastWelcomeBonusAt: number | null,
  nowMs: number
): InactivityResolutionResult {
  const safeElapsed = Math.max(0, elapsedSeconds);

  // 1. Passive Energy Recovery (+0.05 energy/sec up to 100)
  const potentialEnergy = pet.energy + Math.floor(safeElapsed * PASSIVE_OFFLINE_ENERGY_RATE_PER_SEC);
  const newEnergy = clampVital(potentialEnergy);
  const energyRestored = newEnergy - pet.energy;

  // 2. Safe Hunger Decay (Floors at 20)
  const potentialHungerLoss = Math.floor(safeElapsed * HUNGER_DECAY_RATE_PER_SEC);
  const newHunger = Math.max(INACTIVITY_HUNGER_FLOOR, pet.hunger - potentialHungerLoss);
  const hungerDecayed = pet.hunger - newHunger;

  // 3. Safe Happiness Decay (Floors at 40)
  const potentialHappinessLoss = Math.floor(safeElapsed * HAPPINESS_DECAY_RATE_PER_SEC);
  const newHappiness = Math.max(INACTIVITY_HAPPINESS_FLOOR, pet.happiness - potentialHappinessLoss);
  const happinessDecayed = pet.happiness - newHappiness;

  // 4. Welcome-Back Bonus Eligibility Check
  const isAbsentLongEnough = safeElapsed >= MIN_INACTIVITY_FOR_WELCOME_BONUS_SEC;
  const isCooldownElapsed =
    lastWelcomeBonusAt === null || nowMs - lastWelcomeBonusAt >= WELCOME_BACK_BONUS_COOLDOWN_MS;
  const welcomeBackBonusAvailable = isAbsentLongEnough && isCooldownElapsed;

  const updatedPet: PetState = {
    ...pet,
    energy: newEnergy,
    hunger: newHunger,
    happiness: newHappiness,
    mood: newEnergy <= 20 ? 'Resting' : pet.mood,
  };

  return {
    elapsedSeconds: safeElapsed,
    updatedPet,
    energyRestored,
    hungerDecayed,
    happinessDecayed,
    welcomeBackBonusAvailable,
    notes: safeElapsed > 86400 * 7
      ? 'Extended absence resolved: Vitals safely maintained above ethical floors with zero regression.'
      : 'Normal offline recovery applied.',
  };
}

/**
 * Claims the Welcome-Back bonus with strict anti-farming idempotency.
 */
export function claimWelcomeBackBonus(
  elapsedSeconds: number,
  lastWelcomeBonusAt: number | null,
  nowMs: number
): WelcomeBackBonusResult {
  if (elapsedSeconds < MIN_INACTIVITY_FOR_WELCOME_BONUS_SEC) {
    return {
      claimed: false,
      xpAwarded: 0,
      happinessRestored: 0,
      satietyRestored: 0,
      energyRestored: 0,
      updatedLastWelcomeBonusAt: lastWelcomeBonusAt ?? 0,
      reason: `Absence too short (${Math.floor(elapsedSeconds / 3600)}h). Requires >= 24h of inactivity.`,
    };
  }

  if (lastWelcomeBonusAt !== null && nowMs - lastWelcomeBonusAt < WELCOME_BACK_BONUS_COOLDOWN_MS) {
    const remainingCooldownHrs = Math.ceil(
      (WELCOME_BACK_BONUS_COOLDOWN_MS - (nowMs - lastWelcomeBonusAt)) / 3600000
    );
    return {
      claimed: false,
      xpAwarded: 0,
      happinessRestored: 0,
      satietyRestored: 0,
      energyRestored: 0,
      updatedLastWelcomeBonusAt: lastWelcomeBonusAt,
      reason: `Welcome-back bonus already claimed recently. Cooldown active for ${remainingCooldownHrs} more hours.`,
    };
  }

  return {
    claimed: true,
    xpAwarded: 25,
    happinessRestored: 15,
    satietyRestored: 15,
    energyRestored: 20,
    updatedLastWelcomeBonusAt: nowMs,
  };
}
