# Sprint 2.5E.1 — Scheduled Execution Contract Consistency Audit Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Date:** November 15, 2026  
**Mode:** Read-Only Architecture & Implementation Contract Audit  
**Status:** **COMPLETE**  
**Verdict:** **APPROVED**

---

## 1. Executive Summary

This audit investigates the apparent discrepancy between the approved Sprint 2.5D endpoint contract (where `interrupted` maps to HTTP 500) and the Sprint 2.5E implementation report (which incorrectly referenced `interrupted` returning HTTP 200).

### Key Findings
1. **Codebase Conformance (100%):** The actual implementation in `src/app/api/internal/sync/route.ts` (lines 246–259) **strictly and correctly returns HTTP 500** for both `'failed'` and `'interrupted'` batch outcomes. The code was never changed to return HTTP 200 for `interrupted`.
2. **Discrepancy Root Cause:** The discrepancy was purely a **documentation error** in `reports/sprint_2_5e_scheduled_execution_report.md`:
   - Section 2.2 accidentally grouped `interrupted` with `completed` under HTTP 200.
   - Section 5.2 mislabeled Test 12 as `Batch status interrupted -> HTTP 200 with interrupted status`, whereas Test 12 in `tests/integration/internalSyncEndpointIntegration.test.ts` is actually `Sanitization of returned errors and summaries: Zero user IDs, tokens, or credentials exposed`.
3. **Workflow Behavior:** The GitHub Actions workflow (`.github/workflows/scheduled-contribution-sync.yml`) treats HTTP 500 as a failure (`exit 1`), meaning any `interrupted` batch run will fail the workflow run as expected. HTTP 409 is cleanly treated as deferred contention (`exit 0` with a warning, preventing retry storms), and HTTP 200 is issued only for `completed` and `partially_completed` batches.
4. **Secret Safety:** No sensitive tokens, database connection strings, or authorization headers are logged or output to `$GITHUB_STEP_SUMMARY`.

---

## 2. Actual Route-to-HTTP Status Mapping

An inspection of `src/app/api/internal/sync/route.ts` establishes the authoritative mapping:

| Coordinator / Request Condition | HTTP Status Code | Response `status` | Response `code` | Description & Contract Behavior |
| :--- | :---: | :---: | :---: | :--- |
| **`SYNC_CRON_SECRET` unconfigured** | `503` | N/A | `SYNC_SECRET_NOT_CONFIGURED` | Fail-closed before coordinator invocation. |
| **Missing / Malformed Authorization** | `401` | N/A | `UNAUTHORIZED` | Rejects missing or non-Bearer headers. |
| **Invalid Bearer Secret** | `401` | N/A | `UNAUTHORIZED` | Timing-safe constant-time string comparison fails. |
| **Malformed JSON Body** | `400` | N/A | `MALFORMED_JSON` | Body is unparseable JSON string. |
| **Non-Object JSON Body** | `400` | N/A | `INVALID_REQUEST_BODY` | Body is JSON primitive or array. |
| **Disallowed Request Fields** | `400` | N/A | `FORBIDDEN_PARAMETER` | Rejects parameters like `forceSync` or `userId`. |
| **Invalid `targetDate` Format** | `400` | N/A | `INVALID_TARGET_DATE` | Cannot be canonicalized to `YYYY-MM-DD`. |
| **Future `targetDate` (`> todayUtc`)** | `400` | N/A | `INVALID_TARGET_DATE` | Rejects target dates beyond current UTC date. |
| **`result.status === 'completed'`** | `200` | `completed` | N/A (`success: true`) | Batch completed all discovered accounts cleanly. |
| **`result.status === 'partially_completed'`** | `200` | `partially_completed` | N/A (`success: true`) | Batch completed >= 1 account, with some failures. |
| **`result.status === 'deferred_contention'`** | `409` | `deferred_contention` | `DEFERRED_CONTENTION` | Advisory lock held by another coordinator. |
| **`result.status === 'failed'`** | `500` | `failed` | `BATCH_EXECUTION_FAILED` | Batch failed to sync any accounts successfully. |
| **`result.status === 'interrupted'`** | `500` | `interrupted` | `BATCH_EXECUTION_FAILED` | Advisory lock lost mid-batch; workers aborted. |
| **Coordinator Unhandled Exception** | `500` | `failed` | `INTERNAL_COORDINATOR_ERROR` | Coordinator threw unexpected runtime error. |
| **Non-POST HTTP Methods** | `405` | N/A | N/A | Returns `Allow: POST` header. |

