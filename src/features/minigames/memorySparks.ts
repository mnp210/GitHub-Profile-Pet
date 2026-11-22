/**
 * GitHub Profile Pet - Memory Sparks Game Engine
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import type { SparkRune } from './types.ts';

export const SPARK_RUNES: SparkRune[] = [
  {
    id: 0,
    name: 'Emerald Spark',
    color: 'emerald',
    label: 'North Rune',
    keyLabel: '1 / W / ↑',
    keyCode: 'Digit1',
    glyph: '🌿',
    baseColorClass: 'bg-emerald-950/80 border-emerald-600/50 text-emerald-300',
    activeColorClass: 'bg-emerald-400 border-white text-emerald-950 shadow-[0_0_24px_rgba(52,211,153,0.9)] scale-105',
  },
  {
    id: 1,
    name: 'Amber Spark',
    color: 'amber',
    label: 'East Rune',
    keyLabel: '2 / D / →',
    keyCode: 'Digit2',
    glyph: '⚡',
    baseColorClass: 'bg-amber-950/80 border-amber-600/50 text-amber-300',
    activeColorClass: 'bg-amber-400 border-white text-amber-950 shadow-[0_0_24px_rgba(251,191,36,0.9)] scale-105',
  },
  {
    id: 2,
    name: 'Crimson Spark',
    color: 'crimson',
    label: 'South Rune',
    keyLabel: '3 / S / ↓',
    keyCode: 'Digit3',
    glyph: '🔥',
    baseColorClass: 'bg-red-950/80 border-red-600/50 text-red-300',
    activeColorClass: 'bg-red-500 border-white text-red-950 shadow-[0_0_24px_rgba(239,68,68,0.9)] scale-105',
  },
  {
    id: 3,
    name: 'Cyan Spark',
    color: 'cyan',
    label: 'West Rune',
    keyLabel: '4 / A / ←',
    keyCode: 'Digit4',
    glyph: '💧',
    baseColorClass: 'bg-cyan-950/80 border-cyan-600/50 text-cyan-300',
    activeColorClass: 'bg-cyan-400 border-white text-cyan-950 shadow-[0_0_24px_rgba(34,211,238,0.9)] scale-105',
  },
];

export type MemoryPhase = 'showing_sequence' | 'awaiting_input' | 'round_success' | 'game_over';

export interface MemorySparksState {
  sequence: number[]; // array of rune IDs (0..3)
  playerInputIndex: number; // index of next expected input
  round: number; // starts at 1
  score: number;
  phase: MemoryPhase;
  activeSpark: number | null; // rune id currently illuminated
  isInputLocked: boolean;
  totalCorrect: number;
  maxRounds: number;
}

export function createInitialMemorySparksState(initialSequenceLength: number = 2): MemorySparksState {
  const sequence: number[] = [];
  for (let i = 0; i < initialSequenceLength; i++) {
    sequence.push(Math.floor(Math.random() * 4));
  }

  return {
    sequence,
    playerInputIndex: 0,
    round: 1,
    score: 0,
    phase: 'showing_sequence',
    activeSpark: null,
    isInputLocked: true,
    totalCorrect: 0,
    maxRounds: 10,
  };
}

/**
 * Appends a new random rune to the sequence for the next round.
 */
export function advanceToNextRound(
  state: MemorySparksState,
  randomNextRune: number = Math.floor(Math.random() * 4)
): MemorySparksState {
  const newSequence = [...state.sequence, randomNextRune];
  return {
    ...state,
    round: state.round + 1,
    sequence: newSequence,
    playerInputIndex: 0,
    phase: 'showing_sequence',
    isInputLocked: true,
    activeSpark: null,
  };
}

/**
 * Handles player inputting a rune ID (0..3).
 */
export function submitRuneInput(
  state: MemorySparksState,
  runeId: number
): {
  nextState: MemorySparksState;
  isCorrect: boolean;
  isRoundComplete: boolean;
  pointsAwarded: number;
} {
  // Reject input if locked during playback or already game over
  if (state.isInputLocked || state.phase !== 'awaiting_input') {
    return {
      nextState: state,
      isCorrect: false,
      isRoundComplete: false,
      pointsAwarded: 0,
    };
  }

  const expectedRune = state.sequence[state.playerInputIndex];
  if (runeId !== expectedRune) {
    // Incorrect input: Game Over
    return {
      nextState: {
        ...state,
        phase: 'game_over',
        isInputLocked: true,
        activeSpark: null,
      },
      isCorrect: false,
      isRoundComplete: false,
      pointsAwarded: 0,
    };
  }

  // Correct rune input!
  const pointsAwarded = 15;
  const nextInputIdx = state.playerInputIndex + 1;
  const isRoundComplete = nextInputIdx >= state.sequence.length;

  if (isRoundComplete) {
    const roundBonus = state.round * 25;
    return {
      nextState: {
        ...state,
        score: state.score + pointsAwarded + roundBonus,
        playerInputIndex: nextInputIdx,
        phase: 'round_success',
        isInputLocked: true,
        totalCorrect: state.totalCorrect + 1,
      },
      isCorrect: true,
      isRoundComplete: true,
      pointsAwarded: pointsAwarded + roundBonus,
    };
  }

  return {
    nextState: {
      ...state,
      score: state.score + pointsAwarded,
      playerInputIndex: nextInputIdx,
      totalCorrect: state.totalCorrect + 1,
    },
    isCorrect: true,
    isRoundComplete: false,
    pointsAwarded,
  };
}
