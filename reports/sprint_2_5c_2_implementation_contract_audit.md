# Sprint 2.5C.2 — Background Sync Implementation Contract Audit Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Database:** Native PostgreSQL 16.15 (x64 Windows)  
**Mode:** Read-only architecture and implementation audit  
**Status:** **AUDIT COMPLETE**  
**Final Verdict:** **APPROVED**

---

## 1. Executive Summary

This audit independently inspects the actual Sprint 2.5C source code, database migrations (001–010), and integration test suites against the approved Sprint 2.5A.7 architecture and Sprint 2.5C implementation contract.

Sprint 2.5C.1 confirmed that all 26 native PostgreSQL orchestration integration tests, 200 repository integration tests, and 121 unit tests pass cleanly, and the production Next.js application compiles without errors. However, discrepancies were noted in the Sprint 2.5C implementation report regarding schema table names, column names, lease duration, and batch accounting equations.

### Key Audit Finding
Every identified discrepancy between the Sprint 2.5C implementation report and the system was a **documentation inaccuracy in the report text itself**. The **actual source code** (`src/lib/sync/backgroundSyncCoordinator.ts`), the **database schema** (`migrations/010_background_sync_infrastructure.sql`), and the **test suite** (`tests/integration/backgroundSyncOrchestrationIntegration.test.ts`) **strictly conform to the approved Sprint 2.5A.7 architecture**:
1. The 60-second lease duration is strictly enforced in code (`USER_SYNC_LEASE_TTL_SECONDS = 60`).
2. Per-user lease and scheduling columns reside on `users` (as defined in Migration 010); non-existent tables like `sync_schedules` are neither defined nor referenced anywhere in code.
3. The exact 3-equation closed batch accounting system is mathematically implemented, persisted in `sync_batch_runs`, and validated.
4. Transaction 0 and Transaction 1 use the exact same dedicated PostgreSQL connection without pooling release.
5. All 5 identity fields match identically across attempts and receipts.
6. The coordination fence `SELECT ... FOR SHARE` and the global lock hierarchy $\text{Lock -1} \to \text{Lock 0A} \to \text{Lock 0B} \to \text{Lock 1} \to \text{Lock 2} \to \text{Lock 3}$ are strictly followed.
7. Zero calls to `pg_terminate_backend` exist in the codebase.

---

## 2. Actual Database Schema Inventory

A comprehensive inspection of migrations 001–010 and the native PostgreSQL database was performed:

| Feature / Domain | Migration | Real Table | Real Columns & Constraints | Audit Verification Status |
|---|---|---|---|---|
| **User Suspension** | 001 | `users` | `is_suspended BOOLEAN NOT NULL DEFAULT FALSE` | **VERIFIED** |
| **GitHub Disconnect** | 001 | `github_accounts` | `is_disconnected BOOLEAN NOT NULL DEFAULT FALSE` | **VERIFIED** |
| **Encrypted Access Token** | 001 | `github_accounts` | `encrypted_access_token TEXT` | **VERIFIED** |
| **Token Refresh Status** | 006 | `github_accounts` | `token_refresh_status VARCHAR(32) NOT NULL DEFAULT 'idle'` | **VERIFIED** |
| **Sync Scheduling & Lease** | 010 | `users` | `last_sync_attempt_at TIMESTAMPTZ`, `last_sync_success_at TIMESTAMPTZ`, `next_sync_eligible_at TIMESTAMPTZ`, `sync_lock_owner VARCHAR(64)`, `sync_lock_expires_at TIMESTAMPTZ` | **VERIFIED** |
| **Batch Coordination** | 010 | `sync_batch_coordination` | `id INTEGER PRIMARY KEY CHECK (id = 1)`, `active_batch_id UUID NOT NULL`, `active_generation BIGINT NOT NULL DEFAULT 1`, `updated_at TIMESTAMPTZ` | **VERIFIED** |
| **Transaction Attempts** | 010 | `sync_transaction_attempts` | `id UUID`, `user_id UUID REFERENCES users(id)`, `request_sequence BIGINT`, `batch_id UUID`, `sync_date DATE`, `payload_hash VARCHAR(64)`, `backend_pid INTEGER`, `backend_start TIMESTAMPTZ`, `attempt_status VARCHAR(32)`, `UQ (user_id, request_sequence)` | **VERIFIED** |
| **Transaction Receipts** | 010 | `sync_transaction_receipts` | `id UUID`, `user_id UUID REFERENCES users(id)`, `request_sequence BIGINT`, `batch_id UUID`, `sync_date DATE`, `payload_hash VARCHAR(64)`, `outcome VARCHAR(32)`, `committed_at TIMESTAMPTZ`, `UQ (user_id, request_sequence)` | **VERIFIED** |
| **Batch Run Accounting** | 010 | `sync_batch_runs` | `batch_id UUID UNIQUE`, `batch_generation BIGINT`, `status VARCHAR(32)`, `accounts_discovered INTEGER`, `lease_acquisition_attempts INTEGER`, `accounts_attempted INTEGER`, `successful_syncs INTEGER`, `no_change_syncs INTEGER`, `failed_syncs INTEGER`, `commit_outcome_unknown INTEGER`, `skipped_contended INTEGER`, `lease_acquisition_errors INTEGER`, `deferred_limit INTEGER` | **VERIFIED** |

