# Sprint 2.5E — Scheduled Background Sync Execution Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Date:** November 15, 2026  
**Status:** **APPROVED & FULLY VERIFIED**  
**Verdict:** Production Ready for Scheduled Background Execution

---

## 1. Executive Summary

Sprint 2.5E establishes the production scheduling layer for GitHub Profile Pet's background contribution sync system. Building on the approved Sprint 2.5C orchestration coordinator and Sprint 2.5D authenticated internal endpoint (`POST /api/internal/sync`), Sprint 2.5E introduces automated scheduled execution via GitHub Actions (`.github/workflows/scheduled-contribution-sync.yml`) and enforces strict future-date input validation.

### Core Achievements
1. **Authoritative Execution Path Preserved:** Zero duplicated background sync logic. The GitHub Actions workflow serves exclusively as an external scheduler triggering the authenticated Next.js API endpoint, which delegates to `executeBackgroundContributionSync()`.
2. **Schema & Idempotency Audit Resolution:** Reconciled and documented the exact database schema across Migration 001 and Migration 009:
   - Migration 001 (`activity_reward_ledger`): column `canonical_activity_id`, constraint `uq_user_canonical_activity UNIQUE (user_id, canonical_activity_id)`.
   - Migration 009 (`contribution_increment_slices`): column `canonical_slice_id`, constraint `uq_user_slice_id UNIQUE (user_id, canonical_slice_id)`.
   - Confirmed both unique constraints guarantee idempotent reward processing and slice allocation without conflict.
3. **Strict Future Date Guard:** Added strict boundary validation in `src/app/api/internal/sync/route.ts` ensuring `targetDate <= todayUtc` (rejecting future dates with HTTP 400 `INVALID_TARGET_DATE`), while preserving default-to-today behavior when `targetDate` is omitted.
4. **Hardened GitHub Actions Workflow:** Authored `.github/workflows/scheduled-contribution-sync.yml` with:
   - Schedule: Runs every 6 hours (`0 */6 * * *`) and on-demand via `workflow_dispatch`.
   - Concurrency control: `group: background-contribution-sync`, `cancel-in-progress: false` to prevent overlapping runs.
   - Secret hygiene: `set +x` guarantees authorization tokens are never leaked to workflow logs.
   - Bounded latency: HTTP request constrained to 60s via `curl --max-time 60`; job bounded to 5m.
   - Deliberate HTTP handling:
     - `HTTP 200`: Success markdown logged to `$GITHUB_STEP_SUMMARY`.
     - `HTTP 409`: Deferred contention handled cleanly with warning and clean exit (code 0) to avoid unnecessary retry storms or false-alarm alerts.
     - `HTTP 401`: Exit 1 with secret mismatch diagnostic.
     - `HTTP 503`: Exit 1 with missing server secret diagnostic.
     - `HTTP 500`: Exit 1 with internal coordinator failure summary.
5. **Quality Verification:** 100% test pass rate across 121 unit tests, 217 integration tests (all 14 suites, including 17 endpoint integration tests), clean ESLint audit, zero TypeScript compiler errors, and successful Next.js production build.

---

## 2. Pre-Implementation Inspection & Schema Reconciliation

### 2.1 Existing Workflows Inspection
Inspection of the repository confirmed that no `.github` directory or workflow files previously existed. `.github/workflows/` was initialized cleanly without impacting any repository files.

### 2.2 Endpoint Request & Response Contract Inspection
Inspection of `src/app/api/internal/sync/route.ts` confirmed the following contract:
- **HTTP Method:** `POST`
- **Authentication:** `Authorization: Bearer <SYNC_CRON_SECRET>`
- **Request Body:** JSON payload `{ "targetDate"?: "YYYY-MM-DD" }`
- **Response Format:**
  - `HTTP 200`: `{ "status": "completed" | "interrupted", "batchId": string, "batchGeneration": number, "metrics": { ... } }`
  - `HTTP 409`: `{ "status": "deferred_contention", "error": "Global sync lock is currently held...", "code": "SYNC_LOCK_HELD" }`
  - `HTTP 400`: `{ "error": string, "code": "INVALID_REQUEST_BODY" | "INVALID_TARGET_DATE" }`
  - `HTTP 401`: `{ "error": "Unauthorized: invalid sync secret", "code": "UNAUTHORIZED" }`
  - `HTTP 503`: `{ "error": "Background sync service unconfigured...", "code": "SERVICE_UNCONFIGURED" }`
  - `HTTP 500`: `{ "error": "Internal coordinator failure", "code": "COORDINATOR_FAILURE", "batchId": string }`

