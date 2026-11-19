/**
 * GitHub Profile Pet - Activity Progression Engine Types
 *
 * Defines auditable event records, deduplication registries, and activity ledger document structures.
 */

export type ActivityType =
  | 'commit'
  | 'issue_opened'
  | 'pr_opened'
  | 'pr_merged'
  | 'review_submitted';

export type ActivityEventStatus =
  | 'rewarded'
  | 'skipped_bot'
  | 'skipped_duplicate'
  | 'skipped_daily_cap'
  | 'skipped_care_action'
  | 'skipped_stale'
  | 'invalid';

export interface ActivityEventRecord {
  eventId: string; // Stable identifier, e.g. "commit:3a5c7f...", "issue:42", "pr_opened:12", "pr_merged:12", "review:987"
  eventType: ActivityType;
  actor: string;
  timestamp: string; // ISO-8601 UTC
  xpAwarded: number;
  status: ActivityEventStatus;
  details?: string;
  ref?: string;
}

export interface ActivityProcessedRegistry {
  commitShas: string[];
  issueNumbers: number[];
  prOpenedNumbers: number[];
  prMergedNumbers: number[];
  reviewIds: number[];
}

export interface ActivityLedgerDocument {
  schemaVersion: number;
  generation: number;
  dailyAccruedXp: Record<string, number>; // YYYY-MM-DD -> XP accrued on that UTC day
  processedRegistry: ActivityProcessedRegistry;
  recentEvents: ActivityEventRecord[];
  updatedAt: string;
}

export interface ProcessActivityEventInput {
  eventType: ActivityType;
  eventId: string;
  actor: string;
  timestamp?: string; // Defaults to now
  details?: string;
  ref?: string;
  commitMessage?: string;
  isBot?: boolean;
  issueLabels?: string[];
  prMerged?: boolean;
}

export interface ProcessActivityResult {
  success: boolean;
  xpAwarded: number;
  status: ActivityEventStatus;
  didLevelUp: boolean;
  previousLevel: number;
  newLevel: number;
  previousXp: number;
  newXp: number;
  evolutionStage: string;
  reason?: string;
}
