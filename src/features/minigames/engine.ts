/**
 * GitHub Profile Pet - Mini-games Core Session Engine & Catalog
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import type { GameSession, MiniGameId, MiniGameMeta } from './types.ts';

const LOCAL_STORAGE_SCORES_KEY = 'gh_pet_minigame_scores_v1';

export const MINI_GAMES_CATALOG: Record<MiniGameId, MiniGameMeta> = {
  star_catcher: {
    id: 'star_catcher',
    title: 'Star Catcher',
    tagline: 'Fast-paced celestial reflex sprint',
    description: 'Drifting stars fall through the night sky. Tap or click the falling stars or use Arrow Keys to catch them before they escape!',
    icon: '⭐',
    badge: 'Reflex & Agility',
    colorAccent: '#fbbf24',
    difficulty: 'Relaxed',
    instructions: [
      'Catch descending stars by clicking or tapping them directly.',
      'Keyboard: Use Left/Right arrows or A/D to position the catch net, Space to collect.',
      'Golden stars grant bonus points (+25 pts) and move faster.',
      'Maintain your combo streak without letting stars escape.',
    ],
    controls: [
      { key: 'Mouse / Touch', action: 'Direct tap on falling stars' },
      { key: '← / → (A / D)', action: 'Move catch net' },
      { key: 'Space', action: 'Burst catch' },
      { key: 'Esc / P', action: 'Pause game' },
    ],
  },
  memory_sparks: {
    id: 'memory_sparks',
    title: 'Memory Sparks',
    tagline: 'Cyberpunk elemental sequence challenge',
    description: 'The ancient runes illuminate in vibrant sequence. Observe the rhythmic pattern and repeat it back step-by-step.',
    icon: '🔮',
    badge: 'Memory & Sequence',
    colorAccent: '#a855f7',
    difficulty: 'Engaging',
    instructions: [
      'Watch carefully as the 4 elemental runes light up in sequence.',
      'Once playback completes, reproduce the exact sequence.',
      'Each successful round adds one more rune to the sequence.',
      'Mistakes end the round gracefully with your final score.',
    ],
    controls: [
      { key: '1 / W / ↑', action: 'Emerald Rune (Top)' },
      { key: '2 / D / →', action: 'Amber Rune (Right)' },
      { key: '3 / S / ↓', action: 'Crimson Rune (Bottom)' },
      { key: '4 / A / ←', action: 'Cyan Rune (Left)' },
      { key: 'Mouse / Touch', action: 'Click rune pads directly' },
    ],
  },
  companion_rhythm: {
    id: 'companion_rhythm',
    title: 'Companion Rhythm',
    tagline: 'Synchronized visual timing groove',
    description: 'Harmonious rhythm pulses travel along the timeline. Tap in sync right as each pulse aligns with the target zone for high scores.',
    icon: '🎵',
    badge: 'Timing & Rhythm',
    colorAccent: '#06b6d4',
    difficulty: 'Challenging',
    instructions: [
      'Visual rhythm pulses travel toward the illuminated target line.',
      'Tap Space, Enter, or Click right when the note hits the center target.',
      'Scoring: PERFECT (±100ms: +50), GOOD (±250ms: +25), EARLY/LATE (+10).',
      'Continuous accurate timing builds higher multiplier combos!',
    ],
    controls: [
      { key: 'Space / Enter', action: 'Strike rhythm beat' },
      { key: 'Mouse / Touch', action: 'Tap the rhythm hit button' },
      { key: 'Esc / P', action: 'Pause / Resume' },
    ],
  },
};

/**
 * Loads stored high scores from localStorage.
 */
export function loadHighScores(): Record<MiniGameId, number> {
  const defaults: Record<MiniGameId, number> = {
    star_catcher: 0,
    memory_sparks: 0,
    companion_rhythm: 0,
  };

  if (typeof window === 'undefined') return defaults;

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_SCORES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          star_catcher: Number(parsed.star_catcher) || 0,
          memory_sparks: Number(parsed.memory_sparks) || 0,
          companion_rhythm: Number(parsed.companion_rhythm) || 0,
        };
      }
    }
  } catch (err) {
    console.warn('Failed to load minigame scores:', err);
  }

  return defaults;
}

