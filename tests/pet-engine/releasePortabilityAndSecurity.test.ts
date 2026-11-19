/**
 * GitHub Profile Pet — R3.21 & R3.22 Release Portability, Owner Authorization & Baseline Test Suite
 *
 * Validates:
 * 1. P1-03: Fail-closed trainer authorization (correct owner, unauthorized author, missing/invalid trustedAuthorId).
 * 2. P1-01: Owner identity dynamic resolution from environment and context (zero hardcoded maintainer identity).
 * 3. P1-02: Multi-owner baseline establishment and foreign-owner fork reinitialization safety rules.
 * 4. Protection of existing matching-owner baseline from accidental or intentional overwriting.
 * 5. Complete-state pristine validation before foreign-fork reinitialization (R3.22-01).
 * 6. Correct authorization for personal and organization-owned repositories (R3.22-02).
 * 7. Security audit and restriction of allowAnyAuthor / bot rejection (R3.22-03).
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  processInbox,
  type GitHubInboxClient,
} from '../../src/features/pet-engine/inbox/index.ts';
import type { GitHubIssue, GitHubIssueComment, PendingIssuesPageResult } from '../../src/features/pet-engine/inbox/types.ts';
import {
  resolveOwnerIdentity,
} from '../../src/features/pet-engine/contribution/identityResolver.ts';
import {
  verifyAdministratorAuthorization,
  AdminAuthorizationError,
} from '../../src/features/pet-engine/contribution/adminAuthorization.ts';
import {
  validatePristineInstallation,
} from '../../src/features/pet-engine/validation/pristineStateValidator.ts';
import {
  executeBaselinePipeline,
} from '../../src/features/pet-engine/publication/baselinePipeline.ts';
import {
  MissingOwnerConfigurationError,
} from '../../src/features/pet-engine/contribution/types.ts';
import {
  saveRepositoryState,
  loadRepositoryState,
} from '../../src/features/pet-engine/persistence/stateRepository.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';
import { ENGINE_SCHEMA_VERSION } from '../../src/features/pet-engine/domain/constants.ts';
import type { GitHubContributionSnapshot, GitHub2DayContributionSnapshot } from '../../src/features/pet-engine/contribution/types.ts';
import { GitHubContributionProvider } from '../../src/features/pet-engine/contribution/contributionProvider.ts';

const mockGitExecutor = async (_cmd: string, args: string[]) => {
  if (args[0] === 'rev-parse') return { stdout: 'mock-commit-sha-1234567890abcdef\n', stderr: '' };
  return { stdout: '', stderr: '' };
};

function createDefaultPetState(generation: number = 1): PetStateDocument {
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
    hunger: 70,
    happiness: 70,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-18T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-18T12:00:00.000Z',
    lastSimulatedAt: '2026-11-18T12:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-18T12:00:00.000Z',
  };
}

// Mock GitHub Inbox Client matching GitHubInboxClient interface
class MockInboxClient implements GitHubInboxClient {
  public issues: Map<number, GitHubIssue> = new Map();
  public comments: Map<number, string[]> = new Map();
  public commentsList: Map<number, GitHubIssueComment[]> = new Map();
  public closedIssues: Set<number> = new Set();
  public labelsAdded: Map<number, string[]> = new Map();
  public labelsRemoved: Map<number, string[]> = new Map();

  addMockIssue(issue: {
    number: number;
    title: string;
    body: string;
    authorId: number;
    authorLogin: string;
    labels?: string[];
    created_at?: string;
  }) {
    const createdAt = issue.created_at ?? '2026-11-18T12:00:00.000Z';
    this.issues.set(issue.number, {
      number: issue.number,
      title: issue.title,
      body: issue.body,
      state: 'open',
      created_at: createdAt,
      updated_at: createdAt,
      labels: (issue.labels ?? ['pet-action:pending', 'pet:feed']).map((name) => ({ name })),
      user: { id: issue.authorId, login: issue.authorLogin },
    });
  }

  async listPendingIssues(
    _repo: string,
    options?: { page?: number; perPage?: number; maxPages?: number }
  ): Promise<PendingIssuesPageResult> {
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
    const perPage = options?.perPage ?? 100;
    const maxPages = options?.maxPages ?? 5;
    const maxFetchable = perPage * maxPages;
    const fetched = list.slice(0, maxFetchable);
    return {
      issues: fetched,
      hasMore: list.length > maxFetchable,
      pageCount: Math.ceil(fetched.length / perPage) || 1,
    };
  }

  async listIssueComments(
    _repo: string,
    issueNumber: number,
    options?: { page?: number; perPage?: number }
  ): Promise<GitHubIssueComment[]> {
    const all = this.commentsList.get(issueNumber) ?? [];
    const page = options?.page ?? 1;
    const perPage = options?.perPage ?? 100;
    const start = (page - 1) * perPage;
    return all.slice(start, start + perPage);
  }

  async getIssue(_repo: string, issueNumber: number): Promise<{ status: number; issue?: GitHubIssue }> {
    if (this.issues.has(issueNumber)) {
      return { status: 200, issue: this.issues.get(issueNumber)! };
    }
    return { status: 404 };
  }

  async commentIssue(_repo: string, issueNumber: number, comment: string): Promise<void> {
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
    const list = this.labelsAdded.get(issueNumber) ?? [];
    list.push(...labels);
    this.labelsAdded.set(issueNumber, list);
    if (this.issues.has(issueNumber)) {
      this.issues.get(issueNumber)!.labels.push(...labels);
    }
  }

  async removeLabel(_repo: string, issueNumber: number, label: string): Promise<void> {
    const list = this.labelsRemoved.get(issueNumber) ?? [];
    list.push(label);
    this.labelsRemoved.set(issueNumber, list);
    if (this.issues.has(issueNumber)) {
      this.issues.get(issueNumber)!.labels = this.issues.get(issueNumber)!.labels.filter(
        (l) => (typeof l === 'string' ? l : l.name).toLowerCase() !== label.toLowerCase()
      );
    }
  }
}

function createMock2DaySnapshot(params: {
  login: string;
  databaseId: number;
  yesterdayDate?: string;
  todayDate?: string;
  yesterdayCommits?: number;
  todayCommits?: number;
}): GitHub2DayContributionSnapshot {
  const yDate = params.yesterdayDate ?? '2026-11-17';
  const tDate = params.todayDate ?? '2026-11-18';
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
    providerLatencyMs: 50,
  };
}

// Mock Contribution Provider extending GitHubContributionProvider
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

describe('R3.21 Release Portability & Fail-Closed Authorization Suite', () => {
  // =========================================================================
  // CATEGORY 1: Fail-Closed Trainer Authorization (P1-02)
  // =========================================================================

  it('SEC-01: Accepts action submitted by authoritative owner (trustedAuthorId)', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-01-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'delicious treat',
        authorId: 1001,
        authorLogin: 'alice',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
      });

      assert.equal(res.acceptedCount, 1);
      assert.equal(res.rejectedCount, 0);
      assert.equal(res.outcomes[0].status, 'accepted');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-02: Rejects action submitted by unauthorized third-party user without state mutation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-02-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 42,
        title: 'pet: feed',
        body: 'unauthorized apple',
        authorId: 9999, // Unauthorized attacker
        authorLogin: 'mallory',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001, // Alice is owner
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.equal(res.outcomes[0].status, 'rejected');
      assert.match(res.outcomes[0].message ?? '', /Unauthorized actor/i);

      // Verify pet state was NOT mutated
      const finalState = await loadRepositoryState(tempDir);
      assert.equal(finalState.pet.hunger, 70);
      assert.equal(finalState.pet.xp, 0);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-03: Fails closed when trustedAuthorId is missing or undefined', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-03-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'apple',
        authorId: 1001,
        authorLogin: 'alice',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: undefined, // Missing configuration
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.match(res.outcomes[0].message ?? '', /trainer/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-04: Fails closed when trustedAuthorId is non-positive or NaN', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-04-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'apple',
        authorId: 0,
        authorLogin: 'ghost',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 0, // Invalid non-positive
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // CATEGORY 2: Dynamic Owner Identity Resolution (P1-01)
  // =========================================================================

  it('ID-01: Successfully resolves owner identity from environment variables', () => {
    const res = resolveOwnerIdentity({
      env: {
        GITHUB_REPOSITORY_OWNER: 'test-user',
        GITHUB_REPOSITORY_OWNER_ID: '12345678',
      },
    });

    assert.equal(res.login, 'test-user');
    assert.equal(res.databaseId, 12345678);
    assert.equal(res.sourceLogin, 'REPOSITORY_OWNER');
    assert.equal(res.sourceDatabaseId, 'REPOSITORY_OWNER_ID');
  });

  it('ID-02: Resolves identity from fallback parameters when env vars absent', () => {
    const res = resolveOwnerIdentity({
      env: {
        PET_OWNER_LOGIN: 'fallback-user',
        PET_OWNER_DATABASE_ID: '87654321',
      },
    });

    assert.equal(res.login, 'fallback-user');
    assert.equal(res.databaseId, 87654321);
    assert.equal(res.sourceLogin, 'PET_OWNER_LOGIN');
    assert.equal(res.sourceDatabaseId, 'PET_OWNER_DATABASE_ID');
  });

  it('ID-03: Throws MissingOwnerConfigurationError when login is missing', () => {
    assert.throws(
      () => {
        resolveOwnerIdentity({
          env: { GITHUB_REPOSITORY_OWNER_ID: '12345' },
        });
      },
      MissingOwnerConfigurationError
    );
  });

  it('ID-04: Throws MissingOwnerConfigurationError when databaseId is missing or non-positive', () => {
    assert.throws(
      () => {
        resolveOwnerIdentity({
          env: { GITHUB_REPOSITORY_OWNER: 'bob', GITHUB_REPOSITORY_OWNER_ID: 'not-a-number' },
        });
      },
      MissingOwnerConfigurationError
    );

    assert.throws(
      () => {
        resolveOwnerIdentity({
          env: { GITHUB_REPOSITORY_OWNER: 'bob', GITHUB_REPOSITORY_OWNER_ID: '0' },
        });
      },
      MissingOwnerConfigurationError
    );
  });

  // =========================================================================
  // CATEGORY 3: Multi-Owner Baseline Pipeline & Foreign Fork Safety (P1-02)
  // =========================================================================

  it('BASE-01: Establishes baseline when no previous baseline exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-01-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 5001,
          ownerLogin: 'newbie',
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const snapshot = createMock2DaySnapshot({
        login: 'newbie',
        databaseId: 5001,
        yesterdayCommits: 2,
        todayCommits: 3,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'newbie',
        expectedOwnerDatabaseId: 5001,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-02: Returns existing without mutation when baseline already established for same owner', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-02-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 5001,
          ownerLogin: 'newbie',
          installationBaseline: { completed: true, installedAt: '2026-11-18T10:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 2, today: 3 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const snapshot = createMock2DaySnapshot({
        login: 'newbie',
        databaseId: 5001,
        yesterdayCommits: 2,
        todayCommits: 3,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'newbie',
        expectedOwnerDatabaseId: 5001,
        dryRun: true,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'baseline_refused');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-03: Refuses foreign baseline when reinitializeForeignFork is false', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-03-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706, // Upstream maintainer ID
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T10:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const snapshot = createMock2DaySnapshot({
        login: 'forker',
        databaseId: 9999,
        yesterdayCommits: 5,
        todayCommits: 5,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'forker',
        expectedOwnerDatabaseId: 9999,
        reinitializeForeignFork: false, // Default fail-safe
        dryRun: true,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'baseline_refused');

      // Verify maintainer's contributions.json is completely untouched
      const loaded = await loadRepositoryState(tempDir);
      assert.equal(loaded.contributions.ownerDatabaseId, 298821706);
      assert.equal(loaded.contributions.ownerLogin, 'mnp210');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-04: Reinitializes foreign baseline when reinitializeForeignFork is true and state is pristine', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-04-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706, // Upstream maintainer ID
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T10:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const snapshot = createMock2DaySnapshot({
        login: 'forker',
        databaseId: 9999,
        yesterdayCommits: 5,
        todayCommits: 5,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'forker',
        expectedOwnerDatabaseId: 9999,
        reinitializeForeignFork: true, // Explicit authorized flag
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-05: Returns error if provider returns a different user than expected', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-05-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 5001,
          ownerLogin: 'newbie',
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      // Provider returns identity for 'someone-else' (ID 8888)
      const snapshot = createMock2DaySnapshot({
        login: 'someone-else',
        databaseId: 8888,
        yesterdayCommits: 2,
        todayCommits: 3,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'newbie',
        expectedOwnerDatabaseId: 5001,
        dryRun: true,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // CATEGORY 4: Mock Inbox Processing with Dynamic Resolution
  // =========================================================================

  it('INT-01: Correctly processes multi-action inbox with dynamic trustedAuthorId', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-int-01-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 7777,
          ownerLogin: 'bob',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 10,
        title: 'pet: feed',
        body: 'delicious snack',
        authorId: 7777,
        authorLogin: 'bob',
        labels: ['pet-action:pending', 'pet:feed'],
        created_at: '2026-11-18T12:00:00.000Z',
      });
      client.addMockIssue({
        number: 11,
        title: 'pet: train',
        body: 'agility course',
        authorId: 7777,
        authorLogin: 'bob',
        labels: ['pet-action:pending', 'pet:train'],
        created_at: '2026-11-18T12:05:00.000Z', // 5 minutes later, past cooldown
      });
      client.addMockIssue({
        number: 12,
        title: 'pet: pet',
        body: 'gentle head scratches',
        authorId: 9999, // Unauthorized
        authorLogin: 'mallory',
        labels: ['pet-action:pending', 'pet:pet'],
        created_at: '2026-11-18T12:10:00.000Z',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 7777,
      });

      assert.equal(res.acceptedCount, 2);
      assert.equal(res.rejectedCount, 1);
      assert.equal(res.outcomes[0].status, 'accepted');
      assert.equal(res.outcomes[1].status, 'accepted');
      assert.equal(res.outcomes[2].status, 'rejected');
      assert.match(res.outcomes[2].message ?? '', /Unauthorized actor/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('INT-02: Rejects all actions when trustedAuthorId is missing from inbox options', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-int-02-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 7777,
          ownerLogin: 'bob',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'food',
        authorId: 7777,
        authorLogin: 'bob',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        // trustedAuthorId omitted
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.match(res.outcomes[0].message ?? '', /trainer/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SECTION 5: Complete-State Pristine Validation (R3.22-01)
  // =========================================================================

  it('BASE-06: Truly pristine foreign fork succeeds after explicit confirmation', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-06-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706, // Foreign
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T13:27:20.455Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: {
            highWaterIssueNumber: 0,
            sparseProcessedIssueNumbers: [],
            retiredNonActionGaps: [],
            unresolvedGaps: [],
          },
        },
      });

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, true);

      const snapshot = createMock2DaySnapshot({
        login: 'forker',
        databaseId: 9999,
        yesterdayCommits: 5,
        todayCommits: 5,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'forker',
        expectedOwnerDatabaseId: 9999,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-07: Fails pristine check when pet XP > 0', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-07-'));
    try {
      const pet = createDefaultPetState(1);
      pet.xp = 55; // Non-zero XP
      await saveRepositoryState(tempDir, {
        pet,
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /Nonzero XP detected/i);

      const snapshot = createMock2DaySnapshot({
        login: 'forker',
        databaseId: 9999,
        yesterdayCommits: 5,
        todayCommits: 5,
      });
      const provider = new MockContributionProvider(snapshot);

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider,
        token: 'fake-token',
        targetOwnerLogin: 'forker',
        expectedOwnerDatabaseId: 9999,
        reinitializeForeignFork: true,
        dryRun: false,
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'integrity_failed');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-08: Fails pristine check when pet generation > 1', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-08-'));
    try {
      const pet = createDefaultPetState(3); // Generation 3
      await saveRepositoryState(tempDir, {
        pet,
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 3,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 3,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /Non-initial generation detected/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-09: Fails pristine check when generations across files do not match', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-09-'));
    try {
      await fs.mkdir(path.join(tempDir, 'pet', 'state'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'pet', 'ledger'), { recursive: true });

      await fs.writeFile(
        path.join(tempDir, 'pet', 'state', 'pet.json'),
        JSON.stringify(createDefaultPetState(1), null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'contributions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 2, // Mismatch
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        }, null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'actions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        }, null, 2)
      );

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /Generation mismatch/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-10: Fails pristine check when contributions.json has slices or historical summaries', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-10-'));
    try {
      await fs.mkdir(path.join(tempDir, 'pet', 'state'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'pet', 'ledger'), { recursive: true });

      await fs.writeFile(
        path.join(tempDir, 'pet', 'state', 'pet.json'),
        JSON.stringify(createDefaultPetState(1), null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'contributions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [{
            sliceId: '2026-11-18:01',
            syncDate: '2026-11-18',
            discoveredAt: '2026-11-18T12:00:00.000Z',
            units: 1,
            status: 'claimed',
            expiryAt: '2026-11-19T12:00:00.000Z',
            evaluatedAt: '2026-11-18T12:00:00.000Z',
          }],
          monthlyHistoricalSummary: [],
        }, null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'actions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        }, null, 2)
      );

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /contributions\.json|slice/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-11: Fails pristine check when contributions.json has non-empty dailyAccruedXp', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-11-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: { '2026-11-18': 55 }, // Accrued XP
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /dailyAccruedXp contains recorded daily XP/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-12: Fails pristine check when actions.json has recentActions', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-12-'));
    try {
      await fs.mkdir(path.join(tempDir, 'pet', 'state'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'pet', 'ledger'), { recursive: true });

      await fs.writeFile(
        path.join(tempDir, 'pet', 'state', 'pet.json'),
        JSON.stringify(createDefaultPetState(1), null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'contributions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        }, null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'actions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [
            {
              action: 'feed',
              timestamp: Date.now(),
              issueNumber: 1,
              authorId: 298821706,
              authorLogin: 'mnp210',
              requestId: 'req-1',
              accepted: true,
            },
          ],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        }, null, 2)
      );

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /Active care action history detected/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-13: Fails pristine check when actions.json has unresolvedGaps or retiredNonActionGaps', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-13-'));
    try {
      await fs.mkdir(path.join(tempDir, 'pet', 'state'), { recursive: true });
      await fs.mkdir(path.join(tempDir, 'pet', 'ledger'), { recursive: true });

      await fs.writeFile(
        path.join(tempDir, 'pet', 'state', 'pet.json'),
        JSON.stringify(createDefaultPetState(1), null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'contributions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        }, null, 2)
      );
      await fs.writeFile(
        path.join(tempDir, 'pet', 'ledger', 'actions.json'),
        JSON.stringify({
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 5, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [1, 2], unresolvedGaps: [6] },
        }, null, 2)
      );

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /Nonzero highWaterIssueNumber/i);
      assert.match(validation.errors.join('; '), /retiredNonActionGaps is not empty/i);
      assert.match(validation.errors.join('; '), /unresolvedGaps is not empty/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-14: Fails pristine check when stray .journal or .lock file exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-14-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      // Inject stray journal directory with entry
      const journalDir = path.join(tempDir, 'pet', '.journal');
      await fs.mkdir(journalDir, { recursive: true });
      await fs.writeFile(path.join(journalDir, 'txn_123.json'), 'stale transaction');

      const validation = await validatePristineInstallation(tempDir, { allowForeignBaseline: true });
      assert.equal(validation.valid, false);
      assert.match(validation.errors.join('; '), /Active or uncommitted transaction journal detected/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('BASE-15: Baseline failure restores original contributions.json byte-for-byte', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-base-15-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 298821706,
          ownerLogin: 'mnp210',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 1, today: 1 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const originalBytes = await fs.readFile(path.join(tempDir, 'pet', 'ledger', 'contributions.json'), 'utf8');

      // Provider throws network/API error
      const failingProvider = new MockContributionProvider(
        undefined,
        new Error('GitHub GraphQL Network Failure')
      );

      const res = await executeBaselinePipeline({
        baseDir: tempDir,
        provider: failingProvider,
        token: 'fake-token',
        targetOwnerLogin: 'forker',
        expectedOwnerDatabaseId: 9999,
        reinitializeForeignFork: true,
        dryRun: false, // Perform actual write to test byte-for-byte restoration
        skipPush: true,
        skipCleanPreflight: true,
        skipBranchCheck: true,
        skipAuthoritativeFileCheck: true,
        gitExecutor: mockGitExecutor,
      });

      assert.equal(res.success, false);
      assert.equal(res.status, 'provider_failed');

      // Verify file is restored byte-for-byte
      const restoredBytes = await fs.readFile(path.join(tempDir, 'pet', 'ledger', 'contributions.json'), 'utf8');
      assert.equal(restoredBytes, originalBytes);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // =========================================================================
  // SECTION 6: Personal and Organization Authorization (R3.22-02)
  // =========================================================================

  it('AUTH-01: Personal repo succeeds when actor equals repositoryOwner (login match)', async () => {
    const auth = await verifyAdministratorAuthorization({
      repository: 'alice/pet',
      repositoryOwner: 'alice',
      actor: 'alice',
      actorId: 1001,
    });
    assert.equal(auth.authorized, true);
    assert.equal(auth.method, 'PERSONAL_OWNER');
    assert.equal(auth.isOrganization, false);
  });

  it('AUTH-02: Personal repo succeeds when actorId equals repoOwnerId', async () => {
    const auth = await verifyAdministratorAuthorization({
      repository: 'alice/pet',
      repositoryOwner: 'alice',
      repositoryOwnerId: 1001,
      actor: 'alice',
      actorId: 1001,
    });
    assert.equal(auth.authorized, true);
    assert.equal(auth.method, 'PERSONAL_OWNER');
  });

  it('AUTH-03: Personal repo fails closed when non-owner actor attempts baseline', async () => {
    await assert.rejects(
      async () => {
        await verifyAdministratorAuthorization({
          repository: 'alice/pet',
          repositoryOwner: 'alice',
          actor: 'bob',
          actorId: 2002,
        });
      },
      AdminAuthorizationError
    );
  });

  it('AUTH-04: Personal repo fails closed when actorId does not match repoOwnerId', async () => {
    await assert.rejects(
      async () => {
        await verifyAdministratorAuthorization({
          repository: 'alice/pet',
          repositoryOwner: 'alice',
          repositoryOwnerId: 1001,
          actor: 'alice',
          actorId: 9999,
        });
      },
      AdminAuthorizationError
    );
  });

  it('AUTH-05: Org repo succeeds when actor matches configured PET_ADMIN_DATABASE_ID / LOGIN', async () => {
    const auth = await verifyAdministratorAuthorization({
      repository: 'acme-corp/pet',
      repositoryOwner: 'acme-corp',
      repositoryOwnerId: 999,
      actor: 'lead-dev',
      actorId: 7777,
      env: {
        PET_ADMIN_DATABASE_ID: '7777',
        PET_ADMIN_LOGIN: 'lead-dev',
      },
    });
    assert.equal(auth.authorized, true);
    assert.equal(auth.isOrganization, true);
    assert.equal(auth.method, 'CONFIGURED_ADMIN_ID');
  });

  it('AUTH-06: Org repo succeeds when actorId matches configured PET_ADMIN_DATABASE_ID alone', async () => {
    const auth = await verifyAdministratorAuthorization({
      repository: 'acme-corp/pet',
      repositoryOwner: 'acme-corp',
      repositoryOwnerId: 999,
      actor: 'lead-dev',
      actorId: 7777,
      env: {
        PET_ADMIN_DATABASE_ID: '7777',
      },
    });
    assert.equal(auth.authorized, true);
    assert.equal(auth.isOrganization, true);
    assert.equal(auth.method, 'CONFIGURED_ADMIN_ID');
  });

  it('AUTH-07: Org repo fails closed when actor does not match configured admin', async () => {
    await assert.rejects(
      async () => {
        await verifyAdministratorAuthorization({
          repository: 'acme-corp/pet',
          repositoryOwner: 'acme-corp',
          actor: 'random-dev',
          actorId: 8888,
          env: {
            PET_ADMIN_DATABASE_ID: '7777',
            PET_ADMIN_LOGIN: 'lead-dev',
          },
        });
      },
      AdminAuthorizationError
    );
  });

  it('AUTH-08: Org repo succeeds when apiPermissionFetcher confirms admin permission', async () => {
    const auth = await verifyAdministratorAuthorization({
      repository: 'acme-corp/pet',
      repositoryOwner: 'acme-corp',
      actor: 'manager',
      actorId: 5555,
      token: 'ghp_mock_token',
      apiPermissionFetcher: async (_repo, username) => {
        if (username === 'manager') return { permission: 'admin' };
        return { permission: 'write' };
      },
    });
    assert.equal(auth.authorized, true);
    assert.equal(auth.isOrganization, true);
    assert.equal(auth.method, 'API_ADMIN_PERMISSION');
  });

  it('AUTH-09: Org repo fails closed on ordinary write collaborator', async () => {
    await assert.rejects(
      async () => {
        await verifyAdministratorAuthorization({
          repository: 'acme-corp/pet',
          repositoryOwner: 'acme-corp',
          actor: 'contributor',
          actorId: 4444,
          token: 'ghp_mock_token',
          apiPermissionFetcher: async () => ({ permission: 'write' }),
        });
      },
      AdminAuthorizationError
    );
  });

  it('AUTH-10: Org repo fails closed on read collaborator or non-collaborator', async () => {
    await assert.rejects(
      async () => {
        await verifyAdministratorAuthorization({
          repository: 'acme-corp/pet',
          repositoryOwner: 'acme-corp',
          actor: 'reader',
          actorId: 3333,
          token: 'ghp_mock_token',
          apiPermissionFetcher: async () => ({ permission: 'read' }),
        });
      },
      AdminAuthorizationError
    );
  });

  it('AUTH-11: Org repo fails closed when no admin configured and no collaboratorChecker', async () => {
    await assert.rejects(
      async () => {
        await verifyAdministratorAuthorization({
          repository: 'acme-corp/pet',
          repositoryOwner: 'acme-corp',
          actor: 'someone',
          actorId: 2222,
        });
      },
      AdminAuthorizationError
    );
  });

  // =========================================================================
  // SECTION 7: allowAnyAuthor Security Audit & Hardening (R3.22-03)
  // =========================================================================

  it('SEC-05: Default processInbox rejects non-owner even when issue body says allowAnyAuthor', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-05-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed [allowAnyAuthor=true]',
        body: 'PET_ALLOW_ANY_AUTHOR=true\nallowAnyAuthor: true\nPlease feed pet!',
        authorId: 9999,
        authorLogin: 'mallory',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
        // allowAnyAuthor is NOT enabled
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.match(res.outcomes[0].message ?? '', /Unauthorized actor/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-06: Explicit allowAnyAuthor=true accepts legitimate human contributor', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-06-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'community treat',
        authorId: 5555,
        authorLogin: 'community-friend',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
        allowAnyAuthor: true, // Community mode enabled
      });

      assert.equal(res.acceptedCount, 1);
      assert.equal(res.rejectedCount, 0);
      assert.equal(res.outcomes[0].status, 'accepted');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-07: Even with allowAnyAuthor=true, github-actions[bot] is rejected', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-07-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'bot treat',
        authorId: 41898282,
        authorLogin: 'github-actions[bot]',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
        allowAnyAuthor: true, // Community mode enabled
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.match(res.outcomes[0].message ?? '', /Unauthorized actor/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-08: Even with allowAnyAuthor=true, any login ending in [bot] is rejected', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-08-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'bot snack',
        authorId: 9876543,
        authorLogin: 'dependabot[bot]',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
        allowAnyAuthor: true,
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
      assert.match(res.outcomes[0].message ?? '', /Unauthorized actor/i);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-09: Rejects authorId <= 0 even when allowAnyAuthor is true', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-09-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'ghost snack',
        authorId: 0,
        authorLogin: 'ghost',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
        allowAnyAuthor: true,
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('SEC-10: Rejects non-number authorId even when allowAnyAuthor is true', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-sec-10-'));
    try {
      await saveRepositoryState(tempDir, {
        pet: createDefaultPetState(1),
        contributions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          ownerDatabaseId: 1001,
          ownerLogin: 'alice',
          installationBaseline: { completed: true, installedAt: '2026-11-18T12:00:00.000Z', baselineDateUtc: '2026-11-18', initialCounts: { yesterday: 0, today: 0 } },
          dailyHwm: {},
          dailyRewardOrdinal: {},
          dailyAccruedXp: {},
          hourlyIncrementUsage: {},
          hourlySliceUsage: {},
          monotonicPublicHwm: 0,
          slices: [],
          monthlyHistoricalSummary: [],
        },
        actions: {
          schemaVersion: ENGINE_SCHEMA_VERSION,
          generation: 1,
          recentActions: [],
          processedRequestRegistry: { highWaterIssueNumber: 0, sparseProcessedIssueNumbers: [], retiredNonActionGaps: [], unresolvedGaps: [] },
        },
      });

      const client = new MockInboxClient();
      client.addMockIssue({
        number: 1,
        title: 'pet: feed',
        body: 'invalid author snack',
        authorId: Number.NaN,
        authorLogin: 'nan-user',
      });

      const res = await processInbox({
        baseDir: tempDir,
        client,
        trustedAuthorId: 1001,
        allowAnyAuthor: true,
      });

      assert.equal(res.acceptedCount, 0);
      assert.equal(res.rejectedCount, 1);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
