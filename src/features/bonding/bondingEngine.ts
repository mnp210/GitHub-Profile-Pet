/**
 * GitHub Profile Pet - Companion Bonding Engine
 * Sprint 5.2B: Companion Bonding & Daily Activities System
 *
 * Implements deterministic bond progression, milestone evaluations,
 * anti-farming safeguards, and idempotent activity tracking.
 */

import type {
  BondLevel,
  BondMilestone,
  BondMilestoneId,
  DailyActivity,
  DailyActivityId,
  DailyActivitiesState,
  RotatingChallengeProgress,
  BondingState,
  BondingStats,
  BondingEventResult,
} from './types.ts';
import {
  BOND_MILESTONES_LIST,
  DAILY_ACTIVITIES_CATALOG,
  ROTATING_CHALLENGES_CATALOG,
  MAX_BOND_POINTS,
} from './bondingCatalog.ts';
import {
  getTodayUtcDateString,
  getDailyActivitiesForDate,
  getRotatingChallengeForDate,
} from './timePolicy.ts';

export const CURRENT_BONDING_SCHEMA_VERSION = 1;

/**
 * Calculates the current bond level based on total bond points.
 */
export function calculateBondLevel(points: number): BondLevel {
  if (points >= 350) return 5;
  if (points >= 220) return 4;
  if (points >= 120) return 3;
  if (points >= 50) return 2;
  return 1;
}

/**
 * Creates fresh daily activity entries for a given dateKey.
 */
export function createDailyActivitiesForDate(dateKey: string): DailyActivitiesState {
  const selectedIds = getDailyActivitiesForDate(dateKey);
  const activities: Record<DailyActivityId, { progress: number; completed: boolean; completedAt: number | null }> = {
    daily_care_warmth: { progress: 0, completed: false, completedAt: null },
    daily_companion_pet: { progress: 0, completed: false, completedAt: null },
    daily_minigame_play: { progress: 0, completed: false, completedAt: null },
    daily_wardrobe_style: { progress: 0, completed: false, completedAt: null },
    daily_personality_chat: { progress: 0, completed: false, completedAt: null },
  };

  // Mark only selected daily activities as active targets
  for (const id of selectedIds) {
    activities[id] = { progress: 0, completed: false, completedAt: null };
  }

  return {
    dateKey,
    activities,
  };
}

/**
 * Creates a fresh initial bonding state.
 */
export function createInitialBondingState(timestamp: number = Date.now()): BondingState {
  const dateKey = getTodayUtcDateString(timestamp);
  const dailyActivities = createDailyActivitiesForDate(dateKey);
  const challengeInfo = getRotatingChallengeForDate(dateKey);

  const activeChallenge: RotatingChallengeProgress = {
    challengeId: challengeInfo.challengeId,
    rotationKey: challengeInfo.rotationKey,
    progress: 0,
    completed: false,
    completedAt: null,
  };

  const stats: BondingStats = {
    totalDailyActivitiesCompleted: 0,
    totalChallengesCompleted: 0,
    daysInteractedCount: 1,
    lastActiveDateKey: dateKey,
    consecutiveDays: 1,
    dailyDirectStrokesPoints: {},
    dailyCarePoints: {},
    dailyMiniGamePoints: {},
  };

  const initialMilestones: Record<BondMilestoneId, { unlockedAt: number }> = {
    milestone_first_meeting: { unlockedAt: timestamp },
  } as Record<BondMilestoneId, { unlockedAt: number }>;

  return {
    schemaVersion: CURRENT_BONDING_SCHEMA_VERSION,
    bondPoints: 0,
    bondLevel: 1,
    unlockedMilestones: initialMilestones,
    dailyActivities,
    activeChallenge,
    stats,
  };
}

/**
 * Checks for UTC date rollover and resets daily activities / rotates challenges if needed.
 */
