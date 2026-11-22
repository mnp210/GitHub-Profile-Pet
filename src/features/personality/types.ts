/**
 * GitHub Profile Pet - Personality Engine Domain Types
 * Sprint 5.1A: Pet Personality, Behaviour & Living Companion System
 */

import type { SpeciesId, PetMood } from '../../types/pet.ts';
import type { ActionType } from '../gamification/rewards.ts';

export type PersonalityId = 'curious' | 'playful' | 'calm' | 'determined';

export type CompanionAction = ActionType;

export type IdleBehaviourState =
  // Curious behaviours
  | 'idle_curious'
  | 'investigating'
  | 'head_tilt'
  | 'terminal_pondering'
  // Playful behaviours
  | 'idle_playful'
  | 'bouncing'
  | 'tail_wag'
  | 'seeking_play'
  // Calm behaviours
  | 'idle_calm'
  | 'deep_breathing'
  | 'zen_float'
  | 'peaceful_bubble'
  // Determined behaviours
  | 'idle_determined'
  | 'training_stance'
  | 'flame_focus'
  | 'ready_to_build';

export type TransientBehaviourState =
  | 'happy'
  | 'eating'
  | 'training'
  | 'sleeping'
  | 'playing'
  | 'celebrating'
  | 'clicked';

export type BehaviourState = IdleBehaviourState | TransientBehaviourState;

export interface PersonalityProfile {
  id: PersonalityId;
  name: string;
  tagline: string;
  description: string;
  primaryTrait: string;
  secondaryTrait: string;
  favoredSpecies: SpeciesId;
  colorAccent: string;
  badgeBg: string;
  idleBehaviours: IdleBehaviourState[];
  thoughtPhrases: string[];
  dialogueReactions: {
    feed: string[];
    play: string[];
    train: string[];
    rest: string[];
    pet: string[];
    milestone: string[];
    tired: string[];
    hungry: string[];
    idle: string[];
  };
  animationModifiers: {
    blinkIntervalMs: number;
    movementPace: 'slow' | 'normal' | 'fast';
    bounceHeight: 'none' | 'subtle' | 'high';
    eyeStyle: 'normal' | 'wide' | 'zen' | 'focused';
  };
}

export interface BehaviourContext {
  personality: PersonalityId;
  species: SpeciesId;
  mood: PetMood;
  energy: number;
  hunger: number;
  happiness: number;
  level: number;
  isSleeping?: boolean;
}

export interface CompanionReaction {
  reactionText: string;
  behaviourState: BehaviourState;
  thoughtBubble?: string;
  audioEffect?: 'purr' | 'eat' | 'play' | 'train' | 'click' | 'level_up';
}
