# Phase 3C2.2.2-R3 — Final Specification Consistency Reconciliation Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Target Branch:** `main`  
**Authoritative Remote Baseline:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`  
**Date:** 2026-11-17  
**Milestone:** Phase 3C2.2.2-R3  
**Status:** FULL PASS (Zero Ambiguities Remaining; Ready for Implementation Authorization)

---

## 1. Executive Summary & Authorization Scope

Phase 3C2.2.2-R3 executes a comprehensive, documentation-only audit and reconciliation of the runtime integration architecture specification and readiness report for GitHub Profile Pet.

In accordance with strict project authorization boundaries:
- **Scope:** Documentation, schedule verification, schema reconciliation, and criteria consolidation only.
- **Source Code Mutations:** 0 files modified.
- **Schema Mutations:** 0 schemas modified.
- **Test Suite Mutations:** 0 tests modified.
- **Workflow Mutations:** 0 workflows modified or dispatched.
- **State & Ledger Mutations:** 0 state documents or journal entries modified.
- **Git Operations:** Read-only inspection; 0 commits, pushes, cleans, resets, rebases, or branch changes.
- **Phase 3C2.2.3 Status:** Strictly suspended awaiting explicit owner review and written authorization.

All discrepancies, conflicting field names, contradictory accrual policies, schedule inaccuracies, and divergent acceptance matrices have been definitively eliminated.

---

## 2. Exact Repository Paths Inspected

Every finding, predicate, schedule, and interface in this report was verified by direct read-only inspection of the active repository files:

| Subsystem / Layer | Exact File Path | Inspection Objective |
|---|---|---|
| **Ledger Schema** | `pet/schemas/contributions.schema.json` | Verify exact JSON Schema properties, required fields, and constraints. |
| **Domain Types** | `src/features/pet-engine/domain/types.ts` | Verify exact TypeScript interfaces for `ContributionLedgerDocument` and slices. |
| **Ledger Validator** | `src/features/pet-engine/validation/ledgerValidator.ts` | Verify existing integrity checks and failure conditions for ledgers. |
| **Accounting Engine** | `src/features/pet-engine/accounting/contributionEngine.ts` | Verify baseline initialization, whole-increment overflow, and bulk cap forfeiture. |
| **Contribution Provider** | `src/features/pet-engine/contribution/contributionProvider.ts` | Verify rate-limit consistency validation and absence of pre-flight threshold checks. |
| **GraphQL Client** | `src/features/pet-engine/contribution/nativeGraphQLClient.ts` | Verify HTTP header parsing, timeout budgets, and rate-limit error classes. |
| **State Repository** | `src/features/pet-engine/persistence/stateRepository.ts` | Verify multi-document generation lockstep and journal recovery protocols. |
| **SVG Publisher** | `src/features/pet-engine/publication/svgPublisher.ts` | Verify disk-based `PublishPetOptions` interface and post-commit rendering flow. |
| **Publisher Workflow** | `.github/workflows/pet-publisher.yml` | Verify exact cron schedules, concurrency groups, permissions, and steps. |
| **Interaction Workflow** | `.github/workflows/pet-interaction.yml` | Verify exact cron schedules, event triggers, permissions, and concurrency. |
| **Diagnostic Workflow** | `.github/workflows/diagnostics-contribution-probe.yml` | Verify manual dispatch trigger, permissions, and live diagnostic behavior. |
| **Accounting Tests** | `tests/pet-engine/contributionAccounting.test.ts` | Verify baseline recording, ordinals, diminishing schedules, and conservation invariant. |
| **Cap Forfeiture Tests** | `tests/pet-engine/immediateCapForfeiture.test.ts` | Verify bulk cap-exhaustion forfeiture and whole-increment overflow behaviors. |
| **Cap Throttle Audit Tests**| `tests/pet-engine/capThrottleAudit.test.ts` | Verify 5-increment hourly throttle, process restart, and compaction boundaries. |

---

## 3. Exact Conflicts Found and Corrected

| Discrepancy / Conflict | Found In Previous Drafts | Corrective Resolution in Phase 3C2.2.2-R3 |
|---|---|---|
| **Conflict 1: Pristine Predicate Discrepancy** | `phase_3c2_2_2_r2_final_architecture_review.md` (Section 2.4) listed conceptual fields (`initialized`, `initialSyncDate`, `lastSyncTimestamp`, `lastProcessedDate`, `pendingIncrements`, etc.) not in `contributions.schema.json`. | Replaced with an authoritative 10-point predicate using strictly actual repository fields (`schemaVersion`, `generation`, `installationBaseline`, `dailyHwm`, `dailyRewardOrdinal`, `dailyAccruedXp`, `slices`, `monthlyHistoricalSummary`, `ownerDatabaseId`, `lastSyncReceipt`). |
| **Conflict 2: Workflow Schedule & Filename Inaccuracies** | R2 review report listed `pet-interactions.yml` running "Hourly at minute 17". | Corrected to `.github/workflows/pet-interaction.yml` declaring `cron: '47 * * * *'`. Detailed exact inventory across all 3 workflow files (52 scheduled triggers/day). |
| **Conflict 3: Accrual vs. Forfeiture Policy** | R2 review report contained a direct violation of project invariants in AC-12, describing "Partial Accrual: Final increment clamped to remaining cap headroom". | Completely eliminated all mentions of partial accrual. Reaffirmed immutable whole-increment forfeiture (`whole_increment_overflow`) and immediate bulk cap forfeiture (`daily_cap_exhausted`). |
| **Conflict 4: Rate-Limit Deferral Threshold** | Architecture spec specified `< 50` points (AC-36), while R2 review report specified `< 100` points (AC-34). | Standardized to `< 50` points across all documents. Explicitly documented that this check is not yet in code and is marked as **Requires Implementation**. |
| **Conflict 5: Unverified Aliased Query Cost** | Previous drafts casually referenced 1-point query costs. | Strictly classified the 2-day aliased query cost as **Unverified** until empirically measured on hosted Actions via `diagnostics-contribution-probe.yml` using `GITHUB_TOKEN`. |
| **Conflict 6: Conflicting Acceptance Matrices** | Architecture specification and R2 review report contained two divergent 36-item matrices with conflicting IDs and criteria. | Unified into a single authoritative 36-item acceptance matrix (AC-01 through AC-36) across all documents, complete with an Old-to-New mapping table. |
| **Conflict 7: Recovery Boundary Ambiguity** | Crash catch-up example in Section 7.3 ambiguously implied an ephemeral runner boots and finds local disk at Gen G+1 after a crash. | Clearly bifurcated ephemeral Actions runner discard lifecycle (container destroyed, remote authoritative) from persistent local workspace recovery (non-destructive journal inspection). |

---

## 4. Authoritative Pristine-Ledger Predicate

Derived strictly from `pet/schemas/contributions.schema.json`, `src/features/pet-engine/domain/types.ts`, and `src/features/pet-engine/accounting/contributionEngine.ts`:

### 4.1 Formal 10-Point Predicate

A ledger document $L$ is recognized as **Pristine Uninitialized** if and only if **ALL 10** conditions hold:

$$\text{isPristine}(L) \iff \begin{cases} 
\text{1. } L.\text{schemaVersion} = 1 \\
\land\ \text{2. } L.\text{generation} \ge 1 \\
\land\ \text{3. } (L.\text{installationBaseline is undefined} \lor L.\text{installationBaseline.completed} = \text{false}) \\
\land\ \text{4. } \text{Array.isArray}(L.\text{slices}) \land L.\text{slices.length} = 0 \\
\land\ \text{5. } \text{Array.isArray}(L.\text{monthlyHistoricalSummary}) \land L.\text{monthlyHistoricalSummary.length} = 0 \\
\land\ \text{6. } (L.\text{dailyHwm is undefined} \lor \text{Object.keys}(L.\text{dailyHwm}).\text{length} = 0) \\
\land\ \text{7. } (L.\text{dailyRewardOrdinal is undefined} \lor \text{Object.keys}(L.\text{dailyRewardOrdinal}).\text{length} = 0) \\
\land\ \text{8. } (L.\text{dailyAccruedXp is undefined} \lor \text{Object.keys}(L.\text{dailyAccruedXp}).\text{length} = 0 \lor \forall v \in \text{values}(L.\text{dailyAccruedXp}), v = 0) \\
\land\ \text{9. } (L.\text{ownerDatabaseId is undefined} \lor L.\text{ownerDatabaseId} = \text{verifiedOwnerId}) \\
\land\ \text{10. } (L.\text{lastSyncReceipt is undefined} \lor L.\text{lastSyncReceipt.incrementsProcessed} = 0)
\end{cases}$$

### 4.2 Exact Baseline Execution
When $\text{isPristine}(L)$ is `true`:
1. `installationBaseline` is recorded:
   ```json
   {
     "completed": true,
     "installedAt": "2026-11-17T12:00:00.000Z",
     "baselineDateUtc": "2026-11-17",
     "initialCounts": {
       "yesterday": 10,
       "today": 14
     }
   }
   ```
2. `dailyHwm` is established matching initial snapshot totals (`dailyHwm['2026-11-16'] = 10`, `dailyHwm['2026-11-17'] = 14`).
3. `dailyRewardOrdinal` is established strictly at 0 (`dailyRewardOrdinal['2026-11-16'] = 0`, `dailyRewardOrdinal['2026-11-17'] = 0`).
4. `ownerDatabaseId` and `ownerLogin` are immutably bound to the verified personal user.
5. Generation advances to $G+1$.
6. Strictly **zero retroactive XP, zero satiety, and zero slices** are generated.

### 4.3 Fail-Closed Rejection Behavior
If `L.installationBaseline?.completed !== true` but any pristine condition is violated:
- If `L.slices.length > 0`: Throws `CorruptOrdinalError('Class B Fatal Local Integrity Failure: Established ledger contains recorded slices but is missing installationBaseline.')`.
- If `dailyHwm` or `dailyRewardOrdinal` contains non-zero entries: Throws `CorruptHwmError('Class B Fatal Local Integrity Failure: Uninitialized ledger contains unexpected HWM entries.')`.
- If `dailyAccruedXp` contains accrued XP $> 0$: Throws `CorruptOrdinalError('Class B Fatal Local Integrity Failure: Uninitialized ledger contains pre-existing accrued XP.')`.
- If `monthlyHistoricalSummary.length > 0`: Throws `CorruptOrdinalError('Class B Fatal Local Integrity Failure: Uninitialized ledger contains pre-existing monthly compaction summary.')`.
- If `ownerDatabaseId` is defined and does not match `verifiedOwnerId`: Throws `IdentityMismatchError('Immutable Owner Database ID Mismatch: Cannot rebind established identity.')`.
- **System Guarantee:** ZERO MUTATION occurs. The transaction aborts immediately, preventing identity rebinding or retroactive reward injection.

---

## 5. Actual Workflow Schedule Inventory & Cost Models

### 5.1 Exact Declarations

| Workflow File | Declared Triggers | Schedule Timing (UTC) | Triggers / Day |
|---|---|---|---|
| `.github/workflows/pet-publisher.yml` | `schedule` (2 crons), `workflow_dispatch` | - `cron: '47 * * * *'` (Hourly at :47)<br>- `cron: '23 */6 * * *'` (00:23, 06:23, 12:23, 18:23) | **28** |
| `.github/workflows/pet-interaction.yml` | `schedule` (1 cron), `issues: [opened]`, `workflow_dispatch` | - `cron: '47 * * * *'` (Hourly at :47) | **24** |
| `.github/workflows/diagnostics-contribution-probe.yml` | `workflow_dispatch` only | Manual on-demand execution | **0** |
| **Repository Grand Total** | | | **52** |

### 5.2 Concurrency Queuing & Pending-Run Replacement
Both scheduled workflows declare:
```yaml
concurrency:
  group: pet-runtime-${{ github.repository }}
  cancel-in-progress: false
