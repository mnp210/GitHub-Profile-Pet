# Sprint 5.2D-K — Historical PR Recovery Boundary & Checkpoint Integrity Audit

**Date:** 2026-11-25  
**Auditor/Engineer:** Antigravity Autonomous Agent  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Tested Application-Code Commit:** `fad33432aca64bf4f64a6f4ba6e2490bc069d649`  
**Production Repository:** `mnp210/GitHub-Profile-Pet`  
**Current Production HEAD:** `062da379b8fe35b7d1dd4b7753778588fefab897`  
**Authoritative Merge Base:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Final Sprint Verdict:** **READY FOR GATE A**

---

## 1. Executive Summary & Objective

Sprint 5.2D-K was conducted as a candidate-only audit and hardening sprint to resolve three specific historical recovery and checkpoint integrity boundaries:
1. **Recovery Beyond the 90-Day Lookback Ceiling:** Audit of what occurs when an outage exceeds 90 days, handling of absent/invalid `reconciledAt`, and preventing bounded scans from silently marking unprocessed historical events as reconciled.
2. **Recovery of Old PRs Merged During an Outage:** Verification and empirical testing of the scenario where a PR was opened long before an outage (e.g. 180 days ago) and merged during a workflow outage (e.g. 25 days ago).
3. **Recovery of PRs Skipped by Advanced Checkpoints:** Audit of legacy checkpoint advancement, distinguishing scanned events from processed events, and formalizing the smallest safe recovery mechanism without rewriting production checkpoints.

---

## 2. Technical Audit: The Three Recovery Boundaries

### Boundary 1: The 90-Day Lookback Ceiling & Missing `reconciledAt`
- **Behavior When `reconciledAt` Exceeds 90 Days:**
  In `scripts/process-activity.ts`, when `reconciledAt` is older than 90 days (e.g. a 120-day outage), `effectiveSinceIso` dynamically clamps to 90 days (`ninetyDaysAgo`) to prevent runaway, unbounded API sweeps.
  - *Hardening:* When this ceiling is encountered, the runner flags `isCappedAtLookbackCeiling = true`, logs an explicit notice, and registers a reconciliation warning:
    `Reconciliation lookback window reached 90-day ceiling. Outage spanned from <reconciledAt>. Events prior to <sinceIso> were bounded to avoid unbounded scanning.`
  - *Invariant Enforcement:* A bounded scan never silently marks unexamined historical periods as reconciled. Checkpoints advance based only on completed sweeps.
- **Behavior When `reconciledAt` is Absent or Invalid:**
  If `checkpoints.reconciledAt` is `undefined`, `null`, or an unparseable date string (`NaN`), `effectiveSinceIso` gracefully defaults to `fourteenDaysAgo` (14 days). Uncheckpointed PRs (`pr.number > stopAtPrNumber`) are still recognized and recovered in `prOpenLoop`.