### Explicit Determination of Non-Existent Schema Artifacts:
- **`sync_schedules` table:** **DOES NOT EXIST**. All scheduling and lease fields are located directly on the `users` table (`migrations/010_background_sync_infrastructure.sql:18-23`).
- **`sync_status` column:** **DOES NOT EXIST**. Active/inactive account status is modeled via `users.is_suspended = FALSE` and `github_accounts.is_disconnected = FALSE`.
- **`sync_lock_acquired_at` column:** **DOES NOT EXIST**. The schema maintains `users.last_sync_attempt_at` and `users.sync_lock_expires_at`.

---

## 3. Account Eligibility Verification

### Actual Discovery Query Inspection
In `src/lib/sync/backgroundSyncCoordinator.ts` (lines 251–265):
```sql
SELECT u.id, u.primary_handle, u.github_account_id
FROM users u
JOIN github_accounts ga ON ga.id = u.github_account_id
WHERE u.is_suspended = FALSE
  AND ga.is_disconnected = FALSE
  AND ga.encrypted_access_token IS NOT NULL
  AND ga.token_refresh_status IS DISTINCT FROM 'ambiguous'
  AND ($1::BOOLEAN = TRUE OR u.next_sync_eligible_at IS NULL OR u.next_sync_eligible_at <= NOW())
  AND ($2::UUID IS NULL OR u.id > $2::UUID)
ORDER BY u.id ASC
LIMIT $3;
```

### Invariants Confirmed:
1. **Suspension Check:** `u.is_suspended = FALSE` is strictly enforced in both discovery and worker Lock 0A (`backgroundSyncCoordinator.ts:666-673`).
2. **Disconnection Check:** `ga.is_disconnected = FALSE` is strictly enforced in discovery and worker Lock 0B (`backgroundSyncCoordinator.ts:682-696`).
3. **Token Presence:** `ga.encrypted_access_token IS NOT NULL` is enforced in discovery and Lock 0B.
4. **Ambiguous Status Exclusion:** `ga.token_refresh_status IS DISTINCT FROM 'ambiguous'` strictly excludes ambiguous accounts from discovery. In addition, Lock 0B checks `gaRes.rows[0].token_refresh_status === 'ambiguous'` and aborts Transaction 1 with `AccountDisconnectedOrIneligibleError`.
5. **Eligibility Window:** `u.next_sync_eligible_at IS NULL OR u.next_sync_eligible_at <= NOW()` respects the backoff schedule.
6. **OAuth Reauthorization Recovery:**
   - In `src/lib/db/repositories/userRepository.ts` (lines 544–615), `UserRepository.updateTokens` (invoked during browser OAuth callback) executes:
     ```sql
     UPDATE github_accounts
     SET token_refresh_locked_at = NULL,
         token_refresh_owner = NULL,
         token_refresh_status = 'idle',
         token_refresh_dispatched_at = NULL,
         token_refresh_dispatched_version = NULL,
         token_version = token_version + 1,
         updated_at = NOW()
     ...
     ```
   - This atomically clears the `'ambiguous'` state and sets `token_refresh_status = 'idle'`, immediately restoring background sync eligibility.

