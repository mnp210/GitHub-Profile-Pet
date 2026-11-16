import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGitHubGap,
  isRequestProcessed,
  recordProcessedIssue,
  recordRetiredGap,
  recordUnresolvedGap,
} from '../../src/features/pet-engine/accounting/deduplicationRegistry.ts';
import type { ProcessedRequestRegistry } from '../../src/features/pet-engine/domain/types.ts';

function createEmptyRegistry(hwm: number = 0): ProcessedRequestRegistry {
  return {
    highWaterIssueNumber: hwm,
    sparseProcessedIssueNumbers: [],
    retiredNonActionGaps: [],
    unresolvedGaps: [],
  };
}

describe('Deduplication & Gap Classification Registry (Tests 17-19 & TC-FILE-13)', () => {
  it('TC-DEDUP-01: Sequential HWM advancement when consecutive issues are processed', () => {
    let reg = createEmptyRegistry(10);

    // Record #11
    reg = recordProcessedIssue(reg, 11);
    assert.equal(reg.highWaterIssueNumber, 11);
    assert.deepEqual(reg.sparseProcessedIssueNumbers, []);

    // Record #12
    reg = recordProcessedIssue(reg, 12);
    assert.equal(reg.highWaterIssueNumber, 12);
    assert.deepEqual(reg.sparseProcessedIssueNumbers, []);

    // Record retired non-action PR #13
    reg = recordRetiredGap(reg, 13);
    assert.equal(reg.highWaterIssueNumber, 13);
    assert.deepEqual(reg.retiredNonActionGaps, []);
  });

  it('TC-DEDUP-02: Sparse processed numbers maintained when non-consecutive numbers arrive', () => {
    let reg = createEmptyRegistry(20);

    // Issue #25 arrives before #21-#24
    reg = recordProcessedIssue(reg, 25);
    assert.equal(reg.highWaterIssueNumber, 20); // HWM remains at 20
    assert.deepEqual(reg.sparseProcessedIssueNumbers, [25]);

    // Issue #22 arrives
    reg = recordProcessedIssue(reg, 22);
    assert.equal(reg.highWaterIssueNumber, 20);
    assert.deepEqual(reg.sparseProcessedIssueNumbers, [22, 25]);

    // Check idempotency detection
    assert.equal(isRequestProcessed(reg, 20), true); // <= HWM
    assert.equal(isRequestProcessed(reg, 22), true); // in sparse set
    assert.equal(isRequestProcessed(reg, 25), true); // in sparse set
    assert.equal(isRequestProcessed(reg, 21), false); // not yet processed
  });

  it('TC-DEDUP-03: Repeated execution of processed request is recognized as duplicate', () => {
    const reg: ProcessedRequestRegistry = {
      highWaterIssueNumber: 50,
      sparseProcessedIssueNumbers: [55, 60],
      retiredNonActionGaps: [52],
      unresolvedGaps: [51],
    };

    assert.equal(isRequestProcessed(reg, 45), true); // <= HWM 50
    assert.equal(isRequestProcessed(reg, 50), true); // == HWM 50
    assert.equal(isRequestProcessed(reg, 55), true); // sparse
    assert.equal(isRequestProcessed(reg, 60), true); // sparse
    assert.equal(isRequestProcessed(reg, 53), false); // not processed
  });

  it('TC-FILE-13: Comprehensive Gap Classification & Ambiguous 404 Invariant', () => {
    // Specification Scenario:
    // High-water mark is 42.
    // Integer 43 returns HTTP 404 (ambiguous gap).
    // Integer 44 is pet action #44.
    // Integer 45 is Pull Request #45 (returns 200 with pull_request).
    let reg = createEmptyRegistry(42);

    // 1. Classify 43 (HTTP 404)
    const c43 = classifyGitHubGap({ status: 404 });
    assert.equal(c43.classification, 'unresolved_ambiguous_404');
    assert.equal(c43.isEligibleForHwmAdvancement, false);
    assert.equal(c43.targetRegistryCollection, 'unresolvedGaps');
    reg = recordUnresolvedGap(reg, 43);

    // 2. Classify 44 (Pet action 200 with pending label)
    const c44 = classifyGitHubGap({ status: 200, hasPendingLabelAtCreation: true });
    assert.equal(c44.classification, 'active_or_processed_pet_action');
    assert.equal(c44.isEligibleForHwmAdvancement, true);
    reg = recordProcessedIssue(reg, 44);

    // 3. Classify 45 (PR 200 with pull_request)
    const c45 = classifyGitHubGap({ status: 200, isPullRequest: true });
    assert.equal(c45.classification, 'retired_pr');
    assert.equal(c45.isEligibleForHwmAdvancement, true);
    reg = recordRetiredGap(reg, 45);

    // Invariant assertions:
    // Integer 43 is retained in unresolvedGaps
    assert.deepEqual(reg.unresolvedGaps, [43]);

    // High-water mark strictly does NOT advance past 42
    assert.equal(reg.highWaterIssueNumber, 42);

    // Integer 44 is executed and stored in sparseProcessedIssueNumbers: [44]
    assert.deepEqual(reg.sparseProcessedIssueNumbers, [44]);

    // Integer 45 is retired into retiredNonActionGaps: [45]
    assert.deepEqual(reg.retiredNonActionGaps, [45]);

    // Deduplication remains 100% correct
    assert.equal(isRequestProcessed(reg, 42), true);
    assert.equal(isRequestProcessed(reg, 43), false);
    assert.equal(isRequestProcessed(reg, 44), true);
    assert.equal(isRequestProcessed(reg, 45), false); // Retired PR is not a pet action
  });

  it('TC-DEDUP-05: Gap classification covers 410 Gone, rate-limiting, and server errors', () => {
    const c410 = classifyGitHubGap({ status: 410 });
    assert.equal(c410.classification, 'retired_deleted_410');
    assert.equal(c410.isEligibleForHwmAdvancement, true);

    const c429 = classifyGitHubGap({ status: 429 });
    assert.equal(c429.classification, 'unresolved_rate_limited');
    assert.equal(c429.isEligibleForHwmAdvancement, false);

    const c500 = classifyGitHubGap({ status: 500 });
    assert.equal(c500.classification, 'unresolved_server_error');
    assert.equal(c500.isEligibleForHwmAdvancement, false);
  });
});