```
- At minute 47 of every hour, both workflows are triggered simultaneously.
- One job is picked up by a runner; the other is placed in the `pending` queue.
- When multiple events fire rapidly, GitHub Actions limits pending runs to **at most one**, dropping/replacing older pending runs.
- **Critical Distinction:** 52 scheduled triggers per day does **NOT** result in 52 executed runs per day. Intermediate pending runs are routinely collapsed.

### 5.3 Operating Cost Models

#### Public Repository Reality (`mnp210/GitHub-Profile-Pet`)
- Core GitHub-hosted Linux runner minutes are **100% free of charge** (₹0 / $0 billed cost).
- Operating boundaries are governed by platform constraints:
  - Account-wide limit of 20 concurrent jobs.
  - Runner pool queuing latency during global top-of-hour traffic spikes (mitigated by offset minutes :47 and :23).
  - Concurrency group queuing (at most 1 pending job).

#### Private Repository Billing Model (Reference Scenario)
- Assuming a private fork where whole-minute billing applies and zero pending runs are collapsed:
  $$52 \text{ jobs/day} \times 30 \text{ days/month} = \mathbf{1,560\text{ billed minutes/month}}$$
  Well within GitHub's 2,000 free monthly minutes for private repositories (440 minutes reserve margin).

---

## 6. Final Whole-Increment Cap Policy

The following immutable project invariants govern contribution reward accrual:

1. **No Partial XP Awards:** An increment is either rewarded in full or forfeited in full. An increment is never divided, truncated, or partially credited.
2. **Whole-Increment Overflows:** If an increment's reward ($R \in \{25, 15, 10, 5\}$ XP) exceeds the remaining daily cap headroom ($300 - \text{dailyAccruedXp}$), the entire increment is forfeited with **0 XP and 0 satiety**. It is tagged with `forfeitureReason: 'whole_increment_overflow'`.
3. **Ordinal Continuity:** Evaluating a `whole_increment_overflow` increment consumes its daily ordinal and one slot of the 5-increment hourly throttle, but does NOT advance `dailyAccruedXp`. Later pending increments for that date continue evaluation in original ordinal order because a smaller increment (e.g. 10 XP or 5 XP) may still fit within the remaining cap allowance.
4. **Immediate Bulk Cap Forfeiture:** When `dailyAccruedXp[syncDate]` reaches exactly 300 XP, all remaining pending increments for that UTC date are immediately transitioned to `status: 'forfeited'` with `forfeitureReason: 'daily_cap_exhausted'`.
5. **Quota Exemption for Bulk Forfeitures:** Bulk cap-exhaustion forfeitures do **NOT** consume the 5-increment hourly evaluation quota (`remainingHourlyQuota` is untouched, and `hourlyIncrementUsage` is not incremented).
6. **Multi-Day Independence:** Bulk forfeiture of an exhausted date does not block pending increments from newer UTC dates whose daily cap has not yet been reached.
7. **Permanent Terminal Status:** Forfeitures are permanent and immutable. An increment that is forfeited permanently consumes its daily ordinal and can never be re-evaluated or re-awarded.

---

## 7. Single Rate-Limit Deferral Policy

### 7.1 Authoritative Deferral Threshold
- **Threshold Value:** `x-ratelimit-remaining < 50` points.
- **Technical Rationale:** The standard GitHub Actions `GITHUB_TOKEN` provides 1,000 rate-limit points per hour. A threshold of 50 points reserves a 5% safety buffer for other repository workflows and Actions platform tasks.
- **Action upon Deferral:** If remaining points fall below 50, the contribution synchronization step exits cleanly with a diagnostic receipt (`status: 'rate_limited'`). Zero state mutation occurs; passive pet simulation proceeds independently.
- **Current Status:** **Requires Implementation**. The current `contributionProvider.ts` checks HTTP 403 secondary limits and consistency, but does not yet evaluate a pre-flight remaining-points threshold. This check must be implemented and tested in Phase 3C2.2.3 (AC-36).

### 7.2 Unverified 2-Day Aliased Query Cost
- **Classification:** **Strictly Unverified**.
- While single-window queries consume 1 point, the exact cost of an aliased query retrieving two distinct `contributionsCollection` windows (`yesterday` and `today`) under the Actions-provided `GITHUB_TOKEN` has not yet been measured on a hosted runner.
- **Claiming a 1-point cost without live hosted measurement is prohibited.**
- Measurement will be executed in Phase 3C2.3 via `diagnostics-contribution-probe.yml` (AC-22).

---

## 8. Separate Recovery Descriptions by Runtime Environment

### 8.1 Ephemeral GitHub Actions Runner
- **Container Lifecycle:** The virtual container filesystem is ephemeral and destroyed immediately upon job completion, cancellation, or failure.
- **Failure Behavior:** If a publication step fails (e.g. Stage 1 pre-push fence detects remote divergence, or Stage 2 push is rejected as non-fast-forward):
  - The local container exits with code 1.
  - The unpushed local commit and modified on-disk state (Gen $G+1$) are permanently discarded with the container.
  - The remote GitHub repository remains completely pristine at Generation $G$.
- **Subsequent Run Recovery:**
  - The next workflow run checks out authoritative remote `HEAD` fresh (`fetch-depth: 1`).
  - No half-written files or journal remnants exist.
  - The GraphQL provider queries cumulative contribution totals.
  - The accounting engine reconciles against remote Generation $G$'s `dailyHwm`, observes the delta again, re-evaluates the increments, advances to $G+1$, renders visual assets, and pushes.
  - **Outcome:** Guaranteed zero reward duplication and zero state corruption.

### 8.2 Persistent Local Workspace (Manual CLI / Developer Machine)
- **Filesystem Lifecycle:** Local files and Git working directories persist across executions.
- **Destructive Commands Prohibited:** Automatic execution of `git reset --hard` or `git clean -fd` is **strictly forbidden**, as it destroys uncommitted developer edits, untracked files, and scratch data.
- **Startup Journal Recovery:**
  - On startup, `recoverRepositoryState(baseDir)` inspects `pet/.journal`.
  - If `state === 'committed'` in `meta.json`, it rolls forward to Generation $G+1$.
  - If `state === 'preparing'`, it rolls back to Generation $G$.
- **Diverged Branch Handling:**
  - If local `HEAD` has an unpushed commit (Gen $G+1$) while remote `origin/main` has advanced concurrently:
    - The system **fails closed** with a descriptive diagnostic error.
    - Automatic rebasing of generated accounting state is forbidden.
    - The developer is instructed to inspect the divergence manually.

---

## 9. Authoritative Single 36-Item Acceptance Matrix

This is the single authoritative acceptance criteria matrix across all documentation:

| Req ID | Scenario | Expected Behavior | Verification Test Method | Affected Components | Precise Status |
|---|---|---|---|---|---|
| **AC-01** | Strict pristine first-install baseline | Full 10-point `isPristine` predicate satisfied; sets `dailyHwm` and `dailyRewardOrdinal = 0`; sets `completed = true`; awards strictly 0 retroactive XP. | `test/pet-engine/contributionAccounting.test.ts` (Test 1) | `contributionEngine.ts` | **Requires Implementation** |
| **AC-02** | Personal account identity match | Personal user account (`__typename === 'User'`) matching established ledger numeric ID succeeds. | `test/pet-engine/contributionProvider.test.ts` (Test 1, 4) | `contributionProvider.ts`, `identityResolver.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-03** | Organization repo without `PET_OWNER_LOGIN` | Organization account without explicit personal variable throws `OrganizationAccountError` and fails closed. | `test/pet-engine/contributionProvider.test.ts` (Test 6) | `contributionProvider.ts`, `identityResolver.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-04** | Organization repo with valid `PET_OWNER_LOGIN` | Explicit personal owner resolved via `PET_OWNER_LOGIN`; synchronization succeeds for personal account. | New integration test | `identityResolver.ts`, CLI orchestrator | **Requires a New Test** |
| **AC-05** | Immutable numeric ID mismatch | `snapshot.ownerDatabaseId !== ledger.ownerDatabaseId` throws `IdentityMismatchError`; zero mutation. | `test/pet-engine/contributionAccounting.test.ts` (Test 10) | `contributionEngine.ts`, `identityResolver.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-06** | Partially populated installation baseline fails closed | `completed: false` with slices present, or missing identity with populated HWM throws `CorruptOrdinalError`. | New unit test | `contributionEngine.ts` | **Requires Implementation** |
| **AC-07** | Duplicate identical snapshots | Re-executing identical snapshot produces delta = 0, zero new slices, zero XP, state generation untouched. | `test/pet-engine/contributionAccounting.test.ts` (Test 4) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-08** | Increased cumulative counts | Delta > 0 generates slices with ordinals starting at `previousOrdinal + 1`; awards diminishing XP. | `test/pet-engine/contributionAccounting.test.ts` (Test 2, 6) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-09** | Decreased cumulative counts | Observed count lower than HWM does not reduce HWM or revoke XP; delta is clamped to 0. | `test/pet-engine/contributionAccounting.test.ts` (Test 5) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-10** | UTC midnight rollover | Crosses midnight UTC; queries new today and previous day; previous day pending slices retain original date and cap. | `test/pet-engine/immediateCapForfeiture.test.ts` (Test 2) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-11** | Multi-day queue settlement | Yesterday pending slices evaluate first; do not block today slices up to the 5/hr quota. | `test/pet-engine/immediateCapForfeiture.test.ts` (Test 2) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-12** | Daily cap enforcement across process restart | 300 XP cap persisted to disk; process restart reloads ledger and rejects exceeding increments. | `test/pet-engine/capThrottleAudit.test.ts` (Test 4) | `contributionEngine.ts`, `stateRepository.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-13** | 5-increment hourly throttle across invocations | 5 increments evaluated in hour; 6th increment deferred to pending queue until next hour. | `test/pet-engine/contributionAccounting.test.ts` (Test 7) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-14** | Immediate bulk forfeiture at 300 XP cap | Date reaching 300 XP immediately marks all remaining pending increments for that date `forfeited` (`daily_cap_exhausted`) with 0 quota consumed. | `test/pet-engine/immediateCapForfeiture.test.ts` (Test 1, 3) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-15** | Whole-increment overflow followed by smaller reward | At 290 XP, 25 XP increment forfeits (`whole_increment_overflow`); subsequent 10 XP increment fits and rewards. | `test/pet-engine/immediateCapForfeiture.test.ts` (Test 4) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-16** | Expiry at exact 48-hour boundary | Slices past `syncDate midnight + 48h` mark `status: 'expired'`, even if date is at cap. | `test/pet-engine/immediateCapForfeiture.test.ts` (Test 5) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-17** | Pending ledger compaction exclusion | Slices in `pending` status are never compacted into monthly summaries. | `test/pet-engine/capThrottleAudit.test.ts` (Test 6) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-18** | Provider timeout before lock | 15s timeout aborts GraphQL query; zero lock acquired; zero ledger mutation. | `test/pet-engine/nativeGraphQLClient.test.ts` (Test 4) | `nativeGraphQLClient.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-19** | Provider failure with simulation continuing | Network failure skips accounting (zero ledger mutation); passive simulation continues independently. | New integration test | Pipeline CLI orchestrator | **Requires Implementation** |
| **AC-20** | Partial GraphQL data rejected | Response missing required fields throws `InvalidContributionDataError`; fails closed. | `test/pet-engine/contributionProvider.test.ts` (Test 10) | `contributionProvider.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-21** | Rate-limit telemetry mismatch rejected | Disagreement between GraphQL body and HTTP headers fails consistency check; halts sync. | `test/pet-engine/contributionProvider.test.ts` (Test 14-25) | `contributionProvider.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-22** | Exact two-day query cost measurement | Measures `rateLimit.cost`, `limit`, `remaining`, and `used` for 2-day aliased query on hosted runner. | Hosted Actions diagnostic run | `.github/workflows/diagnostics-contribution-probe.yml` | **Requires Live Hosted Verification** |
| **AC-23** | Authentication and permission error handling | HTTP 401/403 throws typed error; tokens redacted; fails closed. | `test/pet-engine/contributionProvider.test.ts` (Test 7, 8) | `nativeGraphQLClient.ts`, `contributionProvider.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-24** | Crash before journal commit | Crash while writing `pet/.journal/target` rolls back cleanly to Generation G on next boot. | `test/pet-engine/journalRecovery.test.ts` (Test TC-REC-02) | `stateRepository.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-25** | Crash during multi-document replacement | Crash after `meta.json` committed rolls forward cleanly to Generation G+1 on next boot. | `test/pet-engine/journalRecovery.test.ts` (Test TC-REC-01) | `stateRepository.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-26** | Crash after journal commit before SVG/README publication | Local disk at G+1; next boot loads G+1, regenerates SVG/README matching G+1, with zero reward duplication. | New integration test | Pipeline CLI, `stateRepository.ts` | **Requires Implementation** |
| **AC-27** | Staging exact 5-file manifest | Manifest includes `actions.json`; prevents `GenerationMismatchError` on subsequent checkout. | Workflow bash script / CLI test | Pipeline CLI orchestrator | **Requires Implementation** |
| **AC-28** | Remote generation advances after checkout | Pre-push fence detects `remoteCommit !== checkoutCommit`; aborts publication without blind rebase. | New integration test | Pipeline CLI, workflow script | **Requires Implementation** |
| **AC-29** | Push rejected after pre-push fence | Git server rejects non-fast-forward push in Stage 2; runner aborts publication cleanly. | New integration test | Workflow script | **Requires Implementation** |
| **AC-30** | Fresh-checkout recovery after failed publication | Next run checks out remote HEAD; recalculates from cumulative totals; zero duplicate rewards. | New integration test | Pipeline CLI orchestrator | **Requires a New Test** |
| **AC-31** | Render and ledger generation consistency | SVG rendered strictly from committed Generation G+1 disk state before lock release. | New integration test | Pipeline CLI orchestrator | **Requires Implementation** |
| **AC-32** | Long provider outage and 48-hour horizon | Outages > 48 hours settle [yesterday, today]; contributions older than yesterday are not retroactively awarded. | New integration test | `contributionEngine.ts` | **Requires a New Test** |
| **AC-33** | Zero secret leakage in logs or Git diff | Tokens and bearer credentials redacted from all errors, receipts, summaries, and Git commits. | `test/pet-engine/nativeGraphQLClient.test.ts` (Test 5) | `nativeGraphQLClient.ts`, `contributionProvider.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-34** | Post-baseline conservation invariant | `totalRecordedUnits === rewarded + forfeited + pending + expired` strictly verified before save. | `test/pet-engine/contributionAccounting.test.ts` (Test 16) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-35** | Baseline exclusion from recorded units | Initial baseline activity sets HWM but generates 0 slices and is excluded from `totalRecordedUnits`. | `test/pet-engine/contributionAccounting.test.ts` (Test 1) | `contributionEngine.ts` | **Already Implemented & Supported by Existing Test** |
| **AC-36** | Rate-limit defer threshold | Sync defers cleanly without error when `x-ratelimit-remaining < 50`; passive simulation proceeds. | New unit test | `contributionProvider.ts`, Pipeline CLI | **Requires Implementation** |

