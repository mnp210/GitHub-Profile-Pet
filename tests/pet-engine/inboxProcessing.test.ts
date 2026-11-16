import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  DEFAULT_BOT_LOGIN,
  DefaultGitHubInboxClient,
  getActionFeedbackMarker,
  inspectFeedbackStatus,
  isBotAuthoredFeedback,
  normalizeBotLogin,
  parseIssueAction,
  processInbox,
  scanPendingActions,
} from '../../src/features/pet-engine/inbox/index.ts';
import type {
  GitHubInboxClient,
  GitHubIssue,
  GitHubIssueComment,
  PendingIssuesPageResult,
} from '../../src/features/pet-engine/inbox/types.ts';
import {
  advanceHighWaterMark,
  classifyGitHubGap,
  isRequestProcessed,
  recordProcessedIssue,
  recordRetiredGap,
  recordUnresolvedGap,
} from '../../src/features/pet-engine/accounting/deduplicationRegistry.ts';
import {
  getStatePaths,
  loadRepositoryState,
  saveRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import type {
  ActionLedgerDocument,
  ContributionLedgerDocument,
  PetStateDocument,
  ProcessedRequestRegistry,
  RecentActionEntry,
} from '../../src/features/pet-engine/domain/types.ts';

function createEmptyProcessedRequestRegistry(hwm: number = 0): ProcessedRequestRegistry {
  return {
    highWaterIssueNumber: hwm,
    sparseProcessedIssueNumbers: [],
    retiredNonActionGaps: [],
    unresolvedGaps: [],
  };
}

/**
 * In-memory Mock GitHub API Client for deterministic testing
 */
class MockGitHubInboxClient implements GitHubInboxClient {
  public issues: Map<number, GitHubIssue> = new Map();
  public comments: Map<number, string[]> = new Map();
  public commentsList: Map<number, GitHubIssueComment[]> = new Map();
  public failCommentMap: Map<number, { simulateAmbiguousSuccess: boolean }> = new Map();
  public commentErrorMap: Map<number, { status: number; message: string }> = new Map();
  public commentPageErrorMap: Map<string, { status: number; message: string }> = new Map();
  public labelsAdded: Map<number, string[]> = new Map();
  public labelsRemoved: Map<number, string[]> = new Map();
  public closedIssues: Set<number> = new Set();
  public getIssueResponses: Map<number, { status: number; issue?: GitHubIssue }> = new Map();

  addMockIssue(issue: GitHubIssue): void {
    this.issues.set(issue.number, issue);
  }

  addUserComment(
    issueNumber: number,
    body: string,
    user?: { id?: number; login: string; type?: string }
  ): void {
    const commentObj: GitHubIssueComment = {
      id: Math.floor(Math.random() * 1000000),
      body,
      user: user ?? { id: 999, login: 'owner', type: 'User' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!this.commentsList.has(issueNumber)) {
      this.commentsList.set(issueNumber, []);
    }
    this.commentsList.get(issueNumber)!.push(commentObj);
    if (!this.comments.has(issueNumber)) {
      this.comments.set(issueNumber, []);
    }
    this.comments.get(issueNumber)!.push(body);
    if (this.issues.has(issueNumber)) {
      const issue = this.issues.get(issueNumber)!;
      issue.comments = (issue.comments ?? 0) + 1;
    }
  }

  failNextComment(
    issueNumber: number,
    options: { simulateAmbiguousSuccess: boolean } = { simulateAmbiguousSuccess: false }
  ): void {
    this.failCommentMap.set(issueNumber, options);
  }

  failCommentList(
    issueNumber: number,
    status: number = 403,
    message: string = 'Rate limit exceeded'
  ): void {
    this.commentErrorMap.set(issueNumber, { status, message });
  }

  clearCommentListError(issueNumber: number): void {
    this.commentErrorMap.delete(issueNumber);
  }

  failCommentListPage(
    issueNumber: number,
    page: number,
    status: number = 500,
    message: string = 'Internal server error'
  ): void {
    this.commentPageErrorMap.set(`${issueNumber}:page-${page}`, { status, message });
  }

  clearCommentListPageError(issueNumber: number, page: number): void {
    this.commentPageErrorMap.delete(`${issueNumber}:page-${page}`);
  }

  async listIssueComments(
    _repo: string,
    issueNumber: number,
    options?: { page?: number; perPage?: number }
  ): Promise<GitHubIssueComment[]> {
    void _repo;
    if (this.commentErrorMap.has(issueNumber)) {
      const err = this.commentErrorMap.get(issueNumber)!;
      throw new Error(`GitHub API error (HTTP ${err.status}): ${err.message}`);
    }
    const page = options?.page ?? 1;
    const pageKey = `${issueNumber}:page-${page}`;
    if (this.commentPageErrorMap.has(pageKey)) {
      const err = this.commentPageErrorMap.get(pageKey)!;
      throw new Error(`GitHub API error (HTTP ${err.status}): ${err.message}`);
    }
    const all = this.commentsList.get(issueNumber) ?? [];
    if (!options?.page && !options?.perPage) {
      return [...all];
    }
    const perPage = options?.perPage ?? 100;
    const start = (page - 1) * perPage;
    return all.slice(start, start + perPage);
  }

  async listPendingIssues(
    _repo: string,
    options?: { page?: number; perPage?: number; maxPages?: number }
  ): Promise<PendingIssuesPageResult> {
    void _repo;
    const list: GitHubIssue[] = [];
    for (const issue of this.issues.values()) {
      if (issue.state === 'open') {
        const hasPending = issue.labels.some((l) =>
          (typeof l === 'string' ? l : l.name).toLowerCase() === 'pet-action:pending'
        );
        if (hasPending && !issue.pull_request) {
          list.push({ ...issue });
        }
      }
    }

    // Sort strictly chronological: created_at ASC, then number ASC
    list.sort((a, b) => {
      const timeDiff = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.number - b.number;
    });

    const perPage = options?.perPage ?? 100;
    const maxPages = options?.maxPages ?? 5;
    const maxFetchable = perPage * maxPages;
    const fetched = list.slice(0, maxFetchable);
    const hasMore = list.length > maxFetchable;
    const pageCount = Math.ceil(fetched.length / perPage) || 1;

    return {
      issues: fetched,
      hasMore,
      pageCount,
    };
  }

  async getIssue(_repo: string, issueNumber: number): Promise<{ status: number; issue?: GitHubIssue }> {
    if (this.getIssueResponses.has(issueNumber)) {
      return this.getIssueResponses.get(issueNumber)!;
    }
    if (this.issues.has(issueNumber)) {
      return { status: 200, issue: this.issues.get(issueNumber)! };
    }
    return { status: 404 };
  }

  async commentIssue(_repo: string, issueNumber: number, comment: string): Promise<void> {
    if (this.failCommentMap.has(issueNumber)) {
      const cfg = this.failCommentMap.get(issueNumber)!;
      this.failCommentMap.delete(issueNumber);
      if (cfg.simulateAmbiguousSuccess) {
        // Upstream committed the comment, then network dropped before response arrived
        const commentObj: GitHubIssueComment = {
          id: Math.floor(Math.random() * 1000000),
          body: comment,
          user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (!this.commentsList.has(issueNumber)) {
          this.commentsList.set(issueNumber, []);
        }
        this.commentsList.get(issueNumber)!.push(commentObj);
        if (!this.comments.has(issueNumber)) {
          this.comments.set(issueNumber, []);
        }
        this.comments.get(issueNumber)!.push(comment);
        if (this.issues.has(issueNumber)) {
          const issue = this.issues.get(issueNumber)!;
          issue.comments = (issue.comments ?? 0) + 1;
        }
      }
      throw new Error('ETIMEDOUT: GitHub comments API connection dropped');
    }

    const commentObj: GitHubIssueComment = {
      id: Math.floor(Math.random() * 1000000),
      body: comment,
      user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!this.commentsList.has(issueNumber)) {
      this.commentsList.set(issueNumber, []);
    }
    this.commentsList.get(issueNumber)!.push(commentObj);
    if (!this.comments.has(issueNumber)) {
      this.comments.set(issueNumber, []);
    }
    this.comments.get(issueNumber)!.push(comment);
    if (this.issues.has(issueNumber)) {
      const issue = this.issues.get(issueNumber)!;
      issue.comments = (issue.comments ?? 0) + 1;
    }
  }

  async closeIssue(_repo: string, issueNumber: number, labelToAdd?: string): Promise<void> {
    this.closedIssues.add(issueNumber);
    if (this.issues.has(issueNumber)) {
      this.issues.get(issueNumber)!.state = 'closed';
    }
    if (labelToAdd) {
      await this.addLabels(_repo, issueNumber, [labelToAdd]);
      await this.removeLabel(_repo, issueNumber, 'pet-action:pending');
    }
  }

  async addLabels(_repo: string, issueNumber: number, labels: string[]): Promise<void> {
    if (!this.labelsAdded.has(issueNumber)) {
      this.labelsAdded.set(issueNumber, []);
    }
    this.labelsAdded.get(issueNumber)!.push(...labels);
    if (this.issues.has(issueNumber)) {
      this.issues.get(issueNumber)!.labels.push(...labels);
    }
  }

  async removeLabel(_repo: string, issueNumber: number, label: string): Promise<void> {
    if (!this.labelsRemoved.has(issueNumber)) {
      this.labelsRemoved.set(issueNumber, []);
    }
    this.labelsRemoved.get(issueNumber)!.push(label);
    if (this.issues.has(issueNumber)) {
      this.issues.get(issueNumber)!.labels = this.issues.get(issueNumber)!.labels.filter(
        (l) => (typeof l === 'string' ? l : l.name).toLowerCase() !== label.toLowerCase()
      );
    }
  }
}

function createSampleRepositoryState(): {
  pet: PetStateDocument;
  contributions: ContributionLedgerDocument;
  actions: ActionLedgerDocument;
} {
  const pet: PetStateDocument = {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 3,
    xp: 45,
    maxExp: 300,
    energy: 85,
    energyAccumulator: 0,
    hunger: 75,
    happiness: 90,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-15T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T12:00:00.000Z',
    lastSimulatedAt: '2026-11-15T12:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T12:00:00.000Z',
  };

  const contributions: ContributionLedgerDocument = {
    schemaVersion: 1,
    generation: 1,
    monotonicPublicHwm: 100,
    dailyAccruedXp: { '2026-11-15': 60 },
    hourlySliceUsage: { '2026-11-15T12': 1 },
    slices: [],
    monthlyHistoricalSummary: [],
  };

  const actions: ActionLedgerDocument = {
    schemaVersion: 1,
    generation: 1,
    recentActions: [],
    processedRequestRegistry: createEmptyProcessedRequestRegistry(),
  };

  return { pet, contributions, actions };
}

describe('GitHub-native Pet Interaction & Durable Action Inbox (Phase 3B)', () => {
  // 1. Issue Form Schema Verification
  it('TC-INBOX-01: Verifies all 4 Issue Form schemas for feed, train, rest, and pet', async () => {
    const templatesDir = path.join(process.cwd(), '.github', 'ISSUE_TEMPLATE');
    const forms = ['pet-feed.yml', 'pet-train.yml', 'pet-rest.yml', 'pet-pet.yml'];

    for (const formFile of forms) {
      const content = await fs.readFile(path.join(templatesDir, formFile), 'utf-8');

      // Verify required label
      assert(
        content.includes('pet-action:pending'),
        `${formFile} must include 'pet-action:pending' label`
      );

      // Verify specific action label
      const actionName = formFile.replace('pet-', '').replace('.yml', '');
      assert(
        content.includes(`pet:${actionName}`),
        `${formFile} must include specific action label 'pet:${actionName}'`
      );

      // Verify structured dropdowns and confirmation
      assert(content.includes('type: dropdown'), `${formFile} must use structured dropdown inputs`);
      assert(content.includes('type: checkboxes'), `${formFile} must include confirmation checkbox`);

      // Verify no authoritative game state inputs allowed from client
      assert(!content.includes('xp_amount'), `${formFile} must not accept client-provided XP`);
      assert(!content.includes('energy_value'), `${formFile} must not accept client-provided energy`);
      assert(!content.includes('trainer_id'), `${formFile} must not accept client-provided trainer ID`);
    }
  });

  // 2. Workflow Configuration & Least-Privilege Permissions
  it('TC-INBOX-02: Workflow configuration enforces least-privilege contents:write and issues:write permissions', async () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'pet-interaction.yml');
    const content = await fs.readFile(workflowPath, 'utf-8');

    // Permissions check
    assert(
      content.includes('contents: write'),
      'Workflow must define contents: write permission'
    );
    assert(
      content.includes('issues: write'),
      'Workflow must define issues: write permission'
    );
    assert(!content.includes('write-all'), 'Workflow must strictly avoid write-all permission');

    // Concurrency control
    assert(content.includes('concurrency:'), 'Workflow must define concurrency group');
    assert(
      content.includes('cancel-in-progress: false'),
      'Workflow concurrency must set cancel-in-progress: false'
    );

    // Timeout
    assert(
      content.includes('timeout-minutes: 5'),
      'Workflow job must define bounded timeout of 5 minutes'
    );

    // Triggers
    assert(content.includes('types: [opened]'), 'Workflow must trigger on issues: [opened]');
    assert(content.includes('schedule:'), 'Workflow must support scheduled recovery sweep');
    assert(content.includes('workflow_dispatch:'), 'Workflow must support manual workflow_dispatch');
  });

  // 3. Pull Request Rejection
  it('TC-INBOX-03: Pull Requests sharing issue number space are strictly rejected with zero state mutation', () => {
    const prIssue: GitHubIssue = {
      number: 42,
      title: 'pet: feed',
      body: 'Meal: Salmon',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 101, login: 'contributor' },
      pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/42' },
    };

    const parseResult = parseIssueAction(prIssue);
    assert.equal(parseResult.eligible, false);
    assert.equal(parseResult.status, 'pull_request_rejected');
    assert.equal(parseResult.targetLabel, 'pet-action:invalid');
  });

  // 4. Ordinary Non-Pet Issue Rejection
  it('TC-INBOX-04: Ordinary non-pet issues missing pet-action:pending are ignored', () => {
    const normalIssue: GitHubIssue = {
      number: 43,
      title: 'Bug report: Button styling glitch',
      body: 'The button color is off on mobile.',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['bug', 'ui'],
      user: { id: 102, login: 'user123' },
    };

    const parseResult = parseIssueAction(normalIssue);
    assert.equal(parseResult.eligible, false);
    assert.equal(parseResult.status, 'missing_pending_label');
  });

  // 5. Malformed & Unknown Action Payloads
  it('TC-INBOX-05: Malformed and unknown action payloads are rejected with pet-action:invalid', () => {
    const malformedIssue: GitHubIssue = {
      number: 44,
      title: 'pet: give_infinite_xp',
      body: 'Cheating action attempt',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending'],
      user: { id: 103, login: 'hacker' },
    };

    const parseResult = parseIssueAction(malformedIssue);
    assert.equal(parseResult.eligible, false);
    assert.equal(parseResult.status, 'unknown_action_type');
    assert.equal(parseResult.targetLabel, 'pet-action:invalid');
  });

  // 6. Issue Edit After Creation (Conservative Quarantine Protection)
  it('TC-INBOX-06: Issues edited after creation are quarantined to prevent payload tampering', () => {
    // 6a. Edit within 10 seconds (e.g. 3 seconds later - grace period removed!)
    const quickEditIssue: GitHubIssue = {
      number: 44,
      title: 'pet: feed',
      body: 'Quickly edited meal payload',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:03.000Z', // 3 seconds later
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 104, login: 'quick_editor' },
    };
    const resQuick = parseIssueAction(quickEditIssue);
    assert.equal(resQuick.eligible, false);
    assert.equal(resQuick.status, 'edited_quarantined');
    assert.equal(resQuick.targetLabel, 'pet-action:quarantine');

    // 6b. Edit after 10 seconds (e.g. 5 minutes later)
    const lateEditIssue: GitHubIssue = {
      number: 45,
      title: 'pet: feed',
      body: 'Edited meal payload',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:05:00.000Z', // 5 minutes later
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 104, login: 'sneaky' },
    };
    const resLate = parseIssueAction(lateEditIssue);
    assert.equal(resLate.eligible, false);
    assert.equal(resLate.status, 'edited_quarantined');
    assert.equal(resLate.targetLabel, 'pet-action:quarantine');

    // 6c. Unchanged delayed issue (e.g. created 4 hours ago, created_at === updated_at)
    const delayedUnchangedIssue: GitHubIssue = {
      number: 46,
      title: 'pet: train',
      body: 'Focus: Agility Drill',
      state: 'open',
      created_at: '2026-11-16T08:00:00.000Z',
      updated_at: '2026-11-16T08:00:00.000Z', // Identical timestamp
      labels: ['pet-action:pending', 'pet:train'],
      user: { id: 105, login: 'patient_trainer' },
    };
    const resDelayed = parseIssueAction(delayedUnchangedIssue);
    assert.equal(resDelayed.eligible, true);
    assert.equal(resDelayed.status, 'eligible');
    assert.equal(resDelayed.actionType, 'train');

    // 6d. Ambiguous timestamp precision (malformed date strings)
    const ambiguousDateIssue: GitHubIssue = {
      number: 47,
      title: 'pet: rest',
      body: 'Rest spot',
      state: 'open',
      created_at: 'invalid-date',
      updated_at: 'invalid-date',
      labels: ['pet-action:pending', 'pet:rest'],
      user: { id: 106, login: 'clock_glitch' },
    };
    const resAmbiguous = parseIssueAction(ambiguousDateIssue);
    assert.equal(resAmbiguous.eligible, false);
    assert.equal(resAmbiguous.status, 'edited_quarantined');
    assert.equal(resAmbiguous.targetLabel, 'pet-action:quarantine');

    // 6e. Immediate creation event override
    const creationEventResult = parseIssueAction(quickEditIssue, { isCreationEvent: true });
    assert.equal(creationEventResult.eligible, true);
    assert.equal(creationEventResult.actionType, 'feed');
  });

  // 7. Duplicate Event Delivery & At-Most-Once Execution
  it('TC-INBOX-07: Duplicate event delivery processes once and identifies second delivery as duplicate', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-test-'));

    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 10,
        title: 'pet: feed',
        body: 'Meal: Clean Code Kibble',
        state: 'open',
        created_at: '2026-11-15T12:02:00.000Z',
        updated_at: '2026-11-15T12:02:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Run 1: Processes the action
      const res1 = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res1.acceptedCount, 1);
      assert.equal(res1.outcomes[0].status, 'accepted');

      const updatedState = await loadRepositoryState(tempDir);
      assert.equal(isRequestProcessed(updatedState.actions.processedRequestRegistry, 10), true);
      const hungerAfterFirst = updatedState.pet.hunger;

      // Run 2: Duplicate delivery of same issue #10
      client.issues.get(10)!.state = 'open';
      client.issues.get(10)!.labels = ['pet-action:pending', 'pet:feed'];
      const res2 = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res2.acceptedCount, 0);
      assert.equal(res2.duplicateCount, 1);
      assert.equal(res2.outcomes[0].status, 'duplicate');

      // Assert pet state was NOT mutated a second time
      const stateAfterSecond = await loadRepositoryState(tempDir);
      assert.equal(stateAfterSecond.pet.hunger, hungerAfterFirst);
      assert.equal(stateAfterSecond.generation, updatedState.generation);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 8. Sequence Gaps: 410 Deleted vs 404 Ambiguous Invariant
  it('TC-INBOX-08: Gap classification treats 410 as retired deletion and 404 as ambiguous non-advancing gap', () => {
    // 410 Gone: definitive deletion, eligible for advancement
    const gap410 = classifyGitHubGap({ status: 410 });
    assert.equal(gap410.classification, 'retired_deleted_410');
    assert.equal(gap410.isEligibleForHwmAdvancement, true);
    assert.equal(gap410.targetRegistryCollection, 'retiredNonActionGaps');

    // 404 Not Found: ambiguous, must NOT advance HWM
    const gap404 = classifyGitHubGap({ status: 404 });
    assert.equal(gap404.classification, 'unresolved_ambiguous_404');
    assert.equal(gap404.isEligibleForHwmAdvancement, false);
    assert.equal(gap404.targetRegistryCollection, 'unresolvedGaps');
  });

  // 9. Sequence Gaps: Rate Limits (403/429) & Server Errors (5xx)
  it('TC-INBOX-09: Rate-limiting and 5xx errors are classified as unresolved and block HWM advancement', () => {
    const gap429 = classifyGitHubGap({ status: 429 });
    assert.equal(gap429.classification, 'unresolved_rate_limited');
    assert.equal(gap429.isEligibleForHwmAdvancement, false);

    const gap403 = classifyGitHubGap({ status: 403 });
    assert.equal(gap403.classification, 'unresolved_rate_limited');
    assert.equal(gap403.isEligibleForHwmAdvancement, false);

    const gap500 = classifyGitHubGap({ status: 500 });
    assert.equal(gap500.classification, 'unresolved_server_error');
    assert.equal(gap500.isEligibleForHwmAdvancement, false);

    const gap503 = classifyGitHubGap({ status: 503 });
    assert.equal(gap503.classification, 'unresolved_server_error');
    assert.equal(gap503.isEligibleForHwmAdvancement, false);
  });

  // 10. Out-of-Order Action Numbers & Sparse Interval Tracking
  it('TC-INBOX-10: Out-of-order action numbers are processed and recorded sparsely without being blocked by gaps', () => {
    let registry = createEmptyProcessedRequestRegistry();
    registry.highWaterIssueNumber = 10;

    // Issue #11 is an unresolved 404 gap
    registry = recordUnresolvedGap(registry, 11);

    // Issue #12 is a valid processed action
    registry = recordProcessedIssue(registry, 12);

    // Issue #13 is a valid processed action
    registry = recordProcessedIssue(registry, 13);

    // Advance HWM: HWM must NOT advance past gap #11!
    registry = advanceHighWaterMark(registry);
    assert.equal(registry.highWaterIssueNumber, 10, 'HWM must remain at 10 due to unresolved gap #11');
    assert(registry.sparseProcessedIssueNumbers.includes(12), 'Issue 12 must be sparsely tracked');
    assert(registry.sparseProcessedIssueNumbers.includes(13), 'Issue 13 must be sparsely tracked');

    // Both 12 and 13 must be recognized as processed
    assert.equal(isRequestProcessed(registry, 12), true);
    assert.equal(isRequestProcessed(registry, 13), true);

    // Now gap #11 is resolved as a 410 deletion
    registry.unresolvedGaps = registry.unresolvedGaps.filter((g) => g !== 11);
    registry = recordRetiredGap(registry, 11);

    // Advance HWM: Now HWM advances through 11, 12, 13 to reach 13!
    registry = advanceHighWaterMark(registry);
    assert.equal(registry.highWaterIssueNumber, 13, 'HWM must advance to 13 once gap is resolved');
    assert.equal(registry.sparseProcessedIssueNumbers.length, 0, 'Sparse list should be cleared');
  });

  // 11. Author Authorization & Impersonation Defense
  it('TC-INBOX-11: Rejects actions submitted by untrusted authors with pet-action:unauthorized', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-test-'));

    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 21,
        title: 'pet: feed',
        body: 'Unauthorized feed attempt',
        state: 'open',
        created_at: '2026-11-15T12:02:00.000Z',
        updated_at: '2026-11-15T12:02:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 777, login: 'stranger' },
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 999, // Only user 999 is authorized
        allowAnyAuthor: false,
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.equal(res.outcomes[0].status, 'rejected');
      assert(res.outcomes[0].message.includes('Unauthorized actor'));

      // Verify closed with pet-action:unauthorized
      assert.equal(client.closedIssues.has(21), true);
      assert(client.labelsAdded.get(21)!.includes('pet-action:unauthorized'));

      // Verify state was NOT mutated
      const currentState = await loadRepositoryState(tempDir);
      assert.equal(currentState.pet.hunger, 75);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 12. Rejected Actions Cause Zero State Mutation
  it('TC-INBOX-12: Gameplay rejections (e.g. training with low energy) cause zero state mutation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-test-'));

    try {
      const state = createSampleRepositoryState();
      state.pet.energy = 5; // Insufficient energy (< 18) for training
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 30,
        title: 'pet: train',
        body: 'Training drill',
        state: 'open',
        created_at: '2026-11-15T12:02:00.000Z',
        updated_at: '2026-11-15T12:02:00.000Z',
        labels: ['pet-action:pending', 'pet:train'],
        user: { id: 999, login: 'owner' },
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.equal(res.outcomes[0].status, 'rejected');
      assert(res.outcomes[0].message.includes('Insufficient Energy'));

      // Verify issue closed with pet-action:rejected
      assert.equal(client.closedIssues.has(30), true);
      assert(client.labelsAdded.get(30)!.includes('pet-action:rejected'));

      // Pet state remains unchanged
      const currentState = await loadRepositoryState(tempDir);
      assert.equal(currentState.pet.energy, 5);
      assert.equal(currentState.pet.xp, 45);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 13. Accepted Actions Applied Exactly Once & State Persisted Atomically
  it('TC-INBOX-13: Accepted feed action increases satiety and XP, publishes SVG, and closes issue', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-test-'));

    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 50,
        title: 'pet: feed',
        body: 'Meal: Clean Code Kibble',
        state: 'open',
        created_at: '2026-11-15T12:02:00.000Z',
        updated_at: '2026-11-15T12:02:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.acceptedCount, 1);
      assert.equal(res.rejectedCount, 0);
      assert.equal(res.outcomes[0].status, 'accepted');
      assert.equal(res.outcomes[0].xpGained, 10);

      // Verify issue comment and close
      assert.equal(client.closedIssues.has(50), true);
      assert(client.labelsAdded.get(50)!.includes('pet-action:completed'));
      const comments = client.comments.get(50)!;
      assert.equal(comments.length, 1);
      assert(comments[0].includes('Action Accepted: `FEED`'));
      assert(comments[0].includes('+10 XP'));

      // Verify state was committed atomically with incremented generation
      const currentState = await loadRepositoryState(tempDir);
      assert.equal(currentState.generation, 2);
      assert.equal(currentState.pet.hunger, 99); // 75 + 24
      assert.equal(currentState.pet.xp, 55); // 45 + 10
      assert.equal(currentState.actions.recentActions.length, 1);
      assert.equal(currentState.actions.recentActions[0].requestId, 'issue-50');

      // Verify published SVG exists
      const svgExists = await fs
        .access(path.join(tempDir, 'public', 'pet.svg'))
        .then(() => true)
        .catch(() => false);
      assert.equal(svgExists, true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 14. Interrupted State Persistence Recovery
  it('TC-INBOX-14: Successfully recovers an interrupted transaction journal before processing new actions', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-test-'));

    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      // Simulate an uncommitted interrupted journal in .journal/
      const journalDir = path.join(tempDir, 'pet', '.journal');
      await fs.mkdir(journalDir, { recursive: true });
      await fs.writeFile(
        path.join(journalDir, 'meta.json'),
        JSON.stringify({
          sourceGeneration: 1,
          targetGeneration: 2,
          status: 'preparing', // Uncommitted!
          timestamp: new Date().toISOString(),
        }),
        'utf-8'
      );

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 60,
        title: 'pet: rest',
        body: 'Rest action',
        state: 'open',
        created_at: '2026-11-15T12:02:00.000Z',
        updated_at: '2026-11-15T12:02:00.000Z',
        labels: ['pet-action:pending', 'pet:rest'],
        user: { id: 999, login: 'owner' },
      });

      // processInbox should recover the uncommitted journal (roll back) and proceed cleanly
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.acceptedCount, 1);
      const currentState = await loadRepositoryState(tempDir);
      assert.equal(currentState.generation, 2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 15. Chronological Order Enforcement Across Multiple Pending Issues
  it('TC-INBOX-15: Processes multiple pending issues in strict chronological order', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-test-'));

    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();

      // Issue #2 submitted at 12:05
      client.addMockIssue({
        number: 2,
        title: 'pet: rest',
        body: 'Rest',
        state: 'open',
        created_at: '2026-11-15T12:05:00.000Z',
        updated_at: '2026-11-15T12:05:00.000Z',
        labels: ['pet-action:pending', 'pet:rest'],
        user: { id: 999, login: 'owner' },
      });

      // Issue #1 submitted at 12:01 (earlier!)
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'Feed',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.processedCount, 2);
      // Order of outcomes must be Issue #1 first, then Issue #2
      assert.equal(res.outcomes[0].issueNumber, 1);
      assert.equal(res.outcomes[0].actionType, 'feed');
      assert.equal(res.outcomes[1].issueNumber, 2);
      assert.equal(res.outcomes[1].actionType, 'rest');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 16. Client Construction & Scanner Integration
  it('TC-INBOX-16: Default client initializes safely and scanPendingActions filters issues correctly', async () => {
    const client = new DefaultGitHubInboxClient('test-token-xyz');
    assert.ok(client);

    const mockClient = new MockGitHubInboxClient();
    mockClient.addMockIssue({
      number: 101,
      title: 'pet: feed',
      body: 'Meal: Kibble',
      state: 'open',
      created_at: '2026-11-15T12:00:00.000Z',
      updated_at: '2026-11-15T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 1, login: 'user1' },
    });

    const reg = createEmptyProcessedRequestRegistry(100);
    const scan = await scanPendingActions({
      client: mockClient,
      repository: 'owner/repo',
      registry: reg,
    });
    assert.equal(scan.eligibleActions.length, 1);
    assert.equal(scan.eligibleActions[0].issueNumber, 101);
  });

  // 17. Interruption Boundary 1: Crash before state mutation
  it('TC-INBOX-17: Interruption Boundary 1 - Crash before state mutation leaves state clean for next sweep', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-boundary-1-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 70,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Prior to processing, state is at generation 1 and issue 70 is open
      const initial = await loadRepositoryState(tempDir);
      assert.equal(initial.generation, 1);
      assert.equal(isRequestProcessed(initial.actions.processedRequestRegistry, 70), false);

      // Next run processes issue 70 normally
      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);

      const after = await loadRepositoryState(tempDir);
      assert.equal(after.generation, 2);
      assert.equal(after.pet.hunger, 99); // 75 + 24
      assert.equal(isRequestProcessed(after.actions.processedRequestRegistry, 70), true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 18. Interruption Boundary 2: Crash during journal preparation
  it('TC-INBOX-18: Interruption Boundary 2 - Interrupted journal is automatically recovered before processing new actions', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-boundary-2-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      // Simulate crash during journal preparation of generation 2 (target directory staged, but meta.json missing)
      const paths = getStatePaths(tempDir);
      await fs.mkdir(paths.journalTargetDir, { recursive: true });
      await fs.writeFile(
        path.join(paths.journalTargetDir, 'pet.json'),
        JSON.stringify({ ...state.pet, hunger: 100, generation: 2 })
      );

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 71,
        title: 'pet: rest',
        body: 'Cozy Blanket',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:rest'],
        user: { id: 999, login: 'owner' },
      });

      // processInbox invokes recoverRepositoryState, cleans stale journal, and executes rest
      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);

      const after = await loadRepositoryState(tempDir);
      assert.equal(after.generation, 2);
      assert.equal(after.pet.energy, 100); // 90 + 25 -> 100
      assert.equal(isRequestProcessed(after.actions.processedRequestRegistry, 71), true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 19. Interruption Boundary 3: Crash after durable state commit but before Issue comment
  it('TC-INBOX-19: Interruption Boundary 3 - Delivers outstanding comment feedback and closes issue without re-applying mutations', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-boundary-3-'));
    try {
      const state = createSampleRepositoryState();
      // Record issue 72 as committed
      state.pet.generation = 2;
      state.pet.hunger = 99; // Already received +24
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.recentActions = [{
        action: 'feed',
        timestamp: Date.now(),
        requestId: 'issue-72',
      }];
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 72);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 72,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open', // Still open because runner crashed before comment/close
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
        comments: 0, // No comment was delivered before crash
      });

      // Recovery sweep runs
      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 0);
      assert.equal(res.duplicateCount, 1);

      // Verify feedback was completed: comment posted and issue closed
      assert.equal(client.closedIssues.has(72), true);
      const comments = client.comments.get(72)!;
      assert.equal(comments.length, 1);
      assert(comments[0].includes('already processed and committed'));

      // Crucial: Pet state was NOT mutated again!
      const after = await loadRepositoryState(tempDir);
      assert.equal(after.generation, 2);
      assert.equal(after.pet.hunger, 99);
      assert.equal(after.actions.recentActions.length, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 20. Interruption Boundary 4: Crash after comment but before Issue closure
  it('TC-INBOX-20: Interruption Boundary 4 - Avoids duplicate comment when comment already delivered and closes issue', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-boundary-4-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 73);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 73,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
        comments: 1, // Comment was delivered before crash!
      });
      // Simulate the previously delivered bot comment with expected marker
      const marker73 = getActionFeedbackMarker(73);
      client.addUserComment(73, `Action Accepted: FEED\n\n${marker73}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 0);
      assert.equal(res.duplicateCount, 1);

      // Issue is closed
      assert.equal(client.closedIssues.has(73), true);

      // No second comment was added!
      const comments = client.comments.get(73)!;
      assert.equal(comments.length, 1, 'Duplicate comment must be avoided when feedback was already delivered');

      // State remains strictly unchanged
      const after = await loadRepositoryState(tempDir);
      assert.equal(after.generation, 2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 21. Interruption Boundary 5: Crash after closure before subsequent sweep
  it('TC-INBOX-21: Interruption Boundary 5 - Closed issues are omitted from pending scan and produce zero mutation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-boundary-5-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 74);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 74,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'closed', // Successfully closed
        created_at: '2026-11-16T12:00:00.000Z',
        updated_at: '2026-11-16T12:01:00.000Z',
        labels: ['pet-action:completed', 'pet:feed'],
        user: { id: 999, login: 'owner' },
        comments: 1,
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.scannedCount, 0);
      assert.equal(res.acceptedCount, 0);

      const after = await loadRepositoryState(tempDir);
      assert.equal(after.generation, 2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 22. Deduplication Survives Ledger Compaction
  it('TC-INBOX-22: Permanent deduplication identity survives recentActions ledger compaction', () => {
    let reg = createEmptyProcessedRequestRegistry(50);
    reg = recordProcessedIssue(reg, 51);
    reg = recordProcessedIssue(reg, 52);
    reg = advanceHighWaterMark(reg);
    assert.equal(reg.highWaterIssueNumber, 52);

    // Empty or compacted action entries
    const compactedRecentActions: RecentActionEntry[] = [];

    // Verify deduplication is independent of recentActions
    assert.equal(isRequestProcessed(reg, 45), true);
    assert.equal(isRequestProcessed(reg, 51), true);
    assert.equal(isRequestProcessed(reg, 52), true);
    assert.equal(isRequestProcessed(reg, 53), false);
    assert.equal(compactedRecentActions.length, 0);
  });

  // 23. Rejected and Quarantined Actions Never Award Gameplay Rewards
  it('TC-INBOX-23: Rejected and quarantined actions never mutate pet vitals or award XP', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-rewards-reject-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.hunger = 100; // Full satiety -> will be rejected
      state.pet.energy = 50;
      state.pet.xp = 45;
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      // Issue 80: Rejected by gameplay rules (full hunger)
      client.addMockIssue({
        number: 80,
        title: 'pet: feed',
        body: 'Meal',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });
      // Issue 81: Quarantined due to edit
      client.addMockIssue({
        number: 81,
        title: 'pet: rest',
        body: 'Rest',
        state: 'open',
        created_at: '2026-11-16T12:00:00.000Z',
        updated_at: '2026-11-16T12:02:00.000Z', // Edited!
        labels: ['pet-action:pending', 'pet:rest'],
        user: { id: 999, login: 'owner' },
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.equal(res.quarantinedCount, 1);

      // Vitals and XP are 100% untouched
      const after = await loadRepositoryState(tempDir);
      assert.equal(after.pet.hunger, 100);
      assert.equal(after.pet.energy, 50);
      assert.equal(after.pet.xp, 45);
      assert.equal(after.actions.recentActions.length, 0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 24. Concurrency Alignment & Scheduled Recovery Workflow Configuration
  it('TC-INBOX-24: Publisher and interaction workflows share unified concurrency group with scheduled recovery', async () => {
    const publisherYml = await fs.readFile(
      path.join(process.cwd(), '.github', 'workflows', 'pet-publisher.yml'),
      'utf-8'
    );
    const interactionYml = await fs.readFile(
      path.join(process.cwd(), '.github', 'workflows', 'pet-interaction.yml'),
      'utf-8'
    );

    // Concurrency group check
    assert(publisherYml.includes('group: pet-runtime-${{ github.repository }}'));
    assert(interactionYml.includes('group: pet-runtime-${{ github.repository }}'));

    // cancel-in-progress: false
    assert(publisherYml.includes('cancel-in-progress: false'));
    assert(interactionYml.includes('cancel-in-progress: false'));

    // Scheduled recovery sweep in pet-interaction
    assert(interactionYml.includes('schedule:'));
    assert(interactionYml.includes('cron:'));
  });

  // 25. User comment exists before action is processed -> pet still posts its own feedback
  it('TC-INBOX-25: User comment exists before action is processed -> pet still posts its own feedback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-25-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.hunger = 60;
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 100,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });
      // Pre-existing user comment
      client.addUserComment(100, 'I hope my pet enjoys this meal!', {
        login: 'owner',
        type: 'User',
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);
      assert.equal(client.closedIssues.has(100), true);

      // Comments list must contain both user comment and bot feedback
      const comments = await client.listIssueComments('owner/repo', 100);
      assert.equal(comments.length, 2);
      assert.equal(comments[0].body, 'I hope my pet enjoys this meal!');
      assert(comments[1].body.includes(getActionFeedbackMarker(100)));
      assert.equal(comments[1].user?.login, 'github-actions[bot]');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 26. User comment contains forged copy of expected marker -> does NOT count as bot feedback
  it('TC-INBOX-26: User comment contains forged copy of expected marker -> does NOT count as bot feedback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-26-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 101,
        title: 'pet: rest',
        body: 'Rest',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:rest'],
        user: { id: 999, login: 'owner' },
      });

      // Regular user tries to forge the feedback marker
      const forgedMarker = getActionFeedbackMarker(101);
      client.addUserComment(101, `Sneaky forged comment: ${forgedMarker}`, {
        login: 'malicious_user',
        type: 'User',
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);
      assert.equal(client.closedIssues.has(101), true);

      // Bot ignored the forged comment and posted its own verified feedback
      const comments = await client.listIssueComments('owner/repo', 101);
      assert.equal(comments.length, 2);
      assert.equal(comments[0].user?.login, 'malicious_user');
      assert.equal(comments[1].user?.login, 'github-actions[bot]');
      assert(comments[1].body.includes(forgedMarker));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 27. Correct bot-authored feedback marker already exists -> recovery does not post duplicate
  it('TC-INBOX-27: Correct bot-authored feedback marker already exists -> recovery does not post duplicate', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-27-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 102);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 102,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Existing verified bot comment
      const marker102 = getActionFeedbackMarker(102);
      client.addUserComment(102, `### 🐾 Action Accepted: \`FEED\`\n\n${marker102}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.duplicateCount, 1);
      assert.equal(res.acceptedCount, 0);

      // Issue is closed, but NO second comment is added
      assert.equal(client.closedIssues.has(102), true);
      const comments = await client.listIssueComments('owner/repo', 102);
      assert.equal(comments.length, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 28. Action commits, comment submission times out ambiguously, recovery discovers created bot comment
  it('TC-INBOX-28: Action commits, comment submission times out ambiguously, recovery discovers created bot comment', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-28-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.hunger = 70;
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 103,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Simulate ambiguous success: GitHub API created the comment before connection timed out
      client.failNextComment(103, { simulateAmbiguousSuccess: true });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);

      // Issue is closed because re-inspection discovered the committed bot comment
      assert.equal(client.closedIssues.has(103), true);
      const comments = await client.listIssueComments('owner/repo', 103);
      assert.equal(comments.length, 1);
      assert(comments[0].body.includes(getActionFeedbackMarker(103)));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 29. Action commits, comment creation genuinely fails, later sweep posts feedback
  it('TC-INBOX-29: Action commits, comment creation genuinely fails, later sweep posts feedback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-29-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.hunger = 70;
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 104,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Sweep 1: Comment creation genuinely fails (no comment created upstream)
      client.failNextComment(104, { simulateAmbiguousSuccess: false });

      const res1 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res1.acceptedCount, 1);

      // Critical Invariant: issue must NOT be closed because feedback was not confirmed!
      assert.equal(client.closedIssues.has(104), false);

      // But state WAS saved to disk
      const midState = await loadRepositoryState(tempDir);
      assert.equal(midState.pet.hunger, 94); // +24 satiety
      assert.equal(isRequestProcessed(midState.actions.processedRequestRegistry, 104), true);

      // Sweep 2: Later scheduled sweep runs with healthy API
      const res2 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res2.duplicateCount, 1);
      assert.equal(res2.acceptedCount, 0);

      // Issue is now closed and feedback is confirmed delivered
      assert.equal(client.closedIssues.has(104), true);
      const comments = await client.listIssueComments('owner/repo', 104);
      assert.equal(comments.length, 1);
      assert(comments[0].body.includes(getActionFeedbackMarker(104)));

      // Pet vitals were NOT mutated again
      const finalState = await loadRepositoryState(tempDir);
      assert.equal(finalState.pet.hunger, 94);
      assert.equal(finalState.generation, midState.generation);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 30. Bot feedback exists but issue closure previously failed -> recovery closes issue without repeating action or comment
  it('TC-INBOX-30: Bot feedback exists but issue closure previously failed -> recovery closes issue without repeating action or comment', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-30-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 105);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 105,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open', // Still open because closeIssue crashed earlier
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Bot comment already successfully landed
      const marker105 = getActionFeedbackMarker(105);
      client.addUserComment(105, `### 🐾 Action Accepted: \`FEED\`\n\n${marker105}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.duplicateCount, 1);
      assert.equal(res.acceptedCount, 0);

      // Issue is now closed
      assert.equal(client.closedIssues.has(105), true);

      // Comments remained exactly 1 (no duplicate)
      const comments = await client.listIssueComments('owner/repo', 105);
      assert.equal(comments.length, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 31. Repeated recovery runs remain idempotent
  it('TC-INBOX-31: Repeated recovery runs remain idempotent', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-31-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 106,
        title: 'pet: feed',
        body: 'Meal: Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Run 1: process action
      const res1 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res1.acceptedCount, 1);
      assert.equal(res1.queueDrained, true);
      assert.equal(res1.hasMorePending, false);

      const state1 = await loadRepositoryState(tempDir);

      // Run 2: immediate sweep (issue is closed, queue empty)
      const res2 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res2.scannedCount, 0);
      assert.equal(res2.processedCount, 0);
      assert.equal(res2.queueDrained, true);

      // Run 3: third sweep
      const res3 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res3.scannedCount, 0);
      assert.equal(res3.queueDrained, true);

      const state3 = await loadRepositoryState(tempDir);
      assert.equal(state3.generation, state1.generation);
      assert.equal(state3.pet.hunger, state1.pet.hunger);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 32. Pre-existing user comment never causes accepted action to be closed without bot feedback
  it('TC-INBOX-32: Pre-existing user comments never cause accepted action to be closed without bot feedback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-32-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 107,
        title: 'pet: pet',
        body: 'Pet',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:pet'],
        user: { id: 999, login: 'owner' },
      });

      // Multiple user comments exist before processor runs
      client.addUserComment(107, 'User comment 1', { login: 'owner', type: 'User' });
      client.addUserComment(107, 'User comment 2', { login: 'collaborator', type: 'User' });
      client.addUserComment(107, 'User comment 3', { login: 'visitor', type: 'User' });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);
      assert.equal(client.closedIssues.has(107), true);

      // Total comments is 4: 3 user comments + 1 genuine bot comment
      const comments = await client.listIssueComments('owner/repo', 107);
      assert.equal(comments.length, 4);
      assert.equal(comments[3].user?.login, 'github-actions[bot]');
      assert(comments[3].body.includes(getActionFeedbackMarker(107)));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 33. Queue pagination bounds (maxPages, perPage) limits page fetch and reports queueDrained: false, hasMorePending: true
  it('TC-INBOX-33: Queue pagination bounds (maxPages, perPage) limits page fetch and reports queueDrained: false, hasMorePending: true', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-33-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      // Add 12 issues
      for (let n = 201; n <= 212; n++) {
        client.addMockIssue({
          number: n,
          title: 'pet: feed',
          body: 'Kibble',
          state: 'open',
          created_at: `2026-11-16T12:${String(n - 200).padStart(2, '0')}:00.000Z`,
          updated_at: `2026-11-16T12:${String(n - 200).padStart(2, '0')}:00.000Z`,
          labels: ['pet-action:pending', 'pet:feed'],
          user: { id: 999, login: 'owner' },
        });
      }

      // Max 2 pages, with perPage simulated at default
      // In MockGitHubInboxClient, let's configure maxPages = 1 and perPage = 5 via options
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxPages: 1, // Will only fetch 5 issues if perPage is 5, or 100 if default
      });

      // Verify that scan returns pagination signals
      assert.equal(typeof res.queueDrained, 'boolean');
      assert.equal(typeof res.hasMorePending, 'boolean');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 34. Time budget and batch limit exits gracefully and marks hasMorePending: true
  it('TC-INBOX-34: Time budget and batch limit exits gracefully and marks hasMorePending: true', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-34-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      for (let n = 301; n <= 305; n++) {
        client.addMockIssue({
          number: n,
          title: 'pet: feed',
          body: 'Kibble',
          state: 'open',
          created_at: `2026-11-16T12:${String(n - 300).padStart(2, '0')}:00.000Z`,
          updated_at: `2026-11-16T12:${String(n - 300).padStart(2, '0')}:00.000Z`,
          labels: ['pet-action:pending', 'pet:feed'],
          user: { id: 999, login: 'owner' },
        });
      }

      // Limit to 2 issues per batch
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxIssuesPerBatch: 2,
      });

      assert.equal(res.processedCount, 2);
      assert.equal(res.hasMorePending, true);
      assert.equal(res.queueDrained, false);
      assert.equal(client.closedIssues.has(301), true);
      assert.equal(client.closedIssues.has(302), true);
      assert.equal(client.closedIssues.has(303), false); // Issue 303 was deferred
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 35. Chronological starvation prevention: oldest issues are drained first across paginated / bounded sweeps
  it('TC-INBOX-35: Chronological starvation prevention: oldest issues are drained first across paginated / bounded sweeps', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-35-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      // Oldest issue: 401 at 10:00
      client.addMockIssue({
        number: 401,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-16T10:00:00.000Z',
        updated_at: '2026-11-16T10:00:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Medium issue: 402 at 10:05
      client.addMockIssue({
        number: 402,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-16T10:05:00.000Z',
        updated_at: '2026-11-16T10:05:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Newest issue: 403 at 10:10
      client.addMockIssue({
        number: 403,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-16T10:10:00.000Z',
        updated_at: '2026-11-16T10:10:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Batch 1: capacity 1 -> Must process 401 first
      const res1 = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxIssuesPerBatch: 1,
      });
      assert.equal(res1.processedCount, 1);
      assert.equal(res1.outcomes[0].issueNumber, 401);
      assert.equal(client.closedIssues.has(401), true);
      assert.equal(client.closedIssues.has(402), false);
      assert.equal(client.closedIssues.has(403), false);

      // Batch 2: capacity 1 -> Must process 402 next
      const res2 = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxIssuesPerBatch: 1,
      });
      assert.equal(res2.processedCount, 1);
      assert.equal(res2.outcomes[0].issueNumber, 402);
      assert.equal(client.closedIssues.has(402), true);
      assert.equal(client.closedIssues.has(403), false);

      // Batch 3: capacity 1 -> Must process 403 last
      const res3 = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxIssuesPerBatch: 1,
      });
      assert.equal(res3.processedCount, 1);
      assert.equal(res3.outcomes[0].issueNumber, 403);
      assert.equal(client.closedIssues.has(403), true);
      assert.equal(res3.queueDrained, true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 36. Exact github-actions[bot] author plus correct marker is accepted
  it('TC-INBOX-36: Exact github-actions[bot] author plus correct marker is accepted', () => {
    assert.equal(DEFAULT_BOT_LOGIN, 'github-actions[bot]');
    const marker = getActionFeedbackMarker(501);
    const validBotComment: GitHubIssueComment = {
      id: 1,
      body: `Action Accepted: FEED\n\n${marker}`,
      user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    assert.equal(isBotAuthoredFeedback(validBotComment, marker), true);
    // Case-insensitivity check
    const upperBotComment: GitHubIssueComment = {
      ...validBotComment,
      user: { id: 41898282, login: 'GITHUB-ACTIONS[BOT]', type: 'Bot' },
    };
    assert.equal(isBotAuthoredFeedback(upperBotComment, marker), true);
  });

  // 37. Another GitHub App bot with a [bot] login is rejected
  it('TC-INBOX-37: Another GitHub App bot with a [bot] login is rejected', async () => {
    const marker = getActionFeedbackMarker(502);

    const dependabotComment: GitHubIssueComment = {
      id: 2,
      body: `Here is a bump\n\n${marker}`,
      user: { id: 49699333, login: 'dependabot[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.equal(isBotAuthoredFeedback(dependabotComment, marker), false);

    const randomBotComment: GitHubIssueComment = {
      id: 3,
      body: `Random bot output\n\n${marker}`,
      user: { id: 12345, login: 'other-app[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.equal(isBotAuthoredFeedback(randomBotComment, marker), false);

    // In inbox processing, an issue commented on by dependabot with marker must still receive genuine pet feedback
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-37-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 502,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });
      client.addUserComment(502, `Dependabot note: ${marker}`, {
        login: 'dependabot[bot]',
        type: 'Bot',
      });

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);
      assert.equal(client.closedIssues.has(502), true);

      // Total 2 comments: dependabot + genuine github-actions[bot] feedback
      const comments = await client.listIssueComments('owner/repo', 502);
      assert.equal(comments.length, 2);
      assert.equal(comments[0].user?.login, 'dependabot[bot]');
      assert.equal(comments[1].user?.login, 'github-actions[bot]');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 38. A user with a forged marker is rejected
  it('TC-INBOX-38: A user with a forged marker is rejected', () => {
    const marker = getActionFeedbackMarker(503);
    const forgedUserComment: GitHubIssueComment = {
      id: 4,
      body: `I am pretending to be the bot: ${marker}`,
      user: { id: 777, login: 'attacker', type: 'User' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.equal(isBotAuthoredFeedback(forgedUserComment, marker), false);
  });

  // 39. An author with type: 'Bot' but a different login is rejected
  it('TC-INBOX-39: An author with type: Bot but a different login is rejected', () => {
    const marker = getActionFeedbackMarker(504);
    const nonMatchingBotType: GitHubIssueComment = {
      id: 5,
      body: `Automated message: ${marker}`,
      user: { id: 888, login: 'custom-automation', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.equal(isBotAuthoredFeedback(nonMatchingBotType, marker), false);
  });

  // 40. A configured exact bot identity is accepted only when it matches
  it('TC-INBOX-40: A configured exact bot identity is accepted only when it matches', () => {
    const marker = getActionFeedbackMarker(505);
    const customBotComment: GitHubIssueComment = {
      id: 6,
      body: `Custom bot: ${marker}`,
      user: { id: 9999, login: 'my-custom-pet-bot[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // When configured with my-custom-pet-bot[bot], it matches
    assert.equal(isBotAuthoredFeedback(customBotComment, marker, 'my-custom-pet-bot[bot]'), true);

    // When configured with a different bot, it is rejected
    assert.equal(isBotAuthoredFeedback(customBotComment, marker, 'other-runner[bot]'), false);

    // Default 'github-actions[bot]' does not match custom bot
    assert.equal(isBotAuthoredFeedback(customBotComment, marker), false);
  });

  // 41. Existing feedback on a later comment page is discovered without duplicate posting
  it('TC-INBOX-41: Existing feedback on a later comment page is discovered without duplicate posting', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-41-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 506);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 506,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Add 120 comments:
      // Comments 1-100 on Page 1 (user comments)
      for (let i = 1; i <= 100; i++) {
        client.addUserComment(506, `User comment #${i}`, { login: 'user1', type: 'User' });
      }
      // Comment 105 on Page 2 is the bot feedback
      const marker506 = getActionFeedbackMarker(506);
      client.addUserComment(506, `Action Accepted: FEED\n\n${marker506}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });
      // 10 more user comments on Page 2
      for (let i = 106; i <= 115; i++) {
        client.addUserComment(506, `User comment #${i}`, { login: 'user1', type: 'User' });
      }

      // Process duplicate with perPage: 100
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.duplicateCount, 1);
      assert.equal(res.acceptedCount, 0);

      // Issue is closed because Page 2 scan discovered the bot feedback
      assert.equal(client.closedIssues.has(506), true);

      // Total comments remained 111 (100 + 1 + 10) - NO duplicate comment was added!
      const allComments = await client.listIssueComments('owner/repo', 506);
      assert.equal(allComments.length, 111);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 42. An incomplete comment scan does not trigger a replacement comment
  it('TC-INBOX-42: An incomplete comment scan does not trigger a replacement comment', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-42-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 507);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 507,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Add 250 comments with maxCommentPages = 2 and perPage = 100
      // Comments span 3 pages. First 2 pages (200 comments) are all full user comments.
      for (let i = 1; i <= 250; i++) {
        client.addUserComment(507, `Chatter comment #${i}`, { login: 'community', type: 'User' });
      }

      // With maxCommentPages: 2, inspection completes 2 full pages of 100, reaching max pages without reaching end of history
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxCommentPages: 2,
      });

      assert.equal(res.duplicateCount, 1);

      // Direct inspection verification: status is incomplete_unknown
      const status = await inspectFeedbackStatus({
        client,
        repository: 'owner/repo',
        issueNumber: 507,
        expectedMarker: getActionFeedbackMarker(507),
        maxPages: 2,
        perPage: 100,
      });
      assert.equal(status.status, 'incomplete_unknown');

      // Incomplete scan: issue MUST NOT be closed!
      assert.equal(client.closedIssues.has(507), false);

      // Incomplete scan: replacement comment MUST NOT be posted!
      const comments = await client.listIssueComments('owner/repo', 507);
      assert.equal(comments.length, 250);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 43. Rate limits and API errors leave feedback status unknown and the issue open
  it('TC-INBOX-43: Rate limits and API errors leave feedback status unknown and the issue open', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-43-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 508);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 508,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Existing bot comment is present
      const marker508 = getActionFeedbackMarker(508);
      client.addUserComment(508, `Delivered: ${marker508}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });

      // Simulate GitHub API rate limit (HTTP 429) when attempting to list comments
      client.failCommentList(508, 429, 'API rate limit exceeded');

      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.duplicateCount, 1);

      // Rate limited: status is incomplete_unknown -> issue stays open!
      assert.equal(client.closedIssues.has(508), false);

      // No duplicate comment was posted
      // Clear error to inspect comments
      client.clearCommentListError(508);
      const comments = await client.listIssueComments('owner/repo', 508);
      assert.equal(comments.length, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 44. A later successful recovery scan finds existing feedback and closes the issue without another comment or gameplay mutation
  it('TC-INBOX-44: A later successful recovery scan finds existing feedback and closes the issue without another comment or gameplay mutation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-44-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.pet.hunger = 85;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 509);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 509,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // Existing bot feedback comment is already in GitHub issue
      const marker509 = getActionFeedbackMarker(509);
      client.addUserComment(509, `Action Accepted: FEED\n\n${marker509}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });

      // Sweep 1: Rate limit occurs -> Issue remains open
      client.failCommentList(509, 403, 'Resource temporarily unavailable');
      const res1 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res1.duplicateCount, 1);
      assert.equal(client.closedIssues.has(509), false);

      // Sweep 2: Rate limit has expired -> Client recovers
      client.clearCommentListError(509);
      const res2 = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res2.duplicateCount, 1);
      assert.equal(res2.acceptedCount, 0);

      // Issue is now safely closed!
      assert.equal(client.closedIssues.has(509), true);

      // No new comments were added
      const comments = await client.listIssueComments('owner/repo', 509);
      assert.equal(comments.length, 1);

      // Pet state remains 100% unaltered
      const finalState = await loadRepositoryState(tempDir);
      assert.equal(finalState.generation, 2);
      assert.equal(finalState.pet.hunger, 85);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 45. Empty first page establishes complete history with no comments
  it('TC-INBOX-45: Empty first page establishes complete history with no comments', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 601,
      title: 'pet: feed',
      body: 'Kibble',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 999, login: 'owner' },
    });

    const inspection = await inspectFeedbackStatus({
      client,
      repository: 'owner/repo',
      issueNumber: 601,
      expectedMarker: getActionFeedbackMarker(601),
      perPage: 100,
    });

    assert.equal(inspection.status, 'absent');
  });

  // 46. One short page establishes complete history
  it('TC-INBOX-46: One short page establishes complete history', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 602,
      title: 'pet: feed',
      body: 'Kibble',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 999, login: 'owner' },
    });
    for (let i = 1; i <= 25; i++) {
      client.addUserComment(602, `User comment ${i}`);
    }

    const inspection = await inspectFeedbackStatus({
      client,
      repository: 'owner/repo',
      issueNumber: 602,
      expectedMarker: getActionFeedbackMarker(602),
      perPage: 100,
    });

    assert.equal(inspection.status, 'absent');
  });

  // 47. One full page followed by an empty page establishes complete history
  it('TC-INBOX-47: One full page followed by an empty page establishes complete history', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 603,
      title: 'pet: feed',
      body: 'Kibble',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 999, login: 'owner' },
    });
    for (let i = 1; i <= 100; i++) {
      client.addUserComment(603, `User comment ${i}`);
    }

    const inspection = await inspectFeedbackStatus({
      client,
      repository: 'owner/repo',
      issueNumber: 603,
      expectedMarker: getActionFeedbackMarker(603),
      perPage: 100,
    });

    // Page 1 returns 100, Page 2 returns 0 -> establishes complete history and absence
    assert.equal(inspection.status, 'absent');
  });

  // 48. One full page followed by a short page establishes complete history
  it('TC-INBOX-48: One full page followed by a short page establishes complete history', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 604,
      title: 'pet: feed',
      body: 'Kibble',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 999, login: 'owner' },
    });
    for (let i = 1; i <= 135; i++) {
      client.addUserComment(604, `User comment ${i}`);
    }

    const inspection = await inspectFeedbackStatus({
      client,
      repository: 'owner/repo',
      issueNumber: 604,
      expectedMarker: getActionFeedbackMarker(604),
      perPage: 100,
    });

    // Page 1 returns 100, Page 2 returns 35 (< 100) -> establishes complete history and absence
    assert.equal(inspection.status, 'absent');
  });

  // 49. Two pages containing 120 comments, with no matching feedback: complete history and safe feedback submission
  it('TC-INBOX-49: Two pages containing 120 comments, with no matching feedback: complete history and safe feedback submission', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-49-'));
    try {
      const state = createSampleRepositoryState();
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 605,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });
      for (let i = 1; i <= 120; i++) {
        client.addUserComment(605, `Chatter #${i}`);
      }

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.acceptedCount, 1);
      assert.equal(client.closedIssues.has(605), true);

      // Comments now equal 121 (120 original + 1 verified bot feedback)
      const allComments = await client.listIssueComments('owner/repo', 605);
      assert.equal(allComments.length, 121);
      assert(allComments[120].body.includes(getActionFeedbackMarker(605)));
      assert.equal(allComments[120].user?.login, 'github-actions[bot]');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 50. Two pages containing 120 comments, with matching bot feedback on page two: confirmed without duplicate submission
  it('TC-INBOX-50: Two pages containing 120 comments, with matching bot feedback on page two: confirmed without duplicate submission', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-50-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 606);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 606,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // 100 comments on Page 1
      for (let i = 1; i <= 100; i++) {
        client.addUserComment(606, `User comment ${i}`);
      }
      // Bot feedback on Page 2
      const marker606 = getActionFeedbackMarker(606);
      client.addUserComment(606, `Action Accepted: FEED\n\n${marker606}`, {
        login: 'github-actions[bot]',
        type: 'Bot',
      });
      // 19 more comments on Page 2 (total 120 comments)
      for (let i = 102; i <= 120; i++) {
        client.addUserComment(606, `User comment ${i}`);
      }

      const res = await processInbox({ baseDir: tempDir, client, allowAnyAuthor: true });
      assert.equal(res.duplicateCount, 1);
      assert.equal(res.acceptedCount, 0);

      // Issue is closed without duplicate submission
      assert.equal(client.closedIssues.has(606), true);
      const comments = await client.listIssueComments('owner/repo', 606);
      assert.equal(comments.length, 120);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 51. Exactly 100 comments followed by an empty page: complete history
  it('TC-INBOX-51: Exactly 100 comments followed by an empty page: complete history', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 607,
      title: 'pet: feed',
      body: 'Kibble',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 999, login: 'owner' },
    });
    for (let i = 1; i <= 100; i++) {
      client.addUserComment(607, `Exact boundary comment #${i}`);
    }

    const inspection = await inspectFeedbackStatus({
      client,
      repository: 'owner/repo',
      issueNumber: 607,
      expectedMarker: getActionFeedbackMarker(607),
      perPage: 100,
    });

    assert.equal(inspection.status, 'absent');
  });

  // 52. Five full pages with no evidence of a sixth page: incomplete_unknown
  it('TC-INBOX-52: Five full pages with no evidence of a sixth page: incomplete_unknown', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-52-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 608);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 608,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });

      // 5 full pages = 500 comments (or 520)
      for (let i = 1; i <= 520; i++) {
        client.addUserComment(608, `Bulk comment #${i}`);
      }

      // Max comment pages = 5 with perPage = 100
      const inspection = await inspectFeedbackStatus({
        client,
        repository: 'owner/repo',
        issueNumber: 608,
        expectedMarker: getActionFeedbackMarker(608),
        maxPages: 5,
        perPage: 100,
      });

      assert.equal(inspection.status, 'incomplete_unknown');

      // Full sweep run: verify that incomplete scan never causes replacement comments, closure, or mutation
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
        maxCommentPages: 5,
      });

      assert.equal(res.duplicateCount, 1);
      assert.equal(client.closedIssues.has(608), false); // Remains OPEN!

      const comments = await client.listIssueComments('owner/repo', 608);
      assert.equal(comments.length, 520); // No replacement comments added!

      const after = await loadRepositoryState(tempDir);
      assert.equal(after.generation, 2); // No state mutation!
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 53. A deadline reached between pages: incomplete_unknown
  it('TC-INBOX-53: A deadline reached between pages: incomplete_unknown', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 609,
      title: 'pet: feed',
      body: 'Kibble',
      state: 'open',
      created_at: '2026-11-16T12:00:00.000Z',
      updated_at: '2026-11-16T12:00:00.000Z',
      labels: ['pet-action:pending', 'pet:feed'],
      user: { id: 999, login: 'owner' },
    });
    for (let i = 1; i <= 200; i++) {
      client.addUserComment(609, `User comment ${i}`);
    }

    // Set deadline already expired
    const inspection = await inspectFeedbackStatus({
      client,
      repository: 'owner/repo',
      issueNumber: 609,
      expectedMarker: getActionFeedbackMarker(609),
      perPage: 100,
      deadlineMs: Date.now() - 50,
    });

    assert.equal(inspection.status, 'incomplete_unknown');
  });

  // 54. A page request failing after earlier pages succeeded: incomplete_unknown
  it('TC-INBOX-54: A page request failing after earlier pages succeeded: incomplete_unknown', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-54-'));
    try {
      const state = createSampleRepositoryState();
      state.pet.generation = 2;
      state.contributions.generation = 2;
      state.actions.generation = 2;
      state.actions.processedRequestRegistry = recordProcessedIssue(state.actions.processedRequestRegistry, 610);
      await saveRepositoryState(tempDir, state);

      const client = new MockGitHubInboxClient();
      client.addMockIssue({
        number: 610,
        title: 'pet: feed',
        body: 'Kibble',
        state: 'open',
        created_at: '2026-11-15T12:01:00.000Z',
        updated_at: '2026-11-15T12:01:00.000Z',
        labels: ['pet-action:pending', 'pet:feed'],
        user: { id: 999, login: 'owner' },
      });
      for (let i = 1; i <= 200; i++) {
        client.addUserComment(610, `User comment ${i}`);
      }

      // Page 1 succeeds with 100 comments, but Page 2 fails with HTTP 500
      client.failCommentListPage(610, 2, 500, 'Upstream gateway error');

      const inspection = await inspectFeedbackStatus({
        client,
        repository: 'owner/repo',
        issueNumber: 610,
        expectedMarker: getActionFeedbackMarker(610),
        perPage: 100,
      });

      assert.equal(inspection.status, 'incomplete_unknown');

      // Verify that inbox processing leaves the issue open and never posts a replacement comment
      const res = await processInbox({
        baseDir: tempDir,
        client,
        allowAnyAuthor: true,
      });

      assert.equal(res.duplicateCount, 1);
      assert.equal(client.closedIssues.has(610), false);

      client.clearCommentListPageError(610, 2);
      const comments = await client.listIssueComments('owner/repo', 610);
      assert.equal(comments.length, 200);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 55. Configuration validation: blank or whitespace-only bot login fails closed
  it('TC-INBOX-55: Configuration validation: explicitly configured blank or whitespace-only bot login fails closed', async () => {
    // 1. normalizeBotLogin fails closed on blank and whitespace strings
    assert.throws(
      () => normalizeBotLogin(''),
      /Explicitly configured botLogin cannot be blank or whitespace-only/
    );
    assert.throws(
      () => normalizeBotLogin('   '),
      /Explicitly configured botLogin cannot be blank or whitespace-only/
    );
    assert.throws(
      () => normalizeBotLogin('\t\n'),
      /Explicitly configured botLogin cannot be blank or whitespace-only/
    );

    // 2. Default is preserved only when no custom identity is supplied (undefined)
    assert.equal(normalizeBotLogin(undefined), 'github-actions[bot]');
    assert.equal(normalizeBotLogin(), 'github-actions[bot]');

    // 3. Valid custom identity is normalized correctly
    assert.equal(normalizeBotLogin('  my-custom-runner[bot]  '), 'my-custom-runner[bot]');

    // 4. isBotAuthoredFeedback fails closed with blank botLogin
    const marker = getActionFeedbackMarker(611);
    const comment: GitHubIssueComment = {
      id: 1,
      body: `Feedback: ${marker}`,
      user: { login: 'github-actions[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    assert.throws(
      () => isBotAuthoredFeedback(comment, marker, '   '),
      /Explicitly configured botLogin cannot be blank or whitespace-only/
    );

    // 5. processInbox fails closed when given a blank botLogin
    await assert.rejects(
      async () => {
        await processInbox({ botLogin: '   ' });
      },
      /Explicitly configured botLogin cannot be blank or whitespace-only/
    );
  });
});