**Requirement Status:** **VERIFIED**

---

## 4. Lease Duration and Ownership Semantics

### Actual Lease Acquisition Inspection
In `src/lib/sync/backgroundSyncCoordinator.ts`:
- Line 34: `export const USER_SYNC_LEASE_TTL_SECONDS = 60;`
- Line 275: `leaseDurationSeconds: number = USER_SYNC_LEASE_TTL_SECONDS`
- Line 560: `acquireUserSyncLease(pool, user.id, leaseOwner, USER_SYNC_LEASE_TTL_SECONDS)`
- SQL query (`backgroundSyncCoordinator.ts:278-287`):
  ```sql
  UPDATE users
  SET sync_lock_owner = $1,
      sync_lock_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
      last_sync_attempt_at = NOW()
  WHERE id = $3
    AND is_suspended = FALSE
    AND (sync_lock_expires_at IS NULL OR sync_lock_expires_at < NOW())
  RETURNING id;
  ```

### Audit Findings:
1. **Duration:** The actual code uses **60 seconds**, exactly matching the approved architecture. The "10 minutes" mention in the previous report was an errant text typo.
2. **Owner Token Construction:**
   - Line 554:
     ```typescript
     const leaseOwner = `${batchId.replace(/-/g, '').slice(0, 16)}:${user.id.replace(/-/g, '')}:${randomUUID().replace(/-/g, '').slice(0, 14)}`;
     ```
   - Length: Exactly 64 characters ($16 + 1 + 32 + 1 + 14 = 64$).
   - Fits the `VARCHAR(64)` constraint without overflow.
3. **Owner-Fenced Release:**
   - Line 301–312:
     ```sql
     UPDATE users
     SET sync_lock_owner = NULL,
         sync_lock_expires_at = NULL,
         last_sync_success_at = COALESCE($1, last_sync_success_at),
         next_sync_eligible_at = $2
     WHERE id = $3
       AND sync_lock_owner = $4
     RETURNING id;
     ```
   - Only the exact token owner can release the lease or update `next_sync_eligible_at`. Foreign or expired owners cannot modify state.
   - Verified by integration test 7 (`foreign owner cannot release lease`).

**Requirement Status:** **VERIFIED**

---

## 5. Transaction & Connection Ownership Verification

### Dedicated Connection Lifecycle
In `src/lib/sync/backgroundSyncCoordinator.ts` (lines 618–819):
1. **Connection Checkout:**
   - Line 620: `const workerClient = await pool.connect();`
   - A single dedicated `PoolClient` is checked out for the worker.
2. **Backend Identity Registration:**
   - Lines 625–631: Dedicated connection executes `SELECT pg_backend_pid() AS pid, backend_start FROM pg_stat_activity WHERE pid = pg_backend_pid();`.
3. **Transaction 0 (Attempt Persistence):**
   - Lines 634–642: `workerClient` executes `BEGIN;`, inserts into `sync_transaction_attempts` (`attempt_status = 'dispatched'`), and executes `COMMIT;`.
4. **No Connection Release Between Tx 0 and Tx 1:**
   - `workerClient` is **retained continuously**; it is NOT returned to the pool.
