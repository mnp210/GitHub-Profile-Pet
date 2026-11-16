# Phase 3A.1 — Runtime Scope & GitHub Operations Documentation Correction Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Milestone:** Phase 3A.1 (Runtime Scope & Documentation Corrections)  
**Status:** COMPLETED & FULLY VERIFIED  
**Date:** 2026-11-16  

---

## 1. Executive Summary & Objective

Phase 3A.1 is a targeted correction milestone resolving factual and scope inconsistencies identified during the Phase 3A review:

1. **Runtime Scope Verification:** Verified that the Phase 3A publication workflow (`pet-publisher.yml`), CLI (`publish-pet.ts`), and library modules (`src/features/pet-engine/publication/`) **strictly validate existing state and publish SVG/README artifacts without mutating pet state or executing passive simulation**. Decoupled gameplay simulation will be introduced in its separately authorized milestone.
2. **GitHub Operations Documentation Corrections:**
   - Corrected runner characterization: Public standard GitHub-hosted runners are free of minute charges, subject to GitHub's applicable usage limits, concurrency caps, and fair-use policies (never described as "unlimited").
   - Clarified private repository allowances (2,000 minutes/month on Free tier) and potential billing beyond included quotas.
   - Corrected the 60-day scheduled workflow inactivity rule: Re-enabling a disabled cron workflow requires the documented GitHub web UI controls or the workflow enable REST API; triggering `workflow_dispatch` does not automatically re-enable a suspended schedule.
   - Clarified event loop suppression: Pushes made with `GITHUB_TOKEN` ordinarily do not trigger push event workflows by platform design. The `[skip ci]` convention is retained as a secondary defense for external CI systems and git log readability.
3. **Schedule Optimization:** Shifted the six-hour cron schedule from minute zero (`0 */6 * * *`) to minute 23 (`23 */6 * * *`) to mitigate runner queue delays during top-of-the-hour platform load spikes.

---

## 2. Runtime Scope Verification & Audit

A comprehensive code inspection was performed on all Phase 3A execution paths:
- `.github/workflows/pet-publisher.yml`
- `scripts/publish-pet.ts`
- `src/features/pet-engine/publication/svgPublisher.ts`
- `src/features/pet-engine/publication/readmeEmbed.ts`
- `src/features/pet-engine/rendering/svgRenderer.ts`

### Findings:
1. **Zero State Mutation:** The publication pipeline reads `pet/state/pet.json`, validates its schema invariants via `assertValidPetState()`, renders the SVG, and writes the output. It does **not** call `applyInactivitySimulation()`, `applyExperience()`, or update vitals.
2. **Decoupled Simulation:** In Phase 3A, the publication pipeline treats `pet/state/pet.json` as read-only. Offline inactivity simulation and care transitions remain preserved in `src/features/pet-engine/transitions/` and will be orchestrated in subsequent milestones.
3. **Documentation Alignment:** Corrected documentation comments in `pet-publisher.yml`, `phase-3-github-actions-runtime.md`, and `phase_3a_github_actions_runtime_report.md` that previously conflated scheduled publication with passive vitals simulation.

---

## 3. GitHub Operations Documentation Corrections

### 3.1 Public Repository Runners
- **Correction:** Removed all references claiming public runners are "unlimited".
- **Factual Platform Architecture:** Standard GitHub-hosted Linux runners (2 vCPUs, 7 GB RAM) incur no per-minute billing on public repositories. However, they remain bounded by:
  - Account concurrency limits (maximum 20 concurrent jobs across all repositories on GitHub Free).
  - GitHub platform fair-use and acceptable use policies.
  - Platform capacity and queue latency during peak load.

### 3.2 Private Repository Allowances & Billing Ceilings
- **Correction:** Clearly documented that private repository executions draw from the account's monthly included minute quota (2,000 minutes/month on GitHub Free).
- **Billing Boundary:** Once the included allowance is exhausted:
  - If the user's spending limit is $0.00, subsequent workflow runs are blocked from starting.
  - If a positive spending limit is configured, runs incur standard GitHub Actions per-minute rates.
  - At ~122 billed minutes/month (4 runs/day × 30.5 days × 1 min minimum increment), Phase 3A consumes ~6.1% of the included allowance.

### 3.3 60-Day Schedule Inactivity & Re-Enabling Mechanism
- **Correction:** Corrected the erroneous assertion that a `workflow_dispatch` trigger automatically re-enables a suspended schedule.
- **Authoritative Re-Enabling Procedure:** Under GitHub's scheduled workflow policy, public repositories without repository activity for 60 consecutive days have their cron schedules automatically disabled. To re-enable a disabled scheduled workflow:
  1. **Web UI:** Navigate to **Actions** $\rightarrow$ select the disabled workflow from the left sidebar $\rightarrow$ click **"Enable workflow"**.
  2. **REST API:** Send an authenticated `PUT` request to `/repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable`.

