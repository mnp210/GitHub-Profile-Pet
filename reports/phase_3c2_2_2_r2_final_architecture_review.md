# Phase 3C2.2.2-R2 — Final Architecture Review & Readiness Report (Reconciled)

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Target Branch:** `main`  
**Authoritative Remote Baseline:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`  
**Date:** 2026-11-17  
**Milestone:** Phase 3C2.2.2-R2 (Reconciled under Phase 3C2.2.2-R3)  
**Status:** Architecture Reconciled & Implementation-Ready (Pending Owner Authorization)

---

## 1. Executive Summary & Authorization Scope

This document records the architectural review and readiness assessment for integrating the verified GitHub GraphQL contribution provider (`src/features/pet-engine/contribution/contributionProvider.ts`) with the deterministic contribution accounting engine (`src/features/pet-engine/accounting/contributionEngine.ts`).

In accordance with strict project authorization boundaries:
- **Scope:** Design, reconciliation, and documentation only.
- **Source Code Mutations:** 0 files modified.
- **Workflow Modifications:** 0 workflows modified or dispatched.
- **State & Ledger Modifications:** 0 state documents or journal entries modified.
- **Git Operations:** Read-only inspection; 0 commits, pushes, cleans, resets, or branch switches.

The authoritative runtime architecture specification is maintained at:  
[phase_3c2_2_2_contribution_sync_runtime_architecture.md](file:///D:/Projects/GitHub-Profile-Pet/reports/phase_3c2_2_2_contribution_sync_runtime_architecture.md)

---

## 2. Review of R2 Corrective Closures (R2-01 through R2-08)

All eight core review findings have been resolved in full alignment with existing repository interfaces and schema definitions:

### R2-01: Close the Remote Push Race
- **Two-Stage Safety Protocol:**
  - *Stage 1 (Pre-Flight Remote Generation Check):* Prior to invoking `git push`, the runner queries remote HEAD via `git ls-remote origin refs/heads/main` while holding the local repository lock (`pet/.lock`). If remote HEAD does not match the checked-out commit SHA (`HEAD_AT_CHECKOUT`), publication immediately aborts without attempting a push.
  - *Stage 2 (Server-Side Fast-Forward Enforcement):* The final push executes via standard atomic push (`git push origin main`). No `--force`, `--force-with-lease`, or blind rebase is permitted. If a concurrent push occurred between Stage 1 and Stage 2, Git's native fast-forward rejection acts as an impenetrable second safety boundary.
- **Outcome:** Blind rebasing and state clobbering are mathematically prevented. A rejected push terminates cleanly with exit code 1; the next run reconciles from authoritative remote HEAD.

### R2-02: Define Publication Failure Recovery
- **Ephemeral Runners (GitHub Actions):** If publication aborts or a push is rejected, the ephemeral runner container is destroyed. Unpushed local commits or working files are discarded naturally. Authoritative state remains pristine on remote GitHub. The subsequent workflow run checks out authoritative remote HEAD fresh (`fetch-depth: 1`) and reconciles against remote cumulative totals.
- **Persistent Local Workspaces:** Destructive recovery commands (`git reset --hard`) are strictly forbidden. The system checks `pet/.journal` and executes `recoverRepositoryState(baseDir)` to roll back or roll forward cleanly, preserving developer worktrees and uncommitted files.

### R2-03: Exact Publication Manifest & Generation Lockstep
- **Lockstep Requirement:** Traced `src/features/pet-engine/persistence/stateRepository.ts` (`loadRepositoryState`). The repository requires strict generation lockstep:
  $$\text{pet.generation} \equiv \text{contributions.generation} \equiv \text{actions.generation}$$
  If `actions.json` is omitted from the staged Git commit, its generation on disk will lag behind `pet.json` and `contributions.json`, triggering a fatal `GenerationMismatchError` on any subsequent execution.
- **Authoritative 5-File Manifest:** Every contribution sync publication commit must atomically stage:
  1. `pet/state/pet.json`
  2. `pet/ledger/contributions.json`
  3. `pet/ledger/actions.json`
  4. `public/pet.svg`
  5. `README.md`

### R2-04: Authoritative Strict Pristine Ledger Predicate
- **Real-Field Enforcement:** Replaced permissive or conceptual checks with an exact, uncompromising predicate derived directly from `pet/schemas/contributions.schema.json` and `src/features/pet-engine/domain/types.ts`:
  1. `ledger.schemaVersion === 1`
  2. `ledger.generation >= 1`
  3. `ledger.installationBaseline === undefined` *(partially initialized baseline with `completed: false` is invalid and NEVER qualifies as pristine)*
  4. `Array.isArray(ledger.slices) && ledger.slices.length === 0`
  5. `Array.isArray(ledger.monthlyHistoricalSummary) && ledger.monthlyHistoricalSummary.length === 0`
  6. `ledger.dailyHwm === undefined || Object.keys(ledger.dailyHwm).length === 0`
  7. `ledger.dailyRewardOrdinal === undefined || Object.keys(ledger.dailyRewardOrdinal).length === 0`
  8. `ledger.dailyAccruedXp === undefined || Object.keys(ledger.dailyAccruedXp).length === 0`
  9. `ledger.lastSyncReceipt === undefined` *(a genuinely pristine ledger has never executed a sync run; any receipt indicates prior execution or contradictory state)*
  10. `ledger.hourlyIncrementUsage === undefined || Object.keys(ledger.hourlyIncrementUsage).length === 0`
  11. `ledger.monotonicPublicHwm === undefined || ledger.monotonicPublicHwm === 0`
  12. `ledger.ownerDatabaseId === undefined || ledger.ownerDatabaseId === verifiedOwnerDatabaseId` *(prevents silent identity rebinding)*
- **Distinguishing Pristine from Established (0 Activity):**
  - An established ledger with zero recent activity has `installationBaseline.completed === true`, established `ownerDatabaseId`, and populated `dailyHwm`/ordinals. It routes strictly to **Path B (Established Reconciliation)**, recording a `noop` without modifying baseline.
  - Only a genuinely pristine installation routes to **Path A (Baseline Initialization)**.
- **Fail-Closed Guarantee:** Any partially initialized (`completed: false`), unbaselined, malformed, or identity-mismatched state fails closed immediately (`LedgerIntegrityError`, `CorruptOrdinalError`, `CorruptHwmError`, or `IdentityMismatchError`). Zero mutation occurs.

### R2-05: Crash-Safe Visual Asset Regeneration
- **Renderer Interface:** Confirmed `publishPetSvg(options?: PublishPetOptions)` in `src/features/pet-engine/publication/svgPublisher.ts` reads `pet/state/pet.json` **strictly from disk** (`statePath`) and does not accept an in-memory object.
- **Protocol:** Disk commit of JSON state occurs first under local lock; `publishPetSvg` is called immediately while lock is held; all 5 files are staged and committed atomically to Git.
- **Persistent Workspace Catch-Up:** In a persistent local workspace, a crash between disk commit and Git push is cleanly caught up on the next execution by reloading Generation $G+1$ and re-rendering visual assets with zero duplicate rewards.

### R2-06: Accurate Actions Concurrency & Cost Reference Model
- **Schedule Inventory:**
  - `.github/workflows/pet-publisher.yml`: `cron: '47 * * * *'` (24/day) + `cron: '23 */6 * * *'` (4/day) = **28 scheduled triggers/day**.
  - `.github/workflows/pet-interaction.yml`: `cron: '47 * * * *'` (24/day) + `issues: [opened]`.
  - `.github/workflows/diagnostics-contribution-probe.yml`: `workflow_dispatch` only = **0 scheduled triggers/day**.
  - Current declared inventory: **52 scheduled triggers/day**.
- **Concurrency Queuing Policy:**
  - Both scheduled workflows declare `concurrency: group: pet-runtime-${{ github.repository }}` with `cancel-in-progress: false`.
  - GitHub Actions concurrency permits **one running job and at most one pending job** per group.
  - If a newer run is queued while a job is running and another is pending, the newer run replaces/coalesces the older pending run.
  - Some scheduled runs may be coalesced when triggers coincide, but this is **not guaranteed**; if an active run concludes before the next trigger, runs execute independently.
  - Consequently, **executed runs may be fewer than, equal to, or otherwise dependent on the arrival and completion timing of scheduled triggers and runner queue availability**. We do not assert that execution count is strictly lower than scheduled trigger count.
- **Cost Separation:**
  - *Private Repository Reference Scenario:* A **hypothetical upper reference scenario** assuming all 52 scheduled triggers execute independently (zero coalescing) and round to 1 billable minute over 30 days yields $\mathbf{1,560\text{ billed minutes/month}}$ (within the 2,000 min allowance). This is an upper planning boundary, not an empirical forecast.
  - *Public Repository Reality:* On `mnp210/GitHub-Profile-Pet`, standard GitHub-hosted Linux runners incur **₹0 / $0 minute billing charges**. Operational limits are governed by account-level 20-job concurrency, platform load, and queue availability, which are not unlimited or guaranteed.

### R2-07: Outage Horizon & Provider Degradation Policy
- **Falsification Prohibited:** When the GitHub GraphQL API is unreachable or rate-limited, creating synthetic "zero-contribution" entries is strictly prohibited.
- **Simulation Continuity:** Passive simulation continues vitality decay independently based on local elapsed clock time.
- **48-Hour Recovery Horizon:** Because the query window requests strictly `yesterday` and `today` in UTC, provider outages lasting longer than 48 continuous hours will permanently cross the observation horizon. Contributions on Day -3+ cannot be settled into daily slices without historical backfill tooling.

### R2-08: Acceptance Matrix Reconciliation
- Reconciled all acceptance criteria to match the authoritative 36-scenario matrix (see Section 4).

---

## 3. Explicit Inventory of Unverified Assumptions & Technical Risks

| # | Assumption / Technical Risk | Impact Level | Mitigation & Verification Plan |
|---|---|---|---|
| **A-01** | **GraphQL Point Cost for 2-Day Aliased Query**<br>The specification assumes that querying two `contributionsCollection` windows (`yesterday` and `today`) in a single GraphQL document consumes standard points. | Low | **Strictly Unverified**: Must be empirically confirmed during live hosted execution of `diagnostics-contribution-probe.yml` using the Actions-provided `GITHUB_TOKEN` (AC-22). Claiming a 1-point cost without live evidence is prohibited. |
| **A-02** | **Rate-Limit Deferral Threshold Implementation**<br>The synchronization engine must defer execution cleanly when `x-ratelimit-remaining < 50` points. | Low | **Requires Implementation**: Current code does not yet check this threshold prior to executing contribution sync; must be implemented and tested in Phase 3C2.2.3 (AC-36). |
| **A-03** | **Runner Clock Skew vs. GitHub Reset Timestamps**<br>Actions runners could experience 1–2 seconds of clock drift relative to GitHub's API clock. | Low | Absorbed by the 2-second tolerance window implemented and verified in Phase 3C2.1 (`resetAt` vs `x-ratelimit-reset`). |
| **A-04** | **Filesystem Locking Cross-Platform Compatibility**<br>`proper-lockfile` behavior across Ubuntu runner virtual disks vs Windows local NTFS. | Minimal | `proper-lockfile` relies on atomic `mkdir` semantics, verified cross-platform in existing journal test suites. |
| **A-05** | **Contributions Beyond 48h Outage Window**<br>Extended outage exceeding 48 hours leaves Day -3+ activity unsettled. | Medium | Explicitly accepted architectural boundary; daily engine rolling window prevents historical re-evaluation. |

---

## 4. Authoritative 36-Scenario Acceptance Criteria Mapping

This is the single authoritative acceptance criteria matrix, matching `reports/phase_3c2_2_2_contribution_sync_runtime_architecture.md`:

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

## 5. Implementation Readiness & Boundary Verification

### Working Tree Hygiene Check
A complete audit of `git status --short` confirms:
- **Modified files:** Strictly isolated to the 6 previously approved Phase 3C2.2.1-R2 domain, schema, and accounting files.
- **Untracked files:** Strictly isolated to historical reports, the finalized Phase 3C2.2.2 architecture document, and Phase 3C2.2.1 test files.
- **Zero code, schema, workflow, or state mutations** occurred during this milestone.

### Transition to Phase 3C2.2.3
All architectural ambiguities, schedule inventories, pristine predicates, rate-limit policies, and recovery models have been systematically reconciled. The architecture is fully implementation-ready.

**Implementation of Phase 3C2.2.3 remains strictly suspended until explicit owner review and written authorization.**