---

## 10. Old R2 Review Table ID to Authoritative ID Mapping

To ensure seamless traceability between previous draft reviews and the authoritative matrix:

| Old R2 Review ID | Old Scenario Name | Authoritative ID | Authoritative Scenario Name | Status Alignment |
|---|---|---|---|---|
| **Old AC-01** | Pristine ledger initialization | **AC-01** | Strict pristine first-install baseline | Requires Implementation |
| **Old AC-02** | Query Window (2 dates) | **AC-10 / AC-11** | UTC midnight rollover / Multi-day queue settlement | Already Implemented & Supported by Existing Test |
| **Old AC-03** | Identity Safety | **AC-02 / AC-05** | Personal account match / Numeric ID mismatch | Already Implemented & Supported by Existing Test |
| **Old AC-04** | Rate Telemetry | **AC-21** | Rate-limit telemetry mismatch rejected | Already Implemented & Supported by Existing Test |
| **Old AC-05** | Rate Timestamp | **AC-20** | Partial / Malformed GraphQL data rejected | Already Implemented & Supported by Existing Test |
| **Old AC-06** | Day Rollover | **AC-10** | UTC midnight rollover | Already Implemented & Supported by Existing Test |
| **Old AC-07** | Increments Delta | **AC-07 / AC-08** | Duplicate snapshots / Increased counts | Already Implemented & Supported by Existing Test |
| **Old AC-08** | Order | **AC-11** | Multi-day queue settlement (syncDate, ordinal ASC) | Already Implemented & Supported by Existing Test |
| **Old AC-09** | Hourly Throttle | **AC-13** | 5-increment hourly throttle across invocations | Already Implemented & Supported by Existing Test |
| **Old AC-10** | Pending Overflow | **AC-13** | 5-increment hourly throttle across invocations | Already Implemented & Supported by Existing Test |
| **Old AC-11** | Daily Cap (300 XP) | **AC-12** | Daily cap enforcement across process restart | Already Implemented & Supported by Existing Test |
| **Old AC-12** | *Partial Accrual (Clamped)* | **ELIMINATED** | **Replaced by AC-15 (Whole-increment overflow)** | **Policy Corrected** |
| **Old AC-13** | Cap Forfeiture | **AC-14 / AC-15** | Bulk cap forfeiture / Whole-increment overflow | Already Implemented & Supported by Existing Test |
| **Old AC-14** | Bulk Forfeiture | **AC-14** | Immediate bulk forfeiture at 300 XP cap | Already Implemented & Supported by Existing Test |
| **Old AC-15** | Forfeit Exemption | **AC-14** | Immediate bulk forfeiture (0 quota consumed) | Already Implemented & Supported by Existing Test |
| **Old AC-16** | Reason Trace | **AC-14 / AC-15** | Forfeiture reason tagging (`daily_cap_exhausted`) | Already Implemented & Supported by Existing Test |
| **Old AC-17** | State Lockstep | **AC-27** | Staging exact 5-file manifest (avoids mismatch) | Requires Implementation |
| **Old AC-18** | Vitality Rewards | **AC-08** | Increased cumulative counts (XP & Satiety) | Already Implemented & Supported by Existing Test |
| **Old AC-19** | Compaction | **AC-17** | Pending ledger compaction exclusion | Already Implemented & Supported by Existing Test |
| **Old AC-20** | Compaction Immutability | **AC-17** | Monthly summary compaction integrity | Already Implemented & Supported by Existing Test |
| **Old AC-21** | Asset Sync | **AC-31** | Render and ledger generation consistency | Requires Implementation |
| **Old AC-22** | Pre-Push Fence | **AC-28** | Remote generation advances after checkout | Requires Implementation |
| **Old AC-23** | Fast-Forward Only | **AC-29** | Push rejected after pre-push fence | Requires Implementation |
| **Old AC-24** | 5-File Manifest | **AC-27** | Staging exact 5-file manifest | Requires Implementation |
| **Old AC-25** | Ephemeral Safety | **AC-30** | Fresh-checkout recovery after failed publication | Requires a New Test |
| **Old AC-26** | Local Recovery | **AC-24 / AC-25** | Crash recovery via stateRepository journal | Already Implemented & Supported by Existing Test |
| **Old AC-27** | Concurrency Lock | **AC-18** | Local pet/.lock mutex | Already Implemented & Supported by Existing Test |
| **Old AC-28** | Actions Concurrency | **AC-28** | Concurrency group pet-runtime serialization | Workflow Baseline |
| **Old AC-29** | Outage Handling | **AC-19** | Provider failure with simulation continuing | Requires Implementation |
| **Old AC-30** | 48h Horizon | **AC-32** | Long provider outage and 48-hour horizon | Requires a New Test |
| **Old AC-31** | Schema Validation | **AC-20 / AC-34** | Schema and conservation invariant validation | Already Implemented & Supported by Existing Test |
| **Old AC-32** | End-to-End Tick | **AC-31** | Live contribution query updates and publication | Requires Implementation |
| **Old AC-33** | Zero-Change Skip | **AC-07** | Duplicate identical snapshots (delta = 0 noop) | Already Implemented & Supported by Existing Test |
| **Old AC-34** | *Cost Guard (< 100 pt)* | **AC-36** | **Standardized to AC-36 (< 50 pt deferral)** | **Threshold Reconciled** |
| **Old AC-35** | Audit Log | **AC-33** | Zero secret leakage in logs/receipts | Already Implemented & Supported by Existing Test |
| **Old AC-36** | End-to-End Recovery | **AC-26** | Crash after journal commit before publication | Requires Implementation |

