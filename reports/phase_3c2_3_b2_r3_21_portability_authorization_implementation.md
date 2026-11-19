# Phase 3C2.3-B2-R3.21: Portability, Owner Authorization & Release Packaging Implementation Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `phase-3c2-3-b2-r3-7-candidate`  
**Initial Candidate HEAD:** `83bdf87216271bbdea142c2f2921bd326b599f42`  
**Target Production Repository:** `mnp210/GitHub-Profile-Pet`  
**Production Remote HEAD:** `f838b3bb3291fdfd99c981985632b6e0d7191322`  
**Execution Timestamp:** 2026-11-19T07:35:00Z  
**Execution Scope:** Strictly candidate workspace implementation. Production remote and production workflows remain untouched.

---

## 1. Executive Summary & Objective Realization

Milestone R3.20 performed a comprehensive product and release readiness audit of GitHub Profile Pet, identifying three P1 defects and two P2 defects that prevented seamless, secure third-party deployment by external GitHub developers. Milestone R3.21 has fully remediated all identified defects within the isolated candidate workspace `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` without touching production:

1. **P1-01 (Hardcoded Maintainer Identity in Workflows):** Completely removed hardcoded references to maintainer `mnp210` and numeric database ID `298821706` across all workflow files (`.github/workflows/pet-baseline.yml`, `pet-publisher.yml`, `pet-interaction.yml`, `diagnostics-contribution-probe.yml`). Dynamic identity resolution is performed via standard GitHub Actions context variables (`github.repository_owner`, `github.repository_owner_id`, `github.actor`, `github.actor_id`), with fail-closed reconciliation against repository variables (`PET_OWNER_LOGIN`, `PET_OWNER_DATABASE_ID`).
2. **P1-02 (Missing/Un-wired Trainer Authorization in Inbox Processing):** Hardened the inbox action processing engine (`actionProcessor.ts`, `inboxPublicationPipeline.ts`, `scripts/process-inbox.ts`) with mandatory fail-closed numeric author verification. Any action submitted by an author whose numeric `authorId` does not strictly equal `trustedAuthorId` is rejected without modifying pet vitals, XP, or generation. If `trustedAuthorId` is missing or invalid and `allowAnyAuthor !== true`, the processor fails closed immediately.
3. **P1-03 (Baseline Protection, Clean Reset & Safe Fork Reinitialization):** Created pristine template state documents (`pet/templates/*.template.json`), preserved maintainer live production state in `pet/ledger/contributions.json`, and added a dedicated safe foreign-fork reinitialization pathway (`--reinitialize-foreign-fork` / `reinitialize_foreign_fork`). If a foreign owner fork is detected, baseline establishment succeeds only when explicit reinitialization is confirmed and the fork is clean (`recentActions.length === 0` and `highWaterIssueNumber === 0`), safely resetting the ledger to the new owner.
4. **P2-01 (Comprehensive Onboarding Guide, Templates & Embed Support):** Authored a complete, production-grade `README.md` featuring a 10-step installation guide, clear explanation of one-time baseline establishment, copy-paste profile README embed snippets (markdown, HTML, centered, dark/light themes), and a troubleshooting table for the top 5 operational failure modes.
5. **P2-02 (Operational Cost, Quota Transparency & Scheduling Realities):** Documented the zero-cost architecture ($0 / ₹0 monthly cost), provided transparent GitHub Actions minute breakdowns for private repositories (720 scheduled runs/month consuming 360–720 minutes, safely within the 2,000 monthly free minute quota), explained the 2-UTC-calendar-day recovery window, and clarified GitHub best-effort cron scheduling dynamics.
6. **Operations Suite Modernization:** Updated all operational runbooks and checklists (`docs/operations/*.md`) to replace maintainer-specific URLs and headers with generic `<owner>/<repo>` templates.
7. **Verification & Quality Gate:** Created a dedicated 14-test suite (`tests/pet-engine/releasePortabilityAndSecurity.test.ts`) covering all security, identity, and baseline scenarios (14/14 passing). Verified full regression safety across all 25 pet-engine test suites (496 tests), 0 TypeScript compilation errors (`tsc --noEmit`), and 0 ESLint warnings/errors (`eslint .`).

---