export function checkAndResetDay(state: BondingState, timestamp: number = Date.now()): BondingState {
  const today = getTodayUtcDateString(timestamp);

  // If already on current date, keep existing state
  if (state.dailyActivities.dateKey === today && state.activeChallenge.rotationKey === today) {
    return state;
  }

  // Calculate day difference for consecutive days streak (informational only)
  let consecutiveDays = state.stats.consecutiveDays;
  if (state.stats.lastActiveDateKey) {
    const lastDate = new Date(state.stats.lastActiveDateKey + 'T00:00:00Z').getTime();
    const curDate = new Date(today + 'T00:00:00Z').getTime();
    const diffDays = Math.round((curDate - lastDate) / (1000 * 60 * 60 * 24));

    if (diffDays === 1) {
      consecutiveDays += 1;
    } else if (diffDays > 1) {
      consecutiveDays = 1;
    }
  }

  const newDailyActivities = createDailyActivitiesForDate(today);
  const challengeInfo = getRotatingChallengeForDate(today);

  const activeChallenge: RotatingChallengeProgress = {
    challengeId: challengeInfo.challengeId,
    rotationKey: challengeInfo.rotationKey,
    progress: 0,
    completed: false,
    completedAt: null,
  };

  const stats: BondingStats = {
    ...state.stats,
    daysInteractedCount: state.stats.daysInteractedCount + 1,
    lastActiveDateKey: today,
    consecutiveDays,
  };

  return {
    ...state,
    dailyActivities: newDailyActivities,
    activeChallenge,
    stats,
  };
}

/**
 * Evaluates whether new milestones have been reached based on current bondPoints.
 */
export function evaluateMilestones(
  state: BondingState,
  timestamp: number = Date.now()
): { nextState: BondingState; newMilestones: BondMilestone[] } {
  const newMilestones: BondMilestone[] = [];
  const updatedMilestones = { ...state.unlockedMilestones };

  for (const milestone of BOND_MILESTONES_LIST) {
    if (!updatedMilestones[milestone.id] && state.bondPoints >= milestone.requiredPoints) {
      updatedMilestones[milestone.id] = { unlockedAt: timestamp };
      newMilestones.push(milestone);
    }
  }

  const nextLevel = calculateBondLevel(state.bondPoints);

  return {
    nextState: {
      ...state,
      bondLevel: nextLevel,
      unlockedMilestones: updatedMilestones,
    },
    newMilestones,
  };
}

/**
 * Adds bond points within max bound [0, MAX_BOND_POINTS].
 */
function addBondPoints(state: BondingState, pointsToAdd: number, timestamp: number): {
  nextState: BondingState;
  newMilestones: BondMilestone[];
  pointsAwarded: number;
} {
  if (pointsToAdd <= 0) {
    return { nextState: state, newMilestones: [], pointsAwarded: 0 };
  }

  const targetPoints = Math.min(MAX_BOND_POINTS, state.bondPoints + pointsToAdd);
  const actualPointsAwarded = targetPoints - state.bondPoints;

  const stateWithPoints: BondingState = {
    ...state,
    bondPoints: targetPoints,
  };

  const evalResult = evaluateMilestones(stateWithPoints, timestamp);
  return {
    nextState: evalResult.nextState,
    newMilestones: evalResult.newMilestones,
    pointsAwarded: actualPointsAwarded,
  };
}

/**
 * Records a direct stroke/petting interaction on the companion.
 */
export function recordDirectPetting(
  currentState: BondingState,
  timestamp: number = Date.now()
): BondingEventResult {
  let state = checkAndResetDay(currentState, timestamp);
  const today = state.dailyActivities.dateKey;

  // 1. Check daily direct stroke points cap (max 5 pts/day)
  const currentPetPoints = state.stats.dailyDirectStrokesPoints[today] || 0;
  let pointsToAdd = 0;
  if (currentPetPoints < 5) {
    pointsToAdd = 1;
  }

  // Update dailyDirectStrokesPoints
  state = {
    ...state,
    stats: {
      ...state.stats,
      dailyDirectStrokesPoints: {
        ...state.stats.dailyDirectStrokesPoints,
        [today]: currentPetPoints + pointsToAdd,
      },
    },
  };

  const activitiesCompleted: DailyActivity[] = [];

  // 2. Advance daily_companion_pet progress (target: 3)
  const actProgress = state.dailyActivities.activities.daily_companion_pet;
  if (actProgress && !actProgress.completed) {
    const nextProg = actProgress.progress + 1;
    const isCompleted = nextProg >= DAILY_ACTIVITIES_CATALOG.daily_companion_pet.targetCount;

    state = {
      ...state,
      dailyActivities: {
        ...state.dailyActivities,
        activities: {
          ...state.dailyActivities.activities,
          daily_companion_pet: {
            progress: nextProg,
            completed: isCompleted,
            completedAt: isCompleted ? timestamp : null,
          },
        },
      },
    };

    if (isCompleted) {
      activitiesCompleted.push(DAILY_ACTIVITIES_CATALOG.daily_companion_pet);
      pointsToAdd += DAILY_ACTIVITIES_CATALOG.daily_companion_pet.bondPointsReward;
      state.stats.totalDailyActivitiesCompleted += 1;
    }
  }

  // 3. Check rotating challenge progress if applicable (challenge_perfect_day)
  const challengeRes = checkPerfectDayChallenge(state, timestamp);
  state = challengeRes.state;
  if (challengeRes.completed) {
    pointsToAdd += challengeRes.points;
  }

  const { nextState, newMilestones, pointsAwarded } = addBondPoints(state, pointsToAdd, timestamp);

  return {
    nextState,
    milestonesUnlocked: newMilestones,
    activitiesCompleted,
    challengeCompleted: challengeRes.completed,
    pointsAwarded,
  };
}

