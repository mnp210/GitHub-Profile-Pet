# Sprint 4.3 — Activity Workflow Readiness Audit

**Workflow File:** `.github/workflows/pet-activity.yml`  
**Execution Script:** `scripts/process-activity.ts`  
**Core Modules:** `src/features/pet-engine/activity/*`  
**Assessment Date:** 2026-11-22  

---

## 1. Architectural Architecture & Trigger Specification

The activity processing workflow is responsible for observing real GitHub repository interactions (commits, issues, pull requests, and code reviews) and translating them into virtual pet progression (XP, satiety, mood, and levels).

### Trigger Matrix
| Event Trigger | Event Types / Filter | Architectural Purpose |
| :--- | :--- | :--- |
| `push` | `branches: [main]` | Awards +15 XP per unique qualifying commit. |
| `issues` | `types: [opened]` | Awards +10 XP for non-care issues. Excludes issues with `pet-action:pending` label or `pet:` title prefix. |
| `pull_request` | `types: [opened, closed]` | Awards +25 XP on PR opened and +50 XP on PR merged. |
| `pull_request_review`| `types: [submitted]` | Awards +20 XP for substantive review submissions. |
| `schedule` | `cron: '*/30 * * * *'` | 30-minute reconciliation sweep to catch any events dropped during concurrency throttles. |
| `workflow_dispatch`| Manual / API | On-demand manual testing and audit dispatches. |

---

## 2. Security Boundaries & Guard Conditions

### Bot & CI Skip Guard Condition
To prevent infinite recursion loops caused by automated commits, line 33 of `pet-activity.yml` enforces:
```yaml
    if: >
      github.event_name == 'schedule' ||
      github.event_name == 'workflow_dispatch' ||
      (
        github.actor != 'github-actions[bot]' &&
        github.actor != 'dependabot[bot]' &&
        !contains(github.event.head_commit.message, '[skip ci]') &&
        !contains(github.event.head_commit.message, '[ci skip]') &&
        !contains(github.event.head_commit.message, 'pet: update state') &&
        !contains(github.event.head_commit.message, 'pet: record activity')
      )
```
- **Loop Prevention:** Automated commits containing `[skip ci]`, `pet: update state`, or `pet: record activity` are immediately filtered.
- **Bot Exclusions:** Prevents bots (`dependabot[bot]`, `github-actions[bot]`) from farming activity XP.
- **Always Runs On Schedule:** Periodic sweeps and manual dispatches bypass the commit message filter to ensure historical reconciliation occurs.

### Permissions & Isolation
```yaml
permissions:
  contents: write
  issues: read
  pull-requests: read

concurrency:
  group: pet-runtime-${{ github.repository }}
  cancel-in-progress: false
```
- **Least Privilege:** Write access is strictly limited to `contents` (updating authoritative state and ledgers). Issues and pull requests are strictly read-only.
- **Repository Isolation:** Concurrency group uses `${{ github.repository }}` ensuring zero interference between separate repositories or forks.
- **Durable Queue Invariant:** `cancel-in-progress: false` ensures sequential execution without terminating in-flight event processing.

---

## 3. Progression Engine Hardening (Sprint 4.0 - 4.2 Achievements)

1. **Permanent Deduplication (Monotonic Interval Index):**
   - Replaced fragile FIFO arrays with `intervalIndex.ts`, which stores monotonic intervals of processed commit sequences and PR ranges.
   - Prevents duplicate XP awards even if events occurred months in the past or ledgers are truncated.
2. **Commit Limit & Checkpoint Protection:**
   - In `reconciliation.ts`, if the commit scan hits the 5,000-commit safety limit without reaching the previous checkpoint, `hasMoreCommits` is flagged, `completedFully` is set to `false`, and `lastCommitSha` is held in place.
   - Checkpoints are saved only when `reconCompletedFully === true`, guaranteeing unexamined history is never skipped.
3. **Multi-Document Transaction Journal & Crash Recovery:**
   - In `scripts/process-activity.ts`, state mutations across `pet/state/pet.json`, `pet/ledger/activity.json`, and `public/pet.svg` are committed through `activityTransactionJournal.ts`.
   - On publication collision retries (`git reset --hard`), `recoverActivityTransaction` rolls forward committed stages or rolls back uncommitted stages before resetting to remote, preventing corrupt or lost state.

---

## 4. Reason Remote Manual Dispatch Was Blocked in Sprint 4.2

When attempting:
```powershell
gh workflow run pet-activity.yml --repo mnp210/GitHub-Profile-Pet-R3.40-Staging --ref test/sprint-4-1
```
GitHub's REST API returned:
`HTTP 404: workflow pet-activity.yml not found on the default branch`.

### GitHub Actions Core Platform Requirement
In GitHub Actions, the `workflow_dispatch` API endpoint requires the workflow definition file to exist in the repository's default branch (`main`). Because candidate code was pushed to dedicated branch `test/sprint-4-1` and not merged into `main`, manual dispatch via API was refused by GitHub.

### Autonomous Local Dry-Run Validation
To safely verify the workflow without violating branch boundaries, `scripts/process-activity.ts` was executed locally with `--dry-run`:
- Result: Processed 12 qualifying events, calculated +180 XP, clamped daily cap, and cleanly produced 0 modifications.

---

## 5. Post-Merge Hosted Validation Procedure

Upon authorized fast-forward merge of candidate commits to `main`:

1. **Workflow Registration:** GitHub automatically registers `Pet Activity Progression` as an active workflow on `main`.
2. **Dispatch Verification:**
   ```powershell
   gh workflow run "Pet Activity Progression" --repo mnp210/GitHub-Profile-Pet
   ```
3. **Run Inspection:**
   ```powershell
   gh run list --repo mnp210/GitHub-Profile-Pet --workflow "Pet Activity Progression"
   gh run view <RUN_ID> --log
   ```
4. **State Transition Verification:**
   Confirm commit by `github-actions[bot]` titled `pet: record activity progression (+<XP> XP) [skip ci]`.
   Confirm `pet/ledger/activity.json` records the event and updates interval index.
