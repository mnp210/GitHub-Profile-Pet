/**
 * GitHub Profile Pet - Behaviour State Engine
 * Sprint 5.1A: Pet Personality, Behaviour & Living Companion System
 *
 * Implements deterministic behaviour state selection, context-sensitive reactions,
 * thought generation, and sprite state mapping.
 */

import type { ActionType } from '../gamification/rewards.ts';
import type {
  BehaviourContext,
  BehaviourState,
  CompanionReaction,
  IdleBehaviourState,
  PersonalityId,
} from './types.ts';
import { getPersonalityProfile } from './personalities.ts';
import type { SpriteAnimationState } from '../../components/pet/PetSprite.tsx';

/**
 * Maps a rich BehaviourState to the appropriate SpriteAnimationState for visual rendering.
 */
export function mapBehaviourToSpriteState(behaviour: BehaviourState): SpriteAnimationState {
  switch (behaviour) {
    case 'eating':
      return 'eating';
    case 'training':
    case 'training_stance':
      return 'training';
    case 'sleeping':
      return 'sleeping';
    case 'happy':
      return 'happy';
    case 'celebrating':
      return 'celebrating';
    case 'clicked':
      return 'clicked';
    case 'bouncing':
    case 'seeking_play':
    case 'playing':
      return 'playing';
    case 'head_tilt':
    case 'investigating':
    case 'idle_curious':
      return 'curious';
    case 'deep_breathing':
    case 'zen_float':
    case 'peaceful_bubble':
    case 'idle_calm':
    case 'flame_focus':
    case 'ready_to_build':
    case 'idle_determined':
    case 'tail_wag':
    case 'idle_playful':
    case 'terminal_pondering':
    default:
      return 'idle';
  }
}

/**
 * Deterministically or probabilistically selects the next idle behaviour for a pet companion.
 */
export function selectNextBehaviour(
  context: BehaviourContext,
  randomVal: number = Math.random()
): IdleBehaviourState {
  const profile = getPersonalityProfile(context.personality, context.species);

  // Severe fatigue check (energy < 20): revert to low-energy resting posture
  if (context.energy < 20) {
    if (context.personality === 'calm') return 'deep_breathing';
    if (context.personality === 'determined') return 'training_stance';
    if (context.personality === 'playful') return 'idle_playful';
    return 'terminal_pondering';
  }

  // Weight options based on personality profile
  const pool = profile.idleBehaviours;
  if (!pool || pool.length === 0) {
    return 'idle_curious';
  }

  const index = Math.floor(randomVal * pool.length) % pool.length;
  return pool[index];
}

/**
 * Generates an in-character contextual reaction when an action is executed.
 */
export function getCompanionReaction(
  action: ActionType | 'pet_click' | 'milestone' | 'idle_thought',
  context: BehaviourContext,
  seedIndex?: number
): CompanionReaction {
  const profile = getPersonalityProfile(context.personality, context.species);
  const pick = (arr: string[]): string => {
    if (!arr || arr.length === 0) return '...';
    const idx = seedIndex !== undefined ? seedIndex % arr.length : Math.floor(Math.random() * arr.length);
    return arr[idx];
  };

  switch (action) {
    case 'feed': {
      const reactionText = pick(profile.dialogueReactions.feed);
      return {
        reactionText,
        behaviourState: 'eating',
        audioEffect: 'eat',
        thoughtBubble: `Satiety +24 (${profile.primaryTrait})`,
      };
    }

    case 'play': {
      const reactionText = pick(profile.dialogueReactions.play);
      return {
        reactionText,
        behaviourState: 'playing',
        audioEffect: 'play',
        thoughtBubble: `Happiness +16 (${profile.secondaryTrait})`,
      };
    }

    case 'train': {
      const reactionText = pick(profile.dialogueReactions.train);
      return {
        reactionText,
        behaviourState: 'training',
        audioEffect: 'train',
        thoughtBubble: `Discipline +30 XP`,
      };
    }

    case 'rest': {
      const reactionText = pick(profile.dialogueReactions.rest);
      return {
        reactionText,
        behaviourState: 'sleeping',
        audioEffect: 'click',
        thoughtBubble: `Resting peacefully...`,
      };
    }

    case 'pet':
    case 'pet_click': {
      const reactionText = pick(profile.dialogueReactions.pet);
      const behaviourState = context.personality === 'playful' ? 'playing' : context.personality === 'curious' ? 'head_tilt' : 'happy';
      return {
        reactionText,
        behaviourState,
        audioEffect: 'purr',
        thoughtBubble: `❤️ Loved by trainer`,
      };
    }

    case 'milestone': {
      const reactionText = pick(profile.dialogueReactions.milestone);
      return {
        reactionText,
        behaviourState: 'celebrating',
        audioEffect: 'level_up',
        thoughtBubble: `🎉 Milestone Achieved!`,
      };
    }

    case 'idle_thought':
    default: {
      // Check fatigue / hunger priority
      if (context.energy < 20) {
        return {
          reactionText: pick(profile.dialogueReactions.tired),
          behaviourState: 'idle_calm',
          thoughtBubble: 'Tired... Need a quick rest 🌙',
        };
      }
      if (context.hunger < 20) {
        return {
          reactionText: pick(profile.dialogueReactions.hungry),
          behaviourState: 'idle_curious',
          thoughtBubble: 'Hungry for some commits 🍖',
        };
      }

      const reactionText = pick(profile.dialogueReactions.idle);
      const thoughtBubble = pick(profile.thoughtPhrases);
      return {
        reactionText,
        behaviourState: selectNextBehaviour(context, seedIndex !== undefined ? (seedIndex * 0.37) % 1 : undefined),
        thoughtBubble,
      };
    }
  }
}

/**
 * Returns a quick ambient thought bubble text for periodic companion musings.
 */
export function getAmbientThought(
  personality: PersonalityId,
  species: BehaviourContext['species'],
  seedIndex?: number
): string {
  const profile = getPersonalityProfile(personality, species);
  const pool = profile.thoughtPhrases;
  if (!pool || pool.length === 0) return 'Observing carefully...';
  const idx = seedIndex !== undefined ? seedIndex % pool.length : Math.floor(Math.random() * pool.length);
  return pool[idx];
}