/**
 * Records a care action (feed, play, train, rest).
 */
export function recordCareActionForBonding(
  currentState: BondingState,
  timestamp: number = Date.now()
): BondingEventResult {
  let state = checkAndResetDay(currentState, timestamp);
  const today = state.dailyActivities.dateKey;

  // 1. Check daily care points cap (max 10 pts/day: +5 pts per care action)
  const currentCarePoints = state.stats.dailyCarePoints[today] || 0;
  let pointsToAdd = 0;
  if (currentCarePoints < 10) {
    pointsToAdd = 5;
  }

  state = {
    ...state,
    stats: {
      ...state.stats,
      dailyCarePoints: {
        ...state.stats.dailyCarePoints,
        [today]: currentCarePoints + pointsToAdd,
      },
    },
  };

  const activitiesCompleted: DailyActivity[] = [];

  // 2. Advance daily_care_warmth progress (target: 1)
  const actProgress = state.dailyActivities.activities.daily_care_warmth;
  if (actProgress && !actProgress.completed) {
    const nextProg = actProgress.progress + 1;
    const isCompleted = nextProg >= DAILY_ACTIVITIES_CATALOG.daily_care_warmth.targetCount;

    state = {
      ...state,
      dailyActivities: {
        ...state.dailyActivities,
        activities: {
          ...state.dailyActivities.activities,
          daily_care_warmth: {
            progress: nextProg,
            completed: isCompleted,
            completedAt: isCompleted ? timestamp : null,
          },
        },
      },
    };

    if (isCompleted) {
      activitiesCompleted.push(DAILY_ACTIVITIES_CATALOG.daily_care_warmth);
      pointsToAdd += DAILY_ACTIVITIES_CATALOG.daily_care_warmth.bondPointsReward;
      state.stats.totalDailyActivitiesCompleted += 1;
    }
  }

  // 3. Advance challenge_triple_care if active
  let challengeCompleted = false;
  if (
    state.activeChallenge.challengeId === 'challenge_triple_care' &&
    !state.activeChallenge.completed
  ) {
    const nextProg = state.activeChallenge.progress + 1;
    const isCompleted = nextProg >= ROTATING_CHALLENGES_CATALOG.challenge_triple_care.targetCount;

    state = {
      ...state,
      activeChallenge: {
        ...state.activeChallenge,
        progress: nextProg,
        completed: isCompleted,
        completedAt: isCompleted ? timestamp : null,
      },
    };

    if (isCompleted) {
      challengeCompleted = true;
      pointsToAdd += ROTATING_CHALLENGES_CATALOG.challenge_triple_care.bondPointsReward;
      state.stats.totalChallengesCompleted += 1;
    }
  }

  // Check perfect day challenge
  const challengeRes = checkPerfectDayChallenge(state, timestamp);
  state = challengeRes.state;
  if (challengeRes.completed) {
    challengeCompleted = true;
    pointsToAdd += challengeRes.points;
  }

  const { nextState, newMilestones, pointsAwarded } = addBondPoints(state, pointsToAdd, timestamp);

  return {
    nextState,
    milestonesUnlocked: newMilestones,
    activitiesCompleted,
    challengeCompleted,
    pointsAwarded,
  };
}

/**
 * Records completion of a mini-game session.
 */
