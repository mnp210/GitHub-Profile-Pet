// tests/integration/internalSyncEndpointIntegration.test.ts
// Sprint 2.5D: Integration Test Suite for Internal Background Sync Trigger Endpoint
// Verifies authentication, constant-time validation, coordinator invocation,
// advisory-lock contention, concurrency, sanitization, and error isolation.

import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { migrateUp } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { encryptToken } from '../../src/lib/security/crypto.ts';
import {
  setGitHubGraphQLClient,
  resetGitHubGraphQLClient,
} from '../../src/lib/github/graphqlClient.ts';
import {
  POST,
  GET,
  PUT,
  DELETE,
  PATCH,
  setCoordinatorForTesting,
} from '../../src/app/api/internal/sync/route.ts';
import {
  GLOBAL_ADVISORY_LOCK_ID,
  type BackgroundBatchRunResult,
} from '../../src/lib/sync/backgroundSyncCoordinator.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;

const VALID_TEST_SECRET = 'cron_secret_test_value_7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c';

interface IEmbeddedPostgres {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

let userCounter = 0;
function uniqueTrainerPayload(tag: string) {
  userCounter++;
  const id = `route_${tag}_${Date.now()}_${userCounter}_${Math.floor(Math.random() * 100000)}`;
  return {
    githubUserId: '400000',
    username: id,
    primaryHandle: id,
    encryptedAccessToken: encryptToken(`enc_tok_${tag}`),
    tokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

describe('Internal Background Sync Trigger Endpoint Integration Suite', () => {
  let isDbAvailable = false;
  let pool: Pool;
  let embeddedInstance: IEmbeddedPostgres | null = null;
  const originalSecret = process.env.SYNC_CRON_SECRET;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
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
        } catch {}
        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Route Tests] Embedded postgres start error:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Route Tests] Skipping: DB unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
  });

  after(async () => {
    // Restore environment
    if (originalSecret !== undefined) {
      process.env.SYNC_CRON_SECRET = originalSecret;
    } else {
      delete process.env.SYNC_CRON_SECRET;
    }
    setCoordinatorForTesting(null);
    resetGitHubGraphQLClient();

    if (isDbAvailable) {
      try {
        await pool.query(
          "UPDATE sync_batch_coordination SET active_batch_id = '00000000-0000-0000-0000-000000000000', active_generation = 1 WHERE id = 1;"
        );
      } catch {}
      await closePool();
    }
    if (embeddedInstance) {
      try {
        await embeddedInstance.stop();
      } catch {}
    }
  });

  beforeEach(async () => {
    // Default valid secret for each test unless explicitly changed
    process.env.SYNC_CRON_SECRET = VALID_TEST_SECRET;
    setCoordinatorForTesting(null);

    // Mock GraphQL client returning 5 public contributions
    setGitHubGraphQLClient({
      async execute<T>(): Promise<T> {
        return {
          viewer: {
            id: 'MDQ6VXNlcjQwMDAwMA==',
            databaseId: 400000,
            login: 'route_test_user',
            contributionsCollection: {
              totalCommitContributions: 5,
              totalIssueContributions: 0,
              totalPullRequestContributions: 0,
              totalPullRequestReviewContributions: 0,
              restrictedContributionsCount: 0,
              contributionCalendar: { totalContributions: 5 },
            },
          },
        } as T;
      },
    });

    if (isDbAvailable) {
      await pool.query(
        'TRUNCATE TABLE users, github_accounts, sync_transaction_attempts, sync_transaction_receipts, sync_batch_runs CASCADE;'
      );
    }
  });

  // 1. Missing secret configuration
  test('1. Missing secret configuration: Returns HTTP 503 when SYNC_CRON_SECRET is unconfigured', async () => {
    delete process.env.SYNC_CRON_SECRET;

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VALID_TEST_SECRET}`,
      },
    });

    const res = await POST(request);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.code, 'SYNC_SECRET_NOT_CONFIGURED');
    assert.match(body.error, /not configured/i);
  });

  // 2. Missing authorization header
  test('2. Missing authorization header: Returns HTTP 401 when Authorization header is absent', async () => {
    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
    });

    const res = await POST(request);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
    assert.match(body.error, /missing or malformed/i);
  });

  // 3. Incorrect secret
  test('3. Incorrect secret: Returns HTTP 401 when invalid bearer token is provided', async () => {
    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer invalid_secret_token_attempt',
      },
    });

    const res = await POST(request);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, 'UNAUTHORIZED');
    assert.match(body.error, /invalid authorization/i);
  });

  // 4. Correct secret
  test('4. Correct secret: Authenticates successfully and proceeds to coordinator', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VALID_TEST_SECRET}`,
      },
    });

    const res = await POST(request);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.status, 'completed');
    assert.ok(body.batchId);
  });

  // 5. Coordinator invocation after authentication
  test('5. Coordinator invocation after authentication: Calls coordinator exactly once with provided targetDate', async () => {
    let coordinatorCalled = false;
    let receivedOptions: unknown = null;

    setCoordinatorForTesting(async (options) => {
      coordinatorCalled = true;
      receivedOptions = options;
      return {
        batchId: 'mock-batch-0001',
        batchGeneration: 2,
        status: 'completed',
        metrics: {
          accountsDiscovered: 0,
          leaseAcquisitionAttempts: 0,
          accountsAttempted: 0,
          successfulSyncs: 0,
          noChangeSyncs: 0,
          failedSyncs: 0,
          commitOutcomeUnknown: 0,
          skippedContended: 0,
          leaseAcquisitionErrors: 0,
          deferredLimit: 0,
          rateLimitedAccounts: 0,
          reauthRequiredAccounts: 0,
          timedOutAccounts: 0,
          fencedStaleAccounts: 0,
          pendingRewardsProcessed: 0,
          expiredSlicesProcessed: 0,
          totalXpAwarded: 0,
        },
        durationMs: 12,
      };
    });

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VALID_TEST_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetDate: '2026-11-15' }),
    });

    const res = await POST(request);
    assert.equal(res.status, 200);
    assert.equal(coordinatorCalled, true, 'Coordinator must be invoked after successful authentication');
    assert.deepEqual(receivedOptions, { targetDate: '2026-11-15' });
  });

  // 6. Coordinator not invoked after failed authentication
  test('6. Coordinator not invoked after failed authentication', async () => {
    let coordinatorCalled = false;
    setCoordinatorForTesting(async () => {
      coordinatorCalled = true;
      throw new Error('Should never reach coordinator');
    });

    // 1. Missing secret configuration
    delete process.env.SYNC_CRON_SECRET;
    const req1 = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TEST_SECRET}` },
    });
    const res1 = await POST(req1);
    assert.equal(res1.status, 503);
    assert.equal(coordinatorCalled, false);

    // 2. Wrong secret
    process.env.SYNC_CRON_SECRET = VALID_TEST_SECRET;
    const req2 = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: 'Bearer bad_secret' },
    });
    const res2 = await POST(req2);
    assert.equal(res2.status, 401);
    assert.equal(coordinatorCalled, false);

    // 3. Malformed header
    const req3 = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    const res3 = await POST(req3);
    assert.equal(res3.status, 401);
    assert.equal(coordinatorCalled, false);
  });

  // 7. Concurrent endpoint requests
  test('7. Concurrent endpoint requests: One batch proceeds while contending request defers', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    await UserRepository.createTrainer(uniqueTrainerPayload('t7'));

    const makeRequest = () =>
      new Request('http://localhost:3000/api/internal/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_TEST_SECRET}`,
        },
      });

    // Fire two requests concurrently
    const [res1, res2] = await Promise.all([POST(makeRequest()), POST(makeRequest())]);

    const statuses = [res1.status, res2.status].sort();
    // One must succeed (200), and one must defer due to lock contention (409)
    assert.deepEqual(statuses, [200, 409], 'Exactly one request succeeds and one defers with 409 Conflict');

    const body409 = await (res1.status === 409 ? res1.json() : res2.json());
    assert.equal(body409.status, 'deferred_contention');
    assert.equal(body409.code, 'DEFERRED_CONTENTION');
  });

  // 8. Global advisory-lock contention
  test('8. Global advisory-lock contention: Returns HTTP 409 when global lock is held externally', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const holdingClient = await pool.connect();
    try {
      const lockRes = await holdingClient.query<{ pg_try_advisory_lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock;',
        [GLOBAL_ADVISORY_LOCK_ID]
      );
      assert.equal(lockRes.rows[0].pg_try_advisory_lock, true, 'External client acquired lock');

      const request = new Request('http://localhost:3000/api/internal/sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${VALID_TEST_SECRET}`,
        },
      });

      const res = await POST(request);
      assert.equal(res.status, 409);
      const body = await res.json();
      assert.equal(body.status, 'deferred_contention');
      assert.equal(body.code, 'DEFERRED_CONTENTION');
      assert.match(body.error, /advisory lock/i);
    } finally {
      await holdingClient.query('SELECT pg_advisory_unlock($1);', [GLOBAL_ADVISORY_LOCK_ID]);
      holdingClient.release();
    }
  });

  // 9. Successful batch response
  test('9. Successful batch response: Returns HTTP 200 with sanitized completed metrics', async () => {
    const mockResult: BackgroundBatchRunResult = {
      batchId: 'e2a87265-1d48-43d9-93ef-1b2c3d4e5f6a',
      batchGeneration: 3,
      status: 'completed',
      metrics: {
        accountsDiscovered: 5,
        leaseAcquisitionAttempts: 5,
        accountsAttempted: 5,
        successfulSyncs: 5,
        noChangeSyncs: 0,
        failedSyncs: 0,
        commitOutcomeUnknown: 0,
        skippedContended: 0,
        leaseAcquisitionErrors: 0,
        deferredLimit: 0,
        rateLimitedAccounts: 0,
        reauthRequiredAccounts: 0,
        timedOutAccounts: 0,
        fencedStaleAccounts: 0,
        pendingRewardsProcessed: 2,
        expiredSlicesProcessed: 0,
        totalXpAwarded: 50,
      },
      durationMs: 345,
    };

    setCoordinatorForTesting(async () => mockResult);

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TEST_SECRET}` },
    });

    const res = await POST(request);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.status, 'completed');
    assert.equal(body.batchId, mockResult.batchId);
    assert.equal(body.batchGeneration, 3);
    assert.equal(body.metrics.successfulSyncs, 5);
    assert.equal(body.metrics.totalXpAwarded, 50);
  });

  // 10. Partial completion response
  test('10. Partial completion response: Returns HTTP 200 with status partially_completed', async () => {
    const mockResult: BackgroundBatchRunResult = {
      batchId: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
      batchGeneration: 4,
      status: 'partially_completed',
      metrics: {
        accountsDiscovered: 4,
        leaseAcquisitionAttempts: 4,
        accountsAttempted: 4,
        successfulSyncs: 3,
        noChangeSyncs: 0,
        failedSyncs: 1,
        commitOutcomeUnknown: 0,
        skippedContended: 0,
        leaseAcquisitionErrors: 0,
        deferredLimit: 0,
        rateLimitedAccounts: 1,
        reauthRequiredAccounts: 0,
        timedOutAccounts: 0,
        fencedStaleAccounts: 0,
        pendingRewardsProcessed: 0,
        expiredSlicesProcessed: 0,
        totalXpAwarded: 30,
      },
      durationMs: 412,
    };

    setCoordinatorForTesting(async () => mockResult);

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TEST_SECRET}` },
    });

    const res = await POST(request);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.status, 'partially_completed');
    assert.equal(body.metrics.successfulSyncs, 3);
    assert.equal(body.metrics.failedSyncs, 1);
  });

  // 11. Internal coordinator failure
  test('11. Internal coordinator failure: Returns HTTP 500 without leaking stack traces or internal details', async () => {
    setCoordinatorForTesting(async () => {
      throw new Error('FATAL_DB_POOL_EXHAUSTION: connection string postgres://test_user:secret@db.internal:5432/main');
    });

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TEST_SECRET}` },
    });

    const res = await POST(request);
    assert.equal(res.status, 500);
    const body = await res.json();

    assert.equal(body.success, false);
    assert.equal(body.code, 'INTERNAL_COORDINATOR_ERROR');
    assert.equal(body.error, 'Internal background sync coordinator failure');
    // Ensure sensitive exception text is scrubbed
    assert.equal(JSON.stringify(body).includes('postgres://'), false);
    assert.equal(JSON.stringify(body).includes('secret'), false);
    assert.equal(JSON.stringify(body).includes('stack'), false);
  });

  // 12. Sanitization of returned errors and summaries
  test('12. Sanitization of returned errors and summaries: Zero user IDs, tokens, or credentials exposed', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    await UserRepository.createTrainer(uniqueTrainerPayload('t12'));

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${VALID_TEST_SECRET}` },
    });

    const res = await POST(request);
    const bodyText = await res.text();
    const body = JSON.parse(bodyText);

    // Verify allowed top-level keys
    const allowedKeys = new Set(['success', 'status', 'batchId', 'batchGeneration', 'metrics', 'durationMs', 'error', 'code']);
    for (const key of Object.keys(body)) {
      assert.ok(allowedKeys.has(key), `Disallowed top-level key in response: ${key}`);
    }

    // Ensure metrics contain strictly numbers
    for (const [key, val] of Object.entries(body.metrics)) {
      assert.equal(typeof val, 'number', `Metric ${key} must be numeric, got ${typeof val}`);
    }

    // Negative assertions for sensitive terms
    assert.equal(bodyText.includes('enc_tok'), false, 'Response must not contain access tokens');
    assert.equal(bodyText.includes('encrypted_access_token'), false);
    assert.equal(bodyText.includes('github_account_id'), false);
    assert.equal(bodyText.includes('primary_handle'), false);
    assert.equal(bodyText.includes('password'), false);
  });

  // 13. No secret leakage in logs or responses
  test('13. No secret leakage in logs or responses', async () => {
    const interceptedLogs: string[] = [];
    const origError = console.error;
    const origWarn = console.warn;
    const origLog = console.log;

    console.error = (...args: unknown[]) => interceptedLogs.push(args.join(' '));
    console.warn = (...args: unknown[]) => interceptedLogs.push(args.join(' '));
    console.log = (...args: unknown[]) => interceptedLogs.push(args.join(' '));

    try {
      const leakedCandidate = 'super_secret_token_12345';
      const request = new Request('http://localhost:3000/api/internal/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${leakedCandidate}` },
      });

      const res = await POST(request);
      const bodyText = await res.text();

      assert.equal(res.status, 401);
      assert.equal(bodyText.includes(leakedCandidate), false, 'Candidate secret must not appear in response');
      assert.equal(bodyText.includes(VALID_TEST_SECRET), false, 'Configured secret must not appear in response');

      const allLogs = interceptedLogs.join('\n');
      assert.equal(allLogs.includes(leakedCandidate), false, 'Candidate secret must not appear in logs');
      assert.equal(allLogs.includes(VALID_TEST_SECRET), false, 'Configured secret must not appear in logs');
    } finally {
      console.error = origError;
      console.warn = origWarn;
      console.log = origLog;
    }
  });

  // 14. Unsupported methods
  test('14. Unsupported methods: GET, PUT, DELETE, and PATCH return 405 Method Not Allowed with Allow header', async () => {
    const getRes = await GET();
    assert.equal(getRes.status, 405);
    assert.equal(getRes.headers.get('Allow'), 'POST');

    const putRes = await PUT();
    assert.equal(putRes.status, 405);
    assert.equal(putRes.headers.get('Allow'), 'POST');

    const delRes = await DELETE();
    assert.equal(delRes.status, 405);
    assert.equal(delRes.headers.get('Allow'), 'POST');

    const patchRes = await PATCH();
    assert.equal(patchRes.status, 405);
    assert.equal(patchRes.headers.get('Allow'), 'POST');
  });

  // Bonus test: Whitelist parameters check (forbids forceSync or arbitrary userId)
  test('15. Security: Forbids caller-supplied forceSync, userId, or arbitrary parameters', async () => {
    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VALID_TEST_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ forceSync: true, userId: 'arbitrary-id' }),
    });

    const res = await POST(request);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'FORBIDDEN_PARAMETER');
  });

  // 16. Strict future date rejection
  test('16. Date validation: Strictly rejects future targetDate with HTTP 400', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VALID_TEST_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetDate: tomorrow }),
    });

    const res = await POST(request);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.code, 'INVALID_TARGET_DATE');
    assert.match(body.error, /future/i);
  });

  // 17. Valid historical date acceptance
  test('17. Date validation: Accepts valid historical targetDate (<= todayUtc)', async () => {
    let capturedTargetDate: string | Date | undefined;
    setCoordinatorForTesting(async (options) => {
      capturedTargetDate = options?.targetDate;
      return {
        batchId: 'mock-batch-hist',
        batchGeneration: 1,
        status: 'completed',
        metrics: {
          accountsDiscovered: 0,
          leaseAcquisitionAttempts: 0,
          accountsAttempted: 0,
          successfulSyncs: 0,
          noChangeSyncs: 0,
          failedSyncs: 0,
          commitOutcomeUnknown: 0,
          skippedContended: 0,
          leaseAcquisitionErrors: 0,
          deferredLimit: 0,
          rateLimitedAccounts: 0,
          reauthRequiredAccounts: 0,
          timedOutAccounts: 0,
          fencedStaleAccounts: 0,
          pendingRewardsProcessed: 0,
          expiredSlicesProcessed: 0,
          totalXpAwarded: 0,
        },
        durationMs: 5,
      };
    });

    const request = new Request('http://localhost:3000/api/internal/sync', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${VALID_TEST_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetDate: '2026-11-14' }),
    });

    const res = await POST(request);
    assert.equal(res.status, 200);
    assert.equal(capturedTargetDate, '2026-11-14');
  });
});
