/**
 * GitHub Profile Pet - Deduplication & High-Water Mark Gap Registry
 * Strictly implements Sprint 2.7.4 Deduplication & GitHub Gap Classification Specification.
 */

import type {
  GapClassificationResult,
  ProcessedRequestRegistry,
} from '../domain/types.ts';

export function isRequestProcessed(
  registry: ProcessedRequestRegistry,
  issueNumber: number
): boolean {
  if (issueNumber <= registry.highWaterIssueNumber) {
    return true;
  }
  return registry.sparseProcessedIssueNumbers.includes(issueNumber);
}

export function classifyGitHubGap(params: {
  status: number | string;
  isPullRequest?: boolean;
  hasPendingLabelAtCreation?: boolean;
}): GapClassificationResult {
  const { status, isPullRequest, hasPendingLabelAtCreation } = params;

  if (status === 200 || status === '200') {
    if (isPullRequest) {
      return {
        classification: 'retired_pr',
        isEligibleForHwmAdvancement: true,
        targetRegistryCollection: 'retiredNonActionGaps',
        rationale: 'Confirmed Pull Request: 200 OK with pull_request key populated.',
      };
    }
    if (!hasPendingLabelAtCreation) {
      return {
        classification: 'retired_non_pet_issue',
        isEligibleForHwmAdvancement: true,
        targetRegistryCollection: 'retiredNonActionGaps',
        rationale: 'Confirmed Non-Pet Issue: 200 OK without pet-action:pending at creation.',
      };
    }
    return {
      classification: 'active_or_processed_pet_action',
      isEligibleForHwmAdvancement: true,
      targetRegistryCollection: 'sparseProcessedIssueNumbers',
      rationale: 'Active or Processed Pet Action: 200 OK with pet-action:pending.',
    };
  }

  if (status === 410 || status === '410') {
    return {
      classification: 'retired_deleted_410',
      isEligibleForHwmAdvancement: true,
      targetRegistryCollection: 'retiredNonActionGaps',
      rationale: 'Definitively Deleted Resource: 410 Gone establishes permanent deletion.',
    };
  }

  if (status === 404 || status === '404') {
    return {
      classification: 'unresolved_ambiguous_404',
      isEligibleForHwmAdvancement: false,
      targetRegistryCollection: 'unresolvedGaps',
      rationale:
        'Ambiguous Gap: 404 Not Found does not prove absence or deletion. Ineligible for HWM advancement.',
    };
  }

  if (status === 403 || status === 429 || status === '403' || status === '429') {
    return {
      classification: 'unresolved_rate_limited',
      isEligibleForHwmAdvancement: false,
      targetRegistryCollection: 'unresolvedGaps',
      rationale: 'Rate-Limited or Forbidden. Ineligible for HWM advancement.',
    };
  }

  if (typeof status === 'number' && status >= 500 && status < 600) {
    return {
      classification: 'unresolved_server_error',
      isEligibleForHwmAdvancement: false,
      targetRegistryCollection: 'unresolvedGaps',
      rationale: 'Server Error or Network Drop. Ineligible for HWM advancement.',
    };
  }

  return {
    classification: 'unresolved_incomplete_pagination',
    isEligibleForHwmAdvancement: false,
    targetRegistryCollection: 'unresolvedGaps',
    rationale: `Unrecognized or incomplete response status: ${String(status)}. Ineligible for HWM advancement.`,
  };
}

export function advanceHighWaterMark(
  registry: ProcessedRequestRegistry
): ProcessedRequestRegistry {
  let hwm = registry.highWaterIssueNumber;
  const sparseSet = new Set(registry.sparseProcessedIssueNumbers);
  const retiredSet = new Set(registry.retiredNonActionGaps);
  const unresolvedSet = new Set(registry.unresolvedGaps);

  // Scan consecutive integers from hwm + 1 upwards
  while (true) {
    const nextCandidate = hwm + 1;

    // Never advance past an unresolved gap!
    if (unresolvedSet.has(nextCandidate)) {
      break;
    }

    if (sparseSet.has(nextCandidate) || retiredSet.has(nextCandidate)) {
      hwm = nextCandidate;
      sparseSet.delete(nextCandidate);
      retiredSet.delete(nextCandidate);
    } else {
      break;
    }
  }

  return {
    highWaterIssueNumber: hwm,
    sparseProcessedIssueNumbers: Array.from(sparseSet).sort((a, b) => a - b),
    retiredNonActionGaps: Array.from(retiredSet).sort((a, b) => a - b),
    unresolvedGaps: Array.from(unresolvedSet).sort((a, b) => a - b),
  };
}

export function recordProcessedIssue(
  registry: ProcessedRequestRegistry,
  issueNumber: number
): ProcessedRequestRegistry {
  if (issueNumber <= registry.highWaterIssueNumber) {
    return { ...registry };
  }

  const sparse = new Set(registry.sparseProcessedIssueNumbers);
  sparse.add(issueNumber);

  const updated: ProcessedRequestRegistry = {
    ...registry,
    sparseProcessedIssueNumbers: Array.from(sparse).sort((a, b) => a - b),
  };

  return advanceHighWaterMark(updated);
}

export function recordRetiredGap(
  registry: ProcessedRequestRegistry,
  issueNumber: number
): ProcessedRequestRegistry {
  if (issueNumber <= registry.highWaterIssueNumber) {
    return { ...registry };
  }

  const retired = new Set(registry.retiredNonActionGaps);
  retired.add(issueNumber);

  const updated: ProcessedRequestRegistry = {
    ...registry,
    retiredNonActionGaps: Array.from(retired).sort((a, b) => a - b),
  };

  return advanceHighWaterMark(updated);
}

export function recordUnresolvedGap(
  registry: ProcessedRequestRegistry,
  issueNumber: number
): ProcessedRequestRegistry {
  if (issueNumber <= registry.highWaterIssueNumber) {
    throw new Error(
      `Protocol Violation: Cannot record unresolved gap ${issueNumber} below or at current HWM ${registry.highWaterIssueNumber}.`
    );
  }

  const unresolved = new Set(registry.unresolvedGaps);
  unresolved.add(issueNumber);

  return {
    ...registry,
    unresolvedGaps: Array.from(unresolved).sort((a, b) => a - b),
  };
}
