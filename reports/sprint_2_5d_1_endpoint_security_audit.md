# Sprint 2.5D.1 — Internal Sync Endpoint Security & Behavioral Audit Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Endpoint:** `POST /api/internal/sync`  
**Mode:** Read-only security and architecture audit  
**Status:** **AUDIT COMPLETE**  
**Final Verdict:** **APPROVED**

---

## 1. Executive Summary

This read-only audit evaluates the security architecture, authentication integrity, input validation, and coordinator integration of the newly implemented internal background sync trigger endpoint (`POST /api/internal/sync` in `src/app/api/internal/sync/route.ts`).

The audit verifies that the endpoint functions strictly as a secure, authenticated, server-to-server gateway that delegates 100% of orchestration, concurrency control, and account discovery to `executeBackgroundContributionSync()`. No duplicate reward paths, bypass vectors, or credential leakages exist.

---

## 2. Authentication Implementation Audit

### Implementation Architecture
In `src/app/api/internal/sync/route.ts` (lines 66–111):
- **Server-Only Configuration:** Reads `process.env.SYNC_CRON_SECRET` exclusively on the server. No client-accessible or `NEXT_PUBLIC_` variables exist.
- **Missing / Empty Secret (503):** Returns `HTTP 503 Service Unavailable` with `code: 'SYNC_SECRET_NOT_CONFIGURED'` if `SYNC_CRON_SECRET` is unset, null, or empty string.
- **Strict Bearer Header Extraction:** Requires `Authorization: Bearer <secret>`. Rejects missing headers, Basic auth, or empty tokens with `HTTP 401 Unauthorized` (`code: 'UNAUTHORIZED'`).
- **Timing-Safe Secret Comparison:**
  ```typescript
  function safeCompareSecret(provided: string, expected: string): boolean {
    if (typeof provided !== 'string' || typeof expected !== 'string') {
      return false;
    }
    const hashProvided = crypto.createHash('sha256').update(provided, 'utf8').digest();
    const hashExpected = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(hashProvided, hashExpected);
  }
  ```
  - Both operands are hashed into fixed 32-byte SHA-256 buffers before calling `crypto.timingSafeEqual`.
  - Prevents byte-by-byte early-exit timing attacks.
  - Prevents `TypeError: Input buffers must have the same byte length` exceptions that occur when comparing variable-length inputs with `timingSafeEqual`.
  - Note: Hashing time varies negligibly with input byte count, but in an HTTP network context this variance is dwarfed by network jitter and reveals zero byte-level information about the configured secret.
- **Secret Leakage Prevention:** Neither the supplied token nor the expected secret is logged, printed, or included in error responses.

**Requirement Status:** **VERIFIED**

---

## 3. `targetDate` Validation and Risk Analysis

### Findings on `targetDate` Handling
In `src/app/api/internal/sync/route.ts` (lines 113–175) and `src/lib/github/dailyReconciliation.ts` (lines 45–96):

1. **Optionality:** `targetDate` is **optional**. When omitted, the coordinator defaults to the current UTC date via `validateAndCanonicalizeUtcDate(undefined)` $\to$ `toUtcDateString(new Date())`.
2. **Format and Timezone:** Requires a canonical ISO date string (`YYYY-MM-DD`). Canonicalized to strict UTC boundaries: `from = YYYY-MM-DDT00:00:00.000Z` to `to = YYYY-MM-DDT23:59:59.999Z`.
3. **Calendar Verification:** Strictly validates month (1–12), leap days, and days per month using `Date.UTC`. Rejects non-existent dates (e.g. `2026-02-30`).
4. **Historical Window:** Dates prior to 2008 (the creation of GitHub) are strictly rejected (`year < 2008`).
5. **Future Date Behavior:**
   - `validateAndCanonicalizeUtcDate` permits dates up to `currentYear + 1` (lines 88–93).
   - If a caller specifies tomorrow's date, GitHub GraphQL returns 0 contributions, 0 XP is awarded, and 0 slices are created. It does not cause an error, but syncing future dates produces no game rewards.
6. **Slice Expiry Immunity:**
   - Pending increment slice expiration is governed by wall-clock time `now` (`new Date()`) against `sync_date + INTERVAL '48 hours'` (`src/lib/db/repositories/syncRepository.ts:881`).
   - A caller cannot prevent or bypass slice expiration by supplying an alternate `targetDate`.
