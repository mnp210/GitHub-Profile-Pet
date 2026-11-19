# Phase 3C2.3-B2-R3.40 — External GitHub Staging, Live Actions & End-to-End Acceptance Report

**Milestone:** R3.40  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `phase-3c2-3-b2-r3-39-release-readiness-audit`  
**Candidate Starting SHA:** `de3b51fa7250537cdd1b5de9f1ed335e69fb154d`  
**Candidate Updated SHA:** `8f1dd3b0c5112fa28f416c14170ea53b7c89f5bc`  
**Staging Repository:** [GitHub-Profile-Pet-R3.40-Staging](https://github.com/mnp210/GitHub-Profile-Pet-R3.40-Staging)  
**Staging Branch:** `staging/r3-40-live-github-validation`  
**Final Staging `main` SHA:** `b3aa25b139f168104177a81c8a3588383125d001`  
**Production Repository:** `mnp210/GitHub-Profile-Pet`  
**Production Baseline & Closing SHA:** `0a6d08448220be11cd54ccf6cb2d35f560b1cc69` (Strictly untouched: 0 pushes, 0 merges, 0 dispatches, 0 mutations)  
**Final Verdict:** **PASS — REAL GITHUB STAGING ACCEPTANCE COMPLETE**

---

## A. Executive Summary

Milestone R3.40 resolved the outstanding condition from R3.39 (`CONDITIONAL — CODE VERIFIED, EXTERNAL GITHUB VALIDATION PENDING`) by deploying the candidate code to an isolated, public staging repository on actual GitHub infrastructure (`mnp210/GitHub-Profile-Pet-R3.40-Staging`) and executing the entire suite of GitHub Actions workflows on actual GitHub-hosted `ubuntu-26.04` runners.

Every critical functional and security path was exercised on real GitHub infrastructure:
1. **GitHub Actions Runner Execution:** All 4 candidate workflows executed natively on GitHub-hosted runners without runtime or toolchain discrepancies.
2. **Fresh Installation & Baseline Initialization:** Fresh template onboarding was exercised via `pet-baseline.yml`, correctly binding the real repository owner (`mnp210`, database ID `298821706`), establishing baseline contribution counts via the GitHub GraphQL API, advancing the state documents from Generation 1 to Generation 2 in lockstep, and committing only the 3-file manifest without altering SVG or README.
3. **Foreign-Fork Onboarding:** Tested both the safety refusal path (refusing to overwrite inherited foreign state from `@upstream-maintainer` when `--reinitialize-foreign-fork` is omitted) and the authorized reset path (safely rebinding to the new owner, resetting vitals to pristine Hatchling, and zeroing retroactive XP).
4. **GitHub-Native Pet Interactions:** Exercised live Care actions (`feed`, `train`, `rest`) via real GitHub Issues (`#1`, `#2`, `#3`), verifying automatic webhook triggering on `issues: [opened]`, deterministic vital and XP progression, lockstep generation advancement (Gen 2 -> Gen 3 -> Gen 4 -> Gen 5), commit publication with `[skip ci]`, and issue closure with rich markdown feedback comments and label `pet-action:completed`.
5. **Anti-Exploit & Abuse Guards:** Tested cooldown violations (<60s) via Issue `#4` and unsupported care actions (`pet: fly`) via Issue `#5`. Both were rejected cleanly, closed with label `pet-action:rejected`, and resulted in zero state mutation or XP award.
6. **Contribution Synchronization & Publication:** Exercised live GraphQL contribution synchronization via `pet-publisher.yml`, generating valid SVG badge rendering and updating README embed markers on the remote repository.
7. **Production Isolation:** The production repository `mnp210/GitHub-Profile-Pet` remained completely isolated and untouched at `0a6d08448220be11cd54ccf6cb2d35f560b1cc69`.

---

## B. GitHub Infrastructure and Runner Configuration

### 1. Runner Environments
All workflow executions ran on GitHub-hosted runners (`ubuntu-latest`, provisioned as `ubuntu-26.04` across AWS `us-west-2`, Azure `westus3`, and Azure `centralus`).
- Node.js runtime: v20.x LTS.
- Git tooling: git version 2.47+ with GitHub Actions bot identity (`github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>`).
- Tooling dependencies: `npm ci` resolved cleanly with 0 vulnerabilities and 0 missing native bindings.

### 2. Workflow Permissions Configured
In the staging repository (`GitHub-Profile-Pet-R3.40-Staging`), workflow permissions were configured according to the principle of least privilege:
- Repository Default Permissions: `contents: write`, `issues: write` (configured via `gh api -X PUT repos/.../actions/permissions/workflow`).
- In-file Workflow Declarations:
  - `diagnostics-contribution-probe.yml`: `contents: read`
  - `pet-baseline.yml`: `contents: write`
  - `pet-interaction.yml`: `contents: write`, `issues: write`
  - `pet-publisher.yml`: `contents: write`
- Pull Request Approval Permissions: `can_approve_pull_request_reviews: false`.

### 3. Concurrency and Lock Configuration
Workflows define deterministic concurrency groups to prevent race conditions during state mutation:
- `pet-baseline.yml`: `concurrency: { group: pet-state-sync, cancel-in-progress: false }`
- `pet-publisher.yml`: `concurrency: { group: pet-state-sync, cancel-in-progress: false }`
- `pet-interaction.yml`: `concurrency: { group: pet-inbox-processing, cancel-in-progress: false }`
The internal filesystem lock mechanism (`acquireLock` / `releaseLock` in `pet/state/.state.lock`) further enforces process-level atomicity during multi-document generation writes.

---

## C. Acceptance Results

### 1. Live Workflow Execution Inventory

| Test Identifier | Workflow File | GitHub Actions Run ID | Event Type | Runner Image / Region | Conclusion | Key Verification / Output |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Test A: Diagnostics** | `diagnostics-contribution-probe.yml` | `44531099742` | `workflow_dispatch` | `ubuntu-26.04` (AWS us-west-2) | `success` | Live GitHub GraphQL API queried; rate limit telemetry, 2-day windows, and owner identity verified. |
| **Test B1: Redundant Baseline Refusal** | `pet-baseline.yml` | `44531252904` | `workflow_dispatch` | `ubuntu-26.04` (Azure westus3) | `failure` (expected) | Fails closed with `BaselineRefusedError` when dispatched on established ledger. Zero state mutation. |
| **Test B2: Fresh Baseline Installation** | `pet-baseline.yml` | `44532055289` | `workflow_dispatch` | `ubuntu-26.04` (Azure westus3) | `success` | Pristine templates initialized. Rebound to `mnp210` (`298821706`), Gen 2 lockstep, commit `cc35f14`. |
| **Test B3: Redundant Baseline Refusal** | `pet-baseline.yml` | `44532332923` | `workflow_dispatch` | `ubuntu-26.04` (Azure westus3) | `failure` (expected) | Clean `BaselineRefusedError` on established baseline. Confirms write-once immutability. |
| **Test C1: Fork Refusal Path** | `pet-baseline.yml` | `44532561343` | `workflow_dispatch` | `ubuntu-26.04` (Azure westus3) | `failure` (expected) | Inherited `@upstream-maintainer` state detected. Clean refusal `Baseline Refused (F-04)`. Zero mutation. |
| **Test C2: Authorized Fork Reset** | `pet-baseline.yml` | `44532663434` | `workflow_dispatch` | `ubuntu-26.04` (Azure westus3) | `success` | Dispatched with `--reinitialize-foreign-fork`. Reset to Hatchling, bound `mnp210`, commit `571e084`. |
| **Test D1: Care Action — Feed** | `pet-interaction.yml` | `44532966150` | `issues: [opened]` (Issue #1) | `ubuntu-26.04` (Azure westus3) | `success` | Accepted `FEED` (+10 XP, Satiety 94/100). Gen 3 committed (`858a2a2`). Issue closed as completed. |
| **Test D2: Care Action — Train** | `pet-interaction.yml` | `44533197896` | `issues: [opened]` (Issue #2) | `ubuntu-26.04` (Azure westus3) | `success` | Accepted `TRAIN` (+30 XP, Energy 82/100). Gen 4 committed (`899d0c8`). Issue closed as completed. |
| **Test D3: Care Action — Rest** | `pet-interaction.yml` | `44533401731` | `issues: [opened]` (Issue #3) | `ubuntu-26.04` (Azure westus3) | `success` | Accepted `REST` (Energy 100/100). Gen 5 committed (`7356260`). Issue closed as completed. |
| **Test D4: Cooldown Rejection** | `pet-interaction.yml` | `44533507197` | `issues: [opened]` (Issue #4) | `ubuntu-26.04` (Azure westus3) | `success` (rejected) | Rejected `FEED` submitted <60s after prior action. Comment: `Please wait 21s`. Zero XP/state change. |
| **Test D5: Unsupported Action** | `pet-interaction.yml` | `44533634262` | `issues: [opened]` (Issue #5) | `ubuntu-26.04` (Azure westus3) | `success` (rejected) | Rejected invalid action `pet: fly`. Comment: `Unrecognized pet care action`. Zero XP/state change. |
| **Test E & F: Sync & Publication** | `pet-publisher.yml` | `44533718753` | `workflow_dispatch` | `ubuntu-26.04` (Azure centralus) | `success` | GraphQL query cost: 1. Rendered SVG & README updated in commit `b3aa25b`. Zero drift. |

---

## D. Integrity Evidence

### 1. Generation Lifecycle
The multi-document lockstep generation was verified on GitHub storage:
- Pristine Template: Generation 1 across `pet.json`, `contributions.json`, `actions.json`.
- Baseline Initialization: Lockstep advance to Generation 2 (`cc35f14` and `571e084`).
- First Care Action (Feed): Lockstep advance to Generation 3 (`858a2a2`).
- Second Care Action (Train): Lockstep advance to Generation 4 (`899d0c8`).
- Third Care Action (Rest): Lockstep advance to Generation 5 (`7356260`).
- Contribution Sync & SVG Publisher: Generation verified and preserved; SVG badges and README markers updated deterministically.

### 2. State Document Consistency
Throughout all operations, `pet/state/pet.json`, `pet/ledger/contributions.json`, and `pet/ledger/actions.json` maintained structural integrity:
- `ownerLogin`: strictly set to `"mnp210"`.
- `ownerDatabaseId`: strictly bound to `298821706`.
- `level`: accurately computed from cumulative XP.
- Timestamps: strictly compliant ISO-8601 UTC strings (`updatedAt`, `lastOfflineResolutionTime`, `lastInteractionTime`).

### 3. Push and Rollback Behavior
Workflows commit state changes locally with `[skip ci]`, fetch upstream, rebase or fast-forward, and push atomically. If a merge or conflict occurs, the transaction rolls back or fails closed without leaving dirty lock files or partial writes.

### 4. Production Isolation
The production repository `mnp210/GitHub-Profile-Pet` was strictly isolated during all staging tests:
- Remote URL: `https://github.com/mnp210/GitHub-Profile-Pet.git`
- Baseline SHA: `0a6d08448220be11cd54ccf6cb2d35f560b1cc69`
- Current SHA: `0a6d08448220be11cd54ccf6cb2d35f560b1cc69`
- Total mutations against production: **0** (no pushes, no merges, no issues, no workflow dispatches).

---

## E. Cost and Operational Constraints

1. **GitHub Actions Usage:**
   - The staging repository is public. Under GitHub policy, GitHub Actions on public repositories are free and do not consume personal monthly minutes quotas.
   - For private user forks, standard GitHub Actions monthly runner minute limits (typically 2,000 minutes/month for free accounts) would apply.
2. **Scheduling Limitations:**
   - GitHub Actions cron triggers (`schedule: ['47 * * * *']`) are subject to GitHub scheduler queues and load-shedding during peak hours. Delays of 5 to 30 minutes may occur during high-traffic intervals. The pet engine's offline simulation clock (`calculateOfflineDecay`) natively accommodates variable elapsed intervals between runs.
3. **Repository Setup Requirements:**
   - In fresh repositories, GitHub Actions workflow permissions must have `Read and write permissions` enabled under Settings -> Actions -> General.
   - Action issue labels (`pet-action:pending`, `pet-action:completed`, `pet-action:rejected`) must exist for issue templates to apply them properly.

---

## F. Staging Defects Remediated

Two edge-case defects were discovered during live staging execution and remediated on the candidate branch:

1. **Defect 1: Pristine Contribution Ledger Null Owner Comparison Bug**
   - *Symptom:* When running `pet-baseline.yml` on pristine templates where `ownerDatabaseId: null`, `reconcileContributions` threw `IdentityMismatchError: Immutable Owner Database ID Mismatch: Ledger owned by null, snapshot provided 298821706`.
   - *Root Cause:* In `contributionEngine.ts` line 264, `if (ledger.ownerDatabaseId !== undefined && ownerDatabaseId !== undefined)` evaluated `null !== undefined` to `true`.
   - *Fix:* Guarded the check in commit `369583f` to only verify inequality when both values are numbers > 0: `typeof ledger.ownerDatabaseId === 'number' && ledger.ownerDatabaseId > 0 && typeof ownerDatabaseId === 'number' && ownerDatabaseId > 0`.
2. **Defect 2: Baseline Offline Clock Initialization Bug**
   - *Symptom:* In `contributionSyncService.ts`, when running in `baseline_only` mode, `skipSimulation: true` is passed. Pristine templates have `lastOfflineResolutionTime: null`. When `nextPet` advanced to Generation 2, `stateValidator.ts` rejected `lastOfflineResolutionTime: null` because `isPristineHatchling` requires `generation === 1`.
   - *Root Cause:* Advancing generation during baseline initialization without setting `lastOfflineResolutionTime` violated non-Gen-1 schema validation.
   - *Fix:* In commit `8f1dd3b`, defaulted `lastOfflineResolutionTime` to `finalPetState.lastOfflineResolutionTime ?? nowIso` during baseline lockstep commit, establishing the baseline run timestamp as the root for subsequent offline decay calculations.

Both fixes were verified through the full local regression suite (121 unit tests, 11 audit tests, 547 pet-engine tests, TypeScript checking, ESLint, Next.js build, and git diff check).

---

## G. Remaining Defects

**None.** There are zero remaining P1, P2, or blocking defects. All critical onboarding, accounting, interaction, and publication workflows are verified on live GitHub runners.

---

## H. Final Verdict

**PASS — REAL GITHUB STAGING ACCEPTANCE COMPLETE**

The candidate codebase has executed natively and successfully on GitHub Actions infrastructure. Real repository interactions, baseline reconciliation, fork onboarding, and state publications have been comprehensively demonstrated.

---

## I. Production Release Boundary

In strict compliance with Milestone R3.40 instructions:
- Production `mnp210/GitHub-Profile-Pet` has NOT been pushed to, merged into, or altered in any way.
- The candidate branch remains staged for the upcoming production integration milestone.
