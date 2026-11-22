# Sprint 5.0C — Test & Simulation Report

## 1. Test Suite Execution Summary

All tests executed in local candidate workspace (`D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`) against Node.js runtime with TypeScript type stripping.

| Test Suite File / Group | Tests Run | Passed | Failed | Execution Time | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `tests/unit/failureAlert.test.ts` (Sprint 5.0C Suite) | 20 | 20 | 0 | 138.7 ms | **PASS** |
| `tests/unit/*.test.ts` (Full Unit Test Suite) | 239 | 239 | 0 | 1,299.8 ms | **PASS** |
| `tests/pet-engine/*.test.ts` (Full Engine Test Suite) | 547 | 547 | 0 | 66,970.8 ms | **PASS** |
| **Combined Project Tests** | **786** | **786** | **0** | **~68.4 s** | **100% PASS** |

### TypeScript Compilation & Linting
- `npx tsc --noEmit`: **0 errors**, clean type check.
- `npm run lint`: **0 errors, 0 warnings**, clean ESLint verification.

---

## 2. Sprint 5.0C Unit Test Breakdown (`tests/unit/failureAlert.test.ts`)

| Category | Test Case Name | Result |
| :--- | :--- | :---: |
| **Fingerprinting & ID** | generates consistent lowercase fingerprint across different casing and paths | PASS |
| | generates distinct fingerprints for different workflow files | PASS |
| | embeds and extracts fingerprint from Markdown comment body | PASS |
| | formats failure update and recovery comments with valid fingerprint and details | PASS |
| **Security & Sanitization** | redacts tokens and bearer credentials from issue title and body | PASS |
| | escapes Markdown pipes and HTML brackets in diagnostic context and summary | PASS |
| | blocks execution when event originates from a foreign fork (Fork PR Guard) | PASS |
| **Activation Boundary** | disables issue creation when FAILURE_ALERTS_ENABLED is missing or unset | PASS |
| | disables issue creation when FAILURE_ALERTS_ENABLED is "false" | PASS |
| | withholds issue creation when dryRun option is explicitly true | PASS |
| **Conclusion Filtering** | ignores cancelled workflow runs without creating issues | PASS |
| | ignores skipped workflow runs without creating issues | PASS |
| | treats timed_out conclusions as qualifying failures | PASS |
| **Deduplication State Machine** | creates exactly 1 issue on initial failure, and updates existing issue on subsequent failure | PASS |
| | creates distinct issues for two different workflows failing concurrently | PASS |
| | allows a new failure alert if a previous historical issue has been closed | PASS |
| | posts recovery comment when an open issue exists and workflow succeeds | PASS |
| | performs zero noise NOOP on workflow success when no open alert issue exists | PASS |
| **Resilience & Fault Tolerance** | safely handles GitHub API failures without crashing | PASS |
| | retries issue creation without labels if repository label creation fails with HTTP 422 | PASS |

---

## 3. CLI Simulation Verification

Local simulations executed using `scripts/alert-workflow-failure.ts`:

### A. Forced Dry-Run Simulation
```powershell
node --experimental-strip-types scripts/alert-workflow-failure.ts `
  --workflow-name "Pet Activity Progression" `
  --workflow-file pet-activity.yml `
  --run-id 45042048859 `
  --conclusion failure `
  --dry-run
```
**Output:**
```
================================================================
GitHub Profile Pet — Automated Failure Alert Evaluator
================================================================
Workflow:      Pet Activity Progression (pet-activity.yml)
Run ID:        45042048859 (Attempt: 1)
Repository:    unknown/unknown
Branch / SHA:  main @ HEAD
Conclusion:    FAILURE
Dry-Run:       YES (Forced)
----------------------------------------------------------------
Result Status: DRY_RUN
Details:       Alert payload generated successfully (Explicit --dry-run active). Issue creation withheld.
Fingerprint:   unknown/unknown:pet-activity.yml:workflow_failure
```
**Exit Code:** `0` (Success, no issues created).

### B. Disabled-by-Default Boundary Simulation
```powershell
node --experimental-strip-types scripts/alert-workflow-failure.ts `
  --workflow-name "Pet Activity Progression" `
  --workflow-file pet-activity.yml `
  --run-id 45042048859 `
  --conclusion failure
```
**Output:**
```
================================================================
GitHub Profile Pet — Automated Failure Alert Evaluator
================================================================
Workflow:      Pet Activity Progression (pet-activity.yml)
Run ID:        45042048859 (Attempt: 1)
Repository:    unknown/unknown
Branch / SHA:  main @ HEAD
Conclusion:    FAILURE
Dry-Run:       NO (Governed by FAILURE_ALERTS_ENABLED)
----------------------------------------------------------------
Result Status: DISABLED
Details:       Alert payload generated successfully (FAILURE_ALERTS_ENABLED is false or unset). Issue creation withheld.
Fingerprint:   unknown/unknown:pet-activity.yml:workflow_failure
```
**Exit Code:** `0` (Success, no issues created, safe fail-closed behavior verified).
