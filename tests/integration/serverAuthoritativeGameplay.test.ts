// tests/integration/serverAuthoritativeGameplay.test.ts
// Comprehensive integration test suite for Server-Authoritative Gameplay (Sprint 2.2)

import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import { getPool, closePool, checkDatabaseHealth, maskConnectionString } from '../../src/lib/db/pool.ts';
import { migrateUp, migrateDown } from '../../src/lib/db/migrator.ts';
import { UserRepository } from '../../src/lib/db/repositories/userRepository.ts';
import { GameplayService } from '../../src/lib/gameplay/gameplayService.ts';
import { POST as handleActionRoute } from '../../src/app/api/pet/action/route.ts';

const require = createRequire(import.meta.url);

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://test_user:test_password@localhost:5432/github_profile_pet_test';

process.env.DATABASE_URL = TEST_DB_URL;

interface IEmbeddedPostgres {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  createDatabase(name: string): Promise<void>;
}

describe('Server-Authoritative Gameplay Integration Suite', () => {
  let isDbAvailable = false;
  let pool: Pool;
  let embeddedInstance: IEmbeddedPostgres | null = null;

  before(async () => {
    let health = await checkDatabaseHealth();

    if (!health.ok) {
      console.log('\n[Gameplay Tests] No active database on 5432. Starting local PostgreSQL 16...');
      try {
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
          // Already exists
        }
        health = await checkDatabaseHealth();
      } catch (err) {
        console.warn('[Gameplay Tests] Failed to boot embedded PostgreSQL:', (err as Error).message);
      }
    }

    isDbAvailable = health.ok;
    if (!isDbAvailable) {
      console.warn('[Gameplay Tests BLOCKED / SKIPPED]: No database available at ' + maskConnectionString(TEST_DB_URL));
      return;
    }

    pool = getPool();
    // Ensure all migrations up to 002 are applied
    await migrateUp();

    // Clean disposable test tables before running gameplay suite
    await pool.query(`
      TRUNCATE TABLE user_sessions, care_action_idempotency, activity_reward_ledger, daily_sync_states,
                     pet_states, user_profiles, users, github_accounts CASCADE;
    `);
  });

  after(async () => {
    if (isDbAvailable) {
      await closePool();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (embeddedInstance) {
      console.log('[Gameplay Tests Cleanup] Stopping local PostgreSQL 16...');
      await embeddedInstance.stop();
    }
  });

  test('1. Migration 002 up and down lifecycle for response_payload', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    // Rollback migrations until migration 002 is reverted
    let lastReverted: string | null = null;
    while (true) {
      const down = await migrateDown();
      lastReverted = down.reverted;
      if (!down.reverted || down.reverted === '002_care_action_payload.sql') break;
    }
    assert.equal(lastReverted, '002_care_action_payload.sql');

    // Verify column was dropped
    const columnCheck1 = await pool.query(
      `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'care_action_idempotency' AND column_name = 'response_payload';`
    );
    assert.equal(columnCheck1.rows.length, 0, 'response_payload column should be absent after rollback');

    // Migrate up
    const upResult = await migrateUp();
    assert.ok(upResult.applied.includes('002_care_action_payload.sql'), 'Migration 002 should re-apply');

    // Verify column exists
    const columnCheck2 = await pool.query(
      `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'care_action_idempotency' AND column_name = 'response_payload';`
    );
    assert.equal(columnCheck2.rows.length, 1, 'response_payload column should be present');
  });

  test('2. Successful Train, Feed, and Rest actions with authoritative state mutations', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_basic',
      username: 'gameplay_basic_trainer',
      primaryHandle: 'gameplay_basic_trainer',
    });
    const userId = trainer.user.id;

    // Initial Pet State: energy = 80, hunger = 60, happiness = 70, xp = 0, level = 1
    // Action 1: TRAIN
    const trainResult = await GameplayService.handleAction({
      userId,
      action: 'train',
      clientActionId: 'train-act-1',
      nowMs: 1000,
    });

    assert.equal(trainResult.success, true);
    if (trainResult.success) {
      assert.equal(trainResult.action, 'train');
      assert.equal(trainResult.reward.expGained, 30);
      assert.equal(trainResult.reward.energyCost, 18);
      assert.equal(trainResult.pet.energy, 80 - 18); // 62
      assert.equal(trainResult.pet.xp, 30);
      assert.equal(trainResult.pet.level, 1);
    }

    // Action 2: FEED (executed 1000ms later to clear cooldown)
    const feedResult = await GameplayService.handleAction({
      userId,
      action: 'feed',
      clientActionId: 'feed-act-1',
      nowMs: 2000,
    });

    assert.equal(feedResult.success, true);
    if (feedResult.success) {
      assert.equal(feedResult.action, 'feed');
      assert.equal(feedResult.reward.expGained, 10);
      assert.equal(feedResult.reward.hungerGained, 24);
      assert.equal(feedResult.pet.hunger, 60 + 24); // 84
      assert.equal(feedResult.pet.xp, 30 + 10); // 40
    }

    // Action 3: REST (strictly 0 XP, restores energy by 25)
    const restResult = await GameplayService.handleAction({
      userId,
      action: 'rest',
      clientActionId: 'rest-act-1',
      nowMs: 3000,
    });

    assert.equal(restResult.success, true);
    if (restResult.success) {
      assert.equal(restResult.action, 'rest');
      assert.equal(restResult.reward.expGained, 0); // Rest grants 0 XP
      assert.equal(restResult.pet.energy, Math.min(100, 62 + 25)); // 87
      assert.equal(restResult.pet.xp, 40); // XP unchanged
    }

    // Verify database state matches
    const persistedPet = await GameplayService.getPetState(userId);
    assert.ok(persistedPet);
    assert.equal(persistedPet.energy, 87);
    assert.equal(persistedPet.hunger, 84);
    assert.equal(persistedPet.xp, 40);
  });

  test('3. Pre-condition validations: Insufficient energy and full satiety', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_precond',
      username: 'gameplay_precond',
      primaryHandle: 'gameplay_precond',
    });
    const userId = trainer.user.id;

    // Deplete pet energy to 10 (< 18)
    await pool.query('UPDATE pet_states SET energy = 10, hunger = 100 WHERE user_id = $1;', [userId]);

    // Attempt Train with insufficient energy
    const trainReject = await GameplayService.handleAction({
      userId,
      action: 'train',
      clientActionId: 'train-low-energy',
      nowMs: 1000,
    });

    assert.equal(trainReject.success, false);
    if (!trainReject.success) {
      assert.match(trainReject.rejectedReason, /Insufficient Energy/);
    }

    // Attempt Feed with full satiety (100)
    const feedReject = await GameplayService.handleAction({
      userId,
      action: 'feed',
      clientActionId: 'feed-full-satiety',
      nowMs: 2000,
    });

    assert.equal(feedReject.success, false);
    if (!feedReject.success) {
      assert.match(feedReject.rejectedReason, /Satiety Full/);
    }

    // Verify pet state was NOT partially mutated
    const petCheck = await GameplayService.getPetState(userId);
    assert.equal(petCheck?.energy, 10, 'Energy must remain 10');
    assert.equal(petCheck?.hunger, 100, 'Hunger must remain 100');
    assert.equal(petCheck?.xp, 0, 'XP must remain 0');
  });

  test('4. Server-side cooldown enforcement (800ms debounce)', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_cooldown',
      username: 'gameplay_cooldown',
      primaryHandle: 'gameplay_cooldown',
    });
    const userId = trainer.user.id;

    // Action 1 at T = 1000ms
    const act1 = await GameplayService.handleAction({
      userId,
      action: 'pet',
      clientActionId: 'pet-cd-1',
      nowMs: 1000,
    });
    assert.equal(act1.success, true);

    // Action 2 at T = 1200ms (200ms elapsed, 600ms remaining on cooldown)
    const act2 = await GameplayService.handleAction({
      userId,
      action: 'pet',
      clientActionId: 'pet-cd-2',
      nowMs: 1200,
    });

    assert.equal(act2.success, false, 'Action dispatched within 800ms must be rejected');
    if (!act2.success) {
      assert.match(act2.rejectedReason, /Action Cooldown/);
      assert.equal(act2.cooldownRemainingMs, 600);
    }

    // Action 3 at T = 1850ms (850ms elapsed, cooldown expired)
    const act3 = await GameplayService.handleAction({
      userId,
      action: 'pet',
      clientActionId: 'pet-cd-3',
      nowMs: 1850,
    });
    assert.equal(act3.success, true, 'Action after cooldown must succeed');
  });

  test('5. Server-side diminishing returns in 60s rolling window', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_diminish',
      username: 'gameplay_diminish',
      primaryHandle: 'gameplay_diminish',
    });
    const userId = trainer.user.id;
    // Set plenty of energy for multiple trains
    await pool.query('UPDATE pet_states SET energy = 100 WHERE user_id = $1;', [userId]);

    // Dispatch 5 consecutive Pet actions spaced 1000ms apart (within 60s window)
    // Multipliers: 1.0 -> 0.6 -> 0.35 -> 0.2 -> 0.1
    // Base Pet EXP = 6
    const expectedExp = [
      Math.round(6 * 1.0),  // 6
      Math.round(6 * 0.6),  // 4
      Math.round(6 * 0.35), // 2
      Math.round(6 * 0.2),  // 1
      Math.round(6 * 0.1),  // 1
    ];

    for (let i = 0; i < 5; i++) {
      const res = await GameplayService.handleAction({
        userId,
        action: 'pet',
        clientActionId: `diminish-pet-${i}`,
        nowMs: 1000 + i * 1000,
      });

      assert.equal(res.success, true);
      if (res.success) {
        assert.equal(res.reward.expGained, expectedExp[i], `Step ${i} XP should match diminishing curve`);
        assert.equal(res.reward.consecutiveCount, i + 1);
      }
    }
  });

  test('6. Level progression, XP overflow, and evolution boundaries', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_evolution',
      username: 'gameplay_evolution',
      primaryHandle: 'gameplay_evolution',
    });
    const userId = trainer.user.id;

    // Set pet to Level 9, 90 XP (MaxXP = 900)
    await pool.query(
      `UPDATE pet_states SET
        level = 9, xp = 880, max_exp = 900, evolution_stage = 'Hatchling', energy = 100
      WHERE user_id = $1;`,
      [userId]
    );

    // Train grants 30 XP: 880 + 30 = 910 >= 900.
    // Level up to Level 10, overflow XP = 10, maxExp = 1000.
    // Evolution boundary: Level 10 reaches 'Juvenile'!
    const trainResult = await GameplayService.handleAction({
      userId,
      action: 'train',
      clientActionId: 'train-evolution-lvl10',
      nowMs: 1000,
    });

    assert.equal(trainResult.success, true);
    if (trainResult.success) {
      assert.equal(trainResult.didLevelUp, true);
      assert.equal(trainResult.pet.level, 10);
      assert.equal(trainResult.pet.xp, 10);
      assert.equal(trainResult.pet.maxExp, 1000);
      assert.equal(trainResult.pet.evolutionStage, 'Juvenile');
    }
  });

  test('7. Duplicate action retries return identical original result idempotently', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_idemp',
      username: 'gameplay_idemp',
      primaryHandle: 'gameplay_idemp',
    });
    const userId = trainer.user.id;
    const clientActionId = 'idempotent-train-action-uuid';

    // First Execution
    const firstRun = await GameplayService.handleAction({
      userId,
      action: 'train',
      clientActionId,
      nowMs: 1000,
    });

    assert.equal(firstRun.success, true);
    assert.equal(firstRun.isRetry, false);
    const initialEnergy = firstRun.success ? firstRun.pet.energy : 0;
    const initialXp = firstRun.success ? firstRun.pet.xp : 0;

    // Retry with SAME clientActionId
    const retryRun = await GameplayService.handleAction({
      userId,
      action: 'train',
      clientActionId,
      nowMs: 1050, // Even within cooldown window, idempotency takes precedence!
    });

    assert.equal(retryRun.success, true);
    assert.equal(retryRun.isRetry, true, 'Retry must report isRetry = true');
    if (retryRun.success) {
      assert.equal(retryRun.pet.energy, initialEnergy, 'Energy must match original response');
      assert.equal(retryRun.pet.xp, initialXp, 'XP must match original response');
      assert.equal(retryRun.clientActionId, clientActionId);
    }

    // Verify ledger has strictly ONE entry
    const ledgerRows = await pool.query(
      'SELECT * FROM activity_reward_ledger WHERE user_id = $1;',
      [userId]
    );
    assert.equal(ledgerRows.rows.length, 1, 'Only one ledger entry must exist for retried action');
  });

  test('8. Concurrent duplicate requests do not double-award or modify state twice', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_conc_dup',
      username: 'gameplay_conc_dup',
      primaryHandle: 'gameplay_conc_dup',
    });
    const userId = trainer.user.id;
    const sharedClientActionId = 'concurrent-dup-action-id';

    // Fire 5 identical requests concurrently
    const promises = Array.from({ length: 5 }, () =>
      GameplayService.handleAction({
        userId,
        action: 'train',
        clientActionId: sharedClientActionId,
        nowMs: 1000,
      })
    );

    const results = await Promise.all(promises);

    // All 5 must succeed without error
    for (const res of results) {
      assert.equal(res.success, true);
    }

    // Exactly one should be isRetry = false; the other 4 should be isRetry = true
    const originalCount = results.filter((r) => r.success && !r.isRetry).length;
    const retryCount = results.filter((r) => r.success && r.isRetry).length;

    assert.equal(originalCount, 1, 'Exactly one execution should be the original');
    assert.equal(retryCount, 4, 'The other 4 concurrent requests must be resolved as retries');

    // Pet state must have energy deducted strictly ONCE (80 - 18 = 62)
    const pet = await GameplayService.getPetState(userId);
    assert.equal(pet?.energy, 62, 'Energy must be deducted exactly once');
    assert.equal(pet?.xp, 30, 'XP must be awarded exactly once');
  });

  test('9. Concurrent distinct actions serialize cleanly without overwriting', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_gameplay_conc_distinct',
      username: 'gameplay_conc_distinct',
      primaryHandle: 'gameplay_conc_distinct',
    });
    const userId = trainer.user.id;

    // Fire Train and Feed with different action IDs at different timestamps to clear cooldown
    // Notice: SELECT FOR UPDATE on pet_states serializes the two transactions
    const p1 = GameplayService.handleAction({
      userId,
      action: 'train',
      clientActionId: 'conc-distinct-train',
      nowMs: 1000,
    });

    const p2 = GameplayService.handleAction({
      userId,
      action: 'feed',
      clientActionId: 'conc-distinct-feed',
      nowMs: 2000,
    });

    const [res1, res2] = await Promise.all([p1, p2]);
    assert.equal(res1.success, true);
    assert.equal(res2.success, true);

    const pet = await GameplayService.getPetState(userId);
    // Initial: energy 80, hunger 60, xp 0
    // Train: -18 energy (62), +30 xp (30)
    // Feed: +24 hunger (84), +10 xp (40)
    assert.equal(pet?.energy, 62);
    assert.equal(pet?.hunger, 84);
    assert.equal(pet?.xp, 40);
  });

  test('10. User ownership isolation: User A cannot affect User B', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainerA = await UserRepository.createTrainer({
      githubUserId: 'gh_iso_user_a',
      username: 'iso_user_a',
      primaryHandle: 'iso_user_a',
    });

    const trainerB = await UserRepository.createTrainer({
      githubUserId: 'gh_iso_user_b',
      username: 'iso_user_b',
      primaryHandle: 'iso_user_b',
    });

    const sharedActionId = 'cross-user-shared-uuid';

    // User A acts with sharedActionId
    const resA = await GameplayService.handleAction({
      userId: trainerA.user.id,
      action: 'train',
      clientActionId: sharedActionId,
      nowMs: 1000,
    });
    assert.equal(resA.success, true);

    // User B acts with SAME sharedActionId
    const resB = await GameplayService.handleAction({
      userId: trainerB.user.id,
      action: 'train',
      clientActionId: sharedActionId,
      nowMs: 1000,
    });
    assert.equal(resB.success, true);
    assert.equal(resB.isRetry, false, 'User B using same clientActionId must not be flagged as retry of User A');

    // Both pets independently updated
    const petA = await GameplayService.getPetState(trainerA.user.id);
    const petB = await GameplayService.getPetState(trainerB.user.id);

    assert.equal(petA?.energy, 62);
    assert.equal(petB?.energy, 62);
  });

  test('11. API Route /api/pet/action HTTP contract verification', async (t) => {
    if (!isDbAvailable) {
      t.skip('Skipped: Database unavailable');
      return;
    }

    const trainer = await UserRepository.createTrainer({
      githubUserId: 'gh_route_tester',
      username: 'route_tester',
      primaryHandle: 'route_tester',
    });

    // 1. Unauthenticated Request -> 401
    const unauthReq = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pet', clientActionId: 'route-unauth' }),
    });
    const unauthRes = await handleActionRoute(unauthReq);
    assert.equal(unauthRes.status, 401);

    // 2. Invalid Payload -> 400
    const invalidReq = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-trainer-handle': trainer.user.primary_handle,
      },
      body: JSON.stringify({ action: 'dance', clientActionId: 'route-bad-action' }),
    });
    const invalidRes = await handleActionRoute(invalidReq);
    assert.equal(invalidRes.status, 400);

    // 3. Valid Authenticated Request -> 200
    const validReq = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-trainer-handle': trainer.user.primary_handle,
      },
      body: JSON.stringify({ action: 'pet', clientActionId: 'route-valid-pet-1' }),
    });
    const validRes = await handleActionRoute(validReq);
    assert.equal(validRes.status, 200);

    const validJson = await validRes.json();
    assert.equal(validJson.success, true);
    assert.equal(validJson.action, 'pet');
    assert.equal(validJson.reward.expGained, 6);

    // 4. Immediate Second Request (within 800ms) -> 429
    const fastReq = new Request('http://localhost:3000/api/pet/action', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-trainer-handle': trainer.user.primary_handle,
      },
      body: JSON.stringify({ action: 'pet', clientActionId: 'route-fast-pet-2' }),
    });
    const fastRes = await handleActionRoute(fastReq);
    assert.equal(fastRes.status, 429);
    const fastJson = await fastRes.json();
    assert.equal(fastJson.error, 'ACTION_COOLDOWN');
  });
});
