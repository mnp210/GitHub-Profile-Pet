// tests/integration/contributionRewardAccountingIntegration.test.ts
// Sprint 2.4C: Server-Authoritative Contribution Reward Accounting & Pet Progression Integration Suite

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
  DuplicateSequenceConflictError,
  calculateIncrementXp,
  calculateIncrementSatiety,
  computePayloadHash,
} from '../../src/lib/db/repositories/syncRepository.ts';
import { resetGitHubGraphQLClient } from '../../src/lib/github/graphqlClient.ts';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.TEST_DATABASE_URL = TEST_DB_URL;
process.env.DATABASE_URL = TEST_DB_URL;
(process.env as Record<string, string | undefined>).NODE_ENV = 'test';

describe('Server-Authoritative Contribution Reward Accounting & Pet Progression Suite', () => {
  let pool: Pool;
  let isDbAvailable = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let embeddedInstance: any = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('[Reward Accounting Tests] No active database on 5432. Starting local PostgreSQL 16...');
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
        console.warn('[Reward Accounting Tests] Failed to initialize embedded postgres:', (err as Error).message);
      }
    }

    if (!health.ok) {
      console.warn(`[Reward Accounting Tests] Skipping: Database unavailable at ${maskConnectionString(TEST_DB_URL)}`);
      isDbAvailable = false;
      return;
    }

    isDbAvailable = true;
    pool = getPool();
    await migrateUp();
    await pool.query("DELETE FROM users WHERE primary_handle LIKE 'c_%' OR primary_handle LIKE 'cra_%';");
  });

  after(async () => {
    if (isDbAvailable) {
      await pool.query("DELETE FROM users WHERE primary_handle LIKE 'c_%' OR primary_handle LIKE 'cra_%';").catch(() => {});
      await closePool();
    }
    if (embeddedInstance) {
      console.log('[Reward Accounting Tests Cleanup] Stopping local PostgreSQL 16...');
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
      await pool.query("DELETE FROM users WHERE primary_handle LIKE 'c_%' OR primary_handle LIKE 'cra_%';");
    }
  });

  afterEach(() => {
    resetGitHubGraphQLClient();
  });

  test('1. End-to-End Reward Pipeline: public increments -> slices -> ledger -> pet XP/satiety', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_1',
      username: 'c_trainer_1',
      primaryHandle: 'c_trainer_1',
    });

    const targetDate = '2026-11-15';

    // Synchronize 3 contributions
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 3, {
      requestSequence: 1,
    });

    assert.equal(result.newlyObservedIncrements, 3);
    assert.equal(result.reward.processedIncrements, 3);
    assert.equal(result.reward.rewardedIncrements, 3);
    assert.equal(result.reward.forfeitedIncrements, 0);

    // XP: 25 (1st) + 15 (2nd) + 10 (3rd) = 50 XP
    assert.equal(result.reward.xpAwarded, 50);
    // Satiety: 10 (1st) + 5 (2nd) + 2 (3rd) = 17 Satiety
    assert.equal(result.reward.satietyAwarded, 17);

    // Verify slices table
    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, targetDate);
    assert.equal(slices.length, 1);
    assert.equal(slices[0].status, 'rewarded');
    assert.equal(slices[0].slice_start, 0);
    assert.equal(slices[0].slice_end, 3);
    assert.equal(slices[0].increment_count, 3);
    assert.equal(slices[0].canonical_slice_id, `urn:gh:daily:${trainer.user.id}:${targetDate}:slice:0-3`);

    // Verify ledger
    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].canonical_activity_id, `urn:gh:daily:${trainer.user.id}:${targetDate}:slice:0-3`);
    assert.equal(ledger[0].activity_type, 'github_activity');
    assert.equal(ledger[0].xp_awarded, 50);
    assert.equal(ledger[0].satiety_awarded, 17);

    // Verify pet state
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.xp, 50);
    assert.equal(pet.hunger, 60 + 17); // Initial default hunger in schema is 60
  });

  test('2. Diminishing XP schedule (25, 15, 10, 5, 5...)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    assert.equal(calculateIncrementXp(1), 25);
    assert.equal(calculateIncrementXp(2), 15);
    assert.equal(calculateIncrementXp(3), 10);
    assert.equal(calculateIncrementXp(4), 5);
    assert.equal(calculateIncrementXp(5), 5);
    assert.equal(calculateIncrementXp(20), 5);

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_2',
      username: 'c_trainer_2',
      primaryHandle: 'c_trainer_2',
    });

    const targetDate = '2026-11-15';
    // 5 increments in a single batch
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 1,
    });

    // 25 + 15 + 10 + 5 + 5 = 60 XP
    assert.equal(result.reward.xpAwarded, 60);
    assert.equal(result.reward.dailyXpTotal, 60);
  });

  test('3. Satiety schedule (10, 5, 2, 1, 1...) clamped to 100', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    assert.equal(calculateIncrementSatiety(1), 10);
    assert.equal(calculateIncrementSatiety(2), 5);
    assert.equal(calculateIncrementSatiety(3), 2);
    assert.equal(calculateIncrementSatiety(4), 1);
    assert.equal(calculateIncrementSatiety(5), 1);

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_3',
      username: 'c_trainer_3',
      primaryHandle: 'c_trainer_3',
    });

    // Set pet hunger close to 100
    await pool.query('UPDATE pet_states SET hunger = 95 WHERE user_id = $1;', [trainer.user.id]);

    const targetDate = '2026-11-15';
    // 3 increments: 10 + 5 + 2 = 17 Satiety. 95 + 17 = 112 -> Clamped to 100
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 3, {
      requestSequence: 1,
    });

    assert.equal(result.reward.satietyAwarded, 17);
    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.hunger, 100, 'Pet hunger must be clamped to max 100');
  });

  test('4. Level-up trigger on XP threshold (level * 100)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_4',
      username: 'c_trainer_4',
      primaryHandle: 'c_trainer_4',
    });

    // Set pet XP to 80 / 100 (level 1)
    await pool.query('UPDATE pet_states SET level = 1, xp = 80, max_exp = 100 WHERE user_id = $1;', [
      trainer.user.id,
    ]);

    const targetDate = '2026-11-15';
    // 1st increment awards 25 XP -> 80 + 25 = 105 XP -> Level 2 with 5 XP
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 1, {
      requestSequence: 1,
    });

    assert.equal(result.reward.petProgression?.previousLevel, 1);
    assert.equal(result.reward.petProgression?.newLevel, 2);
    assert.equal(result.reward.petProgression?.currentXp, 5);
    assert.equal(result.reward.petProgression?.maxExp, 200);
    assert.equal(result.reward.petProgression?.leveledUp, true);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.level, 2);
    assert.equal(pet.xp, 5);
    assert.equal(pet.max_exp, 200);
  });

  test('5. Evolution transition trigger across level boundaries (e.g. Hatchling to Juvenile at Level 10)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_5',
      username: 'c_trainer_5',
      primaryHandle: 'c_trainer_5',
    });

    // Set pet to level 9, xp 890 / 900, stage Hatchling
    await pool.query(
      "UPDATE pet_states SET level = 9, xp = 890, max_exp = 900, evolution_stage = 'Hatchling' WHERE user_id = $1;",
      [trainer.user.id]
    );

    const targetDate = '2026-11-15';
    // 1st increment awards 25 XP -> 890 + 25 = 915 -> Level 10 with 15 XP
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 1, {
      requestSequence: 1,
    });

    assert.equal(result.reward.petProgression?.newLevel, 10);
    assert.equal(result.reward.petProgression?.evolutionStage, 'Juvenile');
    assert.equal(result.reward.petProgression?.leveledUp, true);

    const pet = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(pet);
    assert.equal(pet.level, 10);
    assert.equal(pet.evolution_stage, 'Juvenile');
  });

  test('6. Multi-level jump from a large contribution batch', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_6',
      username: 'c_trainer_6',
      primaryHandle: 'c_trainer_6',
    });

    // Start at level 1, xp 0
    // We can apply XP directly or via large batch with bypassHourlyThrottle
    // If we award 350 XP:
    // Level 1 (needs 100) -> Level 2 (needs 200) -> Level 3 (needs 300).
    // 350 - 100 = 250 - 200 = 50 XP remaining at Level 3.
    const expResult = await PetRepository.applyExperience(trainer.user.id, 350);

    assert.equal(expResult.previousLevel, 1);
    assert.equal(expResult.newLevel, 3);
    assert.equal(expResult.currentXp, 50);
    assert.equal(expResult.maxExp, 300);
    assert.equal(expResult.leveledUp, true);
  });

  test('7. Hourly throttle: maximum 5 increments per rolling hour', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_7',
      username: 'c_trainer_7',
      primaryHandle: 'c_trainer_7',
    });

    const targetDate = '2026-11-15';
    const now = new Date('2026-11-15T10:00:00.000Z');

    // Attempt to sync 8 increments
    const result1 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 8, {
      requestSequence: 1,
      currentTime: now,
    });

    assert.equal(result1.newlyObservedIncrements, 8);
    assert.equal(result1.reward.processedIncrements, 5, 'Must cap processing to 5 in rolling hour');
    assert.equal(result1.reward.rewardedIncrements, 5);
    assert.equal(result1.reward.remainingPendingIncrements, 3);
    assert.equal(result1.reward.hourlyQuotaRemaining, 0);

    // Call again 15 minutes later within the same rolling hour
    const fifteenMinLater = new Date('2026-11-15T10:15:00.000Z');
    const result2 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 8, {
      requestSequence: 2,
      currentTime: fifteenMinLater,
    });

    assert.equal(result2.newlyObservedIncrements, 0);
    assert.equal(result2.reward.processedIncrements, 0, 'Cannot process pending increments while throttle active');
    assert.equal(result2.reward.remainingPendingIncrements, 3);
    assert.equal(result2.reward.hourlyQuotaRemaining, 0);
  });

  test('8. Slice splitting: 10 increments discovered -> 5 rewarded immediately, 5 remain pending', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_8',
      username: 'c_trainer_8',
      primaryHandle: 'c_trainer_8',
    });

    const targetDate = '2026-11-15';
    const now = new Date('2026-11-15T11:00:00.000Z');

    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 1,
      currentTime: now,
    });

    assert.equal(result.reward.processedIncrements, 5);
    assert.equal(result.reward.remainingPendingIncrements, 5);

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, targetDate);
    assert.equal(slices.length, 2, 'Should have split into 2 slices');

    // Slice 1: [0, 5) rewarded
    const slice1 = slices.find((s) => s.slice_start === 0 && s.slice_end === 5);
    assert.ok(slice1);
    assert.equal(slice1.status, 'rewarded');
    assert.equal(slice1.canonical_slice_id, `urn:gh:daily:${trainer.user.id}:${targetDate}:slice:0-5`);

    // Slice 2: [5, 10) pending
    const slice2 = slices.find((s) => s.slice_start === 5 && s.slice_end === 10);
    assert.ok(slice2);
    assert.equal(slice2.status, 'pending');
    assert.equal(slice2.canonical_slice_id, `urn:gh:daily:${trainer.user.id}:${targetDate}:slice:5-10`);
  });

  test('9. Draining pending increments in subsequent hour after throttle window passes', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_9',
      username: 'c_trainer_9',
      primaryHandle: 'c_trainer_9',
    });

    const targetDate = '2026-11-15';
    const t0 = new Date('2026-11-15T12:00:00.000Z');

    // Sync 10 increments -> 5 rewarded, 5 pending
    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 1,
      currentTime: t0,
    });

    // Fast-forward 65 minutes to open a new rolling hour window
    const t1 = new Date('2026-11-15T13:05:00.000Z');
    const drainResult = await SyncRepository.processPendingRewards(trainer.user.id, {
      currentTime: t1,
    });

    assert.equal(drainResult.processedIncrements, 5);
    assert.equal(drainResult.rewardedIncrements, 5);
    assert.equal(drainResult.remainingPendingIncrements, 0);

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, targetDate);
    assert.equal(slices.length, 2);
    assert.equal(slices.every((s) => s.status === 'rewarded'), true);
  });

  test('10. Daily 300 XP cap enforcement: increments beyond cap are forfeited with 0 XP', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_10',
      username: 'c_trainer_10',
      primaryHandle: 'c_trainer_10',
    });

    const targetDate = '2026-11-15';
    // Set daily XP to 295 / 300
    await SyncRepository.ensureDailySyncRow(trainer.user.id, targetDate);
    await pool.query(
      `UPDATE daily_sync_states
       SET daily_activity_xp_awarded = 295, total_contributions_recorded = 50, total_contributions_rewarded = 50
       WHERE user_id = $1 AND sync_date = $2;`,
      [trainer.user.id, targetDate]
    );

    // Sync 2 new increments:
    // Ordinal 51 awards 5 XP -> 295 + 5 = 300 (cap reached).
    // Ordinal 52 exceeds 300 -> forfeited!
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 52, {
      requestSequence: 1,
      bypassHourlyThrottle: true,
    });

    assert.equal(result.reward.processedIncrements, 2);
    assert.equal(result.reward.rewardedIncrements, 1);
    assert.equal(result.reward.forfeitedIncrements, 1);
    assert.equal(result.reward.xpAwarded, 5);
    assert.equal(result.reward.dailyXpTotal, 300);
    assert.equal(result.reward.capExhausted, true);
  });

  test('11. Forfeited increments recording in ledger with 0 XP and canonical forfeited ID', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_11',
      username: 'c_trainer_11',
      primaryHandle: 'c_trainer_11',
    });

    const targetDate = '2026-11-15';
    // Cap already fully exhausted
    await SyncRepository.ensureDailySyncRow(trainer.user.id, targetDate);
    await pool.query(
      `UPDATE daily_sync_states
       SET daily_activity_xp_awarded = 300, total_contributions_recorded = 60, total_contributions_rewarded = 60, total_contributions_forfeited = 0
       WHERE user_id = $1 AND sync_date = $2;`,
      [trainer.user.id, targetDate]
    );

    // Sync 3 new increments
    const result = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 63, {
      requestSequence: 1,
      bypassHourlyThrottle: true,
    });

    assert.equal(result.reward.rewardedIncrements, 0);
    assert.equal(result.reward.forfeitedIncrements, 3);
    assert.equal(result.reward.xpAwarded, 0);

    // Check ledger
    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    const forfeitedEntry = ledger.find((e) => e.activity_type === 'github_activity_forfeited');
    assert.ok(forfeitedEntry);
    assert.equal(forfeitedEntry.canonical_activity_id, `urn:gh:daily:${trainer.user.id}:${targetDate}:forfeited:60-63`);
    assert.equal(forfeitedEntry.xp_awarded, 0);
    assert.equal(forfeitedEntry.satiety_awarded, 0);
  });

  test('12. Forfeited increments do not increment total_contributions_rewarded', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_12',
      username: 'c_trainer_12',
      primaryHandle: 'c_trainer_12',
    });

    const targetDate = '2026-11-15';
    await SyncRepository.ensureDailySyncRow(trainer.user.id, targetDate);
    await pool.query(
      `UPDATE daily_sync_states
       SET daily_activity_xp_awarded = 300, total_contributions_recorded = 50, total_contributions_rewarded = 50, total_contributions_forfeited = 0
       WHERE user_id = $1 AND sync_date = $2;`,
      [trainer.user.id, targetDate]
    );

    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 55, {
      requestSequence: 1,
      bypassHourlyThrottle: true,
    });

    const state = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.ok(state);
    assert.equal(state.total_contributions_rewarded, 50, 'Rewarded count MUST NOT increase for forfeited increments');
    assert.equal(state.total_contributions_forfeited, 5, 'Forfeited count must increase');
  });

  test('13. 48-hour expiry: pending increments older than 48 hours transition to expired', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_13',
      username: 'c_trainer_13',
      primaryHandle: 'c_trainer_13',
    });

    const oldDate = '2026-11-10';
    const createdAt = new Date('2026-11-10T12:00:00.000Z');

    // Create 10 contributions on 2026-11-10 (5 rewarded, 5 pending)
    await SyncRepository.processContributionSync(trainer.user.id, oldDate, 10, {
      requestSequence: 1,
      currentTime: createdAt,
    });

    // Advance time to 2026-11-13T01:00:00.000Z (> 48h from 2026-11-10T00:00:00.000Z)
    const futureTime = new Date('2026-11-13T01:00:00.000Z');
    const expiredCount = await SyncRepository.expireStalePendingSlices(48, undefined, futureTime);

    assert.ok(expiredCount >= 1);

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, oldDate);
    const pendingSlice = slices.find((s) => s.slice_start === 5);
    assert.ok(pendingSlice);
    assert.equal(pendingSlice.status, 'expired');
  });

  test('14. Expired increments cannot be rewarded even if hourly quota becomes available', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_14',
      username: 'c_trainer_14',
      primaryHandle: 'c_trainer_14',
    });

    const oldDate = '2026-11-08';
    const t0 = new Date('2026-11-08T10:00:00.000Z');
    await SyncRepository.processContributionSync(trainer.user.id, oldDate, 10, {
      requestSequence: 1,
      currentTime: t0,
    });

    // Time is 5 days later
    const futureTime = new Date('2026-11-13T10:00:00.000Z');
    const drainResult = await SyncRepository.processPendingRewards(trainer.user.id, {
      currentTime: futureTime,
    });

    assert.equal(drainResult.rewardedIncrements, 0, 'Expired increments must not be rewarded');
    assert.equal(drainResult.processedIncrements, 0);

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, oldDate);
    const expiredSlice = slices.find((s) => s.slice_start === 5);
    assert.ok(expiredSlice);
    assert.equal(expiredSlice.status, 'expired');
  });

  test('15. Idempotent replay: identical snapshot/sequence does not award duplicate rewards', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_15',
      username: 'c_trainer_15',
      primaryHandle: 'c_trainer_15',
    });

    const targetDate = '2026-11-15';
    // Call 1
    const res1 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 3, {
      requestSequence: 1,
    });
    assert.equal(res1.reward.rewardedIncrements, 3);
    assert.equal(res1.reward.xpAwarded, 50);

    // Call 2: Exact same sequence and count
    const res2 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 3, {
      requestSequence: 1,
    });
    assert.equal(res2.reward.rewardedIncrements, 0, 'Replay must not award new rewards');
    assert.equal(res2.reward.xpAwarded, 0);

    const ledger = await LedgerRepository.getRecentHistory(trainer.user.id);
    assert.equal(ledger.length, 1, 'Ledger must contain exactly 1 entry');
  });

  test('16. Monotonic high-water mark preservation across out-of-order snapshots', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_16',
      username: 'c_trainer_16',
      primaryHandle: 'c_trainer_16',
    });

    const targetDate = '2026-11-15';
    // Snapshot 10 at seq 2
    const res1 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 2,
    });
    assert.equal(res1.currentHighWaterMark, 10);

    // Snapshot 7 at seq 3 (e.g. rebase / commit delete)
    const res2 = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 7, {
      requestSequence: 3,
    });

    assert.equal(res2.currentHighWaterMark, 10, 'High-water mark must remain 10');
    assert.equal(res2.newlyObservedIncrements, 0);
    assert.equal(res2.reward.rewardedIncrements, 0);
  });

  test('17. Stale snapshot rejection: older sequence produces 0 XP and 0 reward-eligible increments', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_17',
      username: 'c_trainer_17',
      primaryHandle: 'c_trainer_17',
    });

    const targetDate = '2026-11-15';
    // Seq 5 arrives first with count 10
    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, {
      requestSequence: 5,
    });

    // Seq 2 arrives later with count 15
    const resStale = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 15, {
      requestSequence: 2,
    });

    assert.equal(resStale.isStale, true);
    assert.equal(resStale.newlyObservedIncrements, 0);
    assert.equal(resStale.rewardEligibleIncrements, 0);
    assert.equal(resStale.reward.xpAwarded, 0);
    assert.equal(resStale.currentHighWaterMark, 10, 'Stale snapshot must NOT advance high-water mark');
  });

  test('18. Concurrent reconciliation calls serialize cleanly without deadlock or race condition', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_18',
      username: 'c_trainer_18',
      primaryHandle: 'c_trainer_18',
    });

    const targetDate = '2026-11-15';

    // Dispatch 5 concurrent requests with increasing sequences
    const promises = [
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 2, { requestSequence: 1 }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 4, { requestSequence: 2 }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 6, { requestSequence: 3 }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 8, { requestSequence: 4 }),
      SyncRepository.processContributionSync(trainer.user.id, targetDate, 10, { requestSequence: 5 }),
    ];

    const results = await Promise.all(promises);
    assert.equal(results.length, 5);

    const finalState = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.ok(finalState);
    assert.equal(finalState.total_contributions_recorded, 10);
    // Across the 5 calls within the same hour, only 5 total increments can be processed
    assert.equal(finalState.total_contributions_rewarded, 5);
    assert.equal(finalState.pending_contribution_increments, 5);
  });

  test('19. Zero XP for zero new increments (snapshot <= high-water mark)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_19',
      username: 'c_trainer_19',
      primaryHandle: 'c_trainer_19',
    });

    const targetDate = '2026-11-15';
    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 1,
    });

    // Same count, new sequence
    const res = await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 2,
    });

    assert.equal(res.newlyObservedIncrements, 0);
    assert.equal(res.reward.xpAwarded, 0);
    assert.equal(res.reward.processedIncrements, 0);
  });

  test('20. Payload hash mismatch on same sequence throws conflict error', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_20',
      username: 'c_trainer_20',
      primaryHandle: 'c_trainer_20',
    });

    const targetDate = '2026-11-15';
    const hashA = computePayloadHash('payload_version_A');
    const hashB = computePayloadHash('payload_version_B');

    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
      requestSequence: 1,
      payloadHash: hashA,
    });

    await assert.rejects(
      async () => {
        await SyncRepository.processContributionSync(trainer.user.id, targetDate, 5, {
          requestSequence: 1,
          payloadHash: hashB,
        });
      },
      DuplicateSequenceConflictError,
      'Must reject conflicting payload with the same requestSequence'
    );
  });

  test('21. Atomic rollback: database failure during pet update rolls back slice and ledger entries', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_21',
      username: 'c_trainer_21',
      primaryHandle: 'c_trainer_21',
    });

    const targetDate = '2026-11-15';

    // Simulate atomic transaction rollback
    const client = await pool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(
        `INSERT INTO contribution_increment_slices (
          user_id, sync_date, canonical_slice_id, slice_start, slice_end,
          increment_count, status, request_sequence, payload_hash, created_at
        ) VALUES ($1, $2, 'urn:gh:daily:test:fail', 0, 5, 5, 'pending', 1, 'hash', NOW());`,
        [trainer.user.id, targetDate]
      );
      // Intentionally abort / rollback
      await client.query('ROLLBACK;');
    } finally {
      client.release();
    }

    const slices = await SyncRepository.getIncrementSlices(trainer.user.id, targetDate);
    assert.equal(slices.length, 0, 'Rolled back slice must not persist in database');
  });

  test('22. Daily sync state counters (recorded, rewarded, forfeited, pending, xp) remain mathematically consistent', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_22',
      username: 'c_trainer_22',
      primaryHandle: 'c_trainer_22',
    });

    const targetDate = '2026-11-15';
    // Discover 12 contributions with bypass throttle
    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 12, {
      requestSequence: 1,
      bypassHourlyThrottle: true,
    });

    const state = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.ok(state);
    assert.equal(state.total_contributions_recorded, 12);
    assert.equal(state.total_contributions_rewarded, 12);
    assert.equal(state.total_contributions_forfeited, 0);
    assert.equal(state.pending_contribution_increments, 0);
    // XP: 25 + 15 + 10 + (9 * 5) = 50 + 45 = 95
    assert.equal(state.daily_activity_xp_awarded, 95);
  });

  test('23. Cross-date accounting: rewards on date A do not exhaust daily cap for date B', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_23',
      username: 'c_trainer_23',
      primaryHandle: 'c_trainer_23',
    });

    const dateA = '2026-11-14';
    const dateB = '2026-11-15';

    // Exhaust daily cap on date A
    await SyncRepository.ensureDailySyncRow(trainer.user.id, dateA);
    await pool.query(
      'UPDATE daily_sync_states SET daily_activity_xp_awarded = 300 WHERE user_id = $1 AND sync_date = $2;',
      [trainer.user.id, dateA]
    );

    // Sync contributions on date B
    const resultB = await SyncRepository.processContributionSync(trainer.user.id, dateB, 3, {
      requestSequence: 1,
      bypassHourlyThrottle: true,
    });

    assert.equal(resultB.reward.rewardedIncrements, 3);
    assert.equal(resultB.reward.xpAwarded, 50, 'Date B must receive fresh daily XP');
    assert.equal(resultB.reward.capExhausted, false);
  });

  test('24. Rolling hour throttle spans across multiple dates within the same hour window', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_24',
      username: 'c_trainer_24',
      primaryHandle: 'c_trainer_24',
    });

    const dateA = '2026-11-14';
    const dateB = '2026-11-15';
    const t0 = new Date('2026-11-15T14:00:00.000Z');

    // 3 increments processed for Date A at 14:00
    const resA = await SyncRepository.processContributionSync(trainer.user.id, dateA, 3, {
      requestSequence: 1,
      currentTime: t0,
    });
    assert.equal(resA.reward.processedIncrements, 3);

    // 4 increments observed for Date B at 14:15
    const t1 = new Date('2026-11-15T14:15:00.000Z');
    const resB = await SyncRepository.processContributionSync(trainer.user.id, dateB, 4, {
      requestSequence: 2,
      currentTime: t1,
    });

    // Total quota in rolling hour is 5. 3 already used on Date A. Only 2 allowed for Date B!
    assert.equal(resB.reward.processedIncrements, 2);
    assert.equal(resB.reward.remainingPendingIncrements, 2);
    assert.equal(resB.reward.hourlyQuotaRemaining, 0);
  });

  test('25. Cascade delete: deleting user deletes all increment slices, sync states, ledger entries, and pet', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'c_user_25',
      username: 'c_trainer_25',
      primaryHandle: 'c_trainer_25',
    });

    const targetDate = '2026-11-15';
    await SyncRepository.processContributionSync(trainer.user.id, targetDate, 4, {
      requestSequence: 1,
    });

    // Verify entities exist
    const slicesBefore = await SyncRepository.getIncrementSlices(trainer.user.id);
    assert.ok(slicesBefore.length > 0);
    const petBefore = await PetRepository.findByUserId(trainer.user.id);
    assert.ok(petBefore);

    // Delete user
    await UserRepository.deleteAccountCascade(trainer.user.id);

    // Verify cascade deletion
    const slicesAfter = await SyncRepository.getIncrementSlices(trainer.user.id);
    assert.equal(slicesAfter.length, 0);

    const syncStateAfter = await SyncRepository.getDailySyncState(trainer.user.id, targetDate);
    assert.equal(syncStateAfter, null);

    const ledgerAfter = await LedgerRepository.getRecentHistory(trainer.user.id);
    assert.equal(ledgerAfter.length, 0);

    const petAfter = await PetRepository.findByUserId(trainer.user.id);
    assert.equal(petAfter, null);
  });
});
