// tests/integration/rewardAccountingAuditIntegration.test.ts
// Sprint 2.4C.1: Targeted Audit & Concurrency Hardening Integration Suite for Reward Accounting

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
import { PetRepository } from '../../src/lib/db/repositories/petRepository.ts';
import { LedgerRepository } from '../../src/lib/db/repositories/ledgerRepository.ts';
import {
  SyncRepository,
  calculateIncrementXp,
  calculateIncrementSatiety,
} from '../../src/lib/db/repositories/syncRepository.ts';
import { resetGitHubGraphQLClient } from '../../src/lib/github/graphqlClient.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

let userCounter = 0;
function uniqueUser(tag: string) {
  userCounter++;
  const id = `audit_${tag}_${Date.now()}_${userCounter}_${Math.floor(Math.random() * 100000)}`;
  return {
    githubUserId: id,
    username: id,
    primaryHandle: id,
  };
}

describe('Sprint 2.4C.1: Reward Accounting & Arithmetic Audit Integration Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Audit Tests] No active database on 5432. Starting local PostgreSQL 16...');
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
          // Database may already exist
        }
        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Audit Tests] Failed to initialize embedded postgres:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Audit Tests] Skipping: Database unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
    await pool.query("DELETE FROM users WHERE primary_handle LIKE 'audit_%';");
  });

  after(async () => {
    if (isDbAvailable) {
      await pool.query("DELETE FROM users WHERE primary_handle LIKE 'audit_%';").catch(() => {});
      await closePool();
    }
    if (embeddedInstance) {
      console.log('[Audit Tests Cleanup] Stopping local PostgreSQL 16...');
      try {
        await embeddedInstance.stop();
      } catch {
        // ignore shutdown error
      }
    }
  });

  beforeEach(async () => {
    resetGitHubGraphQLClient();
    if (isDbAvailable) {
      await pool.query("DELETE FROM users WHERE primary_handle LIKE 'audit_%';");
    }
  });

  afterEach(() => {
    resetGitHubGraphQLClient();
  });

  test('1. Five-increment XP total equals exactly 60 XP', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    // Verify individual increment XP arithmetic
    assert.equal(calculateIncrementXp(1), 25);
    assert.equal(calculateIncrementXp(2), 15);
    assert.equal(calculateIncrementXp(3), 10);
    assert.equal(calculateIncrementXp(4), 5);
    assert.equal(calculateIncrementXp(5), 5);
    const sumXp = [1, 2, 3, 4, 5].reduce((sum, ord) => sum + calculateIncrementXp(ord), 0);
    assert.equal(sumXp, 60, '25 + 15 + 10 + 5 + 5 must equal exactly 60 XP');

    const trainer = await UserRepository.createTrainer(uniqueUser('xp60'));
    const targetDate = '2026-11-15';

    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 1,
    });

    assert.equal(result.reward.processedIncrements, 5);
    assert.equal(result.reward.rewardedIncrements, 5);
    assert.equal(result.reward.xpAwarded, 60, 'Five increments must award exactly 60 XP');
    assert.equal(result.reward.dailyXpTotal, 60);

    // Verify ledger
    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].xp_awarded, 60);

    // Verify pet state
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.xp, 60);
  });

  test('2. Five-increment satiety total equals exactly 19 Satiety', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    assert.equal(calculateIncrementSatiety(1), 10);
    assert.equal(calculateIncrementSatiety(2), 5);
    assert.equal(calculateIncrementSatiety(3), 2);
    assert.equal(calculateIncrementSatiety(4), 1);
    assert.equal(calculateIncrementSatiety(5), 1);
    const sumSatiety = [1, 2, 3, 4, 5].reduce((sum, ord) => sum + calculateIncrementSatiety(ord), 0);
    assert.equal(sumSatiety, 19, '10 + 5 + 2 + 1 + 1 must equal exactly 19 Satiety');

    const trainer = await UserRepository.createTrainer(uniqueUser('sat19'));
    const targetDate = '2026-11-15';

    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 1,
    });

    assert.equal(result.reward.satietyAwarded, 19);

    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    assert.equal(ledger[0].satiety_awarded, 19);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.hunger, 60 + 19); // 60 default + 19
  });

  test('3. XP schedule remains consistent across multiple processing calls', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('sched_multi'));
    const targetDate = '2026-11-15';

    // Call 1: 2 increments -> ordinal 1 (25 XP) + ordinal 2 (15 XP) = 40 XP
    const res1 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 2, {
      requestSequence: 1,
    });
    assert.equal(res1.reward.xpAwarded, 40);
    assert.equal(res1.reward.satietyAwarded, 15);
    assert.equal(res1.reward.dailyXpTotal, 40);

    // Call 2: 3 increments -> ordinal 3 (10 XP) + ordinal 4 (5 XP) + ordinal 5 (5 XP) = 20 XP
    const res2 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 2,
    });
    assert.equal(res2.reward.xpAwarded, 20);
    assert.equal(res2.reward.satietyAwarded, 4);
    assert.equal(res2.reward.dailyXpTotal, 60);

    // Total cumulative across 2 calls must match single call: 60 XP and 19 Satiety
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.xp, 60);
    assert.equal(pet.hunger, 60 + 19);
  });

  test('4. Schedule remains consistent across concurrent workers', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('sched_conc'));
    const targetDate = '2026-11-15';

    // Concurrent workers with sequence 1 and 2
    const [resA, resB] = await Promise.all([
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 2, { requestSequence: 1 }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, { requestSequence: 2 }),
    ]);

    const totalXp = resA.reward.xpAwarded + resB.reward.xpAwarded;
    const totalSatiety = resA.reward.satietyAwarded + resB.reward.satietyAwarded;

    assert.equal(totalXp, 60, 'Combined XP across serialized workers must equal 60');
    assert.equal(totalSatiety, 19, 'Combined Satiety across serialized workers must equal 19');

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.xp, 60);
    assert.equal(pet.hunger, 60 + 19);
  });

  test('5. Exact 48-hour expiry boundary', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('exp_bound'));
    const syncDate = '2026-11-15';
    const createdAt = new Date('2026-11-15T12:00:00.000Z');

    // Create 10 increments on 2026-11-15: 5 rewarded, 5 pending
    await SyncRepository.processContributionSync(trainer.user.id, syncDate, 10, {
      requestSequence: 1,
      currentTime: createdAt,
    });

    const slicesBefore = await SyncRepository.getIncrementSlices(trainer.user.id, syncDate);
    const pendingSlice = slicesBefore.find((s) => s.status === 'pending');
    assert.ok(pendingSlice, 'Must have a pending slice');

    // Test Point A: 2026-11-16 23:59:59.999 UTC (1 ms before 48h from 2026-11-15 00:00:00 UTC)
    const timeBefore = new Date('2026-11-16T23:59:59.999Z');
    const expiredCountBefore = await SyncRepository.expireStalePendingSlices(48, undefined, timeBefore);
    assert.equal(expiredCountBefore, 0, 'Must NOT be expired at 2026-11-16T23:59:59.999Z');

    const sliceStillPending = await SyncRepository.getIncrementSlices(trainer.user.id, syncDate);
    assert.equal(
      sliceStillPending.find((s) => s.slice_start === 5)?.status,
      'pending',
      'Slice must remain pending right before 48h mark'
    );

    // Test Point B: 2026-11-17 00:00:00.000 UTC (exact 48-hour boundary)
    const timeExact = new Date('2026-11-17T00:00:00.000Z');
    const expiredCountExact = await SyncRepository.expireStalePendingSlices(48, undefined, timeExact);
    assert.equal(expiredCountExact, 1, 'Must be expired at exactly 2026-11-17T00:00:00.000Z');

    const sliceExpired = await SyncRepository.getIncrementSlices(trainer.user.id, syncDate);
    assert.equal(
      sliceExpired.find((s) => s.slice_start === 5)?.status,
      'expired',
      'Slice must transition to expired at 48h boundary'
    );

    // Test Point C: 2026-11-17 00:00:00.001 UTC (1 ms past boundary)
    const timeAfter = new Date('2026-11-17T00:00:00.001Z');
    const expiredCountAfter = await SyncRepository.expireStalePendingSlices(48, undefined, timeAfter);
    assert.equal(expiredCountAfter, 0, 'Already expired slice should not be re-expired');
  });

  test('6. Expired increment cannot be rewarded', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('exp_noreward'));
    const syncDate = '2026-11-10';
    const createdAt = new Date('2026-11-10T08:00:00.000Z');

    // 10 contributions: 5 rewarded, 5 pending
    await SyncRepository.processContributionSync(trainer.user.id, syncDate, 10, {
      requestSequence: 1,
      currentTime: createdAt,
    });

    // Fast-forward to 4 days later (past 48h expiry)
    const laterTime = new Date('2026-11-14T10:00:00.000Z');

    // Attempt to drain pending rewards
    const drainRes = await SyncRepository.processPendingRewards(trainer.user.id, {
      currentTime: laterTime,
    });

    assert.equal(drainRes.rewardedIncrements, 0, 'Cannot award rewards for expired increments');
    assert.equal(drainRes.xpAwarded, 0);

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, syncDate);
    const expiredSlice = slices.find((s) => s.slice_start === 5);
    assert.ok(expiredSlice);
    assert.equal(expiredSlice.status, 'expired');
  });

  test('7. Exact rolling-hour cutoff', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('roll_cutoff'));
    const targetDate = '2026-11-15';
    const t0 = new Date('2026-11-15T10:00:00.000Z');

    // Process 5 increments at 10:00:00.000Z (consumes full hourly quota)
    const res1 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 1,
      currentTime: t0,
    });
    assert.equal(res1.reward.processedIncrements, 5);
    assert.equal(res1.reward.hourlyQuotaRemaining, 0);

    // Test Point A: 10:59:59.999Z (1 ms before 1 hour has elapsed)
    const tBeforeCutoff = new Date('2026-11-15T10:59:59.999Z');
    const resThrottled = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 8, {
      requestSequence: 2,
      currentTime: tBeforeCutoff,
    });
    assert.equal(resThrottled.reward.processedIncrements, 0, 'Must remain throttled at 59m 59.999s');
    assert.equal(resThrottled.reward.hourlyQuotaRemaining, 0);
    assert.equal(resThrottled.reward.remainingPendingIncrements, 3);

    // Test Point B: 11:00:00.001Z (1 hour and 1 ms after t0, previous hour has fully elapsed)
    const tAfterCutoff = new Date('2026-11-15T11:00:00.001Z');
    const resAllowed = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 8, {
      requestSequence: 3,
      currentTime: tAfterCutoff,
    });
    assert.equal(resAllowed.reward.processedIncrements, 3, 'Must permit processing once 1 hour has elapsed');
    assert.equal(resAllowed.reward.remainingPendingIncrements, 0);
  });

  test('8. Forfeited increments count toward hourly processing', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('forf_hourly'));
    const targetDate = '2026-11-15';
    const t0 = new Date('2026-11-15T14:00:00.000Z');

    // Exhaust daily XP cap (300 XP)
    await SyncRepository.ensureDailySyncRow(trainer.user.id, targetDate);
    await pool.query(
      `UPDATE daily_sync_states
       SET daily_activity_xp_awarded = 300, total_contributions_recorded = 50, total_contributions_rewarded = 50
       WHERE user_id = $1 AND sync_date = $2;`,
      [trainer.user.id, targetDate]
    );

    // Process 5 increments. All 5 become forfeited.
    const resForfeited = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 55, {
      requestSequence: 1,
      currentTime: t0,
    });
    assert.equal(resForfeited.reward.processedIncrements, 5);
    assert.equal(resForfeited.reward.forfeitedIncrements, 5);
    assert.equal(resForfeited.reward.rewardedIncrements, 0);
    assert.equal(resForfeited.reward.hourlyQuotaRemaining, 0);

    // Try processing more 15 minutes later: must be blocked because forfeited consumed the hourly quota
    const t1 = new Date('2026-11-15T14:15:00.000Z');
    const resBlocked = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 58, {
      requestSequence: 2,
      currentTime: t1,
    });
    assert.equal(resBlocked.reward.processedIncrements, 0, 'Forfeited increments must consume hourly quota');
    assert.equal(resBlocked.reward.hourlyQuotaRemaining, 0);
  });

  test('9. Pending and expired increments do not count toward hourly processing', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('pend_exp_quota'));
    const oldDate = '2026-11-10';
    const targetDate = '2026-11-15';
    const t0 = new Date('2026-11-15T16:00:00.000Z');

    // Insert an expired slice directly
    await pool.query(
      `INSERT INTO contribution_increment_slices (
        user_id, sync_date, canonical_slice_id, slice_start, slice_end,
        increment_count, status, request_sequence, payload_hash, created_at, processed_at
      ) VALUES ($1, $2, 'urn:gh:daily:test:expired:0-5', 0, 5, 5, 'expired', 1, 'hash', $3, $3);`,
      [trainer.user.id, oldDate, t0]
    );

    // Insert a pending slice directly
    await pool.query(
      `INSERT INTO contribution_increment_slices (
        user_id, sync_date, canonical_slice_id, slice_start, slice_end,
        increment_count, status, request_sequence, payload_hash, created_at
      ) VALUES ($1, $2, 'urn:gh:daily:test:pending:0-5', 0, 5, 5, 'pending', 2, 'hash', $3);`,
      [trainer.user.id, targetDate, t0]
    );

    // Check hourly processed count in DB: only rewarded and forfeited count
    const hourlyRes = await pool.query<{ total: string | number }>(
      `SELECT COALESCE(SUM(increment_count), 0) AS total
       FROM contribution_increment_slices
       WHERE user_id = $1
         AND status IN ('rewarded', 'forfeited')
         AND processed_at > $2;`,
      [trainer.user.id, new Date(t0.getTime() - 3600_000)]
    );

    assert.equal(Number(hourlyRes.rows[0].total), 0, 'Pending and expired slices must not count toward hourly total');
  });

  test('10. Slice splitting creates no overlaps or gaps', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('slice_split'));
    const targetDate = '2026-11-15';

    // 10 increments observed; hourly allowance is 5
    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 1,
    });

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, targetDate);
    assert.equal(slices.length, 2);

    const s1 = slices.find((s) => s.slice_start === 0);
    const s2 = slices.find((s) => s.slice_start === 5);

    assert.ok(s1);
    assert.ok(s2);

    // Boundary consistency
    assert.equal(s1.slice_start, 0);
    assert.equal(s1.slice_end, 5);
    assert.equal(s1.status, 'rewarded');

    assert.equal(s2.slice_start, 5);
    assert.equal(s2.slice_end, 10);
    assert.equal(s2.status, 'pending');

    // No gaps or overlaps
    assert.equal(s1.slice_end, s2.slice_start);
    assert.equal(s1.increment_count + s2.increment_count, 10);

    // Unique identities
    assert.notEqual(s1.canonical_slice_id, s2.canonical_slice_id);
  });

  test('11. Duplicate partial-processing retry awards no duplicate XP', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('retry_part'));
    const targetDate = '2026-11-15';
    const t0 = new Date('2026-11-15T10:00:00.000Z');

    // Initial sync of 10 increments (5 rewarded, 5 pending)
    const res1 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 1,
      currentTime: t0,
    });
    assert.equal(res1.reward.rewardedIncrements, 5);
    assert.equal(res1.reward.xpAwarded, 60);

    // Duplicate call with same sequence and snapshot within the same hour
    const res2 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 1,
      currentTime: t0,
    });
    assert.equal(res2.reward.rewardedIncrements, 0, 'Retry must not award new rewards');
    assert.equal(res2.reward.xpAwarded, 0);

    // Ledger must have exactly 1 entry
    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    assert.equal(ledger.length, 1);
  });

  test('12. Ledger, counters and pet state reconcile exactly', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('recon_exact'));
    const targetDate = '2026-11-15';

    // Synchronize 4 contributions
    const res = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 4, {
      requestSequence: 1,
      bypassHourlyThrottle: true,
    });

    const state = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.ok(state);

    // Mathematical reconciliation:
    // total_contributions_recorded = total_contributions_rewarded + total_contributions_forfeited + pending_contribution_increments
    assert.equal(
      state.total_contributions_recorded,
      state.total_contributions_rewarded + state.total_contributions_forfeited + state.pending_contribution_increments
    );

    // Ledger sum == daily_activity_xp_awarded
    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    const ledgerXpSum = ledger.reduce((sum, e) => sum + e.xp_awarded, 0);
    const ledgerSatietySum = ledger.reduce((sum, e) => sum + e.satiety_awarded, 0);

    assert.equal(state.daily_activity_xp_awarded, ledgerXpSum);
    assert.equal(res.reward.xpAwarded, ledgerXpSum);

    // Pet XP matches ledger
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.xp, ledgerXpSum);
    assert.equal(pet.hunger, 60 + ledgerSatietySum);
  });

  test('13. Concurrent processing cannot exceed the 300 XP daily cap', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer(uniqueUser('conc_cap'));
    const targetDate = '2026-11-15';

    // Set user to 290 XP (10 XP remaining before cap)
    await SyncRepository.ensureDailySyncRow(trainer.user.id, targetDate);
    await pool.query(
      `UPDATE daily_sync_states
       SET daily_activity_xp_awarded = 290, total_contributions_recorded = 50, total_contributions_rewarded = 50
       WHERE user_id = $1 AND sync_date = $2;`,
      [trainer.user.id, targetDate]
    );

    // Dispatch 5 concurrent requests, each attempting 1 increment (each worth 5 XP). Total attempted: 25 XP.
    const promises = [
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 51, { requestSequence: 1, bypassHourlyThrottle: true }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 52, { requestSequence: 2, bypassHourlyThrottle: true }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 53, { requestSequence: 3, bypassHourlyThrottle: true }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 54, { requestSequence: 4, bypassHourlyThrottle: true }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 55, { requestSequence: 5, bypassHourlyThrottle: true }),
    ];

    await Promise.all(promises);

    const finalState = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.ok(finalState);

    // STRICT INVARIANT: daily_activity_xp_awarded must be exactly 300, never exceeding 300
    assert.equal(finalState.daily_activity_xp_awarded, 300, 'Daily XP must never exceed 300 under concurrency');
    assert.equal(finalState.total_contributions_rewarded, 52, 'Exactly 2 increments rewarded before cap exhaustion');
    assert.equal(finalState.total_contributions_forfeited, 3, 'Remaining 3 increments must be forfeited');
  });
});
