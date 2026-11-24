/**
 * GitHub Profile Pet - Progression & Achievement Engine
 * Sprint 5.2A: Pet Progression, Achievement System & Unlockable Cosmetics
 */

import type {
  ProgressionState,
  ProgressionStats,
  CosmeticId,
  AchievementId,
  CosmeticCategory,
  EquippedCosmetics,
  AchievementStatus,
} from './types.ts';
import { COSMETICS_CATALOG, DEFAULT_UNLOCKED_COSMETICS } from './cosmeticsCatalog.ts';
import { ACHIEVEMENTS_LIST } from './achievementsCatalog.ts';
import type { PersonalityType } from '../../types/pet.ts';

export const CURRENT_PROGRESSION_SCHEMA_VERSION = 1;

export function getTodayUtcDateString(): string {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createInitialProgressionStats(initialPersonality: PersonalityType = 'curious'): ProgressionStats {
  return {
    totalInteractions: 0,
    totalCareActions: 0,
    personalitiesExplored: [initialPersonality],
    cosmeticsEquippedCount: 0,
    miniGamesPlayed: 0,
    miniGamesCompleted: {},
    starCatcherHighScore: 0,
    memorySparksMaxRound: 0,
    companionRhythmHighScore: 0,
    distinctSessionDates: [getTodayUtcDateString()],
  };
}

export function createInitialProgressionState(initialPersonality: PersonalityType = 'curious'): ProgressionState {
  return {
    schemaVersion: CURRENT_PROGRESSION_SCHEMA_VERSION,
    inventory: [...DEFAULT_UNLOCKED_COSMETICS],
    equipped: {
      accessory: null,
      effect: null,
      environment: 'void_chamber',
      decoration: null,
    },
    achievements: {},
    stats: createInitialProgressionStats(initialPersonality),
  };
}

export interface EvaluationResult {
  updatedState: ProgressionState;
  newlyUnlockedAchievements: AchievementId[];
  newlyUnlockedCosmetics: CosmeticId[];
}

/**
 * Deterministically evaluates all achievements against the current state and inventory.
 * Idempotent: Never duplicates unlocks or mutates already-earned timestamps.
 */
export function evaluateAchievements(state: ProgressionState): EvaluationResult {
  const newlyUnlockedAchievements: AchievementId[] = [];
  const newlyUnlockedCosmetics: CosmeticId[] = [];
  const updatedAchievements = { ...state.achievements };
  const updatedInventorySet = new Set<CosmeticId>(state.inventory);

  for (const def of ACHIEVEMENTS_LIST) {
    const existing = updatedAchievements[def.id];
    if (existing && existing.unlockedAt !== null) {
      // Already unlocked previously, maintain idempotence
      continue;
    }

    const progress = def.calculateProgress(state.stats, Array.from(updatedInventorySet), state.equipped);
    if (progress.completed) {
      updatedAchievements[def.id] = { unlockedAt: Date.now() };
      newlyUnlockedAchievements.push(def.id);

      if (def.rewardCosmeticId && COSMETICS_CATALOG[def.rewardCosmeticId]) {
        if (!updatedInventorySet.has(def.rewardCosmeticId)) {
          updatedInventorySet.add(def.rewardCosmeticId);
          newlyUnlockedCosmetics.push(def.rewardCosmeticId);
        }
      }
    }
  }

  const updatedState: ProgressionState = {
    ...state,
    achievements: updatedAchievements,
    inventory: Array.from(updatedInventorySet),
  };

  return {
    updatedState,
    newlyUnlockedAchievements,
    newlyUnlockedCosmetics,
  };
}

/**
 * Equips a cosmetic item owned in the inventory.
 */
export function equipCosmetic(
  state: ProgressionState,
  cosmeticId: CosmeticId
): { nextState: ProgressionState; error?: string } {
  const meta = COSMETICS_CATALOG[cosmeticId];
  if (!meta) {
    return { nextState: state, error: `Unknown cosmetic item '${cosmeticId}'` };
  }

  if (!state.inventory.includes(cosmeticId)) {
    return { nextState: state, error: `Cosmetic '${meta.name}' is locked or not owned` };
  }

  const nextEquipped: EquippedCosmetics = {
    ...state.equipped,
    [meta.category]: cosmeticId,
  };

  const nextStats: ProgressionStats = {
    ...state.stats,
    cosmeticsEquippedCount: state.stats.cosmeticsEquippedCount + 1,
  };

  const intermediateState: ProgressionState = {
    ...state,
    equipped: nextEquipped,
    stats: nextStats,
  };

  // Re-evaluate achievements (e.g. first_cosmetic_equipped, full_ensemble)
  const evalResult = evaluateAchievements(intermediateState);
  return { nextState: evalResult.updatedState };
}

/**
 * Unequips a cosmetic item from a given slot.
 * If slot is environment, safely falls back to 'void_chamber'.
 */
export function unequipCosmetic(
  state: ProgressionState,
  category: CosmeticCategory
): ProgressionState {
  const nextEquipped: EquippedCosmetics = {
    ...state.equipped,
    [category]: category === 'environment' ? 'void_chamber' : null,
  };

  const intermediateState: ProgressionState = {
    ...state,
    equipped: nextEquipped,
  };

  return evaluateAchievements(intermediateState).updatedState;
}

/**
 * Resets all cosmetics to default appearance.
 */
export function resetCosmeticsToDefault(state: ProgressionState): ProgressionState {
  const nextEquipped: EquippedCosmetics = {
    accessory: null,
    effect: null,
    environment: 'void_chamber',
    decoration: null,
  };

  return {
    ...state,
    equipped: nextEquipped,
  };
}

/**
 * Records a direct interaction (tap / stroke) on the companion.
 */
export function recordInteraction(state: ProgressionState): EvaluationResult {
  const today = getTodayUtcDateString();
  const dates = state.stats.distinctSessionDates.includes(today)
    ? state.stats.distinctSessionDates
    : [...state.stats.distinctSessionDates, today];

  const nextStats: ProgressionStats = {
    ...state.stats,
    totalInteractions: state.stats.totalInteractions + 1,
    distinctSessionDates: dates,
  };

  return evaluateAchievements({ ...state, stats: nextStats });
}

/**
 * Records a care action (feed, play, train, rest).
 */
export function recordCareAction(state: ProgressionState): EvaluationResult {
  const today = getTodayUtcDateString();
  const dates = state.stats.distinctSessionDates.includes(today)
    ? state.stats.distinctSessionDates
    : [...state.stats.distinctSessionDates, today];

  const nextStats: ProgressionStats = {
    ...state.stats,
    totalCareActions: state.stats.totalCareActions + 1,
    distinctSessionDates: dates,
  };

  return evaluateAchievements({ ...state, stats: nextStats });
}

/**
 * Records exploring a new companion personality archetype.
 */
export function recordPersonalityExplored(
  state: ProgressionState,
  personality: PersonalityType
): EvaluationResult {
  if (state.stats.personalitiesExplored.includes(personality)) {
    return { updatedState: state, newlyUnlockedAchievements: [], newlyUnlockedCosmetics: [] };
  }

  const nextStats: ProgressionStats = {
    ...state.stats,
    personalitiesExplored: [...state.stats.personalitiesExplored, personality],
  };

  return evaluateAchievements({ ...state, stats: nextStats });
}

/**
 * Records completion of a mini-game session and updates high scores.
 */
export function recordMiniGameCompletion(
  state: ProgressionState,
  gameId: string,
  score: number,
  roundReached?: number
): EvaluationResult {
  const today = getTodayUtcDateString();
  const dates = state.stats.distinctSessionDates.includes(today)
    ? state.stats.distinctSessionDates
    : [...state.stats.distinctSessionDates, today];

  const safeScore = Math.max(0, Math.floor(score));
  const completedMap = {
    ...state.stats.miniGamesCompleted,
    [gameId]: (state.stats.miniGamesCompleted[gameId] ?? 0) + 1,
  };

  let starHigh = state.stats.starCatcherHighScore;
  let sparksMax = state.stats.memorySparksMaxRound;
  let rhythmHigh = state.stats.companionRhythmHighScore;

  if (gameId === 'star_catcher') {
    starHigh = Math.max(starHigh, safeScore);
  } else if (gameId === 'memory_sparks') {
    if (roundReached) sparksMax = Math.max(sparksMax, roundReached);
  } else if (gameId === 'companion_rhythm') {
    rhythmHigh = Math.max(rhythmHigh, safeScore);
  }

  const nextStats: ProgressionStats = {
    ...state.stats,
    miniGamesPlayed: state.stats.miniGamesPlayed + 1,
    miniGamesCompleted: completedMap,
    starCatcherHighScore: starHigh,
    memorySparksMaxRound: sparksMax,
    companionRhythmHighScore: rhythmHigh,
    distinctSessionDates: dates,
  };

  return evaluateAchievements({ ...state, stats: nextStats });
}

/**
 * Computes live status list for UI gallery rendering.
 */
export function getAchievementStatuses(state: ProgressionState): AchievementStatus[] {
  return ACHIEVEMENTS_LIST.map((def) => {
    const existing = state.achievements[def.id];
    const progress = def.calculateProgress(state.stats, state.inventory, state.equipped);
    return {
      id: def.id,
      unlockedAt: existing?.unlockedAt ?? null,
      progress: progress.current,
      maxProgress: progress.max,
      completed: progress.completed || (existing?.unlockedAt !== null && existing?.unlockedAt !== undefined),
    };
  });
}
