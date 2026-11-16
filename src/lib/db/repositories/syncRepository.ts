// src/lib/db/repositories/syncRepository.ts
// Atomic Daily Contribution Synchronization Primitives & Concurrency Locking

import { createHash } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '../pool.ts';
import { withTransaction } from '../transaction.ts';
import type { DailySyncStateRow, PetStateRow, ContributionIncrementSliceRow } from '../types.ts';
import { LedgerRepository } from './ledgerRepository.ts';
import { PetRepository } from './petRepository.ts';
import type { ExperienceResult } from './petRepository.ts';

export class DuplicateSequenceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateSequenceConflictError';
  }
}

export interface SyncBatchResult {
  syncState: DailySyncStateRow;
  observedSnapshot: number;
  newlyObservedIncrements: number;
  processedIncrements: number;
  rewardedIncrements: number;
  forfeitedIncrements: number;
  remainingPendingIncrements: number;
  xpAwarded: number;
  dailyXpTotal: number;
  capExhausted: boolean;
  ledgerEntryCreated: boolean;
  canonicalActivityId: string | null;
  experienceResult: ExperienceResult | null;
}

export interface DailyReconciliationResult {
  userId: string;
  utcDate: string; // YYYY-MM-DD
  latestObservedContributions: number;
  latestObservedAt?: Date | null;
  latestRequestSequence: number;
  previousHighWaterMark: number;
  currentHighWaterMark: number;
  newlyObservedIncrements: number; // Raw mathematical increment
  rewardEligibleIncrements: number; // Guaranteed 0 if snapshot is stale
  isStale: boolean;
  reconciledAt: Date;
}

export interface DailyReconciliationOptions {
  observedAt?: Date | string | null;
  requestSequence?: number | null;
  existingClient?: PoolClient;
}

export interface SyncSnapshotOptions {
  currentTime?: Date;
  bypassHourlyThrottle?: boolean;
}

export interface PetProgressionSummary {
  previousLevel: number;
  newLevel: number;
  currentXp: number;
  maxExp: number;
  evolutionStage: string;
  leveledUp: boolean;
  hunger: number;
}

export interface ContributionRewardResult {
  processedIncrements: number;
  rewardedIncrements: number;
  forfeitedIncrements: number;
  remainingPendingIncrements: number;
  xpAwarded: number;
  satietyAwarded: number;
  dailyXpTotal: number;
  capExhausted: boolean;
  hourlyQuotaRemaining: number;
  canonicalSliceIds: string[];
  petProgression: PetProgressionSummary | null;
}

export interface ProcessContributionSyncOptions {
  observedAt?: Date | string | null;
  requestSequence?: number | null;
  payloadHash?: string | null;
  currentTime?: Date;
  bypassHourlyThrottle?: boolean;
  existingClient?: PoolClient;
}

export interface DailyContributionSyncResult extends DailyReconciliationResult {
  reward: ContributionRewardResult;
}

/**
 * Normalizes any Date or string to a canonical UTC YYYY-MM-DD string.
 */
