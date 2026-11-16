// tests/integration/dailyReconciliationIntegration.test.ts
// Sprint 2.4B: PostgreSQL 16+ Integration Suite for Daily Contribution State & High-Water Mark Reconciliation

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
import { SyncRepository } from '../../src/lib/db/repositories/syncRepository.ts';
import {
  reconcileDailyContributionForUser,
  validateAndCanonicalizeUtcDate,
  getUtcDayBoundaries,
  InvalidDateError,
} from '../../src/lib/github/dailyReconciliation.ts';
import {
  setGitHubGraphQLClient,
  resetGitHubGraphQLClient,
} from '../../src/lib/github/graphqlClient.ts';
import { encryptToken } from '../../src/lib/security/crypto.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('Daily Contribution State & High-Water Mark Reconciliation Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Reconciliation Tests] No active database on 5432. Starting local PostgreSQL 16...');
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
        console.warn('[Reconciliation Tests] Failed to initialize embedded postgres:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Reconciliation Tests] Skipping: Database unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
    await pool.query('TRUNCATE TABLE users, github_accounts CASCADE;');
  });

  after(async () => {
    if (isDbAvailable) {
      await closePool();
    }
    if (embeddedInstance) {
      console.log('[Reconciliation Tests Cleanup] Stopping local PostgreSQL 16...');
      try {
        await embeddedInstance.stop();
      } catch {
        // ignore shutdown error
      }
    }
  });

  beforeEach(() => {
    resetGitHubGraphQLClient();
  });

  afterEach(() => {
    resetGitHubGraphQLClient();
  });

  test('1. First snapshot initializes daily state correctly', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_1',
      username: 'rec_trainer_1',
      primaryHandle: 'rec_trainer_1',
      encryptedAccessToken: encryptToken('ghu_rec_tok_1'),
    });

    const targetDate = '2026-11-15';

    // Mock viewer databaseId to match trainer
    const dbId = parseInt(trainer.account.github_user_id.replace(/\D/g, '') || '12345', 10);
    setGitHubGraphQLClient({
      async execute<T>() {
        return {
          viewer: {
            id: 'MDQ6VXNlcjE=',
            databaseId: dbId,
            login: 'rec_trainer_1',
            contributionsCollection: {
              totalCommitContributions: 3,
              totalIssueContributions: 1,
              totalPullRequestContributions: 0,
              totalPullRequestReviewContributions: 0,
              restrictedContributionsCount: 0,
              contributionCalendar: {
                totalContributions: 4,
              },
            },
          },
        } as unknown as T;
      },
    });

    // Reconcile via SyncRepository directly
    const result = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      4
    );

    assert.equal(result.userId, trainer.user.id);
    assert.equal(result.utcDate, targetDate);
    assert.equal(result.previousHighWaterMark, 0);
    assert.equal(result.currentHighWaterMark, 4);
    assert.equal(result.newlyObservedIncrements, 4);
    assert.equal(result.latestObservedContributions, 4);

    // Verify row in database
    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.ok(row);
    assert.equal(row.total_contributions_recorded, 4, 'High-water mark should be 4');
    assert.equal(row.latest_observed_contributions, 4);

    // CRITICAL: Verify Pet XP and progression was NOT modified
    const petAfter = await UserRepository.findByUserId(trainer.user.id);
    assert.equal(petAfter?.pet.xp, 0, 'Sprint 2.4B must NOT award XP');
    assert.equal(petAfter?.pet.level, 1, 'Pet level must remain 1');
  });

  test('2. Increasing public contribution count advances the high-water mark', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_2',
      username: 'rec_trainer_2',
      primaryHandle: 'rec_trainer_2',
    });

    const targetDate = '2026-11-15';

    // First reconciliation: 4 contributions
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 4);

    // Second reconciliation: 9 contributions
    const result = await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 9);

    assert.equal(result.previousHighWaterMark, 4);
    assert.equal(result.currentHighWaterMark, 9);
    assert.equal(result.newlyObservedIncrements, 5);
    assert.equal(result.latestObservedContributions, 9);

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 9);
  });

  test('3. Repeated identical snapshot produces zero delta', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_3',
      username: 'rec_trainer_3',
      primaryHandle: 'rec_trainer_3',
    });

    const targetDate = '2026-11-15';

    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 7);

    // Repeat with identical count
    const repeatResult = await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 7);

    assert.equal(repeatResult.previousHighWaterMark, 7);
    assert.equal(repeatResult.currentHighWaterMark, 7);
    assert.equal(repeatResult.newlyObservedIncrements, 0, 'Identical snapshot must produce 0 increments');
    assert.equal(repeatResult.latestObservedContributions, 7);
  });

  test('4. Decreasing GitHub count does not decrease the high-water mark', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_4',
      username: 'rec_trainer_4',
      primaryHandle: 'rec_trainer_4',
    });

    const targetDate = '2026-11-15';

    // Reach high-water mark of 10
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 10);

    // GitHub count drops to 6 (e.g. rebase / repo deletion)
    const dropResult = await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 6);

    assert.equal(dropResult.previousHighWaterMark, 10);
    assert.equal(dropResult.currentHighWaterMark, 10, 'High-water mark must NEVER decrease');
    assert.equal(dropResult.newlyObservedIncrements, 0, 'Decreasing count must produce 0 delta');
    assert.equal(dropResult.latestObservedContributions, 6, 'Latest observed must accurately record lower count');

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 10);
    assert.equal(row?.latest_observed_contributions, 6);
  });

  test('5. A subsequent increase is calculated relative to the previous high-water mark', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_5',
      username: 'rec_trainer_5',
      primaryHandle: 'rec_trainer_5',
    });

    const targetDate = '2026-11-15';

    // 10 -> 6 -> 12
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 10);
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 6);

    const reboundResult = await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 12);

    assert.equal(reboundResult.previousHighWaterMark, 10);
    assert.equal(reboundResult.currentHighWaterMark, 12);
    // Delta must be 12 - 10 = 2, NOT 12 - 6 = 6!
    assert.equal(reboundResult.newlyObservedIncrements, 2, 'Delta must be relative to high-water mark 10');
    assert.equal(reboundResult.latestObservedContributions, 12);
  });

  test('6. Concurrent identical snapshots do not double-count increments', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_6',
      username: 'rec_trainer_6',
      primaryHandle: 'rec_trainer_6',
    });

    const targetDate = '2026-11-15';

    // Baseline: 5
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 5);

    // Two simultaneous requests reporting observed = 9
    const [resA, resB] = await Promise.all([
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 9),
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 9),
    ]);

    const totalDelta = resA.newlyObservedIncrements + resB.newlyObservedIncrements;
    assert.equal(totalDelta, 4, 'Total increments across concurrent identical snapshots must equal exactly 4');

    const deltas = [resA.newlyObservedIncrements, resB.newlyObservedIncrements].sort();
    assert.equal(deltas[0], 0, 'One worker must receive delta 0');
    assert.equal(deltas[1], 4, 'One worker must receive delta 4');

    const finalRow = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(finalRow?.total_contributions_recorded, 9);
  });

  test('7. Concurrent snapshots with different observed counts preserve the highest valid observed value', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_7',
      username: 'rec_trainer_7',
      primaryHandle: 'rec_trainer_7',
    });

    const targetDate = '2026-11-15';

    // Three concurrent requests with counts 8, 14, 11
    const results = await Promise.all([
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 8),
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 14),
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 11),
    ]);

    const totalNewlyObserved = results.reduce((sum, r) => sum + r.newlyObservedIncrements, 0);
    assert.equal(totalNewlyObserved, 14, 'Total increments must sum to 14 without double-counting');

    const finalRow = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(finalRow?.total_contributions_recorded, 14, 'Final high-water mark must be 14');
  });

  test('8. Separate UTC dates maintain independent high-water marks', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_8',
      username: 'rec_trainer_8',
      primaryHandle: 'rec_trainer_8',
    });

    const dateA = '2026-11-14';
    const dateB = '2026-11-15';

    await SyncRepository.reconcileDailyContributionState(trainer.user.id, dateA, 5);
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, dateB, 12);

    const rowA = await SyncRepository.getDailySyncState(trainer.user.id, dateA);
    const rowB = await SyncRepository.getDailySyncState(trainer.user.id, dateB);

    assert.equal(rowA?.total_contributions_recorded, 5);
    assert.equal(rowB?.total_contributions_recorded, 12);

    // Update Date A: Date B must be untouched
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, dateA, 8);
    const rowAUpdated = await SyncRepository.getDailySyncState(trainer.user.id, dateA);
    const rowBCheck = await SyncRepository.getDailySyncState(trainer.user.id, dateB);

    assert.equal(rowAUpdated?.total_contributions_recorded, 8);
    assert.equal(rowBCheck?.total_contributions_recorded, 12);
  });

  test('9. UTC midnight boundaries are handled correctly', async () => {
    // 23:59:59.999Z vs 00:00:00.000Z on next day
    const dateEndOfDay = new Date('2026-11-15T23:59:59.999Z');
    const dateStartNextDay = new Date('2026-11-16T00:00:00.000Z');

    const canonical1 = validateAndCanonicalizeUtcDate(dateEndOfDay);
    const canonical2 = validateAndCanonicalizeUtcDate(dateStartNextDay);

    assert.equal(canonical1, '2026-11-15');
    assert.equal(canonical2, '2026-11-16');
    assert.notEqual(canonical1, canonical2);

    const bounds1 = getUtcDayBoundaries('2026-11-15');
    assert.equal(bounds1.from, '2026-11-15T00:00:00.000Z');
    assert.equal(bounds1.to, '2026-11-15T23:59:59.999Z');
  });

  test('10. Restricted contributions do not affect publicTotal or reconciliation', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: '101010',
      username: 'rec_trainer_10',
      primaryHandle: 'rec_trainer_10',
      encryptedAccessToken: encryptToken('ghu_token_10'),
    });

    const targetDate = '2026-11-15';
    const dbId = 101010;

    // Mock GraphQL returns 2 commits + 1 issue + 1 PR + 0 reviews = 4 publicTotal
    // But contributionCalendar.totalContributions is 104 because restrictedContributionsCount is 100!
    setGitHubGraphQLClient({
      async execute<T>() {
        return {
          viewer: {
            id: 'MDQ6VXNlcjE=',
            databaseId: dbId,
            login: 'rec_trainer_10',
            contributionsCollection: {
              totalCommitContributions: 2,
              totalIssueContributions: 1,
              totalPullRequestContributions: 1,
              totalPullRequestReviewContributions: 0,
              restrictedContributionsCount: 100, // RESTRICTED!
              contributionCalendar: {
                totalContributions: 104, // Mixed restricted total
              },
            },
          },
        } as unknown as T;
      },
    });

    const result = await reconcileDailyContributionForUser(trainer.user.id, targetDate);

    assert.equal(result.latestObservedContributions, 4, 'Must ONLY count public contributions (4)');
    assert.equal(result.currentHighWaterMark, 4);
    assert.equal(result.newlyObservedIncrements, 4);

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 4, 'Recorded count must NEVER include restricted 100');
  });

  test('11. A failed transaction does not leave partially updated daily state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_11',
      username: 'rec_trainer_11',
      primaryHandle: 'rec_trainer_11',
    });

    const targetDate = '2026-11-15';
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 5);

    // Simulate database query failure inside transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(
        'UPDATE daily_sync_states SET total_contributions_recorded = 20 WHERE user_id = $1 AND sync_date = $2;',
        [trainer.user.id, targetDate]
      );
      // Simulate error and rollback
      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 5, 'State must remain 5 after transaction rollback');
  });

  test('12. A GitHub retrieval failure does not modify daily state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_12',
      username: 'rec_trainer_12',
      primaryHandle: 'rec_trainer_12',
      encryptedAccessToken: encryptToken('ghu_tok_12'),
    });

    const targetDate = '2026-11-15';
    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 6);

    // Mock GraphQL client throws an error (e.g. rate limit / network drop)
    setGitHubGraphQLClient({
      async execute() {
        throw new Error('Simulated GitHub GraphQL connection timeout');
      },
    });

    await assert.rejects(
      async () => {
        await reconcileDailyContributionForUser(trainer.user.id, targetDate);
      },
      (err: unknown) => {
        assert.ok((err as Error).message.includes('Simulated GitHub GraphQL connection timeout'));
        return true;
      }
    );

    // Database state must remain 6
    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 6);
    assert.equal(row?.latest_observed_contributions, 6);
  });

  test('13. Multiple users cannot affect one another daily state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainerA = await UserRepository.createTrainer({
      githubUserId: 'rec_user_13_A',
      username: 'rec_trainer_13_A',
      primaryHandle: 'rec_trainer_13_A',
    });

    const trainerB = await UserRepository.createTrainer({
      githubUserId: 'rec_user_13_B',
      username: 'rec_trainer_13_B',
      primaryHandle: 'rec_trainer_13_B',
    });

    const targetDate = '2026-11-15';

    await SyncRepository.reconcileDailyContributionState(trainerA.user.id, targetDate, 8);
    await SyncRepository.reconcileDailyContributionState(trainerB.user.id, targetDate, 15);

    const rowA = await SyncRepository.getDailySyncState(trainerA.user.id, targetDate);
    const rowB = await SyncRepository.getDailySyncState(trainerB.user.id, targetDate);

    assert.equal(rowA?.total_contributions_recorded, 8);
    assert.equal(rowB?.total_contributions_recorded, 15);

    // Update User A: User B must remain 15
    await SyncRepository.reconcileDailyContributionState(trainerA.user.id, targetDate, 22);

    const rowACheck = await SyncRepository.getDailySyncState(trainerA.user.id, targetDate);
    const rowBCheck = await SyncRepository.getDailySyncState(trainerB.user.id, targetDate);

    assert.equal(rowACheck?.total_contributions_recorded, 22);
    assert.equal(rowBCheck?.total_contributions_recorded, 15);
  });

  test('14. Invalid dates and malformed snapshot data are rejected safely', async () => {
    // Rejects impossible calendar dates
    assert.throws(
      () => validateAndCanonicalizeUtcDate('2026-02-31'),
      InvalidDateError
    );

    // Rejects non-leap year Feb 29
    assert.throws(
      () => validateAndCanonicalizeUtcDate('2025-02-29'),
      InvalidDateError
    );

    // Accepts leap year Feb 29
    assert.equal(validateAndCanonicalizeUtcDate('2024-02-29'), '2024-02-29');

    // Rejects malformed strings
    assert.throws(
      () => validateAndCanonicalizeUtcDate('not-a-date'),
      InvalidDateError
    );

    assert.throws(
      () => validateAndCanonicalizeUtcDate('2026-13-01'),
      InvalidDateError
    );

    // Rejects negative contribution count in repository
    await assert.rejects(
      async () => {
        await SyncRepository.reconcileDailyContributionState('user-1', '2026-11-15', -5);
      },
      (err: unknown) => {
        assert.ok((err as Error).message.includes('Invalid observedPublicTotal'));
        return true;
      }
    );
  });

  test('15. Concurrent snapshot ordering: Older snapshot committing after a newer snapshot does not overwrite latest observation', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_15',
      username: 'rec_trainer_15',
      primaryHandle: 'rec_trainer_15',
    });

    const targetDate = '2026-11-15';
    const timeNewer = new Date('2026-11-15T12:00:10.000Z');
    const timeOlder = new Date('2026-11-15T12:00:05.000Z');

    // 1. Worker A retrieves snapshot 12 at 12:00:10 and commits first
    const resA = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      12,
      timeNewer
    );

    assert.equal(resA.currentHighWaterMark, 12);
    assert.equal(resA.latestObservedContributions, 12);
    assert.equal(resA.newlyObservedIncrements, 12);

    // 2. Worker B retrieves snapshot 9 at 12:00:05 (older) and commits afterward
    const resB = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      9,
      timeOlder
    );

    // Invariant: High-water mark remains 12
    assert.equal(resB.previousHighWaterMark, 12);
    assert.equal(resB.currentHighWaterMark, 12, 'High-water mark must remain 12');
    assert.equal(resB.newlyObservedIncrements, 0);

    // Invariant: latest_observed_contributions must NOT be overwritten by older snapshot
    assert.equal(resB.latestObservedContributions, 12, 'Older snapshot must not overwrite newer observation of 12');

    // Verify database row
    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 12);
    assert.equal(row?.latest_observed_contributions, 12);
    assert.equal(new Date(row?.latest_observed_at as Date).toISOString(), timeNewer.toISOString());
  });

  test('16. Concurrent snapshot ordering: Newer snapshot committing after an older snapshot updates latest observation', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_16',
      username: 'rec_trainer_16',
      primaryHandle: 'rec_trainer_16',
    });

    const targetDate = '2026-11-15';
    const timeOlder = new Date('2026-11-15T12:00:05.000Z');
    const timeNewer = new Date('2026-11-15T12:00:10.000Z');

    // 1. Worker B commits older snapshot 9 at 12:00:05 first
    const resB = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      9,
      timeOlder
    );

    assert.equal(resB.currentHighWaterMark, 9);
    assert.equal(resB.latestObservedContributions, 9);

    // 2. Worker A commits newer snapshot 12 at 12:00:10 afterward
    const resA = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      12,
      timeNewer
    );

    assert.equal(resA.previousHighWaterMark, 9);
    assert.equal(resA.currentHighWaterMark, 12);
    assert.equal(resA.newlyObservedIncrements, 3);
    assert.equal(resA.latestObservedContributions, 12, 'Newer snapshot must update latest observation to 12');

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 12);
    assert.equal(row?.latest_observed_contributions, 12);
    assert.equal(new Date(row?.latest_observed_at as Date).toISOString(), timeNewer.toISOString());
  });

  test('17. Concurrent snapshot ordering: Newer snapshot with lower count updates observation while preserving high-water mark', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_17',
      username: 'rec_trainer_17',
      primaryHandle: 'rec_trainer_17',
    });

    const targetDate = '2026-11-15';
    const timeFirst = new Date('2026-11-15T12:00:10.000Z');
    const timeLater = new Date('2026-11-15T12:00:20.000Z');

    // 1. Initial snapshot of 12 at 12:00:10
    await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      12,
      timeFirst
    );

    // 2. Later snapshot of 8 at 12:00:20 (e.g. user squashed/deleted commits upstream)
    const resLater = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      8,
      timeLater
    );

    // High-water mark remains 12
    assert.equal(resLater.previousHighWaterMark, 12);
    assert.equal(resLater.currentHighWaterMark, 12, 'High-water mark must NEVER decrease');
    assert.equal(resLater.newlyObservedIncrements, 0);

    // Latest observation correctly updates to 8 because timeLater > timeFirst
    assert.equal(resLater.latestObservedContributions, 8, 'Newer observation accurately records upstream 8');

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 12);
    assert.equal(row?.latest_observed_contributions, 8);
    assert.equal(new Date(row?.latest_observed_at as Date).toISOString(), timeLater.toISOString());
  });

  test('18. Concurrent snapshot ordering: Simultaneous Promise.all reconciliation preserves correct state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_18',
      username: 'rec_trainer_18',
      primaryHandle: 'rec_trainer_18',
    });

    const targetDate = '2026-11-15';
    const timeA = new Date('2026-11-15T12:00:10.000Z'); // newer
    const timeB = new Date('2026-11-15T12:00:05.000Z'); // older

    // Launch both simultaneously
    await Promise.all([
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 12, timeA),
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 9, timeB),
    ]);

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    // Regardless of commit ordering, the high-water mark must be 12, and latest observation must be 12 (timeA > timeB)
    assert.equal(row?.total_contributions_recorded, 12, 'High-water mark must be 12');
    assert.equal(row?.latest_observed_contributions, 12, 'Latest observed count must be 12');
    assert.equal(new Date(row?.latest_observed_at as Date).toISOString(), timeA.toISOString());
  });

  test('19. Request-order inversion: Older slow request completing after newer fast request cannot overwrite newer observation', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_19',
      username: 'rec_trainer_19',
      primaryHandle: 'rec_trainer_19',
    });

    const targetDate = '2026-11-15';
    const tOlderInitiated = new Date('2026-11-15T14:00:00.000Z'); // Request 1 initiated at 14:00:00
    const tNewerInitiated = new Date('2026-11-15T14:00:02.000Z'); // Request 2 initiated at 14:00:02

    // Simulate Request 2 (fast response, 11 contributions) completing and committing FIRST
    const resFast = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      11,
      tNewerInitiated
    );

    assert.equal(resFast.currentHighWaterMark, 11);
    assert.equal(resFast.latestObservedContributions, 11);
    assert.equal(resFast.newlyObservedIncrements, 11);

    // Simulate Request 1 (slow response, 7 contributions) completing and committing AFTERWARD
    const resSlow = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      7,
      tOlderInitiated
    );

    // Assertions:
    // 1. High-water mark remains 11
    assert.equal(resSlow.previousHighWaterMark, 11);
    assert.equal(resSlow.currentHighWaterMark, 11, 'High-water mark must strictly remain 11');
    assert.equal(resSlow.newlyObservedIncrements, 0, 'Stale snapshot produces 0 newly observed increments');

    // 2. latest_observed_contributions remains 11 because tOlderInitiated < tNewerInitiated
    assert.equal(resSlow.latestObservedContributions, 11, 'Slow delayed request cannot overwrite newer observation');

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 11);
    assert.equal(row?.latest_observed_contributions, 11);
    assert.equal(new Date(row?.latest_observed_at as Date).toISOString(), tNewerInitiated.toISOString());
  });

  test('20. Equal-millisecond timestamps: Deterministic resolution prevents last-commit-wins race conditions', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const targetDate = '2026-11-15';
    const equalTimestamp = new Date('2026-11-15T15:30:00.123Z');

    // Case A: Higher count (15) commits first, Lower count (10) commits second
    const trainerA = await UserRepository.createTrainer({
      githubUserId: 'rec_user_20_A',
      username: 'rec_trainer_20_A',
      primaryHandle: 'rec_trainer_20_A',
    });

    await SyncRepository.reconcileDailyContributionState(trainerA.user.id, targetDate, 15, equalTimestamp);
    const resA2 = await SyncRepository.reconcileDailyContributionState(trainerA.user.id, targetDate, 10, equalTimestamp);

    assert.equal(resA2.currentHighWaterMark, 15);
    assert.equal(resA2.latestObservedContributions, 15, 'Case A must deterministically resolve to 15');

    // Case B: Lower count (10) commits first, Higher count (15) commits second
    const trainerB = await UserRepository.createTrainer({
      githubUserId: 'rec_user_20_B',
      username: 'rec_trainer_20_B',
      primaryHandle: 'rec_trainer_20_B',
    });

    await SyncRepository.reconcileDailyContributionState(trainerB.user.id, targetDate, 10, equalTimestamp);
    const resB2 = await SyncRepository.reconcileDailyContributionState(trainerB.user.id, targetDate, 15, equalTimestamp);

    assert.equal(resB2.currentHighWaterMark, 15);
    assert.equal(resB2.latestObservedContributions, 15, 'Case B must deterministically resolve to 15');

    // Both cases result in the identical deterministic state:
    const rowA = await SyncRepository.getDailySyncState(trainerA.user.id, targetDate);
    const rowB = await SyncRepository.getDailySyncState(trainerB.user.id, targetDate);

    assert.equal(rowA?.latest_observed_contributions, 15);
    assert.equal(rowB?.latest_observed_contributions, 15);
    assert.equal(rowA?.total_contributions_recorded, 15);
    assert.equal(rowB?.total_contributions_recorded, 15);
  });

  test('21. Reward-accounting readiness: Concurrent reconciliation with overlapping snapshots produces zero duplicate increments', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_21',
      username: 'rec_trainer_21',
      primaryHandle: 'rec_trainer_21',
    });

    const targetDate = '2026-11-15';

    // Three concurrent workers observing overlapping counts: 6, 10, and duplicate 10
    const [res1, res2, res3] = await Promise.all([
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 6, new Date('2026-11-15T16:00:01.000Z')),
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 10, new Date('2026-11-15T16:00:05.000Z')),
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 10, new Date('2026-11-15T16:00:06.000Z')),
    ]);

    const totalIncrements = res1.newlyObservedIncrements + res2.newlyObservedIncrements + res3.newlyObservedIncrements;

    // Invariant: The sum of increments across all concurrent calls MUST be exactly 10
    assert.equal(totalIncrements, 10, 'Total newly observed increments must equal 10 without duplicate counting');

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 10);
    assert.equal(row?.latest_observed_contributions, 10);
  });

  test('22. Distributed request ordering: Two application instances with deliberately skewed clocks', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_22',
      username: 'rec_trainer_22',
      primaryHandle: 'rec_trainer_22',
    });

    const targetDate = '2026-11-15';

    // Instance A allocated sequence 1, but its system clock is skewed 4 hours in the FUTURE (18:00:00Z)
    const seqA = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const skewedClockFuture = new Date('2026-11-15T18:00:00.000Z');

    // Instance B allocated sequence 2, but its system clock is skewed 4 hours in the PAST (10:00:00Z)
    const seqB = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const skewedClockPast = new Date('2026-11-15T10:00:00.000Z');

    assert.equal(seqA, 1);
    assert.equal(seqB, 2);

    // Commit Instance B first (seq 2, 8 contributions, past timestamp)
    const resB = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      8,
      { observedAt: skewedClockPast, requestSequence: seqB }
    );

    assert.equal(resB.currentHighWaterMark, 8);
    assert.equal(resB.latestObservedContributions, 8);
    assert.equal(resB.latestRequestSequence, 2);
    assert.equal(resB.isStale, false);

    // Now commit Instance A afterward (seq 1, 5 contributions, future timestamp)
    const resA = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      5,
      { observedAt: skewedClockFuture, requestSequence: seqA }
    );

    // Sequence ordering MUST supersede clock timestamp:
    // Even though Instance A had a "future" clock timestamp, seq 1 < seq 2, so it is STALE!
    assert.equal(resA.isStale, true, 'Instance A must be flagged stale despite future clock');
    assert.equal(resA.latestObservedContributions, 8, 'Latest observation must retain Instance B value');
    assert.equal(resA.latestRequestSequence, 2, 'Latest sequence must retain Instance B sequence 2');
    assert.equal(resA.currentHighWaterMark, 8);
    assert.equal(resA.rewardEligibleIncrements, 0, 'Stale snapshot yields 0 reward-eligible increments');
  });

  test('23. Distributed request ordering: Earlier request completing after a later request', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_23',
      username: 'rec_trainer_23',
      primaryHandle: 'rec_trainer_23',
    });

    const targetDate = '2026-11-15';

    const seq1 = await SyncRepository.allocateSnapshotSequence(trainer.user.id); // earlier
    const seq2 = await SyncRepository.allocateSnapshotSequence(trainer.user.id); // later

    assert.ok(seq1 < seq2);

    // Later request completes first
    await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      9,
      { observedAt: new Date('2026-11-15T12:00:02.000Z'), requestSequence: seq2 }
    );

    // Earlier request finishes late
    const resEarlier = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      6,
      { observedAt: new Date('2026-11-15T12:00:00.000Z'), requestSequence: seq1 }
    );

    assert.equal(resEarlier.isStale, true);
    assert.equal(resEarlier.latestObservedContributions, 9);
    assert.equal(resEarlier.latestRequestSequence, seq2);
    assert.equal(resEarlier.currentHighWaterMark, 9);
    assert.equal(resEarlier.rewardEligibleIncrements, 0);
  });

  test('24. Distributed request ordering: Equal timestamps with different request sequences', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_24',
      username: 'rec_trainer_24',
      primaryHandle: 'rec_trainer_24',
    });

    const targetDate = '2026-11-15';
    const equalTime = new Date('2026-11-15T12:00:00.500Z');

    const seq1 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const seq2 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);

    // Commit seq 2 first with count 12
    await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      12,
      { observedAt: equalTime, requestSequence: seq2 }
    );

    // Commit seq 1 with count 7 at identical timestamp
    const res1 = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      7,
      { observedAt: equalTime, requestSequence: seq1 }
    );

    // Sequence breaks the tie deterministically:
    assert.equal(res1.isStale, true);
    assert.equal(res1.latestObservedContributions, 12);
    assert.equal(res1.latestRequestSequence, seq2);
  });

  test('25. Stale snapshot protection: Older snapshot with higher count arriving after newer lower-count snapshot', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_25',
      username: 'rec_trainer_25',
      primaryHandle: 'rec_trainer_25',
    });

    const targetDate = '2026-11-15';

    // Sequence 1: upstream count was 10 (delayed in transit)
    const seq1 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);

    // User deleted/squashed commits upstream; count drops to 6
    // Sequence 2: upstream count is 6
    const seq2 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);

    // Newer snapshot (seq 2, count 6) commits first
    const resNewer = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      6,
      { observedAt: new Date('2026-11-15T12:00:05.000Z'), requestSequence: seq2 }
    );

    assert.equal(resNewer.currentHighWaterMark, 6);
    assert.equal(resNewer.latestObservedContributions, 6);
    assert.equal(resNewer.latestRequestSequence, seq2);
    assert.equal(resNewer.rewardEligibleIncrements, 6);
    assert.equal(resNewer.isStale, false);

    // Stale snapshot (seq 1, count 10) arrives afterward
    const resOlder = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      10,
      { observedAt: new Date('2026-11-15T12:00:00.000Z'), requestSequence: seq1 }
    );

    // CRITICAL AUDIT ASSERTIONS:
    // 1. High-water mark MUST NOT advance to 10 based on a stale snapshot!
    assert.equal(resOlder.currentHighWaterMark, 6, 'High-water mark must NOT advance from stale snapshot');
    assert.equal(resOlder.previousHighWaterMark, 6);

    // 2. Latest observation MUST NOT be overwritten
    assert.equal(resOlder.latestObservedContributions, 6);
    assert.equal(resOlder.latestRequestSequence, seq2);

    // 3. Stale snapshot must yield ZERO reward-eligible increments
    assert.equal(resOlder.rewardEligibleIncrements, 0, 'Zero reward-eligible increments from stale snapshot');
    assert.equal(resOlder.newlyObservedIncrements, 0);
    assert.equal(resOlder.isStale, true);

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 6);
    assert.equal(row?.latest_observed_contributions, 6);
    assert.equal(Number(row?.latest_request_sequence), seq2);
  });

  test('26. Monotonic high-water mark: Newer snapshot with lower count updates observation while preserving high-water mark', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_26',
      username: 'rec_trainer_26',
      primaryHandle: 'rec_trainer_26',
    });

    const targetDate = '2026-11-15';

    // Sequence 1: 10 contributions committed first
    const seq1 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const res1 = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      10,
      { requestSequence: seq1 }
    );

    assert.equal(res1.currentHighWaterMark, 10);
    assert.equal(res1.latestObservedContributions, 10);
    assert.equal(res1.rewardEligibleIncrements, 10);

    // Sequence 2: User squashed commits, upstream count drops to 6
    const seq2 = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const res2 = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      6,
      { requestSequence: seq2 }
    );

    // Invariants:
    // 1. High-water mark NEVER decreases: remains 10
    assert.equal(res2.currentHighWaterMark, 10, 'High-water mark remains 10');
    assert.equal(res2.previousHighWaterMark, 10);

    // 2. Latest observation accurately updates to 6 (newer observation accepted)
    assert.equal(res2.latestObservedContributions, 6);
    assert.equal(res2.latestRequestSequence, seq2);
    assert.equal(res2.isStale, false);

    // 3. Lower count yields 0 newly observed and 0 reward-eligible increments
    assert.equal(res2.newlyObservedIncrements, 0);
    assert.equal(res2.rewardEligibleIncrements, 0);

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 10);
    assert.equal(row?.latest_observed_contributions, 6);
    assert.equal(Number(row?.latest_request_sequence), seq2);
  });

  test('27. Atomic sequence allocation: Concurrent request-sequence allocation yields strictly contiguous unique sequences', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_27',
      username: 'rec_trainer_27',
      primaryHandle: 'rec_trainer_27',
    });

    // Concurrently allocate 10 sequences
    const allocationPromises = Array.from({ length: 10 }, () =>
      SyncRepository.allocateSnapshotSequence(trainer.user.id)
    );

    const allocated = await Promise.all(allocationPromises);

    // Sort to verify contiguous range 1..10
    const sorted = [...allocated].sort((a, b) => a - b);
    assert.equal(sorted.length, 10);
    assert.deepEqual(sorted, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Set of allocated values must have length 10 (strictly unique)
    assert.equal(new Set(allocated).size, 10, 'Every allocated sequence must be strictly unique');
  });

  test('28. Concurrent overlapping reconciliation with request sequences produces deterministic state', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const uid = `rec_user_28_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const trainer = await UserRepository.createTrainer({
      githubUserId: uid,
      username: uid,
      primaryHandle: uid,
    });

    const targetDate = '2026-11-15';

    const seqA = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const seqB = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    const seqC = await SyncRepository.allocateSnapshotSequence(trainer.user.id);

    // Launch 3 concurrent overlapping reconciliations with micro-delays to model overlapping arrival:
    // seqA (1) with count 5
    // seqB (2) with count 12
    // seqC (3) with count 8
    const results = await Promise.all([
      SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 5, { requestSequence: seqA }),
      new Promise<Awaited<ReturnType<typeof SyncRepository.reconcileDailyContributionState>>>((resolve) =>
        setTimeout(
          () => resolve(SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 12, { requestSequence: seqB })),
          10
        )
      ),
      new Promise<Awaited<ReturnType<typeof SyncRepository.reconcileDailyContributionState>>>((resolve) =>
        setTimeout(
          () => resolve(SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 8, { requestSequence: seqC })),
          25
        )
      ),
    ]);

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);

    // Seq C (3) is the newest sequence, so latest_observed_contributions must be 8
    assert.equal(row?.latest_observed_contributions, 8);
    assert.equal(Number(row?.latest_request_sequence), seqC);

    // High-water mark must be 12 (highest valid confirmed observation)
    assert.equal(row?.total_contributions_recorded, 12);

    // Total reward-eligible increments across all transactions cannot exceed 12
    const totalEligible = results.reduce((sum, r) => sum + r.rewardEligibleIncrements, 0);
    assert.equal(totalEligible, 12, 'Total reward-eligible increments must equal 12');
  });

  test('29. Idempotency: Duplicate reconciliation and retry with identical sequence yields 0 increments', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_29',
      username: 'rec_trainer_29',
      primaryHandle: 'rec_trainer_29',
    });

    const targetDate = '2026-11-15';
    const seq = await SyncRepository.allocateSnapshotSequence(trainer.user.id);

    // First attempt: count 9
    const res1 = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      9,
      { requestSequence: seq }
    );

    assert.equal(res1.newlyObservedIncrements, 9);
    assert.equal(res1.rewardEligibleIncrements, 9);
    assert.equal(res1.isStale, false);

    // Retry / duplicate of same sequence: count 9
    const res2 = await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      9,
      { requestSequence: seq }
    );

    assert.equal(res2.newlyObservedIncrements, 0, 'Retry yields 0 newly observed increments');
    assert.equal(res2.rewardEligibleIncrements, 0, 'Retry yields 0 reward-eligible increments');
    assert.equal(res2.currentHighWaterMark, 9);
    assert.equal(res2.latestObservedContributions, 9);
    assert.equal(res2.latestRequestSequence, seq);
  });

  test('30. Pre-reconciliation safety: A failed GitHub request leaves daily sync state completely untouched', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_30',
      username: 'rec_trainer_30',
      primaryHandle: 'rec_trainer_30',
      encryptedAccessToken: encryptToken('ghu_tok_30'),
    });

    const targetDate = '2026-11-15';

    // Baseline reconciliation: 4 contributions
    const baselineSeq = await SyncRepository.allocateSnapshotSequence(trainer.user.id);
    await SyncRepository.reconcileDailyContributionState(
      trainer.user.id,
      targetDate,
      4,
      { requestSequence: baselineSeq }
    );

    // Mock client failure (e.g. GitHub 503 / Network Timeout)
    setGitHubGraphQLClient({
      async execute() {
        throw new Error('Upstream GitHub GraphQL failure');
      },
    });

    await assert.rejects(
      async () => {
        await reconcileDailyContributionForUser(trainer.user.id, targetDate);
      },
      (err: unknown) => {
        assert.ok((err as Error).message.includes('Upstream GitHub GraphQL failure'));
        return true;
      }
    );

    // Database daily state must remain exactly 4 at baseline sequence
    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 4);
    assert.equal(row?.latest_observed_contributions, 4);
    assert.equal(Number(row?.latest_request_sequence), baselineSeq);
  });

  test('31. Transaction atomicity: Database rollback during reconciliation leaves daily state untouched', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'rec_user_31',
      username: 'rec_trainer_31',
      primaryHandle: 'rec_trainer_31',
    });

    const targetDate = '2026-11-15';

    await SyncRepository.reconcileDailyContributionState(trainer.user.id, targetDate, 7);

    // Explicit rollback simulation
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(
        'UPDATE daily_sync_states SET total_contributions_recorded = 50, latest_observed_contributions = 50 WHERE user_id = $1 AND sync_date = $2;',
        [trainer.user.id, targetDate]
      );
      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }

    const row = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(row?.total_contributions_recorded, 7, 'Rolled back transaction must leave state at 7');
    assert.equal(row?.latest_observed_contributions, 7);
  });
});
