/**
 * Phase 3C2.3-B2-R3.38 — Fresh-Fork Onboarding Remediation Regression Test Suite
 *
 * Verifies all 3 onboarding defect remediations:
 * - P1-01: Foreign fork baseline reinitialization resets inherited upstream state cleanly and transactionally
 * - P1-02: README marker uniqueness ensures publication never encounters MalformedReadmeMarkersError
 * - P1-03: Nullable timestamp contract for pristine templates vs established pets
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
import { executeBaselinePipeline } from '../../src/features/pet-engine/publication/baselinePipeline.ts';
import {
  loadRepositoryState,
  saveRepositoryState,
  getStatePaths,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import { validatePetState } from '../../src/features/pet-engine/validation/stateValidator.ts';
import { isPristineContributionLedger } from '../../src/features/pet-engine/validation/ledgerValidator.ts';
import {
  updateReadmeMenuContent,
  README_MENU_MARKER_START,
  README_MENU_MARKER_END,
} from '../../src/features/pet-engine/publication/readmeMenu.ts';
import { ENGINE_SCHEMA_VERSION } from '../../src/features/pet-engine/domain/constants.ts';
import type {
  PetStateDocument,
  ContributionLedgerDocument,
  ActionLedgerDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import type {
  GitHubContributionSnapshot,
  GitHub2DayContributionSnapshot,
} from '../../src/features/pet-engine/contribution/types.ts';
import { GitHubContributionProvider } from '../../src/features/pet-engine/contribution/contributionProvider.ts';

function createMockSnapshot(params: {
  login: string;
  databaseId: number;
  yesterdayDate?: string;
  todayDate?: string;
  yesterdayCommits?: number;
  todayCommits?: number;
}): GitHub2DayContributionSnapshot {
  const yDate = params.yesterdayDate ?? '2026-11-18';
  const tDate = params.todayDate ?? '2026-11-19';
  const yCommits = params.yesterdayCommits ?? 2;
  const tCommits = params.todayCommits ?? 3;

  const yesterdaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: params.databaseId,
    ownerLogin: params.login,
    isPersonalAccount: true,
    fromIso: `${yDate}T00:00:00.000Z`,
    toIso: `${yDate}T23:59:59.999Z`,
    retrievedAtIso: new Date().toISOString(),
    counts: {
      commits: yCommits,
      issues: 0,
      pullRequests: 0,
      pullRequestReviews: 0,
      publicCategoryTotal: yCommits,
      calendarReportedTotal: yCommits,
      restricted: 0,
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 50,
  };

  const todaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: params.databaseId,
    ownerLogin: params.login,
    isPersonalAccount: true,
    fromIso: `${tDate}T00:00:00.000Z`,
    toIso: `${tDate}T23:59:59.999Z`,
    retrievedAtIso: new Date().toISOString(),
    counts: {
      commits: tCommits,
      issues: 0,
      pullRequests: 0,
      pullRequestReviews: 0,
      publicCategoryTotal: tCommits,
      calendarReportedTotal: tCommits,
      restricted: 0,
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 50,
  };

  return {
    ownerDatabaseId: params.databaseId,
    ownerLogin: params.login,
    isPersonalAccount: true,
    retrievedAtIso: new Date().toISOString(),
    yesterday: yesterdaySnapshot,
    today: todaySnapshot,
    snapshots: [yesterdaySnapshot, todaySnapshot],
    rateLimit: {
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-19T18:00:00Z',
      headers: {
        limit: 5000,
        remaining: 4999,
        used: 1,
        reset: 1795005600,
        resource: 'graphql',
      },
      consistency: {
        isConsistent: true,
        discrepancies: [],
      },
    },
    authenticationMode: 'mode_a_public',
    providerLatencyMs: 50,
  };
}

class MockContributionProvider extends GitHubContributionProvider {
  public mockResponse?: GitHub2DayContributionSnapshot;
  public mockError?: Error;

  constructor(mockResponse?: GitHub2DayContributionSnapshot, mockError?: Error) {
    super();
    this.mockResponse = mockResponse;
    this.mockError = mockError;
  }

  public override async fetchUserContributionSnapshot2Day(): Promise<GitHub2DayContributionSnapshot> {
    if (this.mockError) {
      throw this.mockError;
    }
    if (!this.mockResponse) {
      throw new Error('No mock response configured in MockContributionProvider');
    }
    return this.mockResponse;
  }
}

const mockGitExecutor = async (_cmd: string, args: string[]) => {
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
    return { stdout: '0123456789abcdef0123456789abcdef01234567\n', stderr: '' };
  }
  if (args[0] === 'status') {
    return { stdout: '', stderr: '' };
  }
  if (args[0] === 'branch') {
    return { stdout: 'main\n', stderr: '' };
  }
  return { stdout: '', stderr: '' };
};

describe('Phase 3C2.3-B2-R3.38 — Onboarding Remediation Regression Suite', () => {
  // --------------------------------------------------------------------------
  // P1-01: Foreign Fork Baseline Reinitialization & Transactional Reset
  // --------------------------------------------------------------------------
  it('P1-01-A: Reinitializes inherited upstream state (Gen 3, Level 2, 55 XP, 4 slices) cleanly for new owner', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r338-p101-a-'));
    try {
      // Simulate production upstream state (mnp210/GitHub-Profile-Pet)
      const upstreamPet: PetStateDocument = {
        schemaVersion: ENGINE_SCHEMA_VERSION,
        generation: 3,
        name: 'Shadow Claw',
        species: 'cat',
        level: 2,
        xp: 55,
        maxExp: 150,
        energy: 90,
        energyAccumulator: 0,
        hunger: 80,
        hungerDecayAccumulator: 0,
        happiness: 85,
        happinessDecayAccumulator: 0,
        mood: 'Happy',
        evolutionStage: 'Juvenile',
        lastInteractionTime: '2026-11-18T10:00:00.000Z',
        lastOfflineResolutionTime: '2026-11-18T10:00:00.000Z',
        lastSimulatedAt: '2026-11-18T10:00:00.000Z',
        lastWelcomeBonusClaimedAt: null,
        updatedAt: '2026-11-18T10:00:00.000Z',
      };

      const upstreamContrib: ContributionLedgerDocument = {
        schemaVersion: ENGINE_SCHEMA_VERSION,
        generation: 3,
        ownerDatabaseId: 298821706,
        ownerLogin: 'mnp210',
        installationBaseline: {
          completed: true,
          installedAt: '2026-11-18T00:00:00.000Z',
          baselineDateUtc: '2026-11-18',
          initialCounts: { yesterday: 5, today: 10 },
        },
        dailyHwm: { '2026-11-18': 10 },
        dailyRewardOrdinal: { '2026-11-18': 4 },
        dailyAccruedXp: { '2026-11-18': 40 },
        hourlyIncrementUsage: { '2026-11-18T10': 2 },
        hourlySliceUsage: { '2026-11-18T10': 2 },
        monotonicPublicHwm: 10,
        slices: [
          {
            sliceId: 'slice-1',
            syncDate: '2026-11-18',
            dailyOrdinal: 1,
            discoveredAt: '2026-11-18T10:00:00.000Z',
            units: 1,
            status: 'rewarded',
            rewardedXp: 10,
            rewardedSatiety: 5,
            expiryAt: '2026-11-20T00:00:00.000Z',
            evaluatedAt: '2026-11-18T10:00:00.000Z',
          },
        ],
        monthlyHistoricalSummary: [],
      };

      const upstreamActions: ActionLedgerDocument = {
        schemaVersion: ENGINE_SCHEMA_VERSION,
        generation: 3,
        recentActions: [
          { action: 'feed', timestamp: Date.now() - 3600000, requestId: 'issue-10' },
        ],
        processedRequestRegistry: {
          highWaterIssueNumber: 10,
          sparseProcessedIssueNumbers: [],
          retiredNonActionGaps: [],
          unresolvedGaps: [],
        },
        pendingFeedback: [],
      };

      await saveRepositoryState(tempDir, {
        pet: upstreamPet,
        contributions: upstreamContrib,
        actions: upstreamActions,
      });

      const provider = new MockContributionProvider(
        createMockSnapshot({
          login: 'alice-dev',
          databaseId: 445566,
          yesterdayCommits: 3,
          todayCommits: 2,
        })
      );

      const nowMs = new Date('2026-11-19T12:00:00.000Z').getTime();
      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'alice-dev',
        expectedOwnerDatabaseId: 445566,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
        nowMs,
      });

      assert.equal(res.success, true, res.details);
      assert.equal(res.status, 'baseline_established', res.details);

      // Verify loaded state after reinitialization
      const loaded = await loadRepositoryState(tempDir);

      // Pet must be reset to Hatchling Level 1, 0 XP, generation 2 (pristine reset at 1, advanced by baseline commit)
      assert.equal(loaded.generation, 2);
      assert.equal(loaded.pet.generation, 2);
      assert.equal(loaded.pet.level, 1);
      assert.equal(loaded.pet.xp, 0);
      assert.equal(loaded.pet.maxExp, 100);
      assert.equal(loaded.pet.evolutionStage, 'Hatchling');
      assert.equal(loaded.pet.lastInteractionTime, null);
      assert.equal(loaded.pet.lastSimulatedAt, null);

      // Contributions bound to Alice
      assert.equal(loaded.contributions.ownerDatabaseId, 445566);
      assert.equal(loaded.contributions.ownerLogin, 'alice-dev');
      assert.equal(loaded.contributions.installationBaseline?.completed, true);
      assert.equal(loaded.contributions.installationBaseline.initialCounts.yesterday, 3);
      assert.equal(loaded.contributions.installationBaseline.initialCounts.today, 2);
      assert.equal(loaded.contributions.slices.length, 0);
      assert.equal(loaded.contributions.monotonicPublicHwm, 3);

      // Actions clean
      assert.equal(loaded.actions.recentActions.length, 0);
      assert.equal(loaded.actions.processedRequestRegistry.highWaterIssueNumber, 0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('P1-01-B: Refuses foreign reinitialization when reinitializeForeignFork is false', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r338-p101-b-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: {
          schemaVersion: 1,
          generation: 1,
          name: 'Shadow Claw',
          species: 'cat',
          level: 1,
          xp: 0,
          maxExp: 100,
          energy: 100,
          energyAccumulator: 0,
          hunger: 70,
          hungerDecayAccumulator: 0,
          happiness: 70,
          happinessDecayAccumulator: 0,
          mood: 'Happy',
          evolutionStage: 'Hatchling',
          lastInteractionTime: '2026-11-18T10:00:00Z',
          lastOfflineResolutionTime: '2026-11-18T10:00:00Z',
          lastSimulatedAt: null,
          lastWelcomeBonusClaimedAt: null,
          updatedAt: '2026-11-18T10:00:00Z',
        },
        contributions: {
          schemaVersion: 1,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T00:00:00Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: 1,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const provider = new MockContributionProvider(
        createMockSnapshot({ login: 'bob', databaseId: 999, yesterdayCommits: 0, todayCommits: 0 })
      );

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'bob',
        expectedOwnerDatabaseId: 999,
        reinitializeForeignFork: false,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'baseline_refused');
      assert.match(res.details, /Inherited foreign baseline detected/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('P1-01-C: Anti-wipe guard: same owner cannot wipe their own established baseline via reinitializeForeignFork', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r338-p101-c-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: {
          schemaVersion: 1,
          generation: 2,
          name: 'Shadow Claw',
          species: 'cat',
          level: 2,
          xp: 20,
          maxExp: 150,
          energy: 80,
          energyAccumulator: 0,
          hunger: 80,
          hungerDecayAccumulator: 0,
          happiness: 80,
          happinessDecayAccumulator: 0,
          mood: 'Happy',
          evolutionStage: 'Hatchling',
          lastInteractionTime: '2026-11-18T10:00:00Z',
          lastOfflineResolutionTime: '2026-11-18T10:00:00Z',
          lastSimulatedAt: null,
          lastWelcomeBonusClaimedAt: null,
          updatedAt: '2026-11-18T10:00:00Z',
        },
        contributions: {
          schemaVersion: 1,
          generation: 2,
          ownerDatabaseId: 445566,
          ownerLogin: 'alice-dev',
          installationBaseline: { completed: true, installedAt: '2026-11-18T00:00:00Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: 1,
          generation: 2,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const provider = new MockContributionProvider(
        createMockSnapshot({ login: 'alice-dev', databaseId: 445566, yesterdayCommits: 5, todayCommits: 5 })
      );

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'alice-dev',
        expectedOwnerDatabaseId: 445566,
        reinitializeForeignFork: true, // Should still be refused because owner matches!
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'baseline_refused');
      assert.match(res.details, /already been established for this repository owner/);

      // Verify state was NOT modified
      const loaded = await loadRepositoryState(tempDir);
      assert.equal(loaded.pet.xp, 20);
      assert.equal(loaded.generation, 2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('P1-01-D: Refuses reinitialization if active concurrency lock exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r338-p101-d-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

      // Create dummy lock file
      await fs.writeFile(paths.lockPath, JSON.stringify({ pid: 12345, createdAt: Date.now() }), 'utf-8');

      const upstreamContrib: ContributionLedgerDocument = {
        schemaVersion: 1,
        generation: 1,
        ownerDatabaseId: 298821706,
        ownerLogin: 'mnp210',
        installationBaseline: { completed: true, installedAt: '2026-11-18T00:00:00Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
        dailyHwm: {},
        dailyRewardOrdinal: {},
        dailyAccruedXp: {},
        monotonicPublicHwm: 0,
        slices: [],
        monthlyHistoricalSummary: [],
      };
      await fs.writeFile(paths.contributionsPath, JSON.stringify(upstreamContrib, null, 2), 'utf-8');

      const provider = new MockContributionProvider(
        createMockSnapshot({ login: 'alice-dev', databaseId: 445566, yesterdayCommits: 1, todayCommits: 1 })
      );

      const nowMs = new Date('2026-11-19T12:00:00.000Z').getTime();
      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'alice-dev',
        expectedOwnerDatabaseId: 445566,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
        nowMs,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'integrity_failed');
      assert.match(res.details, /Active lock file detected/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('P1-01-E: Refuses reinitialization if uncommitted transaction journal exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r338-p101-e-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(paths.journalDir, { recursive: true });
      await fs.writeFile(path.join(paths.journalDir, 'source.json'), '{}', 'utf-8');
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

      const upstreamContrib: ContributionLedgerDocument = {
        schemaVersion: 1,
        generation: 1,
        ownerDatabaseId: 298821706,
        ownerLogin: 'mnp210',
        installationBaseline: { completed: true, installedAt: '2026-11-18T00:00:00Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
        dailyHwm: {},
        dailyRewardOrdinal: {},
        dailyAccruedXp: {},
        monotonicPublicHwm: 0,
        slices: [],
        monthlyHistoricalSummary: [],
      };
      await fs.writeFile(paths.contributionsPath, JSON.stringify(upstreamContrib, null, 2), 'utf-8');

      const provider = new MockContributionProvider(
        createMockSnapshot({ login: 'alice-dev', databaseId: 445566, yesterdayCommits: 1, todayCommits: 1 })
      );

      const nowMs = new Date('2026-11-19T12:00:00.000Z').getTime();
      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'alice-dev',
        expectedOwnerDatabaseId: 445566,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
        nowMs,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'integrity_failed');
      assert.match(res.details, /Active or uncommitted transaction journal detected/);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('P1-01-F: Full atomic rollback: restores pet, contributions, and actions byte-for-byte on provider failure', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r338-p101-f-'));
    try {
      const originalPet: PetStateDocument = {
        schemaVersion: 1,
        generation: 3,
        name: 'Shadow Claw',
        species: 'cat',
        level: 2,
        xp: 55,
        maxExp: 150,
        energy: 90,
        energyAccumulator: 0,
        hunger: 80,
        hungerDecayAccumulator: 0,
        happiness: 85,
        happinessDecayAccumulator: 0,
        mood: 'Happy',
        evolutionStage: 'Juvenile',
        lastInteractionTime: '2026-11-18T10:00:00.000Z',
        lastOfflineResolutionTime: '2026-11-18T10:00:00.000Z',
        lastSimulatedAt: '2026-11-18T10:00:00.000Z',
        lastWelcomeBonusClaimedAt: null,
        updatedAt: '2026-11-18T10:00:00.000Z',
      };

      const originalContrib: ContributionLedgerDocument = {
        schemaVersion: 1,
        generation: 3,
        ownerDatabaseId: 298821706,
        ownerLogin: 'mnp210',
        installationBaseline: { completed: true, installedAt: '2026-11-18T00:00:00Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 5, today: 10 } },
        dailyHwm: { '2026-11-18': 10 },
        dailyRewardOrdinal: { '2026-11-18': 4 },
        dailyAccruedXp: { '2026-11-18': 40 },
        monotonicPublicHwm: 10,
        slices: [],
        monthlyHistoricalSummary: [],
      };

      const originalActions: ActionLedgerDocument = {
        schemaVersion: 1,
        generation: 3,
        recentActions: [{ action: 'feed', timestamp: 1731920000000, requestId: 'issue-1' }],
        processedRequestRegistry: { highWaterIssueNumber: 1, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
      };

      await saveRepositoryState(tempDir, {
        pet: originalPet,
        contributions: originalContrib,
        actions: originalActions,
      });

      const paths = getStatePaths(tempDir);
      const petBytesBefore = await fs.readFile(paths.petPath, 'utf-8');
      const contribBytesBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
      const actionsBytesBefore = await fs.readFile(paths.actionsPath, 'utf-8');

      // Provider throws fatal GraphQL error
      const failingProvider = new MockContributionProvider(
        undefined,
        new Error('GitHub GraphQL Connection Timed Out')
      );

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider: failingProvider,
        token: 'fake-token',
        targetOwnerLogin: 'alice-dev',
        expectedOwnerDatabaseId: 445566,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'provider_failed');

      // Verify all 3 files are restored byte-for-byte!
      const petBytesAfter = await fs.readFile(paths.petPath, 'utf-8');
      const contribBytesAfter = await fs.readFile(paths.contributionsPath, 'utf-8');
      const actionsBytesAfter = await fs.readFile(paths.actionsPath, 'utf-8');

      assert.equal(petBytesAfter, petBytesBefore, 'pet.json must be restored byte-for-byte');
      assert.equal(contribBytesAfter, contribBytesBefore, 'contributions.json must be restored byte-for-byte');
      assert.equal(actionsBytesAfter, actionsBytesBefore, 'actions.json must be restored byte-for-byte');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // P1-02: README Marker Collision Prevention
  // --------------------------------------------------------------------------
  it('P1-02-A: Repository README has exactly 1 operational marker pair', async () => {
    const readmePath = path.join(repoRoot, 'README.md');
    const content = await fs.readFile(readmePath, 'utf-8');

    const startMatches = content.split(README_MENU_MARKER_START).length - 1;
    const endMatches = content.split(README_MENU_MARKER_END).length - 1;

    assert.equal(startMatches, 1, `Expected exactly 1 '${README_MENU_MARKER_START}', found ${startMatches}`);
    assert.equal(endMatches, 1, `Expected exactly 1 '${README_MENU_MARKER_END}', found ${endMatches}`);
  });

  it('P1-02-B: updateReadmeMenuContent successfully updates README.md without MalformedReadmeMenuMarkersError', async () => {
    const readmePath = path.join(repoRoot, 'README.md');
    const content = await fs.readFile(readmePath, 'utf-8');

    // Must not throw!
    const result = updateReadmeMenuContent(content, {
      repo: 'mnp210/GitHub-Profile-Pet',
      pet: {
        name: 'Shadow Claw',
        species: 'cat',
        generation: 67,
        level: 4,
        xp: 390,
        maxExp: 400,
        mood: 'Happy',
        evolutionStage: 'Hatchling',
        energy: 100,
        hunger: 75,
        happiness: 40,
      },
    });
    assert.equal(result.markersFound, true);
    assert.ok(typeof result.content === 'string');
    assert.ok(result.content.includes(README_MENU_MARKER_START));
  });

  // --------------------------------------------------------------------------
  // P1-03: Nullable Timestamp Contract & Template Validation
  // --------------------------------------------------------------------------
  it('P1-03-A: pet.template.json passes schema validation with null timestamps', async () => {
    const templatePath = path.join(repoRoot, 'pet', 'templates', 'pet.template.json');
    const raw = await fs.readFile(templatePath, 'utf-8');
    const doc = JSON.parse(raw);

    assert.equal(doc.lastInteractionTime, null);
    assert.equal(doc.lastOfflineResolutionTime, null);
    assert.equal(doc.lastSimulatedAt, null);
    assert.equal(doc.updatedAt, null);

    const validation = validatePetState(doc);
    assert.equal(validation.valid, true, `Errors: ${validation.errors.join('; ')}`);
  });

  it('P1-03-B: contributions.template.json passes isPristineContributionLedger with null owner ID', async () => {
    const templatePath = path.join(repoRoot, 'pet', 'templates', 'contributions.template.json');
    const raw = await fs.readFile(templatePath, 'utf-8');
    const doc = JSON.parse(raw);

    assert.equal(doc.ownerDatabaseId, null);
    assert.equal(doc.ownerLogin, null);

    const pristineWithoutOwner = isPristineContributionLedger(doc);
    assert.equal(pristineWithoutOwner, true, 'Template must be pristine without owner');

    const pristineWithOwner = isPristineContributionLedger(doc, 12345);
    assert.equal(pristineWithOwner, true, 'Template must be pristine even when verifiedOwnerDatabaseId is supplied');
  });

  it('P1-03-C: Established pet (Level > 1) strictly rejects null updatedAt and lastOfflineResolutionTime', async () => {
    const establishedPet: Record<string, unknown> = {
      schemaVersion: 1,
      generation: 1,
      name: 'Shadow Claw',
      species: 'cat',
      level: 2, // Established
      xp: 15,
      maxExp: 150,
      energy: 90,
      energyAccumulator: 0,
      hunger: 80,
      hungerDecayAccumulator: 0,
      happiness: 85,
      happinessDecayAccumulator: 0,
      mood: 'Happy',
      evolutionStage: 'Juvenile',
      lastInteractionTime: '2026-11-18T10:00:00Z',
      lastOfflineResolutionTime: null, // Prohibited on established pet!
      lastSimulatedAt: null,
      lastWelcomeBonusClaimedAt: null,
      updatedAt: null, // Prohibited on established pet!
    };

    const validation = validatePetState(establishedPet);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join('; '), /lastOfflineResolutionTime must be a valid ISO-8601 UTC date string/);
    assert.match(validation.errors.join('; '), /updatedAt must be a valid ISO-8601 UTC date string/);
  });

  it('P1-03-D: Established pet allows null lastInteractionTime and lastSimulatedAt', async () => {
    const establishedPet: Record<string, unknown> = {
      schemaVersion: 1,
      generation: 1,
      name: 'Shadow Claw',
      species: 'cat',
      level: 2,
      xp: 15,
      maxExp: 150,
      energy: 90,
      energyAccumulator: 0,
      hunger: 80,
      hungerDecayAccumulator: 0,
      happiness: 85,
      happinessDecayAccumulator: 0,
      mood: 'Happy',
      evolutionStage: 'Juvenile',
      lastInteractionTime: null, // Allowed!
      lastOfflineResolutionTime: '2026-11-18T10:00:00Z',
      lastSimulatedAt: null, // Allowed!
      lastWelcomeBonusClaimedAt: null,
      updatedAt: '2026-11-18T10:00:00Z',
    };

    const validation = validatePetState(establishedPet);
    assert.equal(validation.valid, true, `Errors: ${validation.errors.join('; ')}`);
  });
});
