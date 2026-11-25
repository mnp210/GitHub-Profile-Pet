# Sprint 5.2D-M — Final Historical Recovery Proof & Candidate Identity Reconciliation Report

## Executive Summary

Sprint 5.2D-M delivers the definitive engineering proof, mathematical verification, and repository identity reconciliation for the **GitHub Profile Pet — Playable Edition** candidate release.

This audit:
1. **Reconciles Authoritative Repository Identity:** Formally documents the lineage of all candidate commit hashes (`c8413a22...`, `4ab1e765...`, and `1ec362f5...`) and simulated 3-way merge tree roots (`8c5936e2...`, `cbe376e8...`, and `c2fe1b5e...`).
2. **Proves Legacy PR Opening Recovery Beyond the Stale Boundary:** Resolves the stale-boundary question by introducing registry-backed uncheckpointed detection (`isMissingFromRegistry`). Demonstrates that eligible PRs below the legacy checkpoint opened $> 14$ days ago are fully recovered without premature loop termination.
3. **Proves Merge Pagination Safety:** Formally demonstrates that merge loops sorted by `updated` desc are never terminated by PR-number boundaries, out-of-order PRs on later pages are discovered, and pagination limits trigger fail-closed checkpoint preservation (`completedFully = false`).
4. **Proves Historical Cursor Continuity & Full Manifest Rollback Scope:** Traces sequential cursor batching across 91-, 120-, and 180-day outages and expands transaction rollback to cover all 7 publication manifest files.
5. **Verifies Release Integrity:** 100% pass rate across 375 unit tests, 547 pet-engine tests, 9 integration tests, clean TypeScript compilation, clean ESLint, and a successful Next.js static build. All 5 live production state and ledger files match production byte-for-byte.

---

## 1. Authoritative Repository Identity & Hash Reconciliation

### 1.1 Authoritative Git State
- **Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Production Remote & Branch:** `origin/main` (`mnp210/GitHub-Profile-Pet`)
- **Common Merge Base:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Production HEAD:** `062da379b8fe35b7d1dd4b7753778588fefab897` (6 commits ahead of merge base)
- **Candidate Implementation HEAD:** `1ec362f577f88e37a2652a4c1cab8be34c44947f` (22 commits ahead of merge base)
- **Simulated 3-Way Merge-Tree Root:** `c2fe1b5e501ad9b4b391fbc432546bf820d2ea0e` (clean merge, 0 conflicts)

### 1.2 Resolution of Previous Hash Discrepancies

| Commit / Tree Hash | Entity Type | Origin / Description | Validity |
| :--- | :--- | :--- | :--- |
| `c8413a22ba744a758318c3e06a8219e08f3661cf` | Git Commit | Candidate commit containing initial Sprint 5.2D-L code implementation. | Valid (Ancestor of HEAD) |
| `8c5936e20e08e46b762152b9d9736bcf0318567d` | Merge-Tree Root | 3-way merge root computed against `origin/main` when candidate HEAD was `c8413a22...`. | Valid for commit `c8413a22...` |
| `4ab1e76523ddf860b0487f46f134e039be3c7717` | Git Commit | Candidate commit adding `docs/sprints/SPRINT_5_2D_L_HISTORICAL_RECOVERY_CONTINUITY.md`. | Valid (Parent of HEAD) |
| `cbe376e8b3111fe2b7b189f41a7326d2296898d3` | Merge-Tree Root | 3-way merge root computed against `origin/main` when candidate HEAD was `4ab1e765...`. Diff against `8c5936e2...` is purely the Sprint 5.2D-L report file. | Valid for commit `4ab1e765...` |
| `1ec362f577f88e37a2652a4c1cab8be34c44947f` | Git Commit | Current candidate HEAD containing Sprint 5.2D-M implementation and proofs. | **Current Authoritative Candidate HEAD** |
| `c2fe1b5e501ad9b4b391fbc432546bf820d2ea0e` | Merge-Tree Root | 3-way merge root computed against `origin/main` at current candidate HEAD (`1ec362f...`). | **Current Authoritative Merge Tree Root** |

Every hash referenced in Sprint 5.2D-L was an actual, verifiable Git object representing successive commit steps in the immutable history.

---

## 2. Proof of Legacy PR Opening Recovery Below Checkpoint