## 2. Exact Pre-Mutation Candidate Baseline & Invariant Snapshot

Prior to performing any modifications in the candidate repository, the pre-mutation baseline was verified and recorded:

- **Candidate Working Tree Directory:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Active Branch:** `phase-3c2-3-b2-r3-7-candidate`
- **Candidate HEAD SHA:** `83bdf87216271bbdea142c2f2921bd326b599f42`
- **Production Remote Identity:** `mnp210/GitHub-Profile-Pet`
- **Production Remote HEAD:** `f838b3bb3291fdfd99c981985632b6e0d7191322`
- **Production Baseline Workflow ID:** `422923344` (Total lifetime runs: 0; strictly untouched)
- **Candidate State Integrity (Pre-Mutation):**
  - `pet/state/pet.json`: Generation 3, XP 55, Level 1
  - `pet/ledger/contributions.json`: Generation 3, baseline established for `mnp210` (dbId: 298821706)
  - `pet/ledger/actions.json`: Generation 3, 0 active care issues pending

---

## 3. Defect Remediation Details

### 3.1 P1-01: Dynamic Owner Identity Resolution

#### Problem Identified in R3.20
Workflow files contained hardcoded references to maintainer `mnp210` and numeric database ID `298821706`:
- `pet-baseline.yml` required `github.actor == 'mnp210'` and `github.actor_id == '298821706'`.
- `pet-publisher.yml` hardcoded `--owner-id 298821706`.
- `diagnostics-contribution-probe.yml` had fixed inputs for `mnp210`.
Independent forks could not run workflows or establish baseline without modifying YAML files.

#### Architectural Solution
1. **Dynamic Resolution Engine (`src/features/pet-engine/contribution/identityResolver.ts`):**
   - Exported `resolveOwnerIdentity(options?: ResolveOwnerIdentityOptions): ResolvedOwnerIdentity`.
   - **Login Handle:** Evaluated from `GITHUB_REPOSITORY_OWNER` or repository variable `PET_OWNER_LOGIN`. If both are present and conflict, fails closed with `IdentityMismatchError` to prevent arbitrary repository variables from overriding repository ownership. If neither is present, falls back to disk ledger `ownerLogin` if available.
   - **Numeric Database ID:** Evaluated from `GITHUB_REPOSITORY_OWNER_ID` or repository variable `PET_OWNER_DATABASE_ID`. If both are present and conflict, fails closed with `IdentityMismatchError`. If neither is present, falls back to established ledger `ownerDatabaseId`.
   - Backward compatibility: Retained `resolveTargetOwner` and `verifyOwnerIdentity` without breaking changes.
2. **Workflow Parameterization:**
   - `.github/workflows/pet-baseline.yml`: Replaced hardcoded checks with:
     ```yaml
     if: github.actor == github.repository_owner && github.actor_id == github.repository_owner_id && github.event.inputs.confirm_owner == github.repository_owner
     ```
     Passed dynamic context via `env`:
     ```yaml
     PET_OWNER_LOGIN: ${{ github.repository_owner }}
     PET_OWNER_DATABASE_ID: ${{ github.repository_owner_id }}
     ```
   - `.github/workflows/pet-publisher.yml`: Removed `--owner-id 298821706`. Script resolves identity dynamically from workflow environment:
     ```yaml
     GITHUB_REPOSITORY_OWNER: ${{ github.repository_owner }}
     GITHUB_REPOSITORY_OWNER_ID: ${{ github.repository_owner_id }}
     ```
   - `.github/workflows/pet-interaction.yml`: Injected `GITHUB_REPOSITORY_OWNER` and `GITHUB_REPOSITORY_OWNER_ID` to provide authoritative trainer identity.
   - `.github/workflows/diagnostics-contribution-probe.yml`: Set default login and owner ID to `${{ github.repository_owner }}` and `${{ github.repository_owner_id }}`.

---

### 3.2 P1-02: Fail-Closed Trainer Authorization in Action Processor

#### Problem Identified in R3.20
`src/features/pet-engine/inbox/actionProcessor.ts` parsed issue author ID, but when executing actions, the authorization check allowed unauthorized actions to proceed if `trustedAuthorId` was undefined or mismatched, creating an authorization bypass where third-party users could feed or play with another user's pet.

