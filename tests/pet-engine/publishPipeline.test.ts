/**
 * GitHub Profile Pet — Safe Git Publication Pipeline Test Suite (Phase 3C2.2.4)
 *
 * Verifies AC-27, AC-29, and TC-PUSH-01 through TC-PUSH-10:
 * - TC-PUSH-01: Non-fast-forward rejection exits immediately with explicit conflict error (status: 'push_rejected', success: false).
 * - TC-PUSH-02: No rebase, pull, merge, or force-push is invoked on rejection.
 * - TC-PUSH-03: Concurrent writers cannot overwrite the remote branch with stale state.
 * - TC-PUSH-04: Next fresh checkout recalculates against new HEAD without duplicate XP.
 * - TC-PUSH-05: Stage 1 conflict (checkRemoteGenerationFence) prevents commit and publication.
 * - TC-PUSH-06: Unexpected staged files cause an abort (verifyStagedManifest).
 * - TC-PUSH-07: Missing expected manifest files cause an abort.
 * - TC-PUSH-08: Push failure cannot be reported as successful publication.
 * - TC-PUSH-09: Clean no-op publication creates no unnecessary commit or push.
 * - TC-PUSH-10: Successful fast-forward publication uses exact expected destination ref.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  executePublicationPipeline,
  verifyStagedManifest,
  PUBLICATION_MANIFEST_PATHS,
  REQUIRED_AUTHORITATIVE_PATHS,
  verifyRequiredAuthoritativeFiles,
} from '../../src/features/pet-engine/publication/publishPipeline.ts';
import { GitHubContributionProvider } from '../../src/features/pet-engine/contribution/index.ts';
import type {
  GitHub2DayContributionSnapshot,
  GitHubContributionSnapshot,
} from '../../src/features/pet-engine/contribution/types.ts';
import type {
  ContributionLedgerDocument,
  PetStateDocument,
  ActionLedgerDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import { saveRepositoryState } from '../../src/features/pet-engine/persistence/stateRepository.ts';

const execFileAsync = promisify(execFile);

const TEST_ENV = {
  GITHUB_REPOSITORY: 'mnp210/GitHub-Profile-Pet',
  GITHUB_REPOSITORY_OWNER: 'mnp210',
  PET_OWNER_LOGIN: 'mnp210',
  GITHUB_TOKEN: 'test-token',
};

// Helper for running git inside a specific directory
async function git(args: string[], cwd: string, env: Record<string, string | undefined> = {}): Promise<{ stdout: string; stderr: string }> {
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

function createMock2DaySnapshot(params: {
  ownerLogin?: string;
  ownerDatabaseId?: number;
  yesterdayDate: string;
  todayDate: string;
  yesterdayCounts: { commits: number; issues?: number; prs?: number; reviews?: number };
  todayCounts: { commits: number; issues?: number; prs?: number; reviews?: number };
  rateLimitRemaining?: number;
}): GitHub2DayContributionSnapshot {
  const login = params.ownerLogin ?? 'mnp210';
  const dbId = params.ownerDatabaseId ?? 298821706;

  const yesterdayPublic =
    params.yesterdayCounts.commits +
    (params.yesterdayCounts.issues ?? 0) +
    (params.yesterdayCounts.prs ?? 0) +
    (params.yesterdayCounts.reviews ?? 0);

  const todayPublic =
    params.todayCounts.commits +
    (params.todayCounts.issues ?? 0) +
    (params.todayCounts.prs ?? 0) +
    (params.todayCounts.reviews ?? 0);

  const yesterdaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: dbId,
    ownerLogin: login,
    isPersonalAccount: true,
    fromIso: `${params.yesterdayDate}T00:00:00.000Z`,
    toIso: `${params.yesterdayDate}T23:59:59.999Z`,
    retrievedAtIso: new Date().toISOString(),
    counts: {
      commits: params.yesterdayCounts.commits,
      issues: params.yesterdayCounts.issues ?? 0,
      pullRequests: params.yesterdayCounts.prs ?? 0,
      pullRequestReviews: params.yesterdayCounts.reviews ?? 0,
      publicCategoryTotal: yesterdayPublic,
      calendarReportedTotal: yesterdayPublic,
      restricted: 0,
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 100,
  };

  const todaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: dbId,
    ownerLogin: login,
    isPersonalAccount: true,
    fromIso: `${params.todayDate}T00:00:00.000Z`,
    toIso: `${params.todayDate}T23:59:59.999Z`,
    retrievedAtIso: new Date().toISOString(),
    counts: {
      commits: params.todayCounts.commits,
      issues: params.todayCounts.issues ?? 0,
      pullRequests: params.todayCounts.prs ?? 0,
      pullRequestReviews: params.todayCounts.reviews ?? 0,
      publicCategoryTotal: todayPublic,
      calendarReportedTotal: todayPublic,
      restricted: 0,
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 100,
  };

  return {
    ownerDatabaseId: dbId,
    ownerLogin: login,
    isPersonalAccount: true,
    retrievedAtIso: new Date().toISOString(),
    yesterday: yesterdaySnapshot,
    today: todaySnapshot,
    snapshots: [yesterdaySnapshot, todaySnapshot],
    rateLimit: {
      cost: 1,
      remaining: params.rateLimitRemaining ?? 4950,
      limit: 5000,
      used: 50,
      resetAt: '2026-11-15T01:00:00.000Z',
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 100,
  };
}

class StaticMockProvider extends GitHubContributionProvider {
  private snapshot: GitHub2DayContributionSnapshot;
  constructor(snapshot: GitHub2DayContributionSnapshot) {
    super();
    this.snapshot = snapshot;
  }
  override async fetchUserContributionSnapshot2Day(): Promise<GitHub2DayContributionSnapshot> {
    return this.snapshot;
  }
}

describe('Safe Git Publication Workflow Integration (Phase 3C2.2.4)', () => {
  let tempBaseDir: string;
  let remoteRepoDir: string;
  let workRepoDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-publish-test-'));
    remoteRepoDir = path.join(tempBaseDir, 'remote.git');
    workRepoDir = path.join(tempBaseDir, 'work');

    await fs.mkdir(remoteRepoDir, { recursive: true });
    await fs.mkdir(workRepoDir, { recursive: true });

    // Initialize bare remote repo with explicit default branch main
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

  // TC-PUSH-01: Non-fast-forward rejection exits immediately with error
  it('TC-PUSH-01: Non-fast-forward rejection exits immediately with explicit conflict error', async () => {
    const sourceCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    // Advance remote branch concurrently from another clone
    const cloneDir = path.join(tempBaseDir, 'concurrent-clone');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);
    await fs.writeFile(path.join(cloneDir, 'concurrent.txt'), 'concurrent change', 'utf-8');
    await git(['add', 'concurrent.txt'], cloneDir);
    await git(['commit', '-m', 'Concurrent commit on remote'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    const concurrentRemoteSha = (await git(['rev-parse', 'HEAD'], cloneDir)).stdout.trim();
    assert.notEqual(concurrentRemoteSha, sourceCommit);

    // Execute publication pipeline in workRepoDir (which still has checkout at sourceCommit)
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    // We bypass Stage 1 fence for this test to explicitly exercise Stage 2 push rejection
    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: sourceCommit }),
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'push_rejected');
    assert(result.details.includes('Publication Conflict'));
    assert(result.details.includes('rejected non-fast-forward push'));
    assert.equal(result.destinationRef, 'main');
    assert(result.error instanceof Error);

    // Verify local commit was rolled back to source commit
    const currentHead = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(currentHead, sourceCommit, 'Local HEAD must be restored to source commit SHA');
  });

  // TC-PUSH-02: No rebase, pull, merge, or force-push is invoked on rejection
  it('TC-PUSH-02: No rebase, pull, merge, or force-push is invoked on rejection', async () => {
    const sourceCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    // Track all git command invocations
    const executedCommands: Array<{ cmd: string; args: string[] }> = [];

    const gitExecutorSpy = async (cmd: string, args: string[], cwd: string) => {
      executedCommands.push({ cmd, args: [...args] });
      return git(args, cwd);
    };

    // Advance remote
    const cloneDir = path.join(tempBaseDir, 'clone-spy');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);
    await fs.writeFile(path.join(cloneDir, 'concurrent.txt'), 'advance', 'utf-8');
    await git(['add', 'concurrent.txt'], cloneDir);
    await git(['commit', '-m', 'Concurrent commit'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 2 },
        todayCounts: { commits: 0 },
      })
    );

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      gitExecutor: gitExecutorSpy,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: sourceCommit }),
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'push_rejected');

    // Inspect all executed git commands
    for (const { args } of executedCommands) {
      assert.notEqual(args[0], 'rebase', 'Must NEVER execute git rebase');
      assert.notEqual(args[0], 'pull', 'Must NEVER execute git pull');
      assert.notEqual(args[0], 'merge', 'Must NEVER execute git merge');
      for (const arg of args) {
        assert(!arg.includes('--force'), 'Must NEVER include --force');
        assert(!arg.includes('--force-with-lease'), 'Must NEVER include --force-with-lease');
        assert(!arg.startsWith('+'), 'Must NEVER use refspec force prefix (+)');
      }
    }
  });

  // TC-PUSH-03: Concurrent writers cannot overwrite the remote branch with stale state
  it('TC-PUSH-03: Concurrent writers cannot overwrite the remote branch with stale state', async () => {
    // Clone and advance remote with authoritative concurrent state
    const cloneDir = path.join(tempBaseDir, 'clone-writer');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);
    await fs.writeFile(path.join(cloneDir, 'concurrent.txt'), 'writer content', 'utf-8');
    await git(['add', 'concurrent.txt'], cloneDir);
    await git(['commit', '-m', 'Authoritative concurrent update'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    const expectedRemoteSha = (await git(['rev-parse', 'HEAD'], cloneDir)).stdout.trim();

    // Now workRepoDir attempts publication
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: 'dummy' }),
    });

    // Check remote bare repo HEAD commit
    const actualRemoteSha = (await git(['rev-parse', 'main'], remoteRepoDir)).stdout.trim();
    assert.equal(actualRemoteSha, expectedRemoteSha, 'Remote branch must remain at authoritative concurrent SHA');
  });

  // TC-PUSH-04: Next fresh checkout recalculates against new HEAD without duplicate XP
  it('TC-PUSH-04: Next fresh checkout recalculates against new HEAD without duplicate XP', async () => {
    // Step 1: Work repo 1 attempts push and is rejected
    const cloneDir = path.join(tempBaseDir, 'concurrent-advance');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);
    await fs.writeFile(path.join(cloneDir, 'extra.txt'), 'extra', 'utf-8');
    await git(['add', 'extra.txt'], cloneDir);
    await git(['commit', '-m', 'Extra commit'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    const run1 = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: 'dummy' }),
    });
    assert.equal(run1.success, false);

    // Step 2: Next run obtains fresh checkout from the updated remote HEAD
    const freshCloneDir = path.join(tempBaseDir, 'fresh-checkout');
    await git(['clone', '-b', 'main', remoteRepoDir, freshCloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], freshCloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], freshCloneDir);

    // Execute publication pipeline in fresh clone
    const run2 = await executePublicationPipeline({
      baseDir: freshCloneDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(run2.success, true);
    assert.equal(run2.status, 'published');
    assert.equal(run2.syncResult?.xpAwarded, 0, 'Baseline on pristine ledger awards 0 retroactive XP');
    assert.equal(run2.syncResult?.status, 'baseline_established');

    // Confirm remote branch advanced to run2 commit
    const remoteHead = (await git(['rev-parse', 'main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteHead, run2.commitSha);
  });

  // TC-PUSH-05: Stage 1 conflict (checkRemoteGenerationFence) prevents commit and publication
  it('TC-PUSH-05: Stage 1 conflict (checkRemoteGenerationFence) prevents commit and publication', async () => {
    const sourceCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    // Fence check reports remote advanced
    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      sourceCommitSha: sourceCommit,
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({
        matches: false,
        currentRemoteSha: 'remote-advanced-sha-12345',
      }),
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'stage_1_fence_conflict');
    assert(result.details.includes('Remote generation advanced after checkout'));

    // Verify no commit was made
    const currentHead = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(currentHead, sourceCommit);

    // Verify working tree is clean
    const status = (await git(['status', '--porcelain'], workRepoDir)).stdout.trim();
    assert.equal(status, '', 'Working tree manifest files must be restored cleanly');
  });

  // TC-PUSH-06: Manifest validation aborts immediately if unexpected files are staged
  it('TC-PUSH-06: Manifest validation aborts immediately if unexpected files are staged', async () => {
    // 1. Direct unit check on verifyStagedManifest
    const directCheck = verifyStagedManifest([
      'pet/state/pet.json',
      'pet/ledger/contributions.json',
      'unauthorized-secret.key',
    ]);
    assert.equal(directCheck.valid, false);
    assert.deepEqual(directCheck.unexpectedPaths, ['unauthorized-secret.key']);
    assert(directCheck.message?.includes('Publication Manifest Violation'));

    // 2. Integration check with pipeline: create and stage an unexpected file prior to run
    const unexpectedFile = path.join(workRepoDir, 'unexpected.txt');
    await fs.writeFile(unexpectedFile, 'danger', 'utf-8');
    await git(['add', 'unexpected.txt'], workRepoDir);

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      skipCleanPreflight: true, // Bypass preflight to exercise manifest validator explicitly
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: 'dummy' }),
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'manifest_violation');
    assert(result.details.includes('unexpected.txt'));

    // Verify staging area was unstaged
    const stagedDiff = (await git(['diff', '--name-only', '--cached'], workRepoDir)).stdout.trim();
    assert.equal(stagedDiff, '', 'Staging area must be reset on manifest violation');
  });

  // TC-PUSH-07: Manifest validation aborts immediately if expected files are missing
  it('TC-PUSH-07: Manifest validation aborts immediately if expected files are missing', () => {
    const check = verifyStagedManifest(
      ['public/pet.svg'],
      ['public/pet.svg', 'pet/state/pet.json']
    );
    assert.equal(check.valid, false);
    assert.deepEqual(check.missingPaths, ['pet/state/pet.json']);
    assert(check.message?.includes('Expected modified manifest files are missing from staging'));
  });

  // TC-PUSH-08: Push failure cannot be reported as successful publication
  it('TC-PUSH-08: Push failure cannot be reported as successful publication', async () => {
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    // Force push failure by pointing to non-existent remote
    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'nonexistent-remote',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: 'dummy' }),
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'push_rejected');
    assert.equal(result.commitSha, undefined, 'Must not return published commitSha on push failure');
    assert(result.error instanceof Error);
  });

  // TC-PUSH-09: Clean no-op publication creates no unnecessary commit or push
  it('TC-PUSH-09: Clean no-op publication creates no unnecessary commit or push', async () => {
    const sourceCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    const testTimeMs = new Date('2026-11-15T12:00:00.000Z').getTime();

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 0 },
        todayCounts: { commits: 0 },
      })
    );

    // First run establishes baseline
    await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      nowMs: testTimeMs,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: sourceCommit }),
    });

    const baselineCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    // Second run immediately with identical snapshot and timestamp -> clean no-op
    const noopResult = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      nowMs: testTimeMs, // zero elapsed time
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: baselineCommit }),
    });

    assert.equal(noopResult.success, true);
    assert.equal(noopResult.status, 'noop');
    assert(noopResult.details.includes('Clean no-op; skipping commit and push'));

    // Check HEAD did not move
    const afterHead = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(afterHead, baselineCommit, 'No unnecessary commit must be created on clean no-op');
  });

  // TC-PUSH-10: Successful fast-forward publication uses exact expected destination ref
  it('TC-PUSH-10: Successful fast-forward publication uses exact expected destination ref', async () => {
    const sourceCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: sourceCommit }),
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.destinationRef, 'main');
    assert(typeof result.commitSha === 'string' && result.commitSha.length > 0);

    // Verify commit metadata
    const commitMsg = (await git(['log', '-1', '--pretty=%B'], workRepoDir)).stdout.trim();
    assert(commitMsg.includes('[skip ci]'), 'Commit message must include [skip ci]');

    const authorName = (await git(['log', '-1', '--pretty=%an'], workRepoDir)).stdout.trim();
    assert.equal(authorName, 'github-actions[bot]');

    // Verify remote branch updated to new commit
    const remoteMainSha = (await git(['rev-parse', 'main'], remoteRepoDir)).stdout.trim();
    assert.equal(remoteMainSha, result.commitSha, 'Remote main must point to new commit');
  });

  // TC-PUSH-11: CLI entry point (scripts/publish-pipeline.ts) exits cleanly on dry-run and exits 1 on failure
  it('TC-PUSH-11: CLI entry point (scripts/publish-pipeline.ts) handles arguments and exit codes safely', async () => {
    const scriptPath = path.join(process.cwd(), 'scripts', 'publish-pipeline.ts');

    const { parseArgs } = await import('../../scripts/publish-pipeline.ts');

    // 1. Direct unit check on parseArgs
    const parsed = parseArgs([
      '--ref',
      'feature/pet-update',
      '--remote',
      'upstream',
      '--dry-run',
      '--skip-push',
      '--base-dir',
      '/custom/path',
    ]);
    assert.equal(parsed.refName, 'feature/pet-update');
    assert.equal(parsed.gitRemote, 'upstream');
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.skipPush, true);
    assert.equal(parsed.baseDir, '/custom/path');

    // 2. Subprocess check on --help (exits code 0)
    const helpRes = await execFileAsync(
      process.execPath,
      ['--experimental-strip-types', scriptPath, '--help'],
      { cwd: process.cwd() }
    );
    assert(helpRes.stdout.includes('Usage: node --experimental-strip-types scripts/publish-pipeline.ts'));

    // Test 2: Execution without GITHUB_TOKEN exits 1 with ::error::
    let failedCleanly = false;
    try {
      await execFileAsync(
        process.execPath,
        ['--experimental-strip-types', scriptPath, '--base-dir', workRepoDir],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            GITHUB_TOKEN: '',
            TEST_TOKEN: '',
          },
        }
      );
    } catch (err: unknown) {
      failedCleanly = true;
      const error = err as Error & { stderr?: string; stdout?: string; code?: number };
      assert.equal(error.code, 1);
      const combined = `${error.stdout ?? ''} ${error.stderr ?? ''}`;
      assert(combined.includes('::error::[publish-pipeline] Publication failed'));
    }
    assert.equal(failedCleanly, true, 'CLI must exit with code 1 and emit ::error:: on failure');
  });

  // =========================================================================
  // F-01: Clean Working-Tree Preflight and Rollback Safety Tests
  // =========================================================================

  it('TC-PUSH-F01-01: Dirty tracked file in working tree is rejected before provider/simulation with dirty_working_tree', async () => {
    // Modify tracked README.md
    await fs.writeFile(path.join(workRepoDir, 'README.md'), '# Modified README', 'utf-8');

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'dirty_working_tree');
    assert(result.details.includes('Dirty working tree detected'));
    assert(result.details.includes('README.md'));
    assert.equal(providerCalled, false, 'Provider must not be invoked when preflight detects dirty working tree');
  });

  it('TC-PUSH-F01-02: Untracked file in working tree is rejected before provider/simulation with dirty_working_tree', async () => {
    // Create untracked file
    await fs.writeFile(path.join(workRepoDir, 'untracked_note.txt'), 'some draft notes', 'utf-8');

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'dirty_working_tree');
    assert(result.details.includes('Dirty working tree detected'));
    assert(result.details.includes('untracked_note.txt'));
    assert.equal(providerCalled, false, 'Provider must not be invoked when untracked files are present');
  });

  it('TC-PUSH-F01-03: Clean working tree passes preflight successfully', async () => {
    const statusBefore = (await git(['status', '--porcelain', '--untracked-files=all'], workRepoDir)).stdout.trim();
    assert.equal(statusBefore, '', 'Working tree must start clean');

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
  });

  it('TC-PUSH-F01-04: Push rejection preserves the initial clean working-tree invariant and does not destroy files', async () => {
    const sourceCommit = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();

    // Advance remote to cause non-fast-forward push rejection
    const cloneDir = path.join(tempBaseDir, 'remote-advancer');
    await git(['clone', '-b', 'main', remoteRepoDir, cloneDir], tempBaseDir);
    await git(['config', 'user.name', 'github-actions[bot]'], cloneDir);
    await git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cloneDir);
    await fs.writeFile(path.join(cloneDir, 'advance.txt'), 'advance', 'utf-8');
    await git(['add', 'advance.txt'], cloneDir);
    await git(['commit', '-m', 'Advance remote'], cloneDir);
    await git(['push', 'origin', 'main'], cloneDir);

    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      remoteFenceCheck: async () => ({ matches: true, currentRemoteSha: sourceCommit }),
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'push_rejected');

    // Verify working tree returned to exactly the clean state at sourceCommit
    const currentHead = (await git(['rev-parse', 'HEAD'], workRepoDir)).stdout.trim();
    assert.equal(currentHead, sourceCommit, 'HEAD must be reset to initial source commit');
    const statusAfter = (await git(['status', '--porcelain', '--untracked-files=all'], workRepoDir)).stdout.trim();
    assert.equal(statusAfter, '', 'Working tree must remain completely clean after rollback');

    // Verify all authoritative files still exist and are valid
    for (const relPath of REQUIRED_AUTHORITATIVE_PATHS) {
      const fullPath = path.join(workRepoDir, relPath);
      const stat = await fs.stat(fullPath);
      assert(stat.isFile(), `Authoritative file ${relPath} must exist and be a regular file`);
    }
  });

  // =========================================================================
  // F-02: Branch and Destination Verification Tests
  // =========================================================================

  it('TC-PUSH-F02-01: Matching local branch and destination ref succeeds', async () => {
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );

    // refs/heads/main format
    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'refs/heads/main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'published');
    assert.equal(result.destinationRef, 'main');
  });

  it('TC-PUSH-F02-02: Mismatched local branch and destination ref fails closed before provider/simulation', async () => {
    // Switch to another branch
    await git(['checkout', '-b', 'feature/test-branch'], workRepoDir);

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'branch_mismatch');
    assert(result.details.includes('Checked-out branch "feature/test-branch" does not match target destination branch "main"'));
    assert.equal(providerCalled, false, 'Provider must not be called on branch mismatch');

    // Switch back to main for clean teardown
    await git(['checkout', 'main'], workRepoDir);
  });

  it('TC-PUSH-F02-03: Detached HEAD state fails closed before provider/simulation with branch_mismatch', async () => {
    // Detach HEAD
    await git(['checkout', '--detach', 'HEAD'], workRepoDir);

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'branch_mismatch');
    assert(result.details.includes('detached HEAD state'));
    assert.equal(providerCalled, false, 'Provider must not be called in detached HEAD');

    // Reattach main
    await git(['checkout', 'main'], workRepoDir);
  });

  it('TC-PUSH-F02-04: Invalid or empty destination ref fails closed before provider/simulation', async () => {
    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: '',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'branch_mismatch');
    assert(result.details.includes('Invalid or empty destination branch ref'));
    assert.equal(providerCalled, false);
  });

  // =========================================================================
  // F-03: Required Authoritative Files Existence and Zero Auto-Replacement Tests
  // =========================================================================

  it('TC-PUSH-F03-01: Missing pet/state/pet.json fails closed before provider/simulation', async () => {
    // Delete pet/state/pet.json
    const petJsonPath = path.join(workRepoDir, 'pet', 'state', 'pet.json');
    await fs.unlink(petJsonPath);

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      skipCleanPreflight: true, // bypass F-01 so F-03 is specifically tested
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'missing_authoritative_file');
    assert(result.details.includes('pet/state/pet.json'));
    assert.equal(providerCalled, false);

    // Verify zero automatic replacement: file MUST NOT have been recreated
    let exists = false;
    try {
      await fs.stat(petJsonPath);
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'Missing pet/state/pet.json must NOT be auto-replaced on disk');
  });

  it('TC-PUSH-F03-02: Missing pet/ledger/contributions.json fails closed before provider/simulation', async () => {
    const contribPath = path.join(workRepoDir, 'pet', 'ledger', 'contributions.json');
    await fs.unlink(contribPath);

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      skipCleanPreflight: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'missing_authoritative_file');
    assert(result.details.includes('pet/ledger/contributions.json'));
    assert.equal(providerCalled, false);

    let exists = false;
    try {
      await fs.stat(contribPath);
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'Missing pet/ledger/contributions.json must NOT be auto-replaced on disk');
  });

  it('TC-PUSH-F03-03: Missing pet/ledger/actions.json fails closed before provider/simulation', async () => {
    const actionsPath = path.join(workRepoDir, 'pet', 'ledger', 'actions.json');
    await fs.unlink(actionsPath);

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      skipCleanPreflight: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'missing_authoritative_file');
    assert(result.details.includes('pet/ledger/actions.json'));
    assert.equal(providerCalled, false);

    let exists = false;
    try {
      await fs.stat(actionsPath);
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'Missing pet/ledger/actions.json must NOT be auto-replaced on disk');
  });

  it('TC-PUSH-F03-04: Missing public/pet.svg fails closed before provider/simulation', async () => {
    const svgPath = path.join(workRepoDir, 'public', 'pet.svg');
    await fs.unlink(svgPath);

    let providerCalled = false;
    const provider = new StaticMockProvider(
      createMock2DaySnapshot({
        yesterdayDate: '2026-11-14',
        todayDate: '2026-11-15',
        yesterdayCounts: { commits: 1 },
        todayCounts: { commits: 0 },
      })
    );
    provider.fetchUserContributionSnapshot2Day = async () => {
      providerCalled = true;
      return createMock2DaySnapshot({ yesterdayDate: '2026-11-14', todayDate: '2026-11-15', yesterdayCounts: { commits: 0 }, todayCounts: { commits: 0 } });
    };

    const result = await executePublicationPipeline({
      baseDir: workRepoDir,
      refName: 'main',
      gitRemote: 'origin',
      token: 'test-token',
      env: TEST_ENV,
      provider,
      skipCleanPreflight: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'missing_authoritative_file');
    assert(result.details.includes('public/pet.svg'));
    assert.equal(providerCalled, false);

    let exists = false;
    try {
      await fs.stat(svgPath);
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false, 'Missing public/pet.svg must NOT be auto-replaced on disk');
  });

  it('TC-PUSH-F03-05: Direct unit test for verifyRequiredAuthoritativeFiles detects missing authoritative documents', async () => {
    const emptyTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-authoritative-test-'));
    try {
      const checkAllMissing = await verifyRequiredAuthoritativeFiles(emptyTestDir);
      assert.equal(checkAllMissing.valid, false);
      assert.equal(checkAllMissing.missingFiles.length, 4);
      assert(checkAllMissing.message?.includes('pet/state/pet.json'));
      assert(checkAllMissing.message?.includes('pet/ledger/contributions.json'));
      assert(checkAllMissing.message?.includes('pet/ledger/actions.json'));
      assert(checkAllMissing.message?.includes('public/pet.svg'));

      // Create only 1 file
      await fs.mkdir(path.join(emptyTestDir, 'public'), { recursive: true });
      await fs.writeFile(path.join(emptyTestDir, 'public', 'pet.svg'), '<svg></svg>', 'utf-8');

      const checkPartial = await verifyRequiredAuthoritativeFiles(emptyTestDir);
      assert.equal(checkPartial.valid, false);
      assert.equal(checkPartial.missingFiles.length, 3);
      assert(!checkPartial.missingFiles.includes('public/pet.svg'));
    } finally {
      await fs.rm(emptyTestDir, { recursive: true, force: true });
    }
  });
});