5. **Transaction 1 (Reconciliation & Exact Receipt):**
   - Lines 650–744: `workerClient` executes `BEGIN;`, evaluates Lock -1, Lock 0A, Lock 0B, invokes `processContributionSync({ existingClient: workerClient })`, inserts the exact receipt, checks pre-commit deadline, and executes `COMMIT;`.
6. **Five-Field Identity Verification:**
   - Both `sync_transaction_attempts` and `sync_transaction_receipts` record and validate all 5 fields:
     - `user_id` (UUID)
     - `request_sequence` (BIGINT)
     - `batch_id` (UUID)
     - `sync_date` (DATE)
     - `payload_hash` (VARCHAR(64))
   - In `resolveUnknownCommitOutcome` (lines 463–469), all 5 fields must match identically; any mismatch is flagged as an integrity violation and remains `unknown`.
7. **Disjoint Unknown Outcomes:**
   - Lost commit acknowledgements trigger `resolveUnknownCommitOutcome`.
   - Confirmed commits update `attempt_status = 'committed'` and increment `metrics.successfulSyncs`.
   - Confirmed rollbacks update `attempt_status = 'rolled_back'` and increment `metrics.failedSyncs`.
   - Unresolved/active backends retain `attempt_status = 'unknown'` and increment `metrics.commitOutcomeUnknown`.
   - The three states remain strictly disjoint.

**Requirement Status:** **VERIFIED**

---

## 6. Generation Fencing & Lock Hierarchy Verification

### Generation Fence Implementation
In `src/lib/sync/backgroundSyncCoordinator.ts` (lines 653–664):
```typescript
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
```

### Invariants Confirmed:
1. **`FOR SHARE` Locking:** The row lock on `sync_batch_coordination` is held for the entire duration of Transaction 1 until `workerClient.query('COMMIT;')`.
2. **Fencing Block:** If a new batch coordinator begins, its `UPDATE sync_batch_coordination ...` blocks on the `FOR SHARE` lock until in-flight workers commit.
3. **Stale Generation Rejection:** Once a new coordinator updates `active_generation`, any late worker attempting Lock -1 reads the incremented generation, detects `active_generation !== batchGeneration`, rolls back immediately, and increments `metrics.fencedStaleAccounts`.
4. **Global Lock Hierarchy:**
   - Lock -1: `sync_batch_coordination` (`FOR SHARE`)
   - Lock 0A: `users` (`FOR UPDATE`)
   - Lock 0B: `github_accounts` (`FOR UPDATE`)
   - Lock 1: `pet_states` (`FOR UPDATE`)
   - Lock 2: `daily_sync_states` (`FOR UPDATE`)
   - Lock 3: `contribution_increment_slices` (`FOR UPDATE`)
   - Fully monotonic ordering ensures zero deadlock hazard.
5. **No Backend Termination:**
   - Full workspace search confirmed **ZERO** calls to `pg_terminate_backend`.
   - Recovery is 100% passive via `pg_stat_activity` inspection.

**Requirement Status:** **VERIFIED**

---

## 7. Batch Accounting Equation Verification

### Actual Equation Implementation
In `src/lib/sync/backgroundSyncCoordinator.ts` (lines 165–170):
```typescript
export function validateBatchAccounting(m: BatchAccountingMetrics): boolean {
  const eq1 = m.accountsDiscovered === m.leaseAcquisitionAttempts + m.deferredLimit;
  const eq2 = m.leaseAcquisitionAttempts === m.accountsAttempted + m.skippedContended + m.leaseAcquisitionErrors;
  const eq3 = m.accountsAttempted === m.successfulSyncs + m.noChangeSyncs + m.failedSyncs + m.commitOutcomeUnknown;
  return eq1 && eq2 && eq3;
}
```

### Invariants Confirmed:
- **Equation 1:** `accountsDiscovered = leaseAcquisitionAttempts + deferredLimit`
  - Discovered accounts enter the queue.
  - Dequeued accounts increment `leaseAcquisitionAttempts`.
  - Accounts remaining in the queue upon batch duration cutoff increment `deferredLimit`.