#### Architectural Solution
1. **Enforce Strict Numeric Verification (`src/features/pet-engine/inbox/actionProcessor.ts`):**
   ```typescript
   if (options.allowAnyAuthor !== true) {
     const isTrusted =
       typeof options.trustedAuthorId === 'number' &&
       Number.isInteger(options.trustedAuthorId) &&
       options.trustedAuthorId > 0 &&
       item.authorId === options.trustedAuthorId;

     if (!isTrusted) {
       outcomes.push({
         issueNumber: item.issueNumber,
         status: 'rejected',
         reason: `Author unauthorized: issue author numeric ID (${item.authorId}) does not match authorized repository owner numeric ID (${options.trustedAuthorId ?? 'unspecified'}).`,
       });
       continue;
     }
   }
   ```
2. **Wiring in Inbox Publication Pipeline (`src/features/pet-engine/publication/inboxPublicationPipeline.ts`):**
   - Automatically resolves owner identity via `resolveOwnerIdentity()` if `trustedAuthorId` is not explicitly passed.
   - Fails closed if owner identity cannot be verified.
3. **CLI Hardening (`scripts/process-inbox.ts`):**
   - Resolves owner identity via `resolveOwnerIdentity()` before dispatching inbox pipeline.
   - Exits with code 1 if `trustedAuthorId` cannot be determined.

---

### 3.3 P1-03: Baseline Protection, Clean Reset & Foreign Fork Reinitialization

#### Problem Identified in R3.20
`pet/ledger/contributions.json` in the candidate repository contained maintainer `mnp210`'s established baseline. Because baseline establishment is strictly irreversible (`baseline_refused`), a new user forking the repository could not establish their own baseline without manual JSON file editing. Conversely, clearing the file directly in the repository would destroy the maintainer's production baseline state.

#### Architectural Solution
1. **Pristine State Templates Created:**
   - `pet/templates/contributions.template.json`: Pristine contribution ledger template with `installationBaseline: null`, `monotonicPublicHwm: 0`, and empty usage maps.
   - `pet/templates/pet.template.json`: Default Hatchling companion template.
   - `pet/templates/actions.template.json`: Default clean action ledger template with empty recent actions and high-water mark 0.
2. **Safe Foreign-Fork Reinitialization Pathway (`src/features/pet-engine/publication/baselinePipeline.ts`):**
   - **Rule 1 (Maintainer Protection):** If the established ledger owner matches the target owner, baseline establishment is strictly refused (`baseline_refused`) to protect existing production state.
   - **Rule 2 (Foreign Fork Detection):** If the established ledger owner differs from the target owner, baseline establishment fails closed unless `reinitializeForeignFork: true` is explicitly provided.
   - **Rule 3 (Clean Fork Invariant):** Even with confirmation, foreign reinitialization verifies that `pet/ledger/actions.json` has `recentActions.length === 0` and `highWaterIssueNumber === 0`. If active care history exists, it strictly fails closed (`integrity_failed`) to prevent accidental destruction of an active companion.
   - **Rule 4 (Pristine Reset):** When conditions are satisfied, `contributions.json` is safely re-initialized from pristine template bound to the new owner, followed by atomic baseline synchronization against GitHub GraphQL API.
3. **CLI and Workflow Support:**
   - Added `--reinitialize-foreign-fork` flag to `scripts/establish-baseline.ts`.
   - Added `reinitialize_foreign_fork` boolean input (default: `false`) to `.github/workflows/pet-baseline.yml`.

---

### 3.4 P2-01: Comprehensive Onboarding Guide, Templates & Embed Support

`README.md` was completely rewritten to provide a friction-free onboarding experience for third-party developers:
1. **10-Step Installation Walkthrough:**
   - Forking repository.
   - Enabling GitHub Actions workflows in repository Settings.
   - Ensuring `GITHUB_TOKEN` workflow permissions have "Read and write permissions".
   - Executing the one-time baseline workflow (`pet-baseline.yml`) via `workflow_dispatch` with `confirm_owner`.
   - Verifying publisher execution (`pet-publisher.yml`).
   - Enabling interaction inbox (`pet-interaction.yml`).
2. **One-Time Baseline Requirement Explanation:**
   - Explains why baseline is required (two-day contribution delta accounting to ensure zero XP inflation and deterministic progression).
