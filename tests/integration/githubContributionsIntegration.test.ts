// tests/integration/githubContributionsIntegration.test.ts
// Sprint 2.4A - Real PostgreSQL 16+ Integration Suite for GitHub GraphQL Public Contribution Snapshot Retrieval

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { migrateUp } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { SessionRepository } from '../../src/lib/db/repositories/sessionRepository.ts';
import { PetRepository } from '../../src/lib/db/repositories/petRepository.ts';
import { LedgerRepository } from '../../src/lib/db/repositories/ledgerRepository.ts';
import {
  generateRandomToken,
  encryptToken,
} from '../../src/lib/security/crypto.ts';
import {
  formatSessionCookie,
} from '../../src/lib/auth/sessionContext.ts';
import {
  setGitHubAuthClient,
  resetGitHubAuthClient,
  type GitHubAuthClient,
} from '../../src/lib/auth/githubAuth.ts';
import {
  setGitHubGraphQLClient,
  resetGitHubGraphQLClient,
  type GitHubGraphQLClient,
  GitHubRateLimitError,
  GitHubServerError,
} from '../../src/lib/github/graphqlClient.ts';
import {
  type RawContributionSnapshotResponse,
} from '../../src/lib/github/contributionSnapshot.ts';
import { GET as handleGetContributions } from '../../src/app/api/github/contributions/route.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('GitHub Contributions Snapshot GraphQL Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Contribution Tests] No active database on 5432. Starting local PostgreSQL 16...');
      try {
        const EmbeddedPostgres = require('embedded-postgres').default;
        const testDataDir = path.resolve(process.cwd(), '.pgtest_data');

        embeddedInstance = new EmbeddedPostgres({
          databaseDir: testDataDir,
          port: 5432,
          user: 'test_user',
          password: 'test_password',
        });

        if (!fs.existsSync(testDataDir)) {
          await embeddedInstance?.initialise();
        }

        await embeddedInstance?.start();
        try {
          await embeddedInstance?.createDatabase('github_profile_pet_test');
        } catch {
          // Already exists
        }
        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Contribution Tests] Failed to initialize embedded postgres:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Contribution Tests] Skipping: Database unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
  });

  after(async () => {
    if (isDbAvailable) {
      await closePool();
    }
    if (embeddedInstance) {
      console.log('[Contribution Tests Cleanup] Stopping local PostgreSQL 16...');
      try {
        await embeddedInstance.stop();
      } catch {
        // ignore shutdown error
      }
    }
  });

  beforeEach(() => {
    resetGitHubAuthClient();
    resetGitHubGraphQLClient();
  });

  afterEach(() => {
    resetGitHubAuthClient();
    resetGitHubGraphQLClient();
  });

  test('1. Unauthenticated request to /api/github/contributions returns HTTP 401', async () => {
    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'GET',
    });
    const res = await handleGetContributions(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('Authentication required'));
  });

  test('2. Successful snapshot retrieval: authentic user resolves account and returns normalized counts', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const testGithubUserId = 'gh_user_contributions_ok_1';
    const testUsername = 'octocat_sync_1';
    const plainToken = 'ghu_access_token_mock_12345';
    const encryptedAccess = encryptToken(plainToken);

    const trainer = await UserRepository.createTrainer({
      githubUserId: testGithubUserId,
      username: testUsername,
      primaryHandle: testUsername,
      encryptedAccessToken: encryptedAccess,
      tokenExpiresAt: new Date(Date.now() + 3600 * 1000), // Valid for 1 hour
    });
    const userId = trainer.user.id;

    // Create session
    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Mock GraphQL client returning authentic GitHub viewer payload
    const mockResponse: RawContributionSnapshotResponse = {
      viewer: {
        id: 'MDQ6VXNlcjEyMzQ1',
        databaseId: 1001,
        login: testUsername,
        contributionsCollection: {
          totalCommitContributions: 25,
          totalIssueContributions: 4,
          totalPullRequestContributions: 7,
          totalPullRequestReviewContributions: 3,
          restrictedContributionsCount: 10,
          contributionCalendar: {
            totalContributions: 39,
          },
        },
      },
    };

    // Override github_user_id in DB to match mock numeric ID '1001'
    await pool.query('UPDATE github_accounts SET github_user_id = $1 WHERE id = $2;', ['1001', trainer.account.id]);

    let executedQuery = '';
    let executedToken = '';
    const mockGraphQL: GitHubGraphQLClient = {
      async execute<T>(_query: string, _vars: Record<string, unknown>, accessToken: string): Promise<T> {
        executedQuery = _query;
        executedToken = accessToken;
        return mockResponse as T;
      },
    };
    setGitHubGraphQLClient(mockGraphQL);

    const req = new Request('http://localhost:3000/api/github/contributions?from=2026-11-01T00:00:00Z&to=2026-11-15T23:59:59Z', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 200);

    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.snapshot);
    assert.equal(body.snapshot.githubUserId, '1001');
    assert.equal(body.snapshot.username, testUsername);
    assert.equal(body.snapshot.period.from, '2026-11-01T00:00:00.000Z');
    assert.equal(body.snapshot.period.to, '2026-11-15T23:59:59.000Z');
    assert.equal(body.snapshot.visibility, 'mixed_restricted');
    assert.equal(body.snapshot.hasRestrictedContributions, true);

    // Counts
    assert.equal(body.snapshot.contributions.commits, 25);
    assert.equal(body.snapshot.contributions.issues, 4);
    assert.equal(body.snapshot.contributions.pullRequests, 7);
    assert.equal(body.snapshot.contributions.pullRequestReviews, 3);
    assert.equal(body.snapshot.contributions.restricted, 10);
    assert.equal(body.snapshot.contributions.total, 39);
    assert.equal(body.snapshot.contributions.publicTotal, 39);

    // Verify token passed to GraphQL was decrypted plaintext
    assert.equal(executedToken, plainToken);
    assert.ok(executedQuery.includes('contributionsCollection'));
  });

  test('3. Disconnected GitHub account is rejected with HTTP 403 Forbidden', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const testGithubUserId = 'gh_user_disconn_test';
    const trainer = await UserRepository.createTrainer({
      githubUserId: testGithubUserId,
      username: 'disconnected_trainer',
      primaryHandle: 'disconnected_trainer',
      encryptedAccessToken: encryptToken('some_token'),
    });

    // Mark disconnected
    await pool.query('UPDATE github_accounts SET is_disconnected = TRUE WHERE id = $1;', [trainer.account.id]);

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('disconnected'));
  });

  test('4. Missing encrypted credentials rejected with HTTP 403 Forbidden', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_user_no_creds',
      username: 'no_creds_user',
      primaryHandle: 'no_creds_user',
      encryptedAccessToken: null,
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('no stored credentials'));
  });

  test('5. Identity mismatch between GraphQL response and DB account returns HTTP 403 Forbidden', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '777888',
      username: 'legit_user',
      primaryHandle: 'legit_user',
      encryptedAccessToken: encryptToken('ghu_some_valid_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Mock GraphQL returns a different viewer databaseId (e.g. attacker or different account 999999)
    const mockResponse: RawContributionSnapshotResponse = {
      viewer: {
        id: 'MDQ6VXNlcjk5OTk5OQ==',
        databaseId: 999999, // Mismatched!
        login: 'attacker_user',
        contributionsCollection: {
          totalCommitContributions: 10,
          totalIssueContributions: 0,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 0,
          restrictedContributionsCount: 0,
          contributionCalendar: { totalContributions: 10 },
        },
      },
    };

    const mockGraphQL: GitHubGraphQLClient = {
      async execute<T>(): Promise<T> {
        return mockResponse as T;
      },
    };
    setGitHubGraphQLClient(mockGraphQL);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('Identity mismatch'));
  });

  test('6. Username rename safely updates stored username and handle', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '888999',
      username: 'old_handle_name',
      primaryHandle: 'old_handle_name',
      encryptedAccessToken: encryptToken('ghu_rename_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Mock GraphQL returns new username
    const mockResponse: RawContributionSnapshotResponse = {
      viewer: {
        id: 'MDQ6VXNlcjg4ODk5OQ==',
        databaseId: 888999,
        login: 'new_renamed_handle',
        contributionsCollection: {
          totalCommitContributions: 5,
          totalIssueContributions: 1,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 0,
          restrictedContributionsCount: 0,
          contributionCalendar: { totalContributions: 6 },
        },
      },
    };

    setGitHubGraphQLClient({
      async execute<T>(): Promise<T> {
        return mockResponse as T;
      },
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 200);

    // Allow asynchronous background handle update to complete
    await new Promise((r) => setTimeout(r, 100));

    // Verify handle in DB was updated
    const updatedUser = await UserRepository.findById(trainer.user.id);
    assert.equal(updatedUser?.primary_handle, 'new_renamed_handle');
  });

  test('7. Automatic token refresh: transparently refreshes expired access token using stored refresh token', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const initialAccessToken = 'ghu_expired_access_token_111';
    const initialRefreshToken = 'ghr_valid_refresh_token_222';
    const refreshedAccessToken = 'ghu_FRESH_access_token_333';
    const rotatedRefreshToken = 'ghr_NEW_rotated_refresh_token_444';

    const trainer = await UserRepository.createTrainer({
      githubUserId: '555444',
      username: 'token_refresh_user',
      primaryHandle: 'token_refresh_user',
      encryptedAccessToken: encryptToken(initialAccessToken),
      encryptedRefreshToken: encryptToken(initialRefreshToken),
      tokenExpiresAt: new Date(Date.now() - 3600 * 1000), // Expired 1 hour ago
      refreshExpiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000), // Refresh valid for 30 days
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Mock Auth Client for refreshToken
    let authRefreshTokenCalled = false;
    const mockAuthClient: GitHubAuthClient = {
      async exchangeCode() { throw new Error('Not used'); },
      async fetchUser() { throw new Error('Not used'); },
      async revokeGrant() { throw new Error('Not used'); },
      async refreshToken(refreshToken: string) {
        authRefreshTokenCalled = true;
        assert.equal(refreshToken, initialRefreshToken);
        return {
          accessToken: refreshedAccessToken,
          refreshToken: rotatedRefreshToken,
          expiresIn: 28800,
          refreshTokenExpiresIn: 15811200,
          tokenType: 'bearer',
          scope: '',
        };
      },
    };
    setGitHubAuthClient(mockAuthClient);

    // Mock GraphQL client
    let tokenReceivedByGraphQL = '';
    const mockGraphQL: GitHubGraphQLClient = {
      async execute<T>(_query: string, _vars: Record<string, unknown>, accessToken: string): Promise<T> {
        tokenReceivedByGraphQL = accessToken;
        return {
          viewer: {
            id: 'MDQ6VXNlcjU1NTQ0NA==',
            databaseId: 555444,
            login: 'token_refresh_user',
            contributionsCollection: {
              totalCommitContributions: 12,
              totalIssueContributions: 0,
              totalPullRequestContributions: 1,
              totalPullRequestReviewContributions: 0,
              restrictedContributionsCount: 0,
              contributionCalendar: { totalContributions: 13 },
            },
          },
        } as T;
      },
    };
    setGitHubGraphQLClient(mockGraphQL);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 200);
    assert.equal(authRefreshTokenCalled, true, 'refreshToken must have been called on auth client');
    assert.equal(tokenReceivedByGraphQL, refreshedAccessToken, 'GraphQL client must have received the fresh token');

    // Verify database was updated with new token expiration
    const updatedAccount = await pool.query<{ token_expires_at: Date }>(
      'SELECT token_expires_at FROM github_accounts WHERE id = $1;',
      [trainer.account.id]
    );
    assert.ok(new Date(updatedAccount.rows[0].token_expires_at).getTime() > Date.now());
  });

  test('8. Session ownership isolation: User A session cookie cannot access User B data', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainerA = await UserRepository.createTrainer({
      githubUserId: 'usr_A_101',
      username: 'user_a_owner',
      primaryHandle: 'user_a_owner',
      encryptedAccessToken: encryptToken('token_a'),
    });

    await UserRepository.createTrainer({
      githubUserId: 'usr_B_102',
      username: 'user_b_owner',
      primaryHandle: 'user_b_owner',
      encryptedAccessToken: encryptToken('token_b'),
    });

    // Generate session for User A
    const rawSessionTokenA = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainerA.user.id, rawToken: rawSessionTokenA });
    const cookieHeaderA = formatSessionCookie(rawSessionTokenA);

    setGitHubGraphQLClient({
      async execute<T>(): Promise<T> {
        return {
          viewer: {
            id: 'MDQ6VXNlcjEwMQ==',
            databaseId: 101,
            login: 'user_a_owner',
            contributionsCollection: {
              totalCommitContributions: 7,
              totalIssueContributions: 0,
              totalPullRequestContributions: 0,
              totalPullRequestReviewContributions: 0,
              restrictedContributionsCount: 0,
              contributionCalendar: { totalContributions: 7 },
            },
          },
        } as T;
      },
    });

    await pool.query('UPDATE github_accounts SET github_user_id = $1 WHERE id = $2;', ['101', trainerA.account.id]);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeaderA },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.snapshot.username, 'user_a_owner');
    assert.notEqual(body.snapshot.username, 'user_b_owner');
  });

  test('9. Provider failure (502 / 503) does NOT mutate pet state or insert reward ledger entries', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '333222',
      username: 'safe_failure_user',
      primaryHandle: 'safe_failure_user',
      encryptedAccessToken: encryptToken('token_fail_safe'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Initial pet state
    const initialPet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(initialPet);

    // Initial ledger count
    const initialLedger = await LedgerRepository.getRecentHistory(trainer.user.id, 10);
    assert.equal(initialLedger.length, 0);

    // Mock GraphQL throws upstream server error
    setGitHubGraphQLClient({
      async execute(): Promise<never> {
        throw new GitHubServerError(502, 'Bad Gateway from GitHub GraphQL');
      },
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 502);

    // Verify Pet state is strictly identical
    const afterPet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(afterPet?.xp, initialPet.xp);
    assert.equal(afterPet?.level, initialPet.level);
    assert.equal(afterPet?.energy, initialPet.energy);
    assert.equal(afterPet?.hunger, initialPet.hunger);
    assert.equal(afterPet?.happiness, initialPet.happiness);

    // Verify Ledger rows are still 0
    const afterLedger = await LedgerRepository.getRecentHistory(trainer.user.id, 10);
    assert.equal(afterLedger.length, 0, 'No reward ledger entry should ever be inserted on provider failure');
  });

  test('10. Repeated snapshot retrieval does NOT award duplicate rewards (read-only verification)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '444333',
      username: 'readonly_user',
      primaryHandle: 'readonly_user',
      encryptedAccessToken: encryptToken('token_readonly'),
    });

    await pool.query('UPDATE github_accounts SET github_user_id = $1 WHERE id = $2;', ['444333', trainer.account.id]);

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    setGitHubGraphQLClient({
      async execute<T>(): Promise<T> {
        return {
          viewer: {
            id: 'MDQ6VXNlcjQ0NDMzMw==',
            databaseId: 444333,
            login: 'readonly_user',
            contributionsCollection: {
              totalCommitContributions: 100,
              totalIssueContributions: 10,
              totalPullRequestContributions: 10,
              totalPullRequestReviewContributions: 10,
              restrictedContributionsCount: 0,
              contributionCalendar: { totalContributions: 130 },
            },
          },
        } as T;
      },
    });

    // Execute 3 repeated queries
    for (let i = 0; i < 3; i++) {
      const req = new Request('http://localhost:3000/api/github/contributions', {
        headers: { cookie: cookieHeader },
      });
      const res = await handleGetContributions(req);
      assert.equal(res.status, 200);
    }

    // Verify no ledger entries were created
    const ledgerRows = await LedgerRepository.getRecentHistory(trainer.user.id, 10);
    assert.equal(ledgerRows.length, 0, 'Repeated snapshot requests must never award XP or insert ledger rows');

    // Verify pet state is untouched
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 0);
    assert.equal(pet?.level, 1);
  });

  test('11. Rate limit response (429) propagates 429 status and Retry-After header', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '666555',
      username: 'ratelimit_user',
      primaryHandle: 'ratelimit_user',
      encryptedAccessToken: encryptToken('token_ratelimit'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    setGitHubGraphQLClient({
      async execute(): Promise<never> {
        throw new GitHubRateLimitError('Rate limited by GitHub', new Date(Date.now() + 60000), 60);
      },
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '60');
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.toLowerCase().includes('rate limit'));
  });

  test('12. Invalid date range query returns HTTP 400 Bad Request', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '121212',
      username: 'daterange_user',
      primaryHandle: 'daterange_user',
      encryptedAccessToken: encryptToken('token_dates'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Start after End
    const req = new Request('http://localhost:3000/api/github/contributions?from=2026-11-20&to=2026-11-10', {
      headers: { cookie: cookieHeader },
    });

    const res = await handleGetContributions(req);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.ok(body.error.includes('cannot be after'));
  });
});
