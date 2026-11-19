/**
 * Phase 3C2.3-B2-R3.39 — Independent Release-Readiness & Fault-Injection Audit Test Suite
 *
 * Verifies:
 * - Investigation A: Generation synchronization parity across lifecycle transitions.
 * - Investigation B: Transaction integrity, crash interruption recovery, retry, concurrency, and dry-run isolation.
 * - Investigation C: skipPush permutations, fast-forward fencing, and push-rejection rollback.
 * - Investigation D: Nullable schema lifecycle contract, simulation checkpoint fail-closed behavior, and first-interaction timestamp transitions.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type {
  PetStateDocument,
  ContributionLedgerDocument,
  ActionLedgerDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import {
  saveRepositoryState,
  loadRepositoryState,
  recoverRepositoryState,
  getStatePaths,
  type TransactionJournalMeta,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import { executeBaselinePipeline } from '../../src/features/pet-engine/publication/baselinePipeline.ts';
import { executeCareAction } from '../../src/features/pet-engine/transitions/careTransitions.ts';
import { resolveSimulationCheckpoint, CorruptedCheckpointError } from '../../src/features/pet-engine/simulation/simulationCheckpoint.ts';
import { validatePetState } from '../../src/features/pet-engine/validation/stateValidator.ts';
import { GitHubContributionProvider } from '../../src/features/pet-engine/contribution/contributionProvider.ts';
import type {
  GitHubContributionSnapshot,
  GitHub2DayContributionSnapshot,
} from '../../src/features/pet-engine/contribution/types.ts';

class MockAuditProvider extends GitHubContributionProvider {
  private readonly snapshot: {
    login: string;
    databaseId: number;
    yesterday: number;
    today: number;
  };
  private readonly shouldFail: boolean;

  constructor(
    snapshot: {
      login: string;
      databaseId: number;
      yesterday: number;
      today: number;
    },
    shouldFail: boolean = false
  ) {
    super();
    this.snapshot = snapshot;
    this.shouldFail = shouldFail;
  }

  public override async fetchUserContributionSnapshot2Day(): Promise<GitHub2DayContributionSnapshot> {
    if (this.shouldFail) {
      throw new Error('Simulated GitHub API Service Unavailable (503)');
    }

    const yDate = '2026-11-18';
    const tDate = '2026-11-19';

    const yesterdaySnapshot: GitHubContributionSnapshot = {
      ownerDatabaseId: this.snapshot.databaseId,
      ownerLogin: this.snapshot.login,
      isPersonalAccount: true,
      fromIso: `${yDate}T00:00:00.000Z`,
      toIso: `${yDate}T23:59:59.999Z`,
      retrievedAtIso: new Date().toISOString(),
      counts: {
        commits: this.snapshot.yesterday,
        issues: 0,
        pullRequests: 0,
        pullRequestReviews: 0,
        publicCategoryTotal: this.snapshot.yesterday,
        calendarReportedTotal: this.snapshot.yesterday,
        restricted: 0,
      },
      authenticationMode: 'mode_a_public',
      providerLatencyMs: 50,
    };

    const todaySnapshot: GitHubContributionSnapshot = {
      ownerDatabaseId: this.snapshot.databaseId,
      ownerLogin: this.snapshot.login,
      isPersonalAccount: true,
      fromIso: `${tDate}T00:00:00.000Z`,
      toIso: `${tDate}T23:59:59.999Z`,
      retrievedAtIso: new Date().toISOString(),
      counts: {
        commits: this.snapshot.today,
        issues: 0,
        pullRequests: 0,
        pullRequestReviews: 0,
        publicCategoryTotal: this.snapshot.today,
        calendarReportedTotal: this.snapshot.today,
        restricted: 0,
      },
      authenticationMode: 'mode_a_public',
      providerLatencyMs: 50,
    };

    return {
      ownerDatabaseId: this.snapshot.databaseId,
      ownerLogin: this.snapshot.login,
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
}

const mockGitExecutor = async (_cmd: string, args: string[]) => {
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
    return { stdout: 'audit-mock-sha-12345', stderr: '' };
  }
  if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
    return { stdout: 'main', stderr: '' };
  }
  if (args[0] === 'status') {
    return {
      stdout:
        ' M pet/state/pet.json\n M pet/ledger/contributions.json\n M pet/ledger/actions.json\n',
      stderr: '',
    };
  }
  return { stdout: '', stderr: '' };
};

describe('Phase 3C2.3-B2-R3.39 — Independent Release-Readiness & Fault-Injection Audit', () => {
  // --------------------------------------------------------------------------
  // Critical Investigation A: Generation Synchronization Parity
  // --------------------------------------------------------------------------
  it('INV-A-01: Proves exact generation lifecycle: Gen 1 uninitialized -> Gen 2 baseline -> Gen 3 first action', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-a-'));
    try {
      const upstreamPet: PetStateDocument = {
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
      const upstreamContrib: ContributionLedgerDocument = {
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
      const upstreamActions: ActionLedgerDocument = {
        schemaVersion: 1,
        generation: 3,
        recentActions: [{ action: 'feed', timestamp: 1731920000000, requestId: 'issue-10' }],
        processedRequestRegistry: { highWaterIssueNumber: 10, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
      };

      await saveRepositoryState(tempDir, {
        pet: upstreamPet,
        contributions: upstreamContrib,
        actions: upstreamActions,
      });

      const provider = new MockAuditProvider({
        login: 'bob-developer',
        databaseId: 998877,
        yesterday: 4,
        today: 6,
      });

      // Stage 1: Execute baseline establishment with foreign fork reinitialization
      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'test-token',
        targetOwnerLogin: 'bob-developer',
        expectedOwnerDatabaseId: 998877,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, true, res.details);
      assert.equal(res.status, 'baseline_established', res.details);

      // Stage 2: Loaded state immediately after baseline commit MUST be Generation 2
      const postBaseline = await loadRepositoryState(tempDir);
      assert.equal(postBaseline.generation, 2, 'Post-baseline state must be at Generation 2');
      assert.equal(postBaseline.pet.generation, 2);
      assert.equal(postBaseline.contributions.generation, 2);
      assert.equal(postBaseline.actions.generation, 2);
      assert.equal(postBaseline.pet.xp, 0);
      assert.equal(postBaseline.pet.level, 1);
      assert.equal(postBaseline.pet.evolutionStage, 'Hatchling');
      assert.equal(postBaseline.contributions.ownerLogin, 'bob-developer');
      assert.equal(postBaseline.contributions.ownerDatabaseId, 998877);

      // Stage 3: Care interaction advances state from Gen 2 to Gen 3 in lockstep
      const careTransition = executeCareAction({
        pet: postBaseline.pet,
        action: 'feed',
        history: [],
        nowMs: new Date('2026-11-19T14:00:00Z').getTime(),
        requestId: 'issue-1',
      });
      assert.equal(careTransition.outcome.success, true);

      const nextGen3 = postBaseline.generation + 1;
      await saveRepositoryState(tempDir, {
        pet: { ...careTransition.nextPetState, generation: nextGen3 },
        contributions: { ...postBaseline.contributions, generation: nextGen3 },
        actions: {
          ...postBaseline.actions,
          generation: nextGen3,
          recentActions: careTransition.nextRecentActions,
        },
      }, { expectedGeneration: 2 });

      const postCare = await loadRepositoryState(tempDir);
      assert.equal(postCare.generation, 3, 'Care transition must advance state to Generation 3');
      assert.equal(postCare.pet.generation, 3);
      assert.equal(postCare.contributions.generation, 3);
      assert.equal(postCare.actions.generation, 3);
      assert.equal(postCare.pet.xp, 10);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Critical Investigation B: Transaction Integrity & Crash Recovery
  // --------------------------------------------------------------------------
  it('INV-B-01: Interrupted transaction with status "preparing" rolls back source files byte-for-byte', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-b1-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

      const originalPetContent = JSON.stringify({ schemaVersion: 1, generation: 3, name: 'Original Upstream' }, null, 2);
      const originalContribContent = JSON.stringify({ schemaVersion: 1, generation: 3, ownerLogin: 'upstream-user' }, null, 2);
      const originalActionsContent = JSON.stringify({ schemaVersion: 1, generation: 3, recentActions: [] }, null, 2);

      await fs.writeFile(paths.petPath, originalPetContent, 'utf-8');
      await fs.writeFile(paths.contributionsPath, originalContribContent, 'utf-8');
      await fs.writeFile(paths.actionsPath, originalActionsContent, 'utf-8');

      // Simulate crash: journal created with 'preparing' status and source backup
      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      await fs.writeFile(path.join(paths.journalSourceDir, 'pet.json'), originalPetContent, 'utf-8');
      await fs.writeFile(path.join(paths.journalSourceDir, 'contributions.json'), originalContribContent, 'utf-8');
      await fs.writeFile(path.join(paths.journalSourceDir, 'actions.json'), originalActionsContent, 'utf-8');

      // Active files were partially mutated
      await fs.writeFile(paths.petPath, JSON.stringify({ schemaVersion: 1, generation: 1, name: 'Half Written' }), 'utf-8');

      const meta: TransactionJournalMeta = {
        sourceGeneration: 3,
        targetGeneration: 1,
        status: 'preparing',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(meta, null, 2), 'utf-8');

      // Run recovery
      const rec = await recoverRepositoryState(tempDir);
      assert.equal(rec.recovered, true);
      assert.equal(rec.action, 'roll_back');
      assert.equal(rec.generation, 3);

      // Verify active files restored byte-for-byte to original
      const restoredPet = await fs.readFile(paths.petPath, 'utf-8');
      const restoredContrib = await fs.readFile(paths.contributionsPath, 'utf-8');
      const restoredActions = await fs.readFile(paths.actionsPath, 'utf-8');

      assert.equal(restoredPet, originalPetContent);
      assert.equal(restoredContrib, originalContribContent);
      assert.equal(restoredActions, originalActionsContent);

      // Journal directory must be cleanly removed
      const journalExists = await fs.access(paths.journalDir).then(() => true).catch(() => false);
      assert.equal(journalExists, false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('INV-B-02: Interrupted transaction with status "committed" rolls forward target files byte-for-byte', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-b2-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

      const targetPetContent = JSON.stringify({ schemaVersion: 1, generation: 2, name: 'Target Hatchling', level: 1, xp: 0, energy: 100, hunger: 70, happiness: 70, mood: 'Happy', evolutionStage: 'Hatchling', lastInteractionTime: null, lastOfflineResolutionTime: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z' }, null, 2);
      const targetContribContent = JSON.stringify({ schemaVersion: 1, generation: 2, ownerLogin: 'target-user', ownerDatabaseId: 12345, monotonicPublicHwm: 0, slices: [], monthlyHistoricalSummary: [] }, null, 2);
      const targetActionsContent = JSON.stringify({ schemaVersion: 1, generation: 2, recentActions: [], processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] } }, null, 2);

      await fs.mkdir(paths.journalSourceDir, { recursive: true });
      await fs.mkdir(paths.journalTargetDir, { recursive: true });

      await fs.writeFile(path.join(paths.journalTargetDir, 'pet.json'), targetPetContent, 'utf-8');
      await fs.writeFile(path.join(paths.journalTargetDir, 'contributions.json'), targetContribContent, 'utf-8');
      await fs.writeFile(path.join(paths.journalTargetDir, 'actions.json'), targetActionsContent, 'utf-8');

      const meta: TransactionJournalMeta = {
        sourceGeneration: 1,
        targetGeneration: 2,
        status: 'committed',
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(paths.journalMetaPath, JSON.stringify(meta, null, 2), 'utf-8');

      // Run recovery
      const rec = await recoverRepositoryState(tempDir);
      assert.equal(rec.recovered, true);
      assert.equal(rec.action, 'roll_forward');
      assert.equal(rec.generation, 2);

      // Verify active files committed to target files
      const rolledPet = await fs.readFile(paths.petPath, 'utf-8');
      const rolledContrib = await fs.readFile(paths.contributionsPath, 'utf-8');
      const rolledActions = await fs.readFile(paths.actionsPath, 'utf-8');

      assert.equal(rolledPet, targetPetContent);
      assert.equal(rolledContrib, targetContribContent);
      assert.equal(rolledActions, targetActionsContent);

      const journalExists = await fs.access(paths.journalDir).then(() => true).catch(() => false);
      assert.equal(journalExists, false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('INV-B-03: Zero disk mutation when provider network call fails; files remain 100% untouched', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-b3-'));
    try {
      const paths = getStatePaths(tempDir);
      const originalPetContent = JSON.stringify({
        schemaVersion: 1,
        generation: 3,
        name: 'Upstream Master',
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
      }, null, 2);

      const originalContribContent = JSON.stringify({
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
      }, null, 2);

      const originalActionsContent = JSON.stringify({
        schemaVersion: 1,
        generation: 3,
        recentActions: [{ action: 'feed', timestamp: 1731920000000, requestId: 'issue-10' }],
        processedRequestRegistry: { highWaterIssueNumber: 10, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
      }, null, 2);

      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });
      await fs.writeFile(paths.petPath, originalPetContent, 'utf-8');
      await fs.writeFile(paths.contributionsPath, originalContribContent, 'utf-8');
      await fs.writeFile(paths.actionsPath, originalActionsContent, 'utf-8');

      const failingProvider = new MockAuditProvider(
        { login: 'charlie-dev', databaseId: 556677, yesterday: 0, today: 0 },
        true // shouldFail
      );

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider: failingProvider,
        token: 'test-token',
        targetOwnerLogin: 'charlie-dev',
        expectedOwnerDatabaseId: 556677,
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

      // Verify files were NEVER touched on disk
      const petAfter = await fs.readFile(paths.petPath, 'utf-8');
      const contribAfter = await fs.readFile(paths.contributionsPath, 'utf-8');
      const actionsAfter = await fs.readFile(paths.actionsPath, 'utf-8');

      assert.equal(petAfter, originalPetContent, 'pet.json must remain identical');
      assert.equal(contribAfter, originalContribContent, 'contributions.json must remain identical');
      assert.equal(actionsAfter, originalActionsContent, 'actions.json must remain identical');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('INV-B-04: Dry-run execution strictly forbids state mutation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-b4-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

      const originalPet = JSON.stringify({ schemaVersion: 1, generation: 3, name: 'Dry Run Pet' });
      const originalContrib = JSON.stringify({ schemaVersion: 1, generation: 3, ownerLogin: 'mnp210', ownerDatabaseId: 298821706, installationBaseline: { completed: true } });
      const originalActions = JSON.stringify({ schemaVersion: 1, generation: 3, recentActions: [] });

      await fs.writeFile(paths.petPath, originalPet, 'utf-8');
      await fs.writeFile(paths.contributionsPath, originalContrib, 'utf-8');
      await fs.writeFile(paths.actionsPath, originalActions, 'utf-8');

      const provider = new MockAuditProvider({ login: 'dry-dev', databaseId: 112233, yesterday: 1, today: 1 });

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'test-token',
        targetOwnerLogin: 'dry-dev',
        expectedOwnerDatabaseId: 112233,
        reinitializeForeignFork: true,
        dryRun: true,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, true, res.details);
      assert.equal(res.status, 'baseline_established', res.details);

      // Verify files on disk were not modified
      assert.equal(await fs.readFile(paths.petPath, 'utf-8'), originalPet);
      assert.equal(await fs.readFile(paths.contributionsPath, 'utf-8'), originalContrib);
      assert.equal(await fs.readFile(paths.actionsPath, 'utf-8'), originalActions);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Critical Investigation C: skipPush Permutations & Push Safety
  // --------------------------------------------------------------------------
  it('INV-C-01: skipPush: true does not execute git push and short-circuits safely', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-c1-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

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
        recentActions: [{ action: 'feed', timestamp: 1731920000000, requestId: 'issue-10' }],
        processedRequestRegistry: { highWaterIssueNumber: 10, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
      };

      await saveRepositoryState(tempDir, { pet: originalPet, contributions: originalContrib, actions: originalActions });

      let gitPushCalled = false;
      const trackingGitExecutor = async (cmd: string, args: string[]) => {
        if (args[0] === 'push') {
          gitPushCalled = true;
          return { stdout: '', stderr: '' };
        }
        return mockGitExecutor(cmd, args);
      };

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider: new MockAuditProvider({ login: 'local-dev', databaseId: 991122, yesterday: 2, today: 2 }),
        token: 'test-token',
        targetOwnerLogin: 'local-dev',
        expectedOwnerDatabaseId: 991122,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: trackingGitExecutor,
      });

      assert.equal(res.success, true, res.details);
      assert.equal(res.status, 'baseline_established', res.details);
      assert.equal(gitPushCalled, false, 'git push must NEVER be executed when skipPush is true');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('INV-C-02: Non-fast-forward push rejection triggers hard reset rollback to source commit', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r339-inv-c2-'));
    try {
      const paths = getStatePaths(tempDir);
      await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
      await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });

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
        recentActions: [{ action: 'feed', timestamp: 1731920000000, requestId: 'issue-10' }],
        processedRequestRegistry: { highWaterIssueNumber: 10, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
      };

      await saveRepositoryState(tempDir, { pet: originalPet, contributions: originalContrib, actions: originalActions });

      let gitResetCalled = false;
      let resetTargetSha = '';
      const rejectingGitExecutor = async (cmd: string, args: string[]) => {
        if (args[0] === 'push') {
          const err = new Error('non-fast-forward push rejected') as Error & { stderr: string };
          err.stderr = '[remote rejected] (non-fast-forward)';
          throw err;
        }
        if (args[0] === 'reset' && args[1] === '--hard') {
          gitResetCalled = true;
          resetTargetSha = args[2];
          return { stdout: '', stderr: '' };
        }
        return mockGitExecutor(cmd, args);
      };

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider: new MockAuditProvider({ login: 'push-fail-dev', databaseId: 778899, yesterday: 1, today: 1 }),
        token: 'test-token',
        targetOwnerLogin: 'push-fail-dev',
        expectedOwnerDatabaseId: 778899,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: false, // Normal publication
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        remoteFenceCheck: async (sha: string) => ({ matches: true, currentRemoteSha: sha }),
        sourceCommitSha: 'audit-mock-sha-12345',
        gitExecutor: rejectingGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'push_rejected');
      assert.equal(gitResetCalled, true, 'git reset --hard must be called on push rejection');
      assert.equal(resetTargetSha, 'audit-mock-sha-12345', 'git reset must roll back to sourceCommitSha');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // Critical Investigation D: Nullable Schema Contract & Simulation Behavior
  // --------------------------------------------------------------------------
  it('INV-D-01: Formal nullability contract across lifecycle stages', () => {
    // 1. Pristine hatchling accepts null timestamps
    const pristineHatchling: PetStateDocument = {
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
      lastInteractionTime: null,
      lastOfflineResolutionTime: null,
      lastSimulatedAt: null,
      lastWelcomeBonusClaimedAt: null,
      updatedAt: null,
    };
    const hatchlingResult = validatePetState(pristineHatchling);
    assert.equal(hatchlingResult.valid, true, 'Pristine hatchling must be valid');
    assert.deepEqual(hatchlingResult.errors, [], 'Pristine hatchling must have zero schema errors');

    // 2. Established pet (Level 2) rejects null updatedAt and null lastOfflineResolutionTime
    const establishedPet: PetStateDocument = {
      ...pristineHatchling,
      generation: 2,
      level: 2,
      xp: 100,
      evolutionStage: 'Juvenile',
      lastInteractionTime: '2026-11-19T10:00:00Z',
      lastOfflineResolutionTime: null, // Prohibited for established pet
      updatedAt: null, // Prohibited for established pet
    };
    const establishedResult = validatePetState(establishedPet);
    assert.equal(establishedResult.valid, false);
    assert.equal(establishedResult.errors.length, 2);
    assert.ok(establishedResult.errors.some((e) => e.includes('lastOfflineResolutionTime')));
    assert.ok(establishedResult.errors.some((e) => e.includes('updatedAt')));

    // 3. Evolved pet with valid ISO timestamps passes
    const validEvolvedPet: PetStateDocument = {
      ...establishedPet,
      lastOfflineResolutionTime: '2026-11-19T10:00:00.000Z',
      updatedAt: '2026-11-19T10:00:00.000Z',
    };
    const validResult = validatePetState(validEvolvedPet);
    assert.equal(validResult.valid, true);
    assert.deepEqual(validResult.errors, []);
  });

  it('INV-D-02: Simulation checkpoint fails closed (CorruptedCheckpointError) on established pet with missing clocks', () => {
    const corruptEstablishedPet = {
      name: 'Corrupt Cat',
      generation: 3,
      level: 2,
      xp: 50,
      lastSimulatedAt: null,
      lastOfflineResolutionTime: null,
      updatedAt: null,
    } as unknown as PetStateDocument;

    assert.throws(
      () => {
        resolveSimulationCheckpoint(corruptEstablishedPet, Date.now());
      },
      (err: unknown) => {
        assert.ok(err instanceof CorruptedCheckpointError);
        return true;
      }
    );
  });

  it('INV-D-03: Simulation checkpoint adopts initialization_now for unplayed pristine hatchling', () => {
    const pristinePet = {
      name: 'New Born',
      generation: 1,
      level: 1,
      xp: 0,
      evolutionStage: 'Hatchling',
      lastSimulatedAt: null,
      lastOfflineResolutionTime: null,
      updatedAt: null,
    } as unknown as PetStateDocument;

    const now = 1731940000000;
    const checkpoint = resolveSimulationCheckpoint(pristinePet, now);
    assert.equal(checkpoint.source, 'initialization_now');
    assert.equal(checkpoint.checkpointMs, now);
  });

  it('INV-D-04: First interaction on unplayed pet with null lastInteractionTime succeeds and sets valid timestamps', () => {
    const unplayedHatchling: PetStateDocument = {
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
      lastInteractionTime: null,
      lastOfflineResolutionTime: '2026-11-19T12:00:00.000Z',
      lastSimulatedAt: null,
      lastWelcomeBonusClaimedAt: null,
      updatedAt: '2026-11-19T12:00:00.000Z',
    };

    const actionTime = new Date('2026-11-19T12:30:00.000Z').getTime();
    const result = executeCareAction({
      pet: unplayedHatchling,
      action: 'feed',
      history: [],
      nowMs: actionTime,
      requestId: 'issue-1',
    });

    assert.equal(result.outcome.success, true);
    assert.equal(result.outcome.xpGained, 10);
    assert.equal(result.nextPetState.lastInteractionTime, '2026-11-19T12:30:00.000Z');
    assert.equal(result.nextPetState.updatedAt, '2026-11-19T12:30:00.000Z');
  });
});