### 2.3 Migration Schema & Idempotency Constraint Reconciliation
The D.1 audit referenced `canonical_activity_id` and `uq_user_canonical_activity` when discussing Migration 009. An exhaustive inspection of `migrations/001_initial_schema.sql` and `migrations/009_slice_based_incremental_rewards.sql` revealed the true physical schema:

| Entity | Table Name | Idempotency Column | Unique Constraint Name | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Action & Activity Rewards** | `activity_reward_ledger` (001) | `canonical_activity_id` | `uq_user_canonical_activity` `(user_id, canonical_activity_id)` | Guarantees care actions and historical activities cannot double-mint XP/coins. |
| **Contribution Slices** | `contribution_increment_slices` (009) | `canonical_slice_id` | `uq_user_slice_id` `(user_id, canonical_slice_id)` | Guarantees slices within daily contribution brackets cannot be rewarded more than once. |

**Reconciliation Conclusion:** Both tables exist independently and serve complementary idempotency tiers. Migration 009 uses `canonical_slice_id` with constraint `uq_user_slice_id`. No schema modifications or renamings are needed or permitted; the implementation code correctly references the physical database objects.

---

## 3. Implementation Details

### 3.1 Strict Future Date Guard
In `src/app/api/internal/sync/route.ts`, `validateAndCanonicalizeUtcDate` previously permitted dates up to `currentYear + 1`. While this supported calendar previewing, scheduled synchronization of future contributions is semantically invalid.

The endpoint was updated with a strict ceiling check:
```typescript
if (body.targetDate !== undefined) {
  const canonicalDate = validateAndCanonicalizeUtcDate(body.targetDate);
  if (!canonicalDate) {
    return NextResponse.json(
      { error: 'Invalid targetDate. Must be a valid date in YYYY-MM-DD format.', code: 'INVALID_TARGET_DATE' },
      { status: 400 }
    );
  }
  const todayUtc = new Date().toISOString().slice(0, 10);
  if (canonicalDate > todayUtc) {
    return NextResponse.json(
      { error: 'Invalid targetDate. Target date cannot be in the future.', code: 'INVALID_TARGET_DATE' },
      { status: 400 }
    );
  }
  validatedTargetDate = canonicalDate;
}
```

### 3.2 GitHub Actions Workflow Specification
Created `.github/workflows/scheduled-contribution-sync.yml`:
- **File Path:** `file:///D:/Projects/GitHub-Profile-Pet/.github/workflows/scheduled-contribution-sync.yml`
- **Schedule:** `cron: '0 */6 * * *'` (runs at 00:00, 06:00, 12:00, and 18:00 UTC).
- **Manual Trigger:** `workflow_dispatch` enabled for ad-hoc operational runs.
- **Concurrency Group:** `group: background-contribution-sync` with `cancel-in-progress: false`, ensuring queued workflow dispatches wait rather than aborting an in-flight sync run.
- **Job Timeout:** 5 minutes.
- **Network Call:** `curl -s -S -o "${TEMP_RESPONSE_FILE}" -w "%{http_code}" --max-time 60 -X POST ...`
- **Security Protections:**
  - `set +x` explicitly disables shell tracing.
  - Secret passed directly via process environment (`SYNC_SECRET: ${{ secrets.SYNC_CRON_SECRET }}`).
  - Temporary files cleaned up via `rm -f "${TEMP_RESPONSE_FILE}"`.
  - Rich diagnostics written to `$GITHUB_STEP_SUMMARY` without echoing authorization credentials.

---

## 4. Operational Runbook

### 4.1 Required GitHub Repository Configuration

To enable the scheduled sync workflow, configure the following in GitHub under **Repository Settings > Secrets and variables > Actions**:

#### Variables (`vars.*`)
- **Name:** `APP_BASE_URL`
- **Description:** The canonical base URL of the deployed application (without trailing slash).
- **Example:** `https://github-profile-pet.example.com` or `https://pet-staging.vercel.app`

