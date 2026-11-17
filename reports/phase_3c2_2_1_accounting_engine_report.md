# Phase 3C2.2.1 — Deterministic Contribution Accounting Engine Report

**Date:** 2026-11-16  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Target Branch:** `main`  
**Current Baseline Commit:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`

---

## 1. Executive Summary

Phase 3C2.2.1 implements the deterministic contribution accounting engine for **GitHub Profile Pet** within the repository's native state and ledger architecture.

This engine reconciles incoming GitHub contribution activity against durably tracked per-date high-water marks (`dailyHwm`), manages independent sequential daily reward ordinals (`dailyRewardOrdinal`), enforces the five-increment-per-hour processing throttle, executes whole-increment forfeiture against the 300 XP daily cap, enforces exact 48-hour expiration boundaries, and maintains mathematical accounting conservation across all transitions.

All 23 comprehensive tests in `tests/pet-engine/contributionAccounting.test.ts` (including all 20 explicitly required test scenarios) pass with 100% success. Full test and quality matrices (`test:pet-engine`, `npm test`, `lint`, `typecheck`, and `build`) have passed with zero errors.

In strict compliance with milestone boundaries:
- Zero GitHub Actions workflows were modified.
- Contribution sync was not integrated into scheduled publisher runs.
- Passive pet simulation was not modified.
- Zero Git commits, pushes, resets, or history rewrites were performed.

---

## 2. Files Inspected & Modified

### Files Inspected:
- `pet/schemas/contributions.schema.json`
- `pet/ledger/contributions.json`
- `src/features/pet-engine/accounting/contributionEngine.ts`
- `src/features/pet-engine/contribution/contributionProvider.ts`
- `src/features/pet-engine/contribution/types.ts`
- `src/features/pet-engine/domain/constants.ts`
- `src/features/pet-engine/domain/types.ts`
- `src/features/pet-engine/persistence/stateRepository.ts`
- `src/features/pet-engine/validation/ledgerValidator.ts`
- `reports/phase_3c2_architecture_specification.md`

### Files Modified:
| File | Role & Scope of Changes |
|---|---|
| `src/features/pet-engine/domain/types.ts` | Added `InstallationBaselineMetadata`, `SyncReceipt`, updated `ContributionSlice` (`dailyOrdinal: number`, `units: 1`, nullable `evaluatedAt`), and updated `ContributionLedgerDocument` with `dailyHwm`, `dailyRewardOrdinal`, `installationBaseline`, `lastSyncReceipt`, and `hourlyIncrementUsage`. Preserved backwards-compatible scalar fields. |
| `src/features/pet-engine/domain/constants.ts` | Added `MAX_INCREMENTS_PER_HOUR = 5`, `CONTRIBUTION_REWARD_SCHEDULE`, and `CONTRIBUTION_REWARD_DEFAULT` representing the approved diminishing schedule. |
| `src/features/pet-engine/validation/ledgerValidator.ts` | Added strict validation for `dailyHwm`, `dailyRewardOrdinal`, `installationBaseline`, `hourlyIncrementUsage`, `dailyOrdinal`, and fail-closed checks when established ledgers are missing required counters. |
| `pet/schemas/contributions.schema.json` | Updated schema to match Section 4.3 of the Phase 3C2 Architecture Specification, permitting `dailyHwm`, `dailyRewardOrdinal`, `installationBaseline`, `ownerDatabaseId`, `ownerLogin`, `lastSyncReceipt`, and `dailyOrdinal`. |
| `src/features/pet-engine/accounting/contributionEngine.ts` | Completely re-architected reconciliation engine with per-date monotonic HWM, discrete ordinal allocation, whole-increment forfeiture, 5 increments/hour throttle, 48-hour expiration, and fail-closed error handling (`CorruptOrdinalError`, `CorruptHwmError`, `InvalidSnapshotError`, `IdentityMismatchError`). |
| `tests/pet-engine/contributionAccounting.test.ts` | Authored complete 23-test suite covering all 20 required scenarios, recovery verification, and public-only category isolation. |

---

## 3. Accounting Data Model & Invariants

### 3.1 Eligible Categories & Category Isolation
- **Eligible Categories:** Commits (`totalCommitContributions`), Issues (`totalIssueContributions`), Pull Requests (`totalPullRequestContributions`), and Reviews (`totalPullRequestReviewContributions`).
- **Sum:** `publicCategoryTotal = commits + issues + pullRequests + pullRequestReviews`.
- **Public-Only Guarantee:** `restrictedContributionsCount` (private activity) is captured for diagnostic awareness but strictly excluded from `publicCategoryTotal`.
- **Aggregation:** Represents aggregate GitHub Activity XP; no claims of individual commit SHAs or private event timestamps are made or stored.

### 3.2 Installation Baseline Lifecycle
- **Uninitialized State:** An uninitialized ledger (`installationBaseline.completed !== true` with zero slices) establishes a baseline on its first run.
- **Initial Counts:** Baseline records `initialCounts: { yesterday, today }`.
- **Counters Initialized:** `dailyHwm[yesterday] = obsYesterday`, `dailyHwm[today] = obsToday`, `dailyRewardOrdinal[yesterday] = 0`, `dailyRewardOrdinal[today] = 0`.
- **Zero Retroactive Awards:** Baseline $\Delta \equiv 0$. Exactly **0 slices**, **0 XP**, and **0 satiety** are awarded on first installation.

### 3.3 High-Water Mark & Monotonicity
For any UTC date $D$:
$$\Delta_{\text{observed}}(D) = \max\left(0, \text{observedTotal}(D) - \text{dailyHwm}[D]\right)$$
$$\text{dailyHwm}_{\text{next}}[D] = \max\left(\text{dailyHwm}[D], \text{observedTotal}(D)\right)$$
- If observed contributions decrease (e.g. from commit rebase/squashing), $\Delta = 0$.
- `dailyHwm[D]` never regresses, ensuring pet vitals and XP never decrease.
- When new activity later exceeds `dailyHwm[D]`, only the excess becomes eligible for rewards.

### 3.4 Durable Daily Reward Ordinals
- Every UTC date maintains an independent counter: `dailyRewardOrdinal[D]`.
- Counter advances strictly when new increments are discovered:
  $$\text{dailyOrdinal}_k = \text{dailyRewardOrdinal}[D] + k, \quad k \in [1, \Delta]$$
  $$\text{dailyRewardOrdinal}_{\text{next}}[D] = \text{dailyRewardOrdinal}[D] + \Delta$$
- `dailyHwm` and `dailyRewardOrdinal` update atomically.
- **Fail-Closed Guarantee:** If an established ledger has missing, null, or corrupted `dailyRewardOrdinal`, execution immediately throws `CorruptOrdinalError` (Class B Fatal Local Integrity Failure). The ordinal counter is **never** reconstructed from `dailyHwm`.

### 3.5 Diminishing Activity Reward Schedule
Each unit increment is awarded XP and satiety based strictly on its immutable `dailyOrdinal`:

| Increment Ordinal | Activity XP Awarded | Satiety Restored | Cumulative XP (1-5) | Cumulative Satiety (1-5) |
|:---:|:---:|:---:|:---:|:---:|
| **1st** | 25 XP | +10 | 25 XP | +10 |
| **2nd** | 15 XP | +5 | 40 XP | +15 |
| **3rd** | 10 XP | +2 | 50 XP | +17 |
| **4th** | 5 XP | +1 | 55 XP | +18 |
| **5th onward** | 5 XP | +1 | 60 XP | +19 |

### 3.6 Daily XP Cap & Whole-Increment Forfeiture Policy
- Maximum contribution-derived XP: **300 XP per calendar UTC date** (`DAILY_CONTRIBUTION_XP_CAP = 300`).
- **Policy Execution:**
  1. Pending increments are evaluated in chronological ordinal order `(syncDate ASC, dailyOrdinal ASC)`.
  2. If an increment's complete XP reward exceeds remaining daily allowance (`reward.xp > remainingAllowance`), the entire increment is **forfeited** (`rewardedXp = 0`, `rewardedSatiety = 0`).
  3. No increment is ever partially awarded. Slices are never split into fractional units.
  4. Forfeiture permanently consumes the increment's ordinal.
  5. The daily accrued XP is not incremented on forfeiture; evaluation proceeds to subsequent increments, allowing smaller rewards (e.g. a 5 XP increment) to fit.
  6. Once the 300 XP cap is exhausted (`remainingAllowance === 0`), all subsequent increments for that date are permanently forfeited.
  7. Forfeited increments are never re-evaluated or re-awarded on subsequent sync runs.

### 3.7 Pending Queue & Hourly Processing Throttle
- **Hourly Throttle:** Maximum 5 individual unit increments evaluated per UTC hour (`hourlyIncrementUsage[hourKey] <= 5`).
- **Pending Integrity:** Excess increments are queued with `status: 'pending'`, retaining their immutable `syncDate`, `dailyOrdinal`, and original `expiryAt`.
- **48-Hour Expiration Boundary:**
  $$\text{expiryAt} = \text{Date}(\text{syncDate} + \text{"T00:00:00.000Z"}).\text{getTime}() + 48 \times 3600 \times 1000$$
  - Slices expire strictly when `nowMs >= expiryMs`.
  - Expired slices yield 0 XP and 0 satiety, and do not consume hourly throttle quota.

### 3.8 Accounting Conservation Invariant
Every slice represents strictly 1 unit (`units: 1`). Across all state transitions and monthly compactions:
$$\text{totalRecordedUnits} \equiv \text{rewardedUnits} + \text{forfeitedUnits} + \text{pendingUnits} + \text{expiredUnits}$$
Baseline installation counts are stored in `installationBaseline.initialCounts` and excluded from `totalRecordedUnits`.

---

## 4. Test Verification Matrix

All 23 tests in `tests/pet-engine/contributionAccounting.test.ts` pass cleanly:

| # | Test Identifier & Description | Result | Execution Time |
|:---:|---|:---:|:---:|
| 1 | First-installation baseline with no retroactive rewards | **PASS** | 3.55 ms |
| 2 | First increment after baseline receiving ordinal 1 (25 XP, 10 satiety) | **PASS** | 0.75 ms |
| 3 | Independent ordinals across different UTC dates (yesterday vs today) | **PASS** | 11.56 ms |
| 4 | Repeated identical snapshots produce zero mutation or duplicate slices | **PASS** | 0.39 ms |
| 5 | Monotonic high-water marks after observed decreases (rebase/squash protection) | **PASS** | 0.39 ms |
| 6 | Multiple increments in one snapshot receive diminishing schedule (60 XP, 19 sat) | **PASS** | 2.49 ms |
| 7 | Five individual increments per hour throttle enters excess into pending | **PASS** | 0.70 ms |
| 8 | Pending increments retaining original dates and ordinals | **PASS** | 1.44 ms |
| 9 | Exact 48-hour expiry boundary (syncDate midnight + 48h UTC) | **PASS** | 0.80 ms |
| 10 | XP cap reached exactly (daily allowance hits 300 XP) | **PASS** | 0.43 ms |
| 11 | Increment exceeding remaining XP allowance is forfeited (whole-increment policy) | **PASS** | 0.27 ms |
| 12 | Smaller later increment fits after larger increments are forfeited | **PASS** | 0.30 ms |
| 13 | All remaining increments forfeited after the cap is reached | **PASS** | 0.28 ms |
| 14 | No partial XP or satiety awards (atomic all-or-nothing evaluation) | **PASS** | 0.18 ms |
| 15 | No re-awarding forfeited increments after process restart or subsequent sync | **PASS** | 0.29 ms |
| 16 | Conservation invariant holds across all transitions (rewarded, forfeited, pending, expired, compaction) | **PASS** | 0.74 ms |
| 17 | Concurrent or stale snapshot protection throws `GenerationConflictError` | **PASS** | 113.84 ms |
| 18 | Corrupt or missing established ordinal counter fails closed (`CorruptOrdinalError`, `CorruptHwmError`) | **PASS** | 0.74 ms |
| 19 | Invalid or partial provider snapshots cause zero mutation (`InvalidSnapshotError`, `IdentityMismatchError`) | **PASS** | 0.52 ms |
| 20 | Crash recovery during accounting persistence rolls back cleanly (`recoverRepositoryState`) | **PASS** | 50.01 ms |
| 21 | `getRewardForOrdinal` validates input ordinal bounds | **PASS** | 0.60 ms |
| 22 | `getUtcHourKey` and `getUtcDateString` format accurately | **PASS** | 0.12 ms |
| 23 | Public-only contribution calculation ignores restricted counts | **PASS** | 0.20 ms |

---

## 5. Full Quality Assurance Verification

| Gate / Suite | Command | Result | Metrics / Notes |
|---|---|---|---|
| **Pet Engine Test Suite** | `npm run test:pet-engine` | **PASS** | **289 / 289 PASS** across 19 suites (0 failures, 0 skips) |
| **Unit Test Suite** | `npm test` | **PASS** | **121 / 121 PASS** across 24 suites (0 failures, 0 skips) |
| **Lint Check** | `npm run lint` | **PASS** | **0 errors, 0 warnings** |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS** | **0 errors** |
| **Production Build** | `npm run build` | **PASS** | Compiled in 1.2s; **14 / 14 static pages generated** |

---

## 6. Scope Invariants & Boundaries Confirmation

- **GitHub Actions Workflows:** Exactly 0 workflow files modified.
- **Workflow Dispatches:** Exactly 0 workflow dispatches executed.
- **Scheduled Contribution Syncing:** Not activated; no automatic contribution execution enabled.
- **Passive Pet Simulation:** Unmodified; contribution accounting remains strictly isolated from offline simulation.
- **Authentication & Secrets:** No PATs, GCM, OAuth tokens, or credential fallbacks added or modified.
- **Git State:** Exactly 0 commits, pushes, resets, or cleans performed.
- **Phase 3C2.2.2:** Strictly uninitiated.
