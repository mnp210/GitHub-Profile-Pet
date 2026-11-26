# Sprint 5.2D-S — Repeated-Insertion Trace Correction, XP Ledger Proof & Final Candidate Identity

## Executive Summary

Sprint 5.2D-S resolves the remaining evidence inconsistencies from Sprint 5.2D-R:
1. **Scenario B Trace Correction**: Reproduces Scenario B with exact one-based page slicing on `[50, 40, 30, 20, 10, 5]` (`pageSize = 2`, `maxPages = 2`), showing exact page contents after each front insertion (`#60`, `#70`, `#80`) and asserting every page trace in `tests/unit/prReconciliationDurability.test.ts`.
2. **Scenario A XP & Ledger Accounting**: Reconciles the Batch 1 +100 XP total across all 4 discovered `pr_opened` events (`#80`, `#70`, `#60`, `#50` at +25 XP each), proves zero `pr_merged` awards, and verifies duplicate retries award 0 XP.
3. **Revalidated `maxPages = 1`**: Proves `maxPages < 1` fails closed with explicit validation, `maxPages = 1` advances monotonically (`1 -> 2 -> 3 -> 4 -> complete`), and a newly opened PR (`#60`) during historical continuation is discovered on the next Page 1 scan.
4. **Final Git Identity & Verification**: Reconciles Sprint 5.2D-R commits (`9debf06...` pre-amend vs `c9a8e3c...` amended), records the exact final candidate code commit (`9b58530f8e48146727496df392d032fbe5a82623`), documents the live remote `origin/main` fetch-boundary limitation (`bc375304d1f9c3e00cf5fc1f3032c3a835911095` not locally present vs local `origin/main` `d701ebd018296ded0fcbec6d2bb172b461680548`), and verifies 100% byte-for-byte equality of all 5 protected production assets.

---

## 1. Safety & Initial Snapshot

