/**
 * GitHub Profile Pet - Mini-games Domain Types
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import type { BehaviourState } from '../personality/types.ts';

export type MiniGameId = 'star_catcher' | 'memory_sparks' | 'companion_rhythm';

export type GameSessionStatus =
  | 'idle'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'completed'
  | 'abandoned';

export interface GameSession {
  sessionId: string;
  gameId: MiniGameId;
  status: GameSessionStatus;
  score: number;
  highScore: number;
  startedAt: number;
  endedAt: number | null;
  durationSec: number;
  streak: number;
  maxStreak: number;
  accuracy: number;
  isNewBest: boolean;
}

export type StarType = 'standard' | 'golden' | 'nebula';

export interface StarEntity {
  id: string;
  type: StarType;
  x: number; // 5% to 95% percentage
  y: number; // 0% to 100% percentage
  speedY: number; // percentage per second
  points: number;
  caught: boolean;
  missed: boolean;
  spawnTimeMs: number;
}

export type SparkColor = 'emerald' | 'amber' | 'crimson' | 'cyan';

export interface SparkRune {
  id: number; // 0, 1, 2, 3
  name: string;
  color: SparkColor;
  label: string;
  keyLabel: string;
  keyCode: string;
  glyph: string;
  activeColorClass: string;
  baseColorClass: string;
}

export type RhythmRating = 'perfect' | 'good' | 'early' | 'late' | 'miss';

export interface RhythmNote {
  id: number;
  targetTimeMs: number;
  hit: boolean;
  hitTimeMs?: number;
  rating?: RhythmRating;
  deltaMs?: number;
}

export interface MiniGameEventReaction {
  reactionText: string;
  behaviourState: BehaviourState;
  thoughtBubble?: string;
}

export interface MiniGameMeta {
  id: MiniGameId;
  title: string;
  tagline: string;
  description: string;
  icon: string;
  badge: string;
  colorAccent: string;
  difficulty: 'Relaxed' | 'Engaging' | 'Challenging';
  instructions: string[];
  controls: { key: string; action: string }[];
}