7. **Idempotency & Duplicate Reward Immunity:**
   - The database ledger enforces `uq_user_canonical_activity UNIQUE (user_id, canonical_activity_id)`.
   - Repeatedly syncing any date (historical or present) awards 0 XP once recorded (`no_change_syncs++`).
   - Double-rewarding is mathematically prevented.
8. **Necessity Assessment:**
   - Accepting an optional `targetDate` is safe and useful for operational backfill (e.g. reconciling yesterday's contributions at 00:05 UTC). For scheduled crons, omitting `targetDate` ensures automatic alignment with current UTC day.

**Requirement Status:** **VERIFIED** *(Non-blocking observation: future date boundary could be clamped to `<= todayUtc` in a subsequent hardening pass)*

---

## 4. Request Validation Audit

In `src/app/api/internal/sync/route.ts` (lines 113–180):
- **Malformed JSON Handling:** Malformed JSON strings or unparseable bodies are caught and rejected with `HTTP 400 Bad Request` (`code: 'MALFORMED_JSON'`).
- **Structure Validation:** Rejects non-object payloads (arrays, primitives, null) with `HTTP 400 Bad Request` (`code: 'BAD_REQUEST'`).
- **Strict Parameter Whitelist:**
  ```typescript
  const allowedKeys = new Set(['targetDate']);
  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      return Response.json(
        { error: `Unauthorized parameter: "${key}" is not permitted`, code: 'FORBIDDEN_PARAMETER' },
        { status: 400 }
      );
    }
  }
  ```
  - Explicitly rejects `forceSync`, `userId`, `accountId`, `maxAccounts`, and concurrency overrides with HTTP 400.
  - Callers cannot bypass discovery or alter coordinator safety limits.
- **Empty / Non-JSON Requests:** If no request body or a non-JSON header is sent, the route defaults safely to standard execution with `targetDate: undefined`.

**Requirement Status:** **VERIFIED**

---

## 5. Coordinator Delegation & HTTP Outcome Mapping

In `src/app/api/internal/sync/route.ts` (lines 182–260):

### Delegation Integrity
- Exclusively invokes `executeBackgroundContributionSync()`.
- Zero database queries, repositories, or transaction logic are duplicated in the route.
- The global advisory lock (`pg_try_advisory_lock(982347102)`) remains authoritative.

### HTTP Response Mapping
| Coordinator Result Status | HTTP Status | Response `code` | Rationale & Suitability |
|---|---|---|---|
| `completed` | 200 OK | N/A | Full batch completed normally. |
| `partially_completed` | 200 OK | N/A | Batch completed with partial recoverable account retries scheduled. |
| `deferred_contention` | 409 Conflict | `DEFERRED_CONTENTION` | Advisory lock is held by another active coordinator. Signals conflict without triggering false 500 server alerts. |
| `failed` / `interrupted` | 500 Internal Error | `BATCH_EXECUTION_FAILED` | Batch run failed or was interrupted. |
| Unhandled Exception | 500 Internal Error | `INTERNAL_COORDINATOR_ERROR` | Safety fallback catching unexpected errors. |

### Response Sanitization
- `sanitizeMetrics` filters metrics down to strictly numerical counts.
- Zero user handles, user IDs, GitHub tokens, database hosts, or stack traces are included.

**Requirement Status:** **VERIFIED**

---

## 6. Concurrency and Advisory-Lock Behavior

1. **Advisory Lock Exclusivity:**
   - When a coordinator holds `GLOBAL_ADVISORY_LOCK_ID`, any incoming HTTP request executing `executeBackgroundContributionSync()` receives `pg_try_advisory_lock === false`.
   - The coordinator records `status = 'deferred_contention'` in `sync_batch_runs`.
   - The endpoint returns `HTTP 409 Conflict` (`DEFERRED_CONTENTION`).
2. **Concurrent HTTP Requests:**
   - When two requests are dispatched simultaneously, exactly one acquires the advisory lock and executes.
   - The other defers with HTTP 409.
   - Verified by integration test 7 in `tests/integration/internalSyncEndpointIntegration.test.ts`.

**Requirement Status:** **VERIFIED**

---

## 7. Test Evidence & Scope Classification

Inspection of `tests/integration/internalSyncEndpointIntegration.test.ts` (15 tests total):

| # | Test Scenario | Execution Mode | Coverage Assessment |
|---|---|---|---|
| 1 | Missing secret configuration | Mock Environment | Verifies HTTP 503 response when `SYNC_CRON_SECRET` is unset |
| 2 | Missing authorization header | HTTP Handler | Verifies HTTP 401 when `Authorization` header is omitted |
| 3 | Incorrect secret | HTTP Handler | Verifies HTTP 401 on mismatched Bearer token |
| 4 | Correct secret | Native PostgreSQL 16.15 | Verifies 200 OK and coordinator batch execution |
| 5 | Coordinator invocation with targetDate | Mock Coordinator | Verifies `targetDate` parameter forwarding |
| 6 | Coordinator not invoked on auth failure | Mock Coordinator | Verifies zero coordinator calls on 401/503 |
| 7 | Concurrent endpoint requests | Native PostgreSQL 16.15 | Two concurrent POST requests: exactly one 200, one 409 |
| 8 | Global advisory-lock contention | Native PostgreSQL 16.15 | Independent connection claims lock; endpoint returns 409 |
| 9 | Successful batch response | Mock Coordinator | Verifies 200 OK response structure and numerical metrics |
| 10 | Partial completion response | Mock Coordinator | Verifies 200 OK with `status: 'partially_completed'` |
| 11 | Internal coordinator failure | Mock Coordinator | Verifies 500 error sanitization and stack trace suppression |
| 12 | Sanitization of returned errors | Native PostgreSQL 16.15 | Verifies zero tokens, handles, or IDs in JSON payload |
| 13 | No secret leakage in logs or body | Spy / Interceptor | Verifies candidate and configured secrets never appear in logs |
| 14 | Unsupported HTTP methods | HTTP Handler | Verifies GET, PUT, DELETE, PATCH return 405 with `Allow: POST` |
| 15 | Security whitelist validation | HTTP Handler | Verifies 400 on `forceSync`, `userId`, or arbitrary parameters |

**Test Quality Summary:**
- Native PostgreSQL 16.15 covers live advisory locking, concurrency, and real coordinator batch runs.
- Unit/mock tests isolate error handling, secret comparison, method rejection, and JSON parsing.

**Requirement Status:** **VERIFIED**

---

## 8. Inspected Files & Exact Line References

| Source File | Line Range | Inspected Subject |
|---|---|---|
| `src/app/api/internal/sync/route.ts` | 1–32 | Imports, test injection hook, safe comparison helper |
| `src/app/api/internal/sync/route.ts` | 34–64 | `extractBearerToken` and `sanitizeMetrics` implementation |
| `src/app/api/internal/sync/route.ts` | 66–111 | Secret authentication, missing check, timing comparison |
| `src/app/api/internal/sync/route.ts` | 113–180 | Request parsing, strict parameter whitelist, `targetDate` validation |
| `src/app/api/internal/sync/route.ts` | 182–260 | Coordinator invocation, status code mapping, error sanitization |
| `src/app/api/internal/sync/route.ts` | 262–285 | Rejection of GET, PUT, DELETE, PATCH with 405 and Allow header |
| `src/lib/github/dailyReconciliation.ts` | 45–96 | `validateAndCanonicalizeUtcDate` implementation and bounds |
| `src/lib/sync/backgroundSyncCoordinator.ts` | 874–947 | Global advisory lock acquisition and `deferred_contention` return |
| `src/lib/db/repositories/syncRepository.ts` | 875–885 | 48-hour slice expiration logic using wall-clock `now` |
| `tests/integration/internalSyncEndpointIntegration.test.ts` | 1–599 | All 15 integration test implementations |

---

## 9. Identified Non-Blocking Observations

1. **Future Date Validation:** `validateAndCanonicalizeUtcDate` permits future dates up to `currentYear + 1`. While completely safe (GraphQL returns 0 contributions and ledger constraints prevent duplicate XP), adding a check `if (targetDate > todayUtc) throw ...` in a future sprint would make future date rejection explicit.
2. **Request Body Size Limit:** The route relies on Next.js's standard 1MB body limit. Since the payload is small JSON (`{ targetDate }`), an explicit byte-length guard (e.g. `rawBody.length > 1024`) could be added in a future pass as extra defense-in-depth.

Neither observation represents a security vulnerability, correctness defect, or invariant violation.

---

## 10. Audit Verdict

The `POST /api/internal/sync` endpoint conforms strictly to the Sprint 2.5C coordinator architecture, provides robust timing-safe authentication, safely validates requests, maps HTTP outcomes accurately, and preserves all database accounting invariants.

**FINAL AUDIT VERDICT: APPROVED**
