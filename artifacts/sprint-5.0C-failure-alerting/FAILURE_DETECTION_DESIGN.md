# Sprint 5.0C — Failure Detection Design & Coverage Analysis

## 1. Monitored Production Workflows

The automated failure alerting system monitors exactly the four active, maintained production workflows:

| Workflow File | Workflow Name | Cadence / Trigger | Failure Impact & Scope | Alert Category |
| :--- | :--- | :--- | :--- | :--- |
| `deploy-pages.yml` | GitHub Pages Deployment | Push to `main` (paths: `dist/**`, `pet/state/**`, `pet/render/**`) | Hosted frontend web application fails to deploy | `pages_deployment` |
| `pet-activity.yml` | Pet Activity Progression | Hourly cron + Push to `main` + Manual dispatch | Daily XP accounting, activity ingestion, level progression stalled | `activity_progression` |
| `pet-publisher.yml` | Pet Profile Publisher | Scheduled cron + Push + Manual dispatch | Production README pet badge and SVG status embeds desynchronize | `profile_publisher` |
| `pet-interaction.yml` | Pet Interaction Processor | Issues `opened` / `reopened` / `labeled` + Manual dispatch | User care actions (feed, train, rest, pet) stuck in queue | `interaction_processor` |

### Excluded Workflows & Rationale
1. `pet-baseline.yml` (Dedicated Baseline Establishment Pipeline):
   - **Reason:** One-time, operator-dispatched initialization pipeline. Fails closed intentionally if ledger already exists. Monitoring would create false positives during deliberate refusal tests.
2. `diagnostics-contribution-probe.yml` (Manual Diagnostic):
   - **Reason:** Ad-hoc manual debugging workflow triggered on-demand by developers. Non-production operation.

---

## 2. Failure Detection Categorization & Mapping

Workflows report outcomes through the `conclusion` property of the `workflow_run` payload:

| Reported Conclusion | Alerting System Action | Rationale |
| :--- | :--- | :--- |
| `failure` | **TRIGGER ALERT / UPDATE** | Primary job step failure (lint error, test regression, script crash, git push rejection). |
| `timed_out` | **TRIGGER ALERT / UPDATE** | Workflow exceeded runner timeout limit (deadlock, network stall, hung process). Treated as critical failure. |
| `cancelled` | **IGNORE (SKIPPED_CONCLUSION)** | Operator cancelled or newer run superseded prior execution via concurrency group. Not an incident. |
| `skipped` | **IGNORE (SKIPPED_CONCLUSION)** | Conditional check (`if: ...`) evaluated to false; execution skipped by design. |
| `success` | **RECOVERY / NOOP** | If an open tracking issue exists for this workflow fingerprint, posts a recovery comment. If no open issue exists, exits silently (`NOOP_SUCCESS`). |

---

## 3. Diagnostic Data Extraction

When a workflow fails, the alerting engine parses both standard GitHub Actions event metadata and optional diagnostic context passed via CLI arguments or environment variables:

1. **Execution Metadata:**
   - Workflow Name & File name (`pet-activity.yml`).
   - Run ID & Attempt number (`run_id`, `run_attempt`).
   - Repository & Default branch (`mnp210/GitHub-Profile-Pet`, `main`).
   - Commit SHA (`head_sha`).
   - Event trigger name (`schedule`, `push`, `workflow_dispatch`, `issues`).
   - Direct execution URL (`https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/<id>`).

2. **Diagnostic Summary & Steps:**
   - Sanitized failure summary (redacted tokens, masked secrets).
   - Structured diagnostic table detailing failure context.
   - Comprehensive recovery checklist tailored for GitHub Profile Pet operators.
