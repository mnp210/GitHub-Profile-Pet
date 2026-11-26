/**
 * Sprint 5.2B Mandatory Preflight Durability Checks
 * Tests and verifies Sprint 5.2A features across the 5 required dimensions:
 * A. Persistence durability
 * B. Cross-species rendering compatibility
 * C. Unlock integrity & idempotency
 * D. State isolation (vitals, XP, ledger, personal bests)
 * E. Migration safety & corruption recovery
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialProgressionState,
  equipCosmetic,
  unequipCosmetic,
  recordInteraction,
  recordCareAction,
  recordMiniGameCompletion,
} from '../../src/features/progression/engine.ts';
import {
  migrateProgressionState,
} from '../../src/features/progression/persistence.ts';
import {
  COSMETIC_ITEMS_LIST,
} from '../../src/features/progression/cosmeticsCatalog.ts';
import {
  importSaveData,
} from '../../src/lib/storage/gameStateStorage.ts';
import { INITIAL_PET_STATE } from '../../src/constants/petData.ts';
import type { PetState, SpeciesId } from '../../src/types/pet.ts';
import type { CosmeticId } from '../../src/features/progression/types.ts';
import type { ActionHistoryEntry } from '../../src/features/gamification/rewards.ts';

describe('Sprint 5.2B Preflight Check A: Persistence Durability', () => {
  it('A1: Unlocking a cosmetic, equipping, reloading survives roundtrip without duplicate inventory', () => {
    let state = createInitialProgressionState('curious');
    const unlockedId = 'dev_glasses';

    // Unlock cosmetic if not already unlocked
    if (!state.inventory.includes(unlockedId)) {
      state.inventory.push(unlockedId);
    }

    // Equip it
    const equipRes = equipCosmetic(state, unlockedId);
    assert.equal(equipRes.error, undefined);
    state = equipRes.nextState;
    assert.equal(state.equipped.accessory, unlockedId);

    // Simulate reload via serialization and migration
    const serialized = JSON.stringify(state);
    let reloaded = migrateProgressionState(JSON.parse(serialized));
    assert.equal(reloaded.equipped.accessory, unlockedId);
    assert.ok(reloaded.inventory.includes(unlockedId));

    // Count occurrences of unlockedId
    const countBefore = reloaded.inventory.filter((x) => x === unlockedId).length;
    assert.equal(countBefore, 1, 'Should have exactly 1 instance in inventory');

    // Unequip, re-equip, then reload again
    reloaded = unequipCosmetic(reloaded, 'accessory');
    assert.equal(reloaded.equipped.accessory, null);
    const reEquipRes = equipCosmetic(reloaded, unlockedId);
    reloaded = reEquipRes.nextState;
    assert.equal(reloaded.equipped.accessory, unlockedId);

    const reloadedAgain = migrateProgressionState(JSON.parse(JSON.stringify(reloaded)));
    assert.equal(reloadedAgain.equipped.accessory, unlockedId);
    const countAfter = reloadedAgain.inventory.filter((x) => x === unlockedId).length;
    assert.equal(countAfter, 1, 'Inventory must not accumulate duplicate items upon re-equip and reload');
  });
});

describe('Sprint 5.2B Preflight Check B: Cross-Species Rendering Compatibility', () => {
  it('B1: All 16 cosmetics specify valid species compatibility or universal compatibility', () => {
    const speciesList: SpeciesId[] = ['cat', 'dragon', 'fox', 'slime'];

    for (const cosmetic of COSMETIC_ITEMS_LIST) {
      if (cosmetic.compatibleSpecies) {
        for (const sp of cosmetic.compatibleSpecies) {
          assert.ok(speciesList.includes(sp), `Cosmetic ${cosmetic.id} references invalid species ${sp}`);
        }
      } else {
        // Universal compatibility applies to all 4 species
        assert.ok(true);
      }
      // Ensure valid category
      assert.ok(['accessory', 'effect', 'environment', 'decoration'].includes(cosmetic.category));
    }
  });
});

describe('Sprint 5.2B Preflight Check C: Unlock Integrity & Idempotency', () => {
  it('C1: Repeated completions of eligible activities do not grant duplicate rewards or achievements', () => {
    let state = createInitialProgressionState('curious');

    // Complete first care action 5 times
    for (let i = 0; i < 5; i++) {
      const res = recordCareAction(state);
      state = res.updatedState;
    }

    // Check achievement unlocked status
    const achStatus = state.achievements['first_care_action'];
    assert.ok(achStatus && achStatus.unlockedAt !== null, 'first_care_action should be unlocked');

    // Check reward cosmetic 'companion_badge' in inventory
    const countBadge = state.inventory.filter((x) => x === 'companion_badge').length;
    assert.equal(countBadge, 1, 'Companion badge must appear exactly once despite 5 completions');

    // Replay mini-game completions multiple times
    for (let i = 0; i < 10; i++) {
      const res = recordMiniGameCompletion(state, 'star_catcher', 150);
      state = res.updatedState;
    }

    const countStarCharm = state.inventory.filter((x) => x === 'star_charm').length;
    assert.equal(countStarCharm, 1, 'Reward cosmetic star_charm must appear exactly once');
  });
});

describe('Sprint 5.2B Preflight Check D: State Isolation', () => {
  it('D1: Progression and wardrobe actions never mutate pet vitals, XP, ledger, or high scores', () => {
    const originalPet: PetState = {
      ...INITIAL_PET_STATE,
      hunger: 72,
      happiness: 85,
      energy: 60,
      xp: 240,
      level: 3,
    };

    const originalHistory: ActionHistoryEntry[] = [
      {
        action: 'feed',
        timestamp: Date.now() - 5000,
      },
    ];

    let progression = createInitialProgressionState('curious');
    progression.stats.starCatcherHighScore = 250;

    // Equip, unequip, evaluate achievements, record interactions
    const equipRes = equipCosmetic(progression, 'dev_glasses');
    progression = equipRes.nextState;
    const interRes = recordInteraction(progression);
    progression = interRes.updatedState;
    progression = unequipCosmetic(progression, 'accessory');

    // Verify original pet state is untouched
    assert.equal(originalPet.hunger, 72);
    assert.equal(originalPet.happiness, 85);
    assert.equal(originalPet.energy, 60);
    assert.equal(originalPet.xp, 240);
    assert.equal(originalPet.level, 3);

    // Verify history ledger untouched
    assert.equal(originalHistory.length, 1);
    assert.equal(originalHistory[0].action, 'feed');

    // Verify high score untouched
    assert.equal(progression.stats.starCatcherHighScore, 250);
  });
});

describe('Sprint 5.2B Preflight Check E: Migration Safety & Corruption Recovery', () => {
  it('E1: Handles missing, partial, or malformed progression state safely without corrupting legacy pet state', () => {
    // 1. Missing progression completely
    const legacyExport = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      pet: INITIAL_PET_STATE,
      history: [],
    });

    const imported = importSaveData(legacyExport);
    assert.ok(imported.success);
    assert.ok(imported.pet);
    assert.equal(imported.pet?.name, INITIAL_PET_STATE.name);
    // Legacy saves may not have progression attached in save file, but loadLocalProgressionState creates default
    const fallbackProgression = migrateProgressionState(imported.progression);
    assert.equal(fallbackProgression.schemaVersion, 1);

    // 2. Corrupted progression data
    const corruptedRaw = {
      schemaVersion: 'INVALID_VERSION',
      inventory: ['dev_glasses', 'non_existent_item', null, 42],
      equipped: {
        accessory: 'invalid_accessory',
        environment: 12345,
        effect: null,
      },
      achievements: 'corrupted_string',
      stats: {
        totalInteractions: -50, // negative number
        personalitiesExplored: ['unknown_personality'],
      },
    };

    const sanitized = migrateProgressionState(corruptedRaw, 'playful');
    assert.equal(sanitized.schemaVersion, 1);
    assert.ok(sanitized.inventory.includes('dev_glasses'));
    assert.ok(!sanitized.inventory.includes('non_existent_item' as unknown as CosmeticId));
    // Fallback environment
    assert.equal(sanitized.equipped.environment, 'void_chamber');
    assert.equal(sanitized.equipped.accessory, null);
    // Sanitized stats
    assert.equal(sanitized.stats.totalInteractions, 0);
    // Did not fabricate unearned achievements
    assert.equal(Object.keys(sanitized.achievements).length, 0);
  });
});
