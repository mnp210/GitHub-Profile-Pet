# Sprint 5.2D-G — PR Publication Side-Effect Audit & Final Gate A Decision

**Date:** 2026-11-24  
**Auditor:** Antigravity Autonomous Agent  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Authoritative Candidate HEAD:** `40e1a51878a635eaa1a579882028fa9fec2e5b4d`  
**Tested Application Code Commit:** `7d9ea7db6e4252726555340ccb71717f2359a4e9`  
**Production Repository:** `mnp210/GitHub-Profile-Pet`  
**Current Production HEAD:** `062da379b8fe35b7d1dd4b7753778588fefab897`  
**Authoritative Merge Base:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Production Mutation Status:** 100% Read-Only Baseline Maintained (Zero Production Mutations)

---

## 1. Resolution of Authoritative Git Identity & Discrepancies

### A. Candidate HEAD Discrepancy Resolution
- **`7d9ea7db6e4252726555340ccb71717f2359a4e9`:** The candidate commit that completed Sprint 5.2C integration and underwent the full 894-test quality gate and browser visual QA.
- **`16602ba72817d6730a96ecb0df16b8c121733fa8`:** The documentation commit completing Sprint 5.2D (adding 7 `SPRINT_5_2D_*.md` files).
- **`40e1a51878a635eaa1a579882028fa9fec2e5b4d`:** The authoritative candidate HEAD created during Sprint 5.2D-F reconciliation (adding `SPRINT_5_2D_FINAL_RECONCILIATION.md` and reconciling PR documentation).
- **Verification:** Both `16602ba` and `40e1a51` are direct, linear, **documentation-only descendants** of `7d9ea7d`. `git diff 7d9ea7d..40e1a51` confirms **zero lines of code, configuration, or test scripts have changed**. All test proofs apply with 100% bit-for-bit fidelity.

### B. Merge-Tree Root SHA Discrepancy Resolution
- Merging `origin/main` with `16602ba` produced root tree `4e66cdce4d31d2844356d48acb38e97764de2703`.
- Merging `origin/main` with `40e1a51` produces root tree `79013d04350d7327e0c619bc189596be4aa5e454`.
- **Reason:** The addition of `docs/sprints/SPRINT_5_2D_FINAL_RECONCILIATION.md` in commit `40e1a51` advanced the tree hash. `git diff-tree -r 4e66cdc 79013d0` confirms the delta between trees consists exclusively of documentation files in `docs/sprints/`.

### C. Reconciled Commits & File Counts from Merge Base (`3c7fc20`):
- **Candidate Commits Ahead:** **11 commits** (`05848ac` through `40e1a51`).
- **Production Commits Ahead:** **6 commits** (`2f6aa07` through `062da37`).
- **Total Candidate Files Changed:** **235 files** (212 added, 23 modified, 0 deleted, 0 renamed).

---

## 2. Deep-Dive Audit: PR-Opened Production Mutation

### A. Workflow Invocation Architecture
When a Pull Request is opened in `mnp210/GitHub-Profile-Pet` targeting `main`, GitHub Actions evaluates `.github/workflows/pet-activity.yml`.
- **Workflow Version Used:** For same-repository PRs, GitHub evaluates the workflow on `main`. Because candidate and production versions of `pet-activity.yml` are 100% identical, the execution logic is completely unambiguous.
- **Trigger:**
  ```yaml
  on:
    pull_request:
      types: [opened, closed]
  ```
- **Job Guard:**
  ```yaml
  if: >
    github.event_name == 'schedule' ||
    github.event_name == 'workflow_dispatch' ||
    (
      github.actor != 'github-actions[bot]' &&
      github.actor != 'dependabot[bot]' &&
      ...
    )
  ```
  Because the PR opener is a human maintainer (`mnp210`), the bot guard evaluates to `true`, and the workflow launches.

### B. Execution Flow in `scripts/process-activity.ts`
1. Event Parsing: Identifies `eventName === 'pull_request'` with `action === 'opened'`. Enqueues `eventType: 'pr_opened'`, `eventId: pr_opened:<pr_number>`, `actor: mnp210`.
2. Eligibility & Deduplication: Checks permanent index. As this is a new PR, it is not duplicate.
3. XP Award: Evaluates base reward `ACTIVITY_XP_REWARDS['pr_opened'] = 25 XP`, clamped to the 300 XP/day budget.
4. Git Publication Analysis:
   - The workflow runs with `node scripts/process-activity.ts --ref "${{ github.ref_name }}"`.
   - On GitHub Actions `pull_request` events, `${{ github.ref_name }}` evaluates to `<pr_number>/merge`.
   - The script stages `pet/state/pet.json` and attempts `git push origin HEAD:<pr_number>/merge`.
   - **Crucial Finding:** On GitHub, `refs/pull/*` are read-only synthetic refs. A push to `<pr_number>/merge` will be rejected by GitHub's Git server.
   - **Consequence:** The push fails, the script retries 3 times, records a step summary failure (`push_collision_retry_exhausted`), and exits with code 1.
   - **Result on `main`:** **Production `main` is NOT modified by the PR-opened event.**

