/**
 * GitHub Profile Pet - Activity Progression Engine Types
 *
 * Defines auditable event records, deduplication registries, permanent intervals,
 * and activity ledger document structures.
 */

import type { IntegerInterval } from './intervalIndex.ts';

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

export interface PermanentDeduplicationIndex {
  commitShas: string[]; // Active set of lowercase commit SHAs
  issueIntervals: IntegerInterval[]; // Compact disjoint intervals [[1, 50], [52, 60]]
  prOpenedIntervals: IntegerInterval[];
  prMergedIntervals: IntegerInterval[];
  reviewIntervals: IntegerInterval[];
}

export interface ActivityReconciliationCheckpoints {
  lastCommitSha?: string;
  lastIssueNumber?: number;
  lastPrNumber?: number;
  reconciledAt: string;
}

export interface ActivityArchiveBatch {
  batchId: string;
  createdAt: string; // ISO-8601 UTC
  sourceLedger: string;
  recordCount: number;
  totalXp: number;
  firstEventTimestamp: string;
  lastEventTimestamp: string;
  recordRange: {
    startEventId: string;
    endEventId: string;
  };
  sha256: string; // Hex SHA-256 digest over canonical JSON serialized records
  compactorVersion: string;
}

export interface ActivityArchiveV1Document {
  schemaVersion: 1;
  archivedCommitShas: string[];
  archivedEventCount: number;
  updatedAt: string;
}

export interface ActivityArchiveV2Document {
  schemaVersion: 2;
  archivedCommitShas: string[];
  archivedEvents: ActivityEventRecord[];
  batches: ActivityArchiveBatch[];
  totalArchivedEvents: number;
  totalArchivedXp: number;
  updatedAt: string;
}

export type ActivityArchiveDocument = ActivityArchiveV1Document | ActivityArchiveV2Document;

export interface ArchiveCompactionOptions {
  baseDir?: string;
  threshold?: number; // Target active record count threshold (defaults to 5000)
  dryRun?: boolean;
  force?: boolean;
  nowIso?: string;
}

export interface ArchiveCompactionResult {
  status: 'COMPACTED' | 'NOT_NEEDED' | 'DRY_RUN' | 'ERROR';
  message: string;
  initialActiveRecords: number;
  finalActiveRecords: number;
  initialArchiveRecords: number;
  finalArchiveRecords: number;
  archivedRecordCount: number;
  archivedXp: number;
  totalActiveXpBefore: number;
  totalActiveXpAfter: number;
  totalCombinedXp: number;
  batchId?: string;
  batchSha256?: string;
  durationMs: number;
  error?: Error;
}

export interface ArchiveVerificationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ArchiveVerificationResult {
  status: 'PASS' | 'WARNING' | 'FAIL';
  activeRecordCount: number;
  archivedRecordCount: number;
  totalEventCount: number;
  uniqueEventCount: number;
  totalActiveXp: number;
  totalArchivedXp: number;
  totalCombinedXp: number;
  batchCount: number;
  issues: ArchiveVerificationIssue[];
  durationMs: number;
}

export interface ActivityLedgerDocument {
  schemaVersion: number;
  generation: number;
  dailyAccruedXp: Record<string, number>; // YYYY-MM-DD -> XP accrued on that UTC day
  processedRegistry: ActivityProcessedRegistry; // Active working registry for fast array lookups
  permanentIndex?: PermanentDeduplicationIndex; // Permanent range interval index and commit set
  checkpoints?: ActivityReconciliationCheckpoints; // Last known reconciliation cursor positions
  recentEvents: ActivityEventRecord[]; // Visible display history
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
  allowHistoricalRecovery?: boolean;
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
