/**
 * GitHub Profile Pet - Cosmetics Catalog
 * Sprint 5.2A: Pet Progression, Achievement System & Unlockable Cosmetics
 */

import type { CosmeticId, CosmeticMetadata, CosmeticCategory } from './types.ts';

export const COSMETICS_CATALOG: Record<CosmeticId, CosmeticMetadata> = {
  // ── ACCESSORIES ─────────────────────────────────────────────────────────────
  mini_crown: {
    id: 'mini_crown',
    name: 'Mini Crown',
    description: 'A petite golden pixel crown signifying royal companionship and devotion.',
    category: 'accessory',
    rarity: 'rare',
    unlockRequirement: 'Complete your first companion interaction (Tap or Stroke).',
    icon: '👑',
    achievementId: 'first_interaction',
  },
  dev_glasses: {
    id: 'dev_glasses',
    name: 'Developer Glasses',
    description: 'Classic dark-rimmed terminal spectacles designed for rigorous code inspection.',
    category: 'accessory',
    rarity: 'uncommon',
    unlockRequirement: 'Explore at least 3 distinct personality archetypes.',
    icon: '👓',
    achievementId: 'personality_explorer',
  },
  star_charm: {
    id: 'star_charm',
    name: 'Star Charm',
    description: 'A twinkling celestial pendant collected from the cosmic sky.',
    category: 'accessory',
    rarity: 'common',
    unlockRequirement: 'Complete your first mini-game session.',
    icon: '⭐',
    achievementId: 'first_minigame_play',
  },
  explorer_scarf: {
    id: 'explorer_scarf',
    name: 'Explorer Scarf',
    description: 'A cozy woven knit scarf suited for traversing uncharted repositories and cold codebases.',
    category: 'accessory',
    rarity: 'rare',
    unlockRequirement: 'Play and complete all 3 distinct mini-game activities.',
    icon: '🧣',
    achievementId: 'all_games_completed',
  },
  guardian_emblem: {
    id: 'guardian_emblem',
    name: 'Guardian Shoulder Emblem',
    description: 'A polished silver sigil forged in defensive honor and steadfast loyalty.',
    category: 'accessory',
    rarity: 'epic',
    unlockRequirement: 'Bond with a Determined or Calm companion and achieve mastery.',
    icon: '🛡️',
    achievementId: 'guardian_honor',
  },

  // ── EFFECTS ─────────────────────────────────────────────────────────────────
  emerald_sparkle: {
    id: 'emerald_sparkle',
    name: 'Emerald Sparkle',
    description: 'Glinting green particles resonant with terminal vigor and clean compiles.',
    category: 'effect',
    rarity: 'uncommon',
    unlockRequirement: 'Equip your very first cosmetic accessory or effect.',
    icon: '✨',
    achievementId: 'first_cosmetic_equipped',
  },
  solar_particles: {
    id: 'solar_particles',
    name: 'Solar Particles',
    description: 'Warm undulating embers swirling with radiant solar energy and rhythm.',
    category: 'effect',
    rarity: 'rare',
    unlockRequirement: 'Score 250+ points in Companion Rhythm.',
    icon: '☀️',
    achievementId: 'rhythm_groover',
  },
  crimson_aura: {
    id: 'crimson_aura',
    name: 'Crimson Aura',
    description: 'A fierce crimson power ring pulsating with burning determination and speed.',
    category: 'effect',
    rarity: 'epic',
    unlockRequirement: 'Collect at least 7 cosmetic items in your wardrobe.',
    icon: '🔥',
    achievementId: 'collector_adept',
  },
  calm_glow: {
    id: 'calm_glow',
    name: 'Calm Floating Glow',
    description: 'A soft azure harmonic ring radiating peace, mindfulness, and equilibrium.',
    category: 'effect',
    rarity: 'rare',
    unlockRequirement: 'Reach 15 total care or mini-game activities in steady flow.',
    icon: '💫',
    achievementId: 'zen_mastery',
  },

  // ── ENVIRONMENTS ────────────────────────────────────────────────────────────
  void_chamber: {
    id: 'void_chamber',
    name: 'Void Chamber',
    description: 'Deep astral backdrop with deep purple-indigo cosmic mist and distant twinkling stars.',
    category: 'environment',
    rarity: 'common',
    unlockRequirement: 'Default companion habitat.',
    icon: '🌌',
  },
  starlight_platform: {
    id: 'starlight_platform',
    name: 'Starlight Platform',
    description: 'Luminous celestial arena bathed in midnight blue stardust and glowing constellations.',
    category: 'environment',
    rarity: 'rare',
    unlockRequirement: 'Score 300+ points in Star Catcher.',
    icon: '🌠',
    achievementId: 'star_catcher_expert',
  },
  forest_sanctuary: {
    id: 'forest_sanctuary',
    name: 'Forest Sanctuary',
    description: 'Serene mossy glade illuminated by emerald fireflies and ancient woodland runes.',
    category: 'environment',
    rarity: 'uncommon',
    unlockRequirement: 'Visit and interact with your companion on at least 2 distinct calendar days.',
    icon: '🌲',
    achievementId: 'two_day_streak',
  },
  neon_workshop: {
    id: 'neon_workshop',
    name: 'Neon Workshop',
    description: 'Cyberpunk terminal workshop humming with glowing cyan data circuits and holo-grids.',
    category: 'environment',
    rarity: 'epic',
    unlockRequirement: 'Reach Round 4 or higher in Memory Sparks.',
    icon: '⚡',
    achievementId: 'sparks_round_4',
  },

  // ── COMPANION DECORATIONS ───────────────────────────────────────────────────
  companion_badge: {
    id: 'companion_badge',
    name: 'Small Companion Badge',
    description: 'An honorable paw badge marking a treasured, well-cared companion.',
    category: 'decoration',
    rarity: 'common',
    unlockRequirement: 'Complete your first care action (Feed, Play, Train, or Rest).',
    icon: '🐾',
    achievementId: 'first_care_action',
  },
  floating_emblem: {
    id: 'floating_emblem',
    name: 'Floating Emblem',
    description: 'An ornate elemental crest hovering serenely beside your companion.',
    category: 'decoration',
    rarity: 'rare',
    unlockRequirement: 'Collect at least 3 cosmetic items in your wardrobe.',
    icon: '🔮',
    achievementId: 'collector_novice',
  },
  decorative_frame: {
    id: 'decorative_frame',
    name: 'Decorative Frame',
    description: 'A gilded pixel border enclosing the companion podium with masterwork prestige.',
    category: 'decoration',
    rarity: 'epic',
    unlockRequirement: 'Equip an accessory, effect, environment, and decoration simultaneously.',
    icon: '🖼️',
    achievementId: 'full_ensemble',
  },
};

export const COSMETIC_ITEMS_LIST = Object.values(COSMETICS_CATALOG);

export const DEFAULT_UNLOCKED_COSMETICS: CosmeticId[] = ['void_chamber'];

export const RARITY_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  common: { text: 'text-slate-300', bg: 'bg-slate-900/60', border: 'border-slate-700' },
  uncommon: { text: 'text-emerald-300', bg: 'bg-emerald-950/60', border: 'border-emerald-600' },
  rare: { text: 'text-cyan-300', bg: 'bg-cyan-950/60', border: 'border-cyan-600' },
  epic: { text: 'text-purple-300', bg: 'bg-purple-950/60', border: 'border-purple-600' },
  legendary: { text: 'text-amber-300', bg: 'bg-amber-950/60', border: 'border-amber-500' },
};

export function getCosmeticsByCategory(category: CosmeticCategory): CosmeticMetadata[] {
  return COSMETIC_ITEMS_LIST.filter((item) => item.category === category);
}

export function getCosmeticById(id: string): CosmeticMetadata | undefined {
  return COSMETICS_CATALOG[id as CosmeticId];
}