---

## 3. Publication Lifecycle Event Sequence

| Lifecycle Stage | Workflows Triggered | Can Pet State Mutate? | Can a Commit Push to `main`? | Can a Deployment Occur? | Safety & Certainty |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Branch Push** | None | NO | NO | NO | **CONFIRMED:** `candidate/...` has no push triggers. |
| **2. PR Opened** | `pet-activity.yml` | NO (push to PR ref fails) | NO | NO | **CONFIRMED:** Script fails closed without modifying `main`. |
| **3. PR Sync** | None | NO | NO | NO | **CONFIRMED:** `synchronize` is not in `types:`. |
| **4. PR Review** | `pet-activity.yml` (if review submitted) | NO (push to PR ref fails) | NO | NO | **CONFIRMED:** Fails closed on ephemeral ref. |
| **5. PR Merge** | `deploy-pages.yml`<br>`pet-activity.yml` | **YES (Post-Merge)** | **YES (Post-Merge)** | **YES** | **CONDITIONAL:** Controlled by explicit Gate B merge authorization. |
| **6. Deploy Pages** | `deploy-pages.yml` | NO | NO | **YES** | **CONFIRMED:** Builds and publishes static site. |

---

## 4. Assessment of PR-Opened Reward Handling Options

- **Option A — Accept Standard Progression Mechanics (RECOMMENDED):**
  - *Description:* Allow GitHub Actions to handle the PR event naturally. When the PR is merged, ordinary activity reconciliation will process the merged commits and award standard progression within daily limits.
  - *Risk:* None. Fails closed during PR open without touching `main`; safely reconciles post-merge.
- **Option B — Prevent PR Event via Draft PR:**
  - *Description:* Open the PR as a "Draft Pull Request" and mark it ready when ready to merge.
  - *Risk:* `pull_request: [opened]` still fires on draft creation in GitHub Actions, so behavior is identical to Option A.
- **Option C — Modify Workflow Code:**
  - *Description:* Edit `pet-activity.yml` or `process-activity.ts` to add special exclusion flags for the release PR.
  - *Risk:* **High Risk / Unnecessary Complexity.** Introduces untested code changes into candidate workflows right before release, requiring a new round of quality gate testing.
- **Option D — Defer Publication:**
  - *Description:* Hold Gate A until maintainer confirms acceptance of Option A.

---

## 5. Reconfirmation of Six-File Protected State Preservation

Simulated 3-way merge between `origin/main` (`062da37`) and candidate HEAD (`40e1a51`) produces root tree `79013d04350d7327e0c619bc189596be4aa5e454`:

| Protected Path | Production Blob (`origin/main`) | Candidate Blob (`HEAD`) | Base Blob (`3c7fc20`) | Merge-Tree Blob | Preservation Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `pet/state/pet.json` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | `c5a2ff87ed16b51c670d6ebfc398eccad17ccc2d` | `c5a2ff87ed16b51c670d6ebfc398eccad17ccc2d` | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | **100% EXACT MATCH** |
| `pet/ledger/activity.json` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | `75cfe3c0bccd21901065f14a7033c88cdc0fbb85` | `75cfe3c0bccd21901065f14a7033c88cdc0fbb85` | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | **100% EXACT MATCH** |
| `pet/ledger/archive/activity_archive.json` | *(Does not exist)* | *(Does not exist)* | *(Does not exist)* | *(Does not exist)* | **100% PRESERVED AS NON-EXISTENT** |
| `pet/ledger/actions.json` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | `ffa65ee3802d5ab7123e438653f99c013d676b66` | `ffa65ee3802d5ab7123e438653f99c013d676b66` | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | **100% EXACT MATCH** |
| `pet/ledger/contributions.json` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | `6067330ef4e88771d1a4d920ad04495ba7c29a13` | `6067330ef4e88771d1a4d920ad04495ba7c29a13` | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | **100% EXACT MATCH** |
| `public/pet.svg` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | `5951b4a9e4943e62cef57eef73453762f9c02990` | `5951b4a9e4943e62cef57eef73453762f9c02990` | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | **100% EXACT MATCH** |

---

## 6. Final Recommendation

### **CONDITIONAL — PENDING MAINTAINER ACCEPTANCE OF OPTION A**

- **Condition:** Maintainer explicitly acknowledges that opening the PR may trigger `pet-activity.yml`, which fails closed harmlessly without mutating `main`, and that post-merge reconciliation will award standard progression for merged commits.
- Once Option A is explicitly confirmed, the status automatically elevates to **READY FOR GATE A AUTHORIZATION**.

---

## 7. Mandatory Execution Statement

**Gate A is not executed. No branch was pushed, no Pull Request was published, no merge occurred, no workflow was dispatched, and production remains untouched.**
