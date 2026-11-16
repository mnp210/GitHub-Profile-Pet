/**
 * GitHub Profile Pet - Durable Action Inbox Scanner
 * Discovers pending care action issues, orders them chronologically,
 * and classifies historical sequence gaps.
 */

import {
  advanceHighWaterMark,
  classifyGitHubGap,
  isRequestProcessed,
  recordRetiredGap,
  recordUnresolvedGap,
} from '../accounting/deduplicationRegistry.ts';
import type { ProcessedRequestRegistry } from '../domain/types.ts';
import { parseIssueAction } from './issueParser.ts';
import type { ActionParseResult, GitHubInboxClient, GitHubIssue } from './types.ts';

export interface PendingActionScanResult {
  eligibleActions: ActionParseResult[];
  ineligibleIssues: ActionParseResult[];
  unresolvedGapsEncountered: number;
  hasMorePending: boolean;
  queueDrained: boolean;
}

/**
 * Scans the repository for open pet-action issues and evaluates sequence gaps.
 *
 * Sequence Guarantees:
 * 1. Drains open issues in ascending chronological order: created_at ASC, number ASC.
 * 2. Checks deduplication registry: previously processed issues are recognized immediately.
 * 3. Inspects sequence gaps between high-water mark and lowest open action.
 * 4. Never advances high-water mark past an unresolved gap (404, 403, 429, 5xx).
 */
export async function scanPendingActions(params: {
  client: GitHubInboxClient;
  repository: string;
  registry: ProcessedRequestRegistry;
  maxGapsToInspect?: number;
  maxPages?: number;
}): Promise<PendingActionScanResult> {
  const { client, repository, registry, maxGapsToInspect = 25, maxPages } = params;

  // 1. Fetch pending issues (supports both array and paginated result)
  let pendingIssues: GitHubIssue[] = [];
  let hasMorePending = false;
  try {
    const listResult = await client.listPendingIssues(repository, { maxPages });
    if (Array.isArray(listResult)) {
      pendingIssues = listResult;
      hasMorePending = false;
    } else if (listResult && Array.isArray(listResult.issues)) {
      pendingIssues = listResult.issues;
      hasMorePending = Boolean(listResult.hasMore);
    }
  } catch {
    // If list fails (e.g. network/rate limit), return empty list without throwing
    return {
      eligibleActions: [],
      ineligibleIssues: [],
      unresolvedGapsEncountered: 1,
      hasMorePending: false,
      queueDrained: false,
    };
  }

  // 2. Sort chronologically: created_at ASC, number ASC
  pendingIssues.sort((a, b) => {
    const timeA = new Date(a.created_at).getTime();
    const timeB = new Date(b.created_at).getTime();
    if (timeA !== timeB) return timeA - timeB;
    return a.number - b.number;
  });

  const eligibleActions: ActionParseResult[] = [];
  const ineligibleIssues: ActionParseResult[] = [];

  // 3. Inspect missing gaps up to the lowest pending issue number
  if (pendingIssues.length > 0) {
    const lowestPendingNumber = pendingIssues[0].number;
    let gapNumber = registry.highWaterIssueNumber + 1;
    let gapsInspected = 0;

    while (gapNumber < lowestPendingNumber && gapsInspected < maxGapsToInspect) {
      if (
        !registry.sparseProcessedIssueNumbers.includes(gapNumber) &&
        !registry.retiredNonActionGaps.includes(gapNumber) &&
        !registry.unresolvedGaps.includes(gapNumber)
      ) {
        // Inspect the gap via getIssue
        try {
          const detail = await client.getIssue(repository, gapNumber);
          const gapResult = classifyGitHubGap({
            status: detail.status,
            isPullRequest: Boolean(detail.issue?.pull_request),
            hasPendingLabelAtCreation: Boolean(
              detail.issue?.labels?.some((l) =>
                (typeof l === 'string' ? l : l.name).toLowerCase() === 'pet-action:pending'
              )
            ),
          });

          if (gapResult.isEligibleForHwmAdvancement) {
            recordRetiredGap(registry, gapNumber);
          } else {
            recordUnresolvedGap(registry, gapNumber);
          }
        } catch {
          recordUnresolvedGap(registry, gapNumber);
        }
        gapsInspected++;
      }
      gapNumber++;
    }

    // Attempt advancement
    advanceHighWaterMark(registry);
  }

  // 4. Parse and classify each pending issue
  for (const issue of pendingIssues) {
    // Check if already processed
    if (isRequestProcessed(registry, issue.number)) {
      ineligibleIssues.push({
        eligible: false,
        status: 'already_processed',
        issueNumber: issue.number,
        eventTimestampMs: new Date(issue.created_at).getTime(),
        authorId: issue.user?.id ?? 0,
        authorLogin: issue.user?.login ?? 'unknown',
        commentsCount: typeof issue.comments === 'number' ? issue.comments : undefined,
        rejectionReason: `Action #${issue.number} was already committed and processed.`,
      });
      continue;
    }

    const parsed = parseIssueAction(issue);
    if (parsed.eligible) {
      eligibleActions.push(parsed);
    } else {
      ineligibleIssues.push(parsed);
    }
  }

  return {
    eligibleActions,
    ineligibleIssues,
    unresolvedGapsEncountered: registry.unresolvedGaps.length,
    hasMorePending,
    queueDrained: !hasMorePending,
  };
}