/**
 * Saves a new high score to localStorage if higher than previous record.
 */
export function saveHighScore(gameId: MiniGameId, score: number): boolean {
  if (typeof window === 'undefined') return false;
  if (!Number.isFinite(score) || score <= 0) return false;

  try {
    const currentScores = loadHighScores();
    const existing = currentScores[gameId] || 0;
    if (score > existing) {
      currentScores[gameId] = Math.floor(score);
      localStorage.setItem(LOCAL_STORAGE_SCORES_KEY, JSON.stringify(currentScores));
      return true;
    }
  } catch (err) {
    console.error('Failed to save minigame high score:', err);
  }

  return false;
}

/**
 * Creates a clean, validated game session.
 */
export function createGameSession(
  gameId: MiniGameId,
  overrideHighScore?: number,
  nowMs: number = Date.now()
): GameSession {
  const highScores = loadHighScores();
  const highScore = overrideHighScore !== undefined ? overrideHighScore : highScores[gameId] || 0;
  const sessionId = `${gameId}_${nowMs}_${Math.random().toString(36).substring(2, 8)}`;

  return {
    sessionId,
    gameId,
    status: 'ready',
    score: 0,
    highScore,
    startedAt: nowMs,
    endedAt: null,
    durationSec: 0,
    streak: 0,
    maxStreak: 0,
    accuracy: 100,
    isNewBest: false,
  };
}

/**
 * Begins active gameplay.
 */
export function startGameSession(session: GameSession, nowMs: number = Date.now()): GameSession {
  if (session.status === 'completed' || session.status === 'abandoned') {
    throw new Error(`Cannot start already finished session ${session.sessionId}`);
  }
  return {
    ...session,
    status: 'playing',
    startedAt: nowMs,
  };
}

/**
 * Pauses active session.
 */
export function pauseGameSession(session: GameSession): GameSession {
  if (session.status !== 'playing') return session;
  return { ...session, status: 'paused' };
}

/**
 * Resumes paused session.
 */
export function resumeGameSession(session: GameSession): GameSession {
  if (session.status !== 'paused') return session;
  return { ...session, status: 'playing' };
}

/**
 * Concludes a game session, validating and sealing final scores.
 */
export function finishGameSession(
  session: GameSession,
  params: {
    finalScore: number;
    maxStreak?: number;
    accuracy?: number;
    nowMs?: number;
  }
): GameSession {
  if (session.status === 'completed') {
    return session; // Prevent duplicate completion mutation
  }

  const { finalScore, maxStreak = session.maxStreak, accuracy = session.accuracy, nowMs = Date.now() } = params;

  // Enforce score validation invariants
  if (!Number.isFinite(finalScore) || finalScore < 0) {
    throw new Error(`Invalid score submitted: ${finalScore}`);
  }

  const cleanScore = Math.floor(finalScore);
  const durationSec = Math.max(1, Math.round((nowMs - session.startedAt) / 1000));
  const isNewBest = cleanScore > session.highScore;

  if (isNewBest) {
    saveHighScore(session.gameId, cleanScore);
  }

  return {
    ...session,
    status: 'completed',
    score: cleanScore,
    highScore: isNewBest ? cleanScore : session.highScore,
    endedAt: nowMs,
    durationSec,
    streak: 0,
    maxStreak,
    accuracy: Math.min(100, Math.max(0, Math.round(accuracy))),
    isNewBest,
  };
}

/**
 * Abandons/exits a game session prematurely without saving a record.
 */
export function abandonGameSession(session: GameSession): GameSession {
  return {
    ...session,
    status: 'abandoned',
    endedAt: Date.now(),
  };
}
