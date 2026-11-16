# Sprint 2.5D — Internal Background Sync Trigger Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Endpoint:** `POST /api/internal/sync`  
**Target File:** `src/app/api/internal/sync/route.ts`  
**Status:** **COMPLETE & VERIFIED**  
**Final Verdict:** **APPROVED**

---

## 1. Executive Summary

Sprint 2.5D implements a secure, authenticated, server-to-server internal HTTP entry point (`POST /api/internal/sync`) that invokes the Background Contribution Sync Coordinator implemented in Sprint 2.5C without duplicating coordinator functionality or bypassing existing security invariants.

### Key Highlights:
- **Zero Coordinator Duplication:** Directly calls `executeBackgroundContributionSync()` as the sole orchestrator.
- **Timing-Attack Immune Authentication:** Employs constant-time SHA-256 digest comparison via `crypto.timingSafeEqual`.
- **Defensive Parameter Whitelisting:** Rejects all caller-supplied overrides (such as `forceSync`, `userId`, `accountId`, concurrency, or account limits) with HTTP 400.
- **Strict Method Rejection:** Non-POST HTTP methods (`GET`, `PUT`, `DELETE`, `PATCH`) return HTTP 405 Method Not Allowed with `Allow: POST`.
- **Sanitized Outputs:** Responses and server logs never leak user IDs, usernames, tokens, credentials, or stack traces.
- **Comprehensive Quality Gates Passed:**
  - `tests/integration/internalSyncEndpointIntegration.test.ts`: **15 / 15 PASSED** (4.93s)
  - Full Integration Suite (`npm run test:integration`): **215 / 215 PASSED** (14 suites, 42.08s)
  - Full Unit Suite (`npm test`): **121 / 121 PASSED** (24 suites, 0.81s)
  - TypeScript & ESLint: **0 errors, 0 warnings**
  - Next.js Production Build: **14 dynamic and static routes compiled successfully** (`ƒ /api/internal/sync` verified)

---

## 2. Files Created and Modified

### Created:
1. `src/app/api/internal/sync/route.ts`: Production implementation of the authenticated internal background sync trigger endpoint.
2. `tests/integration/internalSyncEndpointIntegration.test.ts`: 15 integration test scenarios validating authentication, constant-time validation, lock contention, concurrency, sanitization, and error isolation.
3. `reports/sprint_2_5d_internal_sync_endpoint_report.md`: Formal verification and architecture audit report.

### Modified:
- *None.* Existing coordinator, reconciliation repositories, models, and migrations were left completely untouched.

---

## 3. Endpoint Authentication Design

### Secret Configuration & Handling
- **Environment Variable:** `process.env.SYNC_CRON_SECRET`
- **Missing Secret (503 Service Unavailable):** If `SYNC_CRON_SECRET` is unset or whitespace-empty, the endpoint immediately returns:
  ```json
  {
    "error": "Background sync secret is not configured on server",
    "code": "SYNC_SECRET_NOT_CONFIGURED"
  }
  ```
- **Authorization Header Format:**
  - Expected header: `Authorization: Bearer <secret>` (case-insensitive `Bearer` scheme).
  - Missing or malformed header returns HTTP 401:
    ```json
    {
      "error": "Unauthorized: missing or malformed Authorization header. Expected \"Authorization: Bearer <token>\"",
      "code": "UNAUTHORIZED"
    }
    ```

### Constant-Time Secret Comparison
Direct string comparisons (`a === b`) or naive `timingSafeEqual` calls on strings of varying lengths leak byte length through exception timings. To guarantee constant-time verification regardless of input format or length:
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
Both hashes are fixed 32-byte digests. `timingSafeEqual` cannot throw a length mismatch exception and executes in constant time, preventing timing attacks and secret length disclosure.

### Log Hygiene
Neither the supplied candidate token nor the server's configured secret is ever logged, echoed, or included in response payloads.

---

## 4. Coordinator Integration & Request Validation

### Single Source of Truth
The endpoint does not implement batch execution or scheduling logic. It delegates execution to `executeBackgroundContributionSync()` from `src/lib/sync/backgroundSyncCoordinator.ts`.

