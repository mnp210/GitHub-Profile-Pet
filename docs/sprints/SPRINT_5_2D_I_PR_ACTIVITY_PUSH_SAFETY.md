# Sprint 5.2D-I — PR Activity Push Safety Correction & Regression Verification

**Date:** 2026-11-24  
**Auditor/Engineer:** Antigravity Autonomous Agent  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Candidate Code Base HEAD (Post-Fix):** `37b22f19b4fa9e1f49f241942d6cbdde91476ae5`  
**Production Repository:** `mnp210/GitHub-Profile-Pet`  
**Current Production HEAD:** `062da379b8fe35b7d1dd4b7753778588fefab897`  
**Authoritative Merge Base:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Simulated 3-Way Merge Tree Root:** `2ef12bbb3cbe3ff9f6998a7a273db75d537122b3`  
**Final Sprint Verdict:** **READY FOR GATE A**

---

## 1. Executive Summary & Root Cause Analysis

### A. Root Cause
In Sprint 5.2D-H, empirical git ref resolution proved that when `pet-activity.yml` was triggered by a `pull_request` event:
1. GitHub Actions checks out the ephemeral merge ref `refs/pull/<pr_number>/merge`.
2. The environment variable `GITHUB_REF_NAME` was set to `<pr_number>/merge`.
3. `scripts/process-activity.ts` was invoked with `--ref "${{ github.ref_name }}"`, stripping `refs/heads/` to produce `targetRef = "<pr_number>/merge"`.
4. When qualifying activity was evaluated (+25 XP for PR opened), the script executed:
   ```bash
   git push origin HEAD:<pr_number>/merge
   ```
5. Per standard Git refspec rules, an unqualified destination ref defaults to the `refs/heads/` namespace, resolving to:
   $$\mathbf{refs/heads/<pr\_number>/merge}$$
6. **Side Effect:** This constructed an unintended branch in the production repository, or alternatively caused the workflow to enter an exhausting retry loop (`git fetch origin <pr>/merge`), failing closed with error code 1. Furthermore, local ephemeral changes on the runner did not update production `main`.

### B. Selected Remedy: Option B (Pre-Gate A Normalization)
Rather than accepting unintended branch creation or a failed PR-activity check run as acceptable release side effects, Sprint 5.2D-I implemented Option B:
- Explicit detection and isolation of Pull Request execution contexts (`isPrContext`, `isPermittedPushRef`).
- Omission of direct Git push and remote ref mutations during PR events.
- Enforcement that PR events can never push to `refs/heads/<pr_number>/merge` and can never push to `main` as a workaround.
- Safe, idempotent deferral of PR-opened rewards to the existing default-branch reconciliation engine (`performCompleteReconciliation`), which sweeps the GitHub Pulls API on every push to `main` and on the 30-minute scheduled cron.
- Comprehensive 14-test regression test suite covering all 10 safety requirements.

---

## 2. Exact Code Changes

### 1. `scripts/process-activity.ts`
- **Added `isPrContext(eventName?: string, targetRef?: string): boolean`:**
  Identifies whether the current execution is triggered by `pull_request` or `pull_request_review`, or targets an ephemeral/PR ref (`refs/pull/*`, `pull/*`, `*/merge`, `*head`, `^[0-9]+(/|$)`).
- **Added `isPermittedPushRef(targetRef: string): boolean`:**
  Guarantees that destination refs targeting PR namespaces or number-prefixed branches are strictly rejected for push operations.
- **Refactored `runProcessingCycle`:**
  - Accepts `eventName?: string` and optional mock `execGitFn` for testability.
  - When `isPrContext` is active:
    - Skips unapplied transaction recovery and full repository reconciliation sweeps.
    - Forces `effectiveDryRun = true` for event evaluation so the runner working tree is never dirtied.
    - Omits Git staging, commit, and push.
    - Records publication telemetry as `status: 'DEFERRED_TO_RECONCILIATION'`.
    - Writes a clear GitHub Step Summary documenting the validated event and explaining the deferred reconciliation path.
    - Returns cleanly with exit code 0.
  - When on the default branch (`main`):
    - Reconciles commits, issues, PR creations, PR merges, and reviews.
    - Evaluates events against daily caps and deduplication registries.
    - Stages modified manifest files, commits, and pushes atomically to `origin/main`.
- **Refactored `main()`:**
  - Implements single-pass execution for PR contexts (bypassing fetch/reset retry loops against non-existent remote branches).
  - Protects the retry loop with `isPermittedPushRef(targetRef)`.
  - Added `isMainModule` guard so that `process-activity.ts` exports can be imported into unit test suites without triggering CLI execution.

