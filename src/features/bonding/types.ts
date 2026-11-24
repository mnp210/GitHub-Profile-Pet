/**
 * GitHub Profile Pet - Companion Bonding, Daily Activities & Rotating Challenges Types
 * Sprint 5.2B: Companion Bonding & Daily Activities System
 */

import type { CosmeticId } from '../progression/types.ts';

export type BondLevel = 1 | 2 | 3 | 4 | 5;

export type BondMilestoneId =
  | 'milestone_first_meeting'
  | 'milestone_getting_comfortable'
  | 'milestone_trusted_companion'
  | 'milestone_play_partners'
  | 'milestone_unbreakable_bond';

export interface BondMilestone {
  level: BondLevel;
  id: BondMilestoneId;
  name: string;
  description: string;
  requiredPoints: number;
  celebrationTitle: string;
  celebrationMessage: string;
  rewardCosmeticId?: CosmeticId;
}

export type DailyActivityId =
  | 'daily_care_warmth'
  | 'daily_companion_pet'
  | 'daily_minigame_play'
  | 'daily_wardrobe_style'
  | 'daily_personality_chat';

export interface DailyActivity {
  id: DailyActivityId;
  name: string;
  description: string;
  icon: string;
  targetCount: number;
  bondPointsReward: number;
}

export type RotatingChallengeId =
  | 'challenge_rhythm_flow'
  | 'challenge_spark_focus'
  | 'challenge_starlight_collector'
  | 'challenge_triple_care'
  | 'challenge_personality_insight'
  | 'challenge_fashion_flair'
  | 'challenge_perfect_day';

export interface RotatingChallenge {
  id: RotatingChallengeId;
  name: string;
  description: string;
  icon: string;
  targetCount: number;
  bondPointsReward: number;
}

export interface DailyActivityProgress {
  progress: number;
  completed: boolean;
  completedAt: number | null;
}

export interface RotatingChallengeProgress {
  challengeId: RotatingChallengeId;
  rotationKey: string;
  progress: number;
  completed: boolean;
  completedAt: number | null;
}

export interface DailyActivitiesState {
  dateKey: string; // UTC 'YYYY-MM-DD'
  activities: Record<DailyActivityId, DailyActivityProgress>;
}

export interface BondingStats {
  totalDailyActivitiesCompleted: number;
  totalChallengesCompleted: number;
  daysInteractedCount: number;
  lastActiveDateKey: string | null;
  consecutiveDays: number; // Informational only, never punitive
  dailyDirectStrokesPoints: Record<string, number>; // dateKey -> points earned
  dailyCarePoints: Record<string, number>; // dateKey -> points earned
  dailyMiniGamePoints: Record<string, number>; // dateKey -> points earned
}

export interface BondingState {
  schemaVersion: number;
  bondPoints: number; // Bounded 0 - 500
  bondLevel: BondLevel;
  unlockedMilestones: Record<BondMilestoneId, { unlockedAt: number }>;
  dailyActivities: DailyActivitiesState;
  activeChallenge: RotatingChallengeProgress;
  stats: BondingStats;
}

export interface BondingEventResult {
  nextState: BondingState;
  milestonesUnlocked: BondMilestone[];
  activitiesCompleted: DailyActivity[];
  challengeCompleted: boolean;
  pointsAwarded: number;
}
