/**
 * GitHub Profile Pet - Pet Engine Domain Constants
 * Strictly implements Sprint 2.7.4 GitHub-Native Specification
 */

export const ENGINE_SCHEMA_VERSION = 1;

// Vitals Limits & Ethical Bounds (Zero Death, Zero Negative Stats)
export const MIN_VITAL_LIMIT = 0;
export const MAX_VITAL_LIMIT = 100;
export const INACTIVITY_HUNGER_FLOOR = 20;
export const INACTIVITY_HAPPINESS_FLOOR = 40;

// Offline Inactivity Simulation Rates
export const PASSIVE_OFFLINE_ENERGY_RATE_PER_SEC = 0.05; // 3 energy per minute
export const HUNGER_DECAY_RATE_PER_SEC = 0.0001;        // ~8.6 points / day
export const HAPPINESS_DECAY_RATE_PER_SEC = 0.0001;     // ~8.6 points / day
export const MIN_INACTIVITY_FOR_WELCOME_BONUS_SEC = 24 * 3600; // 24 hours
export const WELCOME_BACK_BONUS_COOLDOWN_MS = 24 * 3600 * 1000;

// Care Action Limits & Cooldowns
export const ACTION_COOLDOWN_MS = 60_000; // 60 seconds strict cooldown between care actions
export const ROLLING_ACTION_WINDOW_MS = 60_000; // 60s window for diminishing returns
export const DIMINISHING_MULTIPLIERS = [1.0, 0.6, 0.35, 0.2, 0.1];

// Care Action Resource Costs & Gains
export const TRAINING_ENERGY_COST = 18;
export const MAX_SATIETY_LIMIT = 100;
export const REST_ENERGY_RESTORE_PER_ACTION = 25;

export const BASE_ACTION_REWARDS = {
  feed: {
    baseExp: 10,
    baseHappiness: 5,
    baseHunger: 24,
    energyCost: 0,
  },
  train: {
    baseExp: 30,
    baseHappiness: 4,
    baseHunger: 0,
    energyCost: 18,
  },
  rest: {
    baseExp: 0, // Rest strictly yields 0 XP
    baseHappiness: 2,
    baseHunger: 0,
    energyCost: 0,
  },
  pet: {
    baseExp: 6,
    baseHappiness: 12,
    baseHunger: 0,
    energyCost: 0,
  },
} as const;

// Contribution Accounting Constraints
export const DAILY_CONTRIBUTION_XP_CAP = 300; // Max 300 XP per calendar UTC day
export const HOURLY_THROTTLE_MAX_SLICES = 5;  // Max 5 rewarded slices per UTC hour (legacy)
export const MAX_INCREMENTS_PER_HOUR = 5;     // Phase 3C2: Max 5 individual increments evaluated per UTC hour
export const CONTRIBUTION_SLICE_EXPIRY_MS = 48 * 3600 * 1000; // 48 hours = 172,800,000 ms

// Phase 3C2 Diminishing Contribution Reward Schedule
export const CONTRIBUTION_REWARD_SCHEDULE: Record<number, { xp: number; satiety: number }> = {
  1: { xp: 25, satiety: 10 },
  2: { xp: 15, satiety: 5 },
  3: { xp: 10, satiety: 2 },
  4: { xp: 5, satiety: 1 },
} as const;

export const CONTRIBUTION_REWARD_DEFAULT = { xp: 5, satiety: 1 } as const;

// 5-increment calculation constants (legacy reference)
// 1 unit = 12 XP and 3.8 satiety -> 5 units = 60 XP and 19 satiety
export const XP_PER_CONTRIBUTION_UNIT = 12;
export const SATIETY_PER_CONTRIBUTION_UNIT = 3.8;
