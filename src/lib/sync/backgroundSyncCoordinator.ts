// src/lib/sync/backgroundSyncCoordinator.ts
// Sprint 2.5C: Background Contribution Sync Orchestration Service
// Coordinates eligible accounts, acquires per-user leases, enforces batch fencing,
// manages monotonic deadlines, records durable attempt identities and exact receipts,
// and produces closed batch accounting.

import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.ts';
import {
  SyncRepository,
  computePayloadHash,
  type DailyContributionSyncResult,
} from '../db/repositories/syncRepository.ts';
import {
  fetchContributionSnapshot,
  type GitHubContributionSnapshot,
} from '../github/contributionSnapshot.ts';
import { classifyGitHubError } from '../github/failureClassification.ts';
import {
  validateAndCanonicalizeUtcDate,
  getUtcDayBoundaries,
} from '../github/dailyReconciliation.ts';

// Global Advisory Lock key allocated in Sprint 2.5A.1–2.5A.7
export const GLOBAL_ADVISORY_LOCK_ID = 982347102;

// Bounded execution defaults
export const DEFAULT_MAX_BATCH_DURATION_MS = 45_000;
export const DEFAULT_BATCH_SAFETY_MARGIN_MS = 15_000;
export const DEFAULT_MAX_ACCOUNTS = 50;
export const DEFAULT_PER_USER_DEADLINE_MS = 10_000;
export const DEFAULT_MAX_CONCURRENCY = 3;
export const USER_SYNC_LEASE_TTL_SECONDS = 60;
export const PRE_COMMIT_SAFETY_MARGIN_MS = 1500;
export const RECOVERY_POLL_BUDGET_MS = 2000;
export const RECOVERY_POLL_INTERVAL_MS = 250;

// Custom errors
export class BatchFencedStaleError extends Error {
  constructor(message: string = 'Batch fenced: active batch ID or generation mismatch') {
    super(message);
    this.name = 'BatchFencedStaleError';
  }
}

export class WorkerTimeoutError extends Error {
  constructor(message: string = 'User sync operation timed out against monotonic deadline') {
    super(message);
    this.name = 'WorkerTimeoutError';
  }
}

export class UserIneligibleError extends Error {
  constructor(message: string = 'User suspended or not found') {
    super(message);
    this.name = 'UserIneligibleError';
  }
}

export class AccountDisconnectedOrIneligibleError extends Error {
  constructor(message: string = 'GitHub account disconnected, tokens missing, or token refresh status ambiguous') {
    super(message);
    this.name = 'AccountDisconnectedOrIneligibleError';
  }
}

export class AdvisoryLockLostError extends Error {
  constructor(message: string = 'Global batch advisory lock connection lost unexpectedly') {
    super(message);
    this.name = 'AdvisoryLockLostError';
  }
}

export class CommitOutcomeUnknownError extends Error {
  constructor(message: string = 'Commit outcome unconfirmed due to connection loss or socket termination') {
    super(message);
    this.name = 'CommitOutcomeUnknownError';
  }
}

export interface DiscoveredAccount {
  id: string;
  primary_handle: string;
  github_account_id: string;
}

export interface BatchAccountingMetrics {
  accountsDiscovered: number;
  leaseAcquisitionAttempts: number;
  accountsAttempted: number;
  successfulSyncs: number;
  noChangeSyncs: number;
  failedSyncs: number;
  commitOutcomeUnknown: number;
  skippedContended: number;
  leaseAcquisitionErrors: number;
  deferredLimit: number;
  rateLimitedAccounts: number;
  reauthRequiredAccounts: number;
  timedOutAccounts: number;
  fencedStaleAccounts: number;
  pendingRewardsProcessed: number;
  expiredSlicesProcessed: number;
  totalXpAwarded: number;
}

export type BatchRunStatus =
  | 'running'
  | 'completed'
  | 'partially_completed'
  | 'deferred_contention'
  | 'failed'
  | 'interrupted';

export interface BackgroundBatchRunResult {
  batchId: string;
  batchGeneration: number;
  status: BatchRunStatus;
  metrics: BatchAccountingMetrics;
  durationMs: number;
  errorMessage?: string | null;
}

export type SnapshotFetcherFn = (params: {
  userId: string;
  from: string;
  to: string;
  requestOptions?: {
    correlationId?: string;
    timeoutMs?: number;
  };
}) => Promise<GitHubContributionSnapshot>;

export interface WorkerPreCommitContext {
  userId: string;
  requestSequence: number;
  batchId: string;
  workerClient: PoolClient;
}

export interface BackgroundSyncOptions {
  maxBatchDurationMs?: number;
  batchSafetyMarginMs?: number;
  maxAccountsPerBatch?: number;
  perUserDeadlineMs?: number;
  maxConcurrency?: number;
  forceSync?: boolean;
  targetDate?: string | Date;
  snapshotFetcher?: SnapshotFetcherFn;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
  preCommitHook?: (ctx: WorkerPreCommitContext) => Promise<void>;
  onAdvisoryAcquired?: (batchId: string, gen: number) => Promise<void>;
  overrideAdvClient?: PoolClient;
  customPool?: Pool;
}

