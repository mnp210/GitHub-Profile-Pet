/**
 * GitHub Profile Pet - Achievements Catalog
 * Sprint 5.2A: Pet Progression, Achievement System & Unlockable Cosmetics
 */

import type {
  AchievementId,
  AchievementDefinition,
  AchievementCategory,
} from './types.ts';

export const ACHIEVEMENTS_CATALOG: Record<AchievementId, AchievementDefinition> = {
  // ── COMPANION MILESTONES ───────────────────────────────────────────────────
  first_interaction: {
    id: 'first_interaction',
    name: 'First Hello',
    description: 'Stroke or tap your companion for the first time.',
    category: 'companion',
    icon: '👋',
    rewardCosmeticId: 'mini_crown',
    calculateProgress: (stats) => ({
      current: Math.min(1, stats.totalInteractions),
      max: 1,
      completed: stats.totalInteractions >= 1,
    }),
  },
  first_care_action: {
    id: 'first_care_action',
    name: 'Caring Companion',
    description: 'Complete your first care action (Feed, Play, Train, or Rest).',
    category: 'companion',
    icon: '🍖',
    rewardCosmeticId: 'companion_badge',
    calculateProgress: (stats) => ({
      current: Math.min(1, stats.totalCareActions),
      max: 1,
      completed: stats.totalCareActions >= 1,
    }),
  },
  personality_explorer: {
    id: 'personality_explorer',
    name: 'Soul Seeker',
    description: 'Explore at least 3 distinct living companion personality archetypes.',
    category: 'companion',
    icon: '🎭',
    rewardCosmeticId: 'dev_glasses',
    calculateProgress: (stats) => ({
      current: Math.min(3, stats.personalitiesExplored.length),
      max: 3,
      completed: stats.personalitiesExplored.length >= 3,
    }),
  },
  first_cosmetic_equipped: {
    id: 'first_cosmetic_equipped',
    name: 'Fashion Forward',
    description: 'Equip your very first cosmetic accessory or visual effect.',
    category: 'companion',
    icon: '✨',
    rewardCosmeticId: 'emerald_sparkle',
    calculateProgress: (stats) => ({
      current: Math.min(1, stats.cosmeticsEquippedCount),
      max: 1,
      completed: stats.cosmeticsEquippedCount >= 1,
    }),
  },

  // ── MINI-GAME MILESTONES ───────────────────────────────────────────────────
  first_minigame_play: {
    id: 'first_minigame_play',
    name: "Let's Play!",
    description: 'Complete your first companion mini-game session.',
    category: 'minigame',
    icon: '🎮',
    rewardCosmeticId: 'star_charm',
    calculateProgress: (stats) => ({
      current: Math.min(1, stats.miniGamesPlayed),
      max: 1,
      completed: stats.miniGamesPlayed >= 1,
    }),
  },
  all_games_completed: {
    id: 'all_games_completed',
    name: 'Tri-Champion',
    description: 'Play and finish all 3 mini-games: Star Catcher, Memory Sparks, and Companion Rhythm.',
    category: 'minigame',
    icon: '🏆',
    rewardCosmeticId: 'explorer_scarf',
    calculateProgress: (stats) => {
      const keys = ['star_catcher', 'memory_sparks', 'companion_rhythm'];
      const completedCount = keys.filter((k) => (stats.miniGamesCompleted[k] ?? 0) >= 1).length;
      return {
        current: completedCount,
        max: 3,
        completed: completedCount >= 3,
      };
    },
  },
  star_catcher_expert: {
    id: 'star_catcher_expert',
    name: 'Cosmic Stargazer',
    description: 'Score 300 or more points in a single round of Star Catcher.',
    category: 'minigame',
    icon: '🌠',
    rewardCosmeticId: 'starlight_platform',
    calculateProgress: (stats) => ({
      current: Math.min(300, stats.starCatcherHighScore),
      max: 300,
      completed: stats.starCatcherHighScore >= 300,
    }),
  },
  sparks_round_4: {
    id: 'sparks_round_4',
    name: 'Synapse Surge',
    description: 'Reach Round 4 or higher in Memory Sparks.',
    category: 'minigame',
    icon: '⚡',
    rewardCosmeticId: 'neon_workshop',
    calculateProgress: (stats) => ({
      current: Math.min(4, stats.memorySparksMaxRound),
      max: 4,
      completed: stats.memorySparksMaxRound >= 4,
    }),
  },
  rhythm_groover: {
    id: 'rhythm_groover',
    name: 'Pocket Groover',
    description: 'Score 250 or more points in Companion Rhythm.',
    category: 'minigame',
    icon: '🎵',
    rewardCosmeticId: 'solar_particles',
    calculateProgress: (stats) => ({
      current: Math.min(250, stats.companionRhythmHighScore),
      max: 250,
      completed: stats.companionRhythmHighScore >= 250,
    }),
  },

  // ── COLLECTION MILESTONES ──────────────────────────────────────────────────
  collector_novice: {
    id: 'collector_novice',
    name: 'Treasure Hunter',
    description: 'Unlock and own at least 3 distinct cosmetic items.',
    category: 'collection',
    icon: '📦',
    rewardCosmeticId: 'floating_emblem',
    calculateProgress: (_stats, inventory) => ({
      current: Math.min(3, inventory.length),
      max: 3,
      completed: inventory.length >= 3,
    }),
  },
  collector_adept: {
    id: 'collector_adept',
    name: 'Stylist Maestro',
    description: 'Unlock and own at least 7 distinct cosmetic items.',
    category: 'collection',
    icon: '🎨',
    rewardCosmeticId: 'crimson_aura',
    calculateProgress: (_stats, inventory) => ({
      current: Math.min(7, inventory.length),
      max: 7,
      completed: inventory.length >= 7,
    }),
  },
  full_ensemble: {
    id: 'full_ensemble',
    name: 'Full Ensemble',
    description: 'Simultaneously equip an accessory, effect, environment, and companion decoration.',
    category: 'collection',
    icon: '👗',
    rewardCosmeticId: 'decorative_frame',
    calculateProgress: (_stats, _inventory, equipped) => {
      const slots = [equipped.accessory, equipped.effect, equipped.environment, equipped.decoration];
      const count = slots.filter(Boolean).length;
      return {
        current: count,
        max: 4,
        completed: count === 4,
      };
    },
  },
  guardian_honor: {
    id: 'guardian_honor',
    name: 'Vow of the Guardian',
    description: 'Bond with a Determined or Calm companion and complete 8 total activities.',
    category: 'collection',
    icon: '🛡️',
    rewardCosmeticId: 'guardian_emblem',
    calculateProgress: (stats) => {
      const hasArchetype =
        stats.personalitiesExplored.includes('determined') || stats.personalitiesExplored.includes('calm');
      const acts = stats.totalCareActions + stats.miniGamesPlayed;
      const count = hasArchetype ? Math.min(8, acts) : Math.min(7, acts);
      return {
        current: count,
        max: 8,
        completed: hasArchetype && acts >= 8,
      };
    },
  },

  // ── CONSISTENCY MILESTONES ─────────────────────────────────────────────────
  two_day_streak: {
    id: 'two_day_streak',
    name: 'Faithful Companion',
    description: 'Visit and interact with your companion on at least 2 distinct calendar days.',
    category: 'consistency',
    icon: '📅',
    rewardCosmeticId: 'forest_sanctuary',
    calculateProgress: (stats) => ({
      current: Math.min(2, stats.distinctSessionDates.length),
      max: 2,
      completed: stats.distinctSessionDates.length >= 2,
    }),
  },
  zen_mastery: {
    id: 'zen_mastery',
    name: 'Harmonic Equilibrium',
    description: 'Participate in 15 total care or mini-game sessions with your companion.',
    category: 'consistency',
    icon: '🧘',
    rewardCosmeticId: 'calm_glow',
    calculateProgress: (stats) => {
      const total = stats.totalCareActions + stats.miniGamesPlayed;
      return {
        current: Math.min(15, total),
        max: 15,
        completed: total >= 15,
      };
    },
  },
};

export const ACHIEVEMENTS_LIST = Object.values(ACHIEVEMENTS_CATALOG);

export function getAchievementsByCategory(category: AchievementCategory): AchievementDefinition[] {
  return ACHIEVEMENTS_LIST.filter((a) => a.category === category);
}

export function getAchievementById(id: string): AchievementDefinition | undefined {
  return ACHIEVEMENTS_CATALOG[id as AchievementId];
}