### Parameter Whitelisting & Safety Guards
- **Forbidden Parameters:** Any request body attempting to provide `forceSync`, `userId`, `accountId`, `maxConcurrency`, or other coordinator override options is strictly rejected with HTTP 400:
  ```json
  {
    "error": "Unauthorized parameter: \"forceSync\" is not permitted",
    "code": "FORBIDDEN_PARAMETER"
  }
  ```
- **Optional Metadata:** The only permitted optional parameter is `targetDate`, which is validated using `validateAndCanonicalizeUtcDate`. Malformed dates or unparseable JSON return HTTP 400 (`MALFORMED_JSON` or `INVALID_TARGET_DATE`).

---

## 5. HTTP Status & Response Mapping

| Coordinator Outcome | HTTP Status | Response `status` | Response Body Structure |
|---|---|---|---|
| **Completed** | 200 OK | `'completed'` | `{ success: true, status: "completed", batchId, batchGeneration, metrics: { ... }, durationMs }` |
| **Partially Completed** | 200 OK | `'partially_completed'` | `{ success: true, status: "partially_completed", batchId, batchGeneration, metrics: { ... }, durationMs }` |
| **Deferred Contention** | 409 Conflict | `'deferred_contention'` | `{ success: false, status: "deferred_contention", batchId, batchGeneration, error: "Advisory lock contention: background sync batch deferred", code: "DEFERRED_CONTENTION", metrics: { ... }, durationMs }` |
| **Batch Failed / Interrupted** | 500 Internal Error | `'failed'` / `'interrupted'` | `{ success: false, status: "failed", batchId, batchGeneration, error: "Background sync batch failed to complete", code: "BATCH_EXECUTION_FAILED", metrics: { ... }, durationMs }` |
| **Unhandled Exception** | 500 Internal Error | `'failed'` | `{ success: false, status: "failed", error: "Internal background sync coordinator failure", code: "INTERNAL_COORDINATOR_ERROR" }` |
| **Invalid Auth / Header** | 401 Unauthorized | N/A | `{ error: "Unauthorized: ...", code: "UNAUTHORIZED" }` |
| **Secret Not Configured** | 503 Unavailable | N/A | `{ error: "Background sync secret is not configured on server", code: "SYNC_SECRET_NOT_CONFIGURED" }` |
| **Invalid Method (GET/PUT/etc.)**| 405 Not Allowed | N/A | `{ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" }` with `Allow: POST` |

### Sanitized Metrics Payload
Returned metrics contain aggregate numerical counters only:
`accountsDiscovered`, `leaseAcquisitionAttempts`, `accountsAttempted`, `successfulSyncs`, `noChangeSyncs`, `failedSyncs`, `commitOutcomeUnknown`, `skippedContended`, `leaseAcquisitionErrors`, `deferredLimit`, `rateLimitedAccounts`, `reauthRequiredAccounts`, `timedOutAccounts`, `fencedStaleAccounts`, `pendingRewardsProcessed`, `expiredSlicesProcessed`, `totalXpAwarded`.

Zero personal handles, account IDs, tokens, or credentials are exposed.

---

## 6. Concurrency and Advisory-Lock Behavior

1. **Global Exclusion:** When two concurrent requests hit `POST /api/internal/sync`, both request threads enter `executeBackgroundContributionSync()`.
2. **PostgreSQL Advisory Lock:** The first request acquires `pg_try_advisory_lock(982347102)` and processes eligible accounts.
3. **Graceful Deferral:** The second request encounters `pg_try_advisory_lock === false`, records `status = 'deferred_contention'` in `sync_batch_runs`, and immediately returns HTTP 409 Conflict without holding database connections or executing redundant work.
4. **Verification:** Verified by native PostgreSQL integration tests 7 and 8 in `internalSyncEndpointIntegration.test.ts`.

---

## 7. Test Coverage & Verification Results

