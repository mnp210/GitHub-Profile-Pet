export type ActionType = 'pet' | 'train' | 'feed' | 'rest';

export interface ActionHistoryEntry {
  action: ActionType;
  timestamp: number; // UTC milliseconds
}

export interface ActionHistoryState {
  entries: ActionHistoryEntry[];
}

export const ROLLING_WINDOW_MS = 60_000; // 60 seconds rolling window
export const ACTION_COOLDOWN_MS = 800; // 800ms debounce cooldown to prevent spamming

/**
 * Multipliers for repeated actions within the rolling 60s window:
 * 1st use: 100% (1.0)
 * 2nd use: 60% (0.6)
 * 3rd use: 35% (0.35)
 * 4th use: 20% (0.20)
 * 5th+ use: 10% (0.10)
 */
export const DIMINISHING_MULTIPLIERS = [1.0, 0.6, 0.35, 0.2, 0.1];

/**
 * Prune history entries older than the rolling window threshold.
 */
export function pruneExpiredActions(
  history: ActionHistoryEntry[],
  nowMs: number,
  windowMs: number = ROLLING_WINDOW_MS
): ActionHistoryEntry[] {
  const cutoff = nowMs - windowMs;
  return history.filter((entry) => entry.timestamp >= cutoff);
}

/**
 * Count how many times a specific action was performed within the active rolling window.
 */
export function getRecentActionCount(
  history: ActionHistoryEntry[],
  action: ActionType,
  nowMs: number,
  windowMs: number = ROLLING_WINDOW_MS
): number {
  const activeEntries = pruneExpiredActions(history, nowMs, windowMs);
  return activeEntries.filter((entry) => entry.action === action).length;
}

/**
 * Calculate the reward multiplier for the next execution of an action.
 * Returns multiplier (e.g. 1.0, 0.6, 0.35, etc.) and the 1-based consecutive count.
 */
export function getRewardMultiplier(
  history: ActionHistoryEntry[],
  action: ActionType,
  nowMs: number,
  windowMs: number = ROLLING_WINDOW_MS
): { multiplier: number; consecutiveCount: number; percentageDisplay: number } {
  const count = getRecentActionCount(history, action, nowMs, windowMs);
  const consecutiveCount = count + 1; // 1st, 2nd, etc.
  const index = Math.min(count, DIMINISHING_MULTIPLIERS.length - 1);
  const multiplier = DIMINISHING_MULTIPLIERS[index];
  const percentageDisplay = Math.round(multiplier * 100);

  return { multiplier, consecutiveCount, percentageDisplay };
}

/**
 * Base reward definitions (unmodified by diminishing returns).
 */
export const BASE_ACTION_REWARDS: Record<
  ActionType,
  { baseExp: number; baseHappiness: number; baseHunger: number; energyCost: number }
> = {
  pet: {
    baseExp: 6,
    baseHappiness: 12,
    baseHunger: 0,
    energyCost: 0,
  },
  train: {
    baseExp: 30,
    baseHappiness: 4,
    baseHunger: 0,
    energyCost: 18, // Resource cost (never diminished)
  },
  feed: {
    baseExp: 10,
    baseHappiness: 5,
    baseHunger: 24,
    energyCost: 0,
  },
  rest: {
    baseExp: 0, // Rest strictly grants 0 XP
    baseHappiness: 2,
    baseHunger: 0,
    energyCost: 0,
  },
};

export interface CalculatedReward {
  action: ActionType;
  expGained: number;
  happinessGained: number;
  hungerGained: number;
  energyCost: number;
  multiplier: number;
  percentageDisplay: number;
  consecutiveCount: number;
}

/**
 * Pure function to calculate exact rewards applying diminishing returns to reward yields
 * while preserving fixed resource costs.
 */
export function calculateActionReward(
  action: ActionType,
  history: ActionHistoryEntry[],
  nowMs: number
): CalculatedReward {
  const base = BASE_ACTION_REWARDS[action];
  const { multiplier, consecutiveCount, percentageDisplay } = getRewardMultiplier(
    history,
    action,
    nowMs
  );

  // Rewards are scaled by multiplier; costs remain fixed
  const expGained = Math.max(0, Math.round(base.baseExp * multiplier));
  const happinessGained = Math.max(0, Math.round(base.baseHappiness * multiplier));
  const hungerGained = Math.max(0, Math.round(base.baseHunger * multiplier));

  return {
    action,
    expGained,
    happinessGained,
    hungerGained,
    energyCost: base.energyCost,
    multiplier,
    percentageDisplay,
    consecutiveCount,
  };
}
