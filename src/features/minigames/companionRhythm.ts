/**
 * GitHub Profile Pet - Companion Rhythm Game Engine
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import type { RhythmNote, RhythmRating } from './types.ts';

export const RHYTHM_PERFECT_WINDOW_MS = 100; // ±100ms
export const RHYTHM_GOOD_WINDOW_MS = 250;    // ±250ms
export const RHYTHM_OK_WINDOW_MS = 450;      // ±450ms

export interface CompanionRhythmState {
  notes: RhythmNote[];
  score: number;
  streak: number;
  maxStreak: number;
  totalHits: number;
  totalMisses: number;
  perfectHits: number;
  goodHits: number;
  lastRating: RhythmRating | null;
  isComplete: boolean;
  totalNotes: number;
}

/**
 * Creates deterministic sequence of rhythm notes.
 */
export function createRhythmTrack(noteCount: number = 16, startDelayMs: number = 1500, intervalMs: number = 1100): RhythmNote[] {
  const notes: RhythmNote[] = [];
  for (let i = 0; i < noteCount; i++) {
    notes.push({
      id: i,
      targetTimeMs: startDelayMs + i * intervalMs,
      hit: false,
    });
  }
  return notes;
}

export function createInitialCompanionRhythmState(track: RhythmNote[] = createRhythmTrack()): CompanionRhythmState {
  return {
    notes: track,
    score: 0,
    streak: 0,
    maxStreak: 0,
    totalHits: 0,
    totalMisses: 0,
    perfectHits: 0,
    goodHits: 0,
    lastRating: null,
    isComplete: false,
    totalNotes: track.length,
  };
}

/**
 * Evaluates rating based on time delta from target time.
 */
export function calculateRhythmRating(deltaMs: number): RhythmRating {
  const absDelta = Math.abs(deltaMs);
  if (absDelta <= RHYTHM_PERFECT_WINDOW_MS) return 'perfect';
  if (absDelta <= RHYTHM_GOOD_WINDOW_MS) return 'good';
  if (absDelta <= RHYTHM_OK_WINDOW_MS) return deltaMs < 0 ? 'early' : 'late';
  return 'miss';
}

/**
 * Evaluates points for a given rating, plus streak bonuses.
 */
export function getRatingPoints(rating: RhythmRating, currentStreak: number): number {
  const streakBonus = Math.min(25, Math.floor(currentStreak / 3) * 5);
  switch (rating) {
    case 'perfect':
      return 50 + streakBonus;
    case 'good':
      return 25 + streakBonus;
    case 'early':
    case 'late':
      return 10;
    case 'miss':
    default:
      return 0;
  }
}

/**
 * Processes a player's strike input at currentTimeMs relative to game start.
 */
export function strikeRhythmBeat(
  state: CompanionRhythmState,
  currentTimeMs: number
): {
  nextState: CompanionRhythmState;
  rating: RhythmRating | null;
  pointsAwarded: number;
} {
  if (state.isComplete) {
    return { nextState: state, rating: null, pointsAwarded: 0 };
  }

  // Find nearest unhit note within strike window (±450ms)
  let closestNote: RhythmNote | null = null;
  let smallestDelta = Infinity;

  for (const n of state.notes) {
    if (!n.hit) {
      const delta = currentTimeMs - n.targetTimeMs;
      if (Math.abs(delta) <= RHYTHM_OK_WINDOW_MS && Math.abs(delta) < Math.abs(smallestDelta)) {
        smallestDelta = delta;
        closestNote = n;
      }
    }
  }

  if (!closestNote) {
    // Strike with no note in range (counts as slight misfire, does not break streak if notes haven't passed)
    return { nextState: state, rating: null, pointsAwarded: 0 };
  }

  const rating = calculateRhythmRating(smallestDelta);
  const nextStreak = rating === 'miss' ? 0 : state.streak + 1;
  const maxStreak = Math.max(state.maxStreak, nextStreak);
  const pointsAwarded = getRatingPoints(rating, state.streak);

  const updatedNotes = state.notes.map((n) =>
    n.id === closestNote!.id
      ? {
          ...n,
          hit: true,
          hitTimeMs: currentTimeMs,
          rating,
          deltaMs: smallestDelta,
        }
      : n
  );

  const allProcessed = updatedNotes.every((n) => n.hit);

  return {
    nextState: {
      ...state,
      notes: updatedNotes,
      score: state.score + pointsAwarded,
      streak: nextStreak,
      maxStreak,
      totalHits: state.totalHits + (rating !== 'miss' ? 1 : 0),
      totalMisses: state.totalMisses + (rating === 'miss' ? 1 : 0),
      perfectHits: state.perfectHits + (rating === 'perfect' ? 1 : 0),
      goodHits: state.goodHits + (rating === 'good' ? 1 : 0),
      lastRating: rating,
      isComplete: allProcessed,
    },
    rating,
    pointsAwarded,
  };
}

/**
 * Ticks rhythm timeline, automatically marking expired notes as misses.
 */
export function tickRhythmTrack(
  state: CompanionRhythmState,
  currentTimeMs: number
): {
  nextState: CompanionRhythmState;
  newMisses: RhythmNote[];
} {
  if (state.isComplete) {
    return { nextState: state, newMisses: [] };
  }

  const newMisses: RhythmNote[] = [];

  const updatedNotes = state.notes.map((n) => {
    if (!n.hit && currentTimeMs > n.targetTimeMs + RHYTHM_OK_WINDOW_MS) {
      const missed = { ...n, hit: true, rating: 'miss' as RhythmRating };
      newMisses.push(missed);
      return missed;
    }
    return n;
  });

  const nextStreak = newMisses.length > 0 ? 0 : state.streak;
  const allProcessed = updatedNotes.every((n) => n.hit);

  return {
    nextState: {
      ...state,
      notes: updatedNotes,
      streak: nextStreak,
      totalMisses: state.totalMisses + newMisses.length,
      lastRating: newMisses.length > 0 ? 'miss' : state.lastRating,
      isComplete: allProcessed,
    },
    newMisses,
  };
}
