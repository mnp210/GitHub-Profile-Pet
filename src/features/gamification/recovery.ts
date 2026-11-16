import { clampVital } from './progression.ts';

export const REST_ENERGY_RESTORE_PER_ACTION = 25; // Instant single-action rest boost
export const REST_ENERGY_RESTORE_RATE_PER_SECOND = 2; // Gradual passive restoration: 2 energy/sec

/**
 * Calculates energy restored based on elapsed time while in a resting state.
 */
export function calculateElapsedRestRecovery(
  elapsedSeconds: number,
  currentEnergy: number,
  ratePerSec: number = REST_ENERGY_RESTORE_RATE_PER_SECOND
): { newEnergy: number; energyRestored: number } {
  if (elapsedSeconds <= 0) {
    return { newEnergy: currentEnergy, energyRestored: 0 };
  }
  const potentialRestored = Math.floor(elapsedSeconds * ratePerSec);
  const newEnergy = clampVital(currentEnergy + potentialRestored);
  const actualRestored = newEnergy - currentEnergy;

  return { newEnergy, energyRestored: actualRestored };
}

/**
 * Calculates energy restoration for a single direct REST action.
 */
export function applyRestAction(currentEnergy: number): { newEnergy: number; energyRestored: number } {
  const newEnergy = clampVital(currentEnergy + REST_ENERGY_RESTORE_PER_ACTION);
  return {
    newEnergy,
    energyRestored: newEnergy - currentEnergy,
  };
}
