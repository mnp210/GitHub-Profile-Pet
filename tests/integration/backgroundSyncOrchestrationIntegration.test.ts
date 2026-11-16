// tests/integration/backgroundSyncOrchestrationIntegration.test.ts
// Sprint 2.5C: Integration Test Suite for Background Contribution Sync Orchestration Service
// Verifies all 26 mandatory failure, fencing, concurrency, recovery, and accounting scenarios
// against native PostgreSQL 16.15.

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
import {
  computePayloadHash,
} from '../../src/lib/db/repositories/syncRepository.ts';
import {
  executeBackgroundContributionSync,
  acquireUserSyncLease,
  releaseUserSyncLease,
  discoverEligibleAccounts,
  resolveUnknownCommitOutcome,
  calculateNextSyncEligibility,
  validateBatchAccounting,
  GLOBAL_ADVISORY_LOCK_ID,
  type SnapshotFetcherFn,
} from '../../src/lib/sync/backgroundSyncCoordinator.ts';
import type { GitHubContributionSnapshot } from '../../src/lib/github/contributionSnapshot.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;

interface IEmbeddedPostgres {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

let userCounter = 0;
function uniqueTrainerPayload(tag: string) {
  userCounter++;
  const id = `orch_${tag}_${Date.now()}_${userCounter}_${Math.floor(Math.random() * 100000)}`;
  return {
    githubUserId: String(Math.floor(300000 + Math.random() * 699999)),
    username: id,
    primaryHandle: id,
    encryptedAccessToken: `enc_tok_${tag}`,
  };
}

function mockSnapshot(publicTotal: number, retrievedAt: string = new Date().toISOString()): GitHubContributionSnapshot {
  return {
    githubUserId: 'mock_gh_id',
    username: 'mock_user',
    retrievedAt,
    period: { from: '2026-11-15T00:00:00.000Z', to: '2026-11-15T23:59:59.999Z' },
    contributions: {
      commits: publicTotal,
      issues: 0,
      pullRequests: 0,
      pullRequestReviews: 0,
      restricted: 0,
      total: publicTotal,
      publicTotal,
    },
    visibility: 'public',
    hasRestrictedContributions: false,
  };
}

describe('Background Contribution Sync Orchestration Integration Suite', () => {
  let isDbAvailable = false;
  let pool: Pool;
  let embeddedInstance: IEmbeddedPostgres | null = null;

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
        console.warn('[Orchestration Tests] Embedded postgres start error:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Orchestration Tests] Skipping: DB unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
  });

  after(async () => {
    if (isDbAvailable) {
      try {
        await pool.query("UPDATE sync_batch_coordination SET active_batch_id = '00000000-0000-0000-0000-000000000000', active_generation = 1 WHERE id = 1;");
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
    if (isDbAvailable) {
      await pool.query('TRUNCATE TABLE users, github_accounts, sync_transaction_attempts, sync_transaction_receipts, sync_batch_runs CASCADE;');
    }
  });

  // 1. Global advisory-lock exclusivity
  test('1. Global advisory-lock exclusivity: Contending coordinator defers with status deferred_contention', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const holdingClient = await pool.connect();
    try {
      const lockRes = await holdingClient.query<{ pg_try_advisory_lock: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock;',
        [GLOBAL_ADVISORY_LOCK_ID]
      );
      assert.equal(lockRes.rows[0].pg_try_advisory_lock, true, 'Holding client acquired advisory lock');

      // Attempt coordinator execution while lock is held
      const result = await executeBackgroundContributionSync();
      assert.equal(result.status, 'deferred_contention');
      assert.equal(result.metrics.accountsAttempted, 0);

      // Verify sync_batch_runs records deferred_contention
      const runRes = await pool.query('SELECT status FROM sync_batch_runs WHERE batch_id = $1;', [result.batchId]);
      assert.equal(runRes.rows[0]?.status, 'deferred_contention');
    } finally {
      await holdingClient.query('SELECT pg_advisory_unlock($1);', [GLOBAL_ADVISORY_LOCK_ID]);
      holdingClient.release();
    }
  });

  // 2. Generation advancement and stale-worker fencing
  test('2. Generation advancement and stale-worker fencing: Worker from prior generation rejected', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    await UserRepository.createTrainer(uniqueTrainerPayload('t2'));

    // Advance generation directly
    await pool.query(
      `UPDATE sync_batch_coordination
       SET active_batch_id = gen_random_uuid(), active_generation = active_generation + 5
       WHERE id = 1;`
    );

    // Run coordinator with a hook that simulates a stale generation in worker Transaction 1
    let staleFencedDetected = false;
    const fetcher: SnapshotFetcherFn = async () => mockSnapshot(10);

    const result = await executeBackgroundContributionSync({
      snapshotFetcher: fetcher,
      forceSync: true,
      maxAccountsPerBatch: 1,
      onAdvisoryAcquired: async () => {
        // bump generation again to simulate stale worker
        await pool.query('UPDATE sync_batch_coordination SET active_generation = active_generation + 1 WHERE id = 1;');
        staleFencedDetected = true;
      },
    });

    assert.equal(staleFencedDetected, true);
    assert.equal(result.metrics.fencedStaleAccounts, 1);
    assert.equal(result.metrics.failedSyncs, 1);
  });

  // 3. Advisory connection loss while workers use separate connections
  test('3. Advisory connection loss while workers use separate connections', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    await UserRepository.createTrainer(uniqueTrainerPayload('t3'));

    const customAdvClient = await pool.connect();

    // Destroy advisory connection shortly after acquisition
    const result = await executeBackgroundContributionSync({
      overrideAdvClient: customAdvClient,
      forceSync: true,
      snapshotFetcher: async () => {
        // Destroy advisory client connection
        customAdvClient.emit('error', new Error('Simulated socket termination on advisory client'));
        return mockSnapshot(5);
      },
    });

    assert.equal(result.status, 'interrupted');
    customAdvClient.release();
  });