- **Equation 2:** `leaseAcquisitionAttempts = accountsAttempted + skippedContended + leaseAcquisitionErrors`
  - When lease acquisition succeeds: `accountsAttempted++`.
  - When lease acquisition fails due to active lease: `skippedContended++`.
  - When lease acquisition query errors: `leaseAcquisitionErrors++`.
- **Equation 3:** `accountsAttempted = successfulSyncs + noChangeSyncs + failedSyncs + commitOutcomeUnknown`
  - Successful reconciliation with newly observed increments: `successfulSyncs++`.
  - Successful reconciliation with no new increments / stale: `noChangeSyncs++`.
  - Failed reconciliation with confirmed rollback: `failedSyncs++`.
  - Unconfirmed commit acknowledgement with unresolved attempt: `commitOutcomeUnknown++`.
- **Audit Finding on Report Text:** The previous report used loose pseudocode terminology (`accountsProcessed`, `accountsSkipped`, etc.). The actual code and database columns in `sync_batch_runs` implement and enforce the exact contract formulas.

**Requirement Status:** **VERIFIED**

---

## 8. Deadlines, Retries, and Recovery Verification

1. **Absolute Monotonic Deadlines:**
   - Coordinator deadline: `batchCutoffMonotonic = batchStartMonotonic + (maxBatchDurationMs - batchSafetyMarginMs)`.
   - Worker deadline: `userDeadlineMonotonic = userStartMonotonic + perUserDeadlineMs`.
   - Pre-commit safety guard: `nowFn() > userDeadlineMonotonic - PRE_COMMIT_SAFETY_MARGIN_MS` (1500ms safety window) triggers `ROLLBACK` before `COMMIT`.
2. **HTTP Cancellation:**
   - Remaining time for HTTP: `remainingForHttp = Math.max(0, userDeadlineMonotonic - nowFn() - PRE_COMMIT_SAFETY_MARGIN_MS - 500)`.
   - Passed to `requestOptions: { timeoutMs: remainingForHttp }`. Aborts if budget $< 500$ms.
3. **Socket Destruction on Ambiguity:**
   - If socket termination occurs during commit, `clientDestroyed = true`. The socket connection is discarded and not returned to the pool.
4. **Passive Recovery with PID Reuse Guard:**
   - In `resolveUnknownCommitOutcome` (lines 371–396), checks both `backend_pid` and `backend_start`.
   - If PID exists but `backend_start !== recordedStart`, it correctly identifies PID reuse, recognizes original backend termination, and checks receipts without terminating the new process.
5. **No Refresh Token Replay:**
   - Background sync never performs unverified refresh token retries. Ambiguous refresh states fail closed with `GitHubReauthorizationRequiredError` and require browser OAuth re-authentication.

**Requirement Status:** **VERIFIED**

---

## 9. Test Evidence & Classification

Inspection of `tests/integration/backgroundSyncOrchestrationIntegration.test.ts`:

| Test Categories | Tests Count | Test IDs | Nature of Execution |
|---|---|---|---|
| **Native PostgreSQL 16.15 Integration** | 26 / 26 | 1–26 | Native PostgreSQL queries, row locking, transactions, sequences, advisory locks |
| **Separate Physical Connections** | 8 | 1, 3, 6, 7, 9, 15, 16, 18 | Explicitly checks out distinct `PoolClient` instances to test lock contention, separate PIDs, and concurrent recovery |
| **Simulated Failure / Error Injection** | 6 | 3, 8, 11, 17, 19, 20 | Injected socket drops, tight deadline budgets, pre-commit errors, and disconnected accounts |
| **Mocked GitHub Provider** | 26 | 1–26 | `snapshotFetcher` uses in-memory mock responses to isolate DB logic and avoid hitting external GitHub rate limits |
| **True OS Process Crashes** | 0 | N/A | Tests simulate connection drops and PID termination via socket events and synthetic `pg_stat_activity` records; **no OS-level SIGKILL** was executed |