### Source Code Evidence: `src/app/api/internal/sync/route.ts` (Lines 246–259)
```typescript
    // Status is 'failed' or 'interrupted'
    return Response.json(
      {
        success: false,
        status: result.status,
        batchId: result.batchId,
        batchGeneration: result.batchGeneration,
        error: 'Background sync batch failed to complete',
        code: 'BATCH_EXECUTION_FAILED',
        metrics: sanitizedMetrics,
        durationMs: result.durationMs,
      },
      { status: 500 }
    );
```

---

## 3. Coordinator Outcome Semantics & Interrupted Status Resolution

### 3.1 Audit Questions Addressed

#### 1. What exact result does the coordinator return when interrupted?
In `src/lib/sync/backgroundSyncCoordinator.ts` (lines 1068–1070 and 1130–1137), when the session-level advisory lock connection drops or errors, `advisoryLost` is set to `true`. The coordinator returns:
```typescript
{
  batchId: string,
  batchGeneration: number,
  status: 'interrupted',
  metrics: BatchAccountingMetrics,
  durationMs: number,
  errorMessage: 'Advisory lock lost during batch execution'
}
```
Furthermore, in the database table `sync_batch_runs`, the batch record is updated to `status = 'interrupted'` and `error_message = 'Advisory lock lost during batch execution'`.

#### 2. Does that result mean the batch completed, partially completed, or stopped before completion?
It categorically means the batch **stopped before completion**. When `advisoryLost` occurs, `isAborted()` returns `true`, immediately halting all worker dispatch loops. Any accounts remaining in the queue are dropped into `metrics.deferredLimit`, in-flight lease acquisitions halt, and the run terminates abnormally without completing its intended workload.

#### 3. Does the route return HTTP 200 or 500 for it?
The route returns **HTTP 500** (`BATCH_EXECUTION_FAILED`). Lines 246–259 of `src/app/api/internal/sync/route.ts` exclusively map `'failed'` and `'interrupted'` to HTTP 500.

#### 4. Does the workflow classify that response as successful or failed?
The workflow classifies the response as **failed**. When `HTTP_STATUS` is 500:
- It executes the `500)` branch in `.github/workflows/scheduled-contribution-sync.yml`.
- It logs `::error::Internal coordinator failure (HTTP 500 Internal Server Error)`.
- It writes `### Background Contribution Sync Failure` to `$GITHUB_STEP_SUMMARY`.
- It exits with code 1 (`exit 1`), marking the GitHub Actions run as failed and triggering failure alerts.

#### 5. Was the contract intentionally changed?
**No.** There was no approved RFC, no design modification, and no code alteration changing `interrupted` to HTTP 200. The approved Sprint 2.5D specification (`interrupted` → HTTP 500) remains active, enforced, and intact in the source code. The discrepancy was entirely due to a typographical error in the Sprint 2.5E summary report narrative.

---

## 4. Test Evidence Inspection

