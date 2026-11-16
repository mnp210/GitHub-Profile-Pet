/**
 * GitHub Profile Pet - Issue Action Parser & Integrity Validator
 * Validates untrusted GitHub issue content, enforces action schema eligibility,
 * rejects pull requests, and detects post-creation edits.
 */

import type { CareActionType } from '../domain/types.ts';
import type { ActionParseResult, GitHubIssue, IssueParseOptions } from './types.ts';

const VALID_ACTIONS = new Set<CareActionType>(['feed', 'train', 'rest', 'pet']);
const PENDING_LABEL = 'pet-action:pending';

function extractLabelNames(labels: Array<{ name: string } | string>): Set<string> {
  const names = new Set<string>();
  for (const label of labels) {
    if (typeof label === 'string') {
      names.add(label.toLowerCase());
    } else if (label && typeof label.name === 'string') {
      names.add(label.name.toLowerCase());
    }
  }
  return names;
}

/**
 * Resolves the intended action type from issue labels and standardized title syntax.
 */
function resolveActionType(
  labelSet: Set<string>,
  title: string
): CareActionType | null {
  // 1. Check specific action labels
  if (labelSet.has('pet:feed')) return 'feed';
  if (labelSet.has('pet:train')) return 'train';
  if (labelSet.has('pet:rest')) return 'rest';
  if (labelSet.has('pet:pet')) return 'pet';

  // 2. Parse title: 'pet: feed', 'pet: train', etc.
  const titleMatch = title.trim().match(/^pet:\s*(feed|train|rest|pet)$/i);
  if (titleMatch) {
    const action = titleMatch[1].toLowerCase() as CareActionType;
    if (VALID_ACTIONS.has(action)) {
      return action;
    }
  }

  return null;
}

/**
 * Parses and verifies the eligibility of a GitHub issue for pet care execution.
 *
 * Security Invariants:
 * 1. Pull requests sharing the issue number space are strictly rejected.
 * 2. Issues missing the 'pet-action:pending' label are classified as non-pet issues.
 * 3. Issues edited after creation are quarantined to prevent payload tampering.
 * 4. Action timestamps are strictly anchored to the immutable creation timestamp.
 */
export function parseIssueAction(
  issue: GitHubIssue,
  options?: IssueParseOptions
): ActionParseResult {
  const issueNumber = issue.number;
  const authorId = issue.user?.id ?? 0;
  const authorLogin = issue.user?.login ?? 'unknown';
  const commentsCount = typeof issue.comments === 'number' ? issue.comments : undefined;
  const eventTimestampMs = new Date(issue.created_at).getTime();

  // 1. Reject Pull Requests
  if (issue.pull_request !== undefined && issue.pull_request !== null) {
    return {
      eligible: false,
      status: 'pull_request_rejected',
      issueNumber,
      eventTimestampMs,
      authorId,
      authorLogin,
      commentsCount,
      rejectionReason: 'Resource is a Pull Request, not an eligible pet action Issue.',
      targetLabel: 'pet-action:invalid',
    };
  }

  const labelSet = extractLabelNames(issue.labels);

  // 2. Must have 'pet-action:pending' label
  if (!labelSet.has(PENDING_LABEL)) {
    return {
      eligible: false,
      status: 'missing_pending_label',
      issueNumber,
      eventTimestampMs,
      authorId,
      authorLogin,
      commentsCount,
      rejectionReason: `Issue missing required '${PENDING_LABEL}' label.`,
      targetLabel: undefined,
    };
  }

  // 3. Resolve and validate Action Type
  const actionType = resolveActionType(labelSet, issue.title);
  if (!actionType) {
    return {
      eligible: false,
      status: 'unknown_action_type',
      issueNumber,
      eventTimestampMs,
      authorId,
      authorLogin,
      commentsCount,
      rejectionReason: `Unrecognized pet care action. Title ('${issue.title}') or labels do not specify a valid action (feed, train, rest, pet).`,
      targetLabel: 'pet-action:invalid',
    };
  }

  // 4. Payload Integrity Check: Conservative post-creation edit eligibility
  const createdAtMs = new Date(issue.created_at).getTime();
  const updatedAtMs = new Date(issue.updated_at).getTime();
  const isCreationEvent = Boolean(options?.isCreationEvent);

  if (!isCreationEvent) {
    const isTimestampValid =
      !isNaN(createdAtMs) &&
      !isNaN(updatedAtMs) &&
      createdAtMs > 0 &&
      updatedAtMs > 0;

    const isUnchanged =
      isTimestampValid &&
      createdAtMs === updatedAtMs &&
      issue.created_at === issue.updated_at;

    if (!isUnchanged) {
      return {
        eligible: false,
        status: 'edited_quarantined',
        issueNumber,
        actionType,
        eventTimestampMs: isNaN(createdAtMs) ? Date.now() : createdAtMs,
        authorId,
        authorLogin,
        commentsCount,
        rejectionReason: !isTimestampValid
          ? 'Ambiguous or invalid issue timestamp precision. Quarantined to protect game state integrity.'
          : 'Issue was edited after creation. To prevent payload tampering, only unedited creation payloads are processed.',
        targetLabel: 'pet-action:quarantine',
      };
    }
  }

  // 5. Valid and eligible action
  return {
    eligible: true,
    status: 'eligible',
    issueNumber,
    actionType,
    eventTimestampMs: createdAtMs,
    authorId,
    authorLogin,
    commentsCount,
  };
}