### 2. `src/features/pet-engine/reporting/stepSummary.ts`
- Extended `ActivityPublicationTelemetry['status']` to include `'DEFERRED_TO_RECONCILIATION'` and optional `reason?: string`.
- Added Markdown formatting for `DEFERRED_TO_RECONCILIATION` in `formatActivitySummary`:
  ```markdown
  - **Outcome:** ⏳ **Deferred to Reconciliation (`DEFERRED_TO_RECONCILIATION`)**
  - **Reason:** Event recognized and validated in PR context. Direct git push is safely omitted to prevent creating unintended branches or mutating unmerged refs.
  - **Durable Persistence:** Durable ledger recording and pet state update will be reconciled automatically during the next default-branch sweep (on push to main or scheduled cron).
  ```

### 3. `tests/unit/prActivityPushSafety.test.ts`
- Authored a dedicated 14-test regression suite directly validating all 10 required safety boundaries.

---

## 3. PR Event Lifecycle Comparison: Before vs After

| Lifecycle Stage | Before Sprint 5.2D-I | After Sprint 5.2D-I |
| :--- | :--- | :--- |
| **1. PR Opened Event** | Runner evaluates event, writes runner files, attempts `git push origin HEAD:<pr>/merge`. | Runner evaluates & validates event. Direct push skipped. Reports `DEFERRED_TO_RECONCILIATION`. Exits cleanly with code 0. |
| **2. Remote Branches on GitHub** | Risk of creating orphan branch `refs/heads/<pr>/merge` or logging failed push collision error. | **Zero remote mutations.** `origin/main` and remote namespaces remain 100% untouched. |
| **3. PR Sync / Reopen** | Not configured in `pet-activity.yml`. | Not configured in `pet-activity.yml`. (Safe no-op). |
| **4. PR Closed (Unmerged)** | `merged: false`. No reward. | `merged: false`. No reward. Zero Git calls. |
| **5. PR Closed (Merged)** | Attempted push to `<pr>/merge`. | Direct push skipped in PR context. Merge reward handled on `main`. |
| **6. Subsequent Push to `main` (or 30-min cron)** | Sweeps repository and reconciles activity. | **Reconciliation Engine:** Fetches Pull Requests from GitHub API, discovers `pr_opened:<number>` (and `pr_merged:<number>`), awards XP, updates checkpoints, and pushes to `origin/main`. |

---

## 4. Preservation of PR-Opened Activity Rewards

### The Preservation Mechanism
1. **Event Capture at GitHub API Level:** Every Pull Request opened on the repository is permanently recorded by the GitHub Pull Requests API (`GET /repos/{owner}/{repo}/pulls?state=all&sort=created&direction=desc`).
2. **Reconciliation on Default Branch:**
   In `src/features/pet-engine/activity/reconciliation.ts`:
   Lines 290–356 (`reconcileGitHubApiEvents`) actively page through all pull requests created within the 14-day eligibility window.
3. **Trigger Cadence on `main`:**
   - **Scheduled Cron:** Runs every 30 minutes (`schedule: cron: '*/30 * * * *'`) in `.github/workflows/pet-activity.yml`.
   - **Push to Default Branch:** Runs on every commit pushed to `main` (`push: branches: [main]`), including PR merges.
   - **Manual Dispatch:** Runs on `workflow_dispatch`.
4. **Idempotence & Deduplication:**
   When `pr_opened:<number>` is discovered during reconciliation:
   - `activityProcessor.ts` checks `ledger.processedRegistry.prOpenedNumbers`.
   - If not previously processed: awards +25 XP, updates pet level/evolution, appends `<number>` to `prOpenedNumbers`, updates `checkpoints.lastPrNumber`, and persists atomically to `main`.
   - If already processed: marks event `skipped_duplicate` with 0 XP.
   - Enforces the 300 XP per repository per UTC day cap.
5. **No Second Ledger Required:** Operates 100% within the existing single activity ledger architecture (`pet/ledger/activity.json`).

---

## 5. Regression Test Evidence

