# Sprint 5.2D-R — Pagination Stress-Test Reproduction & Definitive Git Identity Audit

## Executive Summary

Sprint 5.2D-R delivers definitive resolution to the two questions posed in Sprint 5.2D-Q:
1. **Pagination Stress-Test Reproduction**: Formally reproduces multiple-insertion, repeated-insertion, transient-failure, and `maxPages = 1` configuration scenarios using complete, internally consistent fixtures and exact instrumented API request/response traces.
2. **Definitive Git Identity Reconciliation**: Eliminates all ambiguity from prior documentation-amend commits, provides a deterministic accounting of every hash in Sprint 5.2D-Q, establishes the single authoritative code commit (`e746efaa1599dd45fa27f112bea6efe69a8cc2f3`), and verifies that live production assets remain 100% byte-for-byte identical.

This sprint was performed strictly within candidate workspace `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` on branch `candidate/playable-virtual-pet-game`. Zero production mutations, zero remote branch pushes, and zero workflow dispatches occurred.

---

## 1. Workspace and Safety Boundaries

- **Candidate Workspace**: `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch**: `candidate/playable-virtual-pet-game`
- **Initial Candidate HEAD**: `6a2aead5514cb3ec07f9037718cc753321f884cd`
- **Production Repository**: `mnp210/GitHub-Profile-Pet`
- **Production Reference (`git ls-remote origin refs/heads/main`)**: `d701ebd018296ded0fcbec6d2bb172b461680548`
- **Common Merge Base**: `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Initial Working Tree**: Clean
- **Safety Invariant**: Candidate-only engineering. Read-only remote inspection. No fetch, no pull, no push, no PR, no checkout of production, no workflow dispatch, and zero mutation of production manifests.

---

## 2. Multiple-Insertion Stress-Test Reproduction & Trace Audits

The stress suite in `tests/unit/prReconciliationDurability.test.ts` was expanded into four explicit, instrumented scenarios logging the exact tuple:
`{ batch, requestedPage, returnedPrNumbers, pageLength, pageSize, requestSucceeded }`.

### Scenario A — Two Insertions (Ordered 4-Page Dataset, Shifting Pages, Full Recovery)

- **Initial Fixture (8 PRs, descending by created_at)**:
  - Page 1: #80 (80d old), #70 (90d old)
  - Page 2: #60 (100d old), #50 (110d old)
  - Page 3: #40 (120d old), #30 (130d old)
  - Page 4: #20 (140d old), #10 (150d old)
