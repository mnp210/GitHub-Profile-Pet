/**
 * GitHub Profile Pet - Progression Engine
 * Pure mathematical formulas for XP thresholds, multi-level jumps, evolution, and mood.
 */

import {
  addExperience,
  calculateCumulativeXpForLevel,
  calculateLevelFromTotalXp,
  calculateMaxExp,
  clampVital,
  deriveEvolutionStage,
  deriveMood,
} from '../../gamification/progression.ts';
import type { EvolutionStage, PetMood } from '../domain/types.ts';

export {
  addExperience,
  calculateCumulativeXpForLevel,
  calculateLevelFromTotalXp,
  calculateMaxExp,
  clampVital,
  deriveEvolutionStage,
  deriveMood,
};

export interface ProgressionUpdate {
  newLevel: number;
  newXp: number;
  newMaxExp: number;
  newEvolutionStage: EvolutionStage;
  didLevelUp: boolean;
  levelsGained: number;
}

export function applyExperience(
  currentLevel: number,
  currentXp: number,
  xpGained: number
): ProgressionUpdate {
  const result = addExperience(currentLevel, currentXp, xpGained);
  const stage = deriveEvolutionStage(result.newLevel) as EvolutionStage;

  return {
    newLevel: result.newLevel,
    newXp: result.newXp,
    newMaxExp: result.maxExp,
    newEvolutionStage: stage,
    didLevelUp: result.didLevelUp,
    levelsGained: result.levelsGained,
  };
}

export function derivePetMoodFromVitals(vitals: {
  energy: number;
  hunger: number;
  happiness: number;
}): PetMood {
  return deriveMood(vitals);
}