export function recordMiniGameForBonding(
  currentState: BondingState,
  gameId: string,
  score: number,
  timestamp: number = Date.now()
): BondingEventResult {
  let state = checkAndResetDay(currentState, timestamp);
  const today = state.dailyActivities.dateKey;

  // 1. Daily mini-game points (max 20 pts/day: +10 pts per game)
  const currentMgPoints = state.stats.dailyMiniGamePoints[today] || 0;
  let pointsToAdd = 0;
  if (currentMgPoints < 20) {
    pointsToAdd = 10;
  }

  state = {
    ...state,
    stats: {
      ...state.stats,
      dailyMiniGamePoints: {
        ...state.stats.dailyMiniGamePoints,
        [today]: currentMgPoints + pointsToAdd,
      },
    },
  };

  const activitiesCompleted: DailyActivity[] = [];

  // 2. Advance daily_minigame_play (target: 1)
  const actProgress = state.dailyActivities.activities.daily_minigame_play;
  if (actProgress && !actProgress.completed) {
    const nextProg = actProgress.progress + 1;
    const isCompleted = nextProg >= DAILY_ACTIVITIES_CATALOG.daily_minigame_play.targetCount;

    state = {
      ...state,
      dailyActivities: {
        ...state.dailyActivities,
        activities: {
          ...state.dailyActivities.activities,
          daily_minigame_play: {
            progress: nextProg,
            completed: isCompleted,
            completedAt: isCompleted ? timestamp : null,
          },
        },
      },
    };

    if (isCompleted) {
      activitiesCompleted.push(DAILY_ACTIVITIES_CATALOG.daily_minigame_play);
      pointsToAdd += DAILY_ACTIVITIES_CATALOG.daily_minigame_play.bondPointsReward;
      state.stats.totalDailyActivitiesCompleted += 1;
    }
  }

  // 3. Check active rotating challenge for specific mini-game
  let challengeCompleted = false;
  const activeId = state.activeChallenge.challengeId;

  if (!state.activeChallenge.completed) {
    if (activeId === 'challenge_rhythm_flow' && gameId === 'companion_rhythm') {
      if (score >= ROTATING_CHALLENGES_CATALOG.challenge_rhythm_flow.targetCount) {
        challengeCompleted = true;
        state = completeActiveChallenge(state, timestamp);
        pointsToAdd += ROTATING_CHALLENGES_CATALOG.challenge_rhythm_flow.bondPointsReward;
      }
    } else if (activeId === 'challenge_spark_focus' && gameId === 'memory_sparks') {
      if (score >= ROTATING_CHALLENGES_CATALOG.challenge_spark_focus.targetCount) {
        challengeCompleted = true;
        state = completeActiveChallenge(state, timestamp);
        pointsToAdd += ROTATING_CHALLENGES_CATALOG.challenge_spark_focus.bondPointsReward;
      }
    } else if (activeId === 'challenge_starlight_collector' && gameId === 'star_catcher') {
      if (score >= ROTATING_CHALLENGES_CATALOG.challenge_starlight_collector.targetCount) {
        challengeCompleted = true;
        state = completeActiveChallenge(state, timestamp);
        pointsToAdd += ROTATING_CHALLENGES_CATALOG.challenge_starlight_collector.bondPointsReward;
      }
    }
  }

  // Check perfect day challenge
  const challengeRes = checkPerfectDayChallenge(state, timestamp);
  state = challengeRes.state;
  if (challengeRes.completed) {
    challengeCompleted = true;
    pointsToAdd += challengeRes.points;
  }

  const { nextState, newMilestones, pointsAwarded } = addBondPoints(state, pointsToAdd, timestamp);

  return {
    nextState,
    milestonesUnlocked: newMilestones,
    activitiesCompleted,
    challengeCompleted,
    pointsAwarded,
  };
}

/**
 * Records wardrobe and styling interactions.
 */
export function recordWardrobeActionForBonding(
  currentState: BondingState,
  equippedCount: number,
  timestamp: number = Date.now()
): BondingEventResult {
  let state = checkAndResetDay(currentState, timestamp);
  let pointsToAdd = 0;
  const activitiesCompleted: DailyActivity[] = [];

  // Advance daily_wardrobe_style
  const actProgress = state.dailyActivities.activities.daily_wardrobe_style;
  if (actProgress && !actProgress.completed) {
    const isCompleted = true;

    state = {
      ...state,
      dailyActivities: {
        ...state.dailyActivities,
        activities: {
          ...state.dailyActivities.activities,
          daily_wardrobe_style: {
            progress: 1,
            completed: isCompleted,
            completedAt: timestamp,
          },
        },
      },
    };

    activitiesCompleted.push(DAILY_ACTIVITIES_CATALOG.daily_wardrobe_style);
    pointsToAdd += DAILY_ACTIVITIES_CATALOG.daily_wardrobe_style.bondPointsReward;
    state.stats.totalDailyActivitiesCompleted += 1;
  }

  // Check challenge_fashion_flair if active (requires >= 2 equipped items)
  let challengeCompleted = false;
  if (
    state.activeChallenge.challengeId === 'challenge_fashion_flair' &&
    !state.activeChallenge.completed &&
    equippedCount >= 2
  ) {
    challengeCompleted = true;
    state = completeActiveChallenge(state, timestamp);
    pointsToAdd += ROTATING_CHALLENGES_CATALOG.challenge_fashion_flair.bondPointsReward;
  }

  // Check perfect day challenge
  const challengeRes = checkPerfectDayChallenge(state, timestamp);
  state = challengeRes.state;
  if (challengeRes.completed) {
    challengeCompleted = true;
    pointsToAdd += challengeRes.points;
  }

  const { nextState, newMilestones, pointsAwarded } = addBondPoints(state, pointsToAdd, timestamp);

  return {
    nextState,
    milestonesUnlocked: newMilestones,
    activitiesCompleted,
    challengeCompleted,
    pointsAwarded,
  };
}

