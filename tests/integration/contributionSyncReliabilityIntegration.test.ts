// tests/integration/contributionSyncReliabilityIntegration.test.ts
// Sprint 2.4D: End-to-End Reliability, Retry Safety, Failure Handling & Rate Limit Integration Suite

import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth } from '../../src/lib/db/pool.ts';
import { migrateUp } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { PetRepository } from '../../src/lib/db/repositories/petRepository.ts';
import { SessionRepository } from '../../src/lib/db/repositories/sessionRepository.ts';
import { SyncRepository } from '../../src/lib/db/repositories/syncRepository.ts';
import { generateRandomToken } from '../../src/lib/security/crypto.ts';
import { formatSessionCookie } from '../../src/lib/auth/sessionContext.ts';
import { encryptToken } from '../../src/lib/security/crypto.ts';
import {
  setFetchImplementation,
  resetGitHubGraphQLClient,
  getGitHubGraphQLClient,
  ProductionGitHubGraphQLClient,
} from '../../src/lib/github/graphqlClient.ts';
import { reconcileDailyContributionForUser } from '../../src/lib/github/dailyReconciliation.ts';
import { POST as handlePostContributions } from '../../src/app/api/github/contributions/route.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

let userCounter = 0;
function uniqueUser(tag: string) {
  userCounter++;
  const id = `rel_${tag}_${Date.now()}_${userCounter}_${Math.floor(Math.random() * 100000)}`;
  return {
    githubUserId: String(Math.floor(100000 + Math.random() * 899999)),
    username: id,
    primaryHandle: id,
  };
}

function mockGraphQLResponseBody(viewerDatabaseId: string, login: string, publicTotal: number) {
  return JSON.stringify({
    data: {
      viewer: {
        id: 'MDQ6VXNlcjE=',
        databaseId: parseInt(viewerDatabaseId, 10),
        login,
        contributionsCollection: {
          totalCommitContributions: publicTotal,
          totalIssueContributions: 0,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 0,
          restrictedContributionsCount: 0,
          contributionCalendar: {
            totalContributions: publicTotal,
          },
        },
      },
    },
  });
}

