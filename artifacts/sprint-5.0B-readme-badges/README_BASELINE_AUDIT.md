# Sprint 5.0B — README Baseline & Workflow Inspection Audit

## 1. Candidate Context & Working Tree Verification

- **Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Candidate Initial Commit HEAD:** `05848acc505a4d4be7df0114b4e2090b75f769db`
- **Working Tree Cleanliness:** Clean (verified zero tracked modifications; only untracked local artifacts/backups directories).
- **Sprint 5.0A File Invariance:**
  - `src/features/pet-engine/reporting/stepSummary.ts` — verified unchanged
  - `src/features/pet-engine/reporting/index.ts` — verified unchanged
  - `scripts/process-activity.ts` — verified unchanged
  - `scripts/publish-pipeline.ts` — verified unchanged
  - `scripts/process-inbox.ts` — verified unchanged
  - `tests/unit/stepSummary.test.ts` — verified unchanged

---

## 2. Production Repository & Default Branch Verification

- **Production Repository:** `mnp210/GitHub-Profile-Pet`
- **Production Baseline Commit HEAD:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Production Hosted URL:** `https://mnp210.github.io/GitHub-Profile-Pet/`
- **Default Branch:** `main`
  - Verified via GitHub API (`gh repo view mnp210/GitHub-Profile-Pet --json defaultBranchRef`): `defaultBranchRef.name = "main"`
  - Verified via Git remote tracking configuration: `origin/main`
  - Verified via live Actions workflow runs: all production workflow executions execute against `ref: refs/heads/main`
- **Repository Visibility:** Public (`isPrivate: false`)

---

## 3. Workflow Definition Audit (`.github/workflows/`)

An inspection of every YAML file under `.github/workflows/` was conducted to establish exact filenames, `name:` properties, triggers, and production operational roles:

| Filename | Exact YAML `name:` | Triggers & Schedule | Primary Role | Health Indicator Status |
| :--- | :--- | :--- | :--- | :--- |
| `deploy-pages.yml` | `Deploy Playable Game to GitHub Pages` | `push: [main]`, `workflow_dispatch` | Continuous deployment of hosted web app | **YES (Included)** |
| `pet-activity.yml` | `Pet Activity Progression` | `push: [main]`, `issues`, `pull_request`, `pull_request_review`, `schedule: '*/30 * * * *'`, `workflow_dispatch` | Autonomous activity XP progression & reconciliation | **YES (Included)** |
| `pet-publisher.yml` | `Pet SVG Publication` | `schedule: '47 * * * *'` (Hourly), `workflow_dispatch` | Passive vitals simulation & SVG badge publishing | **YES (Included)** |
| `pet-interaction.yml` | `Pet Care Action Inbox` | `issues: [opened]`, `schedule: '47 * * * *'`, `workflow_dispatch` | Pet care action drainage & feedback delivery | **YES (Included)** |
| `diagnostics-contribution-probe.yml` | `Diagnostics Contribution Probe` | `workflow_dispatch` only | Read-only diagnostic GraphQL contribution probe | **YES (Included)** |
| `pet-baseline.yml` | `Pet Baseline Initialization` | `workflow_dispatch` only (with multi-clause authorization) | One-time initial baseline establishment for new forks | **NO (Excluded - One-Time Setup)** |

### Inclusion Rationale:
1. **`deploy-pages.yml`**: Vital production indicator confirming that the playable web application builds and deploys successfully to GitHub Pages.
2. **`pet-activity.yml`**: Central autonomous progression engine running continuously on pushes, PRs, issues, reviews, and a 30-minute reconciliation cron.
3. **`pet-publisher.yml`**: Essential hourly background worker that keeps the companion's vitals simulated and updates the README badge.
4. **`pet-interaction.yml`**: Core asynchronous input pipeline processing interactive care actions submitted through GitHub Issue Forms.
5. **`diagnostics-contribution-probe.yml`**: Active operational tool maintained to verify public contribution API access and numeric trainer identity.
6. **`pet-baseline.yml`**: **Excluded**. Strictly designed as a one-time setup action. Displaying a status badge for a one-time initialization script is redundant and misleading as an indicator of ongoing repository health.

---

## 4. Existing README Structure & Visual Conventions

An inspection of `README.md` reveals:
- **Title:** `# GitHub Profile Pet`
- **Short Description:** Single introductory sentence followed by a feature highlights paragraph.
- **Interactive Pet Embed:** Bounded by `<!-- START_SECTION:github-profile-pet -->` and `<!-- END_SECTION:github-profile-pet -->` containing `<p align="center"><img src="public/pet.svg" ... /></p>`.
- **Existing Badges:** **None**. The existing README contains zero workflow badges or Shields.io badges.
- **Section Headers:** Clean markdown with `---` thematic breaks separating Architecture, Workflows, Installation Guide, Billing/Economics, and Developer Guide.

### Placement Decision:
The workflow status badges will be placed immediately beneath the primary introductory sentence, before the feature details paragraph and before `<!-- START_SECTION:github-profile-pet -->`. This adheres to standard developer platform conventions without pushing the companion's visual preview below the fold.
