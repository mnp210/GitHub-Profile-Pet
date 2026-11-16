/**
 * GitHub Profile Pet - Action Inbox & Interaction Types
 * Definitions for GitHub Issues as durable action queue, eligibility verification,
 * and deterministic care action dispatching.
 */

import type { CareActionType } from '../domain/types.ts';
import type { LockReleaseFn } from '../persistence/stateRepository.ts';

export interface GitHubIssueLabel {
  name: string;
}

export interface GitHubIssueUser {
  id: number;
  login: string;
}

export interface GitHubIssueComment {
  id: number;
  body: string;
  user: {
    id?: number;
    login: string;
    type?: string;
  } | null;
  created_at: string;
  updated_at: string;
}

export interface PendingIssuesPageResult {
  issues: GitHubIssue[];
  hasMore: boolean;
  pageCount: number;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  created_at: string;
  updated_at: string;
  labels: Array<GitHubIssueLabel | string>;
  user: GitHubIssueUser | null;
  pull_request?: Record<string, unknown>;
  comments?: number;
}

export interface IssueParseOptions {
  isCreationEvent?: boolean;
}

export type IssueEligibilityStatus =
  | 'eligible'
  | 'not_pet_action'
  | 'pull_request_rejected'
  | 'malformed_payload'
  | 'edited_quarantined'
  | 'already_processed'
  | 'missing_pending_label'
  | 'unknown_action_type';

export interface ActionParseResult {
  eligible: boolean;
  status: IssueEligibilityStatus;
  issueNumber: number;
  actionType?: CareActionType;
  eventTimestampMs: number;
  authorId: number;
  authorLogin: string;
  commentsCount?: number;
  rejectionReason?: string;
  targetLabel?: string;
}

export type ActionExecutionStatus =
  | 'accepted'
  | 'rejected'
  | 'duplicate'
  | 'quarantined'
  | 'deferred';

export interface ActionProcessOutcome {
  issueNumber: number;
  actionType?: CareActionType;
  status: ActionExecutionStatus;
  message: string;
  reactionText: string;
  xpGained: number;
  didLevelUp: boolean;
  levelsGained: number;
  newLevel?: number;
  newVitals?: {
    hunger: number;
    energy: number;
    happiness: number;
    mood: string;
  };
}

export interface InboxProcessResult {
  scannedCount: number;
  processedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  quarantinedCount: number;
  newHighWaterMark: number;
  queueDrained: boolean;
  hasMorePending: boolean;
  outcomes: ActionProcessOutcome[];
  savedGeneration?: number;
}

export interface GitHubInboxClient {
  listPendingIssues(
    repo: string,
    options?: { page?: number; perPage?: number; maxPages?: number }
  ): Promise<GitHubIssue[] | PendingIssuesPageResult>;
  listIssueComments(
    repo: string,
    issueNumber: number,
    options?: { page?: number; perPage?: number }
  ): Promise<GitHubIssueComment[]>;
  getIssue(repo: string, issueNumber: number): Promise<{ status: number; issue?: GitHubIssue }>;
  commentIssue(repo: string, issueNumber: number, comment: string): Promise<void>;
  closeIssue(repo: string, issueNumber: number, labelToAdd?: string): Promise<void>;
  addLabels(repo: string, issueNumber: number, labels: string[]): Promise<void>;
  removeLabel(repo: string, issueNumber: number, label: string): Promise<void>;
}

export type FeedbackInspectionStatus = 'confirmed' | 'absent' | 'incomplete_unknown';

export interface FeedbackInspectionResult {
  status: FeedbackInspectionStatus;
  comment?: GitHubIssueComment;
  reason?: string;
}

export interface FeedbackDeliveryResult {
  delivered: boolean;
  alreadyExisted: boolean;
  status: FeedbackInspectionStatus;
  reason?: string;
}

export interface InboxProcessingOptions {
  baseDir?: string;
  repository?: string;
  client?: GitHubInboxClient;
  trustedAuthorId?: number;
  trustedAuthorLogin?: string;
  allowAnyAuthor?: boolean;
  botLogin?: string;
  maxIssuesPerBatch?: number;
  maxPages?: number;
  maxCommentPages?: number;
  timeBudgetMs?: number;
  existingLock?: LockReleaseFn;
}