- **Candidate Workspace**: `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch**: `candidate/playable-virtual-pet-game`
- **Initial Candidate HEAD**: `c9a8e3cade316f59e7168e8f10f78ddfc072523e`
- **Initial Working Tree**: Clean
- **Live Remote SHA (`git ls-remote origin refs/heads/main`)**: `bc375304d1f9c3e00cf5fc1f3032c3a835911095`
- **Locally Available `origin/main` SHA**: `d701ebd018296ded0fcbec6d2bb172b461680548`
- **Safety Boundary**: Read-only remote inspection only. No fetch, no pull, no push, no PR, no merge, no workflow dispatch, and zero production mutations.

---

## 2. Corrected Scenario B Trace (One-Based Page Slicing)

- **Initial Ordered Fixture**: `[50, 40, 30, 20, 10, 5]`
- **Configuration**: `pageSize = 2`, `maxPages = 2`, `stopAtPrNumber = 50`

| Batch | Ordered Dataset After Insertion | Requested Pages | Returned PRs per Page | Cont. Before | Cont. After | Newly Discovered | Deduplicated | `completedFully` | `historicalPrCompleted` | Cumulative Registry |
|---|---|---|---|---|---|---|---|---|---|---|
| **Batch 1** | `[50, 40, 30, 20, 10, 5]` | `[1, 2]` | P1: `[50, 40]`, P2: `[30, 20]` | `1` (undef) | `3` | `#50, #40, #30, #20` | None | `false` | `false` | `[50, 40, 30, 20]` |
| **Batch 2** | *(+#60)* `[60, 50, 40, 30, 20, 10, 5]` | `[1, 3]` | P1: `[60, 50]`, P3: `[20, 10]` | `3` | `4` | `#60, #10` | `#50, #20` | `false` | `false` | `[50, 40, 30, 20, 60, 10]` |
| **Batch 3** | *(+#70)* `[70, 60, 50, 40, 30, 20, 10, 5]` | `[1, 4]` | P1: `[70, 60]`, P4: `[10, 5]` | `4` | `5` | `#70, #5` | `#60, #10` | `false` | `false` | `[50, 40, 30, 20, 60, 10, 70, 5]` |
| **Batch 4** | *(+#80)* `[80, 70, 60, 50, 40, 30, 20, 10, 5]` | `[1, 5]` | P1: `[80, 70]`, P5: `[5]` | `5` | `undefined` | `#80` | `#70, #5` | `true` | `true` | `[50, 40, 30, 20, 60, 10, 70, 5, 80]` |

Every batch requested strictly 2 pages (`<= maxPages`), every eligible PR was discovered exactly once (9 PRs × 25 XP = 225 XP total), and completion was declared only on Batch 4 Page 5 (`[5]`, `length = 1 < pageSize = 2`).

---

## 3. Scenario A — XP & Ledger Accounting

### Batch 1 Reconciliation (+100 XP)
In Sprint 5.2D-R, the Batch 1 summary row combined both Page 1 (`[80, 70]`) and Page 2 (`[60, 50]`) into one `+100 XP` figure. Under the established `+25 XP` per `pr_opened` policy, Batch 1 produced **4** qualifying `pr_opened` events (`4 × 25 XP = +100 XP`):

| PR # | Event Type | Actor & Eligibility | Previously Processed | Reward | Dedupe Key / Event ID | Daily Cap Applies |
|---|---|---|---|---|---|---|
| `#80` | `pr_opened` | `u80` (eligible, non-bot) | No | `+25 XP` | `pr_opened:80` | Yes (`25 / 300` UTC daily) |
| `#70` | `pr_opened` | `u70` (eligible, non-bot) | No | `+25 XP` | `pr_opened:70` | Yes (`50 / 300` UTC daily) |
| `#60` | `pr_opened` | `u60` (eligible, non-bot) | No | `+25 XP` | `pr_opened:60` | Yes (`75 / 300` UTC daily) |
| `#50` | `pr_opened` | `u50` (eligible, non-bot) | No | `+25 XP` | `pr_opened:50` | Yes (`100 / 300` UTC daily) |

- **Ledger State Before Batch 1**: `pet.level = 1`, `pet.xp = 0`, `prOpenedNumbers = []`, `prMergedNumbers = []`.
- **Ledger State After Batch 1**: `pet.level = 2`, `pet.xp = 0` (100 XP consumed to level up), `prOpenedNumbers = [80, 70, 60, 50]`, `prMergedNumbers = []` (opening recovery never awards merge rewards).
- **Duplicate Retry Proof**: Re-evaluating `b1.events` returns `status: 'skipped_duplicate'` and `xpAwarded: 0` for every event.

---

## 4. Revalidated `maxPages = 1` Configuration Boundary

- **Validation**: `maxPages = 0` and `maxPages = -2` fail closed (`completedFully: false`) with explicit warning `"Invalid maxPages option: <value>. Must be an integer >= 1."`.
- **Forward Progress + New PR Discovery (`[50, 40, 30, 20, 10]`, `pageSize = 2`, `maxPages = 1`)**:
  - **Batch 1** (`cont = 1`): requests `[1]` -> `[50, 40]`, discovers `#50, #40`, `cont -> 2`, `completedFully = false`.
  - *Insertion*: PR `#60` opened while continuation is active (`[60, 50, 40, 30, 20, 10]`).
  - **Batch 2** (`cont = 2`): requests `[2]` -> `[40, 30]`, `#40` dedup, discovers `#30`, `cont -> 3`, `completedFully = false`.
  - **Batch 3** (`cont = 3`): requests `[3]` -> `[20, 10]`, discovers `#20, #10`, `cont -> 4`, `completedFully = false`.
  - **Batch 4** (`cont = 4`): requests `[4]` -> `[]`, stream end reached, `completedFully = true`, `historicalPrCompleted = true`, `cont -> undefined`.
  - **Batch 5** (`historicalPrCompleted = true`, `stopAtPrNumber = 50`): requests `[1]` -> `[60, 50]`, discovers `#60` (`pr_opened:60`), `completedFully = true`.
  - **Batch 6** (`historicalPrCompleted = true`, `stopAtPrNumber = 60`): requests `[1]` -> `[60, 50]`, fast path `0` events, `0` XP.
- **Request Trace Asserted**: `[1, 2, 3, 4, 1, 1]` (strictly 1 API request per batch).

---

## 5. Final Git Identity Snapshot & Reconciliation

### Reconciliation of Sprint 5.2D-R Identities
- `9debf06d2273fcd039954ffc012111f7c5ef8b9a`: Initial un-amended Sprint 5.2D-R documentation commit (parent: `e746efaa1599dd45fa27f112bea6efe69a8cc2f3`). Merge-tree against `d701ebd...` was `303738e94c9b3e93dad4b37507ae6c0470617ff4`. Still exists in local object store as the pre-amend commit object.
- `c9a8e3cade316f59e7168e8f10f78ddfc072523e`: Created by `git commit --amend --no-edit` on `9debf06...` (parent: `e746efaa1599dd45fa27f112bea6efe69a8cc2f3`). Merge-tree against `d701ebd...` is `a0863e07e6effc3441d7d38af91259f24f75f452`. This is the actual reachable ancestor on the candidate branch.

### Authoritative Code-Commit Snapshot & Remote Fetch Limitation
- **Candidate Branch**: `candidate/playable-virtual-pet-game`
- **Final Code Commit**: `9b58530f8e48146727496df392d032fbe5a82623`
- **Parent Chain**:
  - `9b58530f8e48146727496df392d032fbe5a82623` (Sprint 5.2D-S test hardening)
  - `c9a8e3cade316f59e7168e8f10f78ddfc072523e` (Sprint 5.2D-R report)
  - `e746efaa1599dd45fa27f112bea6efe69a8cc2f3` (Sprint 5.2D-R code commit)
- **Live Remote `origin/main` (`git ls-remote origin refs/heads/main`)**: `bc375304d1f9c3e00cf5fc1f3032c3a835911095`
  - *Limitation*: `git cat-file -t bc375304d1f9c3e00cf5fc1f3032c3a835911095` fails (`could not get object info`) because `origin/main` advanced remotely after the last fetch and fetching is prohibited in this candidate-only audit.
- **Locally Available `origin/main` SHA**: `d701ebd018296ded0fcbec6d2bb172b461680548`
- **Common Merge Base (against local `d701ebd...`)**: `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Divergence (code commit `9b58530...` vs local `d701ebd...`)**: 34 ahead, 9 behind.
- **Code Commit Merge-Tree Command & Output (vs local `d701ebd...`)**:
  - `git merge-tree --write-tree d701ebd018296ded0fcbec6d2bb172b461680548 9b58530f8e48146727496df392d032fbe5a82623`
  - Output: `a83dc200d0e856acb082b323363172647e71de91`

---

## 6. Protected Production Assets Verification

Verified against local `origin/main` (`d701ebd018296ded0fcbec6d2bb172b461680548`) and code merge-tree root `a83dc200d0e856acb082b323363172647e71de91`:

| Protected Asset | `origin/main` (`d701ebd...`) | Code Merge-Tree (`a83dc20...`) | Mode | Equality |
|---|---|---|---|---|
| `pet/ledger/actions.json` | `8fe9fdbba9e70dea87c66438e3879d2e836a8b8d` | `8fe9fdbba9e70dea87c66438e3879d2e836a8b8d` | `100644` | **IDENTICAL** |
| `pet/ledger/activity.json` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `100644` | **IDENTICAL** |
| `pet/ledger/contributions.json` | `36ecfdbe88e1145e99e9a02fa25c225b8004db78` | `36ecfdbe88e1145e99e9a02fa25c225b8004db78` | `100644` | **IDENTICAL** |
| `pet/state/pet.json` | `e801add4a4fb71f235a319278848b3f3b22da6ab` | `e801add4a4fb71f235a319278848b3f3b22da6ab` | `100644` | **IDENTICAL** |
| `public/pet.svg` | `c883b034e6513759692487af9ea41e18677a9e91` | `c883b034e6513759692487af9ea41e18677a9e91` | `100644` | **IDENTICAL** |

---

## 7. Final Verification Against Code Commit `9b58530f8e48146727496df392d032fbe5a82623`

- **Unique Tests**: **960** (`352` other unit + `52` PR durability + `547` pet-engine + `9` cross-system integration)
- **Total Executions**: **1,012** (includes standalone `prReconciliationDurability.test.ts` run)

| Command | Exit Code | Result | Failed / Skipped |
|---|---|---|---|
| `npm test` | `0` | **PASS** (404 / 404 across 134 suites) | 0 / 0 |
| `npm run test:pet-engine` | `0` | **PASS** (547 / 547 across 43 suites) | 0 / 0 |
| `node --test tests/integration/crossSystemIntegration.test.ts` | `0` | **PASS** (9 / 9 across 6 suites) | 0 / 0 |
| `npx tsc --noEmit` | `0` | **PASS** (0 errors) | — |
| `npm run lint` | `0` | **PASS** (0 errors, 0 warnings) | — |
| `npm run build` | `0` | **PASS** (Next.js 16.4.6 static build) | — |

---

## 8. Final Verdict

**CONDITIONAL**

All pagination, XP ledger, `maxPages = 1`, and verification invariants pass 100% against the final candidate code commit (`9b58530f8e48146727496df392d032fbe5a82623`). The single condition before Gate A is that live `origin/main` (`bc375304d1f9c3e00cf5fc1f3032c3a835911095`) is ahead of the locally cached `origin/main` (`d701ebd018296ded0fcbec6d2bb172b461680548`) and is not locally available without a `git fetch origin`, which was prohibited in this sprint.
*(No Gate A authorization requested; no remote or production operations performed.)*
