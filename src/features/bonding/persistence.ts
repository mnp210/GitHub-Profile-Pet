/**
 * GitHub Profile Pet - Companion Bonding Persistence & Schema Migration
 * Sprint 5.2B: Companion Bonding & Daily Activities System
 */

import type {
  BondingState,
  BondMilestoneId,
  DailyActivityId,
  RotatingChallengeId,
} from './types.ts';
import {
  CURRENT_BONDING_SCHEMA_VERSION,
  createInitialBondingState,
  calculateBondLevel,
  createDailyActivitiesForDate,
} from './bondingEngine.ts';
import {
  BOND_MILESTONES,
  DAILY_ACTIVITIES_CATALOG,
  ROTATING_CHALLENGES_CATALOG,
  MAX_BOND_POINTS,
} from './bondingCatalog.ts';
import {
  getTodayUtcDateString,
  getRotatingChallengeForDate,
} from './timePolicy.ts';

export const LOCAL_STORAGE_BONDING_KEY = 'gh_pet_bonding_state_v1';

/**
 * Safely migrates raw, legacy, or partially corrupted stored state into a valid BondingState.
 */
export function migrateBondingState(
  raw: unknown,
  timestamp: number = Date.now()
): BondingState {
  if (!raw || typeof raw !== 'object') {
    return createInitialBondingState(timestamp);
  }

  const candidate = raw as Record<string, unknown>;
  const today = getTodayUtcDateString(timestamp);

  // 1. Bond Points & Level Validation
  const rawPoints = candidate.bondPoints;
  const bondPoints = typeof rawPoints === 'number' && Number.isFinite(rawPoints) && rawPoints >= 0
    ? Math.min(MAX_BOND_POINTS, Math.floor(rawPoints))
    : 0;
  const bondLevel = calculateBondLevel(bondPoints);

  // 2. Milestones Validation
  const unlockedMilestones: Record<BondMilestoneId, { unlockedAt: number }> = {
    milestone_first_meeting: { unlockedAt: timestamp },
  } as Record<BondMilestoneId, { unlockedAt: number }>;

  if (typeof candidate.unlockedMilestones === 'object' && candidate.unlockedMilestones !== null) {
    const rawMilestones = candidate.unlockedMilestones as Record<string, unknown>;
    for (const [key, val] of Object.entries(rawMilestones)) {
      if (key in BOND_MILESTONES && typeof val === 'object' && val !== null) {
        const uAt = (val as { unlockedAt?: unknown }).unlockedAt;
        if (typeof uAt === 'number' && Number.isFinite(uAt)) {
          unlockedMilestones[key as BondMilestoneId] = { unlockedAt: uAt };
        }
      }
    }
  }

  // Ensure milestones meeting bondPoints threshold are unlocked
  for (const [mId, mDef] of Object.entries(BOND_MILESTONES)) {
    if (bondPoints >= mDef.requiredPoints && !unlockedMilestones[mId as BondMilestoneId]) {
      unlockedMilestones[mId as BondMilestoneId] = { unlockedAt: timestamp };
    }
  }

  // 3. Daily Activities Validation
  let dailyActivities = createDailyActivitiesForDate(today);
  if (typeof candidate.dailyActivities === 'object' && candidate.dailyActivities !== null) {
    const rawDaily = candidate.dailyActivities as Record<string, unknown>;
    const rawDateKey = typeof rawDaily.dateKey === 'string' ? rawDaily.dateKey : today;

    if (rawDateKey === today && typeof rawDaily.activities === 'object' && rawDaily.activities !== null) {
      const rawActs = rawDaily.activities as Record<string, unknown>;
      const sanitizedActs = { ...dailyActivities.activities };

      for (const [key, val] of Object.entries(rawActs)) {
        if (key in DAILY_ACTIVITIES_CATALOG && typeof val === 'object' && val !== null) {
          const actObj = val as Record<string, unknown>;
          sanitizedActs[key as DailyActivityId] = {
            progress: typeof actObj.progress === 'number' && Number.isFinite(actObj.progress) && actObj.progress >= 0
              ? Math.floor(actObj.progress)
              : 0,
            completed: Boolean(actObj.completed),
            completedAt: typeof actObj.completedAt === 'number' && Number.isFinite(actObj.completedAt)
              ? actObj.completedAt
              : null,
          };
        }
      }
      dailyActivities = {
        dateKey: today,
        activities: sanitizedActs,
      };
    }
  }

  // 4. Rotating Challenge Validation
  const defaultChallenge = getRotatingChallengeForDate(today);
  let activeChallenge = {
    challengeId: defaultChallenge.challengeId,
    rotationKey: defaultChallenge.rotationKey,
    progress: 0,
    completed: false,
    completedAt: null as number | null,
  };

  if (typeof candidate.activeChallenge === 'object' && candidate.activeChallenge !== null) {
    const rawChal = candidate.activeChallenge as Record<string, unknown>;
    const rawRotKey = typeof rawChal.rotationKey === 'string' ? rawChal.rotationKey : today;
    const rawId = typeof rawChal.challengeId === 'string' ? rawChal.challengeId : defaultChallenge.challengeId;

    if (rawRotKey === today && rawId in ROTATING_CHALLENGES_CATALOG) {
      activeChallenge = {
        challengeId: rawId as RotatingChallengeId,
        rotationKey: today,
        progress: typeof rawChal.progress === 'number' && Number.isFinite(rawChal.progress) && rawChal.progress >= 0
          ? Math.floor(rawChal.progress)
          : 0,
        completed: Boolean(rawChal.completed),
        completedAt: typeof rawChal.completedAt === 'number' && Number.isFinite(rawChal.completedAt)
          ? rawChal.completedAt
          : null,
      };
    }
  }

  // 5. Stats Validation
  const rawStats = (typeof candidate.stats === 'object' && candidate.stats !== null)
    ? (candidate.stats as Record<string, unknown>)
    : {};

  const sanitizeNum = (v: unknown, fallback: number): number => {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
  };

  const stats = {
    totalDailyActivitiesCompleted: sanitizeNum(rawStats.totalDailyActivitiesCompleted, 0),
    totalChallengesCompleted: sanitizeNum(rawStats.totalChallengesCompleted, 0),
    daysInteractedCount: sanitizeNum(rawStats.daysInteractedCount, 1),
    lastActiveDateKey: typeof rawStats.lastActiveDateKey === 'string' ? rawStats.lastActiveDateKey : today,
    consecutiveDays: sanitizeNum(rawStats.consecutiveDays, 1),
    dailyDirectStrokesPoints: typeof rawStats.dailyDirectStrokesPoints === 'object' && rawStats.dailyDirectStrokesPoints !== null
      ? (rawStats.dailyDirectStrokesPoints as Record<string, number>)
      : {},
    dailyCarePoints: typeof rawStats.dailyCarePoints === 'object' && rawStats.dailyCarePoints !== null
      ? (rawStats.dailyCarePoints as Record<string, number>)
      : {},
    dailyMiniGamePoints: typeof rawStats.dailyMiniGamePoints === 'object' && rawStats.dailyMiniGamePoints !== null
      ? (rawStats.dailyMiniGamePoints as Record<string, number>)
      : {},
  };

  return {
    schemaVersion: CURRENT_BONDING_SCHEMA_VERSION,
    bondPoints,
    bondLevel,
    unlockedMilestones,
    dailyActivities,
    activeChallenge,
    stats,
  };
}

/**
 * Loads bonding state from localStorage with safe fallback.
 */
export function loadLocalBondingState(timestamp: number = Date.now()): BondingState {
  if (typeof window === 'undefined') {
    return createInitialBondingState(timestamp);
  }

  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_BONDING_KEY);
    if (!raw) {
      return createInitialBondingState(timestamp);
    }
    const parsed = JSON.parse(raw);
    return migrateBondingState(parsed, timestamp);
  } catch (err) {
    console.warn('Failed to load local bonding state from storage:', err);
    return createInitialBondingState(timestamp);
  }
}

/**
 * Persists bonding state to localStorage and dispatches storage event for multi-tab sync.
 */
export function saveLocalBondingState(state: BondingState): void {
  if (typeof window === 'undefined') return;

  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(LOCAL_STORAGE_BONDING_KEY, serialized);

    // Dispatch custom event for same-window listeners
    window.dispatchEvent(
      new CustomEvent('gh_pet_bonding_updated', { detail: state })
    );
  } catch (err) {
    console.warn('Failed to save local bonding state to storage:', err);
  }
}