/**
 * Validates that batch accounting metrics satisfy all governing mutually exclusive equations:
 * 1. accountsDiscovered = leaseAcquisitionAttempts + deferredLimit
 * 2. leaseAcquisitionAttempts = accountsAttempted + skippedContended + leaseAcquisitionErrors
 * 3. accountsAttempted = successfulSyncs + noChangeSyncs + failedSyncs + commitOutcomeUnknown
 */
export function validateBatchAccounting(m: BatchAccountingMetrics): boolean {
  const eq1 = m.accountsDiscovered === m.leaseAcquisitionAttempts + m.deferredLimit;
  const eq2 = m.leaseAcquisitionAttempts === m.accountsAttempted + m.skippedContended + m.leaseAcquisitionErrors;
  const eq3 = m.accountsAttempted === m.successfulSyncs + m.noChangeSyncs + m.failedSyncs + m.commitOutcomeUnknown;
  return eq1 && eq2 && eq3;
}

/**
 * Calculates next_sync_eligible_at based on execution outcome and failure category:
 * - Success / no_change: +4 hours
 * - Reauth required / disconnected / ambiguous: null (indefinitely excluded until OAuth)
 * - Rate limit with valid future reset within 24h: resetAt + 1 minute
 * - Rate limit without valid reset: +60 minutes
 * - Transient failure, 5xx, timeout, database error, unknown outcome: +15 minutes
 */
export function calculateNextSyncEligibility(params: {
  success: boolean;
  noChange?: boolean;
  error?: unknown;
  now?: Date;
}): Date | null {
  const now = params.now || new Date();

  if (params.success) {
    return new Date(now.getTime() + 4 * 60 * 60 * 1000);
  }

  const err = params.error;
  if (!err) {
    return new Date(now.getTime() + 15 * 60 * 1000);
  }

  // Check for reauthorization or disconnect failures
  if (
    err instanceof AccountDisconnectedOrIneligibleError ||
    (err instanceof Error && err.name === 'GitHubReauthorizationRequiredError') ||
    (err instanceof Error && err.name === 'GitHubUnauthorizedError') ||
    (err instanceof Error && err.message.toLowerCase().includes('reauthoriz')) ||
    (err instanceof Error && err.message.toLowerCase().includes('disconnected'))
  ) {
    return null; // Excluded until OAuth reauthorization
  }

  // Check rate limit metadata
  const classified = classifyGitHubError(err);
  if (
    classified.category === 'PRIMARY_RATE_LIMIT' ||
    classified.category === 'SECONDARY_RATE_LIMIT'
  ) {
    const rawResetAt = (err as { rateLimit?: { resetAt?: Date | null } })?.rateLimit?.resetAt;
    const resetAt = rawResetAt || classified.rateLimit?.resetAt;
    if (resetAt) {
      const resetTime = new Date(resetAt).getTime();
      const diffMs = resetTime - now.getTime();
      if (diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000) {
        return new Date(resetTime + 60 * 1000); // reset + 1 min
      }
    }
    return new Date(now.getTime() + 60 * 60 * 1000); // 60 min fallback
  }

  // Permanent invalid request or permissions: exclude or set backoff
  if (classified.category === 'PERMISSION_DENIED') {
    return null; // Excluded until user updates permissions
  }

  // All other transient failures (transient network, timeout, 5xx, db error, unknown commit): 15 minutes
  return new Date(now.getTime() + 15 * 60 * 1000);
}

/**
 * Discovers accounts eligible for background synchronization using keyset pagination:
 * - User is not suspended
 * - GitHub account is connected
 * - Encrypted access token is present
 * - Token refresh status is NOT ambiguous
 * - next_sync_eligible_at IS NULL OR <= NOW() (unless forceSync is true)
 */
export async function discoverEligibleAccounts(
  db: Pool | PoolClient,
  options: {
    forceSync?: boolean;
    cursor?: string | null;
    limit: number;
  }
): Promise<DiscoveredAccount[]> {
  const res = await db.query<DiscoveredAccount>(
    `SELECT u.id, u.primary_handle, u.github_account_id
     FROM users u
     JOIN github_accounts ga ON ga.id = u.github_account_id
     WHERE u.is_suspended = FALSE
       AND ga.is_disconnected = FALSE
       AND ga.encrypted_access_token IS NOT NULL
       AND ga.token_refresh_status IS DISTINCT FROM 'ambiguous'
       AND ($1::BOOLEAN = TRUE OR u.next_sync_eligible_at IS NULL OR u.next_sync_eligible_at <= NOW())
       AND ($2::UUID IS NULL OR u.id > $2::UUID)
     ORDER BY u.id ASC
     LIMIT $3;`,
    [options.forceSync || false, options.cursor || null, options.limit]
  );
  return res.rows;
}

