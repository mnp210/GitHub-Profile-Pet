// tests/integration/postgresIntegration.test.ts
// Comprehensive PostgreSQL 16+ Integration Test Suite

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';

const require = createRequire(import.meta.url);
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { withTransaction } from '../../src/lib/db/transaction.ts';
import { migrateUp, migrateDown } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { PetRepository } from '../../src/lib/db/repositories/petRepository.ts';
import { SyncRepository } from '../../src/lib/db/repositories/syncRepository.ts';
import { LedgerRepository } from '../../src/lib/db/repositories/ledgerRepository.ts';

// Default target connection string for the disposable integration test database
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.DATABASE_URL = TEST_DB_URL;

// Type definition for EmbeddedPostgres
interface IEmbeddedPostgres {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

describe('PostgreSQL 16+ Integration Test Suite', () => {
  let isDbAvailable = false;
  let pool: Pool;
  let embeddedInstance: IEmbeddedPostgres | null = null;
  let pgVersion = 'Unknown';

  before(async () => {
    // 1. Check if a PostgreSQL instance is already running (e.g. via Docker Compose or native service)
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('\n[Integration Test Setup] No running database on port 5432. Launching native PostgreSQL 16...');
      try {
        // Dynamically load embedded-postgres to spin up real PostgreSQL 16.15 binary
        const EmbeddedPostgres = require('embedded-postgres').default;
        const testDataDir = path.resolve(process.cwd(), '.pgtest_data');

        embeddedInstance = new EmbeddedPostgres({
          port: 5432,
          databaseDir: testDataDir,
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
          // Ignore if database already exists
        }
        console.log('[Integration Test Setup] Local PostgreSQL 16 instance successfully started.');

        // Re-check health
        health = await checkDatabaseHealth();
      } catch (launchErr) {
        console.warn(
          '[Integration Test Setup] Failed to boot embedded PostgreSQL:',
          (launchErr as Error).message
        );
      }
    }

    isDbAvailable = health.ok;

    if (!isDbAvailable) {
      console.warn(
        '\n[INTEGRATION TESTS BLOCKED / SKIPPED]: No running PostgreSQL instance detected at DATABASE_URL.\n' +
        'Target: ' + maskConnectionString(TEST_DB_URL) + '\n' +
        'To run these tests with Docker:\n' +
        '  1. docker compose up -d\n' +
        '  2. npm run test:integration\n'
      );
      return;
    }

    pool = getPool();

    // Query actual PostgreSQL engine version
    const versionRes = await pool.query<{ version: string }>('SELECT version();');
    pgVersion = versionRes.rows[0]?.version || 'PostgreSQL 16';
    console.log(`\n[Database Target Verified] Target: ${maskConnectionString(TEST_DB_URL)}`);
    console.log(`[PostgreSQL Engine] ${pgVersion}\n`);
  });

  after(async () => {
    if (isDbAvailable) {
      await closePool();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (embeddedInstance) {
      console.log('[Integration Test Cleanup] Stopping local PostgreSQL 16 instance...');
      await embeddedInstance.stop();
      console.log('[Integration Test Cleanup] Local PostgreSQL stopped cleanly.');
    }
  });

  test('1. Migration up and down lifecycle', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    // Rollback all applied migrations in reverse order
    while (true) {
      const down = await migrateDown();
      if (!down.reverted) break;
    }

    // Migrate up all migrations
    const upResult = await migrateUp();
    assert.ok(upResult.applied.includes('001_initial_schema.sql'), 'Initial schema should be applied');
    assert.ok(upResult.applied.includes('002_care_action_payload.sql'), 'Schema 002 should be applied');

    // Idempotency: re-running should not re-apply
    const secondUp = await migrateUp();
    assert.equal(secondUp.applied.length, 0, 'No migrations should re-apply');
    assert.ok(secondUp.skipped.includes('001_initial_schema.sql'), 'Should skip already applied migration');

    // Rollback down the latest migration
    const downResult = await migrateDown();
    assert.ok(downResult.reverted !== null, 'Should revert the latest migration');

    // Re-apply for all remaining test suites
    await migrateUp();
  });

  test('2. Account deletion removing encrypted token records and dependent data', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    // Provision a test trainer with synthetic encrypted tokens
    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_del_test_1',
      username: 'deletable_trainer',
      primaryHandle: 'deletable_trainer',
      encryptedAccessToken: 'enc_access_token_super_secret_payload',
      encryptedRefreshToken: 'enc_refresh_token_super_secret_payload',
      tokenExpiresAt: new Date(Date.now() + 8 * 3600 * 1000),
      refreshExpiresAt: new Date(Date.now() + 180 * 24 * 3600 * 1000),
    });

    const userId = trainer.user.id;
    const accountId = trainer.account.id;

    // Seed dependent rows across sync, care idempotency, and ledger
    await SyncRepository.processContributionSnapshot(userId, '2026-11-15', 3);
    await PetRepository.recordCareActionIdempotent(userId, 'action_to_delete_1', 'feed');

    // Verify records exist before deletion
    const accountBefore = await pool.query('SELECT * FROM github_accounts WHERE id = $1;', [accountId]);
    assert.equal(accountBefore.rows.length, 1);
    assert.equal(accountBefore.rows[0].encrypted_access_token, 'enc_access_token_super_secret_payload');

    // Execute atomic cascading deletion
    const deleted = await UserRepository.deleteAccountCascade(userId);
    assert.equal(deleted, true, 'Account deletion should report true');

    // Verify github_accounts row with encrypted tokens is wiped
    const accountCheck = await pool.query('SELECT * FROM github_accounts WHERE id = $1;', [accountId]);
    assert.equal(accountCheck.rows.length, 0, 'GitHub account and encrypted tokens must be wiped');

    // Verify user entity is wiped
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1;', [userId]);
    assert.equal(userCheck.rows.length, 0, 'User entity must be wiped');

    // Verify all dependent rows are wiped
    const profileCheck = await pool.query('SELECT * FROM user_profiles WHERE user_id = $1;', [userId]);
    assert.equal(profileCheck.rows.length, 0, 'User profile must be wiped');

    const petCheck = await pool.query('SELECT * FROM pet_states WHERE user_id = $1;', [userId]);
    assert.equal(petCheck.rows.length, 0, 'Pet state must be wiped');

    const ledgerCheck = await pool.query('SELECT * FROM activity_reward_ledger WHERE user_id = $1;', [userId]);
    assert.equal(ledgerCheck.rows.length, 0, 'Ledger entries must be wiped');

    const syncCheck = await pool.query('SELECT * FROM daily_sync_states WHERE user_id = $1;', [userId]);
    assert.equal(syncCheck.rows.length, 0, 'Sync states must be wiped');

    const careCheck = await pool.query('SELECT * FROM care_action_idempotency WHERE user_id = $1;', [userId]);
    assert.equal(careCheck.rows.length, 0, 'Care idempotency records must be wiped');
  });

  test('3. Per-user action idempotency', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainerA = await UserRepository.createTrainer({
      githubUserId: 'gh_user_idemp_a',
      username: 'user_a',
      primaryHandle: 'user_a',
    });

    const trainerB = await UserRepository.createTrainer({
      githubUserId: 'gh_user_idemp_b',
      username: 'user_b',
      primaryHandle: 'user_b',
    });

    const clientActionId = 'client_action_uuid_100';

    // User A records action -> succeeds
    const firstA = await PetRepository.recordCareActionIdempotent(trainerA.user.id, clientActionId, 'feed');
    assert.equal(firstA.isDuplicate, false, 'First action from user A should not be a duplicate');

    // User A repeats action with same clientActionId -> detected as duplicate
    const secondA = await PetRepository.recordCareActionIdempotent(trainerA.user.id, clientActionId, 'feed');
    assert.equal(secondA.isDuplicate, true, 'Second action with same clientActionId must be duplicate');

    // User B records with same clientActionId -> succeeds (proving UNIQUE is per-user, not global)
    const firstB = await PetRepository.recordCareActionIdempotent(trainerB.user.id, clientActionId, 'feed');
    assert.equal(firstB.isDuplicate, false, 'Action from user B with same clientActionId must succeed');
  });

  test('4. Transaction rollback on failure', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_rollback_test',
      username: 'rollback_trainer',
      primaryHandle: 'rollback_trainer',
    });

    let errorCaught = false;
    try {
      await withTransaction(async (tx) => {
        await tx.query('UPDATE pet_states SET mood = $1 WHERE user_id = $2;', ['Ecstatic', trainer.user.id]);
        throw new Error('Simulated mid-transaction failure');
      });
    } catch {
      errorCaught = true;
    }

    assert.equal(errorCaught, true, 'Transaction failure must throw');

    // Verify mood was NOT updated
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(pet?.mood, 'Focused', 'Pet mood must remain Focused after transaction rollback');
  });

  test('5. Concurrent first sync with no existing daily row', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_conc_first_sync',
      username: 'conc_trainer_1',
      primaryHandle: 'conc_trainer_1',
    });

    const dateIso = '2026-11-16';
    const snapshotCount = 3;

    // Fire 5 concurrent first-sync requests simultaneously
    const syncPromises = Array.from({ length: 5 }, () =>
      SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, snapshotCount)
    );

    const results = await Promise.all(syncPromises);

    // Verify only ONE unique daily_sync_states row exists for this date
    const syncRows = await pool.query(
      'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2;',
      [trainer.user.id, dateIso]
    );
    assert.equal(syncRows.rows.length, 1, 'Exactly one sync row must exist');

    const finalSync = syncRows.rows[0];
    assert.equal(finalSync.total_contributions_recorded, 3);
    assert.equal(finalSync.total_contributions_rewarded, 3);
    assert.equal(finalSync.total_contributions_forfeited, 0);
    assert.equal(finalSync.pending_contribution_increments, 0);

    // Total XP for 3 increments: 25 + 15 + 10 = 50 XP
    assert.equal(finalSync.daily_activity_xp_awarded, 50);

    // Sum of XP awarded across all concurrent calls must equal exactly 50 (no duplicate awards)
    const totalXpAwardedAcrossCalls = results.reduce((acc, r) => acc + r.xpAwarded, 0);
    assert.equal(totalXpAwardedAcrossCalls, 50, 'Total XP awarded across all concurrent workers must equal exactly 50');
  });

  test('6. Concurrent sync with an existing row', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_conc_existing_sync',
      username: 'conc_trainer_2',
      primaryHandle: 'conc_trainer_2',
    });

    const dateIso = '2026-11-17';

    // Seed initial sync with 2 contributions
    await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 2, undefined, { bypassHourlyThrottle: true });

    // Concurrently fire 4 requests observing 4 contributions
    const syncPromises = Array.from({ length: 4 }, () =>
      SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 4, undefined, { bypassHourlyThrottle: true })
    );

    const results = await Promise.all(syncPromises);

    const finalState = await SyncRepository.getDailySyncState(trainer.user.id, dateIso);
    assert.ok(finalState);
    assert.equal(finalState.total_contributions_recorded, 4);
    assert.equal(finalState.total_contributions_rewarded, 4);
    assert.equal(finalState.pending_contribution_increments, 0);

    // Increments 1-2: 40 XP. Increments 3-4: 15 XP. Total = 55 XP.
    assert.equal(finalState.daily_activity_xp_awarded, 55);

    const extraXpAwarded = results.reduce((acc, r) => acc + r.xpAwarded, 0);
    assert.equal(extraXpAwarded, 15, 'Concurrent existing sync must award exactly 15 XP for the 2 new increments');
  });

  test('7. Pending queue processing across multiple batches (12-contribution sprint)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_sprint_12',
      username: 'sprint_trainer',
      primaryHandle: 'sprint_trainer',
    });

    const dateIso = '2026-11-18';

    // Batch 1: Observes 12 contributions. Max 5 processed per batch.
    const batch1 = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 12, undefined, { bypassHourlyThrottle: true });
    assert.equal(batch1.newlyObservedIncrements, 12);
    assert.equal(batch1.processedIncrements, 5);
    assert.equal(batch1.rewardedIncrements, 5);
    assert.equal(batch1.remainingPendingIncrements, 7);
    // Increments 1-5: 25 + 15 + 10 + 5 + 5 = 60 XP
    assert.equal(batch1.xpAwarded, 60);

    // Batch 2: Next worker run with same snapshot 12 (drains 5 pending)
    const batch2 = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 12, undefined, { bypassHourlyThrottle: true });
    assert.equal(batch2.newlyObservedIncrements, 0);
    assert.equal(batch2.processedIncrements, 5);
    assert.equal(batch2.rewardedIncrements, 5);
    assert.equal(batch2.remainingPendingIncrements, 2);
    // Increments 6-10: 5 * 5 = 25 XP
    assert.equal(batch2.xpAwarded, 25);

    // Batch 3: Next worker run (drains remaining 2 pending)
    const batch3 = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 12, undefined, { bypassHourlyThrottle: true });
    assert.equal(batch3.newlyObservedIncrements, 0);
    assert.equal(batch3.processedIncrements, 2);
    assert.equal(batch3.rewardedIncrements, 2);
    assert.equal(batch3.remainingPendingIncrements, 0);
    // Increments 11-12: 2 * 5 = 10 XP
    assert.equal(batch3.xpAwarded, 10);

    const finalState = await SyncRepository.getDailySyncState(trainer.user.id, dateIso);
    assert.ok(finalState);
    assert.equal(finalState.total_contributions_recorded, 12);
    assert.equal(finalState.total_contributions_rewarded, 12);
    assert.equal(finalState.pending_contribution_increments, 0);
    assert.equal(finalState.daily_activity_xp_awarded, 95); // 60 + 25 + 10 = 95 XP
  });

  test('8. Actual hourly rate throttling enforcement', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_hourly_throttle_test',
      username: 'throttle_trainer',
      primaryHandle: 'throttle_trainer',
    });

    const dateIso = '2026-11-19';
    const now = new Date('2026-11-19T10:00:00Z');

    // First sync at 10:00:00: observes 8 contributions. Processes 5 (hourly cap reached).
    const sync1 = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 8, undefined, { currentTime: now });
    assert.equal(sync1.processedIncrements, 5);
    assert.equal(sync1.remainingPendingIncrements, 3);
    assert.equal(sync1.syncState.hourly_increments_processed, 5);

    // Second sync 10 minutes later (10:10:00): same hour. Hourly quota is exhausted (0 remaining).
    const tenMinutesLater = new Date('2026-11-19T10:10:00Z');
    const sync2 = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 8, undefined, { currentTime: tenMinutesLater });
    assert.equal(sync2.processedIncrements, 0, 'Must process 0 increments when hourly quota is exhausted');
    assert.equal(sync2.xpAwarded, 0);
    assert.equal(sync2.remainingPendingIncrements, 3, 'Pending increments must remain queued safely');

    // Third sync 61 minutes later (11:01:00): new hour. Hourly window resets!
    const nextHour = new Date('2026-11-19T11:01:00Z');
    const sync3 = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 8, undefined, { currentTime: nextHour });
    assert.equal(sync3.processedIncrements, 3, 'Must process remaining 3 pending increments in new hourly window');
    assert.equal(sync3.remainingPendingIncrements, 0);
    assert.equal(sync3.syncState.hourly_increments_processed, 3);
  });

  test('9. Daily 300 XP cap enforcement with correct separation of rewarded and forfeited increments', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_cap_forfeit_test',
      username: 'cap_forfeit_trainer',
      primaryHandle: 'cap_forfeit_trainer',
    });

    const dateIso = '2026-11-20';

    // Massive coding day: 60 contributions
    // Diminishing schedule:
    // Inc 1: 25 XP
    // Inc 2: 15 XP
    // Inc 3: 10 XP
    // Inc 4+: 5 XP each
    // Total XP for 53 contributions = 25 + 15 + 10 + (50 * 5) = 300 XP (exact cap!)
    // Increments 54 to 60 (7 increments) get 0 XP and must be classified as FORFEITED!

    let totalAwarded = 0;
    for (let i = 0; i < 15; i++) {
      const res = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 60, undefined, { bypassHourlyThrottle: true });
      totalAwarded += res.xpAwarded;
      if (res.remainingPendingIncrements === 0) break;
    }

    const finalState = await SyncRepository.getDailySyncState(trainer.user.id, dateIso);
    assert.ok(finalState);
    assert.equal(totalAwarded, 300, 'Sum of batch XP awarded must equal 300');
    assert.equal(finalState.daily_activity_xp_awarded, 300, 'Daily XP cap must clamp at exactly 300');
    assert.equal(finalState.total_contributions_recorded, 60);

    // CRITICAL ACCOUNTING INVARIANT VERIFICATION:
    // total_contributions_rewarded strictly counts increments that received XP (53 increments)
    assert.equal(finalState.total_contributions_rewarded, 53, 'total_contributions_rewarded must NOT count zero-XP increments');
    // total_contributions_forfeited tracks increments processed after cap exhaustion (7 increments)
    assert.equal(finalState.total_contributions_forfeited, 7, 'total_contributions_forfeited must track zero-XP increments');
    // Invariant: rewarded + forfeited == recorded
    assert.equal(
      finalState.total_contributions_rewarded + finalState.total_contributions_forfeited,
      60,
      'rewarded + forfeited must equal total contributions recorded'
    );
    assert.equal(finalState.pending_contribution_increments, 0, 'Forfeited increments must not remain pending');

    // Post-cap additional sync must award 0 XP and increment forfeiture count
    const postCap = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 62, undefined, { bypassHourlyThrottle: true });
    assert.equal(postCap.xpAwarded, 0);
    assert.equal(postCap.rewardedIncrements, 0);
    assert.equal(postCap.forfeitedIncrements, 2);
    assert.equal(postCap.syncState.total_contributions_rewarded, 53);
    assert.equal(postCap.syncState.total_contributions_forfeited, 9);
    assert.equal(postCap.syncState.total_contributions_recorded, 62);
  });

  test('10. High-water mark protection after contribution reductions (rebase/force-push)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_rebase_test',
      username: 'rebase_trainer',
      primaryHandle: 'rebase_trainer',
    });

    const dateIso = '2026-11-21';

    // Initial snapshot: 10 contributions
    await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 10, undefined, { bypassHourlyThrottle: true });
    await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 10, undefined, { bypassHourlyThrottle: true }); // drain queue

    const stateBefore = await SyncRepository.getDailySyncState(trainer.user.id, dateIso);
    assert.equal(stateBefore?.total_contributions_recorded, 10);
    const xpBefore = stateBefore?.daily_activity_xp_awarded;

    // User rebases and drops 4 commits: snapshot reduces from 10 to 6
    const rebaseSync = await SyncRepository.processContributionSnapshot(trainer.user.id, dateIso, 6, undefined, { bypassHourlyThrottle: true });

    assert.equal(rebaseSync.newlyObservedIncrements, 0, 'No new increments observed on reduction');
    assert.equal(rebaseSync.xpAwarded, 0, 'No XP awarded on reduction');
    assert.equal(rebaseSync.syncState.total_contributions_recorded, 10, 'High-water mark must remain 10');
    assert.equal(rebaseSync.syncState.daily_activity_xp_awarded, xpBefore, 'Daily XP must never regress');
  });

  test('11. Duplicate retry prevention via canonical ledger identity', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_ledger_test',
      username: 'ledger_trainer',
      primaryHandle: 'ledger_trainer',
    });

    const canonicalId = 'urn:gh:daily:test:slice:0-5';

    // First entry succeeds
    const first = await LedgerRepository.appendEntry({
      userId: trainer.user.id,
      canonicalActivityId: canonicalId,
      activityType: 'github_activity',
      xpAwarded: 60,
    });
    assert.equal(first.canonical_activity_id, canonicalId);

    // Identical duplicate insert must be rejected by unique constraint
    let caughtDuplicate = false;
    try {
      await LedgerRepository.appendEntry({
        userId: trainer.user.id,
        canonicalActivityId: canonicalId,
        activityType: 'github_activity',
        xpAwarded: 60,
      });
    } catch {
      caughtDuplicate = true;
    }

    assert.equal(caughtDuplicate, true, 'Duplicate canonicalActivityId must be rejected by unique constraint');
  });

  test('12. Pending queue expiry after grace window (older than 2 days / UTC day boundary)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: PostgreSQL instance not reachable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_expiry_test',
      username: 'expiry_trainer',
      primaryHandle: 'expiry_trainer',
    });

    // Insert an old daily sync state (3 days ago) with 4 pending increments
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const dateIso = threeDaysAgo.toISOString().split('T')[0];

    await pool.query(
      `INSERT INTO daily_sync_states (
        user_id, sync_date, total_contributions_recorded, total_contributions_rewarded,
        total_contributions_forfeited, pending_contribution_increments, daily_activity_xp_awarded,
        hourly_increments_processed
      ) VALUES ($1, $2, 10, 6, 0, 4, 60, 0);`,
      [trainer.user.id, dateIso]
    );

    // Run expiry worker
    const expiredCount = await SyncRepository.expireStalePendingIncrements(2);
    assert.ok(expiredCount >= 1, 'Should expire stale pending increments');

    const state = await SyncRepository.getDailySyncState(trainer.user.id, dateIso);
    assert.equal(state?.pending_contribution_increments, 0, 'Stale pending increments must be reset to 0');
    assert.equal(state?.total_contributions_rewarded, 6, 'Rewarded count must remain intact');
  });
});
