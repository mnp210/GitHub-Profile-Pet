/**
 * GitHub Profile Pet - Progression, Achievements & Cosmetic Types
 * Sprint 5.2A: Pet Progression, Achievement System & Unlockable Cosmetics
 */

import type { PersonalityType, SpeciesId } from '@/types/pet';

export type CosmeticCategory = 'accessory' | 'effect' | 'environment' | 'decoration';

export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export type CosmeticId =
  // Accessories
  | 'mini_crown'
  | 'dev_glasses'
  | 'star_charm'
  | 'explorer_scarf'
  | 'guardian_emblem'
  // Effects
  | 'emerald_sparkle'
  | 'solar_particles'
  | 'crimson_aura'
  | 'calm_glow'
  // Environments
  | 'void_chamber'
  | 'starlight_platform'
  | 'forest_sanctuary'
  | 'neon_workshop'
  // Companion Decorations
  | 'companion_badge'
  | 'floating_emblem'
  | 'decorative_frame';

export type AchievementCategory = 'companion' | 'minigame' | 'collection' | 'consistency';

export type AchievementId =
  // Companion
  | 'first_interaction'
  | 'first_care_action'
  | 'personality_explorer'
  | 'first_cosmetic_equipped'
  // Mini-game
  | 'first_minigame_play'
  | 'all_games_completed'
  | 'star_catcher_expert'
  | 'sparks_round_4'
  | 'rhythm_groover'
  // Collection
  | 'collector_novice'
  | 'collector_adept'
  | 'full_ensemble'
  | 'guardian_honor'
  // Consistency
  | 'two_day_streak'
  | 'zen_mastery';

export interface CosmeticMetadata {
  id: CosmeticId;
  name: string;
  description: string;
  category: CosmeticCategory;
  rarity: CosmeticRarity;
  unlockRequirement: string;
  icon: string;
  achievementId?: AchievementId;
  compatibleSpecies?: SpeciesId[]; // If omitted, compatible with all
}

export interface EquippedCosmetics {
  accessory: CosmeticId | null;
  effect: CosmeticId | null;
  environment: CosmeticId | null;
  decoration: CosmeticId | null;
}

export interface ProgressionStats {
  totalInteractions: number;
  totalCareActions: number;
  personalitiesExplored: PersonalityType[];
  cosmeticsEquippedCount: number;
  miniGamesPlayed: number;
  miniGamesCompleted: Record<string, number>;
  starCatcherHighScore: number;
  memorySparksMaxRound: number;
  companionRhythmHighScore: number;
  distinctSessionDates: string[]; // YYYY-MM-DD
}

export interface AchievementDefinition {
  id: AchievementId;
  name: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  rewardCosmeticId?: CosmeticId;
  calculateProgress: (stats: ProgressionStats, inventory: CosmeticId[], equipped: EquippedCosmetics) => {
    current: number;
    max: number;
    completed: boolean;
  };
}

export interface AchievementStatus {
  id: AchievementId;
  unlockedAt: number | null; // null if locked
  progress: number;
  maxProgress: number;
  completed: boolean;
}

export interface ProgressionState {
  schemaVersion: number;
  inventory: CosmeticId[];
  equipped: EquippedCosmetics;
  achievements: Record<string, { unlockedAt: number | null }>;
  stats: ProgressionStats;
}