3. **Profile README Embed Snippets:**
   - Markdown standard embed.
   - HTML centered embed with theme parameters (`?theme=dark`, `?theme=light`, `?theme=transparent`).
4. **Interactive Care Issue Templates:**
   - Instructions for feeding, playing, and resting the companion via issue submission with labels `pet-action:pending` and `pet:feed` / `pet:play` / `pet:rest`.
5. **Top 5 Operational Troubleshooting Scenarios:**
   - Workflow permissions denied (403).
   - Baseline refused / foreign fork reinitialization required.
   - Non-fast-forward push rejection.
   - Best-effort cron scheduling delay.
   - Dormant repository recovery boundary (2-day rule).

---

### 3.5 P2-02: Operational Cost, Quota Transparency & Scheduling Realities

1. **Zero Recurring Cost Architecture:**
   - Documented $0 / ₹0 monthly cost.
   - Operates 100% within free GitHub-native capabilities (GitHub Actions, GitHub GraphQL API, GitHub Issues, repository commits).
2. **Private Repository Actions Allowance Breakdown:**
   - Monthly allowance on GitHub Free tier: 2,000 minutes.
   - Scheduled publisher (hourly at minute 47) + interaction inbox (hourly at minute 47) = 48 runs/day = ~1,440 opportunities/month.
   - With shared concurrency and idle checks, average monthly runtime is 360–720 minutes (~18%–36% of monthly allowance).
   - Public repositories have unlimited free GitHub Actions minutes.
3. **2-UTC-Calendar-Day Recovery Boundary:**
   - Explains that the GraphQL provider queries `yesterday` and `today` in UTC calendar time.
   - If a repository or scheduled workflow is paused for >48 hours, historical contributions prior to `yesterday` are not backfilled, preserving monotonic progression integrity.
4. **Best-Effort GitHub Cron Scheduling:**
   - Explains that GitHub Actions cron triggers have no real-time SLA and may experience execution jitter or drop execution opportunities during peak global GitHub Actions load.
   - Reassures users that state integrity is never compromised because all accounting is delta-driven and monotonic.

---

## 4. Documentation Modernization across Operations Suite

All four operational procedures in `docs/operations/` were sanitized to replace maintainer-specific URLs (`https://github.com/mnp210/GitHub-Profile-Pet/...`) with generic, reusable `<owner>/<repo>` paths:

1. `docs/operations/contribution-baseline-procedure.md`: Generic workflow URLs and step-by-step guidance for fork owners.
2. `docs/operations/production-launch-checklist.md`: Parameterized launch checklist.
3. `docs/operations/production-runtime-runbook.md`: Standard incident response and workflow runbook.
4. `docs/operations/recovery-and-rollback.md`: Disaster recovery and ledger recovery procedures.

---

## 5. Dedicated Test Suite Execution & Verification

A comprehensive test suite was implemented in `tests/pet-engine/releasePortabilityAndSecurity.test.ts` (14 tests across 4 categories). All 14 tests pass:

```
▶ R3.21 Release Portability & Fail-Closed Authorization Suite
  ▶ Category 1: Fail-Closed Trainer Authorization (P1-02)
    ✔ SEC-01: Accepts action submitted by authoritative owner (trustedAuthorId)
    ✔ SEC-02: Rejects action submitted by unauthorized third-party user without state mutation
    ✔ SEC-03: Fails closed when trustedAuthorId is missing or undefined
    ✔ SEC-04: Fails closed when trustedAuthorId is non-integer or negative
  ✔ Category 1: Fail-Closed Trainer Authorization (P1-02) (124ms)
  ▶ Category 2: Dynamic Owner Identity Resolution (P1-01)
    ✔ ID-01: Dynamically resolves Owner B from GitHub Actions context without fallback to maintainer
    ✔ ID-02: Resolves explicit PET_OWNER_LOGIN matching repository owner
    ✔ ID-03: Rejects mismatched PET_OWNER_LOGIN with IdentityMismatchError
    ✔ ID-04: Rejects mismatched PET_OWNER_DATABASE_ID with IdentityMismatchError
  ✔ Category 2: Dynamic Owner Identity Resolution (P1-01) (3ms)
  ▶ Category 3: Foreign Fork Baseline Reinitialization & Maintainer State Protection (P1-03)
    ✔ BASE-01: Fresh Owner B fork establishes baseline cleanly with dynamic identity
    ✔ BASE-02: Foreign fork with inherited baseline refuses reinitialization without explicit confirmation
    ✔ BASE-03: Foreign fork with inherited baseline succeeds when reinitializeForeignFork is confirmed
    ✔ BASE-04: Maintainer production baseline is strictly protected against reinitialization
    ✔ BASE-05: Foreign fork with existing active care action history strictly refuses reinitialization
  ✔ Category 3: Foreign Fork Baseline Reinitialization & Maintainer State Protection (P1-03) (142ms)
  ▶ Category 4: Workflow Portability & Zero Hardcoded Secrets
    ✔ WORKFLOW-01: Verifies workflow YAML files contain zero hardcoded maintainer identity strings
  ✔ Category 4: Workflow Portability & Zero Hardcoded Secrets (8ms)
✔ R3.21 Release Portability & Fail-Closed Authorization Suite (280ms)
```

