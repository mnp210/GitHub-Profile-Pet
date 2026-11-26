/**
 * GitHub Profile Pet - Progression Persistence & Schema Migration
 * Sprint 5.2A: Pet Progression, Achievement System & Unlockable Cosmetics
 */

import type {
  ProgressionState,
  ProgressionStats,
  CosmeticId,
  EquippedCosmetics,
} from './types.ts';
import {
  CURRENT_PROGRESSION_SCHEMA_VERSION,
  createInitialProgressionState,
  createInitialProgressionStats,
} from './engine.ts';
import {
  DEFAULT_UNLOCKED_COSMETICS,
  getCosmeticById,
} from './cosmeticsCatalog.ts';
import type { PersonalityType } from '../../types/pet.ts';

export const LOCAL_STORAGE_PROGRESSION_KEY = 'gh_pet_progression_state_v1';

/**
 * Safely migrates raw, legacy, or partially corrupted stored state into a valid ProgressionState.
 */
export function migrateProgressionState(
  raw: unknown,
  fallbackPersonality: PersonalityType = 'curious'
): ProgressionState {
  if (!raw || typeof raw !== 'object') {
    return createInitialProgressionState(fallbackPersonality);
  }

  const candidate = raw as Record<string, unknown>;

  // 1. Inventory Validation
  const validInventory: CosmeticId[] = [];
  if (Array.isArray(candidate.inventory)) {
    for (const item of candidate.inventory) {
      if (typeof item === 'string') {
        const meta = getCosmeticById(item);
        if (meta && !validInventory.includes(meta.id)) {
          validInventory.push(meta.id);
        }
      }
    }
  }
  for (const defItem of DEFAULT_UNLOCKED_COSMETICS) {
    if (!validInventory.includes(defItem)) {
      validInventory.push(defItem);
    }
  }

  // 2. Equipped Validation
  const rawEquipped = (typeof candidate.equipped === 'object' && candidate.equipped !== null)
    ? (candidate.equipped as Record<string, unknown>)
    : {};

  const validateSlot = (slotValue: unknown, category: string): CosmeticId | null => {
    if (typeof slotValue === 'string') {
      const meta = getCosmeticById(slotValue);
      if (meta && meta.category === category && validInventory.includes(meta.id)) {
        return meta.id;
      }
    }
    return null;
  };

  const equipped: EquippedCosmetics = {
    accessory: validateSlot(rawEquipped.accessory, 'accessory'),
    effect: validateSlot(rawEquipped.effect, 'effect'),
    environment: validateSlot(rawEquipped.environment, 'environment') || 'void_chamber',
    decoration: validateSlot(rawEquipped.decoration, 'decoration'),
  };

  // 3. Achievements Validation
  const achievements: Record<string, { unlockedAt: number | null }> = {};
  if (typeof candidate.achievements === 'object' && candidate.achievements !== null) {
    const rawAch = candidate.achievements as Record<string, unknown>;
    for (const [key, val] of Object.entries(rawAch)) {
      if (typeof val === 'object' && val !== null) {
        const uAt = (val as { unlockedAt?: unknown }).unlockedAt;
        achievements[key] = {
          unlockedAt: typeof uAt === 'number' && Number.isFinite(uAt) ? uAt : null,
        };
      }
    }
  }

  // 4. Stats Validation
  const initialStats = createInitialProgressionStats(fallbackPersonality);
  const rawStats = (typeof candidate.stats === 'object' && candidate.stats !== null)
    ? (candidate.stats as Record<string, unknown>)
    : {};

  const sanitizeNumber = (n: unknown, fallback: number): number => {
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };

  const personalities: PersonalityType[] = Array.isArray(rawStats.personalitiesExplored)
    ? (rawStats.personalitiesExplored.filter((p) =>
        ['curious', 'determined', 'playful', 'calm'].includes(String(p))
      ) as PersonalityType[])
    : [fallbackPersonality];

  if (personalities.length === 0) {
    personalities.push(fallbackPersonality);
  }

  const distinctDates: string[] = Array.isArray(rawStats.distinctSessionDates)
    ? rawStats.distinctSessionDates.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))
    : initialStats.distinctSessionDates;

  const miniGamesCompleted: Record<string, number> = {};
  if (typeof rawStats.miniGamesCompleted === 'object' && rawStats.miniGamesCompleted !== null) {
    for (const [gId, count] of Object.entries(rawStats.miniGamesCompleted)) {
      miniGamesCompleted[gId] = sanitizeNumber(count, 0);
    }
  }

  const stats: ProgressionStats = {
    totalInteractions: sanitizeNumber(rawStats.totalInteractions, 0),
    totalCareActions: sanitizeNumber(rawStats.totalCareActions, 0),
    personalitiesExplored: Array.from(new Set(personalities)),
    cosmeticsEquippedCount: sanitizeNumber(rawStats.cosmeticsEquippedCount, 0),
    miniGamesPlayed: sanitizeNumber(rawStats.miniGamesPlayed, 0),
    miniGamesCompleted,
    starCatcherHighScore: sanitizeNumber(rawStats.starCatcherHighScore, 0),
    memorySparksMaxRound: sanitizeNumber(rawStats.memorySparksMaxRound, 0),
    companionRhythmHighScore: sanitizeNumber(rawStats.companionRhythmHighScore, 0),
    distinctSessionDates: distinctDates.length > 0 ? distinctDates : initialStats.distinctSessionDates,
  };

  return {
    schemaVersion: CURRENT_PROGRESSION_SCHEMA_VERSION,
    inventory: validInventory,
    equipped,
    achievements,
    stats,
  };
}

/**
 * Loads progression state from localStorage with safe fallback and migration.
 */
export function loadProgressionState(fallbackPersonality: PersonalityType = 'curious'): ProgressionState {
  if (typeof window === 'undefined') {
    return createInitialProgressionState(fallbackPersonality);
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PROGRESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return migrateProgressionState(parsed, fallbackPersonality);
    }
  } catch (err) {
    console.warn('Failed to load progression state from localStorage:', err);
  }

  return createInitialProgressionState(fallbackPersonality);
}

/**
 * Saves progression state to localStorage safely.
 */
export function saveProgressionState(state: ProgressionState): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(LOCAL_STORAGE_PROGRESSION_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save progression state to localStorage:', err);
  }
}