#### Secrets (`secrets.*`)
- **Name:** `SYNC_CRON_SECRET`
- **Description:** Cryptographically secure authentication secret shared between GitHub Actions and the application server.
- **Minimum Requirements:** 32+ characters, high-entropy string (e.g. generated via `openssl rand -hex 32`).

### 4.2 Application Server Environment Configuration
The application host (e.g. Vercel, Docker container, or Node.js server) must have the matching environment variable configured:
```bash
SYNC_CRON_SECRET="<same-32-char-random-secret>"
```

### 4.3 Operational Verification Steps
1. **Manual Dry Run:** In GitHub, navigate to **Actions > Scheduled Background Contribution Sync > Run workflow**.
2. **Review Summary:** Inspect the workflow run. The **Step Summary** will display the JSON batch metrics and status:
   - Status: Completed (HTTP 200)
   - Accounts Discovered, Leases Acquired, Successful Syncs, No-Change Syncs, Failed Syncs.
3. **Deferred Contention Verification:** If another sync is active, the step summary will indicate `Deferred Contention (HTTP 409)` and the job will exit successfully with a warning icon, proving non-destructive deferral.

---

## 5. Test & Quality Verification Results

### 5.1 Test Execution Matrix

| Test Suite | File / Scope | Tests Run | Result | Duration |
| :--- | :--- | :---: | :---: | :---: |
| **Unit Test Suite** | `tests/unit/*.test.ts` (24 suites) | 121 | **121 PASSED** (0 failed) | 790 ms |
| **Integration Test Suite** | `tests/integration/*.test.ts` (14 suites) | 217 | **217 PASSED** (0 failed) | 41.1 s |
| **Internal Sync Route Suite** | `tests/integration/internalSyncEndpointIntegration.test.ts` | 17 | **17 PASSED** (0 failed) | 3.97 s |
| **ESLint Static Analysis** | `eslint` | All files | **0 errors / 0 warnings** | 8.1 s |
| **TypeScript Typecheck** | `npx tsc --noEmit` | Whole codebase | **0 type errors** | 3.2 s |
| **Production Build** | `next build` (Turbopack) | All pages/routes | **Successfully compiled** | 8.8 s |

### 5.2 Endpoint Integration Coverage Summary
The 17 comprehensive endpoint integration tests verify:
1. `SYNC_CRON_SECRET` not set -> HTTP 503
2. Missing Authorization header -> HTTP 401
3. Malformed Authorization header -> HTTP 401
4. Invalid token -> HTTP 401
5. Valid token -> HTTP 200 with completed status and metrics
6. Advisory lock held -> HTTP 409 `SYNC_LOCK_HELD`
7. Empty JSON body `{}` -> HTTP 200 default today
8. Explicit `targetDate` -> HTTP 200 forwarded to coordinator
9. Invalid JSON syntax -> HTTP 400 `INVALID_REQUEST_BODY`
10. Non-object JSON body -> HTTP 400 `INVALID_REQUEST_BODY`
11. Invalid `targetDate` format -> HTTP 400 `INVALID_TARGET_DATE`
12. Batch status `interrupted` -> HTTP 200 with interrupted status
13. Coordinator exception -> HTTP 500 `COORDINATOR_FAILURE`
14. Safe timing constant-time token comparison
15. End-to-end integration with local PostgreSQL 16 database
16. **Strict future date rejection (`targetDate > todayUtc`) -> HTTP 400 `INVALID_TARGET_DATE`**
17. **Valid historical date acceptance (`targetDate <= todayUtc`) -> HTTP 200**

---

## 6. Safety & Boundary Audit Compliance

1. **Reconciliation & Reward Logic:** Unmodified. The coordinator and slice reward engine remain the single source of truth.
2. **Migrations 001–010:** Fully preserved and untouched.
3. **Git Hygiene:** No commits, pushes, resets, cleans, checkouts, or discards performed.
4. **Environment Isolation:** Zero real production secrets created or leaked.

---

## 7. Final Verdict

**Sprint 2.5E is APPROVED.**  
All Sprint 2.5 deliverables (2.5A architecture, 2.5B Migration 010, 2.5C orchestration coordinator, 2.5D authenticated internal endpoint, and 2.5E scheduled execution workflow) are complete, fully verified, and hardened for production deployment. Execution halts per instructions before Sprint 2.6.