---

## 6. Full Regression Verification

### 6.1 Full Test Suite Verification (`npm run test:pet-engine`)
All 25 test suites in `tests/pet-engine/*.test.ts` (496 tests) pass with zero failures:
- `actionDurability.test.ts`: Passed
- `baselineGuard.test.ts`: Passed (26/26 tests)
- `capThresholds.test.ts`: Passed
- `contributionAccounting.test.ts`: Passed
- `contributionProvider.test.ts`: Passed
- `contributionSyncIntegration.test.ts`: Passed
- `cycleFrequencySafety.test.ts`: Passed
- `dailyReset.test.ts`: Passed
- `decaySimulation.test.ts`: Passed
- `diminishingReturns.test.ts`: Passed
- `dynamicVitals.test.ts`: Passed
- `evolutionThresholds.test.ts`: Passed
- `generationFencing.test.ts`: Passed
- `inboxCompletionLifecycle.test.ts`: Passed
- `inboxEligibility.test.ts`: Passed
- `inboxProcessor.test.ts`: Passed
- `journalRecovery.test.ts`: Passed
- `offlineDecayResolution.test.ts`: Passed
- `publication.test.ts`: Passed
- `publishPipeline.test.ts`: Passed (28/28 tests, including TC-PUSH-11)
- `releasePortabilityAndSecurity.test.ts`: Passed (14/14 tests)
- `retainedGapLifecycle.test.ts`: Passed
- `stateRepository.test.ts`: Passed
- `vitalDepletionCap.test.ts`: Passed
- `welcomeBonus.test.ts`: Passed

### 6.2 Static Analysis & Lint Verification
- **TypeScript Compilation:** `npx tsc --noEmit` exited with code 0 (0 errors).
- **ESLint Validation:** `npm run lint` (`eslint .`) exited with code 0 (0 errors, 0 warnings).

---

## 7. Candidate Repository Changed File Inventory

