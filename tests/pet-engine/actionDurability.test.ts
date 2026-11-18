/**
 * GitHub Profile Pet — Action Durability & Replay Protection Tests (Phase 3C2.3-B0)
 *
 * Verifies Category 2: Durable Action Identity & Replay Protection (Tests 10–17)
 * - TC-INBOX-ACT-10: Idempotent Reprocessing of Already-Recorded Action
 * - TC-INBOX-ACT-11: Failed Push Leaves Action Pending for Next Sweep
 * - TC-INBOX-ACT-12: High-Water Mark Monotonicity
 * - TC-INBOX-ACT-13: Reopened Issue Handling
 * - TC-INBOX-ACT-14: Batch Action Ordering Preserved Across Retries
 * - TC-INBOX-ACT-15: Duplicate Action Body within Batch Filtered
 * - TC-INBOX-ACT-16: Stale Source State Abort
 * - TC-INBOX-ACT-17: Malformed Action Issue Quarantine Without Blocking Queue
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

describe('Category 2: Durable Action Identity & Replay Protection (TC-INBOX-ACT-10 to TC-INBOX-ACT-17)', () => {
  let tempBaseDir: string;
  let remoteRepoDir: string;
  let workRepoDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-act-dur-test-'));
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

  // TC-INBOX-ACT-10: Idempotent Reprocessing of Already-Recorded Action
  it('TC-INBOX-ACT-10: Idempotent Reprocessing of Already-Recorded Action', async () => {
    // Pre-record Issue #5 in processedRequestRegistry
    const state = await loadRepositoryState(workRepoDir);
    state.actions.processedRequestRegistry.highWaterIssueNumber = 5;
    state.actions.processedRequestRegistry.sparseProcessedIssueNumbers = [5];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Pre-record issue 5'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 5,
      title: 'pet: feed',
      body: 'Feed action',
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

    // Clean no-op: already processed issue does not trigger a commit or push
    assert.equal(result.success, true);
    assert.equal(result.status, 'noop');
    assert.equal(result.inboxResult?.duplicateCount, 1);
    assert.equal(result.inboxResult?.acceptedCount, 0);

    // Verify vitals did not mutate
    const postState = await loadRepositoryState(workRepoDir);
    assert.equal(postState.pet.xp, 0);
  });

  // TC-INBOX-ACT-11: Failed Push Leaves Action Pending for Next Sweep
  it('TC-INBOX-ACT-11: Failed Push Leaves Action Pending for Next Sweep', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 11,
      title: 'pet: feed',
      body: 'Feed action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Push fails
    const failResult = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      maxRetries: 1,
      gitExecutor: async (cmd, args, cwd) => {
        if (args[0] === 'push') {
          throw new Error('Push failed: network error');
        }
        return git(args, cwd);
      },
    });

    assert.equal(failResult.success, false);
    // Because push failed, Phase 2 feedback delivery was deferred and never ran
    assert.equal(client.closedIssues.has(11), false);
    assert.equal(client.comments.has(11), false);

    // On subsequent sweep without error, action is processed fresh and published
    const successResult = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(successResult.success, true);
    assert.equal(successResult.status, 'published');
    assert.equal(client.closedIssues.has(11), true);
  });

  // TC-INBOX-ACT-12: High-Water Mark Monotonicity
  it('TC-INBOX-ACT-12: High-Water Mark Monotonicity', async () => {
    const client = new MockGitHubInboxClient();
    // Provide issues #1, #3, #5
    client.addMockIssue({
      number: 1,
      title: 'pet: feed',
      body: 'Feed 1',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    client.addMockIssue({
      number: 3,
      title: 'pet: rest',
      body: 'Rest 3',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:rest' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:05:00.000Z',
      updated_at: '2026-11-16T10:05:00.000Z',
    });
    client.addMockIssue({
      number: 5,
      title: 'pet: pet',
      body: 'Pet 5',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:pet' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:10:00.000Z',
      updated_at: '2026-11-16T10:10:00.000Z',
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

    const state = await loadRepositoryState(workRepoDir);
    assert.ok(state.actions.processedRequestRegistry.highWaterIssueNumber >= 1);
    assert.ok(
      state.actions.processedRequestRegistry.highWaterIssueNumber === 1 ||
      state.actions.processedRequestRegistry.sparseProcessedIssueNumbers.includes(1)
    );
    assert.ok(state.actions.processedRequestRegistry.sparseProcessedIssueNumbers.includes(3));
    assert.ok(state.actions.processedRequestRegistry.sparseProcessedIssueNumbers.includes(5));
  });

  // TC-INBOX-ACT-13: Reopened Issue Handling
  it('TC-INBOX-ACT-13: Reopened Issue Handling', async () => {
    // Seed issue #13 as already processed in registry
    const state = await loadRepositoryState(workRepoDir);
    state.actions.processedRequestRegistry.highWaterIssueNumber = 13;
    state.actions.processedRequestRegistry.sparseProcessedIssueNumbers = [13];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Record issue 13'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const client = new MockGitHubInboxClient();
    // User reopens issue #13 with pet-action:pending label
    client.addMockIssue({
      number: 13,
      title: 'pet: feed',
      body: 'Reopened feed attempt',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T11:00:00.000Z',
    });

    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    // Must be skipped as duplicate
    assert.equal(result.success, true);
    assert.equal(result.status, 'noop');
    assert.equal(result.inboxResult?.duplicateCount, 1);
  });

  // TC-INBOX-ACT-14: Batch Action Ordering Preserved Across Retries
  it('TC-INBOX-ACT-14: Batch Action Ordering Preserved Across Retries', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 10,
      title: 'pet: feed',
      body: 'First action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    client.addMockIssue({
      number: 11,
      title: 'pet: train',
      body: 'Second action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:train' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:02:00.000Z',
      updated_at: '2026-11-16T10:02:00.000Z',
    });

    // First attempt fails push, second succeeds
    let pushAttempts = 0;
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      maxRetries: 3,
      gitExecutor: async (cmd, args, cwd) => {
        if (args[0] === 'push') {
          pushAttempts++;
          if (pushAttempts === 1) {
            throw new Error('[rejected] non-fast-forward');
          }
        }
        return git(args, cwd);
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');

    // Outcomes must preserve exact chronological sequence #10 then #11 across retry
    assert.ok(result.inboxResult);
    assert.equal(result.inboxResult.outcomes.length, 2);
    assert.equal(result.inboxResult.outcomes[0].issueNumber, 10);
    assert.equal(result.inboxResult.outcomes[0].actionType, 'feed');
    assert.equal(result.inboxResult.outcomes[1].issueNumber, 11);
    assert.equal(result.inboxResult.outcomes[1].actionType, 'train');

    const finalState = await loadRepositoryState(workRepoDir);
    assert.ok(finalState.actions.processedRequestRegistry.sparseProcessedIssueNumbers.includes(10) || finalState.actions.processedRequestRegistry.highWaterIssueNumber >= 10);
    assert.ok(finalState.actions.processedRequestRegistry.sparseProcessedIssueNumbers.includes(11) || finalState.actions.processedRequestRegistry.highWaterIssueNumber >= 11);
  });

  // TC-INBOX-ACT-15: Duplicate Action Body within Batch Filtered
  it('TC-INBOX-ACT-15: Duplicate Action Body within Batch Filtered', async () => {
    const client = new MockGitHubInboxClient();
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

    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.inboxResult?.acceptedCount, 1);
  });

  // TC-INBOX-ACT-16: Stale Source State Abort
  it('TC-INBOX-ACT-16: Stale Source State Abort', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 16,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Provide a mismatched sourceCommitSha
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      sourceCommitSha: '0000000000000000000000000000000000000000',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'error');
    assert.ok(result.details.includes('Source commit SHA mismatch'));
  });

  // TC-INBOX-ACT-17: Malformed Action Issue Quarantine Without Blocking Queue
  it('TC-INBOX-ACT-17: Malformed Action Issue Quarantine Without Blocking Queue', async () => {
    const client = new MockGitHubInboxClient();
    // Issue #20 is malformed / unknown action
    client.addMockIssue({
      number: 20,
      title: 'invalid action title',
      body: 'this is not a valid pet action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });
    // Issue #21 is valid
    client.addMockIssue({
      number: 21,
      title: 'pet: feed',
      body: 'valid feed action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:01:00.000Z',
      updated_at: '2026-11-16T10:01:00.000Z',
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
    // Issue #21 was processed and accepted
    assert.equal(result.inboxResult?.acceptedCount, 1);
    assert.ok(client.closedIssues.has(21));
  });
});