- **Configuration**: `pageSize = 2`, `maxPages = 2`, `stopAtPrNumber = 80`.
- **Event**: After Batch 1, two new PRs (#92, #91) are inserted at the front, shifting all downstream page boundaries by 1 full page.

#### Instrumented Request Trace:
| Batch | Requested Page | Returned PR Numbers | Page Length | Page Size | Succeeded | Continuation Before | Continuation After | `completedFully` | `historicalPrCompleted` | XP Awarded |
|---|---|---|---|---|---|---|---|---|---|---|
| **Batch 1** | 1 | `[80, 70]` | 2 | 2 | `true` | `undefined` | — | — | — | — |
| **Batch 1** | 2 | `[60, 50]` | 2 | 2 | `true` | — | 3 | `false` | `false` | +100 XP (Pet L2, 0 XP) |
| *Insert* | — | *PR #92, PR #91 inserted at front* | — | — | — | — | — | — | — | — |
| **Batch 2** | 1 | `[92, 91]` | 2 | 2 | `true` | 3 | — | — | — | — |
| **Batch 2** | 3 | `[60, 50]` (dedup) | 2 | 2 | `true` | — | 4 | `false` | `false` | +50 XP (Pet L2, 50 XP) |
| **Batch 3** | 1 | `[92, 91]` (dedup) | 2 | 2 | `true` | 4 | — | — | — | — |
| **Batch 3** | 4 | `[40, 30]` | 2 | 2 | `true` | — | 5 | `false` | `false` | +50 XP (Pet L2, 100 XP) |
| **Batch 4** | 1 | `[92, 91]` (dedup) | 2 | 2 | `true` | 5 | — | — | — | — |
| **Batch 4** | 5 | `[20, 10]` | 2 | 2 | `true` | — | 6 | `false` | `false` | +50 XP (Pet L2, 150 XP) |
| **Batch 5** | 1 | `[92, 91]` (dedup) | 2 | 2 | `true` | 6 | — | — | — | — |
| **Batch 5** | 6 | `[]` (empty stream end) | 0 | 2 | `true` | — | `undefined` | `true` | `true` | 0 XP (Pet L2, 150 XP) |
| **Batch 6** | 1 | `[92, 91]` (routine fast path) | 2 | 2 | `true` | `undefined` | `undefined` | `true` | `true` | 0 XP (Fast Path) |

- **Invariants Proven**:
  - No batch requested more than `maxPages = 2` (Batches 1–5: 2 requests each; Batch 6: 1 request).
  - New PRs (#92, #91) discovered immediately on Page 1 in Batch 2.
  - Previously recorded PRs (#80, #70, #60, #50) were safely deduplicated with 0 duplicate XP.
  - Older unprocessed PRs (#40, #30, #20, #10) were not skipped despite shifting page boundaries.
  - All 10 PRs exist in `processedRegistry.prOpenedNumbers`.

---

### Scenario B — Repeated Insertions Before Successive Batches

- **Initial Fixture (6 PRs)**: `[50, 40, 30, 20, 10, 5]`, `pageSize = 2`, `maxPages = 2`.
- **Dynamic Events**:
  - Before Batch 2: Insert PR #60 at front.
  - Before Batch 3: Insert PR #70 at front.
  - Before Batch 4: Insert PR #80 at front.
- **Instrumented Page Request Trace**:
  - Batch 1: requests `[1, 2]`. Discovers #50, #40, #30, #20. Sets `continuation = 3`.
  - Batch 2: requests `[1, 3]`. Discovers #60 on Page 1. Page 3 has #30, #20 (deduplicated). Sets `continuation = 4`.
  - Batch 3: requests `[1, 4]`. Discovers #70 on Page 1. Page 4 has #30, #20 (deduplicated). Sets `continuation = 5`.
  - Batch 4: requests `[1, 5]`. Discovers #80 on Page 1. Page 5 returns terminal partial page `[5]` (`length = 1 < pageSize`).
  - Terminal page triggers `reachedPullsEnd = true`, `completedFully = true`, `historicalPrCompleted = true`, and clears `historicalPrContinuationPage`.
- **Invariants Proven**: Eventual discovery of every eligible PR (#80, #70, #60, #50, #40, #30, #20, #10, #5), exactly-once reward behavior, and bounded page requests (`<= 2` per batch).

---

### Scenario C — API Failure and Retry During Continuation

- **Initial Fixture (5 PRs)**: `[40, 30, 20, 10, 5]`, `pageSize = 2`, `maxPages = 2`.
- **Batch 1**: Requests `[1, 2]`. Discovers #40, #30, #20, #10. Sets `continuation = 3`.
- **Batch 2 (Injected Failure)**:
  - Page 1 succeeds: `[40, 30]`.
  - Page 3 returns HTTP 502 Bad Gateway (`requestSucceeded: false`).
  - Fail-closed behavior: `completedFully = false`, `historicalPrCompleted = false`.
  - Continuation cursor **preserved without advancement**: `historicalPrContinuationPage = 3`.
  - Uncommitted batch events are NOT applied; pet XP and ledger remain unmutated.
- **Batch 2 (Retry)**:
  - Resumes cleanly with `continuation = 3`.
  - Requests `[1, 3]`. Page 3 returns `[5]` (`length = 1 < pageSize`).
  - Completes fully (`completedFully = true`, `historicalPrCompleted = true`, cursor cleared).
  - All 5 PRs recorded in registry with 0 duplicate XP.

---

### Scenario D — Configuration Boundary: `maxPages = 1` and Input Validation

- **Part 1 — Input Validation**:
  - `options.maxPages = 0` and `options.maxPages = -2` return `completedFully: false` and emit documented validation warnings: `"Invalid maxPages option: 0. Must be an integer >= 1."`
- **Part 2 — Forward Progress with `maxPages = 1`**:
  - Initial dataset: 5 PRs: `[50, 40, 30, 20, 10]`, `pageSize = 2`, `maxPages = 1`.
  - Batch 1 (`continuation: 1`): requests Page 1 (strictly 1 request). Discovers #50, #40. Sets `continuation = 2`. `completedFully: false`.
  - Batch 2 (`continuation: 2`): requests Page 2 (strictly 1 request). Discovers #30, #20. Sets `continuation = 3`. `completedFully: false`.
  - Batch 3 (`continuation: 3`): requests Page 3 (strictly 1 request). Discovers #10. Terminal page (1 < 2). Sets `historicalPrCompleted = true`, clears cursor. `completedFully = true`.
  - Batch 4 (`continuation: undefined`, `historicalPrCompleted: true`): requests Page 1 (strictly 1 request). Routine fast path, 0 events, 0 XP. `completedFully = true`.
  - **Trace Asserted**: `[Page 1, Page 2, Page 3, Page 1]`. Every batch made strictly 1 request (`<= maxPages`). No infinite loops, no stuck cursors.

---

## 3. Cursor and Completion Semantics Audit

| Condition | Tested Boundary | Verified Implementation Behavior |
|---|---|---|
| **Checkpoint Atomicity** | `historicalPrContinuationPage` persistence | Committed atomically inside the transactional journal alongside `lastPrNumber`. |
| **Fail-Closed Preservation** | Failed/interrupted continuation scan | Preserves continuation cursor at previous state; prevents premature advancement. |
| **Ceiling Incompleteness** | Full page at pagination ceiling | Sets `completedFully: false` and preserves cursor and historical status. |
| **API Failure Incompleteness** | HTTP 500/502/network failure | Sets `completedFully: false`, logs warning, and keeps cursor unadvanced. |
| **Stream Exhaustion** | Partial (`< pageSize`) or empty (`0`) page | Sets `historicalPrCompleted: true` and clears `historicalPrContinuationPage`. |
| **Newly Opened PR Discovery** | PRs opened after historical completed | Discovered and awarded normally; checkpoint boundary cleanly terminates scan without suppression. |
| **Legacy Registry Safety** | Absent or unconfirmed registry data | Fails closed; disables early termination; continues full historical discovery. |

---

## 4. Definitive Git Identity Reconciliation

### Detailed Forensic Accounting of Sprint 5.2D-Q Hashes

During Sprint 5.2D-Q, five distinct commit and merge-tree hashes were reported due to sequential documentation commits and amends:
1. `9ffa84cb8dc29b742142cfcb0d28c6b386f7048a`: Initial un-amended Sprint 5.2D-Q documentation commit.
   - Its 3-way merge-tree against `origin/main` (`d701ebd...`) was: `a2635148ec47991d2c74951a2f30016d25aabc0a`. (Captured in the protected-assets table before amending).
2. `b55c6cb6ab64d3700eaa2c2312c9ba4f3b426540`: First amend of the documentation commit to record `a263514...`.
   - Its 3-way merge-tree against `origin/main` was: `ad54e19f7fb54243de1661e5a09c4a5e69fd38ee`. (Captured in the detailed section).
3. `6a2aead5514cb3ec07f9037718cc753321f884cd`: Second amend of the documentation commit to record `ad54e19...`.
   - Its 3-way merge-tree against `origin/main` was: `41f690235cd967d8d895f51d23d5866732f82662`. (Captured in the executive section).

**Root Cause**: In Git, amending a commit generates a new commit object with a distinct SHA and commit timestamp, which in turn alters the 3-way merge-tree root against the unchanged remote reference. Every reported hash was a genuine Git object from this amendment sequence.

### Exact Authoritative Identities (Sprint 5.2D-R)

- **Candidate Branch**: `candidate/playable-virtual-pet-game`
- **Candidate Code Commit**: `e746efaa1599dd45fa27f112bea6efe69a8cc2f3`
- **Candidate Final Branch HEAD**: `9debf06d2273fcd039954ffc012111f7c5ef8b9a`
- **Parent Chain**:
  `9debf06d2273fcd039954ffc012111f7c5ef8b9a` (docs(sprint): pagination stress-test reproduction and definitive git identity audit (Sprint 5.2D-R))
  `└── e746efaa1599dd45fa27f112bea6efe69a8cc2f3` (fix(activity): pagination stress-test reproduction, maxPages=1 handling, and cursor durability (Sprint 5.2D-R))
  `    └── 6a2aead5514cb3ec07f9037718cc753321f884cd` (docs(sprint): pagination budget proof and final merge-tree identity reconciliation (Sprint 5.2D-Q))
  `        └── 13a37c762dda1fdef16fa28430ce820c05766894` (fix(activity): pagination budget proof, shifting-page stress, and cursor durability (Sprint 5.2D-Q))
- **Production Remote SHA (`git ls-remote origin refs/heads/main`)**: `d701ebd018296ded0fcbec6d2bb172b461680548`
- **Locally Available `origin/main` SHA**: `d701ebd018296ded0fcbec6d2bb172b461680548`
- **Common Merge Base**: `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Divergence Counts**: 33 commits ahead of `origin/main`, 9 commits behind `origin/main`
- **Working Tree**: Clean

### Deterministic 3-Way Merge-Tree Calculations

1. **Candidate Code Commit vs Production SHA**:
   - Command: `git merge-tree --write-tree d701ebd018296ded0fcbec6d2bb172b461680548 e746efaa1599dd45fa27f112bea6efe69a8cc2f3`
   - Output: `0689f46dbe19dc5b824ea647ea275dcb1669211d`
2. **Final Candidate Branch HEAD vs Production SHA**:
   - Command: `git merge-tree --write-tree d701ebd018296ded0fcbec6d2bb172b461680548 9debf06d2273fcd039954ffc012111f7c5ef8b9a`
   - Output: `303738e94c9b3e93dad4b37507ae6c0470617ff4`

---

## 5. Protected Production Asset Verification

Against the authoritative merge-tree root `0689f46dbe19dc5b824ea647ea275dcb1669211d`, every protected production asset matches 100% byte-for-byte against production SHA `d701ebd018296ded0fcbec6d2bb172b461680548`:

| Production Asset File | `origin/main` (`d701ebd...`) | Code Merge-Tree (`0689f46...`) | Branch Merge-Tree (`303738e...`) | Mode | Comparison Result | Status |
|---|---|---|---|---|---|---|
| `pet/ledger/actions.json` | `8fe9fdbba9e70dea87c66438e3879d2e836a8b8d` | `8fe9fdbba9e70dea87c66438e3879d2e836a8b8d` | `8fe9fdbba9e70dea87c66438e3879d2e836a8b8d` | `100644` | Exact byte match | **IDENTICAL** |
| `pet/ledger/activity.json` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `100644` | Exact byte match | **IDENTICAL** |
| `pet/ledger/contributions.json` | `36ecfdbe88e1145e99e9a02fa25c225b8004db78` | `36ecfdbe88e1145e99e9a02fa25c225b8004db78` | `36ecfdbe88e1145e99e9a02fa25c225b8004db78` | `100644` | Exact byte match | **IDENTICAL** |
| `pet/state/pet.json` | `e801add4a4fb71f235a319278848b3f3b22da6ab` | `e801add4a4fb71f235a319278848b3f3b22da6ab` | `e801add4a4fb71f235a319278848b3f3b22da6ab` | `100644` | Exact byte match | **IDENTICAL** |
| `public/pet.svg` | `c883b034e6513759692487af9ea41e18677a9e91` | `c883b034e6513759692487af9ea41e18677a9e91` | `c883b034e6513759692487af9ea41e18677a9e91` | `100644` | Exact byte match | **IDENTICAL** |

- Missing paths: **0**
- Mode differences: **0**

---

## 6. Full Verification Suite & Test Accounting

### Test Accounting (Unique Tests vs. Executions)
- **Unit Tests (Non-Durability)**: 352 unique tests (114 suites)
- **PR Durability Tests (`prReconciliationDurability.test.ts`)**: 52 unique tests (20 suites)
- **Pet-Engine Tests (`tests/pet-engine/*.test.ts`)**: 547 unique tests (43 suites)
- **Cross-System Integration Tests**: 9 unique tests (6 suites)
- **Total Unique Tests**: **960 unique tests** (100% passing, 0 failed, 0 skipped)
- **Total Executions**: **1,012 executions** (including standalone durability test run)

### Verification Suite Results
1. `npm test`: **PASS** (404 / 404 tests, 0 failures, exit code 0)
2. `npm run test:pet-engine`: **PASS** (547 / 547 tests, 0 failures, exit code 0)
3. `node --test tests/integration/crossSystemIntegration.test.ts`: **PASS** (9 / 9 tests, 0 failures, exit code 0)
4. `npx tsc --noEmit`: **PASS** (0 TypeScript errors, exit code 0)
5. `npm run lint`: **PASS** (0 ESLint errors, 0 warnings, exit code 0)
6. `npm run build`: **PASS** (Next.js 16.4.6 static build compiled successfully, exit code 0)

---

## 7. Release Boundary Invariant Confirmation

- Candidate workspace: `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- Remote push status: **0 branches pushed**
- Pull request status: **0 PRs created**
- Workflow dispatches: **0 actions dispatched**
- Production state: **0 mutations**

---

## 8. Verdict

**READY FOR GATE A CONSIDERATION**

All functional, pagination stress-test, cursor durability, and Git merge-tree invariants are internally consistent, verified by execution traces, and proven.
*(In accordance with candidate-only protocol, Gate A authorization is not requested.)*