function normalizeDateStr(val: Date | string): string {
  if (typeof val === 'string') return val.slice(0, 10);
  const year = val.getFullYear();
  const month = String(val.getMonth() + 1).padStart(2, '0');
  const day = String(val.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates diminishing XP for a contribution increment based on ordinal.
 * Ordinal 1: 25 XP
 * Ordinal 2: 15 XP
 * Ordinal 3: 10 XP
 * Ordinal 4+: 5 XP
 */
export function calculateIncrementXp(ordinal: number): number {
  if (ordinal === 1) return 25;
  if (ordinal === 2) return 15;
  if (ordinal === 3) return 10;
  return 5;
}

/**
 * Calculates diminishing Satiety for a contribution increment based on ordinal.
 * Ordinal 1: 10 Satiety
 * Ordinal 2: 5 Satiety
 * Ordinal 3: 2 Satiety
 * Ordinal 4+: 1 Satiety
 */
export function calculateIncrementSatiety(ordinal: number): number {
  if (ordinal === 1) return 10;
  if (ordinal === 2) return 5;
  if (ordinal === 3) return 2;
  return 1;
}

/**
 * Computes a SHA-256 hash of a payload object or string.
 */
export function computePayloadHash(payload: unknown): string {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHash('sha256').update(str).digest('hex');
}

export class SyncRepository {
  /**
   * Idempotently initializes a daily sync row for a given user and UTC date.
   */
  public static async ensureDailySyncRow(
    userId: string,
    syncDateIso: string,
    client?: PoolClient
  ): Promise<DailySyncStateRow> {
    const db = client || getPool();

    await db.query(
      `INSERT INTO daily_sync_states (
        user_id, sync_date, total_contributions_recorded, latest_observed_contributions,
        total_contributions_rewarded, total_contributions_forfeited,
        pending_contribution_increments, daily_activity_xp_awarded,
        hourly_increments_processed
      ) VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0)
      ON CONFLICT (user_id, sync_date) DO NOTHING;`,
      [userId, syncDateIso]
    );

    const res = await db.query<DailySyncStateRow>(
      'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2;',
      [userId, syncDateIso]
    );

    return res.rows[0];
  }

  /**
   * Retrieves the current daily sync state for a user and date.
   */
  public static async getDailySyncState(
    userId: string,
    syncDateIso: string,
    client?: PoolClient
  ): Promise<DailySyncStateRow | null> {
    const db = client || getPool();

    const res = await db.query<DailySyncStateRow>(
      'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2;',
      [userId, syncDateIso]
    );

    return res.rows[0] || null;
  }

  /**
   * Executes atomic contribution reward accounting against a supplied external snapshot.
   *
   * Invariant: The external GitHub API call must be executed BEFORE entering this transaction.
   * Lock hold time is bounded to < 5ms.
   *
   * Primitives Enforced:
   * 1. Idempotent initialization of daily sync row.
   * 2. SELECT ... FOR UPDATE row-level locking.
   * 3. Monotonic high-water mark protection (rebase drops never decrement recorded).
   * 4. Durable pending increment queuing.
   * 5. 5-increment maximum processing limit per batch.
   * 6. Daily 300 XP cap enforcement with proper increment forfeiture on cap exhaustion.
   * 7. Deterministic ledger insertion with UNIQUE (user_id, canonical_activity_id).
   * 8. Atomic pet experience and sync state mutation.
   */
  public static async processContributionSnapshot(
    userId: string,
    syncDateIso: string,
    observedSnapshot: number,
    existingClient?: PoolClient,
    options?: SyncSnapshotOptions
  ): Promise<SyncBatchResult> {
    return withTransaction(async (tx) => {
      // 1. Idempotently ensure the row exists so SELECT FOR UPDATE acquires a lock
      await tx.query(
        `INSERT INTO daily_sync_states (
          user_id, sync_date, total_contributions_recorded, latest_observed_contributions,
          total_contributions_rewarded, total_contributions_forfeited,
          pending_contribution_increments, daily_activity_xp_awarded,
          hourly_increments_processed
        ) VALUES ($1, $2, 0, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (user_id, sync_date) DO NOTHING;`,
        [userId, syncDateIso]
      );

      // 2. Acquire exclusive row lock
      const lockRes = await tx.query<DailySyncStateRow>(
        'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;',
        [userId, syncDateIso]
      );
      const state = lockRes.rows[0];

      // 3. High-water mark calculation
      const safeSnapshot = Math.max(0, observedSnapshot);
      const newlyObserved = Math.max(0, safeSnapshot - state.total_contributions_recorded);
      const newRecorded = Math.max(state.total_contributions_recorded, safeSnapshot);

      // 4. Update pending increments queue
      const totalPending = state.pending_contribution_increments + newlyObserved;

      // 5. Hourly window and throttling evaluation
      const now = options?.currentTime || new Date();
      const windowStart = new Date(state.hourly_window_start);
      const oneHourMs = 3600_000;
      const isWindowExpired = (now.getTime() - windowStart.getTime()) >= oneHourMs;

      const currentHourlyProcessed = isWindowExpired ? 0 : state.hourly_increments_processed;
      const currentWindowStart = isWindowExpired ? now : windowStart;

      const hourlyQuotaRemaining = options?.bypassHourlyThrottle
        ? 5
        : Math.max(0, 5 - currentHourlyProcessed);

      // Batch limit is bounded by pending, batch size (5), and hourly remaining quota
      const batchCount = Math.min(5, hourlyQuotaRemaining, totalPending);

      let rewardedCount = 0;
      let forfeitedCount = 0;
      let xpAwarded = 0;
      let ledgerEntryCreated = false;
      let canonicalActivityId: string | null = null;
      let expResult: ExperienceResult | null = null;

      if (batchCount > 0) {
        const availableBudget = Math.max(0, 300 - state.daily_activity_xp_awarded);
        let runningXp = 0;

        for (let i = 1; i <= batchCount; i++) {
          const ordinal = state.total_contributions_rewarded + rewardedCount + 1;
          const incXp = calculateIncrementXp(ordinal);

          if (runningXp + incXp <= availableBudget) {
            rewardedCount += 1;
            runningXp += incXp;
          } else {
            // Cap exhausted: zero-XP increment is classified as forfeited
            forfeitedCount += 1;
          }
        }

        xpAwarded = runningXp;

        // 6. Deterministic Canonical Activity Identity & Ledger Appending
        if (rewardedCount > 0) {
          const newRewarded = state.total_contributions_rewarded + rewardedCount;
          canonicalActivityId = `urn:gh:daily:${userId}:${syncDateIso}:slice:${state.total_contributions_rewarded}-${newRewarded}`;

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId,
              activityType: 'github_activity',
              xpAwarded,
              satietyAwarded: 0,
              ruleVersion: 1,
            },
            tx
          );
          ledgerEntryCreated = true;

          // 7. Atomic Pet State Experience Update
          expResult = await PetRepository.applyExperience(userId, xpAwarded, tx);
        } else if (forfeitedCount > 0) {
          const newForfeited = state.total_contributions_forfeited + forfeitedCount;
          canonicalActivityId = `urn:gh:daily:${userId}:${syncDateIso}:forfeited:${state.total_contributions_forfeited}-${newForfeited}`;

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId,
              activityType: 'github_activity_forfeited',
              xpAwarded: 0,
              satietyAwarded: 0,
              ruleVersion: 1,
            },
            tx
          );
          ledgerEntryCreated = true;
        }
      }

      const newRewardedTotal = state.total_contributions_rewarded + rewardedCount;
      const newForfeitedTotal = state.total_contributions_forfeited + forfeitedCount;
      const newPending = totalPending - batchCount;
      const newHourlyProcessed = currentHourlyProcessed + batchCount;
      const newDailyXp = state.daily_activity_xp_awarded + xpAwarded;

      // Update daily_sync_states atomically
      const updateRes = await tx.query<DailySyncStateRow>(
        `UPDATE daily_sync_states SET
          total_contributions_recorded = $1,
          latest_observed_contributions = $2,
          total_contributions_rewarded = $3,
          total_contributions_forfeited = $4,
          pending_contribution_increments = $5,
          daily_activity_xp_awarded = $6,
          hourly_window_start = $7,
          hourly_increments_processed = $8,
          last_synced_at = NOW()
        WHERE id = $9
        RETURNING *;`,
        [
          newRecorded,
          safeSnapshot,
          newRewardedTotal,
          newForfeitedTotal,
          newPending,
          newDailyXp,
          currentWindowStart,
          newHourlyProcessed,
          state.id,
        ]
      );

      const finalState = updateRes.rows[0];

      return {
        syncState: finalState,
        observedSnapshot: safeSnapshot,
        newlyObservedIncrements: newlyObserved,
        processedIncrements: batchCount,
        rewardedIncrements: rewardedCount,
        forfeitedIncrements: forfeitedCount,
        remainingPendingIncrements: newPending,
        xpAwarded,
        dailyXpTotal: newDailyXp,
        capExhausted: newDailyXp >= 300,
        ledgerEntryCreated,
        canonicalActivityId,
        experienceResult: expResult,
      };
    }, existingClient);
  }

  /**
   * Atomically allocates a monotonically increasing request sequence number for a user.
   * Executed BEFORE dispatching external GitHub GraphQL requests.
   * Holds ZERO locks or transactions open during external calls.
   */
  public static async allocateSnapshotSequence(
    userId: string,
    client?: PoolClient
  ): Promise<number> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId: expected non-empty string.');
    }
    const db = client || getPool();
    const res = await db.query<{ next_snapshot_sequence: string | number }>(
      `UPDATE users
       SET next_snapshot_sequence = next_snapshot_sequence + 1
       WHERE id = $1
       RETURNING next_snapshot_sequence;`,
      [userId]
    );

    if (res.rows.length === 0) {
      throw new Error(`User with ID ${userId} not found for snapshot sequence allocation.`);
    }

    return Number(res.rows[0].next_snapshot_sequence);
  }

  /**
   * Reconciles an observed public contribution count against the persisted high-water mark for a user and UTC date.
   *
   * Sprint 2.4B.3 Core Invariants:
   * 1. Normalized UTC date string (YYYY-MM-DD).
   * 2. Idempotent initialization of daily_sync_states.
   * 3. Row-level locking via SELECT ... FOR UPDATE.
   * 4. Sequence-based distributed request ordering (clock-skew proof).
   * 5. Monotonic high-water mark: max(previousHighWaterMark, observedPublicTotal) for valid observations.
   * 6. Stale Snapshot Protection: An older sequence arriving after a newer observation CANNOT advance the
   *    high-water mark, nor create reward-eligible increments!
   * 7. Separation of concerns: latest observation, high-water mark, raw increments, and reward-eligible increments.
   * 8. STRICT SCOPE: No XP, no pet progression, no ledger writes, no pending queues.
   */
  public static async reconcileDailyContributionState(
    userId: string,
    syncDateIso: string,
    observedPublicTotal: number,
    observedAtOrOptions?: Date | string | null | PoolClient | DailyReconciliationOptions,
    requestSequenceOrClient?: number | null | PoolClient,
    existingClient?: PoolClient
  ): Promise<DailyReconciliationResult> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId: expected non-empty string.');
    }
    if (typeof observedPublicTotal !== 'number' || !Number.isInteger(observedPublicTotal) || observedPublicTotal < 0) {
      throw new Error(`Invalid observedPublicTotal: expected non-negative integer, got ${observedPublicTotal}.`);
    }

    // Disambiguate arguments
    let observedAt: Date | string | null = null;
    let requestSequence: number | null = null;
    let clientToUse = existingClient;

    if (observedAtOrOptions && typeof (observedAtOrOptions as PoolClient).query === 'function') {
      clientToUse = observedAtOrOptions as PoolClient;
    } else if (observedAtOrOptions && typeof observedAtOrOptions === 'object' && !(observedAtOrOptions instanceof Date)) {
      const opts = observedAtOrOptions as DailyReconciliationOptions;
      observedAt = opts.observedAt ?? null;
      requestSequence = opts.requestSequence ?? null;
      if (opts.existingClient) clientToUse = opts.existingClient;
    } else if (observedAtOrOptions !== undefined) {
      observedAt = observedAtOrOptions as Date | string | null;
    }

    if (typeof requestSequenceOrClient === 'number') {
      requestSequence = requestSequenceOrClient;
    } else if (requestSequenceOrClient && typeof (requestSequenceOrClient as PoolClient).query === 'function') {
      clientToUse = requestSequenceOrClient as PoolClient;
    }

    const incomingObservedDate = observedAt ? new Date(observedAt) : new Date();
    if (isNaN(incomingObservedDate.getTime())) {
      throw new Error(`Invalid observedAt timestamp: ${observedAt}`);
    }

    return withTransaction(async (tx) => {
      // 1. Idempotently ensure daily sync row exists
      await tx.query(
        `INSERT INTO daily_sync_states (
          user_id, sync_date, total_contributions_recorded, latest_observed_contributions,
          latest_observed_at, latest_request_sequence, total_contributions_rewarded,
          total_contributions_forfeited, pending_contribution_increments,
          daily_activity_xp_awarded, hourly_increments_processed
        ) VALUES ($1, $2, 0, 0, NULL, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (user_id, sync_date) DO NOTHING;`,
        [userId, syncDateIso]
      );

      // 2. Lock the relevant daily row
      const lockRes = await tx.query<DailySyncStateRow>(
        'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;',
        [userId, syncDateIso]
      );

      if (lockRes.rows.length === 0) {
        throw new Error(`Failed to acquire lock on daily_sync_states for user ${userId} and date ${syncDateIso}.`);
      }

      const state = lockRes.rows[0];

      // 3. Read previous high-water mark and recorded sequence
      const previousHighWaterMark = state.total_contributions_recorded ?? 0;
      const recordedSequence = Number(state.latest_request_sequence ?? 0);
      const incomingSequence = requestSequence !== null && requestSequence !== undefined
        ? Number(requestSequence)
        : null;

      // 4. Stale snapshot evaluation:
      // A snapshot is stale if an explicit sequence was supplied and is strictly lower than the recorded sequence.
      const isStale = incomingSequence !== null && recordedSequence > 0 && incomingSequence < recordedSequence;

      // 5. High-water mark & reward eligibility calculation:
      // Invariant: A stale snapshot MUST NOT advance the high-water mark, nor create reward-eligible increments!
      let newlyObservedIncrements = 0;
      let rewardEligibleIncrements = 0;
      let currentHighWaterMark = previousHighWaterMark;

      if (!isStale) {
        newlyObservedIncrements = Math.max(0, observedPublicTotal - previousHighWaterMark);
        rewardEligibleIncrements = newlyObservedIncrements;
        currentHighWaterMark = Math.max(previousHighWaterMark, observedPublicTotal);
      }

      // 6. Observation and sequence resolution:
      let nextObservedCount: number;
      let nextObservedAt: Date;
      let nextRequestSequence: number;

      if (incomingSequence !== null) {
        if (incomingSequence > recordedSequence) {
          // Strictly newer sequence: accept observation
          nextObservedCount = observedPublicTotal;
          nextObservedAt = incomingObservedDate;
          nextRequestSequence = incomingSequence;
        } else if (incomingSequence === recordedSequence) {
          // Equal sequence (e.g. retry / duplicate): deterministic resolution
          nextObservedCount = Math.max(state.latest_observed_contributions ?? 0, observedPublicTotal);
          nextObservedAt = incomingObservedDate;
          nextRequestSequence = incomingSequence;
        } else {
          // Stale sequence (incomingSequence < recordedSequence):
          // MUST NOT overwrite latest accepted observation!
          nextObservedCount = state.latest_observed_contributions ?? observedPublicTotal;
          nextObservedAt = state.latest_observed_at ? new Date(state.latest_observed_at) : incomingObservedDate;
          nextRequestSequence = recordedSequence;
        }
      } else {
        // Fallback for callers without explicit sequence (timestamp-based ordering)
        const currentObservedTime = state.latest_observed_at
          ? new Date(state.latest_observed_at).getTime()
          : null;
        const incomingObservedTime = incomingObservedDate.getTime();

        if (currentObservedTime === null || incomingObservedTime > currentObservedTime) {
          nextObservedCount = observedPublicTotal;
          nextObservedAt = incomingObservedDate;
          nextRequestSequence = recordedSequence;
        } else if (incomingObservedTime === currentObservedTime) {
          nextObservedCount = Math.max(state.latest_observed_contributions ?? 0, observedPublicTotal);
          nextObservedAt = incomingObservedDate;
          nextRequestSequence = recordedSequence;
        } else {
          nextObservedCount = state.latest_observed_contributions ?? observedPublicTotal;
          nextObservedAt = new Date(state.latest_observed_at!);
          nextRequestSequence = recordedSequence;
        }
      }

      // 7. Update database row atomically
      const updateRes = await tx.query<DailySyncStateRow>(
        `UPDATE daily_sync_states
        SET total_contributions_recorded = $1,
            latest_observed_contributions = $2,
            latest_observed_at = $3,
            latest_request_sequence = $4,
            last_synced_at = NOW()
        WHERE id = $5
        RETURNING *;`,
        [currentHighWaterMark, nextObservedCount, nextObservedAt, nextRequestSequence, state.id]
      );

      const finalRow = updateRes.rows[0];

      return {
        userId,
        utcDate: syncDateIso,
        latestObservedContributions: finalRow.latest_observed_contributions ?? nextObservedCount,
        latestObservedAt: finalRow.latest_observed_at ? new Date(finalRow.latest_observed_at) : nextObservedAt,
        latestRequestSequence: Number(finalRow.latest_request_sequence ?? nextRequestSequence),
        previousHighWaterMark,
        currentHighWaterMark,
        newlyObservedIncrements,
        rewardEligibleIncrements,
        isStale,
        reconciledAt: new Date(finalRow.last_synced_at),
      };
    }, clientToUse);
  }

  /**
   * Safely forfeits stale pending increments older than the grace window (e.g. 2 days / 48h).
   */
  public static async expireStalePendingIncrements(
    olderThanDays: number = 2,
    client?: PoolClient
  ): Promise<number> {
    const db = client || getPool();

    const res = await db.query(
      `UPDATE daily_sync_states
      SET pending_contribution_increments = 0, last_synced_at = NOW()
      WHERE sync_date < CURRENT_DATE - ($1 || ' days')::INTERVAL
        AND pending_contribution_increments > 0;`,
      [olderThanDays]
    );

    return res.rowCount || 0;
  }

  /**
   * Sprint 2.4C: Retrieves all contribution increment slices for a user, optionally filtered by date.
   */
  public static async getIncrementSlices(
    userId: string,
    syncDateIso?: string,
    client?: PoolClient
  ): Promise<ContributionIncrementSliceRow[]> {
    const db = client || getPool();
    if (syncDateIso) {
      const res = await db.query<ContributionIncrementSliceRow>(
        `SELECT * FROM contribution_increment_slices
         WHERE user_id = $1 AND sync_date = $2
         ORDER BY slice_start ASC;`,
        [userId, syncDateIso]
      );
      return res.rows;
    }
    const res = await db.query<ContributionIncrementSliceRow>(
      `SELECT * FROM contribution_increment_slices
       WHERE user_id = $1
       ORDER BY sync_date ASC, slice_start ASC;`,
      [userId]
    );
    return res.rows;
  }

  /**
   * Sprint 2.4C: Expires pending slices older than given hours (default 48h).
   */
  public static async expireStalePendingSlices(
    olderThanHours: number = 48,
    client?: PoolClient,
    currentTime?: Date
  ): Promise<number> {
    const db = client || getPool();
    const now = currentTime || new Date();

    const res = await db.query<ContributionIncrementSliceRow>(
      `UPDATE contribution_increment_slices
       SET status = 'expired', processed_at = $1
       WHERE status = 'pending'
         AND ((sync_date::TEXT || ' 00:00:00+00')::TIMESTAMPTZ + ($2 || ' hours')::INTERVAL) <= $1
       RETURNING *;`,
      [now, olderThanHours]
    );

    if (res.rows.length > 0) {
      for (const row of res.rows) {
        const dateStr = normalizeDateStr(row.sync_date);
        await db.query(
          `UPDATE daily_sync_states
           SET pending_contribution_increments = GREATEST(0, pending_contribution_increments - $1)
           WHERE user_id = $2 AND sync_date = $3;`,
          [row.increment_count, row.user_id, dateStr]
        );
      }
    }

    return res.rowCount || 0;
  }

  /**
   * Sprint 2.4C: Server-Authoritative Atomic Contribution Reward Accounting & Pet Progression Pipeline
   *
   * Strictly Enforced Invariants:
   * 1. Lock Acquisition Order (Deadlock Prevention):
   *    Lock 1: pet_states (FOR UPDATE)
   *    Lock 2: daily_sync_states (FOR UPDATE)
   *    Lock 3: contribution_increment_slices (FOR UPDATE)
   * 2. Atomic sequence and payload hash verification (DuplicateSequenceConflictError on mismatch).
   * 3. Monotonic high-water mark protection and durable increment slice persistence.
   * 4. 48-hour expiration of stale pending increments.
   * 5. Rolling 1-hour throttle (maximum 5 processed increments per rolling hour across all instances).
   * 6. Diminishing XP schedule (25, 15, 10, 5, 5...) and Satiety schedule (10, 5, 2, 1, 1...).
   * 7. Daily 300 XP cap per UTC date with increment forfeiture.
   * 8. Slice splitting: rewards up to hourly allowance, remaining slice kept pending.
   * 9. Append-only ledger recording with UNIQUE (user_id, canonical_activity_id).
   * 10. Atomic pet progression (XP, level-ups, evolution stages) and satiety (hunger clamped to 100).
   */
  public static async processContributionSync(
    userId: string,
    syncDateIso: string,
    observedPublicTotal: number,
    options?: ProcessContributionSyncOptions
  ): Promise<DailyContributionSyncResult> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId: expected non-empty string.');
    }
    if (
      typeof observedPublicTotal !== 'number' ||
      !Number.isInteger(observedPublicTotal) ||
      observedPublicTotal < 0
    ) {
      throw new Error(
        `Invalid observedPublicTotal: expected non-negative integer, got ${observedPublicTotal}.`
      );
    }

    const now = options?.currentTime ? new Date(options.currentTime) : new Date();
    const incomingObservedDate = options?.observedAt ? new Date(options.observedAt) : now;
    if (isNaN(incomingObservedDate.getTime())) {
      throw new Error(`Invalid observedAt timestamp: ${options?.observedAt}`);
    }

    const incomingSequence =
      options?.requestSequence !== null && options?.requestSequence !== undefined
        ? Number(options.requestSequence)
        : null;

    const clientToUse = options?.existingClient;

    return withTransaction(async (tx) => {
      // Step 1: Lock pet_states (Lock 1 in global lock order)
      const petLock = await tx.query<PetStateRow>(
        'SELECT * FROM pet_states WHERE user_id = $1 FOR UPDATE;',
        [userId]
      );
      if (petLock.rows.length === 0) {
        throw new Error(`Pet state not found for user ${userId}.`);
      }
      let pet = petLock.rows[0];

      // Step 2: Idempotently ensure daily_sync_states row exists, then acquire Lock 2
      await tx.query(
        `INSERT INTO daily_sync_states (
          user_id, sync_date, total_contributions_recorded, latest_observed_contributions,
          latest_observed_at, latest_request_sequence, total_contributions_rewarded,
          total_contributions_forfeited, pending_contribution_increments,
          daily_activity_xp_awarded, hourly_increments_processed
        ) VALUES ($1, $2, 0, 0, NULL, 0, 0, 0, 0, 0, 0)
        ON CONFLICT (user_id, sync_date) DO NOTHING;`,
        [userId, syncDateIso]
      );

      const dailyLock = await tx.query<DailySyncStateRow>(
        'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;',
        [userId, syncDateIso]
      );
      if (dailyLock.rows.length === 0) {
        throw new Error(
          `Failed to acquire lock on daily_sync_states for user ${userId} and date ${syncDateIso}.`
        );
      }
      const state = dailyLock.rows[0];

      const previousHighWaterMark = state.total_contributions_recorded ?? 0;
      const recordedSequence = Number(state.latest_request_sequence ?? 0);

      const computedHash =
        options?.payloadHash ||
        computePayloadHash({
          userId,
          syncDate: syncDateIso,
          observedPublicTotal,
          requestSequence: incomingSequence,
        });

      // Step 3: Validate sequence and payload conflict
      if (
        incomingSequence !== null &&
        recordedSequence > 0 &&
        incomingSequence === recordedSequence
      ) {
        if (state.latest_payload_hash && state.latest_payload_hash !== computedHash) {
          throw new DuplicateSequenceConflictError(
            `Payload conflict: requestSequence ${incomingSequence} already processed with a different payload.`
          );
        }
      }

      const isStale =
        incomingSequence !== null && recordedSequence > 0 && incomingSequence < recordedSequence;

      // Step 4: High-water mark & durable pending increment slice insertion
      let newlyObservedIncrements = 0;
      let rewardEligibleIncrements = 0;
      let currentHighWaterMark = previousHighWaterMark;
      const createdSliceIds: string[] = [];

      if (!isStale) {
        // High-water mark advances only on strictly higher observations
        newlyObservedIncrements = Math.max(0, observedPublicTotal - previousHighWaterMark);
        rewardEligibleIncrements = newlyObservedIncrements;
        currentHighWaterMark = Math.max(previousHighWaterMark, observedPublicTotal);

        if (newlyObservedIncrements > 0) {
          const sliceStart = previousHighWaterMark;
          const sliceEnd = currentHighWaterMark;
          const canonicalSliceId = `urn:gh:daily:${userId}:${syncDateIso}:slice:${sliceStart}-${sliceEnd}`;

          await tx.query(
            `INSERT INTO contribution_increment_slices (
              user_id, sync_date, canonical_slice_id, slice_start, slice_end,
              increment_count, status, request_sequence, payload_hash, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)
            ON CONFLICT (user_id, canonical_slice_id) DO NOTHING;`,
            [
              userId,
              syncDateIso,
              canonicalSliceId,
              sliceStart,
              sliceEnd,
              newlyObservedIncrements,
              incomingSequence ?? recordedSequence,
              computedHash,
              now,
            ]
          );
          createdSliceIds.push(canonicalSliceId);
        }
      }

      // Step 5: Update observation and sequence resolution on daily_sync_states
      let nextObservedCount = state.latest_observed_contributions ?? 0;
      let nextObservedAt = state.latest_observed_at
        ? new Date(state.latest_observed_at)
        : incomingObservedDate;
      let nextRequestSequence = recordedSequence;
      let nextPayloadHash = state.latest_payload_hash;

      if (incomingSequence !== null) {
        if (incomingSequence > recordedSequence) {
          nextObservedCount = observedPublicTotal;
          nextObservedAt = incomingObservedDate;
          nextRequestSequence = incomingSequence;
          nextPayloadHash = computedHash;
        } else if (incomingSequence === recordedSequence) {
          nextObservedCount = Math.max(
            state.latest_observed_contributions ?? 0,
            observedPublicTotal
          );
          nextObservedAt = incomingObservedDate;
          nextRequestSequence = incomingSequence;
          nextPayloadHash = computedHash;
        }
      } else {
        if (incomingObservedDate.getTime() >= nextObservedAt.getTime()) {
          nextObservedCount = observedPublicTotal;
          nextObservedAt = incomingObservedDate;
          nextPayloadHash = computedHash;
        }
      }

      const updatedPendingCount =
        (state.pending_contribution_increments ?? 0) + newlyObservedIncrements;

      await tx.query(
        `UPDATE daily_sync_states SET
          total_contributions_recorded = $1,
          latest_observed_contributions = $2,
          latest_observed_at = $3,
          latest_request_sequence = $4,
          latest_payload_hash = $5,
          pending_contribution_increments = $6,
          last_synced_at = NOW()
        WHERE id = $7;`,
        [
          currentHighWaterMark,
          nextObservedCount,
          nextObservedAt,
          nextRequestSequence,
          nextPayloadHash,
          updatedPendingCount,
          state.id,
        ]
      );

      // Step 6: 48-Hour Expiry Boundary
      // Any pending slices whose sync_date is >= 48 hours before now expire
      const expiredRes = await tx.query<ContributionIncrementSliceRow>(
        `UPDATE contribution_increment_slices
         SET status = 'expired', processed_at = $1
         WHERE user_id = $2
           AND status = 'pending'
           AND ((sync_date::TEXT || ' 00:00:00+00')::TIMESTAMPTZ + INTERVAL '48 hours') <= $1
         RETURNING *;`,
        [now, userId]
      );

      for (const expSlice of expiredRes.rows) {
        const expDateStr = normalizeDateStr(expSlice.sync_date);
        await tx.query(
          `UPDATE daily_sync_states
           SET pending_contribution_increments = GREATEST(0, pending_contribution_increments - $1)
           WHERE user_id = $2 AND sync_date = $3;`,
          [expSlice.increment_count, userId, expDateStr]
        );
      }

      // Step 7: Rolling 1-Hour Allowance across ALL instances and dates
      const oneHourAgo = new Date(now.getTime() - 3600_000);
      const hourlyRes = await tx.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(increment_count), 0) AS total
         FROM contribution_increment_slices
         WHERE user_id = $1
           AND status IN ('rewarded', 'forfeited')
           AND processed_at > $2;`,
        [userId, oneHourAgo]
      );
      const processedInLastHour = Number(hourlyRes.rows[0].total);

      let hourlyAllowance = options?.bypassHourlyThrottle
        ? 1000000
        : Math.max(0, 5 - processedInLastHour);

      // Step 8: Drain pending increment slices (Lock 3 in global lock order)
      const pendingSlicesRes = await tx.query<ContributionIncrementSliceRow>(
        `SELECT * FROM contribution_increment_slices
         WHERE user_id = $1 AND status = 'pending'
         ORDER BY sync_date ASC, slice_start ASC
         FOR UPDATE;`,
        [userId]
      );

      let totalProcessed = 0;
      let totalRewarded = 0;
      let totalForfeited = 0;
      let totalXpAwarded = 0;
      let totalSatietyAwarded = 0;
      const processedSliceIds: string[] = [];

      for (const slice of pendingSlicesRes.rows) {
        if (hourlyAllowance <= 0) break;

        const sliceDate = normalizeDateStr(slice.sync_date);

        // Verify 48-hour expiration for this specific slice
        const sliceStartMs = new Date(`${sliceDate}T00:00:00.000Z`).getTime();
        if (now.getTime() >= sliceStartMs + 48 * 3600_000) {
          await tx.query(
            `UPDATE contribution_increment_slices SET status = 'expired', processed_at = $1 WHERE id = $2;`,
            [now, slice.id]
          );
          await tx.query(
            `UPDATE daily_sync_states
             SET pending_contribution_increments = GREATEST(0, pending_contribution_increments - $1)
             WHERE user_id = $2 AND sync_date = $3;`,
            [slice.increment_count, userId, sliceDate]
          );
          continue;
        }

        const countToProcess = Math.min(slice.increment_count, hourlyAllowance);
        const remainingInSlice = slice.increment_count - countToProcess;

        // Ensure and Lock daily state for this slice's date
        await tx.query(
          `INSERT INTO daily_sync_states (
            user_id, sync_date, total_contributions_recorded, latest_observed_contributions,
            latest_observed_at, latest_request_sequence, total_contributions_rewarded,
            total_contributions_forfeited, pending_contribution_increments,
            daily_activity_xp_awarded, hourly_increments_processed
          ) VALUES ($1, $2, 0, 0, NULL, 0, 0, 0, 0, 0, 0)
          ON CONFLICT (user_id, sync_date) DO NOTHING;`,
          [userId, sliceDate]
        );

        const sDailyRes = await tx.query<DailySyncStateRow>(
          'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;',
          [userId, sliceDate]
        );
        const sliceDaily = sDailyRes.rows[0];

        let rewardedCount = 0;
        let forfeitedCount = 0;
        let sliceXp = 0;
        let sliceSatiety = 0;

        const availableBudget = Math.max(0, 300 - sliceDaily.daily_activity_xp_awarded);

        for (let i = 1; i <= countToProcess; i++) {
          const ordinal = sliceDaily.total_contributions_rewarded + rewardedCount + 1;
          const incXp = calculateIncrementXp(ordinal);
          const incSatiety = calculateIncrementSatiety(ordinal);

          if (sliceXp + incXp <= availableBudget) {
            rewardedCount += 1;
            sliceXp += incXp;
            sliceSatiety += incSatiety;
          } else {
            forfeitedCount += 1;
          }
        }

        // Split remainder if needed (countToProcess < slice.increment_count)
        if (remainingInSlice > 0) {
          const remStart = slice.slice_start + countToProcess;
          const remEnd = slice.slice_end;
          const remId = `urn:gh:daily:${userId}:${sliceDate}:slice:${remStart}-${remEnd}`;

          await tx.query(
            `INSERT INTO contribution_increment_slices (
              user_id, sync_date, canonical_slice_id, slice_start, slice_end,
              increment_count, status, request_sequence, payload_hash, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9);`,
            [
              userId,
              sliceDate,
              remId,
              remStart,
              remEnd,
              remainingInSlice,
              slice.request_sequence,
              slice.payload_hash,
              slice.created_at,
            ]
          );
        }

        // Update processed portion (rewarded and/or forfeited)
        if (rewardedCount > 0 && forfeitedCount > 0) {
          const rewStart = slice.slice_start;
          const rewEnd = slice.slice_start + rewardedCount;
          const rewId = `urn:gh:daily:${userId}:${sliceDate}:slice:${rewStart}-${rewEnd}`;

          await tx.query(
            `UPDATE contribution_increment_slices SET
              canonical_slice_id = $1, slice_start = $2, slice_end = $3,
              increment_count = $4, status = 'rewarded', processed_at = $5
             WHERE id = $6;`,
            [rewId, rewStart, rewEnd, rewardedCount, now, slice.id]
          );
          processedSliceIds.push(rewId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: rewId,
              activityType: 'github_activity',
              xpAwarded: sliceXp,
              satietyAwarded: sliceSatiety,
              ruleVersion: 1,
            },
            tx
          );

          const forfStart = rewEnd;
          const forfEnd = slice.slice_start + countToProcess;
          const forfId = `urn:gh:daily:${userId}:${sliceDate}:forfeited:${forfStart}-${forfEnd}`;

          await tx.query(
            `INSERT INTO contribution_increment_slices (
              user_id, sync_date, canonical_slice_id, slice_start, slice_end,
              increment_count, status, request_sequence, payload_hash, created_at, processed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'forfeited', $7, $8, $9, $10);`,
            [
              userId,
              sliceDate,
              forfId,
              forfStart,
              forfEnd,
              forfeitedCount,
              slice.request_sequence,
              slice.payload_hash,
              slice.created_at,
              now,
            ]
          );
          processedSliceIds.push(forfId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: forfId,
              activityType: 'github_activity_forfeited',
              xpAwarded: 0,
              satietyAwarded: 0,
              ruleVersion: 1,
            },
            tx
          );
        } else if (rewardedCount > 0) {
          const rewStart = slice.slice_start;
          const rewEnd = slice.slice_start + countToProcess;
          const rewId = `urn:gh:daily:${userId}:${sliceDate}:slice:${rewStart}-${rewEnd}`;

          await tx.query(
            `UPDATE contribution_increment_slices SET
              canonical_slice_id = $1, slice_start = $2, slice_end = $3,
              increment_count = $4, status = 'rewarded', processed_at = $5
             WHERE id = $6;`,
            [rewId, rewStart, rewEnd, countToProcess, now, slice.id]
          );
          processedSliceIds.push(rewId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: rewId,
              activityType: 'github_activity',
              xpAwarded: sliceXp,
              satietyAwarded: sliceSatiety,
              ruleVersion: 1,
            },
            tx
          );
        } else if (forfeitedCount > 0) {
          const forfStart = slice.slice_start;
          const forfEnd = slice.slice_start + countToProcess;
          const forfId = `urn:gh:daily:${userId}:${sliceDate}:forfeited:${forfStart}-${forfEnd}`;

          await tx.query(
            `UPDATE contribution_increment_slices SET
              canonical_slice_id = $1, slice_start = $2, slice_end = $3,
              increment_count = $4, status = 'forfeited', processed_at = $5
             WHERE id = $6;`,
            [forfId, forfStart, forfEnd, countToProcess, now, slice.id]
          );
          processedSliceIds.push(forfId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: forfId,
              activityType: 'github_activity_forfeited',
              xpAwarded: 0,
              satietyAwarded: 0,
              ruleVersion: 1,
            },
            tx
          );
        }

        // Update slice daily sync state
        await tx.query(
          `UPDATE daily_sync_states SET
            total_contributions_rewarded = total_contributions_rewarded + $1,
            total_contributions_forfeited = total_contributions_forfeited + $2,
            pending_contribution_increments = GREATEST(0, pending_contribution_increments - $3),
            daily_activity_xp_awarded = daily_activity_xp_awarded + $4,
            hourly_increments_processed = hourly_increments_processed + $5,
            last_synced_at = NOW()
           WHERE id = $6;`,
          [rewardedCount, forfeitedCount, countToProcess, sliceXp, countToProcess, sliceDaily.id]
        );

        totalProcessed += countToProcess;
        totalRewarded += rewardedCount;
        totalForfeited += forfeitedCount;
        totalXpAwarded += sliceXp;
        totalSatietyAwarded += sliceSatiety;
        hourlyAllowance -= countToProcess;
      }

      // Step 9: Atomic Pet Progression & Satiety
      let petProgression: PetProgressionSummary | null = null;

      if (totalXpAwarded > 0 || totalSatietyAwarded > 0) {
        let expResult: ExperienceResult;
        if (totalXpAwarded > 0) {
          expResult = await PetRepository.applyExperience(userId, totalXpAwarded, tx);
        } else {
          expResult = {
            previousLevel: pet.level,
            newLevel: pet.level,
            currentXp: pet.xp,
            maxExp: pet.max_exp,
            evolutionStage: pet.evolution_stage,
            leveledUp: false,
            totalXpAdded: 0,
          };
        }

        let newHunger = pet.hunger;
        if (totalSatietyAwarded > 0) {
          newHunger = Math.min(100, pet.hunger + totalSatietyAwarded);
        }

        const updatedPet = await tx.query<PetStateRow>(
          `UPDATE pet_states SET
            hunger = $1,
            last_interacted_at = NOW(),
            updated_at = NOW()
           WHERE user_id = $2
           RETURNING *;`,
          [newHunger, userId]
        );
        pet = updatedPet.rows[0];

        petProgression = {
          previousLevel: expResult.previousLevel,
          newLevel: expResult.newLevel,
          currentXp: expResult.currentXp,
          maxExp: expResult.maxExp,
          evolutionStage: expResult.evolutionStage,
          leveledUp: expResult.leveledUp,
          hunger: pet.hunger,
        };
      } else {
        petProgression = {
          previousLevel: pet.level,
          newLevel: pet.level,
          currentXp: pet.xp,
          maxExp: pet.max_exp,
          evolutionStage: pet.evolution_stage,
          leveledUp: false,
          hunger: pet.hunger,
        };
      }

      // Step 10: Assemble final result
      const finalDailyRes = await tx.query<DailySyncStateRow>(
        'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2;',
        [userId, syncDateIso]
      );
      const finalDaily = finalDailyRes.rows[0];

      const pendingSumRes = await tx.query<{ total: string | number }>(
        'SELECT COALESCE(SUM(pending_contribution_increments), 0) AS total FROM daily_sync_states WHERE user_id = $1;',
        [userId]
      );
      const remainingPending = Number(pendingSumRes.rows[0].total);

      const rewardResult: ContributionRewardResult = {
        processedIncrements: totalProcessed,
        rewardedIncrements: totalRewarded,
        forfeitedIncrements: totalForfeited,
        remainingPendingIncrements: remainingPending,
        xpAwarded: totalXpAwarded,
        satietyAwarded: totalSatietyAwarded,
        dailyXpTotal: finalDaily.daily_activity_xp_awarded,
        capExhausted: finalDaily.daily_activity_xp_awarded >= 300,
        hourlyQuotaRemaining: Math.max(0, hourlyAllowance),
        canonicalSliceIds: processedSliceIds.length > 0 ? processedSliceIds : createdSliceIds,
        petProgression,
      };

      return {
        userId,
        utcDate: syncDateIso,
        latestObservedContributions: finalDaily.latest_observed_contributions ?? nextObservedCount,
        latestObservedAt: finalDaily.latest_observed_at
          ? new Date(finalDaily.latest_observed_at)
          : nextObservedAt,
        latestRequestSequence: Number(finalDaily.latest_request_sequence ?? nextRequestSequence),
        previousHighWaterMark,
        currentHighWaterMark,
        newlyObservedIncrements,
        rewardEligibleIncrements,
        isStale,
        reconciledAt: new Date(finalDaily.last_synced_at),
        reward: rewardResult,
      };
    }, clientToUse);
  }

  /**
   * Sprint 2.4C: Drains pending contribution increment rewards for a user when hourly quota becomes available.
   */
  public static async processPendingRewards(
    userId: string,
    options?: ProcessContributionSyncOptions
  ): Promise<ContributionRewardResult> {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId: expected non-empty string.');
    }

    const now = options?.currentTime ? new Date(options.currentTime) : new Date();
    const clientToUse = options?.existingClient;

    return withTransaction(async (tx) => {
      // Lock pet_states
      const petLock = await tx.query<PetStateRow>(
        'SELECT * FROM pet_states WHERE user_id = $1 FOR UPDATE;',
        [userId]
      );
      if (petLock.rows.length === 0) {
        throw new Error(`Pet state not found for user ${userId}.`);
      }
      let pet = petLock.rows[0];

      // Expire stale slices older than 48 hours
      const expiredRes = await tx.query<ContributionIncrementSliceRow>(
        `UPDATE contribution_increment_slices
         SET status = 'expired', processed_at = $1
         WHERE user_id = $2
           AND status = 'pending'
           AND ((sync_date::TEXT || ' 00:00:00+00')::TIMESTAMPTZ + INTERVAL '48 hours') <= $1
         RETURNING *;`,
        [now, userId]
      );

      for (const expSlice of expiredRes.rows) {
        const expDateStr = normalizeDateStr(expSlice.sync_date);
        await tx.query(
          `UPDATE daily_sync_states
           SET pending_contribution_increments = GREATEST(0, pending_contribution_increments - $1)
           WHERE user_id = $2 AND sync_date = $3;`,
          [expSlice.increment_count, userId, expDateStr]
        );
      }

      // Rolling 1-Hour Allowance
      const oneHourAgo = new Date(now.getTime() - 3600_000);
      const hourlyRes = await tx.query<{ total: string | number }>(
        `SELECT COALESCE(SUM(increment_count), 0) AS total
         FROM contribution_increment_slices
         WHERE user_id = $1
           AND status IN ('rewarded', 'forfeited')
           AND processed_at > $2;`,
        [userId, oneHourAgo]
      );
      const processedInLastHour = Number(hourlyRes.rows[0].total);

      let hourlyAllowance = options?.bypassHourlyThrottle
        ? 1000000
        : Math.max(0, 5 - processedInLastHour);

      const pendingSlicesRes = await tx.query<ContributionIncrementSliceRow>(
        `SELECT * FROM contribution_increment_slices
         WHERE user_id = $1 AND status = 'pending'
         ORDER BY sync_date ASC, slice_start ASC
         FOR UPDATE;`,
        [userId]
      );

      let totalProcessed = 0;
      let totalRewarded = 0;
      let totalForfeited = 0;
      let totalXpAwarded = 0;
      let totalSatietyAwarded = 0;
      let lastDailyXp = 0;
      let lastCapExhausted = false;
      const processedSliceIds: string[] = [];

      for (const slice of pendingSlicesRes.rows) {
        if (hourlyAllowance <= 0) break;

        const sliceDate = normalizeDateStr(slice.sync_date);
        const sliceStartMs = new Date(`${sliceDate}T00:00:00.000Z`).getTime();
        if (now.getTime() >= sliceStartMs + 48 * 3600_000) {
          await tx.query(
            `UPDATE contribution_increment_slices SET status = 'expired', processed_at = $1 WHERE id = $2;`,
            [now, slice.id]
          );
          await tx.query(
            `UPDATE daily_sync_states
             SET pending_contribution_increments = GREATEST(0, pending_contribution_increments - $1)
             WHERE user_id = $2 AND sync_date = $3;`,
            [slice.increment_count, userId, sliceDate]
          );
          continue;
        }

        const countToProcess = Math.min(slice.increment_count, hourlyAllowance);
        const remainingInSlice = slice.increment_count - countToProcess;

        // Ensure and Lock daily state for this slice's date
        await tx.query(
          `INSERT INTO daily_sync_states (
            user_id, sync_date, total_contributions_recorded, latest_observed_contributions,
            latest_observed_at, latest_request_sequence, total_contributions_rewarded,
            total_contributions_forfeited, pending_contribution_increments,
            daily_activity_xp_awarded, hourly_increments_processed
          ) VALUES ($1, $2, 0, 0, NULL, 0, 0, 0, 0, 0, 0)
          ON CONFLICT (user_id, sync_date) DO NOTHING;`,
          [userId, sliceDate]
        );

        const sDailyRes = await tx.query<DailySyncStateRow>(
          'SELECT * FROM daily_sync_states WHERE user_id = $1 AND sync_date = $2 FOR UPDATE;',
          [userId, sliceDate]
        );
        const sliceDaily = sDailyRes.rows[0];

        let rewardedCount = 0;
        let forfeitedCount = 0;
        let sliceXp = 0;
        let sliceSatiety = 0;

        const availableBudget = Math.max(0, 300 - sliceDaily.daily_activity_xp_awarded);

        for (let i = 1; i <= countToProcess; i++) {
          const ordinal = sliceDaily.total_contributions_rewarded + rewardedCount + 1;
          const incXp = calculateIncrementXp(ordinal);
          const incSatiety = calculateIncrementSatiety(ordinal);

          if (sliceXp + incXp <= availableBudget) {
            rewardedCount += 1;
            sliceXp += incXp;
            sliceSatiety += incSatiety;
          } else {
            forfeitedCount += 1;
          }
        }

        if (remainingInSlice > 0) {
          const remStart = slice.slice_start + countToProcess;
          const remEnd = slice.slice_end;
          const remId = `urn:gh:daily:${userId}:${sliceDate}:slice:${remStart}-${remEnd}`;

          await tx.query(
            `INSERT INTO contribution_increment_slices (
              user_id, sync_date, canonical_slice_id, slice_start, slice_end,
              increment_count, status, request_sequence, payload_hash, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9);`,
            [
              userId,
              sliceDate,
              remId,
              remStart,
              remEnd,
              remainingInSlice,
              slice.request_sequence,
              slice.payload_hash,
              slice.created_at,
            ]
          );
        }

        if (rewardedCount > 0 && forfeitedCount > 0) {
          const rewStart = slice.slice_start;
          const rewEnd = slice.slice_start + rewardedCount;
          const rewId = `urn:gh:daily:${userId}:${sliceDate}:slice:${rewStart}-${rewEnd}`;

          await tx.query(
            `UPDATE contribution_increment_slices SET
              canonical_slice_id = $1, slice_start = $2, slice_end = $3,
              increment_count = $4, status = 'rewarded', processed_at = $5
             WHERE id = $6;`,
            [rewId, rewStart, rewEnd, rewardedCount, now, slice.id]
          );
          processedSliceIds.push(rewId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: rewId,
              activityType: 'github_activity',
              xpAwarded: sliceXp,
              satietyAwarded: sliceSatiety,
              ruleVersion: 1,
            },
            tx
          );

          const forfStart = rewEnd;
          const forfEnd = slice.slice_start + countToProcess;
          const forfId = `urn:gh:daily:${userId}:${sliceDate}:forfeited:${forfStart}-${forfEnd}`;

          await tx.query(
            `INSERT INTO contribution_increment_slices (
              user_id, sync_date, canonical_slice_id, slice_start, slice_end,
              increment_count, status, request_sequence, payload_hash, created_at, processed_at
            ) VALUES ($1, $2, $3, $4, $5, $6, 'forfeited', $7, $8, $9, $10);`,
            [
              userId,
              sliceDate,
              forfId,
              forfStart,
              forfEnd,
              forfeitedCount,
              slice.request_sequence,
              slice.payload_hash,
              slice.created_at,
              now,
            ]
          );
          processedSliceIds.push(forfId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: forfId,
              activityType: 'github_activity_forfeited',
              xpAwarded: 0,
              satietyAwarded: 0,
              ruleVersion: 1,
            },
            tx
          );
        } else if (rewardedCount > 0) {
          const rewStart = slice.slice_start;
          const rewEnd = slice.slice_start + countToProcess;
          const rewId = `urn:gh:daily:${userId}:${sliceDate}:slice:${rewStart}-${rewEnd}`;

          await tx.query(
            `UPDATE contribution_increment_slices SET
              canonical_slice_id = $1, slice_start = $2, slice_end = $3,
              increment_count = $4, status = 'rewarded', processed_at = $5
             WHERE id = $6;`,
            [rewId, rewStart, rewEnd, countToProcess, now, slice.id]
          );
          processedSliceIds.push(rewId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: rewId,
              activityType: 'github_activity',
              xpAwarded: sliceXp,
              satietyAwarded: sliceSatiety,
              ruleVersion: 1,
            },
            tx
          );
        } else if (forfeitedCount > 0) {
          const forfStart = slice.slice_start;
          const forfEnd = slice.slice_start + countToProcess;
          const forfId = `urn:gh:daily:${userId}:${sliceDate}:forfeited:${forfStart}-${forfEnd}`;

          await tx.query(
            `UPDATE contribution_increment_slices SET
              canonical_slice_id = $1, slice_start = $2, slice_end = $3,
              increment_count = $4, status = 'forfeited', processed_at = $5
             WHERE id = $6;`,
            [forfId, forfStart, forfEnd, countToProcess, now, slice.id]
          );
          processedSliceIds.push(forfId);

          await LedgerRepository.appendEntry(
            {
              userId,
              canonicalActivityId: forfId,
              activityType: 'github_activity_forfeited',
              xpAwarded: 0,
              satietyAwarded: 0,
              ruleVersion: 1,
            },
            tx
          );
        }

        await tx.query(
          `UPDATE daily_sync_states SET
            total_contributions_rewarded = total_contributions_rewarded + $1,
            total_contributions_forfeited = total_contributions_forfeited + $2,
            pending_contribution_increments = GREATEST(0, pending_contribution_increments - $3),
            daily_activity_xp_awarded = daily_activity_xp_awarded + $4,
            hourly_increments_processed = hourly_increments_processed + $5,
            last_synced_at = NOW()
           WHERE id = $6;`,
          [rewardedCount, forfeitedCount, countToProcess, sliceXp, countToProcess, sliceDaily.id]
        );

        totalProcessed += countToProcess;
        totalRewarded += rewardedCount;
        totalForfeited += forfeitedCount;
        totalXpAwarded += sliceXp;
        totalSatietyAwarded += sliceSatiety;
        lastDailyXp = sliceDaily.daily_activity_xp_awarded + sliceXp;
        lastCapExhausted = lastDailyXp >= 300;
        hourlyAllowance -= countToProcess;
      }

      let petProgression: PetProgressionSummary | null = null;
      if (totalXpAwarded > 0 || totalSatietyAwarded > 0) {
        let expResult: ExperienceResult;
        if (totalXpAwarded > 0) {
          expResult = await PetRepository.applyExperience(userId, totalXpAwarded, tx);
        } else {
          expResult = {
            previousLevel: pet.level,
            newLevel: pet.level,
            currentXp: pet.xp,
            maxExp: pet.max_exp,
            evolutionStage: pet.evolution_stage,
            leveledUp: false,
            totalXpAdded: 0,
          };
        }

        let newHunger = pet.hunger;
        if (totalSatietyAwarded > 0) {
          newHunger = Math.min(100, pet.hunger + totalSatietyAwarded);
        }

        const updatedPet = await tx.query<PetStateRow>(
          `UPDATE pet_states SET
            hunger = $1,
            last_interacted_at = NOW(),
            updated_at = NOW()
           WHERE user_id = $2
           RETURNING *;`,
          [newHunger, userId]
        );
        pet = updatedPet.rows[0];

        petProgression = {
          previousLevel: expResult.previousLevel,
          newLevel: expResult.newLevel,
          currentXp: expResult.currentXp,
          maxExp: expResult.maxExp,
          evolutionStage: expResult.evolutionStage,
          leveledUp: expResult.leveledUp,
          hunger: pet.hunger,
        };
      } else {
        petProgression = {
          previousLevel: pet.level,
          newLevel: pet.level,
          currentXp: pet.xp,
          maxExp: pet.max_exp,
          evolutionStage: pet.evolution_stage,
          leveledUp: false,
          hunger: pet.hunger,
        };
      }

      const pendingSumRes = await tx.query<{ total: string | number }>(
        'SELECT COALESCE(SUM(pending_contribution_increments), 0) AS total FROM daily_sync_states WHERE user_id = $1;',
        [userId]
      );
      const remainingPending = Number(pendingSumRes.rows[0].total);

      return {
        processedIncrements: totalProcessed,
        rewardedIncrements: totalRewarded,
        forfeitedIncrements: totalForfeited,
        remainingPendingIncrements: remainingPending,
        xpAwarded: totalXpAwarded,
        satietyAwarded: totalSatietyAwarded,
        dailyXpTotal: lastDailyXp,
        capExhausted: lastCapExhausted,
        hourlyQuotaRemaining: Math.max(0, hourlyAllowance),
        canonicalSliceIds: processedSliceIds,
        petProgression,
      };
    }, clientToUse);
  }
}
