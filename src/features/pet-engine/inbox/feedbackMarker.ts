/**
 * GitHub Profile Pet - Feedback Delivery & Deterministic Marker Engine
 * Provides unique feedback marker generation, exact bot-author identity verification,
 * and resilient comment delivery with bounded comment history inspection.
 */

import type {
  FeedbackDeliveryResult,
  FeedbackInspectionResult,
  GitHubInboxClient,
  GitHubIssueComment,
} from './types.ts';

export const DEFAULT_BOT_LOGIN = 'github-actions[bot]';

/**
 * Generates an immutable, deterministic feedback marker for a specific action issue.
 */
export function getActionFeedbackMarker(issueNumber: number): string {
  return `<!-- pet-action-feedback:issue-${issueNumber} -->`;
}

/**
 * Validates and normalizes an expected bot login.
 * Fail-closed: an explicitly configured but blank or whitespace-only bot login
 * throws an explicit Error rather than silently falling back to the default identity.
 * Preserves the default ('github-actions[bot]') only when no custom identity was supplied (undefined).
 */
export function normalizeBotLogin(login?: string): string {
  if (login === undefined) {
    return DEFAULT_BOT_LOGIN;
  }
  if (typeof login !== 'string' || login.trim().length === 0) {
    throw new Error('Explicitly configured botLogin cannot be blank or whitespace-only');
  }
  return login.trim().toLowerCase();
}

/**
 * Verifies whether a comment is genuinely authored by the exact expected bot login
 * and contains the exact expected feedback marker.
 *
 * Exact Bot Identity Rules:
 * 1. Default expected identity is 'github-actions[bot]'.
 * 2. If a custom botLogin is configured, exact case-insensitive login match is enforced.
 * 3. Blank or whitespace-only custom botLogin fails closed (throws Error) rather than falling back.
 * 4. Suffix checks (e.g. endsWith('[bot]')) are strictly removed. Unrelated bots are rejected.
 * 5. Author type (e.g. type: 'Bot') is NEVER an independent authorization condition.
 * 6. Display names are never used as substitutes for exact login verification.
 * 7. Forged markers inside user-authored comments are strictly rejected.
 */
export function isBotAuthoredFeedback(
  comment: GitHubIssueComment,
  expectedMarker: string,
  expectedBotLogin?: string
): boolean {
  if (!comment || typeof comment.body !== 'string') {
    return false;
  }

  // Exact marker substring check
  if (!comment.body.includes(expectedMarker)) {
    return false;
  }

  const targetBotLogin = normalizeBotLogin(expectedBotLogin);
  const commentAuthor = (comment.user?.login ?? '').trim().toLowerCase();

  // Exact match only (case-insensitive)
  return commentAuthor === targetBotLogin;
}

/**
 * Safely inspects the issue's comment history using bounded pagination.
 *
 * Page-Level Completion Detection Rules:
 * 1. A page returning fewer than perPage comments establishes the end of the available comment history.
 * 2. An empty page (0 comments) establishes the end of history.
 * 3. A full page (exactly perPage comments) requires fetching the next page, up to maxPages.
 * 4. Reaching maxPages without establishing the end means 'incomplete_unknown'.
 * 5. Reaching the execution deadline before establishing the end means 'incomplete_unknown'.
 * 6. API errors, rate limits, and malformed responses must NEVER be treated as confirmed absence.
 * 7. A matching, exact bot-authored feedback comment is confirmed as soon as it is found (early return).
 * 8. A complete scan establishing the end of history is required before declaring feedback 'absent'.
 * 9. Keeps accumulated comments separate from the current page's result.
 */