The dedicated test file [tests/unit/prActivityPushSafety.test.ts](file:///D:/Projects/GitHub-Profile-Pet-R3.7-Candidate/tests/unit/prActivityPushSafety.test.ts) verifies all 10 requirements:

| # | Requirement | Test Case | Status |
| :-: | :--- | :--- | :-: |
| 1 | PR-opened events never invoke Git push | `never calls git push and does not construct HEAD:<pr>/merge when processing a PR-opened event` | **PASSED** |
| 2 | No unqualified PR merge destination is constructed | `never calls git push and does not construct HEAD:<pr>/merge when processing a PR-opened event` | **PASSED** |
| 3 | No PR event can accidentally target `main` | `never pushes to main even if targetRef is explicitly set to main during a pull_request event` | **PASSED** |
| 4 | Eligible PR-opened rewards are not silently lost | `awards +25 XP when the PR-opened event is picked up during default-branch reconciliation` | **PASSED** |
| 5 | Repeated delivery awards no duplicate XP | `returns status duplicate and awards 0 XP on duplicate PR-opened delivery` | **PASSED** |
| 6 | PR close-unmerged awards no merge reward | `does not discover or award merge XP when closed PR has merged_at null` | **PASSED** |
| 7 | PR merge follows intended reward policy | `awards +50 XP for PR merge to merger and prevents duplicate merge rewards` | **PASSED** |
| 8 | Normal default-branch push persists successfully | `successfully stages, commits, and pushes to origin/main when running on default branch with token` | **PASSED** |
| 9 | Push failure does not produce false success | `propagates the push error and does not report success when git push fails` | **PASSED** |
| 10 | Actor validation & 300 XP cap remain intact | `rejects bot actors from earning activity XP`<br>`enforces the 300 XP per repository per UTC day cap` | **PASSED** |

---

## 6. Full Verification Results

All automated test suites, type checking, linting, and build verification were executed fresh on the candidate workspace:

| Verification Suite | Target | Baseline (Sprint 5.2D) | Actual Total (Sprint 5.2D-I) | Failures | Exit Code |
| :--- | :--- | :-: | :-: | :-: | :-: |
| **Unit Test Suite** | `npm test` | 338 tests / 103 suites | **352 tests / 114 suites** | 0 | 0 |
| **Pet Engine Suite** | `npm run test:pet-engine` | 547 tests / 43 suites | **547 tests / 43 suites** | 0 | 0 |
| **Cross-System Integration** | `node --test tests/integration/...` | 9 tests / 6 suites | **9 tests / 6 suites** | 0 | 0 |
| **Total Automated Tests** | All Suites Combined | 894 tests | **908 tests** (+14 new) | **0** | **0** |
| **TypeScript Typecheck** | `npx tsc --noEmit` | Clean (0 errors) | **Clean (0 errors)** | 0 | 0 |
| **ESLint Quality Gate** | `npm run lint` | Clean (0 errors/warnings) | **Clean (0 errors/warnings)** | 0 | 0 |
| **Static Build** | `npm run build` | 4/4 static pages | **4/4 static pages (779ms)** | 0 | 0 |

---

## 7. Git Lineage & Release Invariants

### A. Authoritative Git Status
- **Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Candidate HEAD Commit:** `37b22f19b4fa9e1f49f241942d6cbdde91476ae5`
- **Production Repository:** `mnp210/GitHub-Profile-Pet`
- **Current Production HEAD (`origin/main`):** `062da379b8fe35b7d1dd4b7753778588fefab897`
- **Commit Divergence:** Candidate is ahead by **14 commits**, Production is ahead by **6 commits**.

### B. Six Protected Files Integrity (100% Exact Blob Equality)
Simulating a 3-way merge between current production HEAD (`062da37`) and candidate HEAD (`37b22f1`) produces root tree `2ef12bbb3cbe3ff9f6998a7a273db75d537122b3`. Every live production state document is retained with **100% exact blob equality**:

| Protected Path | Production Blob (`origin/main`) | Merge-Tree Blob (`2ef12bb...`) | Verdict |
| :--- | :--- | :--- | :--- |
| `pet/state/pet.json` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | **100% EXACT MATCH (Level 4, Gen 42)** |
| `pet/ledger/activity.json` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | **100% EXACT MATCH** |
| `pet/ledger/archive/activity_archive.json` | *(Non-existent)* | *(Non-existent)* | **Preserved as Non-Existent** |
| `pet/ledger/actions.json` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | **100% EXACT MATCH** |
| `pet/ledger/contributions.json` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | **100% EXACT MATCH** |
| `public/pet.svg` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | **100% EXACT MATCH** |

---

## 8. Final Verdict

### **READY FOR GATE A**

- **Justification:**
  1. The PR-event branch push defect has been fully normalized in code and verified with 14 automated regression tests.
  2. Opening the PR will execute `pet-activity.yml` cleanly, validate the PR event, report `DEFERRED_TO_RECONCILIATION`, and exit with code 0 without attempting any git push.
  3. No unintended branches (`refs/heads/<pr>/merge`) can be created.
  4. Production `main` is completely protected from accidental mutations.
  5. The PR-opened activity reward (+25 XP) is preserved through the existing supported reconciliation engine and will be durably recorded during the next default-branch sweep.
  6. All 908 automated tests pass with 0 failures, 0 lint errors, and 0 TypeScript errors.
  7. All 6 production state and ledger files remain 100% byte-for-byte identical.

---

> **Strict Operational Boundary Confirmation:**
> **No push was performed, no Pull Request was created, no workflow was dispatched, and no production repository or live pet state was modified.**
