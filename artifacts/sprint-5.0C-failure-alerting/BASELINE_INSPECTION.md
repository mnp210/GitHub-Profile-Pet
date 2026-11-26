# Sprint 5.0C — Baseline Inspection & Pre-Implementation Audit

## 1. Candidate Context & Working Tree Verification

- **Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Candidate Initial Commit HEAD:** `57d27071acb0f0b060a9c34a11f5c55bdc492adf`
- **Working Tree State:** Clean (verified zero uncommitted tracked modifications; only untracked local artifacts/backups directories).
- **Production Repository:** `mnp210/GitHub-Profile-Pet`
- **Production Baseline Commit HEAD:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Production Default Branch:** `main` (verified via GitHub API and remote tracking).

---

## 2. Workflow Audit & Alerting Eligibility Matrix

An audit of all YAML workflow definitions under `.github/workflows/` was conducted to identify which workflows represent continuous, maintained production operations:

| Workflow File | Exact YAML `name:` | Triggers & Cadence | Operational Classification | Alerting Eligibility |
| :--- | :--- | :--- | :--- | :---: |
| `deploy-pages.yml` | `Deploy Playable Game to GitHub Pages` | `push: [main]`, `workflow_dispatch` | Continuous web deployment | **ELIGIBLE** |
| `pet-activity.yml` | `Pet Activity Progression` | `push: [main]`, `issues`, `pull_request`, `pull_request_review`, `schedule: '*/30 * * * *'`, `workflow_dispatch` | Event & scheduled progression engine | **ELIGIBLE** |
| `pet-publisher.yml` | `Pet SVG Publication` | `schedule: '47 * * * *'` (Hourly), `workflow_dispatch` | Hourly simulation & SVG publisher | **ELIGIBLE** |
| `pet-interaction.yml` | `Pet Care Action Inbox` | `issues: [opened]`, `schedule: '47 * * * *'`, `workflow_dispatch` | Asynchronous action inbox consumer | **ELIGIBLE** |
| `diagnostics-contribution-probe.yml` | `Diagnostics Contribution Probe` | `workflow_dispatch` only | Manual diagnostic probe | **EXCLUDED** (Manual diagnostic only) |
| `pet-baseline.yml` | `Pet Baseline Initialization` | `workflow_dispatch` only | One-time bootstrap setup | **EXCLUDED** (One-time setup action) |

### Eligibility Rationale:
- **Eligible (4 workflows):** `deploy-pages.yml`, `pet-activity.yml`, `pet-publisher.yml`, and `pet-interaction.yml` run autonomously on triggers (`schedule`, `push`, `issues`, `pull_request`). Any failure directly impacts pet progression, vitals simulation, user care actions, or public hosted availability. Automated failure alerts are essential for operational health.
- **Excluded (2 workflows):** `pet-baseline.yml` is an isolated, one-time bootstrap script. `diagnostics-contribution-probe.yml` is a manual diagnostic tool run interactively by operators with immediate console visibility. Alerting on them would introduce unnecessary issue clutter.

---

## 3. Issue Templates & Repository Labels Audit

- **Templates under `.github/ISSUE_TEMPLATE/`:**
  - `pet-feed.yml` (labels: `["pet-action:pending", "pet:feed"]`)
  - `pet-train.yml` (labels: `["pet-action:pending", "pet:train"]`)
  - `pet-rest.yml` (labels: `["pet-action:pending", "pet:rest"]`)
  - `pet-pet.yml` (labels: `["pet-action:pending", "pet:pet"]`)
- **Action Processing Exclusion:**
  - `src/features/pet-engine/activity/activityProcessor.ts` actively filters issues with label `pet-action:pending` or title prefix `pet: `.
- **Alert Label Selection:**
  - Failure alert issues will carry the dedicated label: `alert:workflow-failure`.
  - This guarantees complete separation from pet care interactions and prevents collision with action inbox processing.
  - Resilience guarantee: If `alert:workflow-failure` label does not yet exist on the target repository, issue creation must not fail.

---

## 4. Telemetry & Sanitization Reuse Assessment

Sprint 5.0A established two foundational sanitization utilities in `src/features/pet-engine/reporting/stepSummary.ts`:
1. `sanitizeSecrets(text: string): string`: Redacts `ghp_`, `github_pat_`, `gho_`, `Bearer <token>`, and `token <token>` into `***REDACTED***`.
2. `escapeMarkdown(text: string): string`: Escapes table pipes (`\|`), angle brackets (`&lt;`, `&gt;`), and line breaks (`<br/>`).

These utilities will be directly reused to format issue titles, failure summaries, and diagnostic tables, guaranteeing zero credential leakage in GitHub issues.

---

## 5. Strict Activation Safeguard Boundary

- By default, issue creation must remain **strictly disabled**:
  `FAILURE_ALERTS_ENABLED=false`
- If `FAILURE_ALERTS_ENABLED` is missing, empty, or false, the alerting system logs a dry-run notice and exits cleanly with code 0 without creating or modifying GitHub issues.
- The production repository `mnp210/GitHub-Profile-Pet` remains 100% untouched throughout this sprint.