/**
 * Records interacting with the companion to hear personality reaction dialogue.
 */
export function recordPersonalityInteractionForBonding(
  currentState: BondingState,
  timestamp: number = Date.now()
): BondingEventResult {
  let state = checkAndResetDay(currentState, timestamp);
  let pointsToAdd = 0;
  const activitiesCompleted: DailyActivity[] = [];

  // Advance daily_personality_chat
  const actProgress = state.dailyActivities.activities.daily_personality_chat;
  if (actProgress && !actProgress.completed) {
    state = {
      ...state,
      dailyActivities: {
        ...state.dailyActivities,
        activities: {
          ...state.dailyActivities.activities,
          daily_personality_chat: {
            progress: 1,
            completed: true,
            completedAt: timestamp,
          },
        },
      },
    };

    activitiesCompleted.push(DAILY_ACTIVITIES_CATALOG.daily_personality_chat);
    pointsToAdd += DAILY_ACTIVITIES_CATALOG.daily_personality_chat.bondPointsReward;
    state.stats.totalDailyActivitiesCompleted += 1;
  }

  // Check challenge_personality_insight if active
  let challengeCompleted = false;
  if (
    state.activeChallenge.challengeId === 'challenge_personality_insight' &&
    !state.activeChallenge.completed
  ) {
    const nextProg = state.activeChallenge.progress + 1;
    const isCompleted = nextProg >= ROTATING_CHALLENGES_CATALOG.challenge_personality_insight.targetCount;

    state = {
      ...state,
      activeChallenge: {
        ...state.activeChallenge,
        progress: nextProg,
        completed: isCompleted,
        completedAt: isCompleted ? timestamp : null,
      },
    };

    if (isCompleted) {
      challengeCompleted = true;
      pointsToAdd += ROTATING_CHALLENGES_CATALOG.challenge_personality_insight.bondPointsReward;
      state.stats.totalChallengesCompleted += 1;
    }
  }

  // Check perfect day challenge
  const challengeRes = checkPerfectDayChallenge(state, timestamp);
  state = challengeRes.state;
  if (challengeRes.completed) {
    challengeCompleted = true;
    pointsToAdd += challengeRes.points;
  }

  const { nextState, newMilestones, pointsAwarded } = addBondPoints(state, pointsToAdd, timestamp);

  return {
    nextState,
    milestonesUnlocked: newMilestones,
    activitiesCompleted,
    challengeCompleted,
    pointsAwarded,
  };
}

// ── INTERNAL HELPERS ──────────────────────────────────────────────────────────

function completeActiveChallenge(state: BondingState, timestamp: number): BondingState {
  return {
    ...state,
    activeChallenge: {
      ...state.activeChallenge,
      progress: ROTATING_CHALLENGES_CATALOG[state.activeChallenge.challengeId].targetCount,
      completed: true,
      completedAt: timestamp,
    },
    stats: {
      ...state.stats,
      totalChallengesCompleted: state.stats.totalChallengesCompleted + 1,
    },
  };
}

function checkPerfectDayChallenge(
  state: BondingState,
  timestamp: number
): { state: BondingState; completed: boolean; points: number } {
  if (
    state.activeChallenge.challengeId !== 'challenge_perfect_day' ||
    state.activeChallenge.completed
  ) {
    return { state, completed: false, points: 0 };
  }

  // Check if all 3 active daily activities for today are completed
  const activeIds = getDailyActivitiesForDate(state.dailyActivities.dateKey);
  const allDone = activeIds.every((id) => state.dailyActivities.activities[id]?.completed);

  if (allDone) {
    const nextState = completeActiveChallenge(state, timestamp);
    return {
      state: nextState,
      completed: true,
      points: ROTATING_CHALLENGES_CATALOG.challenge_perfect_day.bondPointsReward,
    };
  }

  return { state, completed: false, points: 0 };
}
