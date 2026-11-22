/**
 * GitHub Profile Pet - Star Catcher Game Engine
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import type { StarEntity, StarType } from './types.ts';

export const STAR_CATCHER_ROUND_DURATION_SEC = 25;
export const BASKET_WIDTH_PCT = 20; // 20% width
export const CATCH_RADIUS_PCT = 12; // 12% click/touch radius

export interface StarCatcherState {
  stars: StarEntity[];
  score: number;
  streak: number;
  maxStreak: number;
  totalSpawned: number;
  totalCaught: number;
  totalMissed: number;
  timeRemainingSec: number;
  isComplete: boolean;
  basketX: number; // 0 to 100
}

export function createInitialStarCatcherState(): StarCatcherState {
  return {
    stars: [],
    score: 0,
    streak: 0,
    maxStreak: 0,
    totalSpawned: 0,
    totalCaught: 0,
    totalMissed: 0,
    timeRemainingSec: STAR_CATCHER_ROUND_DURATION_SEC,
    isComplete: false,
    basketX: 50,
  };
}

/**
 * Spawns a new star entity within bounds [8, 92]%.
 */
export function spawnStar(
  id: string,
  spawnTimeMs: number,
  randomX: number = Math.random(),
  randomType: number = Math.random()
): StarEntity {
  const x = Math.min(92, Math.max(8, Math.round(randomX * 84 + 8)));
  let type: StarType = 'standard';
  let points = 10;
  let speedY = 18; // 18% of screen height per second

  if (randomType > 0.8) {
    type = 'golden';
    points = 25;
    speedY = 28;
  } else if (randomType > 0.55) {
    type = 'nebula';
    points = 15;
    speedY = 22;
  }

  return {
    id,
    type,
    x,
    y: 0,
    speedY,
    points,
    caught: false,
    missed: false,
    spawnTimeMs,
  };
}

/**
 * Advances game physics by delta seconds, updating star positions and flagging missed items.
 */
export function tickStarCatcher(
  state: StarCatcherState,
  deltaSec: number
): { nextState: StarCatcherState; newMisses: StarEntity[] } {
  if (state.isComplete) {
    return { nextState: state, newMisses: [] };
  }

  const newTime = Math.max(0, state.timeRemainingSec - deltaSec);
  const isComplete = newTime <= 0;
  const newMisses: StarEntity[] = [];

  const updatedStars = state.stars.map((s) => {
    if (s.caught || s.missed) return s;
    const nextY = s.y + s.speedY * deltaSec;
    if (nextY >= 95) {
      const missedStar = { ...s, y: 95, missed: true };
      newMisses.push(missedStar);
      return missedStar;
    }
    return { ...s, y: nextY };
  });

  const nextStreak = newMisses.length > 0 ? 0 : state.streak;

  return {
    nextState: {
      ...state,
      stars: updatedStars.filter((s) => !s.caught && (!s.missed || s.y < 100)),
      timeRemainingSec: Math.round(newTime * 10) / 10,
      streak: nextStreak,
      totalMissed: state.totalMissed + newMisses.length,
      isComplete,
    },
    newMisses,
  };
}

/**
 * Processes a direct click or touch on a falling star.
 */
export function catchStarDirect(
  state: StarCatcherState,
  starId: string
): { nextState: StarCatcherState; caughtStar?: StarEntity; pointsAwarded: number } {
  const target = state.stars.find((s) => s.id === starId && !s.caught && !s.missed);
  if (!target) {
    return { nextState: state, pointsAwarded: 0 };
  }

  const streakBonus = Math.floor(state.streak / 3) * 5;
  const pointsAwarded = target.points + streakBonus;
  const nextStreak = state.streak + 1;
  const maxStreak = Math.max(state.maxStreak, nextStreak);

  const updatedStars = state.stars.map((s) =>
    s.id === starId ? { ...s, caught: true } : s
  );

  return {
    nextState: {
      ...state,
      stars: updatedStars,
      score: state.score + pointsAwarded,
      streak: nextStreak,
      maxStreak,
      totalCaught: state.totalCaught + 1,
    },
    caughtStar: { ...target, caught: true },
    pointsAwarded,
  };
}

/**
 * Processes catching stars with the movable net at the bottom.
 */
export function catchStarsWithNet(
  state: StarCatcherState
): { nextState: StarCatcherState; caughtStars: StarEntity[]; totalPoints: number } {
  const netMin = state.basketX - BASKET_WIDTH_PCT / 2;
  const netMax = state.basketX + BASKET_WIDTH_PCT / 2;

  const caughtList: StarEntity[] = [];
  let pointsGained = 0;
  let currentStreak = state.streak;
  let maxStreak = state.maxStreak;

  const updatedStars = state.stars.map((s) => {
    if (!s.caught && !s.missed && s.y >= 75 && s.y <= 95 && s.x >= netMin && s.x <= netMax) {
      currentStreak += 1;
      maxStreak = Math.max(maxStreak, currentStreak);
      const bonus = Math.floor(currentStreak / 3) * 5;
      const awarded = s.points + bonus;
      pointsGained += awarded;
      const caught = { ...s, caught: true };
      caughtList.push(caught);
      return caught;
    }
    return s;
  });

  return {
    nextState: {
      ...state,
      stars: updatedStars,
      score: state.score + pointsGained,
      streak: currentStreak,
      maxStreak,
      totalCaught: state.totalCaught + caughtList.length,
    },
    caughtStars: caughtList,
    totalPoints: pointsGained,
  };
}