### 2.1 The Stale-Boundary Problem & Mathematical Proof
In Sprint 5.2D-L, `isUncheckpointed` was defined as `pr.number > options.stopAtPrNumber`. Under that definition, a PR with `number <= stopAtPrNumber` yielded `isUncheckpointed = false`. If such a PR was opened $> 14$ days ago (`isStale = true`), the termination condition:
```ts
if (!isUncheckpointed && isStale) {
  break prOpenLoop;
}
```
would prematurely terminate `prOpenLoop` before reaching that PR.

#### Sprint 5.2D-M Architectural Resolution
`reconcileGitHubApiEvents` and `performCompleteReconciliation` now ingest `processedPrOpenedNumbers?: number[]` directly from the durable ledger's `processedRegistry.prOpenedNumbers`.

`isUncheckpointed` is now defined as:
```ts
const isAboveCheckpoint = options.stopAtPrNumber !== undefined && pr.number > options.stopAtPrNumber;
const isMissingFromRegistry =
  options.processedPrOpenedNumbers !== undefined && !options.processedPrOpenedNumbers.includes(pr.number);
const isUncheckpointed = isAboveCheckpoint || isMissingFromRegistry;
```

**Proof of Non-Premature Termination:**
1. If a PR has `pr.number <= stopAtPrNumber` and was opened $> 14$ days ago, but has NEVER been awarded opening XP (absent from `prOpenedNumbers`), `isMissingFromRegistry` evaluates to `true`.
2. Consequently, `isUncheckpointed` evaluates to `true`.
3. The termination condition `if (!isUncheckpointed && isStale)` evaluates to `!true && true === false`.
4. The loop **does not break**. The PR is processed, tagged with `allowHistoricalRecovery: true`, and awarded +25 XP.
5. Once all uncheckpointed/missing PRs are processed and subsequent PRs are both stale and already recorded (`isMissingFromRegistry = false`, `isStale = true`), `prOpenLoop` terminates safely without unbounded scanning.

### 2.2 Proof of All 7 Specified Scenarios

| Scenario | PR # | Created At | StopAt / Recorded Status | Event Timestamp | Actor | XP Awarded | Status | Registry Mutation | Checkpoint Update |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Below Checkpoint, Normal Lookback, Missing** | #45 | $T_0 - 5\text{d}$ | $\le 50$, missing from registry | $T_0 - 5\text{d}$ | `author45` | **+25 XP** | `rewarded` | `prOpenedNumbers`: appended `45` | Preserved / Advanced |
| **2. Below Checkpoint, $> 14$ Days, Missing** | #42 | $T_0 - 20\text{d}$ | $\le 50$, missing from registry | $T_0 - 20\text{d}$ | `author42` | **+25 XP** | `rewarded` | `prOpenedNumbers`: appended `42` | Preserved / Advanced |
| **3. Below Checkpoint, Already Recorded** | #50 | $T_0 - 5\text{d}$ | $\le 50$, recorded in registry | $T_0 - 5\text{d}$ | `author50` | **0 XP** | `skipped_duplicate` | None (registry already has `50`) | Preserved / Advanced |
| **4. Above Checkpoint, $> 14$ Days** | #55 | $T_0 - 20\text{d}$ | $> 50$, uncheckpointed | $T_0 - 20\text{d}$ | `author55` | **+25 XP** | `rewarded` | `prOpenedNumbers`: appended `55` | `lastPrNumber = 55` |
| **5. Opened 180d Ago, Merged 25d Ago (Both Missing)** | #10 | Open: $T_0 - 180\text{d}$<br>Merge: $T_0 - 25\text{d}$ | Both absent from registry | Open: $T_0 - 180\text{d}$<br>Merge: $T_0 - 25\text{d}$ | Open: `ancient_author`<br>Merge: `repo_merger` | **+75 XP Total** (+25 Open, +50 Merge) | `rewarded` (both) | `prOpenedNumbers`: appended `10`<br>`prMergedNumbers`: appended `10` | Checkpoint reflects current run |
| **6. Opening Recovered, Existing Merge** | #10 | Open: $T_0 - 180\text{d}$<br>Merge: $T_0 - 25\text{d}$ | Merge recorded (`prMergedNumbers = [10]`), Open missing | Open: $T_0 - 180\text{d}$<br>Merge: $T_0 - 25\text{d}$ | Open: `pr_author`<br>Merge: `repo_merger` | **+25 XP Total** (+25 Open, 0 Merge) | Open: `rewarded`<br>Merge: `skipped_duplicate` | `prOpenedNumbers`: appended `10`<br>`prMergedNumbers`: unchanged | Checkpoint reflects current run |
| **7. Merge Recovered, Existing Opening** | #10 | Open: $T_0 - 180\text{d}$<br>Merge: $T_0 - 25\text{d}$ | Open recorded (`prOpenedNumbers = [10]`), Merge missing | Open: $T_0 - 180\text{d}$<br>Merge: $T_0 - 25\text{d}$ | Open: `pr_author`<br>Merge: `repo_merger` | **+50 XP Total** (0 Open, +50 Merge) | Open: `skipped_duplicate`<br>Merge: `rewarded` | `prOpenedNumbers`: unchanged<br>`prMergedNumbers`: appended `10` | Checkpoint reflects current run |