describe('Sprint 2.4D: Contribution Sync Reliability, Retry Safety & Failure Handling Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Reliability Tests] Starting local PostgreSQL 16...');
      try {
        const EmbeddedPostgres = require('embedded-postgres').default;
        const testDataDir = path.resolve(process.cwd(), '.pgtest_data');

        embeddedInstance = new EmbeddedPostgres({
          databaseDir: testDataDir,
          port: 5432,
          user: 'test_user',
          password: 'test_password',
          database: 'github_profile_pet_test',
          persistent: true,
        });

        await embeddedInstance.start();
        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Reliability Tests] Embedded PostgreSQL start skipped:', (err as Error).message);
      }
    }

    if (health.ok) {
      isDbAvailable = true;
      pool = getPool();
      await migrateUp();
    }
  });

  after(async () => {
    resetGitHubGraphQLClient();
    if (isDbAvailable) {
      await closePool();
    }
    if (embeddedInstance) {
      try {
        await embeddedInstance.stop();
      } catch {
        // cleanup ignore
      }
    }
  });

  beforeEach(() => {
    resetGitHubGraphQLClient();
    const client = getGitHubGraphQLClient();
    if (client instanceof ProductionGitHubGraphQLClient) {
      client.setDefaultOptions({
        sleepFn: async () => {}, // Instantaneous retries in tests
        retryPolicy: {
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 5,
        },
      });
    }
  });

  afterEach(() => {
    resetGitHubGraphQLClient();
  });

  // Scenario 1: Transient network failure followed by successful retry
  test('1. Transient network failure (ECONNRESET) followed by successful retry awards full rewards', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('net_retry');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_valid_net_token'),
    });

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      if (fetchAttempts === 1) {
        throw new Error('read ECONNRESET at TCP.onStreamRead');
      }
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 5), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const targetDate = '2026-11-15';
    const result = await reconcileDailyContributionForUser(trainer.user.id, targetDate);

    assert.equal(fetchAttempts, 2, 'Must have attempted twice (1 failure + 1 retry)');
    assert.equal(result.currentHighWaterMark, 5);
    assert.equal(result.reward.rewardedIncrements, 5);
    assert.equal(result.reward.xpAwarded, 60);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 60);
  });

  // Scenario 2: Exhausted retry budget
  test('2. Exhausted retry budget halts, reports failure, and leaves database untouched', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('net_exhaust');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_valid_exhaust_token'),
    });

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      throw new Error('connect ETIMEDOUT 140.82.121.4:443');
    });

    const targetDate = '2026-11-15';
    await assert.rejects(
      async () => {
        await reconcileDailyContributionForUser(trainer.user.id, targetDate);
      },
      (err: Error) => err.message.includes('ETIMEDOUT') || err.name === 'GitHubNetworkError'
    );

    assert.equal(fetchAttempts, 3, 'Must have exhausted maxAttempts (3 attempts total)');

    // Verify DB state remains untouched
    const daily = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(daily, null, 'No daily sync state row should exist');

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 0, 'Pet XP must remain 0');
  });

  // Scenario 3: HTTP 5xx retry behavior
  test('3. HTTP 5xx retry behavior: 503 Service Unavailable followed by 200 recovers cleanly', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('server_retry');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_valid_5xx_token'),
    });

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      if (fetchAttempts === 1) {
        return new Response('GitHub Server Overload', { status: 503 });
      }
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 3), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(fetchAttempts, 2);
    assert.equal(result.currentHighWaterMark, 3);
    assert.equal(result.reward.rewardedIncrements, 3);
    assert.equal(result.reward.xpAwarded, 50); // 25 + 15 + 10
  });

  // Scenario 4: Non-retryable HTTP 401 behavior
  test('4. Non-retryable HTTP 401 behavior: fails immediately on attempt 1 with reauthorization required', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('auth_401');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_revoked_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 });
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reauthorizationRequired, true);
    assert.equal(fetchAttempts, 1, 'HTTP 401 must NEVER be retried; exactly 1 attempt');
  });

  // Scenario 5: Permission-denied HTTP 403 is not misclassified as rate limiting
  test('5. Permission-denied HTTP 403 is NOT misclassified as rate limiting', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('perm_403');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_forbidden_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '4950', // clearly not rate limited
        },
      });
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.category, 'PERMISSION_DENIED');
    assert.equal(body.code, 'PERMISSION_DENIED');
    assert.equal(body.retryable, false);
    assert.equal(body.rateLimit, undefined);
    assert.equal(fetchAttempts, 1, 'Permission denied must NOT be retried');
  });

  // Scenario 6: Primary rate-limit handling
  test('6. Primary rate-limit handling: 429 returns structured reset time with no immediate retry storm', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('primary_rl');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_ratelimit_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const resetTimestampEpoch = Math.floor(Date.now() / 1000) + 1800; // 30 minutes in future
    let fetchAttempts = 0;

    setFetchImplementation(async () => {
      fetchAttempts++;
      return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(resetTimestampEpoch),
        },
      });
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 429);
    const body = await res.json();

    assert.equal(body.success, false);
    assert.equal(body.code, 'PRIMARY_RATE_LIMIT');
    assert.equal(body.category, 'PRIMARY_RATE_LIMIT');
    assert.equal(body.rateLimit.kind, 'primary');
    assert.ok(body.rateLimit.resetAt);
    assert.equal(fetchAttempts, 1, 'Primary rate limit must NOT trigger immediate retry storm');
  });

  // Scenario 7: Secondary rate-limit handling
  test('7. Secondary rate-limit handling: reports secondary kind and respects Retry-After', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('secondary_rl');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_sec_rl_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      return new Response(JSON.stringify({ message: 'You have exceeded a secondary rate limit. Please wait.' }), {
        status: 403,
        headers: {
          'retry-after': '60',
        },
      });
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 429);
    assert.equal(res.headers.get('retry-after'), '60');
    const body = await res.json();

    assert.equal(body.success, false);
    assert.equal(body.code, 'SECONDARY_RATE_LIMIT');
    assert.equal(body.category, 'SECONDARY_RATE_LIMIT');
    assert.equal(body.rateLimit.kind, 'secondary');
    assert.equal(body.rateLimit.retryAfterSeconds, 60);
    assert.equal(fetchAttempts, 1, 'Retry-After of 60s exceeds budget; must fail fast without waiting 60s');
  });

  // Scenario 8: Retry-After within budget behavior
  test('8. Retry-After within budget (1s) delays and retries successfully', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('retry_after_budget');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_sec_budget_token'),
    });

    let fetchAttempts = 0;
    setFetchImplementation(async () => {
      fetchAttempts++;
      if (fetchAttempts === 1) {
        return new Response(JSON.stringify({ message: 'secondary rate limit' }), {
          status: 403,
          headers: { 'retry-after': '1' }, // 1 second is within the 2s budget!
        });
      }
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(fetchAttempts, 2, 'Should retry when retry-after <= 2 seconds');
    assert.equal(result.currentHighWaterMark, 2);
    assert.equal(result.reward.rewardedIncrements, 2);
  });

  // Scenario 9: GraphQL errors with HTTP 200 are not treated as complete snapshots
  test('9. GraphQL errors with HTTP 200 are NOT treated as complete snapshots', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('graphql_err_200');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_gql_err_token'),
    });

    setFetchImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: null,
          errors: [{ message: 'Field "viewer" execution error: upstream timeout' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.code, 'GRAPHQL_EXECUTION_ERROR');
    assert.equal(body.category, 'GRAPHQL_ERROR');

    const daily = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(daily, null, 'Must NOT persist any snapshot state on GraphQL execution errors');
  });

  // Scenario 10: Partial contribution data cannot generate rewards
  test('10. Partial contribution data cannot generate rewards', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('partial_data');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_partial_token'),
    });

    // Payload has viewer, but null contributionsCollection and an error
    setFetchImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            viewer: {
              id: 'MDQ6VXNlcjE=',
              databaseId: parseInt(u.githubUserId, 10),
              login: u.username,
              contributionsCollection: null, // Partial/Missing!
            },
          },
          errors: [{ message: 'Internal collection resolution error' }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 502);

    const slices = await pool.query(
      'SELECT * FROM contribution_increment_slices WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(slices.rows.length, 0, 'No reward slices may be created from partial data');

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 0);
  });

  // Scenario 11: Failed upstream requests do not advance reward-eligible state
  test('11. Failed upstream requests do not advance reward-eligible state', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('upstream_fail_seq');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_upfail_token'),
    });

    setFetchImplementation(async () => {
      throw new Error('Upstream timeout during dispatch');
    });

    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    // Verify daily_sync_states was not populated with false zeros or phantom sequence
    const daily = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(daily, null);
  });

  // Scenario 12: Database transaction failure leaves no partial reward, ledger, or pet mutation
  test('12. Database transaction failure rolls back completely leaving zero partial mutations', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('tx_fail');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_tx_token'),
    });

    // Mock client returns valid 10 contributions
    setFetchImplementation(async () => {
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 10), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Acquire an exclusive lock on pet_states to induce a transaction conflict or simulate failure
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT * FROM pet_states WHERE user_id = $1 FOR UPDATE NOWAIT;', [trainer.user.id]);

    // In parallel, call reconcileDailyContributionForUser with short statement timeout to force rollback
    try {
      await pool.query('SET statement_timeout = 200;');
      await assert.rejects(async () => {
        await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
      });
    } finally {
      await pool.query('SET statement_timeout = 0;');
      await client.query('ROLLBACK');
      client.release();
    }

    // Verify ledger and daily states have 0 records
    const ledger = await pool.query('SELECT * FROM activity_reward_ledger WHERE user_id = $1;', [trainer.user.id]);
    assert.equal(ledger.rows.length, 0, 'Ledger must have 0 rows after rollback');

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 0, 'Pet XP must remain 0');
  });

  // Scenario 13: Retry after successful commit does not duplicate rewards
  test('13. Retry after successful commit does NOT duplicate rewards (idempotency)', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('retry_idemp');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_idemp_token'),
    });

    setFetchImplementation(async () => {
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 5), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Run 1: 5 contributions
    const r1 = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(r1.currentHighWaterMark, 5);
    assert.equal(r1.reward.rewardedIncrements, 5);
    assert.equal(r1.reward.xpAwarded, 60);

    const petAfterRun1 = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(petAfterRun1?.xp, 60);

    // Run 2: Exact same 5 contributions
    const r2 = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(r2.currentHighWaterMark, 5);
    assert.equal(r2.newlyObservedIncrements, 0);
    assert.equal(r2.reward.rewardedIncrements, 0);
    assert.equal(r2.reward.xpAwarded, 0);

    const petAfterRun2 = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(petAfterRun2?.xp, 60, 'XP must NOT duplicate on retry');
  });

  // Scenario 14: Lost API response followed by client retry is safe
  test('14. Lost API response followed by client retry receives consistent outcome', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('lost_response');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_lost_resp_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    setFetchImplementation(async () => {
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 4), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    // Client executes request 1
    const req1 = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });
    const res1 = await handlePostContributions(req1);
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.reconciliation.currentHighWaterMark, 4);
    assert.equal(body1.reward.rewardedIncrements, 4);
    assert.equal(body1.reward.xpAwarded, 55); // 25 + 15 + 10 + 5

    // Client lost response and re-submits exact same request
    const req2 = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });
    const res2 = await handlePostContributions(req2);
    assert.equal(res2.status, 200);
    const body2 = await res2.json();

    assert.equal(body2.reconciliation.currentHighWaterMark, 4);
    assert.equal(body2.reconciliation.newlyObservedIncrements, 0);
    assert.equal(body2.reward.rewardedIncrements, 0);
    assert.equal(body2.reward.xpAwarded, 0);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 55, 'XP remains exactly 55');
  });

  // Scenario 15: Concurrent requests preserve snapshot sequence ordering
  test('15. Concurrent requests preserve snapshot sequence ordering and monotonic high-water mark', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('seq_order');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_seq_token'),
    });

    // Allocate two monotonic sequence numbers
    const seq1 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const seq2 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    assert.ok(seq2 > seq1, 'Sequence 2 must be strictly greater than Sequence 1');

    // Snapshot with seq1 has 10 contributions
    await SyncRepository.processContributionSync(trainer.user.id, '2026-11-15', 10, {
      requestSequence: seq1,
      observedAt: '2026-11-15T12:00:00.000Z',
    });

    const stateAfterSeq1 = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(Number(stateAfterSeq1?.latest_request_sequence), seq1);
    assert.equal(stateAfterSeq1?.total_contributions_recorded, 10);

    // Snapshot with seq2 arrives with 8 contributions (e.g. rebase/force push)
    await SyncRepository.processContributionSync(trainer.user.id, '2026-11-15', 8, {
      requestSequence: seq2,
      observedAt: '2026-11-15T12:05:00.000Z',
    });

    const stateAfterSeq2 = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(Number(stateAfterSeq2?.latest_request_sequence), seq2);
    assert.equal(stateAfterSeq2?.latest_observed_contributions, 8);
    assert.equal(stateAfterSeq2?.total_contributions_recorded, 10, 'High-water mark must remain 10');
  });

  // Scenario 16: Token refresh ambiguity still requires reauthorization
  test('16. Token refresh ambiguity requires reauthorization and refuses to replay uncertain refresh token', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('ambiguous_reauth');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_ambig_token'),
      encryptedRefreshToken: encryptToken('ghr_ambig_refresh'),
    });

    // Mark account refresh status as ambiguous (simulate lost rotation confirmation)
    await pool.query(
      "UPDATE github_accounts SET token_refresh_status = 'ambiguous', token_expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1;",
      [trainer.account.id]
    );

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.equal(body.reauthorizationRequired, true);
    assert.equal(body.code, 'REAUTHORIZATION_REQUIRED');
  });

  // Scenario 17: Recovery after a temporary GitHub outage succeeds
  test('17. Recovery after temporary GitHub outage succeeds completely', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('outage_recovery');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_outage_token'),
    });

    // 1. During outage: returns 502
    setFetchImplementation(async () => {
      return new Response('GitHub Hypercube Outage', { status: 502 });
    });

    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    // 2. Outage resolved: returns 200 with 6 contributions
    setFetchImplementation(async () => {
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 6), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const recovered = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(recovered.currentHighWaterMark, 6);
    assert.equal(recovered.reward.rewardedIncrements, 5, 'Hourly throttle allows 5 increments');
    assert.equal(recovered.reward.remainingPendingIncrements, 1, '1 increment remains pending');
    assert.equal(recovered.reward.xpAwarded, 60);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 60);
  });

  // Scenario 18: Error responses contain no secrets or credentials
  test('18. Error responses contain NO secrets, tokens, or credentials in error payloads', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('secret_protection');
    const secretToken = 'ghu_super_secret_unauthorized_token_999888';
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken(secretToken),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Mock upstream returns error text that echoes the bearer authorization header
    setFetchImplementation(async () => {
      return new Response(
        JSON.stringify({
          message: `Failed query with authorization header Bearer ${secretToken} and token ghp_leaked_token_abc123456789.`,
        }),
        { status: 500 }
      );
    });

    const req = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });

    const res = await handlePostContributions(req);
    const bodyText = await res.text();

    assert.ok(!bodyText.includes(secretToken), 'Response must NOT contain raw secret access token');
    assert.ok(!bodyText.includes('ghp_leaked_token_abc123456789'), 'Response must NOT contain raw leaked token');
    assert.ok(bodyText.includes('[REDACTED_TOKEN]') || bodyText.includes('[REDACTED_GITHUB_TOKEN]'));
  });

  // Scenario 19: Sequence allocation on network failure leaves expected gap in user counter
  test('19. Sequence allocation on network failure leaves expected gap in user counter without advancing accepted state', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('seq_gap_net');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_seq_gap_net_token'),
    });

    const userBefore = await UserRepository.findById(trainer.user.id);
    const initialSeq = Number(userBefore?.next_snapshot_sequence ?? 0);

    setFetchImplementation(async () => {
      throw new Error('read ECONNRESET at TCP.onStreamRead');
    });

    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    // Verification: users.next_snapshot_sequence counter incremented
    const userAfter = await UserRepository.findById(trainer.user.id);
    assert.equal(Number(userAfter?.next_snapshot_sequence), initialSeq + 1, 'Allocation counter must increment');

    // Verification: daily_sync_states was NOT touched or created
    const daily = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(daily, null, 'Accepted daily snapshot state must NOT be created');

    // Verification: zero rewardable slices, zero ledger entries, zero pet XP
    const slices = await pool.query('SELECT * FROM contribution_increment_slices WHERE user_id = $1;', [trainer.user.id]);
    assert.equal(slices.rows.length, 0);

    const ledger = await pool.query('SELECT * FROM activity_reward_ledger WHERE user_id = $1;', [trainer.user.id]);
    assert.equal(ledger.rows.length, 0);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 0);
  });

  // Scenario 20: Sequence allocation on timeout leaves gap
  test('20. Sequence allocation on timeout leaves gap and does not create rewardable work', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('seq_gap_timeout');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_seq_gap_to_token'),
    });

    const userBefore = await UserRepository.findById(trainer.user.id);
    const initialSeq = Number(userBefore?.next_snapshot_sequence ?? 0);

    setFetchImplementation(async () => {
      const err = new Error('Request timed out');
      err.name = 'TimeoutError';
      throw err;
    });

    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    const userAfter = await UserRepository.findById(trainer.user.id);
    assert.equal(Number(userAfter?.next_snapshot_sequence), initialSeq + 1);

    const daily = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(daily, null);
  });

  // Scenario 21: Later successful request receives higher sequence and reconciles normally despite sequence gap
  test('21. Later successful request receives higher sequence (with gap) and reconciles normally', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('seq_gap_recover');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_seq_gap_rec_token'),
    });

    // 1. First attempt fails upstream (allocates seq 1, then fails)
    setFetchImplementation(async () => {
      throw new Error('read ECONNRESET');
    });
    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    // 2. Second attempt fails upstream (allocates seq 2, then fails)
    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    const userAfterTwoFails = await UserRepository.findById(trainer.user.id);
    assert.equal(Number(userAfterTwoFails?.next_snapshot_sequence), 2, 'Two sequences were allocated and gapped');

    // 3. Third attempt succeeds (allocates seq 3, provider returns 5 contributions)
    setFetchImplementation(async () => {
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 5), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(result.currentHighWaterMark, 5);
    assert.equal(result.reward.rewardedIncrements, 5);
    assert.equal(result.reward.xpAwarded, 60);

    // Verify daily_sync_states accepted sequence is 3 (reflecting the successful observation)
    const daily = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(Number(daily?.latest_request_sequence), 3, 'Accepted sequence must be 3');
    assert.equal(daily?.total_contributions_recorded, 5);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 60);
  });

  // Scenario 22: Failed request does not change established snapshot state or advance HWM
  test('22. Failed request does NOT change established snapshot state, HWM, or pet progression', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('hwm_protect_on_fail');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_hwm_fail_token'),
    });

    // 1. Initial success: HWM = 5
    setFetchImplementation(async () => {
      return new Response(mockGraphQLResponseBody(u.githubUserId, u.username, 5), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const r1 = await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    assert.equal(r1.currentHighWaterMark, 5);
    const acceptedSeq1 = r1.reward.processedIncrements;
    assert.equal(acceptedSeq1, 5);

    const stateBeforeFail = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    const prevHwm = stateBeforeFail?.total_contributions_recorded;
    const prevSeq = stateBeforeFail?.latest_request_sequence;
    const prevXp = stateBeforeFail?.daily_activity_xp_awarded;

    // 2. Subsequent request fails with 500 error
    setFetchImplementation(async () => {
      return new Response('GitHub Internal Server Error', { status: 500 });
    });
    await assert.rejects(async () => {
      await reconcileDailyContributionForUser(trainer.user.id, '2026-11-15');
    });

    // 3. Verify state after failure is 100% unchanged
    const stateAfterFail = await SyncRepository.getDailySyncState(trainer.user.id, '2026-11-15');
    assert.equal(stateAfterFail?.total_contributions_recorded, prevHwm, 'High-water mark must remain unchanged');
    assert.equal(stateAfterFail?.latest_request_sequence, prevSeq, 'Accepted sequence must remain unchanged');
    assert.equal(stateAfterFail?.daily_activity_xp_awarded, prevXp, 'Daily XP awarded must remain unchanged');
    assert.equal(stateAfterFail?.pending_contribution_increments, 0);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.xp, 60);
  });

  // Scenario 23: Rate-limit vs permission denied classification via API route
  test('23. Authoritative rate-limit vs permission denied API response classification', async (t) => {
    if (!isDbAvailable) return t.skip('Database unavailable');

    const u = uniqueUser('auth_rate_vs_perm');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
      encryptedAccessToken: encryptToken('ghu_perm_vs_rate_token'),
    });

    const rawSessionToken = generateRandomToken(32);
    await SessionRepository.createSession({ userId: trainer.user.id, rawToken: rawSessionToken });
    const cookieHeader = formatSessionCookie(rawSessionToken);

    // Case A: HTTP 403 with x-ratelimit-remaining: 0 -> PRIMARY_RATE_LIMIT (HTTP 429)
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
        },
      });
    });

    const reqA = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });
    const resA = await handlePostContributions(reqA);
    assert.equal(resA.status, 429);
    const bodyA = await resA.json();
    assert.equal(bodyA.code, 'PRIMARY_RATE_LIMIT');
    assert.equal(bodyA.category, 'PRIMARY_RATE_LIMIT');

    // Case B: HTTP 403 with x-ratelimit-remaining: 5000 -> PERMISSION_DENIED (HTTP 403)
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), {
        status: 403,
        headers: {
          'x-ratelimit-remaining': '5000',
        },
      });
    });

    const reqB = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });
    const resB = await handlePostContributions(reqB);
    assert.equal(resB.status, 403);
    const bodyB = await resB.json();
    assert.equal(bodyB.code, 'PERMISSION_DENIED');
    assert.equal(bodyB.category, 'PERMISSION_DENIED');

    // Case C: HTTP 429 with Retry-After: 30 -> SECONDARY_RATE_LIMIT (HTTP 429 with header)
    setFetchImplementation(async () => {
      return new Response(JSON.stringify({ message: 'Secondary rate limit triggered' }), {
        status: 429,
        headers: {
          'retry-after': '30',
        },
      });
    });

    const reqC = new Request('http://localhost:3000/api/github/contributions', {
      method: 'POST',
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-15' }),
    });
    const resC = await handlePostContributions(reqC);
    assert.equal(resC.status, 429);
    assert.equal(resC.headers.get('retry-after'), '30');
    const bodyC = await resC.json();
    assert.equal(bodyC.code, 'SECONDARY_RATE_LIMIT');
    assert.equal(bodyC.category, 'SECONDARY_RATE_LIMIT');
  });
});