### Boundary 2: Old PRs Merged During an Outage
- **Scenario Tested:**
  - PR opened 180 days ago (PR #10).
  - Checkpoint was PR #50.
  - Outage lasted 30 days (`reconciledAt` was 30 days ago; lookback expanded to 32 days).
  - PR was merged 25 days ago.
- **API Discovery & Ordering:**
  - Merged PRs are queried via `https://api.github.com/repos/{owner}/{repo}/pulls?state=closed&sort=updated&direction=desc`.
  - Because merging updates the PR's `updated_at` timestamp, PR #10 appears on page 1 of the closed PR stream, regardless of when it was opened.
- **Timestamp & Attribution Logic:**
  - The activity timestamp assigned to the event is `pr.merged_at` (25 days ago), NOT `pr.created_at` (180 days ago).
  - The actor is attributed to `pr.merged_by.login` (merger), NOT the author.
- **Hardened Staleness Bypass (`allowHistoricalRecovery`):**
  - Previously, `allowHistoricalRecovery` was calculated as `isStale || isUncheckpointed`. For PR #10, `10 <= 50` made `isUncheckpointed = false`, and being within the 32-day lookback made `isStale = false`, causing `allowHistoricalRecovery` to evaluate to `false` and triggering a false `skipped_stale` rejection in `evaluateActivityEvent`.
  - *Fix Applied:* `allowHistoricalRecovery` is now correctly set to `isOlderThanNormalWindow || isUncheckpointed` (`isOlderThanNormalWindow = isEventStale(pr.merged_at, nowUtc, MAX_ACTIVITY_AGE_DAYS)`). Because 25 days $> 14$ days, `allowHistoricalRecovery` is `true`.
  - *Result:* The merge event is rewarded with **+50 XP** and recorded in `processedRegistry.prMergedNumbers: [10]`. Subsequent cycles recognize it as duplicate and award 0 XP.

### Boundary 3: Checkpoint Integrity & Distinction Between Scanned and Processed Events
- **Scanned vs. Processed Events:**
  - **Scanned:** An event fetched in an API response or Git log line.
  - **Processed:** An event recorded permanently in `ledger.processedRegistry` and `ledger.permanentIndex`.
- **Legacy Checkpoint Advancement Analysis:**
  If a legacy run skipped a PR as stale but advanced `checkpoints.lastPrNumber = 50`:
  1. **PR Above Checkpoint (`pr.number > 50`):** Always discovered and processed.
  2. **PR Equal to Checkpoint (`pr.number === 50`):** Skipped by `pr.number <= options.stopAtPrNumber`.
  3. **PR Below Checkpoint (`pr.number < 50`):** Skipped because `pr.number <= options.stopAtPrNumber` terminates `prOpenLoop`.
- **Smallest Safe Recovery Mechanism:**
  - The production ledger's `processedRegistry` and `permanentIndex` are the authoritative source of truth of what has been awarded.
  - To recover skipped historical PRs below an advanced checkpoint, the runner or operator executes an explicit recovery sweep with `stopAtPrNumber: undefined`.
  - Because `isDuplicateEvent` checks `processedRegistry` and `permanentIndex` in $\mathcal{O}(1)$ time, every already-rewarded PR awards 0 XP (`skipped_duplicate`), while any missed PR is discovered and awarded.
  - Production checkpoints are never blindly rewritten or deleted.

---

## 3. Checkpoint Semantics & Truncated Pagination Protection

1. **Pagination Limit Protection:**
   In `reconciliation.ts`, if the GitHub Pulls API or Issues API reaches `maxPages` (10 pages) and the last page is full (`pulls.length >= pageSize`), but the scan has not reached `stopAtPrNumber`:
   - `completedFully` is set to `false`.
   - A warning is emitted: `GitHub Pull Requests API reached maximum pagination limit (10 pages). Additional uncheckpointed PRs remain unprocessed.`
   - `checkpoints.lastPrNumber` is **NOT** advanced to the latest PR on page 1. It preserves `options.stopAtPrNumber`.
   - `checkpoints.reconciledAt` is **NOT** advanced to `nowUtc`.
   - **Invariant Proven:** A checkpoint cannot advance beyond an unprocessed eligible event.
2. **Partial Failures & Crash Recovery:**
   - HTTP errors, network timeouts, or rate limits set `completedFully = false`.
   - Incomplete cycles leave stored checkpoints 100% intact.
   - The transaction journal (`.activity-journal.json`) recovers uncommitted files upon runner restart.

---

## 4. Full Automated Test & Quality Assurance Results

| Test Suite / Tool | Command | Tests Run | Result | Exit Code |
|-------------------|---------|-----------|--------|-----------|
| Unit Test Suite | `npm test` | 369 tests (125 suites) | 369 passed, 0 failed | 0 |
| Pet Engine Suite | `npm run test:pet-engine` | 547 tests (43 suites) | 547 passed, 0 failed | 0 |
| Integration Suite | `node --test tests/integration/crossSystemIntegration.test.ts` | 9 tests (6 suites) | 9 passed, 0 failed | 0 |
| **Total Automated Tests** | — | **925 tests** | **925 passed, 0 failed** | **0** |
| TypeScript Compiler | `npx tsc --noEmit` | Candidate root | 0 errors | 0 |
| ESLint Verification | `npm run lint` | Candidate root | 0 errors, 0 warnings | 0 |
| Next.js Production Build | `npm run build` | Turbopack static export | 4/4 static pages generated | 0 |

---

## 5. Authoritative Git Identity & Commit Reconciliation

### Authoritative Values:
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Tested Application-Code Commit:** `fad33432aca64bf4f64a6f4ba6e2490bc069d649`
- **Documentation Commit (Sprint 5.2D-K Report):** `[HEAD]`
- **Production Repository:** `mnp210/GitHub-Profile-Pet`
- **Current Production HEAD (`origin/main`):** `062da379b8fe35b7d1dd4b7753778588fefab897`
- **Authoritative Common Ancestor (Merge Base):** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Production Ahead Count (behind candidate):** 6 commits
- **Candidate Ahead Count:** 18 commits (application code `fad3343`) / 19 commits (with documentation)

### Explicit Commit Reconciliation:
- In Sprint 5.2D-J, the application code was committed at `136d0849fdbc34c4ef7bd3256de046cabcf1d0b9` (16 commits ahead of merge base).
- Subsequently, the Sprint 5.2D-J report was added in commit `e053c91e5914e736fc7f355e4004a21783a554b5` (17 commits ahead of merge base).
- In Sprint 5.2D-K, the hardened application code and regression tests were committed at `fad33432aca64bf4f64a6f4ba6e2490bc069d649` (18 commits ahead of merge base).
- The current documentation commit forms commit 19 ahead of merge base.

---

## 6. Live-State Preservation & 3-Way Merge Verification

A 3-way merge simulation was executed against production HEAD (`origin/main`, commit `062da379b8fe35b7d1dd4b7753778588fefab897`):
- Clean 3-way merge with 0 conflicts.
- Blob equality across all 5 live production assets confirmed 100% byte-for-byte identical:

| Protected Path | `origin/main` Blob Hash | Merge Tree Blob Hash | Status |
|----------------|-------------------------|----------------------|--------|
| `pet/state/pet.json` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | **100% Identical** |
| `pet/ledger/activity.json` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | **100% Identical** |
| `pet/ledger/actions.json` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | **100% Identical** |
| `pet/ledger/contributions.json` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | **100% Identical** |
| `public/pet.svg` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | **100% Identical** |

---

## 7. Final Sprint Verdict

**READY FOR GATE A**

All three recovery boundaries (lookback ceiling, old PR merge outage recovery, and checkpoint integrity semantics) are mathematically and empirically verified across 925 passing automated tests.

---

## 8. Mandatory Compliance Statement

No push was performed, no Pull Request was created, no workflow was dispatched, and no production repository or live pet state was modified.
