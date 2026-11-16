// tests/integration/migration010Integration.test.ts
// Sprint 2.5B: Integration Verification for Migration 010 (Background Sync Persistence Foundation)

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { withTransaction } from '../../src/lib/db/transaction.ts';
import { migrateUp, migrateDown, getAppliedMigrations } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';

// Dedicated target connection string for the disposable integration test database
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
function uniqueUser(tag: string) {
  userCounter++;
  const id = `mig010_${tag}_${Date.now()}_${userCounter}_${Math.floor(Math.random() * 100000)}`;
  return {
    githubUserId: String(Math.floor(200000 + Math.random() * 799999)),
    username: id,
    primaryHandle: id,
  };
}

describe('Migration 010: Background Sync Persistence Foundation', () => {
  let isDbAvailable = false;
  let pool: Pool;
  let embeddedInstance: IEmbeddedPostgres | null = null;
  let pgVersion = 'Unknown';

  before(async () => {
    // 1. Check if database is already running
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('\n[Integration Test Setup] Launching native PostgreSQL 16...');
      try {
        const EmbeddedPostgres = require('embedded-postgres').default;
        const testDataDir = path.resolve(process.cwd(), '.pgtest_data');

        const instance: IEmbeddedPostgres = new EmbeddedPostgres({
          port: 5432,
          databaseDir: testDataDir,
          user: 'test_user',
          password: 'test_password',
        });
        embeddedInstance = instance;

        if (!fs.existsSync(testDataDir)) {
          await instance.initialise();
        }
        await instance.start();

        try {
          await instance.createDatabase('github_profile_pet_test');
        } catch {
          // database already exists
        }

        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Integration Test Setup] Could not start embedded PostgreSQL:', (err as Error).message);
      }
    }

    isDbAvailable = health.ok;
    if (!isDbAvailable) {
      console.warn('[Integration Test] Database not available; skipping suite.');
      return;
    }

    pool = getPool();
    const versionRes = await pool.query<{ version: string }>('SELECT version();');
    pgVersion = versionRes.rows[0]?.version || 'PostgreSQL 16';

    console.log(`\n[Database Target Verified] Target: ${maskConnectionString(TEST_DB_URL)}`);
    console.log(`[PostgreSQL Engine] ${pgVersion}\n`);

    // Ensure migrations up to 010 are applied
    await migrateUp();
  });

  after(async () => {
    if (isDbAvailable) {
      await closePool();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (embeddedInstance) {
      console.log('[Integration Test Cleanup] Stopping local PostgreSQL 16 instance...');
      await embeddedInstance.stop();
    }
  });

  test('1. Migration 010 applies successfully and creates all expected tables, columns, constraints, and indexes', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const client = await pool.connect();
    let applied: string[] = [];
    try {
      applied = await getAppliedMigrations(client);
    } finally {
      client.release();
    }
    assert.ok(applied.includes('010_background_sync_infrastructure.sql'), 'Migration 010 must be applied');

    // 1. Verify sync_batch_coordination table and singleton row
    const coordRes = await pool.query<{ id: number; active_batch_id: string; active_generation: string }>(
      'SELECT id, active_batch_id, active_generation FROM sync_batch_coordination WHERE id = 1;'
    );
    assert.equal(coordRes.rows.length, 1, 'sync_batch_coordination singleton row must exist');
    assert.equal(coordRes.rows[0].id, 1);
    assert.ok(Number(coordRes.rows[0].active_generation) >= 1, 'active_generation must be initialized (>= 1)');

    // 2. Verify users table columns
    const usersCols = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_name = 'users' 
         AND column_name IN ('last_sync_attempt_at', 'last_sync_success_at', 'next_sync_eligible_at', 'sync_lock_owner', 'sync_lock_expires_at');`
    );
    const colNames = usersCols.rows.map(r => r.column_name);
    assert.ok(colNames.includes('last_sync_attempt_at'));
    assert.ok(colNames.includes('last_sync_success_at'));
    assert.ok(colNames.includes('next_sync_eligible_at'));
    assert.ok(colNames.includes('sync_lock_owner'));
    assert.ok(colNames.includes('sync_lock_expires_at'));

    // 3. Verify indexes on users
    const userIndexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'users';`
    );
    const indexNames = userIndexes.rows.map(r => r.indexname);
    assert.ok(indexNames.includes('idx_users_sync_eligibility'), 'idx_users_sync_eligibility must exist');
    assert.ok(indexNames.includes('idx_users_sync_lock'), 'idx_users_sync_lock must exist');

    // 4. Verify sync_transaction_attempts table exists
    const attemptsExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_transaction_attempts';`
    );
    assert.equal(attemptsExists.rows.length, 1, 'sync_transaction_attempts table must exist');

    // 5. Verify sync_transaction_receipts table exists
    const receiptsExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_transaction_receipts';`
    );
    assert.equal(receiptsExists.rows.length, 1, 'sync_transaction_receipts table must exist');

    // 6. Verify sync_batch_runs table exists
    const batchRunsExists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'sync_batch_runs';`
    );
    assert.equal(batchRunsExists.rows.length, 1, 'sync_batch_runs table must exist');
  });

  test('2. Migration rollback removes only migration 010 objects and preserves migrations 001-009', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    // Rollback 010
    const downResult = await migrateDown();
    assert.equal(downResult.reverted, '010_background_sync_infrastructure.sql');

    // Verify 010 tables are dropped
    const tablesCheck = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_name IN ('sync_batch_coordination', 'sync_transaction_attempts', 'sync_transaction_receipts', 'sync_batch_runs');`
    );
    assert.equal(tablesCheck.rows.length, 0, 'Migration 010 tables must be dropped');

    // Verify users columns dropped
    const colsCheck = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'users' 
         AND column_name IN ('last_sync_attempt_at', 'last_sync_success_at', 'next_sync_eligible_at', 'sync_lock_owner', 'sync_lock_expires_at');`
    );
    assert.equal(colsCheck.rows.length, 0, 'Migration 010 user columns must be dropped');

    // Verify migrations 001-009 remain intact
    const prevTables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_name IN ('users', 'github_accounts', 'user_profiles', 'pet_states', 'activity_reward_ledger', 'daily_sync_states', 'contribution_increment_slices');`
    );
    assert.equal(prevTables.rows.length, 7, 'Core migrations 001-009 tables must remain intact');

    // Reapply migration 010 to restore schema
    const reapplyResult = await migrateUp();
    assert.ok(reapplyResult.applied.includes('010_background_sync_infrastructure.sql'));

    const coordCheck = await pool.query('SELECT id FROM sync_batch_coordination WHERE id = 1;');
    assert.equal(coordCheck.rows.length, 1, 'sync_batch_coordination must be restored after reapplication');
  });

  test('3. Enforces unique attempt identity on (user_id, request_sequence)', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('att_uniq');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();

    // Insert first attempt row
    await pool.query(
      `INSERT INTO sync_transaction_attempts (
        user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
      ) VALUES ($1, 100, $2, '2026-11-15', 'hash_aaa', 1234, NOW(), 'dispatched');`,
      [userId, batchId]
    );

    // Duplicate (user_id, request_sequence) must violate unique constraint
    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO sync_transaction_attempts (
            user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
          ) VALUES ($1, 100, $2, '2026-11-15', 'hash_bbb', 5678, NOW(), 'dispatched');`,
          [userId, batchId]
        );
      },
      (err: Error) => {
        return err.message.includes('uq_attempt_user_sequence') || err.message.includes('unique constraint');
      },
      'Duplicate attempt for same user_id and request_sequence must be rejected'
    );
  });

  test('4. Enforces unique receipt identity on (user_id, request_sequence)', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('rec_uniq');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();

    // Insert first receipt row
    await pool.query(
      `INSERT INTO sync_transaction_receipts (
        user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
      ) VALUES ($1, 200, $2, '2026-11-15', 'hash_111', 'applied');`,
      [userId, batchId]
    );

    // Duplicate receipt for same (user_id, request_sequence) must be rejected
    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO sync_transaction_receipts (
            user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
          ) VALUES ($1, 200, $2, '2026-11-15', 'hash_222', 'no_change');`,
          [userId, batchId]
        );
      },
      (err: Error) => {
        return err.message.includes('uq_receipt_user_sequence') || err.message.includes('unique constraint');
      },
      'Duplicate receipt for same user_id and request_sequence must be rejected'
    );
  });

  test('5. Rejects invalid attempt_status in sync_transaction_attempts', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('att_status');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();

    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO sync_transaction_attempts (
            user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
          ) VALUES ($1, 301, $2, '2026-11-15', 'hash_inv', 9999, NOW(), 'invalid_status');`,
          [userId, batchId]
        );
      },
      (err: Error) => {
        return err.message.includes('chk_attempt_status') || err.message.includes('check constraint');
      },
      'Invalid attempt_status must be rejected by chk_attempt_status'
    );
  });

  test('6. Rejects invalid outcome in sync_transaction_receipts', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('rec_outcome');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();

    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO sync_transaction_receipts (
            user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
          ) VALUES ($1, 302, $2, '2026-11-15', 'hash_inv', 'invalid_outcome');`,
          [userId, batchId]
        );
      },
      (err: Error) => {
        return err.message.includes('chk_receipt_outcome') || err.message.includes('check constraint');
      },
      'Invalid outcome must be rejected by chk_receipt_outcome'
    );
  });

  test('7. Accepts deferred_contention as a valid batch status in sync_batch_runs', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const batchId = crypto.randomUUID();

    const res = await pool.query(
      `INSERT INTO sync_batch_runs (
        batch_id, batch_generation, status, error_message
      ) VALUES ($1, 2, 'deferred_contention', 'Worker contention lock timeout')
      RETURNING *;`,
      [batchId]
    );

    assert.equal(res.rows.length, 1);
    assert.equal(res.rows[0].status, 'deferred_contention');
  });

  test('8. Attempts and receipts cascade delete when user is deleted', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('cascade_del');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();

    // Insert attempt and receipt
    await pool.query(
      `INSERT INTO sync_transaction_attempts (
        user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
      ) VALUES ($1, 401, $2, '2026-11-15', 'hash_cas', 1111, NOW(), 'dispatched');`,
      [userId, batchId]
    );

    await pool.query(
      `INSERT INTO sync_transaction_receipts (
        user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
      ) VALUES ($1, 401, $2, '2026-11-15', 'hash_cas', 'applied');`,
      [userId, batchId]
    );

    // Delete user
    const deleted = await UserRepository.deleteAccountCascade(userId);
    assert.ok(deleted, 'User should be deleted successfully');

    // Verify cascade deletion
    const attCheck = await pool.query(
      'SELECT 1 FROM sync_transaction_attempts WHERE user_id = $1;',
      [userId]
    );
    assert.equal(attCheck.rows.length, 0, 'Attempts must cascade delete with user');

    const recCheck = await pool.query(
      'SELECT 1 FROM sync_transaction_receipts WHERE user_id = $1;',
      [userId]
    );
    assert.equal(recCheck.rows.length, 0, 'Receipts must cascade delete with user');
  });

  test('9. Receipt is inserted atomically inside transaction and disappears when transaction rolls back', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('atom_rollback');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();

    try {
      await withTransaction(async (txClient) => {
        await txClient.query(
          `INSERT INTO sync_transaction_receipts (
            user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
          ) VALUES ($1, 501, $2, '2026-11-15', 'hash_rb', 'applied');`,
          [userId, batchId]
        );

        // Force a rollback by throwing inside transaction
        throw new Error('Intentional transaction rollback simulation');
      });
    } catch (err) {
      assert.equal((err as Error).message, 'Intentional transaction rollback simulation');
    }

    // Receipt must NOT exist after rollback
    const recCheck = await pool.query(
      'SELECT 1 FROM sync_transaction_receipts WHERE user_id = $1 AND request_sequence = 501;',
      [userId]
    );
    assert.equal(recCheck.rows.length, 0, 'Receipt must not exist after transaction rollback');
  });

  test('10. Committed receipt survives connection closure and can be matched across all 5 identity fields', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('survive_conn');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const batchId = crypto.randomUUID();
    const syncDate = '2026-11-15';
    const payloadHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    // 1. Dedicated connection 1 inserts attempt and commits
    const client1 = await pool.connect();
    let pid1 = 0;
    let start1 = new Date();
    try {
      const pidRes = await client1.query<{ pid: number; backend_start: Date }>(
        'SELECT pg_backend_pid() AS pid, backend_start FROM pg_stat_activity WHERE pid = pg_backend_pid();'
      );
      pid1 = pidRes.rows[0].pid;
      start1 = new Date(pidRes.rows[0].backend_start);

      await client1.query(
        `INSERT INTO sync_transaction_attempts (
          user_id, request_sequence, batch_id, sync_date, payload_hash, backend_pid, backend_start, attempt_status
        ) VALUES ($1, 601, $2, $3, $4, $5, $6, 'dispatched');`,
        [userId, batchId, syncDate, payloadHash, pid1, start1]
      );

      // Dedicated connection 1 inserts receipt and commits
      await client1.query('BEGIN;');
      await client1.query(
        `INSERT INTO sync_transaction_receipts (
          user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
        ) VALUES ($1, 601, $2, $3, $4, 'applied');`,
        [userId, batchId, syncDate, payloadHash]
      );
      await client1.query('COMMIT;');
    } finally {
      // Forcibly close/release connection 1
      client1.release(true); // destroy underlying TCP connection
    }

    // 2. Separate connection 2 queries the committed receipt and matches all 5 identity fields
    const client2 = await pool.connect();
    try {
      const matchRes = await client2.query<{
        user_id: string;
        request_sequence: string;
        batch_id: string;
        sync_date: Date | string;
        payload_hash: string;
        outcome: string;
      }>(
        `SELECT r.user_id, r.request_sequence, r.batch_id, r.sync_date, r.payload_hash, r.outcome
         FROM sync_transaction_receipts r
         JOIN sync_transaction_attempts a
           ON r.user_id = a.user_id
          AND r.request_sequence = a.request_sequence
          AND r.batch_id = a.batch_id
          AND r.sync_date = a.sync_date
          AND r.payload_hash = a.payload_hash
         WHERE r.user_id = $1 AND r.request_sequence = 601;`,
        [userId]
      );

      assert.equal(matchRes.rows.length, 1, 'Receipt and attempt must match on all 5 identity fields');
      const row = matchRes.rows[0];
      assert.equal(row.user_id, userId);
      assert.equal(Number(row.request_sequence), 601);
      assert.equal(row.batch_id, batchId);
      assert.equal(row.payload_hash, payloadHash);
      assert.equal(row.outcome, 'applied');
    } finally {
      client2.release();
    }
  });

  test('11. Users table scheduling and sync lease columns operate correctly with indexes', async () => {
    assert.ok(isDbAvailable, 'PostgreSQL must be reachable');

    const u = uniqueUser('lease_idx');
    const trainer = await UserRepository.createTrainer({
      githubUserId: u.githubUserId,
      username: u.username,
      primaryHandle: u.primaryHandle,
    });
    const userId = trainer.user.id;
    const leaseOwner = crypto.randomUUID();

    // 1. Acquire lease
    const leaseAcquired = await pool.query<{ id: string }>(
      `UPDATE users
       SET sync_lock_owner = $1,
           sync_lock_expires_at = NOW() + INTERVAL '60 seconds',
           last_sync_attempt_at = NOW()
       WHERE id = $2
         AND is_suspended = FALSE
         AND (sync_lock_expires_at IS NULL OR sync_lock_expires_at < NOW())
       RETURNING id;`,
      [leaseOwner, userId]
    );
    assert.equal(leaseAcquired.rows.length, 1, 'Lease must be acquired');

    // 2. Competing worker fails to acquire lease
    const competingOwner = crypto.randomUUID();
    const leaseBlocked = await pool.query<{ id: string }>(
      `UPDATE users
       SET sync_lock_owner = $1,
           sync_lock_expires_at = NOW() + INTERVAL '60 seconds',
           last_sync_attempt_at = NOW()
       WHERE id = $2
         AND is_suspended = FALSE
         AND (sync_lock_expires_at IS NULL OR sync_lock_expires_at < NOW())
       RETURNING id;`,
      [competingOwner, userId]
    );
    assert.equal(leaseBlocked.rows.length, 0, 'Competing worker must not acquire active lease');

    // 3. Owner releases lease conditionally and sets next_sync_eligible_at
    const released = await pool.query(
      `UPDATE users
       SET sync_lock_owner = NULL,
           sync_lock_expires_at = NULL,
           last_sync_success_at = NOW(),
           next_sync_eligible_at = NOW() + INTERVAL '4 hours'
       WHERE id = $1 AND sync_lock_owner = $2;`,
      [userId, leaseOwner]
    );
    assert.equal(released.rowCount, 1, 'Owner must release lease successfully');
  });
});
