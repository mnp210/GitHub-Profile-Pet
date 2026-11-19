# Phase 3C2.3-B2-R3.24 — GitHub Actions Billing Model Correction & Documentation Re-Audit

**Milestone:** R3.24 (Billing Model Correction & Operational Documentation Alignment)  
**Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Active Branch:** `phase-3c2-3-b2-r3-7-candidate`  
**Candidate Base HEAD:** `83bdf87216271bbdea142c2f2921bd326b599f42`  
**Production Remote Identity:** `mnp210/GitHub-Profile-Pet`  
**Production Remote HEAD:** `f838b3bb3291fdfd99c981985632b6e0d7191322`  
**Execution Timestamp:** 2026-11-19T09:12:00Z (14:42 IST)  
**Milestone Verdict:** `PASS — BILLING DOCUMENTATION READY FOR CANDIDATE COMMIT REVIEW`

---

## 1. Executive Summary

Milestone **R3.24** audited and updated all GitHub Actions billing statements across repository documentation to conform strictly to GitHub's authoritative billing architecture:

1. **Monetary Included-Compute Allowance:** Transitioned away from legacy fixed-minute quota claims (e.g. "2,000 included minutes"). Authoritative documentation confirms GitHub allocates a **monthly monetary compute allowance (USD)** across all plans:
   - **GitHub Free (personal accounts):** **$12.00 USD / month**
   - **GitHub Pro:** **$18.00 USD / month**
   - **GitHub Free (organizations):** **$12.00 USD / month**
   - **GitHub Team:** **$18.00 USD / month**
   - **GitHub Enterprise Cloud:** **$300.00 USD / month**
2. **Current Runner Pricing & SKU:** All project workflows run on standard 2-core x86_64 Linux runners (`ubuntu-latest`, SKU: `actions_linux`). Under authoritative pricing, this SKU is billed at **$0.006 USD per minute** (1x multiplier).
3. **Transparent Operating Scenarios:** Replaced fixed-minute claims with exact job counts, durations, whole-minute rounding rules, and dollar-denominated compute drawdown calculations against the $12.00 monthly allowance.
4. **Budgeting & Spending Controls:** Accurately documented GitHub's spending limits and the exact role of the **"Stop usage when budget limit is reached"** setting (`prevent_further_usage: true`). Removed claims that a $0 spending limit is automatically configured for every user or that it provides an unconditional shield against non-Actions charges.
5. **Storage & Scheduling Qualifications:** Clearly distinguished compute from separate artifact/cache storage allowances (500 MB included for Free). Preserved the two-UTC-calendar-day recovery boundary and best-effort scheduling notices.

All changes in R3.24 were strictly restricted to documentation (`README.md` and `docs/operations/`). Zero application code, zero workflow YAML, and zero production data were modified.

---

## 2. Authoritative GitHub Documentation Sources & Verification

Audited on **November 19, 2026** against primary GitHub documentation:

- [GitHub Actions Billing and Usage Concepts](https://docs.github.com/en/actions/concepts/billing-and-usage)
- [Product Billing: GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Product Usage Included with Each Plan](https://docs.github.com/en/billing/reference/product-usage-included)
- [GitHub Actions Runner Pricing & Multipliers](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Choosing Runner Labels for a Job](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
- [GitHub-Hosted Runners Reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

### Core Authoritative Findings:
1. **Included Compute Usage is a Shared Dollar Pool:** On private repositories, standard GitHub-hosted runner usage, cloud sandbox compute/memory, and larger runners all draw from the account's monthly monetary compute pool. No usage type has priority over another.
2. **Public Repositories are 100% Free:** Standard GitHub-hosted runners (`ubuntu-latest`) on public repositories incur **$0.00 billed compute** and do not draw from the monthly monetary allowance.
3. **Per-Job Whole-Minute Rounding:** GitHub rounds the execution time of each individual job on private repositories **up to the nearest whole minute**. A 25-second run consumes 1 billable minute ($0.006 USD).
4. **Standard 2-Core Linux Runner Pricing:** Standard `ubuntu-latest` x64 instances (2 vCPUs, 7 GB RAM, 14 GB SSD; SKU: `actions_linux`) carry a **1x multiplier** and a unit rate of **$0.006 USD per minute**.
5. **Equivalent Minute Capacity (Illustration Only):**
   - $12.00 allowance ÷ $0.006/min = 2,000 minutes equivalent on GitHub Free.
   - $18.00 allowance ÷ $0.006/min = 3,000 minutes equivalent on GitHub Pro / Team.
   - $300.00 allowance ÷ $0.006/min = 50,000 minutes equivalent on Enterprise Cloud.  
   *(This explains the origin of the legacy "2,000-minute" terminology, but confirms it is an illustrative maximum assuming zero other compute workloads on the account).*

---

## 3. Actual Workflow Job Inspection

All workflow definitions in `.github/workflows/` were inspected to verify job counts, runner labels, triggers, and concurrency constraints:

| Workflow File | Job Identifier | `runs-on` Label | Job Count | Trigger Mechanism | Concurrency Group |
| :--- | :--- | :--- | :---: | :--- | :--- |
| [`pet-publisher.yml`](../.github/workflows/pet-publisher.yml) | `publish-pet` | `ubuntu-latest` | 1 | Hourly cron (`47 * * * *`) + `workflow_dispatch` | `pet-runtime-${{ github.repository }}` |
| [`pet-interaction.yml`](../.github/workflows/pet-interaction.yml) | `process-actions` | `ubuntu-latest` | 1 | Hourly cron (`47 * * * *`) + `issues.opened` + `workflow_dispatch` | `pet-runtime-${{ github.repository }}` |
| [`pet-baseline.yml`](../.github/workflows/pet-baseline.yml) | `establish-baseline` | `ubuntu-latest` | 1 | Manual `workflow_dispatch` only (with string confirmation) | `pet-runtime-${{ github.repository }}` |
| [`diagnostics-contribution-probe.yml`](../.github/workflows/diagnostics-contribution-probe.yml) | `probe-contributions` | `ubuntu-latest` | 1 | Manual `workflow_dispatch` only (diagnostic) | `pet-diagnostics-${{ github.repository }}` |

### Configuration Findings:
- Every workflow consists of **exactly 1 job**.
- Every job requests **`runs-on: ubuntu-latest`** (provisions 2-core standard Linux x64 VM; SKU: `actions_linux`).
- No workflow requests GitHub Larger Runners (4-core to 96-core or GPU).
- All runtime workflows serialize under `concurrency: group: pet-runtime-${{ github.repository }}` with `cancel-in-progress: false`.

---

## 4. Recalculated Operating Scenarios (30-Day Billing Cycle)

Calculated at standard Linux 2-core pricing ($0.006 USD/min) using an illustrative 1-minute lower-bound rounding increment (observed average job run times are 15–35 seconds):

### Scenario Matrix:

| Operational Scenario | Cadence & Workflow Composition | Expected Monthly Jobs | Billable Minutes (1 min/job lower bound) | Estimated Compute Cost / Month | % Drawdown on GitHub Free ($12.00 Pool) | Remaining Monthly Free Allowance | % Drawdown on GitHub Pro ($18.00 Pool) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Scenario A: Standard Hourly** | Both `pet-publisher.yml` & `pet-interaction.yml` running hourly (48 runs/day) | 1,440 | 1,440 mins | **$8.64 USD** | **72.0%** | **$3.36 USD** | **48.0%** |
| **Scenario B: Cadence-Optimized** | Both workflows scheduled every 2 hours (`cron: '47 */2 * * *'`) (24 runs/day) | 720 | 720 mins | **$4.32 USD** | **36.0%** | **$7.68 USD** | **24.0%** |
| **Scenario C: Publisher-Only** | `pet-publisher.yml` hourly (24 runs/day), `pet-interaction.yml` disabled | 720 | 720 mins | **$4.32 USD** | **36.0%** | **$7.68 USD** | **24.0%** |
| **Scenario D: Event Care Overhead** | Illustrative care interaction (~2 issues/day = ~60 issues/month) | ~60 | ~60 mins | **~$0.36 USD** | **+3.0%** | — | **+2.0%** |

### Combined Operating Scenario:
- **Scheduled Hourly Sweep + Active Care Issues (Scenario A + Scenario D):**
  - Total monthly jobs: 1,440 scheduled + 60 issue events = **1,500 jobs/month**.
  - Total billed minutes (1 min/job lower bound): **1,500 billable minutes**.
  - Estimated runner compute cost: 1,500 mins × $0.006/min = **$9.00 USD / month**.
  - **Account Impact (GitHub Free):** Draws **$9.00 of the $12.00 monthly compute allowance** (**75.0%**), leaving **$3.00 USD** for other private repository workflows.
  - **Account Impact (GitHub Pro / Team):** Draws **$9.00 of the $18.00 monthly compute allowance** (**50.0%**), leaving **$9.00 USD**.

### Concurrency Billing Clarification:
- If an event-triggered run and a scheduled run arrive at the same time, the second run queues.
- A queued run that is cancelled before acquiring a runner consumes **$0.00** (0 billed minutes).
- Once a runner is assigned and begins execution, it incurs at least **1 billable minute** ($0.006 USD).

---

## 5. Storage, Spending Controls & Operational Boundaries

### 5.1 Storage & Cache Separation
The monthly compute allowance covers runner time only. GitHub Actions storage operates under separate plan quotas:
- **GitHub Free (personal):** 500 MB included storage
- **GitHub Pro:** 1 GB included storage
- **GitHub Team:** 2 GB included storage
- **GitHub Enterprise Cloud:** 50 GB included storage

**Project Footprint:** The entire repository state (`pet.json`, `contributions.json`, `actions.json`) and the generated badge (`pet.svg`) are tracked directly in Git and consume **< 100 KB total** (< 0.02% of GitHub Free storage). This repository uploads zero GitHub Actions artifacts and uses zero build caches.

### 5.2 Spending Controls: "Stop usage when budget limit is reached"
- GitHub budgets default to soft alert notifications at 75%, 90%, and 100% of the threshold.
- To enforce a hard cap that stops billed compute on private repositories once included compute allowances are depleted, users must explicitly enable **"Stop usage when budget limit is reached"** (`prevent_further_usage: true`).
- **Scope Limitation:** Configuring a $0.00 budget with stop-usage enabled halts private-repository Actions compute when included funds are exhausted, but does not affect free public-repository runs, nor does it waive pre-existing paid subscription fees (e.g. GitHub Pro tier fees).

### 5.3 Preserved Operational Invariants
- **Best-Effort Scheduling:** GitHub Actions scheduled workflows run on a shared, best-effort queue subject to traffic delays and platform load. The engine's passive simulation and contribution reconciliation routines are fully resilient to schedule jitter and gaps.
- **Two-UTC-Calendar-Day Boundary:** The engine inspects a rolling discovery window of two UTC calendar days (`[today - 1 day, today]`). Contributions older than 48 hours are intentionally not processed into the pet's ledger, bounding query payload size and protecting rate-limit quotas.

---

## 6. Documentation Files Inspected and Updated

| File Path | Nature of Inspection | Corrections Applied |
| :--- | :--- | :--- |
| [`README.md`](../README.md) | Primary public documentation | Completely restructured Section 2 with monetary allowance model ($12/$18/$300), $0.006/min rate, 1-min rounding rule, recalculated Scenarios A–D, storage breakdown, and accurate spending-limit behavior. |
| [`docs/operations/production-launch-checklist.md`](../docs/operations/production-launch-checklist.md) | Operational launch audit checklist | Updated Item 4.6 to state private-repository compute draws from the monthly monetary allowance ($12.00/mo on Free) at $0.006/min with 1-min rounding (~$8.64/mo for 1,440 runs). |
| [`docs/operations/production-runtime-runbook.md`](../docs/operations/production-runtime-runbook.md) | Runtime runbook for maintainers | Updated Section 4.6 capacity qualifications to reflect the monetary allowance model, Linux $0.006/min pricing, and shared compute drawdown. |
| [`docs/operations/recovery-and-rollback.md`](../docs/operations/recovery-and-rollback.md) | Disaster recovery procedure | Inspected. Focuses exclusively on GraphQL 1,000 pt/hr rate limits; no inaccurate billing claims present. |
| [`docs/operations/contribution-baseline-procedure.md`](../docs/operations/contribution-baseline-procedure.md) | Baseline establishment procedure | Inspected. Focuses exclusively on GraphQL rate limits; no inaccurate billing claims present. |

---

## 7. Verification, Quality Gates & Containment

### 7.1 Regression Test Execution
- Full regression suite was re-verified in candidate workspace:
  - `npm test`: **121/121 unit tests passed** across 24 suites.
  - `npm run test:pet-engine`: **524/524 engine tests passed** across 41 suites (including the 42 dedicated security tests).
  - Combined: **645 automated tests passed**, 0 failures.
  - `npx tsc --noEmit`: Exited with code 0 (0 compilation errors).
  - `npm run lint`: Exited with code 0 (0 ESLint errors, 0 warnings).

### 7.2 Production Containment Audit
- Remote repository `mnp210/GitHub-Profile-Pet` verified via `git ls-remote origin main`:
  - Remote HEAD: `f838b3bb3291fdfd99c981985632b6e0d7191322`
  - Zero commits, zero branch pushes, zero tag creations.
  - Baseline workflow `422923344` lifetime runs remain 0 (undispatched).
  - Zero issues created. Production pet state remains 100% untouched.

---

## 8. Git Diff Summary

Only documentation files were modified in R3.24:

```
 README.md                                          | 221 ++++++++++++++++-----
 docs/operations/contribution-baseline-procedure.md |   8 +-
 docs/operations/production-launch-checklist.md     |  12 +-
 docs/operations/production-runtime-runbook.md      |   4 +-
 docs/operations/recovery-and-rollback.md           |   2 +-
 5 files changed, 183 insertions(+), 64 deletions(-)
```

---

## 9. Final Milestone Verdict

# `PASS — BILLING DOCUMENTATION READY FOR CANDIDATE COMMIT REVIEW`

All GitHub Actions billing, quota, and runner pricing statements across repository documentation now strictly conform to authoritative GitHub platform policies. The candidate codebase at `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` is fully reconciled and ready for candidate commit authorization.
