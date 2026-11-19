# Phase 3C2.3-B2-R3.23 — Final Candidate Audit, Billing Accuracy & Commit Readiness

**Milestone:** R3.23 (Final Candidate Audit & Documentation Correction)  
**Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Active Branch:** `phase-3c2-3-b2-r3-7-candidate`  
**Candidate Base HEAD:** `83bdf87216271bbdea142c2f2921bd326b599f42`  
**Production Remote Identity:** `mnp210/GitHub-Profile-Pet`  
**Production Remote HEAD:** `f838b3bb3291fdfd99c981985632b6e0d7191322`  
**Execution Timestamp:** 2026-11-19T08:45:00Z (14:15 IST)  
**Milestone Verdict:** `PASS — READY FOR CANDIDATE COMMIT REVIEW`

---

## 1. Initial Candidate State & Verification Boundary

Before executing any audits or modifications during R3.23, the candidate workspace and production remote were verified:

| Verification Target | Expected State | Observed State | Conformance |
| :--- | :--- | :--- | :---: |
| **Workspace Directory** | `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` | `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` | PASS |
| **Active Git Branch** | `phase-3c2-3-b2-r3-7-candidate` | `phase-3c2-3-b2-r3-7-candidate` | PASS |
| **Candidate Base HEAD** | `83bdf87216271bbdea142c2f2921bd326b599f42` | `83bdf87216271bbdea142c2f2921bd326b599f42` | PASS |
| **Production Remote URL** | `https://github.com/mnp210/GitHub-Profile-Pet.git` | `https://github.com/mnp210/GitHub-Profile-Pet.git` | PASS |
| **Production Remote HEAD** | `f838b3bb3291fdfd99c981985632b6e0d7191322` | `f838b3bb3291fdfd99c981985632b6e0d7191322` | PASS |
| **Production Mutations** | Exactly 0 (no dispatches, no issues, no pushes) | Exactly 0 mutations | PASS |

All modifications from milestones R3.21 and R3.22 were preserved intact.

---

## 2. Billing Documentation Corrections & Authoritative Sources