export async function inspectFeedbackStatus(params: {
  client: GitHubInboxClient;
  repository: string;
  issueNumber: number;
  expectedMarker: string;
  expectedBotLogin?: string;
  maxPages?: number;
  perPage?: number;
  deadlineMs?: number;
}): Promise<FeedbackInspectionResult> {
  const {
    client,
    repository,
    issueNumber,
    expectedMarker,
    expectedBotLogin,
    maxPages = 5,
    perPage = 100,
    deadlineMs,
  } = params;

  // Fail-closed validation for configured bot login
  const targetBotLogin = normalizeBotLogin(expectedBotLogin);

  if (typeof client.listIssueComments !== 'function') {
    return {
      status: 'incomplete_unknown',
      reason: 'GitHub client does not support listIssueComments',
    };
  }

  for (let page = 1; page <= maxPages; page++) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      return {
        status: 'incomplete_unknown',
        reason: `Execution deadline reached before fetching comments page ${page}`,
      };
    }

    let pageComments: GitHubIssueComment[];
    try {
      pageComments = await client.listIssueComments(repository, issueNumber, { page, perPage });
    } catch (err) {
      return {
        status: 'incomplete_unknown',
        reason: `API error while fetching comments page ${page}: ${(err as Error).message}`,
      };
    }

    if (!Array.isArray(pageComments)) {
      return {
        status: 'incomplete_unknown',
        reason: `Unexpected non-array response while fetching comments page ${page}`,
      };
    }

    // 1. Inspect current page for matching bot feedback (early return on found)
    for (const comment of pageComments) {
      if (isBotAuthoredFeedback(comment, expectedMarker, targetBotLogin)) {
        return { status: 'confirmed', comment };
      }
    }

    // 2. Page-level completion detection:
    // A page returning fewer than perPage comments establishes the end of the available comment history.
    if (pageComments.length < perPage) {
      return { status: 'absent' };
    }

    // 3. Current page was full (pageComments.length === perPage).
    // If we have reached maxPages without establishing the end, the scan is incomplete.
    if (page === maxPages) {
      return {
        status: 'incomplete_unknown',
        reason: `Comment pagination limit reached (${maxPages} full pages) without establishing end of comment history`,
      };
    }
  }

  return {
    status: 'incomplete_unknown',
    reason: 'Comment pagination loop terminated unexpectedly',
  };
}

/**
 * Delivers pet action feedback with confirmation and safe comment-history inspection.
 *
 * Operational Protocol:
 * 1. Inspects existing issue comments with bounded pagination.
 * 2. If already present, skips posting (no duplicate).
 * 3. If scan is incomplete_unknown (rate-limited, API error, max pages reached, deadline hit),
 *    NEVER posts a replacement comment and keeps issue open.
 * 4. If confirmed absent across complete history, attempts comment submission.
 * 5. If submission throws ambiguously, re-inspects comments to verify if upstream actually created it.
 * 6. Returns confirmation only when exact matching bot comment is confirmed to exist.
 */
export async function deliverFeedbackWithConfirmation(params: {
  client: GitHubInboxClient;
  repository: string;
  issueNumber: number;
  commentBody: string;
  expectedMarker: string;
  botLogin?: string;
  maxPages?: number;
  perPage?: number;
  deadlineMs?: number;
}): Promise<FeedbackDeliveryResult> {
  const {
    client,
    repository,
    issueNumber,
    commentBody,
    expectedMarker,
    botLogin,
    maxPages = 5,
    perPage = 100,
    deadlineMs,
  } = params;

  // 1. Inspect existing comments with bounded pagination
  const inspection = await inspectFeedbackStatus({
    client,
    repository,
    issueNumber,
    expectedMarker,
    expectedBotLogin: botLogin,
    maxPages,
    perPage,
    deadlineMs,
  });

  if (inspection.status === 'confirmed') {
    return {
      delivered: true,
      alreadyExisted: true,
      status: 'confirmed',
    };
  }

  if (inspection.status === 'incomplete_unknown') {
    // CRITICAL: Never interpret incomplete scan as absence. Never post replacement comment!
    return {
      delivered: false,
      alreadyExisted: false,
      status: 'incomplete_unknown',
      reason: inspection.reason,
    };
  }

  // 2. Feedback is confirmed absent across complete history: attempt comment submission
  let postSucceeded = false;
  try {
    await client.commentIssue(repository, issueNumber, commentBody);
    postSucceeded = true;
  } catch {
    postSucceeded = false;
  }

  if (postSucceeded) {
    return {
      delivered: true,
      alreadyExisted: false,
      status: 'confirmed',
    };
  }

  // 3. Ambiguous outcome recovery: re-inspect comments to verify if upstream actually created it
  const recheck = await inspectFeedbackStatus({
    client,
    repository,
    issueNumber,
    expectedMarker,
    expectedBotLogin: botLogin,
    maxPages,
    perPage,
    deadlineMs,
  });

  if (recheck.status === 'confirmed') {
    return {
      delivered: true,
      alreadyExisted: false,
      status: 'confirmed',
    };
  }

  return {
    delivered: false,
    alreadyExisted: false,
    status: recheck.status,
    reason:
      recheck.status === 'incomplete_unknown'
        ? recheck.reason
        : 'Comment submission failed and was not found on recheck',
  };
}