### 3.4 Platform Token Event Suppression vs. `[skip ci]`
- **Correction:** Clarified that `[skip ci]` is **not** the primary mechanism preventing recursive workflow loops when pushing with `GITHUB_TOKEN`.
- **Platform Architecture:** GitHub Actions built-in security automatically suppresses push event workflow triggers when commits are pushed using the repository's ephemeral `GITHUB_TOKEN`.
- **Preserved Role of `[skip ci]`:**
  - Signals to third-party CI systems (e.g. Codecov, external webhooks, or secondary test runners) to skip automated asset update commits.
  - Provides defense-in-depth if an operator ever configures a custom Personal Access Token or Deploy Key.
  - Documents automated visual asset commits clearly in Git history.

---

## 4. Schedule Configuration Optimization

### Schedule Decision
- **Previous Cron:** `0 */6 * * *` (00:00, 06:00, 12:00, 18:00 UTC)
- **Updated Cron:** `23 */6 * * *` (00:23, 06:23, 12:23, 18:23 UTC)

### Rationale:
GitHub Actions official documentation explicitly warns:
> *"The `schedule` event can be delayed during periods of high loads of GitHub Actions runner runs. High load times include the start of every hour. ... To decrease the chance of delay, configure your workflow to run at a different time of the hour."*

Moving the execution to minute 23 bypasses top-of-the-hour scheduling congestion across GitHub's global runner pools, resulting in significantly lower queue latency and more reliable execution timing.

---

## 5. Files Changed

| File Path | Nature of Change |
| :--- | :--- |
| [.github/workflows/pet-publisher.yml](file:///d:/Projects/GitHub-Profile-Pet/.github/workflows/pet-publisher.yml) | Updated cron schedule to `'23 */6 * * *'`; clarified `[skip ci]` comment for external CI systems. |
| [tests/pet-engine/publication.test.ts](file:///d:/Projects/GitHub-Profile-Pet/tests/pet-engine/publication.test.ts) | Updated `TC-PUB-01` to assert `'23 */6 * * *'` and verified external CI convention. |
| [docs/architecture/phase-3-github-actions-runtime.md](file:///d:/Projects/GitHub-Profile-Pet/docs/architecture/phase-3-github-actions-runtime.md) | Corrected runner allowance claims, private billing limits, 60-day schedule re-enabling protocol, and `GITHUB_TOKEN` event suppression architecture. |
| [reports/phase_3a_github_actions_runtime_report.md](file:///d:/Projects/GitHub-Profile-Pet/reports/phase_3a_github_actions_runtime_report.md) | Aligned Phase 3A report with corrected documentation, runner limits, and cron schedule. |
| [reports/phase_3a_1_runtime_scope_correction_report.md](file:///d:/Projects/GitHub-Profile-Pet/reports/phase_3a_1_runtime_scope_correction_report.md) | Created milestone verification report. |

---

## 6. Full Verification Gate Matrix

All verification gates were executed and passed with zero errors and zero warnings:

| Verification Gate | Command | Result | Breakdown |
| :--- | :--- | :---: | :--- |
| **Pet Engine Tests** | `npm run test:pet-engine` | **PASS** | **83/83 tests passing** across 8 suites (0 failures). |
| **Legacy Unit Tests** | `npm test` | **PASS** | **121/121 tests passing** across 24 suites (0 failures). |
| **Full Regression Suite** | `npm run test:all` | **PASS** | **204/204 tests passing** across 32 suites (0 failures). |
| **Static Linter** | `npm run lint` | **PASS** | **0 errors, 0 warnings** across all files. |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS** | Clean exit code 0. Strict type conformance. |
| **Production Build** | `npm run build` | **PASS** | Next.js 16.4.6 compiled cleanly; 14/14 static pages generated. |
| **Standalone CLI Script** | `npm run render:svg` | **PASS** | Generated canonical `public/pet.svg` (12,441 bytes). |
| **Publication CLI Script** | `npm run publish:pet` | **PASS** | Executed safe publication; verified idempotency. |

---

## 7. Scope Boundaries & Completion Gate

- **Restrictions Preserved:**
  - Zero new gameplay features or simulation logic introduced.
  - Zero Issue Forms or action processing added (reserved for future phases).
  - Zero contribution synchronization added (reserved for future phases).
  - Zero external services or paid dependencies.
  - Strictly **zero Git commits, pushes, or branch modifications** performed.
  - Phase 1 gameplay rules and Phase 2 SVG vector rendering remained completely unaltered.

Phase 3A.1 is complete. Standing by for formal project-owner review.