### 2.1 Authoritative Documentation Sources Inspected
- [GitHub Actions Billing and Usage Concepts](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Product Billing: GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Included Compute Usage by Plan](https://docs.github.com/en/billing/reference/product-usage-included)
- [GitHub Actions Runner Pricing & Multipliers](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Choosing Runner Labels for a Job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

### 2.2 Corrections Applied to `README.md`
In R3.22, the billing overview lacked necessary distinction between plans, runner pricing, and account spending limit configurations. The documentation in [`README.md`](../README.md) has been comprehensively corrected to address all ten specific points:

1. **Exact GitHub Plans Identified:** Specifically identifies **GitHub Free (personal accounts)** with 2,000 monthly compute minutes for private repositories, while documenting GitHub Pro (3,000 mins), GitHub Team (3,000 mins), and GitHub Enterprise Cloud (50,000 mins).
2. **Included Usage vs. Runner Minutes:** Clearly distinguishes included compute allowances (provided free with each account plan) from overage runner minutes.
3. **Actual Runner Labels:** Identifies `runs-on: ubuntu-latest`, which provisions a standard GitHub-hosted 2-core x86_64 Linux virtual machine (2 vCPUs, 7 GB RAM, 14 GB SSD storage).
4. **Operating System & Runner Pricing:** Documents the **1x multiplier** for standard Linux runners and the **$0.008 per minute** overage rate when exceeding included monthly minutes on accounts with an active spending limit.
5. **Per-Job Whole-Minute Rounding:** Explains that GitHub Actions rounds the billable execution time of every individual job on private repositories **up to the nearest whole minute**. A 25-second job consumes 1 full billable minute.
6. **Hourly vs. Every-Two-Hour Schedules Calculated Separately:**
   - **Hourly Schedule (Default):** 2 workflows × 24 runs/day = 48 runs/day × 30 days = **1,440 billable minutes/month** (**72.0%** of GitHub Free's 2,000-minute included monthly allowance, leaving 560 minutes for other workflows).
   - **Every-Two-Hour Schedule (`cron: '47 */2 * * *'`):** 2 workflows × 12 runs/day = 24 runs/day × 30 days = **720 billable minutes/month** (**36.0%** of allowance, leaving 1,280 minutes).
   - **Publisher-Only Configuration:** 24 runs/day × 30 days = **720 billable minutes/month** (**36.0%** of allowance).
7. **Issue-Triggered Execution Scenarios:** Documents that care actions submitted via issues trigger `pet-interaction.yml` events. A scenario of ~2 actions/day (~60 issues/month) adds **~60 billable minutes/month** (+3.0% of quota), bringing combined private consumption to **1,500 billable minutes/month** (75.0% of GitHub Free allowance).
8. **Shared Concurrency & Billing Outcomes:** Explains that all runtime workflows serialize under `pet-runtime-${{ github.repository }}` with `cancel-in-progress: false`. Clarified that a queued run that is cancelled before acquiring a runner consumes **0 billable minutes**, whereas once a job starts executing on a runner, it incurs at least 1 billable minute under the whole-minute rounding rule.
9. **Public vs. Larger Runners:** Clarified that standard GitHub-hosted runners on **public repositories are free of charge** (0 billed minutes) and do not consume included compute allowances. Emphasized that this repository never uses GitHub Larger Runners (4-core to 64-core or GPU), which carry higher multipliers.
10. **Account Spending Controls & Cost Guarantees:** Removed the inaccurate claim that a $0 spending limit is automatically configured for every user. Accurately documented that users must inspect **Account Settings > Billing and plans > Spending limits** and configure a **$0.00 spending limit** if they wish to strictly guarantee zero credit card charges. Distinguishes the software architecture's ₹0 / $0 recurring cost design from platform-level runner billing policies.
11. **Retained Operational Boundaries:** Preserved the strict **two-UTC-calendar-day contribution discovery boundary** (`[today - 1 day, today]`) and documented that GitHub Actions scheduled workflows run on a **shared, best-effort queue** subject to delay and jitter during platform peak load.

---

## 3. Organization Administrator Authorization Audit

### 3.1 Implementation Architecture
The authorization model is implemented in:
- [`src/features/pet-engine/contribution/adminAuthorization.ts`](../src/features/pet-engine/contribution/adminAuthorization.ts)
- [`scripts/establish-baseline.ts`](../scripts/establish-baseline.ts)
- [`.github/workflows/pet-baseline.yml`](../.github/workflows/pet-baseline.yml)

### 3.2 Detailed Audit of Critical Requirements

1. **Context Transmission:** `.github/workflows/pet-baseline.yml` passes trusted runner context:
   - `GITHUB_ACTOR: ${{ github.actor }}`
   - `GITHUB_ACTOR_ID: ${{ github.actor_id }}`
   - `GITHUB_REPOSITORY_OWNER: ${{ github.repository_owner }}`
   - `GITHUB_REPOSITORY_OWNER_ID: ${{ github.repository_owner_id }}`
   - `GITHUB_REPOSITORY: ${{ github.repository }}`
   - `CONFIRM_OWNER: ${{ github.event.inputs.confirm_owner }}`
2. **Trusted Configuration Source:** Administrator configuration is obtained from repository variables (`vars.PET_ADMIN_DATABASE_ID`, `vars.PET_ADMIN_LOGIN`), which only repository administrators can configure.
3. **Numeric Identity Validation:** `verifyAdministratorAuthorization()` strictly parses and validates numeric IDs:
   - Rejects non-integers, strings, negative numbers, and `NaN`.
   - Requires `actorId > 0` and `PET_ADMIN_DATABASE_ID > 0`.
4. **Contradiction Prevention:**
   - If both login and numeric ID are available, both must agree (`actorLogin === repoOwnerLogin && actorId === repoOwnerId`).
   - If an actor numeric ID matches the owner ID but the login contradicts it, it fails closed with `AdminAuthorizationError`.
5. **Collaborator API Execution Path & Limitations:**
   - The collaborator API query function `fetchGitHubCollaboratorPermission()` is wired to `GET /repos/{owner}/{repo}/collaborators/{username}/permission`.
   - **Crucial Production Finding:** When running under GitHub Actions' default `GITHUB_TOKEN`, this API call receives **HTTP 403 (Forbidden)** because GitHub's REST API strictly requires administrative repository permissions to query collaborator roles, which the scoped workflow `GITHUB_TOKEN` does not possess.
   - **Fail-Closed Verification:** When HTTP 403 is received, `adminAuthorization.ts` treats this as an API error and **fails closed**, terminating execution with code 1.
   - **Supported Production Route:** For organization repositories, **Mechanism A (`vars.PET_ADMIN_DATABASE_ID` / `vars.PET_ADMIN_LOGIN`) is the authoritative, supported production path**. Mechanism B is an optional fallback that only succeeds if a custom PAT or App token with `admin` scope is provided.
6. **Collaborator Permission Enforcement:** Ordinary organization collaborators with `write`, `read`, or `triage` permissions fail closed with:
   `Access denied: Actor @user has "write" permission... Administrator ("admin") permission is strictly required.`
7. **Decoupled Identity Hierarchy:**
   - `repository_owner`: Account that owns the repository (can be an Organization).
   - `github.actor`: Individual user dispatching the workflow.
   - `PET_ADMIN_DATABASE_ID`: Administrator authorized to run baseline.
   - `PET_OWNER_LOGIN` / `PET_OWNER_DATABASE_ID`: Designated pet trainer whose contributions are tracked.
8. **Immutability Against Secondary Reset:**
   - If a completed baseline already exists (`installationBaseline.completed === true`), Rule 1 in `baselinePipeline.ts` rejects any secondary run with `BaselineAlreadyEstablishedError` (`status: 'baseline_refused'`).
   - Even an authorized administrator cannot overwrite or re-initialize a pet that has already established its baseline.
9. **Dispatch Input Non-Impersonation:** The `confirm_owner` dispatch input is an authorization gate (a human typing confirmation), not an identity provider. Identity is derived strictly from immutable runner context (`github.actor`, `github.actor_id`). A malicious actor typing an admin's username in `confirm_owner` fails closed because `github.actor_id !== PET_ADMIN_DATABASE_ID`.

---

## 4. Pristine-State Validator Audit

### 4.1 Validator Implementation
[`src/features/pet-engine/validation/pristineStateValidator.ts`](../src/features/pet-engine/validation/pristineStateValidator.ts) was inspected across all failure and success modes:

| State Document / Artifact | Evaluated Invariants | Conformance |
| :--- | :--- | :---: |
| **Transaction Journal** | Inspects `pet/.journal`; rejects if any active or uncommitted entries exist | PASS |
| **Concurrency Lock** | Inspects `pet/.lock`; rejects if any lock file exists | PASS |
| **pet/state/pet.json** | Schema valid, `generation === 1`, `xp === 0`, `level === 1`, `evolutionStage === 'Hatchling'`, `maxExp === 100`, `lastWelcomeBonusClaimedAt === null` | PASS |
| **pet/ledger/actions.json** | Schema valid, `generation === 1`, `recentActions.length === 0`, `highWaterIssueNumber === 0`, `sparseProcessedIssueNumbers` empty, `retiredNonActionGaps` empty, `unresolvedGaps` empty, `pendingFeedback` empty | PASS |
| **pet/ledger/contributions.json** | Schema valid, `generation === 1`, `slices.length === 0`, `monthlyHistoricalSummary.length === 0`, accounting maps empty (`dailyAccruedXp`, `dailyHwm`, `dailyRewardOrdinal`, `hourlyIncrementUsage`, `hourlySliceUsage`), `monotonicPublicHwm === 0`, `lastSyncReceipt === undefined` | PASS |
| **Multi-Document Invariant** | Generation consistency: `pet.generation === contributions.generation === actions.generation === 1` | PASS |
| **Foreign Baseline Guard** | Rejects if `allowForeignBaseline === false` and `installationBaseline` exists; rejects if `allowForeignBaseline === true` but baseline already belongs to the target owner | PASS |

### 4.2 Rollback Restoration & Multi-Document Safety
- **Single Modified File Guarantee:** During foreign-fork reinitialization, `baselinePipeline.ts` resets `pet/ledger/contributions.json` to a pristine template before invoking `syncContributions()`.
- **Proof of No Other File Mutations:** `pet/state/pet.json` and `pet/ledger/actions.json` are only written during step 9 (`saveRepositoryState()`) of `contributionSyncService.ts`. If the provider call fails, rate-limits occur, or GraphQL errors arise, execution aborts at step 3, long before `saveRepositoryState()` is called.
- **Rollback Restoration:** If `syncContributions()` fails or returns any error status (`provider_failed`, `baseline_refused`, `integrity_failed`, `conflict`, or thrown exception), `restoreOriginalBytesIfFailed()` immediately restores `pet/ledger/contributions.json` byte-for-byte to its original on-disk content (`originalContribBytes`).
- **Verified by Test `BASE-15`:** Confirmed that a provider failure during reinitialization completely restores `contributions.json` byte-for-byte with zero filesystem changes.

---

## 5. Community Interaction Security Audit

Every call site of `allowAnyAuthor` across `src/`, `scripts/`, `.github/`, and `tests/` was audited:

```
scripts/process-inbox.ts:101:  const allowAnyAuthor = process.env.PET_ALLOW_ANY_AUTHOR === 'true';
src/features/pet-engine/inbox/actionProcessor.ts:432:  (options.allowAnyAuthor === true || ...)
src/features/pet-engine/publication/inboxPublicationPipeline.ts:110:  if (trustedAuthorId === undefined && options.allowAnyAuthor !== true)
```

### Security Invariants Confirmed:
1. **Default Fail-Closed Authorization:** `allowAnyAuthor` defaults to `false`. Actions submitted by anyone other than the authoritative trainer (`trustedAuthorId`) are rejected, marked, closed, and assigned zero rewards.
2. **Trusted Environment Configuration:** Community mode can ONLY be enabled via the server-side environment variable `PET_ALLOW_ANY_AUTHOR === 'true'`. It cannot be toggled via issue titles, issue bodies, issue labels, or workflow dispatch inputs.
3. **No Privilege Escalation via Issues:** Test `SEC-05` confirms that an issue body containing `allowAnyAuthor: true` or requesting community access is rejected when the server is in default mode.
4. **Unconditional Bot Rejection:** In `actionProcessor.ts`:
   ```ts
   const isBotAuthor =
     item.authorId === 41898282 ||
     (typeof item.authorLogin === 'string' && item.authorLogin.toLowerCase().endsWith('[bot]'));
   ```
   Even when `allowAnyAuthor === true`, bots (including `github-actions[bot]`, database ID `41898282`, or any login matching `*[bot]`) are unconditionally rejected (Tests `SEC-07` and `SEC-08`).
5. **Numeric Author ID Validation:** `hasValidAuthorId` requires `typeof authorId === 'number'`, integer, and `authorId > 0`. Non-numeric or non-positive IDs fail closed (Tests `SEC-09` and `SEC-10`).
6. **Consistent Enforcement:** The same authorization logic applies identically whether processing is triggered by an `issues.opened` event or by the hourly scheduled inbox drainage sweep.

---

## 6. Workflow and Repository Audit

All workflow files in `.github/workflows/` were audited:
- `.github/workflows/pet-baseline.yml`
- `.github/workflows/pet-publisher.yml`
- `.github/workflows/pet-interaction.yml`
- `.github/workflows/diagnostics-contribution-probe.yml`

### Audit Findings:
1. **No Hardcoded Maintainer Identity:** All hardcoded references to `mnp210` were removed in R3.21. All identity resolution relies dynamically on `${{ github.repository_owner }}`, `${{ github.repository_owner_id }}`, `${{ github.actor }}`, `${{ github.actor_id }}`, or repository variables (`vars.PET_OWNER_LOGIN`, `vars.PET_ADMIN_LOGIN`).
2. **Repository-Scoped Concurrency:** All runtime workflows share `concurrency: group: pet-runtime-${{ github.repository }}` with `cancel-in-progress: false`. The diagnostic probe uses `concurrency: group: pet-diagnostics-${{ github.repository }}`. No cross-repository collisions can occur.
3. **Restricted Workflow Permissions:**
   - `pet-baseline.yml`: `contents: write`
   - `pet-publisher.yml`: `contents: write`
   - `pet-interaction.yml`: `contents: write`, `issues: write`
   - `diagnostics-contribution-probe.yml`: `contents: read`
4. **Trigger Safety:**
   - Baseline initialization is strictly manual (`workflow_dispatch` only) with required string confirmation.
   - Publisher triggers on hourly schedule (`cron: '47 * * * *'`) and manual dispatch.
   - Interaction triggers on hourly schedule, `issues: types: [opened]`, and manual dispatch.

---

## 7. Regression Verification & Quality Gates

### 7.1 Test Suite Breakdown & Deduplication
To prevent double-counting of tests, the test counts across test entry points are explicitly clarified:

- **`tests/pet-engine/*.test.ts` (Full Pet Engine Suite):**
  - **41 test suites** executed
  - **524 total individual tests** executed, **524 passed**, **0 failed**
  - **Deduplication Clarification:** The **42 dedicated security and portability tests** in `tests/pet-engine/releasePortabilityAndSecurity.test.ts` **ARE INCLUDED** within this 524 test total (482 engine tests + 42 security/portability tests = 524 total tests).
- **`tests/unit/*.test.ts` (Unit Test Suite):**
  - **24 test suites** executed
  - **121 total individual tests** executed, **121 passed**, **0 failed**
- **Combined Test Verification:** 524 + 121 = **645 distinct automated tests** across 65 suites passing with zero failures.

### 7.2 Execution Logs & Exit Codes

| Command | Working Directory | Exit Code | Suites | Tests Run | Result |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `npm run test:pet-engine` | `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` | **0** | 41 | 524 | **PASS** |
| `npm test` | `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` | **0** | 24 | 121 | **PASS** |
| `npx tsc --noEmit` | `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` | **0** | — | — | **0 Errors** |
| `npm run lint` | `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` | **0** | — | — | **0 Errors, 0 Warnings** |

*(Note: Unit and engine tests use isolated mock fixtures. Mock pass results verify internal engine invariants and state machine transitions; they do not represent real-time integration with external GitHub servers).*

---

## 8. Production Containment Evidence

Production repository `mnp210/GitHub-Profile-Pet` remains strictly contained:
- **Remote HEAD:** Confirmed at `f838b3bb3291fdfd99c981985632b6e0d7191322` via `git ls-remote origin main`.
- **Production Mutations:** 0 commits, 0 branch pushes, 0 tags created.
- **Workflow Dispatches:** Baseline workflow `422923344` was **never dispatched** (lifetime runs remain 0).
- **Issue Creation:** 0 production issues created.
- **Production Files:** `pet/state/pet.json`, `pet/ledger/contributions.json`, `pet/ledger/actions.json`, and `public/pet.svg` remain 100% untouched.

---

## 9. Remaining Operational Limitations

1. **Two-UTC-Calendar-Day Contribution Boundary:** In the event of an extended offline outage lasting > 48 hours, contributions older than two calendar days are not recovered into pet XP. This is an intentional architectural boundary to bound GraphQL query payload size and prevent rate-limit exhaustion.
2. **GitHub Actions Scheduling Jitter:** Scheduled workflows run on a shared, best-effort queue and may experience scheduling delays or jitter during peak platform load.
3. **Organization Collaborator Permission API Limitation:** Default `GITHUB_TOKEN` cannot query `GET /repos/{owner}/{repo}/collaborators/{username}/permission` (returns HTTP 403). Therefore, organization repositories must use **Mechanism A (`vars.PET_ADMIN_DATABASE_ID` / `vars.PET_ADMIN_LOGIN`)** as their supported administrator authorization method.

---

## 10. Final Candidate Git Status & Diff Summary

### 10.1 Working Tree Status (`git status --short`)
```
 M .github/workflows/diagnostics-contribution-probe.yml
 M .github/workflows/pet-baseline.yml
 M .github/workflows/pet-interaction.yml
 M .github/workflows/pet-publisher.yml
 M README.md
 M docs/operations/contribution-baseline-procedure.md
 M docs/operations/production-launch-checklist.md
 M docs/operations/production-runtime-runbook.md
 M docs/operations/recovery-and-rollback.md
 M scripts/establish-baseline.ts
 M scripts/process-inbox.ts
 M scripts/publish-pipeline.ts
 M src/features/pet-engine/contribution/identityResolver.ts
 M src/features/pet-engine/contribution/index.ts
 M src/features/pet-engine/inbox/actionProcessor.ts
 M src/features/pet-engine/publication/baselinePipeline.ts
 M src/features/pet-engine/publication/inboxPublicationPipeline.ts
 M src/features/pet-engine/publication/publishPipeline.ts
 M tests/pet-engine/baselineGuard.test.ts
?? pet/templates/
?? reports/phase_3c2_3_b2_r3_18_production_soak_monitoring.md
?? reports/phase_3c2_3_b2_r3_19_isolated_interaction_e2e_verification.md
?? reports/phase_3c2_3_b2_r3_21_portability_authorization_implementation.md
?? reports/phase_3c2_3_b2_r3_22_security_hardening_and_portability_corrections.md
?? reports/phase_3c2_3_b2_r3_23_final_candidate_audit.md
?? src/features/pet-engine/contribution/adminAuthorization.ts
?? src/features/pet-engine/validation/index.ts
?? src/features/pet-engine/validation/pristineStateValidator.ts
?? tests/pet-engine/releasePortabilityAndSecurity.test.ts
```

### 10.2 Cumulative Diff Summary (`git diff --stat`)
```
 .../workflows/diagnostics-contribution-probe.yml   |   2 +
 .github/workflows/pet-baseline.yml                 |  46 +++--
 .github/workflows/pet-interaction.yml              |   4 +
 .github/workflows/pet-publisher.yml                |   6 +-
 README.md                                          | 208 ++++++++++++++++-----
 docs/operations/contribution-baseline-procedure.md |   8 +-
 docs/operations/production-launch-checklist.md     |  10 +-
 docs/operations/production-runtime-runbook.md      |   2 +-
 docs/operations/recovery-and-rollback.md           |   2 +-
 scripts/establish-baseline.ts                      |  24 ++-
 scripts/process-inbox.ts                           |  29 +++
 scripts/publish-pipeline.ts                        |  31 ++-
 .../pet-engine/contribution/identityResolver.ts    | 134 +++++++++++++
 src/features/pet-engine/contribution/index.ts      |   1 +
 src/features/pet-engine/inbox/actionProcessor.ts   |  29 ++-
 .../pet-engine/publication/baselinePipeline.ts     | 145 ++++++++++++--
 .../publication/inboxPublicationPipeline.ts        |  16 +-
 .../pet-engine/publication/publishPipeline.ts      |  25 ++-
 tests/pet-engine/baselineGuard.test.ts             |   4 +
 19 files changed, 613 insertions(+), 113 deletions(-)
```

---

## 11. Final Verdict

# `PASS — READY FOR CANDIDATE COMMIT REVIEW`

All identified defects across R3.20, R3.21, and R3.22 have been fully remediated, verified, and documented. The codebase is clean, tested with 100% pass rates, and architecturally portable for independent installations.

**This milestone completes the candidate audit. No git commits, pushes, merges, or production releases have been performed.** The candidate workspace is now halted in readiness for repository owner commit authorization.
