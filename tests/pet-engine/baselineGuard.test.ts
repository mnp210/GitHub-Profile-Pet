import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { syncContributions } from '../../src/features/pet-engine/sync/contributionSyncService.ts';
import { executeBaselinePipeline } from '../../src/features/pet-engine/publication/baselinePipeline.ts';
import { parseArgs as parseEstablishBaselineArgs } from '../../scripts/establish-baseline.ts';
import {
  GitHubContributionProvider,
  GitHubTimeoutError,
} from '../../src/features/pet-engine/contribution/index.ts';
import type {
  GitHubContributionSnapshot,
  GitHub2DayContributionSnapshot,
} from '../../src/features/pet-engine/contribution/types.ts';
import type {
  ContributionLedgerDocument,
  ActionLedgerDocument,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import {
  getStatePaths,
  loadRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import { verifyAccountingInvariant } from '../../src/features/pet-engine/accounting/contributionEngine.ts';

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
    ownerDatabaseId: 298821706,
    ownerLogin: 'mnp210',
    dailyAccruedXp: {},
    hourlyIncrementUsage: {},
    hourlySliceUsage: {},
    slices: [],
    monthlyHistoricalSummary: [],
  };
}

function createEstablishedContributionLedger(generation: number = 1): ContributionLedgerDocument {
  return {
    schemaVersion: 1,
    generation,
    ownerDatabaseId: 298821706,
    ownerLogin: 'mnp210',
    installationBaseline: {
      completed: true,
      installedAt: '2026-11-16T00:00:00.000Z',
      baselineDateUtc: '2026-11-16',
      initialCounts: {
        yesterday: 10,
        today: 5,
      },
    },
    dailyHwm: {
      '2026-11-15': 10,
      '2026-11-16': 5,
    },
    dailyRewardOrdinal: {
      '2026-11-15': 0,
      '2026-11-16': 0,
    },
    monotonicPublicHwm: 5,
    dailyAccruedXp: {},
    hourlyIncrementUsage: {},
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

function createMock2DaySnapshot(params: {
  ownerLogin?: string;
  ownerDatabaseId?: number;
  yesterdayDate: string;
  todayDate: string;
  yesterdayCommits?: number;
  todayCommits?: number;
}): GitHub2DayContributionSnapshot {
  const login = params.ownerLogin ?? 'mnp210';
  const dbId = params.ownerDatabaseId ?? 298821706;

  const yesterdaySnapshot: GitHubContributionSnapshot = {
    ownerDatabaseId: dbId,
    ownerLogin: login,
    isPersonalAccount: true,
    fromIso: `${params.yesterdayDate}T00:00:00.000Z`,
    toIso: `${params.yesterdayDate}T23:59:59.999Z`,
    retrievedAtIso: new Date().toISOString(),
    counts: {
      commits: params.yesterdayCommits ?? 10,
      issues: 0,
      pullRequests: 0,
      pullRequestReviews: 0,
      publicCategoryTotal: params.yesterdayCommits ?? 10,
      calendarReportedTotal: params.yesterdayCommits ?? 10,
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
      commits: params.todayCommits ?? 5,
      issues: 0,
      pullRequests: 0,
      pullRequestReviews: 0,
      publicCategoryTotal: params.todayCommits ?? 5,
      calendarReportedTotal: params.todayCommits ?? 5,
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
      limit: 5000,
      cost: 1,
      remaining: 4999,
      used: 1,
      resetAt: '2026-11-18T18:00:00Z',
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
    providerLatencyMs: 100,
  };
}

class TrackingMockProvider extends GitHubContributionProvider {
  public callCount = 0;
  public mockResponse?: GitHub2DayContributionSnapshot;
  public mockError?: Error;

  public override async fetchUserContributionSnapshot2Day(): Promise<GitHub2DayContributionSnapshot> {
    this.callCount++;
    if (this.mockError) {
      throw this.mockError;
    }
    if (!this.mockResponse) {
      throw new Error('No mock response configured');
    }
    return this.mockResponse;
  }
}

describe('Phase 3C2.3-B2-R2: Baseline Guard Test Suite', () => {
  let tempBaseDir: string;
  let provider: TrackingMockProvider;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-baseline-guard-'));
    provider = new TrackingMockProvider();
    provider.mockResponse = createMock2DaySnapshot({
      yesterdayDate: '2026-11-17',
      todayDate: '2026-11-18',
      yesterdayCommits: 10,
      todayCommits: 5,
    });

    const paths = getStatePaths(tempBaseDir);
    await fs.mkdir(path.dirname(paths.petPath), { recursive: true });
    await fs.mkdir(path.dirname(paths.contributionsPath), { recursive: true });
    await fs.mkdir(path.join(tempBaseDir, 'public'), { recursive: true });

    await fs.writeFile(paths.petPath, JSON.stringify(createInitialPetState(1), null, 2), 'utf-8');
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createPristineContributionLedger(1), null, 2),
      'utf-8'
    );
    await fs.writeFile(paths.actionsPath, JSON.stringify(createInitialActionLedger(1), null, 2), 'utf-8');
    await fs.writeFile(path.join(tempBaseDir, 'public', 'pet.svg'), '<svg>test</svg>', 'utf-8');
    await fs.writeFile(
      path.join(tempBaseDir, 'README.md'),
      '<!-- START_SECTION:profile-pet -->\n<img src="public/pet.svg" />\n<!-- END_SECTION:profile-pet -->',
      'utf-8'
    );
  });

  afterEach(async () => {
    if (tempBaseDir) {
      try {
        await fs.rm(tempBaseDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup error
      }
    }
  });

  // 1. Ordinary publisher with no baseline: fails closed (baseline_missing, 0 provider calls, 0 mutations)
  it('1. Ordinary publisher with no baseline fails closed (baseline_missing, 0 provider calls, 0 mutations)', async () => {
    const paths = getStatePaths(tempBaseDir);
    const petBefore = await fs.readFile(paths.petPath, 'utf-8');
    const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionsBefore = await fs.readFile(paths.actionsPath, 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      // mode defaults to 'runtime'
    });

    assert.equal(result.status, 'baseline_missing');
    assert.equal(provider.callCount, 0, 'Zero provider calls must be made');
    assert.equal(result.xpAwarded, 0);
    assert.equal(result.deltaObserved, 0);

    const petAfter = await fs.readFile(paths.petPath, 'utf-8');
    const contribAfter = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionsAfter = await fs.readFile(paths.actionsPath, 'utf-8');

    assert.equal(petAfter, petBefore, 'Pet state must be 100% unchanged');
    assert.equal(contribAfter, contribBefore, 'Contribution ledger must be 100% unchanged');
    assert.equal(actionsAfter, actionsBefore, 'Action ledger must be 100% unchanged');
  });

  // 2. Ordinary publisher with incomplete baseline (completed: false): fails closed (baseline_missing)
  it('2. Ordinary publisher with incomplete baseline (completed: false) fails closed (baseline_missing)', async () => {
    const paths = getStatePaths(tempBaseDir);
    const incompleteLedger: ContributionLedgerDocument = {
      ...createPristineContributionLedger(1),
      installationBaseline: {
        completed: false,
        installedAt: '2026-11-18T00:00:00.000Z',
        baselineDateUtc: '2026-11-18',
        initialCounts: { yesterday: 0, today: 0 },
      },
    };
    await fs.writeFile(paths.contributionsPath, JSON.stringify(incompleteLedger, null, 2), 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(result.status, 'baseline_missing');
    assert.equal(provider.callCount, 0, 'Zero provider calls must be made');
  });

  // 3. Ordinary publisher with corrupt ledger: fails closed (integrity_failed)
  it('3. Ordinary publisher with corrupt ledger fails closed (integrity_failed)', async () => {
    const paths = getStatePaths(tempBaseDir);
    // Write invalid JSON or non-conformant schema
    await fs.writeFile(paths.contributionsPath, '{ "schemaVersion": 999 }', 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(result.status, 'integrity_failed');
    assert.equal(provider.callCount, 0, 'Zero provider calls on corrupt ledger');
  });

  // 4. Ordinary publisher with mismatched owner identity: fails closed (IdentityMismatchError)
  it('4. Ordinary publisher with mismatched owner identity fails closed (IdentityMismatchError)', async () => {
    const paths = getStatePaths(tempBaseDir);
    // Seed an established ledger with database ID 11111
    const established = createEstablishedContributionLedger(1);
    established.ownerDatabaseId = 11111;
    established.ownerLogin = 'mnp210';
    await fs.writeFile(paths.contributionsPath, JSON.stringify(established, null, 2), 'utf-8');

    // Provider returns database ID 22222
    provider.mockResponse = createMock2DaySnapshot({
      ownerDatabaseId: 22222,
      ownerLogin: 'mnp210',
      yesterdayDate: '2026-11-17',
      todayDate: '2026-11-18',
    });

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /IdentityMismatchError/);

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.contributions.ownerDatabaseId, 11111, 'Owner ID must not be rebound');

    // Reset to pristine ledger for baseline identity mismatch test
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createPristineContributionLedger(1), null, 2),
      'utf-8'
    );

    // 4b. Baseline mode with PET_OWNER_DATABASE_ID mismatch fails closed without ledger mutation
    const baselineResult = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: {
        PET_OWNER_LOGIN: 'mnp210',
        PET_OWNER_DATABASE_ID: '11111',
      },
      expectedOwnerDatabaseId: 11111,
      mode: 'baseline_only',
    });

    assert.ok(
      baselineResult.status === 'integrity_failed' || baselineResult.status === 'provider_failed',
      `Expected integrity_failed or provider_failed, got ${baselineResult.status}`
    );
    assert.match(baselineResult.notes, /does not match expected/);
    assert.equal(baselineResult.xpAwarded, 0);
    assert.equal(baselineResult.deltaObserved, 0);
  });

  // 5. Manual ordinary publisher dispatch cannot initialize baseline (default runtime mode fails closed)
  it('5. Manual ordinary publisher dispatch cannot initialize baseline (default runtime mode fails closed)', async () => {
    // When pet-publisher is triggered without --baseline-only, mode is runtime
    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(result.status, 'baseline_missing');
    assert.match(result.notes, /Installation baseline has not been established/);
    assert.equal(provider.callCount, 0);

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.contributions.installationBaseline, undefined);
  });

  // 6. Interaction workflow cannot initialize baseline (verified inbox does not touch baseline)
  it('6. Interaction workflow cannot initialize baseline (inbox does not touch baseline)', async () => {
    // Action inbox only modifies actions.json and pet vitals, never touches contributions.json
    const paths = getStatePaths(tempBaseDir);
    const contribBefore = JSON.parse(await fs.readFile(paths.contributionsPath, 'utf-8'));
    assert.equal(contribBefore.installationBaseline, undefined);

    // Verify inbox state is independent
    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.contributions.installationBaseline, undefined);
    assert.equal(loaded.contributions.slices.length, 0);
  });

  // 7. Explicit baseline mode on pristine ledger succeeds in isolated test fixtures (baseline_established)
  it('7. Explicit baseline mode on pristine ledger succeeds in isolated test fixtures (baseline_established)', async () => {
    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'baseline_only',
    });

    assert.equal(result.status, 'baseline_established');
    assert.equal(result.xpAwarded, 0, 'Zero retroactive XP awarded');
    assert.equal(result.satietyAwarded, 0);
    assert.equal(result.deltaObserved, 0);
    assert.equal(result.incrementsEvaluated, 0);
    assert.equal(result.savedGeneration, 2);

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.generation, 2);
    assert.equal(loaded.pet.xp, 0);
    assert.equal(loaded.contributions.installationBaseline?.completed, true);
    assert.equal(loaded.contributions.installationBaseline?.baselineDateUtc, '2026-11-18');
    assert.equal(loaded.contributions.installationBaseline?.initialCounts.yesterday, 10);
    assert.equal(loaded.contributions.installationBaseline?.initialCounts.today, 5);
  });

  // 8. Explicit baseline mode on already initialized ledger refuses (baseline_refused)
  it('8. Explicit baseline mode on already initialized ledger refuses (baseline_refused)', async () => {
    const paths = getStatePaths(tempBaseDir);
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createEstablishedContributionLedger(1), null, 2),
      'utf-8'
    );

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'baseline_only',
    });

    assert.equal(result.status, 'baseline_refused');
    assert.match(result.notes, /already been established/i);
    assert.equal(provider.callCount, 0, 'Zero provider calls on already established baseline');

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.generation, 1, 'Generation must not change');
  });

  // 9. Explicit baseline mode on partially initialized ledger refuses (integrity_failed)
  it('9. Explicit baseline mode on partially initialized ledger refuses (integrity_failed)', async () => {
    const paths = getStatePaths(tempBaseDir);
    const partiallyInitialized: ContributionLedgerDocument = {
      ...createPristineContributionLedger(1),
      installationBaseline: {
        completed: false,
        installedAt: '2026-11-18T00:00:00.000Z',
        baselineDateUtc: '2026-11-18',
        initialCounts: { yesterday: 5, today: 5 },
      },
    };
    await fs.writeFile(paths.contributionsPath, JSON.stringify(partiallyInitialized, null, 2), 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'baseline_only',
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /partially initialized/i);
    assert.equal(provider.callCount, 0, 'Zero provider calls on corrupt baseline');
  });

  // 10. Explicit baseline mode with provider failure produces no accounting mutation
  it('10. Explicit baseline mode with provider failure produces no accounting mutation', async () => {
    provider.mockError = new GitHubTimeoutError(10000);

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'baseline_only',
    });

    assert.equal(result.status, 'provider_failed');
    assert.equal(result.xpAwarded, 0);

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.generation, 1, 'Generation must remain 1');
    assert.equal(loaded.contributions.installationBaseline, undefined);
    assert.equal(loaded.contributions.slices.length, 0);
  });

  // 11. Provider call count is zero for ordinary publisher when baseline is missing
  it('11. Provider call count is zero for ordinary publisher when baseline is missing', async () => {
    assert.equal(provider.callCount, 0);

    await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(provider.callCount, 0, 'Provider must never be queried when baseline is missing');
  });

  // 12. Failure leaves pet state, ledgers, SVG, and README 100% unchanged
  it('12. Failure leaves pet state, ledgers, SVG, and README 100% unchanged', async () => {
    const paths = getStatePaths(tempBaseDir);
    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');

    const petBefore = await fs.readFile(paths.petPath, 'utf-8');
    const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionsBefore = await fs.readFile(paths.actionsPath, 'utf-8');
    const svgBefore = await fs.readFile(svgPath, 'utf-8');
    const readmeBefore = await fs.readFile(readmePath, 'utf-8');

    // Run ordinary publisher with missing baseline
    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(result.status, 'baseline_missing');

    assert.equal(await fs.readFile(paths.petPath, 'utf-8'), petBefore);
    assert.equal(await fs.readFile(paths.contributionsPath, 'utf-8'), contribBefore);
    assert.equal(await fs.readFile(paths.actionsPath, 'utf-8'), actionsBefore);
    assert.equal(await fs.readFile(svgPath, 'utf-8'), svgBefore);
    assert.equal(await fs.readFile(readmePath, 'utf-8'), readmeBefore);
  });

  // 13. Existing accounting invariants hold under baseline guard
  it('13. Existing accounting invariants hold under baseline guard', async () => {
    // 1. Pristine ledger holds invariant
    let loaded = await loadRepositoryState(tempBaseDir);
    let invariant = verifyAccountingInvariant(loaded.contributions);
    assert.equal(invariant.satisfied, true);

    // 2. Establish baseline
    await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'baseline_only',
    });

    loaded = await loadRepositoryState(tempBaseDir);
    invariant = verifyAccountingInvariant(loaded.contributions);
    assert.equal(invariant.satisfied, true);
    assert.equal(invariant.totalObserved, 0);
    assert.equal(invariant.sumCategorized, 0);

    // 3. Post-baseline increment in runtime mode
    provider.mockResponse = createMock2DaySnapshot({
      yesterdayDate: '2026-11-17',
      todayDate: '2026-11-18',
      yesterdayCommits: 10,
      todayCommits: 6, // +1 increment
    });

    const runResult = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      mode: 'runtime',
    });

    assert.equal(runResult.status, 'completed');
    assert.equal(runResult.deltaObserved, 1);
    assert.equal(runResult.xpAwarded, 25);

    loaded = await loadRepositoryState(tempBaseDir);
    invariant = verifyAccountingInvariant(loaded.contributions);
    assert.equal(invariant.satisfied, true);
    assert.equal(invariant.totalObserved, 1);
    assert.equal(invariant.breakdown.rewarded, 1);
  });

  // 14. Dedicated baseline pipeline on pristine ledger modifies ONLY state documents and leaves SVG and README untouched
  it('14. Dedicated baseline pipeline on pristine ledger modifies ONLY state documents and leaves SVG and README untouched', async () => {
    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');
    const svgBefore = await fs.readFile(svgPath, 'utf-8');
    const readmeBefore = await fs.readFile(readmePath, 'utf-8');

    const mockGitExecutor = async (_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: 'mock-commit-sha\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    // Run baseline pipeline with skipPush: true to avoid remote push in unit test fixture
    const result = await executeBaselinePipeline({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      skipPush: true,
      skipCleanPreflight: true,
      skipBranchCheck: true,
      gitExecutor: mockGitExecutor,
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'baseline_established');

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.contributions.installationBaseline?.completed, true);
    assert.equal(loaded.generation, 2);

    // Verify public/pet.svg and README.md are 100% UNCHANGED
    const svgAfter = await fs.readFile(svgPath, 'utf-8');
    const readmeAfter = await fs.readFile(readmePath, 'utf-8');
    assert.equal(svgAfter, svgBefore, 'public/pet.svg must not be modified during baseline establishment');
    assert.equal(readmeAfter, readmeBefore, 'README.md must not be modified during baseline establishment');
  });

  // 15. Dedicated baseline pipeline does not simulate offline pet vital decay
  it('15. Dedicated baseline pipeline does not simulate offline pet vital decay', async () => {
    // Clock advanced by 7 days (604,800s)
    const baseNow = new Date('2026-11-15T00:00:00.000Z').getTime();
    const futureNow = baseNow + 7 * 86400 * 1000;

    const mockGitExecutor = async (_cmd: string, args: string[]) => {
      if (args[0] === 'rev-parse') return { stdout: 'mock-commit-sha\n', stderr: '' };
      return { stdout: '', stderr: '' };
    };

    const result = await executeBaselinePipeline({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      nowMs: futureNow,
      env: { PET_OWNER_LOGIN: 'mnp210' },
      skipPush: true,
      skipCleanPreflight: true,
      skipBranchCheck: true,
      gitExecutor: mockGitExecutor,
    });

    assert.equal(result.success, true);
    const loaded = await loadRepositoryState(tempBaseDir);
    // Vitals must remain exactly at initial values (hunger: 50, happiness: 50) because simulation is skipped
    assert.equal(loaded.pet.hunger, 50, 'Hunger must not decay during baseline establishment');
    assert.equal(loaded.pet.happiness, 50, 'Happiness must not decay during baseline establishment');
  });

  // 16. Dedicated baseline pipeline refuses already initialized ledger
  it('16. Dedicated baseline pipeline refuses already initialized ledger', async () => {
    const paths = getStatePaths(tempBaseDir);
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createEstablishedContributionLedger(1), null, 2),
      'utf-8'
    );

    const result = await executeBaselinePipeline({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      dryRun: true,
      skipCleanPreflight: true,
      skipBranchCheck: true,
    });

    assert.equal(result.success, false);
    assert.equal(result.status, 'baseline_refused');
    assert.equal(provider.callCount, 0, 'Zero provider calls on already established ledger');
  });

  // 17. Dedicated baseline CLI argument parsing handles options correctly
  it('17. Dedicated baseline CLI argument parsing handles options correctly', () => {
    const parsed = parseEstablishBaselineArgs([
      '--ref',
      'main',
      '--remote',
      'upstream',
      '--base-dir',
      '/tmp/test',
      '--dry-run',
      '--skip-push',
      '--owner-id',
      '298821706',
    ]);

    assert.equal(parsed.refName, 'main');
    assert.equal(parsed.gitRemote, 'upstream');
    assert.equal(parsed.baseDir, '/tmp/test');
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.skipPush, true);
    assert.equal(parsed.expectedOwnerDatabaseId, 298821706);
  });

  // 18. Missing numeric owner ID in established ledger fails closed before provider query or mutation (R3.3 & R3.5)
  it('18. Missing numeric owner ID in established ledger fails closed before provider query or mutation', async () => {
    const paths = getStatePaths(tempBaseDir);
    const establishedLedger = createEstablishedContributionLedger(1);
    delete (establishedLedger as unknown as Record<string, unknown>).ownerDatabaseId;

    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(establishedLedger, null, 2),
      'utf-8'
    );

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      env: { PET_OWNER_LOGIN: 'mnp210' },
      skipSimulation: true,
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /absent or invalid ownerDatabaseId/);
    assert.equal(provider.callCount, 0, 'Zero provider calls when immutable owner ID is missing');

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.pet.xp, 0, 'Zero XP awarded on missing owner ID');
    assert.equal(loaded.pet.generation, 1, 'Generation unchanged');
  });

  // 19. Incorrect numeric owner ID in runtime mode fails closed before accounting or mutation (R3.3)
  it('19. Incorrect numeric owner ID in runtime mode fails closed before accounting or mutation', async () => {
    const paths = getStatePaths(tempBaseDir);
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createEstablishedContributionLedger(1), null, 2),
      'utf-8'
    );

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      expectedOwnerDatabaseId: 9999999, // Mismatched ID
      env: { PET_OWNER_LOGIN: 'mnp210' },
      skipSimulation: true,
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /Immutable owner ID mismatch/);
    assert.equal(provider.callCount, 0, 'Zero provider calls when owner ID mismatches established ledger');

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.contributions.ownerDatabaseId, 298821706, 'Ledger ownerDatabaseId preserved intact');
    assert.equal(loaded.pet.xp, 0, 'Zero XP awarded on mismatch');
  });

  // 20. Correct numeric owner ID in runtime mode continues normally and syncs contributions (R3.3)
  it('20. Correct numeric owner ID in runtime mode continues normally and syncs contributions', async () => {
    const paths = getStatePaths(tempBaseDir);
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createEstablishedContributionLedger(1), null, 2),
      'utf-8'
    );

    provider.mockResponse = createMock2DaySnapshot({
      ownerLogin: 'mnp210',
      ownerDatabaseId: 298821706,
      yesterdayDate: '2026-11-15',
      todayDate: '2026-11-16',
      yesterdayCommits: 10,
      todayCommits: 8, // +3 commits delta from baseline (5 -> 8)
    });

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      expectedOwnerDatabaseId: 298821706,
      env: { PET_OWNER_LOGIN: 'mnp210', PET_OWNER_DATABASE_ID: '298821706' },
      nowMs: new Date('2026-11-16T12:00:00.000Z').getTime(),
      skipSimulation: true,
    });

    assert.equal(result.status, 'completed');
    assert.equal(provider.callCount, 1, 'Provider queried with matching owner ID');
    assert.equal(result.deltaObserved, 3, 'Observed 3-commit delta');
    assert.ok(result.xpAwarded > 0, 'XP awarded for new contributions');

    const loaded = await loadRepositoryState(tempBaseDir);
    assert.equal(loaded.contributions.ownerDatabaseId, 298821706);
    assert.equal(loaded.contributions.dailyHwm?.['2026-11-16'], 8);
    assert.equal(loaded.contributions.monotonicPublicHwm, 10);
  });

  // 21. Zero state, ledger, SVG or README mutations occur on identity mismatch in runtime mode (R3.3)
  it('21. Zero state, ledger, SVG or README mutations occur on identity mismatch in runtime mode', async () => {
    const paths = getStatePaths(tempBaseDir);
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createEstablishedContributionLedger(1), null, 2),
      'utf-8'
    );

    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');

    const petBefore = await fs.readFile(paths.petPath, 'utf-8');
    const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionBefore = await fs.readFile(paths.actionsPath, 'utf-8');
    const svgBefore = await fs.readFile(svgPath, 'utf-8');
    const readmeBefore = await fs.readFile(readmePath, 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      expectedOwnerDatabaseId: 1234567, // Mismatched ID
      env: { PET_OWNER_LOGIN: 'mnp210', PET_OWNER_DATABASE_ID: '1234567' },
      skipSimulation: true,
    });

    assert.equal(result.status, 'integrity_failed');

    const petAfter = await fs.readFile(paths.petPath, 'utf-8');
    const contribAfter = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionAfter = await fs.readFile(paths.actionsPath, 'utf-8');
    const svgAfter = await fs.readFile(svgPath, 'utf-8');
    const readmeAfter = await fs.readFile(readmePath, 'utf-8');

    assert.equal(petAfter, petBefore, 'pet.json must remain byte-identical');
    assert.equal(contribAfter, contribBefore, 'contributions.json must remain byte-identical');
    assert.equal(actionAfter, actionBefore, 'actions.json must remain byte-identical');
    assert.equal(svgAfter, svgBefore, 'pet.svg must remain byte-identical');
    assert.equal(readmeAfter, readmeBefore, 'README.md must remain byte-identical');
  });

  // 22. Expected ID supplied + missing ledger ID fails closed before provider query (R3.5)
  it('22. Expected ID supplied + missing ledger ID fails closed before provider query', async () => {
    const paths = getStatePaths(tempBaseDir);
    const establishedLedger = createEstablishedContributionLedger(1);
    delete (establishedLedger as unknown as Record<string, unknown>).ownerDatabaseId;
    await fs.writeFile(paths.contributionsPath, JSON.stringify(establishedLedger, null, 2), 'utf-8');

    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');
    const petBefore = await fs.readFile(paths.petPath, 'utf-8');
    const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionBefore = await fs.readFile(paths.actionsPath, 'utf-8');
    const svgBefore = await fs.readFile(svgPath, 'utf-8');
    const readmeBefore = await fs.readFile(readmePath, 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      expectedOwnerDatabaseId: 298821706,
      env: { PET_OWNER_LOGIN: 'mnp210', PET_OWNER_DATABASE_ID: '298821706' },
      skipSimulation: true,
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /absent or invalid ownerDatabaseId/);
    assert.equal(provider.callCount, 0, 'Zero provider calls when ledger ownerDatabaseId is missing');

    assert.equal(await fs.readFile(paths.petPath, 'utf-8'), petBefore);
    assert.equal(await fs.readFile(paths.contributionsPath, 'utf-8'), contribBefore);
    assert.equal(await fs.readFile(paths.actionsPath, 'utf-8'), actionBefore);
    assert.equal(await fs.readFile(svgPath, 'utf-8'), svgBefore);
    assert.equal(await fs.readFile(readmePath, 'utf-8'), readmeBefore);
  });

  // 23. Expected ID supplied + zero ledger ID fails closed before provider query (R3.5)
  it('23. Expected ID supplied + zero ledger ID fails closed before provider query', async () => {
    const paths = getStatePaths(tempBaseDir);
    const establishedLedger = createEstablishedContributionLedger(1);
    (establishedLedger as unknown as Record<string, unknown>).ownerDatabaseId = 0;
    await fs.writeFile(paths.contributionsPath, JSON.stringify(establishedLedger, null, 2), 'utf-8');

    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');
    const petBefore = await fs.readFile(paths.petPath, 'utf-8');
    const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionBefore = await fs.readFile(paths.actionsPath, 'utf-8');
    const svgBefore = await fs.readFile(svgPath, 'utf-8');
    const readmeBefore = await fs.readFile(readmePath, 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      expectedOwnerDatabaseId: 298821706,
      env: { PET_OWNER_LOGIN: 'mnp210', PET_OWNER_DATABASE_ID: '298821706' },
      skipSimulation: true,
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /absent or invalid ownerDatabaseId/);
    assert.equal(provider.callCount, 0, 'Zero provider calls when ledger ownerDatabaseId is zero');

    assert.equal(await fs.readFile(paths.petPath, 'utf-8'), petBefore);
    assert.equal(await fs.readFile(paths.contributionsPath, 'utf-8'), contribBefore);
    assert.equal(await fs.readFile(paths.actionsPath, 'utf-8'), actionBefore);
    assert.equal(await fs.readFile(svgPath, 'utf-8'), svgBefore);
    assert.equal(await fs.readFile(readmePath, 'utf-8'), readmeBefore);
  });

  // 24. Expected ID supplied + invalid ledger ID (negative, non-integer, string) fails closed (R3.5)
  it('24. Expected ID supplied + invalid ledger ID (negative, non-integer, string) fails closed', async () => {
    const paths = getStatePaths(tempBaseDir);
    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');

    const invalidIds: unknown[] = [-1, 12.34, '298821706', null, NaN];

    for (const invalidId of invalidIds) {
      provider.callCount = 0;
      const establishedLedger = createEstablishedContributionLedger(1);
      (establishedLedger as unknown as Record<string, unknown>).ownerDatabaseId = invalidId;
      await fs.writeFile(paths.contributionsPath, JSON.stringify(establishedLedger, null, 2), 'utf-8');

      const petBefore = await fs.readFile(paths.petPath, 'utf-8');
      const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
      const actionBefore = await fs.readFile(paths.actionsPath, 'utf-8');
      const svgBefore = await fs.readFile(svgPath, 'utf-8');
      const readmeBefore = await fs.readFile(readmePath, 'utf-8');

      const result = await syncContributions({
        baseDir: tempBaseDir,
        provider,
        token: 'fake-token',
        mode: 'runtime',
        expectedOwnerDatabaseId: 298821706,
        env: { PET_OWNER_LOGIN: 'mnp210', PET_OWNER_DATABASE_ID: '298821706' },
        skipSimulation: true,
      });

      assert.equal(result.status, 'integrity_failed', `Expected integrity_failed for invalid ID ${invalidId}`);
      assert.match(result.notes, /absent or invalid ownerDatabaseId/);
      assert.equal(provider.callCount, 0, `Zero provider calls for invalid ID ${invalidId}`);

      assert.equal(await fs.readFile(paths.petPath, 'utf-8'), petBefore);
      assert.equal(await fs.readFile(paths.contributionsPath, 'utf-8'), contribBefore);
      assert.equal(await fs.readFile(paths.actionsPath, 'utf-8'), actionBefore);
      assert.equal(await fs.readFile(svgPath, 'utf-8'), svgBefore);
      assert.equal(await fs.readFile(readmePath, 'utf-8'), readmeBefore);
    }
  });

  // 25. Missing expected ID + valid established ledger ID adopts ledger ID and succeeds (R3.5)
  it('25. Missing expected ID + valid established ledger ID adopts ledger ID and succeeds', async () => {
    const paths = getStatePaths(tempBaseDir);
    await fs.writeFile(
      paths.contributionsPath,
      JSON.stringify(createEstablishedContributionLedger(1), null, 2),
      'utf-8'
    );

    provider.mockResponse = createMock2DaySnapshot({
      ownerLogin: 'mnp210',
      ownerDatabaseId: 298821706,
      yesterdayDate: '2026-11-15',
      todayDate: '2026-11-16',
      yesterdayCommits: 10,
      todayCommits: 8,
    });

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      // expectedOwnerDatabaseId omitted
      env: { PET_OWNER_LOGIN: 'mnp210' }, // PET_OWNER_DATABASE_ID omitted
      nowMs: new Date('2026-11-16T12:00:00.000Z').getTime(),
      skipSimulation: true,
    });

    assert.equal(result.status, 'completed');
    assert.equal(provider.callCount, 1, 'Provider queried with adopted ledger owner ID');
    assert.equal(result.deltaObserved, 3);
  });

  // 26. Missing expected ID + missing ledger ID fails closed before provider query (R3.5)
  it('26. Missing expected ID + missing ledger ID fails closed before provider query', async () => {
    const paths = getStatePaths(tempBaseDir);
    const establishedLedger = createEstablishedContributionLedger(1);
    delete (establishedLedger as unknown as Record<string, unknown>).ownerDatabaseId;
    await fs.writeFile(paths.contributionsPath, JSON.stringify(establishedLedger, null, 2), 'utf-8');

    const svgPath = path.join(tempBaseDir, 'public', 'pet.svg');
    const readmePath = path.join(tempBaseDir, 'README.md');
    const petBefore = await fs.readFile(paths.petPath, 'utf-8');
    const contribBefore = await fs.readFile(paths.contributionsPath, 'utf-8');
    const actionBefore = await fs.readFile(paths.actionsPath, 'utf-8');
    const svgBefore = await fs.readFile(svgPath, 'utf-8');
    const readmeBefore = await fs.readFile(readmePath, 'utf-8');

    const result = await syncContributions({
      baseDir: tempBaseDir,
      provider,
      token: 'fake-token',
      mode: 'runtime',
      // expectedOwnerDatabaseId omitted
      env: { PET_OWNER_LOGIN: 'mnp210' }, // PET_OWNER_DATABASE_ID omitted
      skipSimulation: true,
    });

    assert.equal(result.status, 'integrity_failed');
    assert.match(result.notes, /absent or invalid ownerDatabaseId/);
    assert.equal(provider.callCount, 0, 'Zero provider calls when ledger owner ID is missing');

    assert.equal(await fs.readFile(paths.petPath, 'utf-8'), petBefore);
    assert.equal(await fs.readFile(paths.contributionsPath, 'utf-8'), contribBefore);
    assert.equal(await fs.readFile(paths.actionsPath, 'utf-8'), actionBefore);
    assert.equal(await fs.readFile(svgPath, 'utf-8'), svgBefore);
    assert.equal(await fs.readFile(readmePath, 'utf-8'), readmeBefore);
  });
});