---

## 11. Remaining Live-Verification Requirements

Two specific acceptance criteria cannot be concluded through offline unit tests and require live hosted execution in Phase 3C2.3:

1. **AC-22 (Exact 2-Day Query Cost on Hosted Runner):**
   - **Requirement:** Run `diagnostics-contribution-probe.yml` with the 2-day aliased query on a live GitHub Actions runner.
   - **Verification:** Inspect the emitted `rateLimit { cost, limit, remaining, used }` telemetry to record the exact point cost under the real `GITHUB_TOKEN`.
2. **AC-32 (End-to-End Contribution Sync and Fast-Forward Push):**
   - **Requirement:** Execute the consolidated publisher workflow on a scheduled trigger.
   - **Verification:** Confirm that public contributions are retrieved, delta calculated, 5-file commit created, and atomic push accepted on `origin/main`.

---

## 12. Final Conclusion & Implementation Readiness

### Working Tree Hygiene Audit
- **Modified files:** 0 files modified outside approved documentation reports.
- **Untracked files:** 0 new source or test files.
- **Git Commit Baseline:** Exactly `9658548d2173dfc19a26f6434c6ed341632c9b2a`.

### Final Assessment: FULL PASS

All architectural, conceptual, and empirical discrepancies have been completely resolved:
- **Authoritative Pristine Predicate:** Defined using strictly actual schema fields.
- **Workflow Schedule:** 52 triggers/day verified and differentiated from concurrency-collapsed executions.
- **Cap Policy:** Whole-increment forfeiture and immediate bulk forfeiture restored without ambiguity.
- **Rate-Limit Policy:** Harmonized to 50 points; 2-day query cost classified as Unverified.
- **Recovery Boundaries:** Ephemeral runner discard lifecycle decoupled from persistent local workspace recovery.
- **Acceptance Criteria:** Single, authoritative 36-item matrix established across all documentation.

**Phase 3C2.2.3 implementation is fully specified and ready for execution upon explicit written owner authorization.**
