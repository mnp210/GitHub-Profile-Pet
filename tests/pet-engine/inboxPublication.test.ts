/**
 * GitHub Profile Pet — Safe Inbox Publication Pipeline Tests (Phase 3C2.3-B0)
 *
 * Verifies Category 1: Fast-Forward Push & Remote Fence Safety (Tests 1–9)
 * - TC-INBOX-PUB-01: Successful Fast-Forward Publication under zero concurrency
 * - TC-INBOX-PUB-02: Pre-push Remote Generation Fence Detection (Stage 1)
 * - TC-INBOX-PUB-03: Push Rejection Detection (Stage 2)
 * - TC-INBOX-PUB-04: Non-destructive Rollback on Push Rejection
 * - TC-INBOX-PUB-05: Bounded Retry Loop with Fresh State Ingestion
 * - TC-INBOX-PUB-06: Strict Ban on git rebase
 * - TC-INBOX-PUB-07: Strict Ban on git merge
 * - TC-INBOX-PUB-08: Strict Ban on git push --force
 * - TC-INBOX-PUB-09: Dirty Working Tree Preflight (F-01) Rejection
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

describe('Category 1: Fast-Forward Push & Remote Fence Safety (TC-INBOX-PUB-01 to TC-INBOX-PUB-09)', () => {
  let tempBaseDir: string;
  let remoteRepoDir: string;
  let workRepoDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inbox-pub-test-'));
    remoteRepoDir = path.join(tempBaseDir, 'remote.git');
    workRepoDir = path.join(tempBaseDir, 'work');

    await fs.mkdir(remoteRepoDir, { recursive: true });
    await fs.mkdir(workRepoDir, { recursive: true });

    // Initialize bare remote repo with default branch main
    await git(['init', '--bare', '--initial-branch=main', remoteRepoDir], tempBaseDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], remoteRepoDir);

    // Initialize working repo
    await git(['init', '-b', 'main', workRepoDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], workRepoDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], workRepoDir);
    await git(['remote', 'add', 'origin', remoteRepoDir], workRepoDir);

    // Seed valid manifest files in working repo
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

    // Initial commit and push to remote
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Initial setup'], workRepoDir);
    await git(['push', '-u', 'origin', 'main'], workRepoDir);
  });

  afterEach(async () => {
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true });
    }
  });

  // TC-INBOX-PUB-01: Successful Fast-Forward Publication under zero concurrency
  it('TC-INBOX-PUB-01: Successful Fast-Forward Publication under zero concurrency', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 1,
      title: 'pet: feed',
      body: 'Feeding pet snack',
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
    assert.ok(result.commitSha);
    assert.equal(result.destinationRef, 'main');

    // Verify remote branch was updated
    const remoteHead = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteHead, result.commitSha);

    // Verify state was incremented to generation 2
    const updatedState = await loadRepositoryState(workRepoDir);
    assert.equal(updatedState.pet.generation, 2);
    assert.equal(updatedState.pet.hunger, 62); // 50 - 12 decay + 24 baseHunger = 62
    assert.equal(updatedState.actions.generation, 2);
    assert.equal(updatedState.contributions.generation, 2);

    // Verify Phase 2 post-push feedback was delivered
    assert.ok(client.closedIssues.has(1));
    const comments = client.comments.get(1) ?? [];
    assert.equal(comments.length, 1);
    assert.ok(comments[0].includes('<!-- pet-action-feedback:issue-1 -->'));
  });

  // TC-INBOX-PUB-02: Pre-push Remote Generation Fence Detection (Stage 1)
  it('TC-INBOX-PUB-02: Pre-push Remote Generation Fence Detection (Stage 1)', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 2,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Advance remote repository concurrently
    const cloneDir = path.join(tempBaseDir, 'clone-remote');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);
    await fs.writeFile(path.join(cloneDir, 'concurrent.txt'), 'remote moved', 'utf-8');
    await git(['add', 'concurrent.txt'], cloneDir);
    await git(['commit', '-m', 'Concurrent commit on remote'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    const advancedRemoteSha = (await git(['rev-parse', 'HEAD'], cloneDir)).stdout.trim();

    // Run pipeline with maxRetries = 1 (so stage 1 fence triggers conflict immediately)
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      maxRetries: 1,
    });

    assert.equal(result.success, false);
    assert.ok(result.status === 'stage_1_fence_conflict' || result.status === 'push_rejected');
    assert.ok(result.details.includes('Remote branch advanced'));

    // Remote HEAD remains at advancedRemoteSha, untouched by failed pipeline
    const remoteHeadAfter = (await git(['rev-parse', 'refs/heads/main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteHeadAfter, advancedRemoteSha);
  });

  // TC-INBOX-PUB-03: Push Rejection Detection (Stage 2)
  it('TC-INBOX-PUB-03: Push Rejection Detection (Stage 2)', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 3,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const initialSourceSha = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    // Bypass Stage 1 fence check to simulate race condition between fence check and git push
    let pushAttempted = false;
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      maxRetries: 1,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: initialSourceSha }),
      gitExecutor: async (cmd, args, cwd) => {
        if (cmd === 'git' && args[0] === 'push') {
          pushAttempted = true;
          throw new Error('error: failed to push some refs to origin. [rejected] non-fast-forward');
        }
        return git(args, cwd);
      },
    });

    assert.equal(pushAttempted, true);
    assert.equal(result.success, false);
    assert.equal(result.status, 'push_rejected');
    assert.ok(result.details.includes('Publication Conflict'));
  });

  // TC-INBOX-PUB-04: Non-destructive Rollback on Push Rejection
  it('TC-INBOX-PUB-04: Non-destructive Rollback on Push Rejection', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 4,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const initialHead = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      maxRetries: 1,
      gitExecutor: async (cmd, args, cwd) => {
        if (cmd === 'git' && args[0] === 'push') {
          throw new Error('fatal: remote rejected non-fast-forward push');
        }
        return git(args, cwd);
      },
    });

    assert.equal(result.success, false);

    // Verify local repository HEAD was rolled back to initialHead
    const currentHead = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(currentHead, initialHead);

    // Verify working tree is clean
    const status = (await git(['status', '--porcelain'], workRepoDir)).stdout.trim();
    assert.equal(status, '');
  });

  // TC-INBOX-PUB-05: Bounded Retry Loop with Fresh State Ingestion
  it('TC-INBOX-PUB-05: Bounded Retry Loop with Fresh State Ingestion', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 5,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Advance remote concurrently with a valid generation 2 state
    const cloneDir = path.join(tempBaseDir, 'clone-concurrent');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);

    const concurrentState = await loadRepositoryState(cloneDir);
    concurrentState.pet.generation = 2;
    concurrentState.pet.xp += 50;
    concurrentState.contributions.generation = 2;
    concurrentState.actions.generation = 2;
    await saveRepositoryState(cloneDir, concurrentState);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], cloneDir);
    await git(['commit', '-m', 'Path B contribution sync update'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    // Run pipeline with maxRetries = 3 in workRepoDir
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      maxRetries: 3,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.attemptsMade, 2); // succeeded on retry attempt 2

    // Verify final state preserved Path B's XP and advanced to generation 3
    const finalState = await loadRepositoryState(workRepoDir);
    assert.equal(finalState.pet.generation, 3);
    assert.equal(finalState.pet.xp, 60); // Path B's 50 XP preserved + 10 XP from feed = 60
    assert.equal(finalState.pet.hunger, 62); // 50 - 12 decay + 24 baseHunger = 62
    assert.equal(finalState.actions.generation, 3);
    assert.equal(finalState.contributions.generation, 3);
  });

  // TC-INBOX-PUB-06: Strict Ban on git rebase
  it('TC-INBOX-PUB-06: Strict Ban on git rebase', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 6,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const gitCommandsExecuted: string[][] = [];
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      gitExecutor: async (cmd, args, cwd) => {
        gitCommandsExecuted.push(args);
        return git(args, cwd);
      },
    });

    for (const cmdArgs of gitCommandsExecuted) {
      assert.notEqual(cmdArgs[0], 'rebase', `git rebase must NEVER be invoked! Found: ${cmdArgs.join(' ')}`);
    }
  });

  // TC-INBOX-PUB-07: Strict Ban on git merge
  it('TC-INBOX-PUB-07: Strict Ban on git merge', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 7,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const gitCommandsExecuted: string[][] = [];
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      gitExecutor: async (cmd, args, cwd) => {
        gitCommandsExecuted.push(args);
        return git(args, cwd);
      },
    });

    for (const cmdArgs of gitCommandsExecuted) {
      assert.notEqual(cmdArgs[0], 'merge', `git merge must NEVER be invoked! Found: ${cmdArgs.join(' ')}`);
      assert.notEqual(cmdArgs[0], 'pull', `git pull must NEVER be invoked! Found: ${cmdArgs.join(' ')}`);
    }
  });

  // TC-INBOX-PUB-08: Strict Ban on git push --force
  it('TC-INBOX-PUB-08: Strict Ban on git push --force', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 8,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const pushCalls: string[][] = [];
    await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      gitExecutor: async (cmd, args, cwd) => {
        if (args[0] === 'push') {
          pushCalls.push(args);
        }
        return git(args, cwd);
      },
    });

    assert.ok(pushCalls.length > 0);
    for (const p of pushCalls) {
      assert.ok(!p.includes('--force'), `git push --force must NEVER be used!`);
      assert.ok(!p.includes('-f'), `git push -f must NEVER be used!`);
      assert.ok(!p.some((arg) => arg.startsWith('+')), `git push +ref must NEVER be used!`);
    }
  });

  // TC-INBOX-PUB-09: Dirty Working Tree Preflight (F-01) Rejection
  it('TC-INBOX-PUB-09: Dirty Working Tree Preflight (F-01) Rejection', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 9,
      title: 'pet: feed',
      body: 'Feeding pet',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Create an uncommitted/untracked file in workRepoDir
    await fs.writeFile(path.join(workRepoDir, 'untracked.txt'), 'dirty tree content', 'utf-8');

    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'dirty_working_tree');
    assert.ok(result.details.includes('F-01'));

    // Verify issue was NOT closed and no comments were posted
    assert.equal(client.closedIssues.size, 0);
    assert.equal(client.comments.size, 0);
  });
});