Inspection of `tests/integration/internalSyncEndpointIntegration.test.ts` reveals the exact test catalog:
- **Test 1:** Missing secret configuration (`503 SYNC_SECRET_NOT_CONFIGURED`)
- **Test 2:** Missing authorization header (`401 UNAUTHORIZED`)
- **Test 3:** Incorrect secret (`401 UNAUTHORIZED`)
- **Test 4:** Correct secret (`200 OK`)
- **Test 5:** Coordinator invocation after authentication (`200 OK`)
- **Test 6:** Coordinator not invoked after failed authentication (`503` / `401`)
- **Test 7:** Concurrent endpoint requests (`200 OK` vs `409 DEFERRED_CONTENTION`)
- **Test 8:** Global advisory-lock contention (`409 DEFERRED_CONTENTION`)
- **Test 9:** Successful batch response (`200 OK`, `status: completed`)
- **Test 10:** Partial completion response (`200 OK`, `status: partially_completed`)
- **Test 11:** Internal coordinator failure (`500 INTERNAL_COORDINATOR_ERROR`)
- **Test 12:** Sanitization of returned errors and summaries (verifies numeric-only metrics and absence of sensitive tokens/passwords)
- **Test 13:** No secret leakage in logs or responses
- **Test 14:** Unsupported HTTP methods (`405 Method Not Allowed`)
- **Test 15:** Security: Forbids caller-supplied parameters (`400 FORBIDDEN_PARAMETER`)
- **Test 16:** Date validation: Strictly rejects future targetDate (`400 INVALID_TARGET_DATE`)
- **Test 17:** Date validation: Accepts valid historical targetDate (`200 OK`)

**Confirmation:** Test 12 did **not** test `interrupted -> 200`. It was an assertion on metric and credential sanitization.

---

## 5. Workflow Behavior Verification

Inspection of `.github/workflows/scheduled-contribution-sync.yml`:

1. **HTTP 200 (Completed / Partial Completion):**
   - Emits `Background sync completed successfully (HTTP 200)`.
   - Embeds sanitized response JSON in `$GITHUB_STEP_SUMMARY`.
   - Supported because the route only returns 200 when the coordinator reached normal completion (`completed` or `partially_completed`).
2. **HTTP 409 (Deferred Contention):**
   - Emits `::warning::Background sync deferred: another batch currently holds the global advisory lock (HTTP 409 Conflict)`.
   - Explicitly records `Status: Deferred Contention (HTTP 409)` in `$GITHUB_STEP_SUMMARY`.
   - Exits code 0 to prevent scheduled workflow failure alarms and retry storms while an active coordinator finishes.
3. **HTTP 401 & 503 (Configuration Diagnostics):**
   - HTTP 401 emits `::error::Authentication failed (HTTP 401 Unauthorized). Verify that SYNC_CRON_SECRET configured in GitHub repository secrets identically matches the secret configured on the deployed application.` and exits 1.
   - HTTP 503 emits `::error::Server secret not configured (HTTP 503 Service Unavailable). The deployed application reported that SYNC_CRON_SECRET is not set in its server environment.` and exits 1.
4. **HTTP 500 & Unhandled Responses:**
   - HTTP 500 emits `::error::Internal coordinator failure (HTTP 500 Internal Server Error)` and exits 1.
   - Any other code matches `*)`, logs `::error::Unexpected HTTP response from sync endpoint: HTTP ${HTTP_STATUS}`, and exits 1.
5. **Credential & Secret Protection:**
   - Shell tracing disabled via `set +x`.
   - Authorization bearer token passed via environment (`SYNC_SECRET`), not command-line argument.
   - Temporary curl response file removed immediately.
   - No secrets emitted to logs or `$GITHUB_STEP_SUMMARY`.

---

## 6. Recommendations

1. **Documentation Correction:** Update `reports/sprint_2_5e_scheduled_execution_report.md` Section 2.2 and Section 5.2 to remove the erroneous mention of `interrupted -> 200` and accurately document Test 12 as the sanitization test.
2. **Supplemental Integration Test:** Add an explicit test in `tests/integration/internalSyncEndpointIntegration.test.ts` asserting that a coordinator result of `{ status: 'interrupted' }` returns HTTP 500 with `code: 'BATCH_EXECUTION_FAILED'`, confirming the existing code path with automated regression coverage.

---

## 7. Audit Verdict

**VERDICT: APPROVED**

The code implementation, coordinator mechanics, and GitHub Actions workflow are in complete and strict compliance with the approved Sprint 2.5D contract. The reported discrepancy was solely a textual error in the Sprint 2.5E report documentation and does not reflect any defect or regression in the codebase.
