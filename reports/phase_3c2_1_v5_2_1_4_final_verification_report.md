# Phase 3C2.1-V.5.2.1.4 — Final Working-Tree Verification & Publication Report Reconciliation Report

**Date:** 2026-11-16  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Branch:** `main`  
**Expected Published SHA:** `9658548d2173dfc19a26f6434c6ed341632c9b2a`

---

## 1. Executive Summary

This milestone executed the final verification of the local and remote Git repository state following the Phase 3C2.1-V.5.2.1.3 controlled publication, and resolved the historical GitHub Actions run ID discrepancy identified in the publication report.

1. **Git Identity & Integrity:** Local `HEAD`, local `origin/main`, and remote `refs/heads/main` identically match the expected published SHA `9658548d2173dfc19a26f6434c6ed341632c9b2a`.
2. **Working-Tree Status:** The working tree contains zero staged changes and zero unstaged modifications to tracked files. The milestone audit report `reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md` (generated post-push in V.5.2.1.3) remains as an untracked file; per strict instructions, no `git clean`, `reset`, `stash`, `commit`, or `push` was performed.
3. **Actions Run-ID Reconciliation:** Authoritative GitHub REST API evidence confirmed that Run ID `43881315505` is the genuine run for checkout commit `4806632b0f2b9d0e1b32677202c120cde12fd9aa`, while `43883015962` is non-existent (HTTP 404). The publication report was corrected accordingly.
4. **Scope Invariants:** No code, tests, workflows, secrets, or ledgers were touched; no Git history mutations were performed; zero workflow dispatches were triggered.

---

## 2. Git Working-Tree Verification Outputs

The verification commands were executed in PowerShell on `D:\Projects\GitHub-Profile-Pet`.

### Exact Command Outputs

#### 1. `git status --short`
```text
?? reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md
```

#### 2. `git status -sb`
```text
## main...origin/main
?? reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md
```

#### 3. `git branch --show-current`
```text
main
```

#### 4. `git rev-parse HEAD`
```text
9658548d2173dfc19a26f6434c6ed341632c9b2a
```

#### 5. `git rev-parse origin/main`
```text
9658548d2173dfc19a26f6434c6ed341632c9b2a
```

#### 6. `git ls-remote origin refs/heads/main`
```text
9658548d2173dfc19a26f6434c6ed341632c9b2a	refs/heads/main
```

---

## 3. SHA Comparison & Working-Tree Analysis

| Item | Observed Value | Expected Value | Status |
|---|---|---|---|
| **Current Branch** | `main` | `main` | **MATCH** |
| **Local HEAD SHA** | `9658548d2173dfc19a26f6434c6ed341632c9b2a` | `9658548d2173dfc19a26f6434c6ed341632c9b2a` | **MATCH** |
| **Local `origin/main` SHA** | `9658548d2173dfc19a26f6434c6ed341632c9b2a` | `9658548d2173dfc19a26f6434c6ed341632c9b2a` | **MATCH** |
| **Remote `refs/heads/main`** | `9658548d2173dfc19a26f6434c6ed341632c9b2a` | `9658548d2173dfc19a26f6434c6ed341632c9b2a` | **MATCH** |
| **Staged Changes** | None (0 files) | None | **CLEAN** |
| **Unstaged Changes** | None (0 files) | None | **CLEAN** |
| **Untracked Files** | `reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md` | None | **DISCREPANCY NOTED** |

### Working-Tree Cleanliness Assessment
- `git status` confirms that tracked files have zero uncommitted modifications.
- The single untracked file `reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md` was authored as the deliverable of Phase 3C2.1-V.5.2.1.3 following the Git push.
- In strict adherence to the milestone instruction:
  > *"If any condition fails, do not reset, clean, stash, commit, or push. Report the exact discrepancy and stop."*
  no cleanup, reset, stash, commit, or push was performed.

---

## 4. Historical GitHub Actions Run-ID Reconciliation

### Investigation & Authoritative Evidence

The publication report `reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md` originally cited `43883015962` for the Phase 3C2.1-V.5.2 hosted Actions verification run.

Authoritative GitHub REST API endpoints were queried to establish ground truth:

#### 1. Querying Run `43883015962`:
```bash
curl -s "https://api.github.com/repos/mnp210/GitHub-Profile-Pet/actions/runs/43883015962"
```
**Result:**
```json
{
  "message": "Not Found",
  "documentation_url": "https://docs.github.com/rest/actions/workflow-runs#get-a-workflow-run",
  "status": "404"
}
```
Run `43883015962` does not exist.

#### 2. Querying Workflow Runs List (`/repos/mnp210/GitHub-Profile-Pet/actions/runs?per_page=10`):
All historical runs for the repository are:
| Run ID | Run # | Event | Checkout SHA | Status / Conclusion | Created At |
|---|---|---|---|---|---|
| `43884639634` | 3 | `workflow_dispatch` | `1dac52b469145d831f63f084b87d5b7d5c8db1b8` | completed / `success` | 2026-11-16T14:20:10Z |
| `43881315505` | 2 | `workflow_dispatch` | `4806632b0f2b9d0e1b32677202c120cde12fd9aa` | completed / `success` | 2026-11-16T14:00:33Z |
| `43881315505` (Job `133347645920`) | 2 | `workflow_dispatch` | `4806632b0f2b9d0e1b32677202c120cde12fd9aa` | completed / `success` | 2026-11-16T14:00:33Z |
| `43873237663` | 1 | `workflow_dispatch` | `ab2f88eaadd144cefbc2f9cfd359cf4c4707d870` | completed / `failure` | 2026-11-16T13:10:21Z |

#### 3. Inspection of Run `43881315505`:
```json
{
  "id": 43881315505,
  "name": "Diagnostics Contribution Probe",
  "head_sha": "4806632b0f2b9d0e1b32677202c120cde12fd9aa",
  "event": "workflow_dispatch",
  "conclusion": "success",
  "display_title": "Diagnostics Contribution Probe",
  "html_url": "https://github.com/mnp210/GitHub-Profile-Pet/actions/runs/43881315505",
  "jobs_url": "https://api.github.com/repos/mnp210/GitHub-Profile-Pet/actions/runs/43881315505/jobs"
}
```

This authoritatively confirms that:
- Workflow: `diagnostics-contribution-probe.yml` ("Diagnostics Contribution Probe")
- Trigger: `workflow_dispatch`
- Checkout commit: `4806632b0f2b9d0e1b32677202c120cde12fd9aa` (Phase 3C2.1-V.5.1 published baseline)
- Run ID: `43881315505`

### Report Reconciliation
- **File corrected:** `reports/phase_3c2_1_v5_2_1_3_controlled_publication_report.md` (and its brain artifact counterpart).
- **Line 37 amendment:**
  - Before: `Audit report for hosted Actions verification run #43883015962.`
  - After: `Audit report for hosted Actions verification run #43881315505.`

---

## 5. Scope Invariants & Boundaries Confirmation

- **Application code, tests, workflows, pet state, ledgers, or schemas modified:** None (0).
- **Git commits created:** 0.
- **Git pushes executed:** 0.
- **Git resets, cleans, stashes, or history rewrites:** None (0).
- **Workflow dispatches executed:** 0.
- **Secrets, permissions, or credentials modified:** None.
- **Phase 3C2.2 status:** Strictly uninitiated.
