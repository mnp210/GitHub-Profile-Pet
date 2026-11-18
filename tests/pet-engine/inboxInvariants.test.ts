/**
 * GitHub Profile Pet — Path A/B Invariants & Lockstep Integrity Tests (Phase 3C2.3-B0)
 *
 * Verifies Category 4: Path A/B Invariants & Lockstep Integrity (Tests 24–28)
 * - TC-INBOX-INV-24: State Generation Monotonicity (G_{n+1} = G_n + 1)
 * - TC-INBOX-INV-25: Action-Simulation Generation Lockstep
 * - TC-INBOX-INV-26: Manifest Allowlist Enforcement
 * - TC-INBOX-INV-27: Journal Recovery Before Action Ingestion
 * - TC-INBOX-INV-28: Zero Cross-Path Data Overwrite
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
  getStatePaths,
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

describe('Category 4: Path A/B Invariants & Lockstep Integrity (TC-INBOX-INV-24 to TC-INBOX-INV-28)', () => {
  let tempBaseDir: string;
  let remoteRepoDir: string;
  let workRepoDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-inv-test-'));
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

    // Create .gitignore so ephemeral journal and lock are ignored
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

  // TC-INBOX-INV-24: State Generation Monotonicity (G_{n+1} = G_n + 1)
  it('TC-INBOX-INV-24: State Generation Monotonicity (G_{n+1} = G_n + 1)', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 24,
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

    const state = await loadRepositoryState(workRepoDir);
    assert.equal(state.pet.generation, 2);
    assert.equal(state.actions.generation, 2);
    assert.equal(state.contributions.generation, 2);
    assert.equal(state.generation, 2);
  });

  // TC-INBOX-INV-25: Action-Simulation Generation Lockstep
  it('TC-INBOX-INV-25: Action-Simulation Generation Lockstep', async () => {
    // 1. Path A runs: advances Gen 1 -> Gen 2
    const clientA = new MockGitHubInboxClient();
    clientA.addMockIssue({
      number: 25,
      title: 'pet: feed',
      body: 'Feed action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    const resA = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client: clientA,
      allowAnyAuthor: true,
    });
    assert.equal(resA.success, true);

    const stateAfterA = await loadRepositoryState(workRepoDir);
    assert.equal(stateAfterA.generation, 2);
    assert.equal(stateAfterA.pet.generation, 2);
    assert.equal(stateAfterA.actions.generation, 2);
    assert.equal(stateAfterA.contributions.generation, 2);

    // 2. Path B runs: simulates passive tick & contribution sync, saving Gen 2 -> Gen 3
    stateAfterA.pet.generation = 3;
    stateAfterA.pet.xp += 20;
    stateAfterA.contributions.generation = 3;
    stateAfterA.actions.generation = 3;
    await saveRepositoryState(workRepoDir, stateAfterA);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Path B simulation update to Gen 3'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const stateAfterB = await loadRepositoryState(workRepoDir);
    assert.equal(stateAfterB.generation, 3);
    assert.equal(stateAfterB.pet.generation, 3);
    assert.equal(stateAfterB.actions.generation, 3);
    assert.equal(stateAfterB.contributions.generation, 3);

    // 3. Path A runs again: advances Gen 3 -> Gen 4
    const clientA2 = new MockGitHubInboxClient();
    clientA2.addMockIssue({
      number: 26,
      title: 'pet: rest',
      body: 'Rest action',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:rest' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T11:00:00.000Z',
      updated_at: '2026-11-16T11:00:00.000Z',
    });

    const resA2 = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client: clientA2,
      allowAnyAuthor: true,
    });
    assert.equal(resA2.success, true);

    const stateFinal = await loadRepositoryState(workRepoDir);
    assert.equal(stateFinal.generation, 4);
    assert.equal(stateFinal.pet.generation, 4);
    assert.equal(stateFinal.actions.generation, 4);
    assert.equal(stateFinal.contributions.generation, 4);
  });

  // TC-INBOX-INV-26: Manifest Allowlist Enforcement
  it('TC-INBOX-INV-26: Manifest Allowlist Enforcement', async () => {
    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 26,
      title: 'pet: feed',
      body: 'Feed',
      state: 'open',
      labels: [{ name: 'pet-action:pending' }, { name: 'pet:feed' }],
      user: { id: 100, login: 'owner' },
      created_at: '2026-11-16T10:00:00.000Z',
      updated_at: '2026-11-16T10:00:00.000Z',
    });

    // Simulate an unapproved file being modified
    const gitCalls: string[][] = [];
    const result = await executeInboxPublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      client,
      allowAnyAuthor: true,
      gitExecutor: async (cmd, args, cwd) => {
        gitCalls.push(args);
        // When diff --name-only --cached is called to inspect staged files, return an unallowed file
        if (args[0] === 'diff' && args.includes('--cached')) {
          return { stdout: 'pet/state/pet.json\nunapproved_file.ts\n', stderr: '' };
        }
        return git(args, cwd);
      },
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'manifest_violation');
    assert.ok(result.details.includes('Publication Manifest Violation'));
  });

  // TC-INBOX-INV-27: Journal Recovery Before Action Ingestion
  it('TC-INBOX-INV-27: Journal Recovery Before Action Ingestion', async () => {
    // Create an uncommitted/interrupted journal in journalDir
    const paths = getStatePaths(workRepoDir);
    await fs.mkdir(paths.journalDir, { recursive: true });
    await fs.writeFile(
      paths.journalMetaPath,
      JSON.stringify({ status: 'preparing', targetGeneration: 2 }, null, 2),
      'utf-8'
    );

    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 27,
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

    // Journal must be cleaned up / removed
    const journalExists = await fs
      .access(paths.journalDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(journalExists, false);
  });

  // TC-INBOX-INV-28: Zero Cross-Path Data Overwrite
  it('TC-INBOX-INV-28: Zero Cross-Path Data Overwrite', async () => {
    // Seed contributions.json with historical slices and accrued XP
    const state = await loadRepositoryState(workRepoDir);
    state.contributions.monotonicPublicHwm = 150;
    state.contributions.dailyAccruedXp = { '2026-11-15': 100 };
    state.contributions.slices = [
      {
        sliceId: '2026-11-15-001',
        syncDate: '2026-11-15',
        dailyOrdinal: 1,
        discoveredAt: '2026-11-15T12:00:00.000Z',
        units: 1,
        status: 'rewarded',
        rewardedXp: 100,
        rewardedSatiety: 10,
        expiryAt: '2026-11-17T00:00:00.000Z',
        evaluatedAt: '2026-11-15T12:00:00.000Z',
      },
    ];
    await saveRepositoryState(workRepoDir, state);
    await git(['add', ...PUBLICATION_MANIFEST_PATHS], workRepoDir);
    await git(['commit', '-m', 'Path B contribution data established'], workRepoDir);
    await git(['push', 'origin', 'main'], workRepoDir);

    const client = new MockGitHubInboxClient();
    client.addMockIssue({
      number: 28,
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

    // Verify all Path B contribution data remained completely intact
    const finalState = await loadRepositoryState(workRepoDir);
    assert.equal(finalState.contributions.monotonicPublicHwm, 150);
    assert.equal(finalState.contributions.dailyAccruedXp['2026-11-15'], 100);
    assert.equal(finalState.contributions.slices.length, 1);
    assert.equal(finalState.contributions.slices[0].rewardedXp, 100);
    assert.equal(finalState.contributions.generation, 2);
  });
});