**Requirement Status:** **VERIFIED**

---

## 10. Inspected Files & Exact Line References

| Source File | Line Range | Inspected Features |
|---|---|---|
| `migrations/010_background_sync_infrastructure.sql` | 1–118 | Real schema: `sync_batch_coordination`, `users` columns, `sync_transaction_attempts`, `sync_transaction_receipts`, `sync_batch_runs` |
| `migrations/001_initial_schema.sql` | 1–30 | `users.is_suspended`, `github_accounts.is_disconnected`, `github_accounts.encrypted_access_token` |
| `migrations/006_refresh_token_rotation_recovery.sql` | 1–7 | `github_accounts.token_refresh_status` |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 25–38 | Lock IDs and default durations (`USER_SYNC_LEASE_TTL_SECONDS = 60`) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 165–170 | `validateBatchAccounting` (Exact 3 equations) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 243–266 | `discoverEligibleAccounts` (Keyset pagination & eligibility filters) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 271–289 | `acquireUserSyncLease` (Atomic 60s lease acquisition on `users`) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 294–313 | `releaseUserSyncLease` (Owner-fenced release & scheduling update) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 328–512 | `resolveUnknownCommitOutcome` (Passive recovery, PID reuse guard, 5-field matching) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 618–819 | `executeSingleUserSync` (Dedicated connection, Tx 0, Tx 1, Lock -1 to 3, receipts) |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 874–1152 | `executeBackgroundContributionSync` (Advisory lock, stale cleanup, heartbeat, batch persistence) |
| `src/lib/db/repositories/userRepository.ts` | 544–615 | `updateTokens` (OAuth token refresh & ambiguous reset) |
| `src/lib/db/repositories/userRepository.ts` | 760–785 | `disconnectGitHubAccount` (Deadlock-free lock order: Lock 0A then Lock 0B) |
| `src/lib/db/repositories/syncRepository.ts` | 716–725 | `processContributionSync` (Client reuse `existingClient`, Lock 1, Lock 2, Lock 3) |
| `tests/integration/backgroundSyncOrchestrationIntegration.test.ts` | 1–864 | 26 Integration tests verifying all scenarios on native PostgreSQL |

---

## 11. Comprehensive Discrepancy Reconciliation

| Item | Previous Report Statement | Actual Code & Schema | Impact & Classification |
|---|---|---|---|
| **Lease Storage Table** | "UPDATE sync_schedules" | `UPDATE users` | **Documentation typo in report**. Real schema correctly extends `users`. Non-blocking. |
| **Account Active Filter** | `sync_status = 'active'` | `u.is_suspended = FALSE AND ga.is_disconnected = FALSE` | **Documentation typo in report**. Code correctly queries real columns. Non-blocking. |
| **Lease Timestamp Column** | `sync_lock_acquired_at = NOW()` | `last_sync_attempt_at = NOW()` | **Documentation typo in report**. Real schema has `last_sync_attempt_at`. Non-blocking. |
| **Lease Duration** | "10 minutes" | `USER_SYNC_LEASE_TTL_SECONDS = 60` (60s) | **Documentation typo in report**. Code correctly enforces approved 60-second lease. Non-blocking. |
| **Accounting Equations** | Pseudocode equations with non-existent variable names | Strict 3-equation closed accounting in `validateBatchAccounting` and `sync_batch_runs` | **Documentation inaccuracy in report**. Real code and DB enforce exact contract formulas. Non-blocking. |

---

## 12. Final Verdict

Every requirement of the Sprint 2.5A.7 architecture and Sprint 2.5C implementation contract is satisfied by the actual source code and verified against native PostgreSQL 16.15. Zero architectural violations or implementation defects exist.

**FINAL AUDIT VERDICT: APPROVED**
