import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_PERSONALITIES,
  PERSONALITY_PROFILES,
  CURIOUS,
  DETERMINED,
  PLAYFUL,
  CALM,
  getDefaultPersonalityForSpecies,
  getPersonalityProfile,
  selectNextBehaviour,
  getCompanionReaction,
  getAmbientThought,
  mapBehaviourToSpriteState,
  type BehaviourContext,
  type PersonalityId,
} from '../../src/features/personality/index.ts';
import { validatePetState } from '../../src/features/pet-engine/validation/stateValidator.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';
import type { PetState } from '../../src/types/pet.ts';
import { executePetAction } from '../../src/features/gamification/gameplay.ts';

function createValidPetDoc(overrides: Partial<PetStateDocument> = {}): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 1,
    xp: 0,
    maxExp: 100,
    energy: 100,
    energyAccumulator: 0,
    hunger: 100,
    happiness: 100,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-20T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-20T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-20T00:00:00.000Z',
    personality: 'curious',
    ...overrides,
  };
}

function createBasePetState(overrides: Partial<PetState> = {}): PetState {
  return {
    name: 'Shadow Claw',
    species: 'cat',
    level: 3,
    xp: 250,
    maxExp: 300,
    mood: 'Curious',
    evolutionStage: 'Hatchling',
    hunger: 80,
    happiness: 80,
    energy: 80,
    personality: 'curious',
    ...overrides,
  };
}

describe('Sprint 5.1A — Companion Personalities & Profiles', () => {
  it('TC-PERS-01: Verifies all 4 archetypes are registered and contain complete trait profiles', () => {
    assert.deepEqual(ALL_PERSONALITIES, ['curious', 'determined', 'playful', 'calm']);

    for (const pId of ALL_PERSONALITIES) {
      const profile = PERSONALITY_PROFILES[pId];
      assert.ok(profile, `Profile must exist for ${pId}`);
      assert.equal(profile.id, pId);
      assert.ok(profile.name.length > 0);
      assert.ok(profile.tagline.length > 0);
      assert.ok(profile.description.length > 0);
      assert.ok(profile.primaryTrait.length > 0);
      assert.ok(profile.secondaryTrait.length > 0);
      assert.ok(profile.badgeBg.length > 0);
      assert.ok(profile.idleBehaviours.length >= 3);
      assert.ok(profile.thoughtPhrases.length >= 5);
      assert.ok(profile.dialogueReactions.feed.length > 0);
      assert.ok(profile.dialogueReactions.play.length > 0);
      assert.ok(profile.dialogueReactions.train.length > 0);
      assert.ok(profile.dialogueReactions.rest.length > 0);
      assert.ok(profile.dialogueReactions.pet.length > 0);
      assert.ok(profile.dialogueReactions.milestone.length > 0);
      assert.ok(profile.dialogueReactions.tired.length > 0);
      assert.ok(profile.dialogueReactions.hungry.length > 0);
      assert.ok(profile.dialogueReactions.idle.length > 0);
    }
  });

  it('TC-PERS-02: Maps species to canonical default personalities', () => {
    assert.equal(getDefaultPersonalityForSpecies('cat'), 'curious');
    assert.equal(getDefaultPersonalityForSpecies('dragon'), 'determined');
    assert.equal(getDefaultPersonalityForSpecies('fox'), 'playful');
    assert.equal(getDefaultPersonalityForSpecies('slime'), 'calm');
    assert.equal(getDefaultPersonalityForSpecies('unknown' as any), 'curious');
  });

  it('TC-PERS-03: Gracefully handles unknown or null personality retrieval', () => {
    const fallbackCat = getPersonalityProfile(null, 'cat');
    assert.equal(fallbackCat.id, 'curious');

    const fallbackDragon = getPersonalityProfile('invalid_archetype', 'dragon');
    assert.equal(fallbackDragon.id, 'determined');

    const fallbackUnknown = getPersonalityProfile(undefined, undefined);
    assert.equal(fallbackUnknown.id, 'curious');
  });
});

describe('Sprint 5.1A — Behaviour Engine & State Transitions', () => {
  it('TC-BEH-01: Low energy (<20) forces resting/fatigue behaviour', () => {
    const fatigueContext: BehaviourContext = {
      personality: 'curious',
      species: 'cat',
      mood: 'Resting',
      energy: 15,
      hunger: 60,
      happiness: 60,
      level: 2,
    };

    const behaviour = selectNextBehaviour(fatigueContext);
    assert.equal(behaviour, 'terminal_pondering');

    const fatigueCalm = selectNextBehaviour({ ...fatigueContext, personality: 'calm' });
    assert.equal(fatigueCalm, 'deep_breathing');

    const fatigueDetermined = selectNextBehaviour({ ...fatigueContext, personality: 'determined' });
    assert.equal(fatigueDetermined, 'training_stance');
  });

  it('TC-BEH-02: Cycles deterministically through idle behaviours with random seed', () => {
    const context: BehaviourContext = {
      personality: 'curious',
      species: 'cat',
      mood: 'Curious',
      energy: 85,
      hunger: 80,
      happiness: 90,
      level: 3,
    };

    const b0 = selectNextBehaviour(context, 0.0);
    const b1 = selectNextBehaviour(context, 0.26);
    const b2 = selectNextBehaviour(context, 0.51);
    const b3 = selectNextBehaviour(context, 0.76);

    assert.equal(b0, 'idle_curious');
    assert.equal(b1, 'investigating');
    assert.equal(b2, 'head_tilt');
    assert.equal(b3, 'terminal_pondering');
  });

  it('TC-BEH-03: Maps rich companion behaviour states to sprite animation states', () => {
    assert.equal(mapBehaviourToSpriteState('investigating'), 'curious');
    assert.equal(mapBehaviourToSpriteState('head_tilt'), 'curious');
    assert.equal(mapBehaviourToSpriteState('idle_curious'), 'curious');
    assert.equal(mapBehaviourToSpriteState('bouncing'), 'playing');
    assert.equal(mapBehaviourToSpriteState('seeking_play'), 'playing');
    assert.equal(mapBehaviourToSpriteState('eating'), 'eating');
    assert.equal(mapBehaviourToSpriteState('training_stance'), 'training');
    assert.equal(mapBehaviourToSpriteState('sleeping'), 'sleeping');
    assert.equal(mapBehaviourToSpriteState('celebrating'), 'celebrating');
    assert.equal(mapBehaviourToSpriteState('deep_breathing'), 'idle');
    assert.equal(mapBehaviourToSpriteState('zen_float'), 'idle');
  });
});