### Targeted Endpoint Integration Suite (`tests/integration/internalSyncEndpointIntegration.test.ts`)
```text
node --test --experimental-strip-types tests/integration/internalSyncEndpointIntegration.test.ts

▶ Internal Background Sync Trigger Endpoint Integration Suite
  ✔ 1. Missing secret configuration: Returns HTTP 503 when SYNC_CRON_SECRET is unconfigured (182.7ms)
  ✔ 2. Missing authorization header: Returns HTTP 401 when Authorization header is absent (138.2ms)
  ✔ 3. Incorrect secret: Returns HTTP 401 when invalid bearer token is provided (137.0ms)
  ✔ 4. Correct secret: Authenticates successfully and proceeds to coordinator (206.6ms)
  ✔ 5. Coordinator invocation after authentication: Calls coordinator exactly once with provided targetDate (135.4ms)
  ✔ 6. Coordinator not invoked after failed authentication (124.5ms)
  ✔ 7. Concurrent endpoint requests: One batch proceeds while contending request defers (299.4ms)
  ✔ 8. Global advisory-lock contention: Returns HTTP 409 when global lock is held externally (141.9ms)
  ✔ 9. Successful batch response: Returns HTTP 200 with sanitized completed metrics (125.9ms)
  ✔ 10. Partial completion response: Returns HTTP 200 with status partially_completed (126.0ms)
  ✔ 11. Internal coordinator failure: Returns HTTP 500 without leaking stack traces or internal details (115.9ms)
  ✔ 12. Sanitization of returned errors and summaries: Zero user IDs, tokens, or credentials exposed (209.3ms)
  ✔ 13. No secret leakage in logs or responses (119.5ms)
  ✔ 14. Unsupported methods: GET, PUT, DELETE, and PATCH return 405 Method Not Allowed with Allow header (114.5ms)
  ✔ 15. Security: Forbids caller-supplied forceSync, userId, or arbitrary parameters (122.0ms)
✔ Internal Background Sync Trigger Endpoint Integration Suite (4668.4ms)
ℹ tests 15
ℹ suites 1
ℹ pass 15
ℹ fail 0
```

### Full Repository Verification
```text
======================================================================
TEST SUITE SUMMARY:
----------------------------------------------------------------------
Endpoint Integration Tests      : 15 / 15 PASSED (4.93s)
Full Integration Test Suites    : 215 / 215 PASSED (14 suites, 42.08s)
Full Unit Test Suites           : 121 / 121 PASSED (24 suites, 0.81s)
TypeScript & ESLint Checks      : Clean (0 errors, 0 warnings)
Next.js Production Build        : Clean (14 routes compiled successfully)
======================================================================
```

---

## 8. Security Limitations & Operational Boundaries

1. **Server-to-Server Only:** The endpoint is intended solely for automated invocation by an authorized internal scheduler (e.g. GitHub Actions, Vercel Cron, or dedicated bastion runner). It must never be called from client-side JavaScript.
2. **Fixed Constant Execution Limits:** Safety limits (`maxDurationMs: 45000`, `maxAccounts: 50`, `maxConcurrency: 3`) cannot be overridden through HTTP parameters.
3. **Secret Provisioning Requirement:** Operational deployments must configure a high-entropy secret in `SYNC_CRON_SECRET` ($> 32$ alphanumeric characters).

---

## 9. Strict Invariant & Guard Compliance

- [x] Migrations 001–010 remain unmodified and verified.
- [x] No modifications to existing authentication, session contexts, or OAuth flows.
- [x] Canonical contribution reconciliation and reward accounting engines remain single source of truth.
- [x] No GitHub Actions workflow files (`.github/workflows`) or cron schedules created.
- [x] No production secrets or external live network calls made.
- [x] Zero Git commits, pushes, resets, cleans, checkouts, or discards performed.

---

## 10. Final Recommendation & Authorization

The internal background sync trigger endpoint (`POST /api/internal/sync`) is fully implemented, strictly authenticated, defensively bounded, and verified against all 15 targeted scenarios and the entire 336-test suite.

**Sprint 2.5D Verdict: APPROVED**