/**
 * Atomically acquires a per-user lease with an owner token and expiration TTL.
 */
export async function acquireUserSyncLease(
  db: Pool | PoolClient,
  userId: string,
  leaseOwner: string,
  leaseDurationSeconds: number = USER_SYNC_LEASE_TTL_SECONDS
): Promise<boolean> {
  const res = await db.query(
    `UPDATE users
     SET sync_lock_owner = $1,
         sync_lock_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
         last_sync_attempt_at = NOW()
     WHERE id = $3
       AND is_suspended = FALSE
       AND (sync_lock_expires_at IS NULL OR sync_lock_expires_at < NOW())
     RETURNING id;`,
    [leaseOwner, leaseDurationSeconds, userId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Releases the per-user lease and updates next_sync_eligible_at, strictly fenced by lease owner token.
 */
export async function releaseUserSyncLease(
  db: Pool | PoolClient,
  userId: string,
  leaseOwner: string,
  nextSyncEligibleAt: Date | null,
  lastSyncSuccessAt?: Date | null
): Promise<boolean> {
  const res = await db.query(
    `UPDATE users
     SET sync_lock_owner = NULL,
         sync_lock_expires_at = NULL,
         last_sync_success_at = COALESCE($1, last_sync_success_at),
         next_sync_eligible_at = $2
     WHERE id = $3
       AND sync_lock_owner = $4
     RETURNING id;`,
    [lastSyncSuccessAt || null, nextSyncEligibleAt, userId, leaseOwner]
  );
  return (res.rowCount ?? 0) > 0;
}

export interface ResolveCommitOutcomeOptions {
  pool: Pool;
  pollingBudgetMs?: number;
  pollIntervalMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Non-terminating passive backend liveness recovery for unresolved commit outcomes.
 * Rule: NEVER calls pg_terminate_backend.
 * Serializes resolution by row locking sync_transaction_attempts FOR UPDATE without holding
 * the lock during the polling sleep loop.
 */
export async function resolveUnknownCommitOutcome(
  userId: string,
  requestSequence: number,
  options: ResolveCommitOutcomeOptions
): Promise<'committed' | 'rolled_back' | 'unknown'> {
  const {
    pool,
    pollingBudgetMs = RECOVERY_POLL_BUDGET_MS,
    pollIntervalMs = RECOVERY_POLL_INTERVAL_MS,
    sleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  // 1. Initial check: Read attempt details
  const readRes = await pool.query<{
    user_id: string;
    request_sequence: string;
    batch_id: string;
    sync_date: string;
    payload_hash: string;
    backend_pid: number;
    backend_start: Date;
    attempt_status: string;
  }>(
    `SELECT user_id, request_sequence, batch_id, sync_date, payload_hash,
            backend_pid, backend_start, attempt_status
     FROM sync_transaction_attempts
     WHERE user_id = $1 AND request_sequence = $2;`,
    [userId, requestSequence]
  );

  if (readRes.rows.length === 0) {
    return 'unknown';
  }

  const initialAttempt = readRes.rows[0];
  if (initialAttempt.attempt_status === 'committed' || initialAttempt.attempt_status === 'rolled_back') {
    return initialAttempt.attempt_status as 'committed' | 'rolled_back';
  }

  const { backend_pid, backend_start } = initialAttempt;
  const recordedStartMs = new Date(backend_start).getTime();

  // 2. Passive backend liveness polling WITHOUT holding row lock
  const deadline = Date.now() + pollingBudgetMs;
  let backendActive = true;

  while (Date.now() <= deadline) {
    const actRes = await pool.query<{ pid: number; backend_start: Date }>(
      `SELECT pid, backend_start
       FROM pg_stat_activity
       WHERE pid = $1;`,
      [backend_pid]
    );

    if (actRes.rows.length === 0) {
      backendActive = false;
      break;
    }

    const currentStartMs = new Date(actRes.rows[0].backend_start).getTime();
    if (currentStartMs !== recordedStartMs) {
      // PID reuse: A different backend process has reused this PID -> original backend is terminated
      backendActive = false;
      break;
    }

    // Backend is still alive; wait before next poll
    await sleepFn(pollIntervalMs);
  }

  // 3. Serialized resolution transaction under FOR UPDATE row lock
  const client = await pool.connect();
  try {
    await client.query('BEGIN;');

    const lockRes = await client.query<{
      user_id: string;
      request_sequence: string;
      batch_id: string;
      sync_date: string;
      payload_hash: string;
      attempt_status: string;
    }>(
      `SELECT user_id, request_sequence, batch_id, sync_date, payload_hash, attempt_status
       FROM sync_transaction_attempts
       WHERE user_id = $1 AND request_sequence = $2
       FOR UPDATE;`,
      [userId, requestSequence]
    );

    if (lockRes.rows.length === 0) {
      await client.query('COMMIT;');
      return 'unknown';
    }

    const lockedAttempt = lockRes.rows[0];
    if (lockedAttempt.attempt_status === 'committed' || lockedAttempt.attempt_status === 'rolled_back') {
      await client.query('COMMIT;');
      return lockedAttempt.attempt_status as 'committed' | 'rolled_back';
    }

    // If backend was still active after polling budget, defer resolution without terminating
    if (backendActive) {
      await client.query(
        `UPDATE sync_transaction_attempts
         SET attempt_status = 'unknown',
             resolution_notes = 'Original backend still active after polling budget; deferred'
         WHERE user_id = $1 AND request_sequence = $2;`,
        [userId, requestSequence]
      );
      await client.query('COMMIT;');
      return 'unknown';
    }

    // Backend is confirmed terminated. Inspect exact transaction receipt.
    const receiptRes = await client.query<{
      user_id: string;
      request_sequence: string;
      batch_id: string;
      sync_date: string;
      payload_hash: string;
      outcome: string;
    }>(
      `SELECT user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
       FROM sync_transaction_receipts
       WHERE user_id = $1 AND request_sequence = $2;`,
      [userId, requestSequence]
    );

    if (receiptRes.rows.length > 0) {
      const receipt = receiptRes.rows[0];
      const receiptDate = new Date(receipt.sync_date).toISOString().slice(0, 10);
      const attemptDate = new Date(initialAttempt.sync_date).toISOString().slice(0, 10);

      // Verify all 5 identity fields match
      const isExactMatch =
        receipt.user_id === initialAttempt.user_id &&
        BigInt(receipt.request_sequence) === BigInt(initialAttempt.request_sequence) &&
        receipt.batch_id === initialAttempt.batch_id &&
        receiptDate === attemptDate &&
        receipt.payload_hash === initialAttempt.payload_hash;

      if (!isExactMatch) {
        await client.query(
          `UPDATE sync_transaction_attempts
           SET attempt_status = 'unknown',
               resolution_notes = 'Integrity violation: receipt exists but identity fields do not match'
           WHERE user_id = $1 AND request_sequence = $2;`,
          [userId, requestSequence]
        );
        await client.query('COMMIT;');
        return 'unknown';
      }

      await client.query(
        `UPDATE sync_transaction_attempts
         SET attempt_status = 'committed',
             resolved_at = NOW(),
             resolution_notes = 'Resolved committed via verified matching receipt'
         WHERE user_id = $1 AND request_sequence = $2;`,
        [userId, requestSequence]
      );
      await client.query('COMMIT;');
      return 'committed';
    } else {
      await client.query(
        `UPDATE sync_transaction_attempts
         SET attempt_status = 'rolled_back',
             resolved_at = NOW(),
             resolution_notes = 'Resolved rolled_back: backend confirmed terminated and receipt absent'
         WHERE user_id = $1 AND request_sequence = $2;`,
        [userId, requestSequence]
      );
      await client.query('COMMIT;');
      return 'rolled_back';
    }
  } catch (err) {
    try {
      await client.query('ROLLBACK;');
    } catch {}
    throw err;
  } finally {
    client.release();
  }
}

interface WorkerExecutionContext {
  batchId: string;
  batchGeneration: number;
  user: DiscoveredAccount;
  targetDate: string;
  options: BackgroundSyncOptions;
  pool: Pool;
  nowFn: () => number;
  isAborted: () => boolean;
}

/**
 * Executes synchronization for a single user under bounded execution deadline:
 * 1. Acquires atomic per-user lease.
 * 2. Allocates sequence before external request.
 * 3. Fetches snapshot outside DB transaction.
 * 4. Checks out dedicated connection for backend PID identity.
 * 5. Tx 0: Inserts attempt record with backend identity and commits.
 * 6. Tx 1 (same connection): Checks locks -1 through 3, processes reconciliation, inserts receipt, and commits.
 * 7. Releases lease and records outcome metrics.
 */
async function executeSingleUserSync(
  ctx: WorkerExecutionContext,
  metrics: BatchAccountingMetrics
): Promise<void> {
  const {
    batchId,
    batchGeneration,
    user,
    targetDate,
    options,
    pool,
    nowFn,
    isAborted,
  } = ctx;

  const perUserDeadlineMs = options.perUserDeadlineMs || DEFAULT_PER_USER_DEADLINE_MS;
  const userStartMonotonic = nowFn();
  const userDeadlineMonotonic = userStartMonotonic + perUserDeadlineMs;

  const leaseOwner = `${batchId.replace(/-/g, '').slice(0, 16)}:${user.id.replace(/-/g, '')}:${randomUUID().replace(/-/g, '').slice(0, 14)}`;
  metrics.leaseAcquisitionAttempts++;

  // Step 1: Acquire per-user lease
  let leaseAcquired = false;
  try {
    leaseAcquired = await acquireUserSyncLease(pool, user.id, leaseOwner, USER_SYNC_LEASE_TTL_SECONDS);
  } catch {
    metrics.leaseAcquisitionErrors++;
    return;
  }

  if (!leaseAcquired) {
    metrics.skippedContended++;
    return;
  }

  metrics.accountsAttempted++;

  let syncSuccess = false;
  let isNoChange = false;
  let caughtError: unknown = null;
  let requestSequence: number | null = null;

  try {
    if (isAborted()) {
      throw new AdvisoryLockLostError();
    }

    // Step 2: Allocate request sequence BEFORE external network call
    requestSequence = await SyncRepository.allocateSnapshotSequence(user.id);

    // Step 3: Fetch GitHub snapshot outside of database connection
    const remainingForHttp = Math.max(0, userDeadlineMonotonic - nowFn() - PRE_COMMIT_SAFETY_MARGIN_MS - 500);
    if (remainingForHttp < 500) {
      throw new WorkerTimeoutError('Insufficient time budget for snapshot fetch');
    }

    const { from, to } = getUtcDayBoundaries(targetDate);
    const fetcher = options.snapshotFetcher || fetchContributionSnapshot;

    const snapshot = await fetcher({
      userId: user.id,
      from,
      to,
      requestOptions: {
        correlationId: batchId,
        timeoutMs: remainingForHttp,
      },
    });

    const observedPublicTotal = snapshot.contributions.publicTotal;
    const observedAt = snapshot.retrievedAt;
    const payloadHash = computePayloadHash({
      userId: user.id,
      syncDate: targetDate,
      observedPublicTotal,
      requestSequence,
    });

    if (nowFn() > userDeadlineMonotonic - PRE_COMMIT_SAFETY_MARGIN_MS) {
      throw new WorkerTimeoutError('Deadline budget exhausted before dedicated connection check-out');
    }

    // Step 4: Check out dedicated worker connection
    // MANDATORY INVARIANT: Tx 0 and Tx 1 MUST use this exact same connection
    const workerClient = await pool.connect();
    let clientDestroyed = false;

    try {
      // Read backend identity on this connection
      const idRes = await workerClient.query<{ pid: number; backend_start: Date }>(
        `SELECT pg_backend_pid() AS pid, backend_start
         FROM pg_stat_activity
         WHERE pid = pg_backend_pid();`
      );
      const backendPid = Number(idRes.rows[0].pid);
      const backendStart = new Date(idRes.rows[0].backend_start);

      // Step 5: Transaction 0 (Durable Attempt Persistence)
      await workerClient.query('BEGIN;');
      await workerClient.query(
        `INSERT INTO sync_transaction_attempts (
           user_id, request_sequence, batch_id, sync_date, payload_hash,
           backend_pid, backend_start, attempt_status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'dispatched');`,
        [user.id, requestSequence, batchId, targetDate, payloadHash, backendPid, backendStart]
      );
      await workerClient.query('COMMIT;');

      if (nowFn() > userDeadlineMonotonic - PRE_COMMIT_SAFETY_MARGIN_MS) {
        throw new WorkerTimeoutError('Deadline budget exhausted before Transaction 1');
      }

      // Step 6: Transaction 1 (Reconciliation & Exact Receipt)
      // Executed on the EXACT SAME dedicated workerClient!
      await workerClient.query('BEGIN;');

      // Lock -1: Batch coordination check
      const coordRes = await workerClient.query<{ active_batch_id: string; active_generation: string }>(
        'SELECT active_batch_id, active_generation FROM sync_batch_coordination WHERE id = 1 FOR SHARE;'
      );
      if (
        coordRes.rows.length === 0 ||
        coordRes.rows[0].active_batch_id !== batchId ||
        BigInt(coordRes.rows[0].active_generation) !== BigInt(batchGeneration)
      ) {
        await workerClient.query('ROLLBACK;');
        throw new BatchFencedStaleError();
      }

      // Lock 0A: User existence and suspension check
      const userRes = await workerClient.query<{ id: string; is_suspended: boolean; github_account_id: string }>(
        'SELECT id, is_suspended, github_account_id FROM users WHERE id = $1 FOR UPDATE;',
        [user.id]
      );
      if (userRes.rows.length === 0 || userRes.rows[0].is_suspended) {
        await workerClient.query('ROLLBACK;');
        throw new UserIneligibleError();
      }

      // Lock 0B: GitHub Account connection and token check
      const gaRes = await workerClient.query<{
        id: string;
        is_disconnected: boolean;
        encrypted_access_token: string | null;
        token_refresh_status: string | null;
      }>(
        `SELECT id, is_disconnected, encrypted_access_token, token_refresh_status
         FROM github_accounts
         WHERE id = $1
         FOR UPDATE;`,
        [userRes.rows[0].github_account_id]
      );
      if (
        gaRes.rows.length === 0 ||
        gaRes.rows[0].is_disconnected ||
        !gaRes.rows[0].encrypted_access_token ||
        gaRes.rows[0].token_refresh_status === 'ambiguous'
      ) {
        await workerClient.query('ROLLBACK;');
        throw new AccountDisconnectedOrIneligibleError();
      }

      // Locks 1 through 3 & Reconciliation via processContributionSync
      const syncResult: DailyContributionSyncResult = await SyncRepository.processContributionSync(
        user.id,
        targetDate,
        observedPublicTotal,
        {
          observedAt,
          requestSequence,
          payloadHash,
          existingClient: workerClient,
        }
      );

      // Determine receipt outcome
      const outcome: 'applied' | 'no_change' | 'stale' =
        syncResult.newlyObservedIncrements > 0
          ? 'applied'
          : syncResult.isStale
            ? 'stale'
            : 'no_change';

      // Insert exact transaction receipt atomically
      await workerClient.query(
        `INSERT INTO sync_transaction_receipts (
           user_id, request_sequence, batch_id, sync_date, payload_hash, outcome
         ) VALUES ($1, $2, $3, $4, $5, $6);`,
        [user.id, requestSequence, batchId, targetDate, payloadHash, outcome]
      );

      // Pre-commit deadline check
      if (nowFn() > userDeadlineMonotonic - PRE_COMMIT_SAFETY_MARGIN_MS) {
        await workerClient.query('ROLLBACK;');
        throw new WorkerTimeoutError('Deadline budget exhausted before commit');
      }

      // Hook for test simulation (e.g. simulated connection loss or delay)
      if (options.preCommitHook) {
        await options.preCommitHook({
          userId: user.id,
          requestSequence,
          batchId,
          workerClient,
        });
      }

      // COMMIT Transaction 1
      await workerClient.query('COMMIT;');

      syncSuccess = true;
      isNoChange = outcome === 'no_change' || outcome === 'stale';

      // Update attempt status to committed
      await workerClient.query(
        `UPDATE sync_transaction_attempts
         SET attempt_status = 'committed', resolved_at = NOW()
         WHERE user_id = $1 AND request_sequence = $2;`,
        [user.id, requestSequence]
      );

      if (outcome === 'applied') {
        metrics.successfulSyncs++;
      } else {
        metrics.noChangeSyncs++;
      }

      metrics.totalXpAwarded += syncResult.reward.xpAwarded;
      metrics.pendingRewardsProcessed += syncResult.reward.processedIncrements;
      metrics.expiredSlicesProcessed += syncResult.reward.forfeitedIncrements;
    } catch (txErr: unknown) {
      caughtError = txErr;
      const isSocketOrCommitLoss =
        txErr instanceof CommitOutcomeUnknownError ||
        (txErr instanceof Error &&
          (txErr.message.includes('Connection terminated') ||
            txErr.message.includes('ECONNRESET') ||
            txErr.message.includes('socket')));

      if (isSocketOrCommitLoss && requestSequence !== null) {
        clientDestroyed = true;
        // Attempt outcome is unknown -> invoke recovery state machine
        try {
          const resolved = await resolveUnknownCommitOutcome(user.id, requestSequence, {
            pool,
            sleepFn: options.sleepFn,
          });
          if (resolved === 'committed') {
            metrics.successfulSyncs++;
            syncSuccess = true;
          } else if (resolved === 'rolled_back') {
            metrics.failedSyncs++;
          } else {
            metrics.commitOutcomeUnknown++;
          }
        } catch {
          metrics.commitOutcomeUnknown++;
        }
      } else {
        // Known rollback before commit
        if (!clientDestroyed) {
          try {
            await workerClient.query('ROLLBACK;');
          } catch {}
          if (requestSequence !== null) {
            try {
              await workerClient.query(
                `UPDATE sync_transaction_attempts
                 SET attempt_status = 'rolled_back',
                     resolved_at = NOW(),
                     resolution_notes = $1
                 WHERE user_id = $2 AND request_sequence = $3;`,
                [(txErr as Error).message || 'Rolled back due to error', user.id, requestSequence]
              );
            } catch {}
          }
        }
        metrics.failedSyncs++;
      }
    } finally {
      if (!clientDestroyed) {
        workerClient.release();
      }
    }
  } catch (outerErr: unknown) {
    caughtError = outerErr;
    metrics.failedSyncs++;
  } finally {
    // Categorize failure in secondary metrics if not successful
    if (!syncSuccess && caughtError) {
      if (caughtError instanceof BatchFencedStaleError) {
        metrics.fencedStaleAccounts++;
      } else if (
        caughtError instanceof WorkerTimeoutError ||
        (caughtError instanceof Error && caughtError.name === 'GitHubTimeoutError')
      ) {
        metrics.timedOutAccounts++;
      } else if (
        caughtError instanceof AccountDisconnectedOrIneligibleError ||
        caughtError instanceof UserIneligibleError ||
        (caughtError instanceof Error && caughtError.name === 'GitHubReauthorizationRequiredError') ||
        (caughtError instanceof Error && caughtError.name === 'GitHubUnauthorizedError')
      ) {
        metrics.reauthRequiredAccounts++;
      } else {
        const classified = classifyGitHubError(caughtError);
        if (
          classified.category === 'PRIMARY_RATE_LIMIT' ||
          classified.category === 'SECONDARY_RATE_LIMIT'
        ) {
          metrics.rateLimitedAccounts++;
        }
      }
    }

    // Owner-fenced release of per-user lease and schedule update
    const nextEligible = calculateNextSyncEligibility({
      success: syncSuccess,
      noChange: isNoChange,
      error: caughtError,
      now: new Date(),
    });

    try {
      await releaseUserSyncLease(
        pool,
        user.id,
        leaseOwner,
        nextEligible,
        syncSuccess ? new Date() : null
      );
    } catch {}
  }
}

/**
 * Main Background Contribution Sync Orchestration Service entry point.
 */
export async function executeBackgroundContributionSync(
  options: BackgroundSyncOptions = {}
): Promise<BackgroundBatchRunResult> {
  const pool = options.customPool || getPool();
  const maxBatchDurationMs = options.maxBatchDurationMs || DEFAULT_MAX_BATCH_DURATION_MS;
  const batchSafetyMarginMs = options.batchSafetyMarginMs || DEFAULT_BATCH_SAFETY_MARGIN_MS;
  const maxAccounts = options.maxAccountsPerBatch || DEFAULT_MAX_ACCOUNTS;
  const maxConcurrency = Math.min(options.maxConcurrency || DEFAULT_MAX_CONCURRENCY, 10);
  const nowFn = options.nowFn || (() => performance.now());

  const targetDate = validateAndCanonicalizeUtcDate(options.targetDate);
  const batchStartMonotonic = nowFn();
  const batchCutoffMonotonic = batchStartMonotonic + (maxBatchDurationMs - batchSafetyMarginMs);

  const metrics: BatchAccountingMetrics = {
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
  };

  // Step 1: Check out dedicated connection for global batch advisory lock
  const advClient = options.overrideAdvClient || (await pool.connect());
  let advisoryHeld = false;
  let advisoryLost = false;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  const batchId = randomUUID();
  let batchGeneration = 1;

  const onAdvError = () => {
    advisoryLost = true;
  };
  advClient.on('error', onAdvError);
  advClient.on('end', onAdvError);

  try {
    // Step 2: Acquire session-level PostgreSQL advisory lock
    const lockRes = await advClient.query<{ pg_try_advisory_lock: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock;',
      [GLOBAL_ADVISORY_LOCK_ID]
    );

    if (!lockRes.rows[0]?.pg_try_advisory_lock) {
      // Contention: Another batch is actively coordinating!
      // Record deferred_contention in sync_batch_runs
      await advClient.query(
        `INSERT INTO sync_batch_runs (
           batch_id, batch_generation, status, started_at, completed_at, duration_ms, error_message
         ) VALUES ($1, 0, 'deferred_contention', NOW(), NOW(), 0, 'Advisory lock contention: batch deferred');`,
        [batchId]
      );
      return {
        batchId,
        batchGeneration: 0,
        status: 'deferred_contention',
        metrics,
        durationMs: Math.round(nowFn() - batchStartMonotonic),
        errorMessage: 'Advisory lock contention: batch deferred',
      };
    }

    advisoryHeld = true;

    // Step 3: Advance durable generation in sync_batch_coordination
    const genRes = await advClient.query<{ active_generation: string }>(
      `UPDATE sync_batch_coordination
       SET active_batch_id = $1,
           active_generation = active_generation + 1,
           updated_at = NOW()
       WHERE id = 1
       RETURNING active_generation;`,
      [batchId]
    );
    batchGeneration = Number(genRes.rows[0].active_generation);

    if (options.onAdvisoryAcquired) {
      await options.onAdvisoryAcquired(batchId, batchGeneration);
    }

    // Step 4: Stale batch recovery (under advisory lock)
    await advClient.query(
      `UPDATE sync_batch_runs
       SET status = 'interrupted',
           completed_at = NOW(),
           error_message = 'Interrupted by new batch coordinator'
       WHERE status = 'running';`
    );

    // Step 5: Record running batch in sync_batch_runs
    await advClient.query(
      `INSERT INTO sync_batch_runs (
         batch_id, batch_generation, status, started_at, last_heartbeat_at
       ) VALUES ($1, $2, 'running', NOW(), NOW());`,
      [batchId, batchGeneration]
    );

    // Step 6: Start periodic heartbeat
    heartbeatTimer = setInterval(() => {
      advClient
        .query(
          `UPDATE sync_batch_runs
           SET last_heartbeat_at = NOW()
           WHERE batch_id = $1 AND status = 'running';`,
          [batchId]
        )
        .catch(() => {});
    }, 5000);
    heartbeatTimer.unref?.();

    // Step 7: Account Discovery via Keyset Pagination
    const discoveredList: DiscoveredAccount[] = [];
    let cursor: string | null = null;

    while (discoveredList.length < maxAccounts) {
      const remainingLimit = maxAccounts - discoveredList.length;
      const batch = await discoverEligibleAccounts(pool, {
        forceSync: options.forceSync,
        cursor,
        limit: Math.min(remainingLimit, 25),
      });

      if (batch.length === 0) break;
      for (const item of batch) {
        discoveredList.push(item);
      }
      cursor = batch[batch.length - 1].id;
    }

    metrics.accountsDiscovered = discoveredList.length;

    // Step 8: Bounded Concurrency Worker Dispatch
    const isAborted = () => advisoryLost || nowFn() >= batchStartMonotonic + maxBatchDurationMs;
    const queue = [...discoveredList];
    const activeWorkers: Promise<void>[] = [];

    const workerLoop = async () => {
      while (queue.length > 0) {
        if (isAborted()) break;

        // Check if cutoff reached before dispatching
        if (nowFn() >= batchCutoffMonotonic) {
          // Defer all remaining queued accounts
          metrics.deferredLimit += queue.length;
          queue.length = 0;
          break;
        }

        const user = queue.shift();
        if (!user) break;

        await executeSingleUserSync(
          {
            batchId,
            batchGeneration,
            user,
            targetDate,
            options,
            pool,
            nowFn,
            isAborted,
          },
          metrics
        );
      }
    };

    const actualConcurrency = Math.min(maxConcurrency, Math.max(1, discoveredList.length));
    for (let i = 0; i < actualConcurrency; i++) {
      activeWorkers.push(workerLoop());
    }

    await Promise.all(activeWorkers);

    // Any accounts that remained in queue due to abort/cutoff
    if (queue.length > 0) {
      metrics.deferredLimit += queue.length;
      queue.length = 0;
    }

    // Step 9: Determine Final Batch Status
    let finalStatus: BatchRunStatus;
    if (advisoryLost) {
      finalStatus = 'interrupted';
    } else if (metrics.failedSyncs === 0 && metrics.commitOutcomeUnknown === 0) {
      finalStatus = 'completed';
    } else if (metrics.successfulSyncs > 0 || metrics.noChangeSyncs > 0) {
      finalStatus = 'partially_completed';
    } else {
      finalStatus = metrics.accountsAttempted === 0 ? 'completed' : 'failed';
    }

    const durationMs = Math.round(nowFn() - batchStartMonotonic);

    // Step 10: Persist Final Batch Run Record
    await advClient.query(
      `UPDATE sync_batch_runs
       SET status = $1,
           completed_at = NOW(),
           accounts_discovered = $2,
           lease_acquisition_attempts = $3,
           accounts_attempted = $4,
           successful_syncs = $5,
           no_change_syncs = $6,
           failed_syncs = $7,
           commit_outcome_unknown = $8,
           skipped_contended = $9,
           lease_acquisition_errors = $10,
           deferred_limit = $11,
           rate_limited_accounts = $12,
           reauth_required_accounts = $13,
           timed_out_accounts = $14,
           fenced_stale_accounts = $15,
           pending_rewards_processed = $16,
           expired_slices_processed = $17,
           total_xp_awarded = $18,
           duration_ms = $19,
           error_message = $20
       WHERE batch_id = $21;`,
      [
        finalStatus,
        metrics.accountsDiscovered,
        metrics.leaseAcquisitionAttempts,
        metrics.accountsAttempted,
        metrics.successfulSyncs,
        metrics.noChangeSyncs,
        metrics.failedSyncs,
        metrics.commitOutcomeUnknown,
        metrics.skippedContended,
        metrics.leaseAcquisitionErrors,
        metrics.deferredLimit,
        metrics.rateLimitedAccounts,
        metrics.reauthRequiredAccounts,
        metrics.timedOutAccounts,
        metrics.fencedStaleAccounts,
        metrics.pendingRewardsProcessed,
        metrics.expiredSlicesProcessed,
        metrics.totalXpAwarded,
        durationMs,
        advisoryLost ? 'Advisory lock lost during batch execution' : null,
        batchId,
      ]
    );

    return {
      batchId,
      batchGeneration,
      status: finalStatus,
      metrics,
      durationMs,
      errorMessage: advisoryLost ? 'Advisory lock lost during batch execution' : null,
    };
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (advisoryHeld) {
      try {
        await advClient.query('SELECT pg_advisory_unlock($1);', [GLOBAL_ADVISORY_LOCK_ID]);
      } catch {}
    }
    advClient.removeListener('error', onAdvError);
    advClient.removeListener('end', onAdvError);
    if (!options.overrideAdvClient) {
      advClient.release();
    }
  }
}