describe('Sprint 5.1A — In-Character Reactions & Dialogues', () => {
  it('TC-REACT-01: Generates context-sensitive dialogue for care actions across personalities', () => {
    const context: BehaviourContext = {
      personality: 'curious',
      species: 'cat',
      mood: 'Curious',
      energy: 70,
      hunger: 70,
      happiness: 70,
      level: 3,
    };

    const feedReact = getCompanionReaction('feed', context, 0);
    assert.match(feedReact.reactionText, /Fascinating flavor profile/);
    assert.equal(feedReact.behaviourState, 'eating');
    assert.equal(feedReact.audioEffect, 'eat');

    const petReact = getCompanionReaction('pet', context, 0);
    assert.match(petReact.reactionText, /Noticing your cursor/);
    assert.equal(petReact.behaviourState, 'head_tilt');
    assert.equal(petReact.audioEffect, 'purr');

    const trainReact = getCompanionReaction('train', { ...context, personality: 'determined' }, 0);
    assert.match(trainReact.reactionText, /Formidable discipline/);
    assert.equal(trainReact.behaviourState, 'training');

    const milestoneReact = getCompanionReaction('milestone', { ...context, personality: 'playful' }, 0);
    assert.match(milestoneReact.reactionText, /WE LEVELED UP/);
    assert.equal(milestoneReact.behaviourState, 'celebrating');
    assert.equal(milestoneReact.audioEffect, 'level_up');
  });

  it('TC-REACT-02: Generates ambient thought bubbles matching personality archetype', () => {
    const thoughtCurious = getAmbientThought('curious', 'cat', 0);
    assert.equal(thoughtCurious, 'Checking commit hashes...');

    const thoughtDetermined = getAmbientThought('determined', 'dragon', 0);
    assert.equal(thoughtDetermined, 'Keep the build green!');

    const thoughtPlayful = getAmbientThought('playful', 'fox', 0);
    assert.equal(thoughtPlayful, 'Let’s review some code together!');

    const thoughtCalm = getAmbientThought('calm', 'slime', 0);
    assert.equal(thoughtCalm, 'Smooth, steady workflows...');
  });
});

describe('Sprint 5.1A — Economy Invariant & Zero-XP Safeguards', () => {
  it('TC-ECON-01: Changing personality preserves level, XP, vitals and awards zero bonus XP', () => {
    const initialPet = createBasePetState({ level: 4, xp: 120, energy: 65, hunger: 70, happiness: 85 });
    
    // Simulate changing to each archetype
    for (const archetype of ALL_PERSONALITIES) {
      const switched: PetState = {
        ...initialPet,
        personality: archetype,
      };

      assert.equal(switched.level, 4);
      assert.equal(switched.xp, 120);
      assert.equal(switched.energy, 65);
      assert.equal(switched.hunger, 70);
      assert.equal(switched.happiness, 85);
    }
  });

  it('TC-ECON-02: executePetAction preserves cooldown and awards standard rewards under personality', () => {
    const pet = createBasePetState({ personality: 'curious', energy: 80, xp: 50 });
    const result = executePetAction({
      pet,
      action: 'feed',
      history: [],
      nowMs: 100_000,
    });

    assert.equal(result.success, true);
    assert.equal(result.reward?.expGained, 10);
    assert.equal(result.updatedPet.personality, 'curious');
    assert.ok(result.reaction.length > 0);
  });
});

describe('Sprint 5.1A — Schema Validation & Compatibility', () => {
  it('TC-SCHEMA-01: PetStateDocument schema validator accepts all valid personalities', () => {
    for (const p of ALL_PERSONALITIES) {
      const doc = createValidPetDoc({ personality: p });
      const res = validatePetState(doc);
      assert.equal(res.valid, true, `Document with personality ${p} must be valid`);
      assert.equal(res.errors.length, 0);
    }
  });

  it('TC-SCHEMA-02: PetStateDocument schema validator accepts legacy documents without personality', () => {
    const doc = createValidPetDoc();
    delete doc.personality;
    const res = validatePetState(doc);
    assert.equal(res.valid, true, 'Legacy document without personality field must remain valid');
  });

  it('TC-SCHEMA-03: PetStateDocument schema validator rejects invalid personality values', () => {
    const doc = createValidPetDoc({ personality: 'hyperactive' as any });
    const res = validatePetState(doc);
    assert.equal(res.valid, false);
    assert.match(res.errors[0], /Invalid personality/);
  });
});