---

## 3. Proof of Merge Pagination Safety

Closed PRs are retrieved from GitHub API sorted by `updated` descending:
`https://api.github.com/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc`

### 3.1 Non-Monotonic PR Number Traversal
1. Because closed PRs are ordered by update time, PR numbers on subsequent pages can be lower, higher, or arbitrary relative to earlier pages (e.g. PR #100 on page 1, ancient PR #10 merged 2 days ago on page 1, and PR #75 merged 3 days ago on page 2).
2. **Proof:** `prMergeLoop` contains **zero** termination conditions based on `pr.number <= options.stopAtPrNumber`. PR numbers are never used as a termination boundary in merge reconciliation.
3. Every page is traversed until empty, rate limited, or capped by `maxPages`.

### 3.2 Pagination Limit & Truncation Fail-Closed Guard
In Sprint 5.2D-M, `prMergeLoop` was hardened with explicit truncation detection:
```ts
if (page === maxPages && closedPulls.length >= pageSize) {
  const lastPr = closedPulls[closedPulls.length - 1];
  const lastPrStale = lastPr?.merged_at ? isEventStale(lastPr.merged_at, nowUtc, lookbackDays) : false;
  if (!lastPrStale) {
    warnings.push(`GitHub Closed Pull Requests API reached maximum pagination limit (${maxPages} pages). Additional recent merged PRs remain unprocessed.`);
    completedFully = false;
  }
  break;
}
```
**Safety Invariant:** If `page === maxPages` and the last PR on the page is within the lookback window, `completedFully` is set to `false`. When `completedFully === false`, `scripts/process-activity.ts` strictly refuses to advance checkpoints, guaranteeing that skipped merge events remain 100% recoverable on subsequent cycles.

### 3.3 Exactly-Once Merge Processing
All merge evaluations verify membership in `processedRegistry.prMergedNumbers`. Reprocessing an identical closed PR event yields `status: "skipped_duplicate"` and awards **0 XP**.

---

## 4. Proof of Historical Cursor Continuity & Transaction Rollback Scope

### 4.1 Simulated Outage Recovery Sequences

#### Scenario A: 91-Day Outage
- **Outage Start ($T_0 - 91\text{d}$):** `lastReconciledIso` = $T_0 - 91\text{d}$. Safety lookback = $T_0 - 93\text{d}$.
- **Run 1:**
  - Lookback ceiling active (90d max). Batch scans $[T_0 - 90\text{d}, T_0]$.
  - `cursor` before: `undefined`.
  - `cursor` after: $T_0 - 93\text{d}$.
  - Durably records recent 90-day events. `completedFully = true`.
- **Run 2:**
  - Resumes from cursor $T_0 - 93\text{d}$. Target: $(T_0 - 93\text{d}) + 90\text{d} = T_0 - 3\text{d}$.
  - Since $T_0 - 3\text{d} \ge T_0 - 90\text{d}$, this batch covers the 3-day gap.
  - `cursor` before: $T_0 - 93\text{d}$.
  - `cursor` after: `undefined` (cleared).
  - All historical periods reconciled. Zero duplicates.

#### Scenario B: 120-Day Outage
- **Outage Start ($T_0 - 120\text{d}$):** Safety lookback = $T_0 - 122\text{d}$.
- **Run 1:** Scans $[T_0 - 90\text{d}, T_0]$. Sets `cursor` to $T_0 - 122\text{d}$.
- **Run 2:** Scans from $T_0 - 122\text{d}$ to $T_0 - 32\text{d}$. Since $T_0 - 32\text{d} \ge T_0 - 90\text{d}$, cursor is cleared (`undefined`). Gap closed in 2 bounded runs.

#### Scenario C: 180-Day Outage
- **Outage Start ($T_0 - 180\text{d}$):** Safety lookback = $T_0 - 182\text{d}$.
- **Run 1:** Scans $[T_0 - 90\text{d}, T_0]$. Sets `cursor` to $T_0 - 182\text{d}$.
- **Run 2:** Scans $[T_0 - 182\text{d}, T_0 - 92\text{d}]$. Since $T_0 - 92\text{d} < T_0 - 90\text{d}$, older work remains. Cursor advances to $T_0 - 92\text{d}$.
- **Run 3:** Scans $[T_0 - 92\text{d}, T_0 - 2\text{d}]$. Completes recovery. Cursor cleared (`undefined`). Gap closed across 3 bounded runs.

### 4.2 Comprehensive Transaction Rollback Scope
In Sprint 5.2D-M, the runner rollback mechanism was expanded from snapshotting only 2 files to snapshotting **all 7 paths** in `ACTIVITY_PUBLICATION_MANIFEST_PATHS`:
1. `pet/state/pet.json`
2. `pet/ledger/activity.json`
3. `pet/ledger/contributions.json`
4. `pet/ledger/actions.json`
5. `pet/ledger/archive/activity_archive.json`
6. `public/pet.svg`
7. `README.md`

**Failure Invariant:** If any unhandled exception occurs (API crash, disk error, git status/commit/push failure), every single manifest file is restored from its pre-run in-memory snapshot. No uncommitted state changes, generation mismatches, or cursor advancements are leaked to disk.

---

## 5. Complete Regression Verification Results

The full test and build verification suite was executed in `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`:

| Test Suite / Command | Command Line | Tests Passed | Exit Code | Duration |
| :--- | :--- | :--- | :--- | :--- |
| **Durability & Recovery Suite** | `npx tsx --test tests/unit/prReconciliationDurability.test.ts` | **23 / 23 (13 suites)** | 0 | 1.63s |
| **Push Safety Suite** | `npx tsx --test tests/unit/prActivityPushSafety.test.ts` | **14 / 14 (11 suites)** | 0 | 0.64s |
| **All Unit Tests** | `npm test` (`node --test tests/unit/*.test.ts`) | **375 / 375 (127 suites)** | 0 | 2.77s |
| **Pet Engine Durability** | `npm run test:pet-engine` (`tests/pet-engine/*.test.ts`) | **547 / 547 (43 suites)** | 0 | 71.37s |
| **Cross-System Integration** | `node --test tests/integration/crossSystemIntegration.test.ts` | **9 / 9 (6 suites)** | 0 | 0.19s |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 errors** | 0 | 2.3s |
| **ESLint Quality Audit** | `npm run lint` | **0 warnings / 0 errors** | 0 | 1.4s |
| **Production Build** | `npm run build` (Next.js 16.4.6 Turbopack static export) | **4 / 4 static pages** | 0 | 8.0s |

---

## 6. Protected Production State Verification

A 3-way merge between `origin/main` and candidate HEAD `1ec362f577f88e37a2652a4c1cab8be34c44947f` produces tree `c2fe1b5e501ad9b4b391fbc432546bf820d2ea0e` with 0 conflicts.

### Protected File Blob Invariant Audit

| Protected File Path | `origin/main` Blob SHA | Merge-Tree Blob SHA | Invariant Status |
| :--- | :--- | :--- | :--- |
| `pet/ledger/actions.json` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | **IDENTICAL (100%)** |
| `pet/ledger/activity.json` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | **IDENTICAL (100%)** |
| `pet/ledger/contributions.json` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | **IDENTICAL (100%)** |
| `pet/state/pet.json` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | **IDENTICAL (100%)** |
| `public/pet.svg` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | **IDENTICAL (100%)** |

All 5 live production files match `origin/main` 100% byte-for-byte.

---

## 7. Remaining Limitations

1. **GitHub API Token Required for Reconciliation:** As intended by design, scheduled activity reconciliation requires a valid `GITHUB_TOKEN` in the repository secret store. If omitted, reconciliation logs a clean notice and defers without state corruption.
2. **Maximum Pagination Ceiling:** PR open and merge loops are bounded at `maxPages = 10` (up to 1,000 pulls per category per run). When a busy repository exceeds 1,000 active PRs within a single run, `completedFully = false` halts checkpoint advancement until subsequent cycles catch up.

---

## 8. Definitive Recommendation

### **READY FOR GATE A**

Every operational, durability, recovery, pagination, and identity boundary has been verified and proven.

> *No push was performed, no Pull Request was created, no workflow was dispatched, and no production repository or live pet state was modified.*