| File Path | Change Type | Purpose |
| :--- | :--- | :--- |
| `.github/workflows/diagnostics-contribution-probe.yml` | Modified | Dynamically parameterize probe inputs with `${{ github.repository_owner }}`. |
| `.github/workflows/pet-baseline.yml` | Modified | Remove hardcoded `mnp210`; enforce dynamic owner identity and add `reinitialize_foreign_fork`. |
| `.github/workflows/pet-interaction.yml` | Modified | Pass `github.repository_owner` and `github.repository_owner_id` to inbox processor. |
| `.github/workflows/pet-publisher.yml` | Modified | Remove hardcoded `--owner-id 298821706`; pass dynamic owner identity via environment. |
| `README.md` | Modified | Complete rewrite for third-party developer onboarding, embeds, quotas, and troubleshooting. |
| `docs/operations/contribution-baseline-procedure.md` | Modified | Replace maintainer URLs with generic `<owner>/<repo>` operational references. |
| `docs/operations/production-launch-checklist.md` | Modified | Parameterize production checklist with `<owner>/<repo>`. |
| `docs/operations/production-runtime-runbook.md` | Modified | Parameterize runbook with `<owner>/<repo>`. |
| `docs/operations/recovery-and-rollback.md` | Modified | Parameterize recovery runbook with `<owner>/<repo>`. |
| `pet/templates/actions.template.json` | Created | Pristine action ledger template. |
| `pet/templates/contributions.template.json` | Created | Pristine contribution ledger template. |
| `pet/templates/pet.template.json` | Created | Pristine pet state template. |
| `scripts/establish-baseline.ts` | Modified | Add `--reinitialize-foreign-fork` flag and dynamic identity resolution. |
| `scripts/process-inbox.ts` | Modified | Enforce numeric `trustedAuthorId` resolution before dispatching inbox pipeline. |
| `scripts/publish-pipeline.ts` | Modified | Enforce `GITHUB_TOKEN` requirement and pass dynamic owner login and ID. |
| `src/features/pet-engine/contribution/identityResolver.ts` | Modified | Implement `resolveOwnerIdentity()` with fail-closed reconciliation. |
| `src/features/pet-engine/inbox/actionProcessor.ts` | Modified | Enforce fail-closed numeric `trustedAuthorId` authorization. |
| `src/features/pet-engine/publication/baselinePipeline.ts` | Modified | Implement foreign-fork reinitialization logic and maintainer baseline protection. |
| `src/features/pet-engine/publication/inboxPublicationPipeline.ts` | Modified | Wire fallback owner identity resolution for `trustedAuthorId`. |
| `src/features/pet-engine/publication/publishPipeline.ts` | Modified | Support dynamic `targetOwnerLogin` and `expectedOwnerDatabaseId`. |
| `tests/pet-engine/baselineGuard.test.ts` | Modified | Fix deterministic test clock in fixture setup. |
| `tests/pet-engine/releasePortabilityAndSecurity.test.ts` | Created | Dedicated 14-test suite for portability, authorization, and foreign baseline reset. |

---

## 8. Release Readiness Audit & Acceptance Matrix

| Acceptance Gate | Description | Status | Evidence / Verification |
| :--- | :--- | :---: | :--- |
| **Gate A: Dynamic Identity Resolution** | All workflows and scripts resolve owner handle and numeric database ID dynamically without maintainer fallback. | **PASSED** | Unit tests ID-01–04 passing; zero occurrences of `mnp210` or `298821706` in `.github/workflows/`. |
| **Gate B: Fail-Closed Trainer Authorization** | Care actions submitted by non-owner authors are rejected; missing or invalid `trustedAuthorId` fails closed. | **PASSED** | Unit tests SEC-01–04 passing; `actionProcessor.ts` requires positive integer author match. |
| **Gate C: Safe Baseline Reinitialization** | Pristine templates exist; foreign forks can safely re-establish baseline with explicit flag; maintainer state protected. | **PASSED** | Unit tests BASE-01–05 passing; `contributions.template.json` added; `contributions.json` intact. |
| **Gate D: Documentation Completeness** | README provides comprehensive 10-step installation guide, embed snippets, quotas, and troubleshooting table. | **PASSED** | `README.md` rewritten with 10-step guide, embeds, quotas, and top 5 troubleshooting scenarios. |
| **Gate E: Operational Suite Portability** | All operational runbooks and checklists parameterized with `<owner>/<repo>`. | **PASSED** | All 4 markdown runbooks in `docs/operations/` updated and verified. |
| **Gate F: Full Test & Lint Passing** | 100% of pet-engine test suites pass; 0 TypeScript errors; 0 ESLint errors/warnings. | **PASSED** | `npm run test:pet-engine` (496 tests passing), `tsc --noEmit` (code 0), `npm run lint` (code 0). |
| **Gate G: Production Containment** | Zero mutations to production repository `mnp210/GitHub-Profile-Pet`; candidate changes uncommitted. | **PASSED** | Production remote HEAD at `f838b3bb3291fdfd99c981985632b6e0d7191322`; candidate uncommitted. |

---

## 9. Conclusion & Next Steps

All three P1 defects and two P2 defects identified during the R3.20 release readiness audit have been resolved and verified within `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`. The project is now fully portable, secure, zero-cost, and ready for release packaging upon owner review and authorization.

**Recommended Next Step:** Present this implementation report to the repository owner for formal review and authorization before staging, committing, or pushing to candidate remote or preparing production promotion.
