/**
 * GitHub Profile Pet — Durable Feedback Completion & Compaction Tests (Phase 3C2.3-B0.1)
 *
 * Verifies findings F-B0-01 (High) and F-B0-02 (Medium):
 * Part 1: Feedback Completion and Crash Recovery (Tests 1–15)
 * Part 2: Retention and Compaction (Tests 16–28)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  executeInboxPublicationPipeline,
} from '../../src/features/pet-engine/publication/inboxPublicationPipeline.ts';
import {
  PUBLICATION_MANIFEST_PATHS,
} from '../../src/features/pet-engine/publication/publishPipeline.ts';
import {
  deliverPendingFeedback,
  compactPendingFeedback,
  isFeedbackRecordEligibleForPruning,
  FEEDBACK_RETENTION_PERIOD_MS,
} from '../../src/features/pet-engine/inbox/actionProcessor.ts';
import {
  loadRepositoryState,
  saveRepositoryState,
  getStatePaths,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import { atomicWriteFile } from '../../src/features/pet-engine/persistence/atomicFileWriter.ts';
import { isValidIsoDateString } from '../../src/features/pet-engine/validation/stateValidator.ts';
import { isRequestProcessed } from '../../src/features/pet-engine/accounting/deduplicationRegistry.ts';
import type {
  ActionFeedbackRecord,
  ActionLedgerDocument,
  ContributionLedgerDocument,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import type {
  GitHubInboxClient,
  GitHubIssue,
  GitHubIssueComment,
  PendingIssuesPageResult,
} from '../../src/features/pet-engine/inbox/types.ts';

const execFileAsync = promisify(execFile);

async function git(
  args: string[],
  cwd: string,
  env: Record<string, string | undefined> = {}
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'github-actions[bot]',
      GIT_AUTHOR_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      GIT_COMMITTER_NAME: 'github-actions[bot]',
      GIT_COMMITTER_EMAIL: '41898282+github-actions[bot]@users.noreply.github.com',
      ...env,
    } as NodeJS.ProcessEnv,
  });
}

function createInitialPetState(generation: number = 1): PetStateDocument {
  return {
    schemaVersion: 1,
    generation,
    name: 'Shadow Claw',
    species: 'cat',
    level: 1,
    xp: 0,
    maxExp: 100,
    energy: 100,
    energyAccumulator: 0,
    hunger: 50,
    hungerDecayAccumulator: 0,
    happiness: 50,
    happinessDecayAccumulator: 0,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-15T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T00:00:00.000Z',
    lastSimulatedAt: '2026-11-15T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T00:00:00.000Z',
  };
}

function createPristineContributionLedger(generation: number = 1): ContributionLedgerDocument {
  return {
    schemaVersion: 1,
    generation,
    monotonicPublicHwm: 0,
    dailyAccruedXp: {},
    hourlySliceUsage: {},
    slices: [],
    monthlyHistoricalSummary: [],
  };
}

function createInitialActionLedger(generation: number = 1): ActionLedgerDocument {
  return {
    schemaVersion: 1,
    generation,
    recentActions: [],
    processedRequestRegistry: {
      highWaterIssueNumber: 0,
      sparseProcessedIssueNumbers: [],
      retiredNonActionGaps: [],
      unresolvedGaps: [],
    },
    pendingFeedback: [],
  };
}

class MockGitHubClient implements GitHubInboxClient {
  public issues: Map<number, GitHubIssue> = new Map();
  public comments: Map<number, string[]> = new Map();
  public commentsList: Map<number, GitHubIssueComment[]> = new Map();
  public closedIssues: Set<number> = new Set();
  public shouldFailComment = false;
  public commentTimeoutWithServerSuccess = false;
  public shouldFailClose = false;
  public commentListCallCount = 0;
  public closeIssueCallCount = 0;
  public paginationIncomplete = false;

  addMockIssue(issue: GitHubIssue): void {
    this.issues.set(issue.number, issue);
  }

  async listIssueComments(
    _repo: string,
    issueNumber: number,
    options?: { page?: number; perPage?: number }
  ): Promise<GitHubIssueComment[]> {
    this.commentListCallCount++;
    if (this.paginationIncomplete) {
      throw new Error('API Rate limit / Network failure during comment inspection');
    }
    const all = this.commentsList.get(issueNumber) ?? [];
    if (!options?.page && !options?.perPage) {
      return [...all];
    }
    const perPage = options?.perPage ?? 100;
    const page = options?.page ?? 1;
    const start = (page - 1) * perPage;
    return all.slice(start, start + perPage);
  }

  async listPendingIssues(
    _repo: string,
    _options?: { page?: number; perPage?: number; maxPages?: number }
  ): Promise<PendingIssuesPageResult> {
    void _repo;
    void _options;
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
    list.sort((a, b) => a.number - b.number);
    return { issues: list, hasMore: false, pageCount: 1 };
  }

  async commentIssue(_repo: string, issueNumber: number, comment: string): Promise<void> {
    if (this.shouldFailComment) {
      throw new Error('Simulated GitHub Comment API failure');
    }
    if (!this.comments.has(issueNumber)) {
      this.comments.set(issueNumber, []);
    }
    this.comments.get(issueNumber)!.push(comment);
    if (!this.commentsList.has(issueNumber)) {
      this.commentsList.set(issueNumber, []);
    }
    this.commentsList.get(issueNumber)!.push({
      id: Math.floor(Math.random() * 100000),
      body: comment,
      user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (this.commentTimeoutWithServerSuccess) {
      throw new Error('ETIMEDOUT: Connection timed out after server accepted comment');
    }
  }

  async closeIssue(_repo: string, issueNumber: number, labelToAdd?: string): Promise<void> {
    this.closeIssueCallCount++;
    if (this.shouldFailClose) {
      throw new Error('Simulated GitHub Close Issue API failure');
    }
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
    if (this.issues.has(issueNumber)) {
      const issue = this.issues.get(issueNumber)!;
      for (const lbl of labels) {
        if (!issue.labels.some((l) => (typeof l === 'string' ? l : l.name) === lbl)) {
          issue.labels.push({ name: lbl });
        }
      }
    }
  }

  async removeLabel(_repo: string, issueNumber: number, label: string): Promise<void> {
    if (this.issues.has(issueNumber)) {
      const issue = this.issues.get(issueNumber)!;
      issue.labels = issue.labels.filter((l) => (typeof l === 'string' ? l : l.name) !== label);
    }
  }

  async getIssue(_repo: string, issueNumber: number): Promise<{ status: number; issue?: GitHubIssue }> {
    const issue = this.issues.get(issueNumber);
    if (!issue) return { status: 404 };
    return { status: 200, issue };
  }
}

describe('Phase 3C2.3-B0.1: Durable Feedback Completion & Compaction Suite', () => {
  let tempBaseDir: string;
  let remoteRepoDir: string;
  let workRepoDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-b01-test-'));
    remoteRepoDir = path.join(tempBaseDir, 'remote.git');
    workRepoDir = path.join(tempBaseDir, 'work');

    await fs.mkdir(remoteRepoDir, { recursive: true });
    await fs.mkdir(workRepoDir, { recursive: true });

    await git(['init', '--bare', '--initial-branch=main', remoteRepoDir], tempBaseDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remoteRepoDir);

    await git(['init', '-b', 'main', workRepoDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], workRepoDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], workRepoDir);
    await git(['remote', 'add', 'origin', remoteRepoDir], workRepoDir);

    await saveRepositoryState(workRepoDir, {
      pet: createInitialPetState(1),
      contributions: createPristineContributionLedger(1),
      actions: createInitialActionLedger(1),
    });

    const publicDir = path.join(workRepoDir, 'public');
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(path.join(publicDir, 'pet.svg'), '<svg>Initial</svg>', 'utf-8');

    const readmeContent = [
      '# My Profile',
      '<!-- START_SECTION:profile-pet -->',
      '<img src="public/pet.svg" alt="Pet Badge" />',
      '<!-- END_SECTION:profile-pet -->',
    ].join('\n');
    await fs.writeFile(path.join(workRepoDir, 'README.md'), readmeContent, 'utf-8');

    await fs.writeFile(
      path.join(workRepoDir, '.gitignore'),
      '/pet/.journal/\n/pet/.lock\n*.tmp\n',
      'utf-8'
    );

    await git(['add', ...PUBLICATION_MANIFEST_PATHS, '.gitignore'], workRepoDir);
    await git(['commit', '-m', 'Initial setup'], workRepoDir);
    await git(['push', '-u', 'origin', 'main'], workRepoDir);
  });

  afterEach(async () => {
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // Part 1: Feedback Completion and Crash Recovery (Tests 1–15)
  // =========================================================================

  it('TC-INBOX-COMPL-01: Successful comment delivery and issue closure result in durably persisted feedbackDelivered: true', async () => {
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 1,
      title: 'pet: feed',
      body: 'Feed pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');

    // Load state fresh from disk to verify durable persistence
    const state = await loadRepositoryState(workRepoDir);
    assert.ok(state.actions.pendingFeedback);
    assert.equal(state.actions.pendingFeedback.length, 1);
    const rec = state.actions.pendingFeedback[0];
    assert.equal(rec.issueNumber, 1);
    assert.equal(rec.feedbackDelivered, true);
    assert.equal(rec.closureConfirmed, true);
    assert.ok(rec.deliveredAt);

    // Verify remote branch contains this commit
    const remoteHead = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteHead, result.commitSha);
  });

  it('TC-INBOX-COMPL-02: A new run loads the persisted completion state and does not repeatedly inspect comments for that record', async () => {
    // Run 1: Deliver and durably persist completion
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 2,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
    });

    const countAfterRun1 = client.commentListCallCount;

    // Run 2: Scheduled sweep with no new actions
    const sweepResult = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T11:00:00.000Z'),
    });

    assert.equal(sweepResult.status, 'noop');
    // Because feedbackDelivered: true was persisted, deliverPendingFeedback filtered it out!
    assert.equal(client.commentListCallCount, countAfterRun1, 'Did not make redundant listIssueComments calls');
  });

  it('TC-INBOX-COMPL-03: Crash after comment creation but before local completion persistence', async () => {
    // Seed state with pendingFeedback where feedbackDelivered: false
    const state = await loadRepositoryState(workRepoDir);
    state.actions.pendingFeedback = [
      {
        issueNumber: 3,
        requestId: 'issue-3',
        actionType: 'feed',
        status: 'accepted',
        generation: 1,
        completedAt: '2026-11-16T10:00:00.000Z',
        feedbackDelivered: false,
        feedbackMarker: '<!-- pet-action-feedback:issue-3 -->',
        feedbackBody: 'Feed comment\n\n<!-- pet-action-feedback:issue-3 -->',
        targetLabel: 'pet-action:completed',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    // Comment exists on GitHub from interrupted previous run
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 3,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    client.commentsList.set(3, [
      {
        id: 3001,
        body: 'Feed comment\n\n<!-- pet-action-feedback:issue-3 -->',
        user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
        created_at: '2026-11-16T10:01:00.000Z',
        updated_at: '2026-11-16T10:01:00.000Z',
      },
    ]);
    client.comments.set(3, ['Feed comment\n\n<!-- pet-action-feedback:issue-3 -->']);

    // Next run executes recovery sweep
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T11:00:00.000Z'),
    });

    assert.equal(result.success, true);
    // Verified: No duplicate comment created!
    assert.equal(client.comments.get(3)?.length, 1);
    // Issue closed
    assert.ok(client.closedIssues.has(3));
    // Completion durably saved
    const updated = await loadRepositoryState(workRepoDir);
    assert.equal(updated.actions.pendingFeedback?.[0].feedbackDelivered, true);
  });

  it('TC-INBOX-COMPL-04: Comment accepted by GitHub but client receives a timeout', async () => {
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 4,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Simulate timeout after server creates comment
    client.commentTimeoutWithServerSuccess = true;

    // Run pipeline: comment fails locally with timeout, but deliverFeedbackWithConfirmation re-checks
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
    });

    assert.equal(result.success, true);
    // Comment was preserved without duplicates
    assert.equal(client.comments.get(4)?.length, 1);
    assert.ok(client.closedIssues.has(4));
    const state = await loadRepositoryState(workRepoDir);
    assert.equal(state.actions.pendingFeedback?.[0].feedbackDelivered, true);
  });

  it('TC-INBOX-COMPL-05: Crash after issue closure but before completion persistence', async () => {
    // Seed record with feedbackDelivered: false
    const state = await loadRepositoryState(workRepoDir);
    state.actions.pendingFeedback = [
      {
        issueNumber: 5,
        requestId: 'issue-5',
        actionType: 'feed',
        status: 'accepted',
        generation: 1,
        completedAt: '2026-11-16T10:00:00.000Z',
        feedbackDelivered: false,
        feedbackMarker: '<!-- pet-action-feedback:issue-5 -->',
        feedbackBody: 'Feed comment\n\n<!-- pet-action-feedback:issue-5 -->',
        targetLabel: 'pet-action:completed',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    // GitHub already has comment AND issue is already closed
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 5,
      title: 'pet: feed',
      body: 'Feed',
      state: 'closed',
      labels: [{ name: 'pet-action:completed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    client.closedIssues.add(5);
    client.commentsList.set(5, [
      {
        id: 5001,
        body: 'Feed comment\n\n<!-- pet-action-feedback:issue-5 -->',
        user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
        created_at: '2026-11-16T10:01:00.000Z',
        updated_at: '2026-11-16T10:01:00.000Z',
      },
    ]);
    client.comments.set(5, ['Feed comment\n\n<!-- pet-action-feedback:issue-5 -->']);

    // Next sweep reconciles and persists completion
    const sweep = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T11:00:00.000Z'),
    });

    assert.equal(sweep.success, true);
    assert.equal(client.comments.get(5)?.length, 1);
    const updated = await loadRepositoryState(workRepoDir);
    assert.equal(updated.actions.pendingFeedback?.[0].feedbackDelivered, true);
    assert.equal(updated.actions.pendingFeedback?.[0].closureConfirmed, true);
  });

  it('TC-INBOX-COMPL-06: Recovery of a closed issue with outstanding feedback', async () => {
    // Issue #6 was closed externally before bot delivered feedback
    const state = await loadRepositoryState(workRepoDir);
    state.actions.pendingFeedback = [
      {
        issueNumber: 6,
        requestId: 'issue-6',
        actionType: 'feed',
        status: 'accepted',
        generation: 1,
        completedAt: '2026-11-16T10:00:00.000Z',
        feedbackDelivered: false,
        feedbackMarker: '<!-- pet-action-feedback:issue-6 -->',
        feedbackBody: 'Feed completed\n\n<!-- pet-action-feedback:issue-6 -->',
        targetLabel: 'pet-action:completed',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 6,
      title: 'pet: feed',
      body: 'Feed',
      state: 'closed', // already closed
      labels: [],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Run sweep: discovers record from pendingFeedback (not dependent on open scan)
    const sweep = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T11:00:00.000Z'),
    });

    assert.equal(sweep.success, true);
    // Comment was delivered to closed issue!
    assert.equal(client.comments.get(6)?.length, 1);
    const updated = await loadRepositoryState(workRepoDir);
    assert.equal(updated.actions.pendingFeedback?.[0].feedbackDelivered, true);
    assert.equal(updated.actions.pendingFeedback?.[0].closureConfirmed, true);
  });

  it('TC-INBOX-COMPL-07: Crash during the journal transaction that persists completion', async () => {
    const paths = getStatePaths(workRepoDir);
    // Create uncommitted staged journal preparing state
    await fs.mkdir(paths.journalTargetDir, { recursive: true });
    await fs.mkdir(paths.journalSourceDir, { recursive: true });
    const meta = {
      sourceGeneration: 1,
      targetGeneration: 1,
      status: 'preparing',
      timestamp: new Date().toISOString(),
    };
    await atomicWriteFile(paths.journalMetaPath, JSON.stringify(meta));

    // Recovery runs on startup, rolls back incomplete journal, and proceeds cleanly
    const client = new MockGitHubClient();
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(result.success, true);
    // Working tree is clean
    const status = await git(['status', '--porcelain'], workRepoDir);
    assert.equal(status.stdout.trim(), '');
  });

  it('TC-INBOX-COMPL-08: Crash after local completion persistence but before Git commit', async () => {
    // Pre-seed remote with pending feedback (feedbackDelivered: false)
    const state = await loadRepositoryState(workRepoDir);
    state.actions.pendingFeedback = [
      {
        issueNumber: 8,
        requestId: 'issue-8',
        actionType: 'feed',
        status: 'accepted',
        generation: 1,
        completedAt: '2026-11-16T10:00:00.000Z',
        feedbackDelivered: false,
        feedbackMarker: '<!-- pet-action-feedback:issue-8 -->',
        feedbackBody: 'Feed comment\n\n<!-- pet-action-feedback:issue-8 -->',
        targetLabel: 'pet-action:completed',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    // Simulate local completion persistence right before crash (uncommitted to Git)
    state.actions.pendingFeedback[0].feedbackDelivered = true;
    await saveRepositoryState(workRepoDir, state);

    // Ephemeral runner dies, so next run starts from fresh remote checkout (discarding uncommitted local file)
    await git(['checkout', '--', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);

    const client = new MockGitHubClient();
    // Next sweep re-discovers from remote state and completes cleanly
    const sweep = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });
    assert.equal(sweep.success, true);
  });

  it('TC-INBOX-COMPL-09: Crash after Git commit but before push', async () => {
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 9,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Run with skipPush to simulate crash right after commit
    const dryRes = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      skipPush: true,
    });

    assert.equal(dryRes.status, 'committed_dry_run');
    assert.ok(dryRes.commitSha);

    // Remote was NOT updated
    const remoteHeadBefore = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    assert.notEqual(remoteHeadBefore, dryRes.commitSha);

    // Fresh clone/run resets to remote HEAD and evaluates cleanly
    await git(['reset', '--hard', 'origin/main'], workRepoDir);

    const publishRes = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(publishRes.status, 'published');
    const remoteHeadAfter = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteHeadAfter, publishRes.commitSha);
  });

  it('TC-INBOX-COMPL-10: Remote accepts completion push but client receives ambiguous network failure (ECONNRESET injection)', async () => {
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 10,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    let pushCount = 0;
    let pushFailedWithEconnreset = false;

    // Custom gitExecutor simulating transport failure specifically after Phase 2 push updates remote
    const faultInjectingGitExecutor = async (_cmd: string, args: string[], cwd: string) => {
      if (args[0] === 'push') {
        pushCount++;
        if (pushCount === 2) {
          // Phase 2 push:
          // Step 3: Allow the Git push to reach the bare remote and successfully advance the remote target branch
          await git(args, cwd);
          // Step 4: After remote ref has advanced, report transport failure (ECONNRESET) to local pipeline
          pushFailedWithEconnreset = true;
          const networkErr = new Error('fatal: unable to access: Connection reset by peer (ECONNRESET)');
          (networkErr as unknown as { stderr: string }).stderr =
            'fatal: unable to access: Connection reset by peer (ECONNRESET)';
          throw networkErr;
        }
      }
      return git(args, cwd);
    };

    // Run 1: Care action processed, Phase 1 push succeeds, Phase 2 feedback delivered,
    // Phase 2 push advances remote, but local pipeline receives ECONNRESET.
    const res1 = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
      gitExecutor: faultInjectingGitExecutor,
    });

    assert.equal(pushFailedWithEconnreset, true, 'Fault injection must have triggered on Phase 2 push');
    // Step 5: Verify local pipeline handled ambiguous result according to rollback rules:
    // Phase 1 succeeded, so pipeline returns published status for Phase 1
    assert.equal(res1.status, 'published');
    assert.equal(res1.success, true);

    // Verify remote branch contains Phase 2 completion commit
    const remoteHeadSha = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    // Verify local working tree rolled back Phase 2 unconfirmed push to Phase 1 commit
    const localHeadSha = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.notEqual(remoteHeadSha, localHeadSha, 'Local HEAD was rolled back to Phase 1 commit on push error');

    // Step 6: Start a fresh pipeline invocation from the authoritative remote state
    // (Simulating next runner checking out authoritative remote branch)
    await git(['fetch', 'origin', 'main'], workRepoDir);
    await git(['reset', '--hard', 'origin/main'], workRepoDir);

    const freshHeadSha = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(freshHeadSha, remoteHeadSha, 'Fresh run checks out authoritative remote HEAD');

    // Verify remote actions.json records
    const remoteState = await loadRepositoryState(workRepoDir);
    assert.equal(remoteState.actions.pendingFeedback?.length, 1);
    const completedRecord = remoteState.actions.pendingFeedback?.[0];
    assert.equal(completedRecord?.issueNumber, 10);
    assert.equal(completedRecord?.feedbackDelivered, true);
    assert.equal(completedRecord?.closureConfirmed, true);
    assert.ok(completedRecord?.deliveredAt && isValidIsoDateString(completedRecord.deliveredAt));

    // Record pre-recovery metrics
    const xpBefore = remoteState.pet.xp;
    const hungerBefore = remoteState.pet.hunger;
    const commentCountBefore = client.comments.get(10)?.length ?? 0;
    const closeCountBefore = client.closeIssueCallCount;
    const genBefore = remoteState.generation;

    // Step 7: Verify fresh invocation discovers Phase 2 completion was already published
    const res2 = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T11:00:00.000Z'),
    });

    // Required assertions:
    // 1. Recovery run is a genuine no-op if no other work is pending
    assert.equal(res2.status, 'noop');
    assert.equal(res2.commitSha, undefined);

    // 2. No duplicate care action applied; XP and satiety unchanged
    const stateAfter = await loadRepositoryState(workRepoDir);
    assert.equal(stateAfter.pet.xp, xpBefore, 'XP must remain strictly unchanged');
    assert.equal(stateAfter.pet.hunger, hungerBefore, 'Hunger must remain strictly unchanged');

    // 3. No duplicate feedback comment created
    const commentCountAfter = client.comments.get(10)?.length ?? 0;
    assert.equal(commentCountAfter, commentCountBefore, 'No duplicate comment created');
    assert.equal(commentCountAfter, 1);

    // 4. No duplicate issue closure attempted
    assert.equal(client.closeIssueCallCount, closeCountBefore, 'No duplicate issue closure attempted');

    // 5. Permanent processedRequestRegistry remains intact
    assert.equal(
      isRequestProcessed(stateAfter.actions.processedRequestRegistry, 10),
      true,
      'Issue #10 must remain permanently recorded in processedRequestRegistry'
    );
    assert.ok(stateAfter.actions.processedRequestRegistry.sparseProcessedIssueNumbers.includes(10));

    // 6. Generation values remain consistent across pet, contributions, and actions
    assert.equal(stateAfter.pet.generation, genBefore);
    assert.equal(stateAfter.contributions.generation, genBefore);
    assert.equal(stateAfter.actions.generation, genBefore);
    assert.equal(stateAfter.generation, genBefore);

    // 7. Remote history integrity: verify git log on remote
    const logOut = (await git(['log', '--oneline'], workRepoDir)).stdout.trim().split('\n');
    assert.ok(logOut.some((l) => l.includes('pet: process care actions [skip ci]')));
    assert.ok(logOut.some((l) => l.includes('pet: record feedback delivery completion [skip ci]')));
    assert.equal(
      logOut.filter((l) => l.includes('feedback delivery completion')).length,
      1,
      'Exactly one completion commit exists'
    );
  });

  it('TC-INBOX-COMPL-11: A fresh run detects already-published completion and does not publish unnecessary duplicate update', async () => {
    // Deliver feedback for issue 11
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 11,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    const headBefore = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    // Fresh run
    const result2 = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(result2.status, 'noop');
    const headAfter = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(headAfter, headBefore, 'No duplicate commit was made');
  });

  it('TC-INBOX-COMPL-12: Incomplete comment pagination never results in false completion', async () => {
    const client = new MockGitHubClient();
    client.paginationIncomplete = true; // Simulates API rate limit / incomplete scan

    const result = await deliverPendingFeedback({
      baseDir: workRepoDir,
      repository: 'mnp210/GitHub-Profile-Pet',
      client,
      records: [
        {
          issueNumber: 12,
          requestId: 'issue-12',
          actionType: 'feed',
          status: 'accepted',
          generation: 1,
          completedAt: '2026-11-16T10:00:00.000Z',
          feedbackDelivered: false,
          feedbackMarker: '<!-- pet-action-feedback:issue-12 -->',
          feedbackBody: 'Feed body\n\n<!-- pet-action-feedback:issue-12 -->',
          targetLabel: 'pet-action:completed',
        },
      ],
    });

    assert.equal(result.deliveredCount, 0);
    assert.equal(result.failedCount, 1);
    // Never falsely marked as delivered!
    assert.equal(result.results[0].delivered, false);
  });

  it('TC-INBOX-COMPL-13: Marker spoofing by a non-bot author never results in false completion', async () => {
    const client = new MockGitHubClient();
    const marker = '<!-- pet-action-feedback:issue-13 -->';
    // Add spoofed comment from user "mallory"
    client.commentsList.set(13, [
      {
        id: 1300,
        body: `I am spoofing the marker\n\n${marker}`,
        user: { id: 9999, login: 'mallory', type: 'User' },
        created_at: '2026-11-16T10:00:00.000Z',
        updated_at: '2026-11-16T10:00:00.000Z',
      },
    ]);

    const records = [
      {
        issueNumber: 13,
        requestId: 'issue-13',
        actionType: 'feed' as const,
        status: 'accepted' as const,
        generation: 1,
        completedAt: '2026-11-16T10:00:00.000Z',
        feedbackDelivered: false,
        feedbackMarker: marker,
        feedbackBody: `Authentic bot comment\n\n${marker}`,
        targetLabel: 'pet-action:completed',
      },
    ];

    const result = await deliverPendingFeedback({
      baseDir: workRepoDir,
      repository: 'mnp210/GitHub-Profile-Pet',
      client,
      botLogin: 'github-actions[bot]',
      records,
    });

    assert.equal(result.deliveredCount, 1);
    // Authentic comment was delivered, spoofing did not suppress bot delivery!
    const allComments = client.commentsList.get(13) ?? [];
    assert.equal(allComments.length, 2);
    assert.equal(allComments[1].user?.login, 'github-actions[bot]');
  });

  it('TC-INBOX-COMPL-14: A failed issue-closure operation does not mark the record complete', async () => {
    const client = new MockGitHubClient();
    client.shouldFailClose = true; // comment succeeds, close throws

    const record: ActionFeedbackRecord = {
      issueNumber: 14,
      requestId: 'issue-14',
      actionType: 'feed',
      status: 'accepted',
      generation: 1,
      completedAt: '2026-11-16T10:00:00.000Z',
      feedbackDelivered: false,
      feedbackMarker: '<!-- pet-action-feedback:issue-14 -->',
      feedbackBody: 'Feed body\n\n<!-- pet-action-feedback:issue-14 -->',
      targetLabel: 'pet-action:completed',
    };

    const result = await deliverPendingFeedback({
      baseDir: workRepoDir,
      repository: 'mnp210/GitHub-Profile-Pet',
      client,
      records: [record],
    });

    assert.equal(result.deliveredCount, 0);
    assert.equal(result.failedCount, 1);
    // Record was NOT marked complete because closure failed!
    assert.equal(record.feedbackDelivered, false);
    assert.notEqual(record.closureConfirmed, true);
  });

  it('TC-INBOX-COMPL-15: Repeated recovery never reapplies care transitions or awards duplicate XP/satiety', async () => {
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 15,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Run 1: Normal processing
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
    });

    const state1 = await loadRepositoryState(workRepoDir);
    const xp1 = state1.pet.xp;
    const hunger1 = state1.pet.hunger;

    // Run 2: Sweep with same issue open
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
    });

    // Run 3: Sweep again
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: Date.parse('2026-11-16T10:00:00.000Z'),
    });

    const state3 = await loadRepositoryState(workRepoDir);
    assert.equal(state3.pet.xp, xp1, 'XP must never increase on repeated recovery');
    assert.equal(state3.pet.hunger, hunger1, 'Hunger must never increase on repeated recovery');
  });

  // =========================================================================
  // Part 2: Retention and Compaction (Tests 16–28)
  // =========================================================================

  it('TC-INBOX-COMPL-16: A completed record younger than seven days is retained', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const sixDaysOld = new Date(referenceTime - 6 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 16,
      requestId: 'issue-16',
      status: 'accepted',
      generation: 1,
      completedAt: sixDaysOld,
      deliveredAt: sixDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, false, 'Record younger than 7 days must be retained');

    const res = compactPendingFeedback([record], { nowMs: referenceTime });
    assert.equal(res.prunedCount, 0);
    assert.equal(res.retainedCount, 1);
  });

  it('TC-INBOX-COMPL-17: A completed record exactly seven days old is handled according to the documented boundary rule (inclusive: pruned)', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const exactlySevenDaysOld = new Date(referenceTime - FEEDBACK_RETENTION_PERIOD_MS).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 17,
      requestId: 'issue-17',
      status: 'accepted',
      generation: 1,
      completedAt: exactlySevenDaysOld,
      deliveredAt: exactlySevenDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, true, 'Record exactly 7 days old is eligible for pruning under inclusive boundary');

    const res = compactPendingFeedback([record], { nowMs: referenceTime });
    assert.equal(res.prunedCount, 1);
    assert.equal(res.retainedCount, 0);
  });

  it('TC-INBOX-COMPL-18: A completed record older than seven days is pruned', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const eightDaysOld = new Date(referenceTime - 8 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 18,
      requestId: 'issue-18',
      status: 'accepted',
      generation: 1,
      completedAt: eightDaysOld,
      deliveredAt: eightDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, true, 'Record older than 7 days must be pruned');

    const res = compactPendingFeedback([record], { nowMs: referenceTime });
    assert.equal(res.prunedCount, 1);
    assert.equal(res.retainedCount, 0);
  });

  it('TC-INBOX-COMPL-19: A pending record is never pruned', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 19,
      requestId: 'issue-19',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      feedbackDelivered: false, // still pending!
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, false, 'Pending delivery record must NEVER be pruned regardless of age');

    const res = compactPendingFeedback([record], { nowMs: referenceTime });
    assert.equal(res.prunedCount, 0);
    assert.equal(res.retainedCount, 1);
  });

  it('TC-INBOX-COMPL-20: A deferred record is never pruned', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 20,
      requestId: 'issue-20',
      status: 'deferred', // deferred
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, false, 'Deferred record must NEVER be pruned');

    const res = compactPendingFeedback([record], { nowMs: referenceTime });
    assert.equal(res.prunedCount, 0);
    assert.equal(res.retainedCount, 1);
  });

  it('TC-INBOX-COMPL-21: A quarantined record is never pruned if delivery is unconfirmed', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 21,
      requestId: 'issue-21',
      status: 'quarantined',
      generation: 1,
      completedAt: twentyDaysOld,
      feedbackDelivered: false, // not delivered
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, false, 'Quarantined record without delivered feedback must NEVER be pruned');
  });

  it('TC-INBOX-COMPL-22: An incomplete/unknown delivery record is never pruned', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 22,
      requestId: 'issue-22',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: false, // closure unconfirmed / unknown
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    const eligible = isFeedbackRecordEligibleForPruning(record, referenceTime);
    assert.equal(eligible, false, 'Record with unconfirmed closure must NEVER be pruned');
  });

  it('TC-INBOX-COMPL-23: A record without a valid completion timestamp is retained or fails closed', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');

    const recordMissingTimestamp: ActionFeedbackRecord = {
      issueNumber: 23,
      requestId: 'issue-23',
      status: 'accepted',
      generation: 1,
      completedAt: 'not-a-date',
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(recordMissingTimestamp, referenceTime), false);
    const res = compactPendingFeedback([recordMissingTimestamp], { nowMs: referenceTime });
    assert.equal(res.prunedCount, 0);
    assert.equal(res.retainedCount, 1);
  });

  // =========================================================================
  // Part 2a: Strict Delivery Timestamp Retention Matrix (R2-A Conditions 1-8)
  // =========================================================================

  it('R2-A-01: Delivered + closure confirmed + valid deliveredAt + exactly seven days: eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const exactlySevenDaysOld = new Date(referenceTime - FEEDBACK_RETENTION_PERIOD_MS).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 301,
      requestId: 'issue-301',
      status: 'accepted',
      generation: 1,
      completedAt: exactlySevenDaysOld,
      deliveredAt: exactlySevenDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), true);
  });

  it('R2-A-02: Same record one millisecond younger than seven days: not eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const oneMsYoungerThanSevenDays = new Date(referenceTime - FEEDBACK_RETENTION_PERIOD_MS + 1).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 302,
      requestId: 'issue-302',
      status: 'accepted',
      generation: 1,
      completedAt: oneMsYoungerThanSevenDays,
      deliveredAt: oneMsYoungerThanSevenDays,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), false);
  });

  it('R2-A-03: Missing deliveredAt + old valid completedAt: not eligible (no fallback)', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 303,
      requestId: 'issue-303',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: undefined, // strictly missing deliveredAt!
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), false);
  });

  it('R2-A-04: Invalid deliveredAt + old valid completedAt: not eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 304,
      requestId: 'issue-304',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: '2026-99-99T99:99:99.999Z', // invalid date string!
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), false);
  });

  it('R2-A-05: Missing closureConfirmed: not eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 305,
      requestId: 'issue-305',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: undefined, // missing closureConfirmed!
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), false);
  });

  it('R2-A-06: closureConfirmed: false: not eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 306,
      requestId: 'issue-306',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: false, // unconfirmed closure!
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), false);
  });

  it('R2-A-07: feedbackDelivered: false: not eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    const record: ActionFeedbackRecord = {
      issueNumber: 307,
      requestId: 'issue-307',
      status: 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: false, // unconfirmed delivery!
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };

    assert.equal(isFeedbackRecordEligibleForPruning(record, referenceTime), false);
  });

  it('R2-A-08: Invalid or missing status: not eligible', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const twentyDaysOld = new Date(referenceTime - 20 * 24 * 60 * 60 * 1000).toISOString();

    // 8a: Missing status
    const recordMissingStatus = {
      issueNumber: 308,
      requestId: 'issue-308',
      status: undefined as unknown as 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };
    assert.equal(isFeedbackRecordEligibleForPruning(recordMissingStatus, referenceTime), false);

    // 8b: Invalid/unknown status
    const recordUnknownStatus = {
      issueNumber: 309,
      requestId: 'issue-309',
      status: 'bogus_status' as unknown as 'accepted',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };
    assert.equal(isFeedbackRecordEligibleForPruning(recordUnknownStatus, referenceTime), false);

    // 8c: Deferred status
    const recordDeferredStatus: ActionFeedbackRecord = {
      issueNumber: 310,
      requestId: 'issue-310',
      status: 'deferred',
      generation: 1,
      completedAt: twentyDaysOld,
      deliveredAt: twentyDaysOld,
      feedbackDelivered: true,
      closureConfirmed: true,
      feedbackMarker: '<!-- marker -->',
      feedbackBody: 'body',
    };
    assert.equal(isFeedbackRecordEligibleForPruning(recordDeferredStatus, referenceTime), false);
  });

  it('TC-INBOX-COMPL-24: Compaction preserves processedRequestRegistry', async () => {
    const state = await loadRepositoryState(workRepoDir);
    state.actions.processedRequestRegistry.highWaterIssueNumber = 50;
    state.actions.processedRequestRegistry.sparseProcessedIssueNumbers = [52, 55];
    state.actions.processedRequestRegistry.retiredNonActionGaps = [51];
    state.actions.processedRequestRegistry.unresolvedGaps = [53];

    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const tenDaysOld = new Date(referenceTime - 10 * 24 * 60 * 60 * 1000).toISOString();

    state.actions.pendingFeedback = [
      {
        issueNumber: 50,
        requestId: 'issue-50',
        status: 'accepted',
        generation: 1,
        completedAt: tenDaysOld,
        deliveredAt: tenDaysOld,
        feedbackDelivered: true,
        closureConfirmed: true,
        feedbackMarker: '<!-- marker -->',
        feedbackBody: 'body',
      },
    ];

    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    // Run sweep with compaction enabled
    const client = new MockGitHubClient();
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: referenceTime,
    });

    const updated = await loadRepositoryState(workRepoDir);
    // Feedback record was pruned
    assert.equal(updated.actions.pendingFeedback?.length, 0);
    // processedRequestRegistry is 100% intact!
    assert.equal(updated.actions.processedRequestRegistry.highWaterIssueNumber, 50);
    assert.deepEqual(updated.actions.processedRequestRegistry.sparseProcessedIssueNumbers, [52, 55]);
    assert.deepEqual(updated.actions.processedRequestRegistry.retiredNonActionGaps, [51]);
    assert.deepEqual(updated.actions.processedRequestRegistry.unresolvedGaps, [53]);
  });

  it('TC-INBOX-COMPL-25: A previously processed action remains deduplicated after its feedback record is pruned', async () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const tenDaysOld = new Date(referenceTime - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Issue #25 processed in the past and pruned
    const state = await loadRepositoryState(workRepoDir);
    state.actions.processedRequestRegistry.highWaterIssueNumber = 25;
    state.actions.pendingFeedback = [
      {
        issueNumber: 25,
        requestId: 'issue-25',
        status: 'accepted',
        generation: 1,
        completedAt: tenDaysOld,
        deliveredAt: tenDaysOld,
        feedbackDelivered: true,
        closureConfirmed: true,
        feedbackMarker: '<!-- marker -->',
        feedbackBody: 'body',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const client = new MockGitHubClient();
    // Prune feedback record via compaction
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: referenceTime,
    });

    // Reopen Issue #25 with care action
    client.addMockIssue({
      number: 25,
      title: 'pet: feed',
      body: 'Feed again',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-18T13:00:00.000Z',
      updated_at: '2026-11-18T13:00:00.000Z',
    });

    // Run pipeline: must identify as duplicate and award 0 XP
    const res = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: referenceTime + 3600000,
    });

    assert.equal(res.status, 'noop');
    assert.equal(res.inboxResult?.duplicateCount, 1);
    assert.equal(res.inboxResult?.acceptedCount, 0);
  });

  it('TC-INBOX-COMPL-26: Re-running compaction with identical input and time produces no additional changes (idempotency)', () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const tenDaysOld = new Date(referenceTime - 10 * 24 * 60 * 60 * 1000).toISOString();
    const threeDaysOld = new Date(referenceTime - 3 * 24 * 60 * 60 * 1000).toISOString();

    const records: ActionFeedbackRecord[] = [
      {
        issueNumber: 101,
        requestId: 'issue-101',
        status: 'accepted',
        generation: 1,
        completedAt: tenDaysOld,
        deliveredAt: tenDaysOld,
        feedbackDelivered: true,
        closureConfirmed: true,
        feedbackMarker: '<!-- m101 -->',
        feedbackBody: 'b101',
      },
      {
        issueNumber: 102,
        requestId: 'issue-102',
        status: 'accepted',
        generation: 1,
        completedAt: threeDaysOld,
        deliveredAt: threeDaysOld,
        feedbackDelivered: true,
        closureConfirmed: true,
        feedbackMarker: '<!-- m102 -->',
        feedbackBody: 'b102',
      },
    ];

    const pass1 = compactPendingFeedback(records, { nowMs: referenceTime });
    assert.equal(pass1.prunedCount, 1);
    assert.equal(pass1.retainedCount, 1);

    const pass2 = compactPendingFeedback(pass1.records, { nowMs: referenceTime });
    assert.equal(pass2.prunedCount, 0);
    assert.equal(pass2.retainedCount, 1);
    assert.deepEqual(pass2.records, pass1.records);
  });

  it('TC-INBOX-COMPL-27: Journal interruption during compaction recovers without losing unresolved records', async () => {
    const paths = getStatePaths(workRepoDir);
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const tenDaysOld = new Date(referenceTime - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Source state has 1 unresolved record and 1 old record
    const state = await loadRepositoryState(workRepoDir);
    state.actions.pendingFeedback = [
      {
        issueNumber: 271,
        requestId: 'issue-271',
        status: 'accepted',
        generation: 1,
        completedAt: tenDaysOld,
        feedbackDelivered: false, // unresolved!
        feedbackMarker: '<!-- m271 -->',
        feedbackBody: 'b271',
      },
      {
        issueNumber: 272,
        requestId: 'issue-272',
        status: 'accepted',
        generation: 1,
        completedAt: tenDaysOld,
        deliveredAt: tenDaysOld,
        feedbackDelivered: true,
        closureConfirmed: true,
        feedbackMarker: '<!-- m272 -->',
        feedbackBody: 'b272',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    // Simulate crash during journal preparation of compaction
    await fs.mkdir(paths.journalTargetDir, { recursive: true });
    await fs.mkdir(paths.journalSourceDir, { recursive: true });
    const meta = {
      sourceGeneration: 1,
      targetGeneration: 1,
      status: 'preparing',
      timestamp: new Date().toISOString(),
    };
    await atomicWriteFile(paths.journalMetaPath, JSON.stringify(meta));

    // Recovery runs on load
    const recovered = await loadRepositoryState(workRepoDir);
    assert.equal(recovered.actions.pendingFeedback?.length, 2);
    // Unresolved record was 100% preserved
    assert.equal(recovered.actions.pendingFeedback?.[0].issueNumber, 271);
    assert.equal(recovered.actions.pendingFeedback?.[0].feedbackDelivered, false);
  });

  it('TC-INBOX-COMPL-28: Concurrent append/delivery and compaction cannot lose a feedback record', async () => {
    const referenceTime = Date.parse('2026-11-18T12:00:00.000Z');
    const tenDaysOld = new Date(referenceTime - 10 * 24 * 60 * 60 * 1000).toISOString();

    // Pre-populate 1 old completed record
    const state = await loadRepositoryState(workRepoDir);
    state.actions.pendingFeedback = [
      {
        issueNumber: 280,
        requestId: 'issue-280',
        status: 'accepted',
        generation: 1,
        completedAt: tenDaysOld,
        deliveredAt: tenDaysOld,
        feedbackDelivered: true,
        closureConfirmed: true,
        feedbackMarker: '<!-- m280 -->',
        feedbackBody: 'b280',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-seed pending feedback'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    // Add new Issue #281 during the run
    const client = new MockGitHubClient();
    client.addMockIssue({
      number: 281,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-18T12:00:00.000Z',
      updated_at: '2026-11-18T12:00:00.000Z',
    });

    // Pipeline processes new action and runs compaction simultaneously
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      nowMs: referenceTime,
    });

    assert.equal(result.status, 'published');
    const finalState = await loadRepositoryState(workRepoDir);
    // Old record 280 was pruned
    assert.ok(!finalState.actions.pendingFeedback?.some((r) => r.issueNumber === 280));
    // Newly appended record 281 was preserved and durably marked completed!
    const rec281 = finalState.actions.pendingFeedback?.find((r) => r.issueNumber === 281);
    assert.ok(rec281, 'New record 281 must not be lost by compaction');
    assert.equal(rec281.feedbackDelivered, true);
    assert.equal(rec281.closureConfirmed, true);
  });
});