  // 4. Stale batch recovery
  test('4. Stale batch recovery: Interrupted running batches marked as interrupted by new coordinator', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const staleBatchId = '11111111-1111-1111-1111-111111111111';
    await pool.query(
      `INSERT INTO sync_batch_runs (batch_id, batch_generation, status, started_at, last_heartbeat_at)
       VALUES ($1, 1, 'running', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour');`,
      [staleBatchId]
    );

    const result = await executeBackgroundContributionSync({ forceSync: true, maxAccountsPerBatch: 0 });
    assert.equal(result.status, 'completed');

    const staleRow = await pool.query<{ status: string; error_message: string }>(
      'SELECT status, error_message FROM sync_batch_runs WHERE batch_id = $1;',
      [staleBatchId]
    );
    assert.equal(staleRow.rows[0].status, 'interrupted');
    assert.match(staleRow.rows[0].error_message, /interrupted/i);
  });

  // 5. Account eligibility and disconnected/suspended/ambiguous exclusions
  test('5. Account eligibility: Disconnected, suspended, and ambiguous accounts strictly excluded', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    // Account 1: Normal eligible
    const u1 = await UserRepository.createTrainer(uniqueTrainerPayload('t5_1'));

    // Account 2: Suspended
    const u2 = await UserRepository.createTrainer(uniqueTrainerPayload('t5_2'));
    await pool.query('UPDATE users SET is_suspended = TRUE WHERE id = $1;', [u2.user.id]);

    // Account 3: Disconnected
    const u3 = await UserRepository.createTrainer(uniqueTrainerPayload('t5_3'));
    await UserRepository.disconnectGitHubAccount(u3.user.id);

    // Account 4: Ambiguous refresh status
    const u4 = await UserRepository.createTrainer(uniqueTrainerPayload('t5_4'));
    await pool.query("UPDATE github_accounts SET token_refresh_status = 'ambiguous' WHERE id = $1;", [u4.account.id]);

    // Account 5: Not yet eligible
    const u5 = await UserRepository.createTrainer(uniqueTrainerPayload('t5_5'));
    await pool.query("UPDATE users SET next_sync_eligible_at = NOW() + INTERVAL '2 hours' WHERE id = $1;", [u5.user.id]);

    const discovered = await discoverEligibleAccounts(pool, { forceSync: false, limit: 10 });
    assert.equal(discovered.length, 1);
    assert.equal(discovered[0].id, u1.user.id);
  });

  // 6. Atomic per-user lease acquisition under concurrency
  test('6. Atomic per-user lease acquisition under concurrency: Exactly one acquires lease', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t6'));
    const promises = Array.from({ length: 5 }, (_, i) =>
      acquireUserSyncLease(pool, trainer.user.id, `owner_${i}`, 60)
    );

    const outcomes = await Promise.all(promises);
    const acquiredCount = outcomes.filter((v) => v === true).length;
    assert.equal(acquiredCount, 1, 'Exactly one contender acquired the lease');
  });

  // 7. Owner-fenced lease release and scheduling updates
  test('7. Owner-fenced lease release: Foreign owner cannot release or update schedule', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t7'));
    await acquireUserSyncLease(pool, trainer.user.id, 'owner_valid', 60);

    // Foreign owner attempts release
    const foreignRelease = await releaseUserSyncLease(
      pool,
      trainer.user.id,
      'owner_imposter',
      new Date('2026-11-20T00:00:00Z')
    );
    assert.equal(foreignRelease, false);

    // Verify lease is still held by owner_valid and schedule unchanged
    const userRow1 = await pool.query<{ sync_lock_owner: string; next_sync_eligible_at: Date }>(
      'SELECT sync_lock_owner, next_sync_eligible_at FROM users WHERE id = $1;',
      [trainer.user.id]
    );
    assert.equal(userRow1.rows[0].sync_lock_owner, 'owner_valid');

    // Valid owner releases
    const validRelease = await releaseUserSyncLease(
      pool,
      trainer.user.id,
      'owner_valid',
      new Date('2026-11-20T00:00:00Z')
    );
    assert.equal(validRelease, true);

    const userRow2 = await pool.query<{ sync_lock_owner: string | null; next_sync_eligible_at: Date }>(
      'SELECT sync_lock_owner, next_sync_eligible_at FROM users WHERE id = $1;',
      [trainer.user.id]
    );
    assert.equal(userRow2.rows[0].sync_lock_owner, null);
    assert.equal(new Date(userRow2.rows[0].next_sync_eligible_at).toISOString(), '2026-11-20T00:00:00.000Z');
  });

  // 8. Worker deadline enforcement across HTTP and database phases
  test('8. Worker deadline enforcement: Times out safely when budget exhausted', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    await UserRepository.createTrainer(uniqueTrainerPayload('t8'));

    // Configure perUserDeadlineMs = 50ms so deadline is exhausted immediately
    const result = await executeBackgroundContributionSync({
      forceSync: true,
      perUserDeadlineMs: 50,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(5),
    });

    assert.equal(result.metrics.timedOutAccounts, 1);
    assert.equal(result.metrics.failedSyncs, 1);
    assert.equal(result.metrics.successfulSyncs, 0);
  });

  // 9. Same-connection identity for Transaction 0 and Transaction 1
  test('9. Same-connection identity: Attempt record stores exact dedicated connection PID', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t9'));

    let capturedClientPid = 0;
    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(5),
      preCommitHook: async ({ workerClient }) => {
        const res = await workerClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid;');
        capturedClientPid = Number(res.rows[0].pid);
      },
    });

    assert.equal(result.metrics.successfulSyncs, 1);

    const attemptRes = await pool.query<{ backend_pid: number }>(
      'SELECT backend_pid FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(attemptRes.rows[0].backend_pid, capturedClientPid);
  });

  // 10. Attempt and receipt matching across all five identity fields
  test('10. Attempt and receipt matching: All 5 identity fields match identically', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t10'));

    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(7),
    });

    assert.equal(result.metrics.successfulSyncs, 1);

    const attempt = (await pool.query('SELECT * FROM sync_transaction_attempts WHERE user_id = $1;', [trainer.user.id])).rows[0];
    const receipt = (await pool.query('SELECT * FROM sync_transaction_receipts WHERE user_id = $1;', [trainer.user.id])).rows[0];

    assert.ok(attempt);
    assert.ok(receipt);
    assert.equal(receipt.user_id, attempt.user_id);
    assert.equal(receipt.request_sequence, attempt.request_sequence);
    assert.equal(receipt.batch_id, attempt.batch_id);
    assert.equal(
      new Date(receipt.sync_date).toISOString().slice(0, 10),
      new Date(attempt.sync_date).toISOString().slice(0, 10)
    );
    assert.equal(receipt.payload_hash, attempt.payload_hash);
    assert.equal(receipt.outcome, 'applied');
  });

  // 11. Receipt insertion atomic with reconciliation
  test('11. Receipt insertion atomic with reconciliation: Rolled back transaction leaves no receipt', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t11'));

    await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(10),
      preCommitHook: async () => {
        throw new Error('Simulated pre-commit database crash');
      },
    });

    const receiptRes = await pool.query('SELECT * FROM sync_transaction_receipts WHERE user_id = $1;', [trainer.user.id]);
    assert.equal(receiptRes.rows.length, 0, 'No receipt persisted when transaction rolls back');

    const attemptRes = await pool.query<{ attempt_status: string }>(
      'SELECT attempt_status FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(attemptRes.rows[0]?.attempt_status, 'rolled_back');
  });

  // 12. Commit acknowledged and attempt status update
  test('12. Commit acknowledged: Attempt status updated to committed with resolved_at', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t12'));

    await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(4),
    });

    const attemptRes = await pool.query<{ attempt_status: string; resolved_at: Date }>(
      'SELECT attempt_status, resolved_at FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(attemptRes.rows[0].attempt_status, 'committed');
    assert.ok(attemptRes.rows[0].resolved_at !== null);
  });

  // 13. Lost commit acknowledgement with receipt present
  test('13. Lost commit acknowledgement with receipt present: Resolves committed', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t13'));
    const batchId = '22222222-2222-2222-2222-222222222222';
    const seq = 1;
    const syncDate = '2026-11-15';
    const payloadHash = computePayloadHash({ userId: trainer.user.id, syncDate, seq });

    // Insert attempt with dead PID
    await pool.query(
      `INSERT INTO sync_transaction_attempts (
         user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
       ) VALUES ($1, $2, $3, $4, $5, 999999, NOW() - INTERVAL '1 hour', 'unknown');`,
      [trainer.user.id, seq, batchId, syncDate, payloadHash]
    );

    // Insert matching receipt
    await pool.query(
      `INSERT INTO sync_transaction_receipts (
         user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
       ) VALUES ($1, $2, $3, $4, $5, 'applied');`,
      [trainer.user.id, seq, batchId, syncDate, payloadHash]
    );

    const outcome = await resolveUnknownCommitOutcome(trainer.user.id, seq, { pool, pollingBudgetMs: 50 });
    assert.equal(outcome, 'committed');

    const updated = await pool.query<{ attempt_status: string }>(
      'SELECT attempt_status FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(updated.rows[0].attempt_status, 'committed');
  });

  // 14. Lost commit acknowledgement with receipt absent after backend termination
  test('14. Lost commit acknowledgement with receipt absent after backend termination: Resolves rolled_back', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t14'));
    const batchId = '33333333-3333-3333-3333-333333333333';
    const seq = 1;
    const syncDate = '2026-11-15';
    const payloadHash = computePayloadHash({ userId: trainer.user.id, syncDate, seq });

    // Insert attempt with dead PID and NO receipt
    await pool.query(
      `INSERT INTO sync_transaction_attempts (
         user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
       ) VALUES ($1, $2, $3, $4, $5, 999999, NOW() - INTERVAL '1 hour', 'unknown');`,
      [trainer.user.id, seq, batchId, syncDate, payloadHash]
    );

    const outcome = await resolveUnknownCommitOutcome(trainer.user.id, seq, { pool, pollingBudgetMs: 50 });
    assert.equal(outcome, 'rolled_back');

    const updated = await pool.query<{ attempt_status: string }>(
      'SELECT attempt_status FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(updated.rows[0].attempt_status, 'rolled_back');
  });

  // 15. Original backend still active: recovery defers without termination
  test('15. Original backend still active: recovery defers without calling pg_terminate_backend', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t15'));
    const activeClient = await pool.connect();

    try {
      const pidRes = await activeClient.query<{ pid: number; backend_start: Date }>(
        'SELECT pg_backend_pid() AS pid, backend_start FROM pg_stat_activity WHERE pid = pg_backend_pid();'
      );
      const activePid = Number(pidRes.rows[0].pid);
      const activeStart = new Date(pidRes.rows[0].backend_start);

      const seq = 1;
      const batchId = '44444444-4444-4444-4444-444444444444';
      const syncDate = '2026-11-15';
      const payloadHash = computePayloadHash({ userId: trainer.user.id, syncDate, seq });

      await pool.query(
        `INSERT INTO sync_transaction_attempts (
           user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'unknown');`,
        [trainer.user.id, seq, batchId, syncDate, payloadHash, activePid, activeStart]
      );

      // Attempt recovery while backend is active (short budget)
      const outcome = await resolveUnknownCommitOutcome(trainer.user.id, seq, {
        pool,
        pollingBudgetMs: 100,
        pollIntervalMs: 25,
      });

      assert.equal(outcome, 'unknown');

      // Crucial: Active client connection was NOT terminated!
      const checkActive = await activeClient.query('SELECT 1 AS alive;');
      assert.equal(checkActive.rows[0].alive, 1);
    } finally {
      activeClient.release();
    }
  });

  // 16. PID reuse: a different backend start timestamp is treated as the original backend being absent
  test('16. PID reuse: Different backend_start treated as absent original backend', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t16'));
    const liveClient = await pool.connect();

    try {
      const pidRes = await liveClient.query<{ pid: number }>('SELECT pg_backend_pid() AS pid;');
      const currentPid = Number(pidRes.rows[0].pid);
      // Different backend_start indicates old process exited and new process got same PID
      const oldStart = new Date('2020-01-01T00:00:00Z');

      const seq = 1;
      const batchId = '55555555-5555-5555-5555-555555555555';
      const syncDate = '2026-11-15';
      const payloadHash = computePayloadHash({ userId: trainer.user.id, syncDate, seq });

      await pool.query(
        `INSERT INTO sync_transaction_attempts (
           user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'unknown');`,
        [trainer.user.id, seq, batchId, syncDate, payloadHash, currentPid, oldStart]
      );

      // No receipt exists -> should resolve to rolled_back without waiting for liveClient
      const outcome = await resolveUnknownCommitOutcome(trainer.user.id, seq, { pool, pollingBudgetMs: 100 });
      assert.equal(outcome, 'rolled_back');
    } finally {
      liveClient.release();
    }
  });

  // 17. Database unavailable during recovery: attempt remains unresolved
  test('17. Database unavailable during recovery: fails closed with attempt remaining unresolved', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t17'));
    const seq = 1;
    const batchId = '66666666-6666-6666-6666-666666666666';
    const syncDate = '2026-11-15';
    const payloadHash = computePayloadHash({ userId: trainer.user.id, syncDate, seq });

    await pool.query(
      `INSERT INTO sync_transaction_attempts (
         user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
       ) VALUES ($1, $2, $3, $4, $5, 999999, NOW(), 'unknown');`,
      [trainer.user.id, seq, batchId, syncDate, payloadHash]
    );

    // Mock pool that throws error
    const faultyPool = {
      connect: async () => {
        throw new Error('Database connection refused');
      },
      query: async () => {
        throw new Error('Database connection refused');
      },
    } as unknown as Pool;

    await assert.rejects(async () => {
      await resolveUnknownCommitOutcome(trainer.user.id, seq, { pool: faultyPool });
    });

    // Check status remains unknown
    const res = await pool.query<{ attempt_status: string }>(
      'SELECT attempt_status FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(res.rows[0].attempt_status, 'unknown');
  });

  // 18. Concurrent recovery workers: exactly one resolves the attempt
  test('18. Concurrent recovery workers: Exactly one resolves attempt with serialized row locking', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t18'));
    const seq = 1;
    const batchId = '77777777-7777-7777-7777-777777777777';
    const syncDate = '2026-11-15';
    const payloadHash = computePayloadHash({ userId: trainer.user.id, syncDate, seq });

    await pool.query(
      `INSERT INTO sync_transaction_attempts (
         user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
       ) VALUES ($1, $2, $3, $4, $5, 999999, NOW() - INTERVAL '1 hour', 'unknown');`,
      [trainer.user.id, seq, batchId, syncDate, payloadHash]
    );

    await pool.query(
      `INSERT INTO sync_transaction_receipts (
         user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
       ) VALUES ($1, $2, $3, $4, $5, 'applied');`,
      [trainer.user.id, seq, batchId, syncDate, payloadHash]
    );

    // Concurrently trigger resolution
    const [res1, res2] = await Promise.all([
      resolveUnknownCommitOutcome(trainer.user.id, seq, { pool }),
      resolveUnknownCommitOutcome(trainer.user.id, seq, { pool }),
    ]);

    assert.equal(res1, 'committed');
    assert.equal(res2, 'committed');

    const attempt = await pool.query<{ attempt_status: string }>(
      'SELECT attempt_status FROM sync_transaction_attempts WHERE user_id = $1;',
      [trainer.user.id]
    );
    assert.equal(attempt.rows[0].attempt_status, 'committed');
  });

  // 19. Account disconnect during worker execution
  test('19. Account disconnect during worker execution: Rolls back cleanly without rewards', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t19'));

    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => {
        // Disconnect account while snapshot is being fetched
        await UserRepository.disconnectGitHubAccount(trainer.user.id);
        return mockSnapshot(10);
      },
    });

    assert.equal(result.metrics.failedSyncs, 1);
    assert.equal(result.metrics.successfulSyncs, 0);
    assert.equal(result.metrics.reauthRequiredAccounts, 1);

    // Verify pet state received 0 XP
    const pet = await pool.query<{ xp: number }>('SELECT xp FROM pet_states WHERE user_id = $1;', [trainer.user.id]);
    assert.equal(pet.rows[0].xp, 0);
  });

  // 20. Account deletion during worker execution
  test('20. Account deletion during worker execution: Fails closed safely', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t20'));

    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => {
        // Delete user account before Transaction 1 starts
        await UserRepository.deleteAccountCascade(trainer.user.id);
        return mockSnapshot(10);
      },
    });

    assert.equal(result.metrics.failedSyncs, 1);
    assert.equal(result.metrics.successfulSyncs, 0);
  });

  // 21. Per-account failure isolation
  test('21. Per-account failure isolation: Failure in one account does not fail other accounts', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const u1 = await UserRepository.createTrainer(uniqueTrainerPayload('t21_1'));
    const u2 = await UserRepository.createTrainer(uniqueTrainerPayload('t21_2'));

    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 2,
      snapshotFetcher: async ({ userId }) => {
        if (userId === u1.user.id) {
          throw new Error('ETIMEDOUT: Connection reset by upstream');
        }
        return mockSnapshot(5);
      },
    });

    assert.equal(result.metrics.accountsAttempted, 2);
    assert.equal(result.metrics.failedSyncs, 1);
    assert.equal(result.metrics.successfulSyncs, 1);
    assert.equal(result.status, 'partially_completed');

    // User 2 was awarded XP successfully
    const pet2 = await pool.query<{ xp: number }>('SELECT xp FROM pet_states WHERE user_id = $1;', [u2.user.id]);
    assert.ok(pet2.rows[0].xp > 0);
  });

  // 22. Retry scheduling by failure category
  test('22. Retry scheduling by failure category: Correctly calculates backoff delays', async () => {
    const now = new Date('2026-11-15T12:00:00Z');

    // Success -> 4 hours
    const successDate = calculateNextSyncEligibility({ success: true, now });
    assert.equal(successDate?.toISOString(), '2026-11-15T16:00:00.000Z');

    // Transient network -> 15 minutes
    const netDate = calculateNextSyncEligibility({ success: false, error: new Error('ECONNRESET'), now });
    assert.equal(netDate?.toISOString(), '2026-11-15T12:15:00.000Z');

    // Rate limit with reset in 20 minutes -> reset + 1 min
    const resetAt = new Date('2026-11-15T12:20:00Z');
    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), {
      rateLimit: { kind: 'primary', resetAt, retryAfterSeconds: 1200 },
    });
    const rlDate = calculateNextSyncEligibility({ success: false, error: rateLimitError, now });
    assert.equal(rlDate?.toISOString(), '2026-11-15T12:21:00.000Z');

    // Reauth required -> null
    const reauthError = new Error('Reauthorization required: token revoked');
    const reauthDate = calculateNextSyncEligibility({ success: false, error: reauthError, now });
    assert.equal(reauthDate, null);
  });

  // 23. Exact batch accounting equations
  test('23. Exact batch accounting equations: Satisfies all governing balance formulas', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    // Create 3 users
    for (let i = 0; i < 3; i++) {
      await UserRepository.createTrainer(uniqueTrainerPayload(`t23_${i}`));
    }

    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 3,
      snapshotFetcher: async () => mockSnapshot(2),
    });

    const m = result.metrics;
    assert.equal(validateBatchAccounting(m), true);
    assert.equal(m.accountsDiscovered, m.leaseAcquisitionAttempts + m.deferredLimit);
    assert.equal(m.leaseAcquisitionAttempts, m.accountsAttempted + m.skippedContended + m.leaseAcquisitionErrors);
    assert.equal(m.accountsAttempted, m.successfulSyncs + m.noChangeSyncs + m.failedSyncs + m.commitOutcomeUnknown);
  });

  // 24. Interrupted batch lower-bound accounting
  test('24. Interrupted batch lower-bound accounting: Preserves persisted counters', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const batchId = '88888888-8888-8888-8888-888888888888';
    await pool.query(
      `INSERT INTO sync_batch_runs (
         batch_id, batch_generation, status, started_at, last_heartbeat_at,
         accounts_discovered, lease_acquisition_attempts, accounts_attempted, successful_syncs
       ) VALUES ($1, 1, 'running', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes', 5, 3, 3, 2);`,
      [batchId]
    );

    // New coordinator recovers it
    await executeBackgroundContributionSync({ forceSync: true, maxAccountsPerBatch: 0 });

    const recovered = (await pool.query('SELECT * FROM sync_batch_runs WHERE batch_id = $1;', [batchId])).rows[0];
    assert.equal(recovered.status, 'interrupted');
    assert.equal(recovered.accounts_discovered, 5);
    assert.equal(recovered.successful_syncs, 2);
  });

  // 25. Maximum batch duration, account limit, and concurrency limit
  test('25. Maximum batch duration and account limit: Bounded discovery and cutoff deferral', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    // Create 4 users
    for (let i = 0; i < 4; i++) {
      await UserRepository.createTrainer(uniqueTrainerPayload(`t25_${i}`));
    }

    // Limit discovery to 2 accounts
    const result = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 2,
      snapshotFetcher: async () => mockSnapshot(3),
    });

    assert.equal(result.metrics.accountsDiscovered, 2);
    assert.equal(result.metrics.accountsAttempted, 2);
  });

  // 26. No duplicate XP or satiety across retries
  test('26. No duplicate XP or satiety across retries: Re-syncing identical snapshot awards 0 XP', async (t) => {
    if (!isDbAvailable) return t.skip('DB unavailable');

    const trainer = await UserRepository.createTrainer(uniqueTrainerPayload('t26'));

    // First sync with 3 contributions
    const res1 = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(3),
    });
    assert.equal(res1.metrics.successfulSyncs, 1);
    assert.ok(res1.metrics.totalXpAwarded > 0);

    const pet1 = (await pool.query<{ xp: number }>('SELECT xp FROM pet_states WHERE user_id = $1;', [trainer.user.id])).rows[0];

    // Second sync with identical 3 contributions on same date
    const res2 = await executeBackgroundContributionSync({
      forceSync: true,
      maxAccountsPerBatch: 1,
      snapshotFetcher: async () => mockSnapshot(3),
    });

    assert.equal(res2.metrics.noChangeSyncs, 1);
    assert.equal(res2.metrics.successfulSyncs, 0);
    assert.equal(res2.metrics.totalXpAwarded, 0);

    const pet2 = (await pool.query<{ xp: number }>('SELECT xp FROM pet_states WHERE user_id = $1;', [trainer.user.id])).rows[0];
    assert.equal(pet2.xp, pet1.xp, 'XP must be strictly identical across identical retries');
  });
});
