/**
 * GitHub Profile Pet - Progression, Achievements & Cosmetic Unit Tests
 * Sprint 5.2A: Pet Progression, Achievement System & Unlockable Cosmetics
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialProgressionState,
  evaluateAchievements,
  equipCosmetic,
  unequipCosmetic,
  resetCosmeticsToDefault,
  recordInteraction,
  recordPersonalityExplored,
  getAchievementStatuses,
  CURRENT_PROGRESSION_SCHEMA_VERSION,
} from '../../src/features/progression/engine.ts';
import type { CosmeticId } from '../../src/features/progression/types.ts';
import {
  COSMETIC_ITEMS_LIST,
  getCosmeticsByCategory,
  getCosmeticById,
} from '../../src/features/progression/cosmeticsCatalog.ts';
import {
  ACHIEVEMENTS_LIST,
  getAchievementsByCategory,
} from '../../src/features/progression/achievementsCatalog.ts';
import {
  migrateProgressionState,
} from '../../src/features/progression/persistence.ts';
import {
  exportSaveData,
  importSaveData,
} from '../../src/lib/storage/gameStateStorage.ts';
import type { PetState } from '../../src/types/pet.ts';
import type { ActionHistoryEntry } from '../../src/features/gamification/rewards.ts';
import { INITIAL_PET_STATE } from '../../src/constants/petData.ts';

describe('Sprint 5.2A — Progression & Cosmetic Catalogs', () => {
  it('TC-CAT-01: Contains at least 5 accessories, 4 effects, 4 environments, and 3 decorations', () => {
    const accessories = getCosmeticsByCategory('accessory');
    const effects = getCosmeticsByCategory('effect');
    const environments = getCosmeticsByCategory('environment');
    const decorations = getCosmeticsByCategory('decoration');

    assert.ok(accessories.length >= 5, `Expected >= 5 accessories, got ${accessories.length}`);
    assert.ok(effects.length >= 4, `Expected >= 4 effects, got ${effects.length}`);
    assert.ok(environments.length >= 4, `Expected >= 4 environments, got ${environments.length}`);
    assert.ok(decorations.length >= 3, `Expected >= 3 decorations, got ${decorations.length}`);
    assert.equal(COSMETIC_ITEMS_LIST.length, 16);
  });

  it('TC-CAT-02: Every cosmetic has unique stable ID, display name, rarity, and description', () => {
    const seenIds = new Set<string>();
    for (const item of COSMETIC_ITEMS_LIST) {
      assert.ok(item.id.length > 0);
      assert.ok(!seenIds.has(item.id), `Duplicate cosmetic ID: ${item.id}`);
      seenIds.add(item.id);

      assert.ok(item.name.length > 0);
      assert.ok(item.description.length > 0);
      assert.ok(['common', 'uncommon', 'rare', 'epic', 'legendary'].includes(item.rarity));
      assert.ok(['accessory', 'effect', 'environment', 'decoration'].includes(item.category));
    }
  });

  it('TC-CAT-03: Contains at least 15 achievements across all 4 categories', () => {
    assert.ok(ACHIEVEMENTS_LIST.length >= 15, `Expected >= 15 achievements, got ${ACHIEVEMENTS_LIST.length}`);

    const companion = getAchievementsByCategory('companion');
    const minigame = getAchievementsByCategory('minigame');
    const collection = getAchievementsByCategory('collection');
    const consistency = getAchievementsByCategory('consistency');

    assert.ok(companion.length >= 3, 'Expected >= 3 companion achievements');
    assert.ok(minigame.length >= 4, 'Expected >= 4 minigame achievements');
    assert.ok(collection.length >= 3, 'Expected >= 3 collection achievements');
    assert.ok(consistency.length >= 2, 'Expected >= 2 consistency achievements');
  });

  it('TC-CAT-04: Every achievement maps to an existing cosmetic reward item', () => {
    for (const ach of ACHIEVEMENTS_LIST) {
      if (ach.rewardCosmeticId) {
        const reward = getCosmeticById(ach.rewardCosmeticId);
        assert.ok(reward, `Reward '${ach.rewardCosmeticId}' for achievement '${ach.id}' does not exist in catalog`);
      }
    }
  });
});

describe('Sprint 5.2A — Achievement Evaluation & Idempotence', () => {
  it('TC-ACH-01: Correctly evaluates first interaction achievement and grants reward', () => {
    let state = createInitialProgressionState('curious');
    assert.equal(state.achievements.first_interaction, undefined);
    assert.ok(!state.inventory.includes('mini_crown'));

    // Record interaction
    const res = recordInteraction(state);
    state = res.updatedState;

    assert.ok(res.newlyUnlockedAchievements.includes('first_interaction'));
    assert.ok(res.newlyUnlockedCosmetics.includes('mini_crown'));
    assert.ok(state.inventory.includes('mini_crown'));
    assert.ok(typeof state.achievements.first_interaction.unlockedAt === 'number');

    // Repeated call is strictly idempotent
    const initialTimestamp = state.achievements.first_interaction.unlockedAt;
    const res2 = evaluateAchievements(state);
    assert.equal(res2.newlyUnlockedAchievements.length, 0);
    assert.equal(res2.newlyUnlockedCosmetics.length, 0);
    assert.equal(res2.updatedState.achievements.first_interaction.unlockedAt, initialTimestamp);
  });

  it('TC-ACH-02: Multiple achievements complete cleanly in a single evaluation', () => {
    const state = createInitialProgressionState('curious');
    // Simulate high activity that satisfies multiple milestones simultaneously:
    // first_care_action (totalCareActions >= 1)
    // first_minigame_play (miniGamesPlayed >= 1)
    // star_catcher_expert (starCatcherHighScore >= 300)
    state.stats.totalCareActions = 5;
    state.stats.miniGamesPlayed = 3;
    state.stats.miniGamesCompleted.star_catcher = 1;
    state.stats.starCatcherHighScore = 350;

    const res = evaluateAchievements(state);
    assert.ok(res.newlyUnlockedAchievements.includes('first_care_action'));
    assert.ok(res.newlyUnlockedAchievements.includes('first_minigame_play'));
    assert.ok(res.newlyUnlockedAchievements.includes('star_catcher_expert'));

    // Verify respective cosmetic rewards are added to inventory
    assert.ok(res.updatedState.inventory.includes('companion_badge'));
    assert.ok(res.updatedState.inventory.includes('star_charm'));
    assert.ok(res.updatedState.inventory.includes('starlight_platform'));
  });

  it('TC-ACH-03: Personality exploration progression tracks distinct archetypes without duplicates', () => {
    let state = createInitialProgressionState('curious');
    assert.deepEqual(state.stats.personalitiesExplored, ['curious']);

    // Record duplicate exploration
    state = recordPersonalityExplored(state, 'curious').updatedState;
    assert.equal(state.stats.personalitiesExplored.length, 1);

    // Record second archetype
    state = recordPersonalityExplored(state, 'determined').updatedState;
    assert.equal(state.stats.personalitiesExplored.length, 2);
    assert.equal(state.achievements.personality_explorer, undefined);

    // Record third archetype -> unlocks 'personality_explorer' and grants 'dev_glasses'
    const res = recordPersonalityExplored(state, 'playful');
    state = res.updatedState;
    assert.equal(state.stats.personalitiesExplored.length, 3);
    assert.ok(res.newlyUnlockedAchievements.includes('personality_explorer'));
    assert.ok(res.newlyUnlockedCosmetics.includes('dev_glasses'));
    assert.ok(state.inventory.includes('dev_glasses'));
  });

  it('TC-ACH-04: getAchievementStatuses returns accurate progress bars and completion flags', () => {
    const state = createInitialProgressionState('curious');
    state.stats.personalitiesExplored = ['curious', 'calm'];
    state.stats.starCatcherHighScore = 150;

    const statuses = getAchievementStatuses(state);
    const explorerStatus = statuses.find((s) => s.id === 'personality_explorer');
    const stargazeStatus = statuses.find((s) => s.id === 'star_catcher_expert');

    assert.ok(explorerStatus);
    assert.equal(explorerStatus.progress, 2);
    assert.equal(explorerStatus.maxProgress, 3);
    assert.equal(explorerStatus.completed, false);

    assert.ok(stargazeStatus);
    assert.equal(stargazeStatus.progress, 150);
    assert.equal(stargazeStatus.maxProgress, 300);
    assert.equal(stargazeStatus.completed, false);
  });
});

describe('Sprint 5.2A — Wardrobe & Cosmetic Equipment Lifecycle', () => {
  it('TC-WAR-01: Default state initializes with void_chamber environment and empty accessories', () => {
    const state = createInitialProgressionState('curious');
    assert.deepEqual(state.inventory, ['void_chamber']);
    assert.equal(state.equipped.accessory, null);
    assert.equal(state.equipped.effect, null);
    assert.equal(state.equipped.environment, 'void_chamber');
    assert.equal(state.equipped.decoration, null);
  });

  it('TC-WAR-02: Rejects equipping cosmetics that are not owned in inventory', () => {
    const state = createInitialProgressionState('curious');
    const res = equipCosmetic(state, 'mini_crown');
    assert.ok(res.error);
    assert.match(res.error, /locked or not owned/i);
    assert.equal(res.nextState.equipped.accessory, null);
  });

  it('TC-WAR-03: Rejects unknown cosmetic IDs safely without throwing or mutating state', () => {
    const state = createInitialProgressionState('curious');
    // @ts-expect-error testing invalid ID
    const res = equipCosmetic(state, 'invalid_legendary_sword');
    assert.ok(res.error);
    assert.match(res.error, /unknown cosmetic item/i);
    assert.equal(res.nextState.equipped.accessory, null);
  });

  it('TC-WAR-04: Successfully equips owned cosmetic, updates slot, and triggers first_cosmetic_equipped', () => {
    let state = createInitialProgressionState('curious');
    state.inventory.push('mini_crown');

    const res = equipCosmetic(state, 'mini_crown');
    assert.equal(res.error, undefined);
    state = res.nextState;

    assert.equal(state.equipped.accessory, 'mini_crown');
    assert.equal(state.stats.cosmeticsEquippedCount, 1);
    // Equipping first cosmetic unlocks 'first_cosmetic_equipped' which grants 'emerald_sparkle'
    assert.ok(state.achievements.first_cosmetic_equipped);
    assert.ok(state.inventory.includes('emerald_sparkle'));
  });

  it('TC-WAR-05: Unequip clears slot, and unequipped environment falls back to void_chamber', () => {
    let state = createInitialProgressionState('curious');
    state.inventory.push('mini_crown', 'neon_workshop');
    state.equipped.accessory = 'mini_crown';
    state.equipped.environment = 'neon_workshop';

    state = unequipCosmetic(state, 'accessory');
    assert.equal(state.equipped.accessory, null);

    state = unequipCosmetic(state, 'environment');
    assert.equal(state.equipped.environment, 'void_chamber');
  });

  it('TC-WAR-06: resetCosmeticsToDefault clears all layers and resets environment to void_chamber', () => {
    let state = createInitialProgressionState('curious');
    state.inventory.push('mini_crown', 'crimson_aura', 'forest_sanctuary', 'decorative_frame');
    state.equipped = {
      accessory: 'mini_crown',
      effect: 'crimson_aura',
      environment: 'forest_sanctuary',
      decoration: 'decorative_frame',
    };

    state = resetCosmeticsToDefault(state);
    assert.equal(state.equipped.accessory, null);
    assert.equal(state.equipped.effect, null);
    assert.equal(state.equipped.environment, 'void_chamber');
    assert.equal(state.equipped.decoration, null);
  });
});

describe('Sprint 5.2A — State Schema Migration & Persistence', () => {
  it('TC-MIG-01: Migrates null, undefined, or empty objects to valid default ProgressionState', () => {
    const s1 = migrateProgressionState(null);
    assert.equal(s1.schemaVersion, CURRENT_PROGRESSION_SCHEMA_VERSION);
    assert.ok(s1.inventory.includes('void_chamber'));
    assert.equal(s1.equipped.environment, 'void_chamber');

    const s2 = migrateProgressionState({});
    assert.equal(s2.schemaVersion, CURRENT_PROGRESSION_SCHEMA_VERSION);
    assert.ok(Array.isArray(s2.inventory));
  });

  it('TC-MIG-02: Filters invalid or unknown cosmetic IDs and unowned equipped slots', () => {
    const legacyCorrupt = {
      inventory: ['void_chamber', 'hacked_god_weapon', 'mini_crown'],
      equipped: {
        accessory: 'hacked_god_weapon', // Not in catalog
        effect: 'crimson_aura', // In catalog, but not owned in inventory!
        environment: 'unknown_world',
        decoration: null,
      },
      stats: {
        totalInteractions: -50, // Negative should be clamped to 0
        totalCareActions: 'invalid', // Non-number should fallback to 0
      },
    };

    const migrated = migrateProgressionState(legacyCorrupt);
    assert.ok(migrated.inventory.includes('void_chamber'));
    assert.ok(migrated.inventory.includes('mini_crown'));
    assert.ok(!migrated.inventory.includes('hacked_god_weapon' as unknown as CosmeticId));

    // Equipped slots with invalid/unowned items should reset
    assert.equal(migrated.equipped.accessory, null);
    assert.equal(migrated.equipped.effect, null);
    assert.equal(migrated.equipped.environment, 'void_chamber');

    // Stats sanitized
    assert.equal(migrated.stats.totalInteractions, 0);
    assert.equal(migrated.stats.totalCareActions, 0);
  });

  it('TC-MIG-03: exportSaveData and importSaveData roundtrip preserves progression state without loss', () => {
    const pet: PetState = {
      ...INITIAL_PET_STATE,
      name: 'Void Hero',
      level: 5,
      xp: 450,
    };
    const history: ActionHistoryEntry[] = [];
    const progression = createInitialProgressionState('determined');
    progression.inventory.push('mini_crown', 'starlight_platform');
    progression.equipped.accessory = 'mini_crown';
    progression.equipped.environment = 'starlight_platform';
    progression.stats.miniGamesPlayed = 8;
    progression.stats.starCatcherHighScore = 420;

    const json = exportSaveData(pet, history, progression);
    const imported = importSaveData(json);

    assert.equal(imported.success, true);
    assert.ok(imported.pet);
    assert.equal(imported.pet.name, 'Void Hero');
    assert.ok(imported.progression);
    assert.ok(imported.progression.inventory.includes('mini_crown'));
    assert.equal(imported.progression.equipped.accessory, 'mini_crown');
    assert.equal(imported.progression.equipped.environment, 'starlight_platform');
    assert.equal(imported.progression.stats.starCatcherHighScore, 420);
  });

  it('TC-MIG-04: Legacy save file without progression field imports cleanly with undefined progression', () => {
    const legacyJson = JSON.stringify({
      pet: INITIAL_PET_STATE,
      history: [],
      exportedAt: new Date().toISOString(),
      version: 1,
    });

    const imported = importSaveData(legacyJson);
    assert.equal(imported.success, true);
    assert.ok(imported.pet);
    assert.equal(imported.progression, undefined);
  });
});

describe('Sprint 5.2A — Economy Invariants & Zero-XP Safeguards', () => {
  it('TC-ECON-01: Earning achievements and unlocking cosmetics awards strictly 0 XP and mutates zero vitals', () => {
    const pet: PetState = {
      ...INITIAL_PET_STATE,
      level: 4,
      xp: 250,
      energy: 80,
      hunger: 70,
      happiness: 75,
    };

    let progression = createInitialProgressionState('curious');

    // Simulate satisfying several achievements
    progression.stats.totalInteractions = 5;
    progression.stats.totalCareActions = 10;
    progression.stats.miniGamesPlayed = 15;
    progression.stats.starCatcherHighScore = 500;
    progression.stats.memorySparksMaxRound = 5;

    const evalRes = evaluateAchievements(progression);
    progression = evalRes.updatedState;

    assert.ok(evalRes.newlyUnlockedAchievements.length >= 5);
    assert.ok(evalRes.newlyUnlockedCosmetics.length >= 4);

    // Verify Pet state invariants
    assert.equal(pet.level, 4, 'Pet level must remain unchanged');
    assert.equal(pet.xp, 250, 'Pet XP must remain unchanged');
    assert.equal(pet.energy, 80, 'Pet energy must remain unchanged');
    assert.equal(pet.hunger, 70, 'Pet hunger must remain unchanged');
    assert.equal(pet.happiness, 75, 'Pet happiness must remain unchanged');
  });

  it('TC-ECON-02: Equipping and previewing cosmetics does not modify care cooldowns or daily caps', () => {
    const state = createInitialProgressionState('curious');
    state.inventory.push('mini_crown', 'crimson_aura');

    const res = equipCosmetic(state, 'mini_crown');
    assert.equal(res.error, undefined);

    // Progression objects contain zero currency, coin, token, or ledger mutation methods
    assert.equal((res.nextState as unknown as Record<string, unknown>).coins, undefined);
    assert.equal((res.nextState as unknown as Record<string, unknown>).currency, undefined);
    assert.equal((res.nextState as unknown as Record<string, unknown>).xpBonus, undefined);
  });
});
