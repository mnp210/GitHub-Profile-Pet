/**
 * GitHub Profile Pet — Post-Publication Recoverable Feedback Delivery Tests (Phase 3C2.3-B0)
 *
 * Verifies Category 3: Post-Publication Recoverable Feedback Delivery (Tests 18–23)
 * - TC-INBOX-FDB-18: Feedback Delivered After Successful Push
 * - TC-INBOX-FDB-19: Feedback Failure Does Not Invalidate Published Git State
 * - TC-INBOX-FDB-20: Feedback Retry with Deterministic Marker Prevents Duplicate Comment
 * - TC-INBOX-FDB-21: Marker Pre-Check Bypasses Comment on Second Execution
 * - TC-INBOX-FDB-22: Terminal State Rejection Reason Conveyed in Comment
 * - TC-INBOX-FDB-23: Issue Closed with Explicit Outcome Label
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
} from '../../src/features/pet-engine/inbox/actionProcessor.ts';
import {
  loadRepositoryState,
  saveRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import type {
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
  };
}

class MockGitHubInboxClient implements GitHubInboxClient {
  public issues: Map<number, GitHubIssue> = new Map();
  public comments: Map<number, string[]> = new Map();
  public commentsList: Map<number, GitHubIssueComment[]> = new Map();
  public labelsAdded: Map<number, string[]> = new Map();
  public labelsRemoved: Map<number, string[]> = new Map();
  public closedIssues: Set<number> = new Set();
  public shouldFailComment: boolean = false;

  addMockIssue(issue: GitHubIssue): void {
    this.issues.set(issue.number, issue);
  }

  async listIssueComments(
    _repo: string,
    issueNumber: number,
    options?: { page?: number; perPage?: number }
  ): Promise<GitHubIssueComment[]> {
    void _repo;
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
    return {
      issues: list,
      hasMore: false,
      pageCount: 1,
    };
  }

  async commentIssue(_repo: string, issueNumber: number, comment: string): Promise<void> {
    void _repo;
    if (this.shouldFailComment) {
      throw new Error('500 Internal Server Error: comments API unreachable');
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
  }

  async closeIssue(_repo: string, issueNumber: number, labelToAdd?: string): Promise<void> {
    void _repo;
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
    void _repo;
    if (!this.labelsAdded.has(issueNumber)) {
      this.labelsAdded.set(issueNumber, []);
    }
    this.labelsAdded.get(issueNumber)!.push(...labels);
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
    void _repo;
    if (!this.labelsRemoved.has(issueNumber)) {
      this.labelsRemoved.set(issueNumber, []);
    }
    this.labelsRemoved.get(issueNumber)!.push(label);
    if (this.issues.has(issueNumber)) {
      const issue = this.issues.get(issueNumber)!;
      issue.labels = issue.labels.filter((l) => (typeof l === 'string' ? l : l.name) !== label);
    }
  }

  async getIssue(_repo: string, issueNumber: number): Promise<{ status: number; issue?: GitHubIssue }> {
    void _repo;
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      return { status: 404 };
    }
    return { status: 200, issue };
  }
}

describe('Category 3: Post-Publication Recoverable Feedback Delivery (TC-INBOX-FDB-18 to TC-INBOX-FDB-23)', () => {
  let tempBaseDir: string;
  let remoteRepoDir: string;
  let workRepoDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-fdb-test-'));
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

    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Initial setup'], workRepoDir);
    await git(['push', '-u', 'origin', 'main'], workRepoDir);
  });

  afterEach(async () => {
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  // TC-INBOX-FDB-18: Feedback Delivered After Successful Push
  it('TC-INBOX-FDB-18: Feedback Delivered After Successful Push', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 18,
      title: 'pet: feed',
      body: 'Feed',
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
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');

    // Feedback delivered in Phase 2
    assert.ok(client.closedIssues.has(18));
    const comments = client.comments.get(18) ?? [];
    assert.equal(comments.length, 1);
    assert.ok(comments[0].includes('<!-- pet-action-feedback:issue-18 -->'));
  });

  // TC-INBOX-FDB-19: Feedback Failure Does Not Invalidate Published Git State
  it('TC-INBOX-FDB-19: Feedback Failure Does Not Invalidate Published Git State', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 19,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Make comment API fail during Phase 2
    client.shouldFailComment = true;

    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    // Pipeline succeeds because Git commit and push were already completed
    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.ok(result.commitSha);

    // Verify remote repository has the new commit permanently
    const remoteHead = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteHead, result.commitSha);
  });

  // TC-INBOX-FDB-20: Feedback Retry with Deterministic Marker Prevents Duplicate Comment
  it('TC-INBOX-FDB-20: Feedback Retry with Deterministic Marker Prevents Duplicate Comment', async () => {
    const client = new MockGitHubInboxClient();
    // Simulate issue having an existing comment with the deterministic marker
    const marker = '<!-- pet-action-feedback:issue-20 -->';
    client.addMockIssue({
      number: 20,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    // Add existing comment with marker
    client.commentsList.set(20, [
      {
        id: 9999,
        body: `Existing feedback comment\n\n${marker}`,
        user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' },
        created_at: '2026-11-16T10:01:00.000Z',
        updated_at: '2026-11-16T10:01:00.000Z',
      },
    ]);
    client.comments.set(20, [`Existing feedback comment\n\n${marker}`]);

    await deliverPendingFeedback({
      baseDir: workRepoDir,
      repository: 'mnp210/GitHub-Profile-Pet',
      client,
      records: [
        {
          issueNumber: 20,
          requestId: 'issue-20',
          actionType: 'feed',
          status: 'accepted',
          generation: 2,
          completedAt: '2026-11-16T10:01:00.000Z',
          feedbackDelivered: false,
          feedbackMarker: marker,
          feedbackBody: `New feedback body\n\n${marker}`,
          targetLabel: 'pet-action:accepted',
        },
      ],
    });

    // Should NOT have posted a second comment
    const comments = client.comments.get(20) ?? [];
    assert.equal(comments.length, 1);
    // Should have closed the issue
    assert.ok(client.closedIssues.has(20));
  });

  // TC-INBOX-FDB-21: Marker Pre-Check Bypasses Comment on Second Execution
  it('TC-INBOX-FDB-21: Marker Pre-Check Bypasses Comment on Second Execution', async () => {
    const client = new MockGitHubInboxClient();
    const marker = '<!-- pet-action-feedback:issue-21 -->';
    client.addMockIssue({
      number: 21,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const record = {
      issueNumber: 21,
      requestId: 'issue-21',
      actionType: 'feed' as const,
      status: 'accepted' as const,
      generation: 2,
      completedAt: '2026-11-16T10:01:00.000Z',
      feedbackDelivered: false,
      feedbackMarker: marker,
      feedbackBody: `Accepted feed action\n\n${marker}`,
      targetLabel: 'pet-action:accepted',
    };

    // First delivery
    await deliverPendingFeedback({
      baseDir: workRepoDir,
      repository: 'mnp210/GitHub-Profile-Pet',
      client,
      records: [record],
    });

    assert.equal(client.comments.get(21)?.length, 1);

    // Second delivery
    await deliverPendingFeedback({
      baseDir: workRepoDir,
      repository: 'mnp210/GitHub-Profile-Pet',
      client,
      records: [record],
    });

    // Still exactly 1 comment!
    assert.equal(client.comments.get(21)?.length, 1);
  });

  // TC-INBOX-FDB-22: Terminal State Rejection Reason Conveyed in Comment
  it('TC-INBOX-FDB-22: Terminal State Rejection Reason Conveyed in Comment', async () => {
    // Set pet satiety (hunger) to 100 at same timestamp so decay does not reduce it
    const state = await loadRepositoryState(workRepoDir);
    state.pet.hunger = 100;
    state.pet.lastSimulatedAt = '2026-11-16T10:00:00.000Z';
    state.pet.lastInteractionTime = '2026-11-16T10:00:00.000Z';
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pet is completely full'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 22,
      title: 'pet: feed',
      body: 'Feed full pet',
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
    });

    assert.equal(result.success, true);
    assert.ok(result.inboxResult);
    assert.equal(result.inboxResult.rejectedCount, 1);

    // Comment should convey rejection
    const comments = client.comments.get(22) ?? [];
    assert.equal(comments.length, 1);
    assert.ok(comments[0].includes('Satiety') || comments[0].includes('full') || comments[0].includes('Rejected'));
    // Issue closed with rejection label
    assert.ok(client.closedIssues.has(22));
    assert.ok(client.labelsAdded.get(22)?.includes('pet-action:rejected'));
  });

  // TC-INBOX-FDB-23: Issue Closed with Explicit Outcome Label
  it('TC-INBOX-FDB-23: Issue Closed with Explicit Outcome Label', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 23,
      title: 'pet: feed',
      body: 'Feed',
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
    });

    assert.equal(result.success, true);
    assert.ok(client.closedIssues.has(23));

    const issue = client.issues.get(23)!;
    assert.equal(issue.state, 'closed');
    // pet-action:pending removed
    assert.equal(
      issue.labels.some((l) => (typeof l === 'string' ? l : l.name) === 'pet-action:pending'),
      false
    );
    // outcome label (pet-action:completed) added
    assert.equal(
      issue.labels.some((l) => (typeof l === 'string' ? l : l.name) === 'pet-action:completed'),
      true
    );
  });
});
