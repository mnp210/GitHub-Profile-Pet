# Phase 3C2.3-B2-R3.30 — Upstream Integration Preflight

**Preflight Execution Timestamp:** 2026-11-19T15:40:00+05:30  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Active Branch:** `phase-3c2-3-b2-r3-7-candidate`  
**Candidate HEAD SHA:** `c55454d7fc7de66a2435e52feaa5ccad1c60b498`  
**Candidate Implementation Commit:** `03d366d6e797937318afb2a4af6d3cf5f537b46b`  
**Common Merge Base SHA:** `83bdf87216271bbdea142c2f2921bd326b599f42`  
**Locally Cached Production `origin/main`:** `f838b3bb3291fdfd99c981985632b6e0d7191322`  
**Preflight Mode:** STRICTLY READ-ONLY (0 mutations, 0 staged files, 0 remote operations)

---

## 1. Executive Summary & Verdict

| Preflight Dimension | Verified State / Analysis | Integration Status |
| :--- | :--- | :--- |
| **Candidate Lineage** | 2 commits ahead of base: `03d366d` (impl) -> `c55454d` (reports) | ✅ Verified clean |
| **Common Merge Base** | `83bdf87216271bbdea142c2f2921bd326b599f42` | ✅ Verified exact match |
| **Production Divergence** | Exactly 1 commit on production: `f838b3bb3291fdfd99c981985632b6e0d7191322` | ✅ Verified (`[skip ci]`) |
| **File Overlap Analysis** | **0 overlapping files** between candidate (39 files) and production (4 files) | ✅ Zero conflict surface |
| **Merge Simulation (`git merge-tree`)** | **100% clean merge**; 0 conflicts; live state seamlessly preserved | ✅ Verified conflict-free |
| **Workflow Trigger Safety** | No new triggers or automated activations; baseline workflow dispatch-only | ✅ Verified safe |
| **Integration Strategy** | Controlled Merge Commit (`git merge --no-ff`) recommended | ✅ Strategy established |
| **Third-Party Fork Config** | Zero required secrets; optional org variables (`PET_OWNER_*`, `PET_ADMIN_*`) | ✅ Documented |

### Official Verdict
```
PASS — UPSTREAM INTEGRATION STRATEGY ESTABLISHED
```

---

## 2. Ancestry & Commit Graph Analysis

### A. Graph Lineage & SHA Map
```
                  (Candidate Branch)
                  c55454d7fc7de66a2435e52feaa5ccad1c60b498 [HEAD] (docs: archive 11 reports)
                 /
                03d366d6e797937318afb2a4af6d3cf5f537b46b (feat: 28 implementation files)
               /
... 83bdf87216271bbdea142c2f2921bd326b599f42 [Common Merge Base]
               \
                f838b3bb3291fdfd99c981985632b6e0d7191322 [origin/main] (pet: update state [skip ci])
                  (Production Remote)
```

### B. Ancestry Checks
1. `git merge-base HEAD origin/main`: Returns `83bdf87216271bbdea142c2f2921bd326b599f42`.
2. `git merge-base --is-ancestor origin/main HEAD`: Exit code `1` (Production is **NOT** an ancestor of candidate).
3. `git merge-base --is-ancestor HEAD origin/main`: Exit code `1` (Candidate is **NOT** an ancestor of production).
4. **Conclusion:** Candidate and production have diverged from the common base `83bdf87216271bbdea142c2f2921bd326b599f42`. A pure fast-forward (`git merge --ff-only`) is not possible without history rewriting.

---

## 3. Disjoint Changeset & Conflict Inspection

### A. Production-Only Changes Since Common Base (1 Commit)
- **Commit SHA:** `f838b3bb3291fdfd99c981985632b6e0d7191322`
- **Subject:** `pet: update state and visual badge [skip ci]`
- **Files Modified (4 files):**
  1. `pet/ledger/actions.json` (state update: generation 2 -> 3)
  2. `pet/ledger/contributions.json` (state update: generation 2 -> 3, 4 slices rewarded)
  3. `pet/state/pet.json` (state update: generation 2 -> 3, 55 XP, hunger 83, joy 65)
  4. `public/pet.svg` (visual badge update reflecting 55 XP)

### B. Candidate-Only Changes Since Common Base (2 Commits)
- **Implementation Commit `03d366d`:** 28 files modified/added across workflows, pipelines, core engine, validation, templates, tests, and operational documentation.
- **Archive Commit `c55454d`:** 11 engineering reports added under `reports/`.
- **Total candidate files:** 39 files.

### C. Overlap & Conflict Assessment
- **Set Intersection:** $\text{Files}(\text{Production}) \cap \text{Files}(\text{Candidate}) = \emptyset$ (**0 overlapping files**).
- **Merge Simulation:** Execution of `git merge-tree 83bdf87216271bbdea142c2f2921bd326b599f42 HEAD origin/main` succeeded with exit code 0.
- **State Integrity:** The merge simulation cleanly combines all 39 candidate files while preserving production's Generation 3 live state (`55 XP`, `generation: 3`, rewarded slices).

---

## 4. Production Workflow Activation & Safety Audit

1. **Workflow Triggers Analysis:**
   - `.github/workflows/pet-baseline.yml`: Strictly `workflow_dispatch`. Cannot trigger automatically on push, merge, schedule, or issue.
   - `.github/workflows/diagnostics-contribution-probe.yml`: Strictly `workflow_dispatch`.
   - `.github/workflows/pet-publisher.yml`: Triggered on cron schedule (`cron: '47 * * * *'`), `workflow_dispatch`, and `repository_dispatch`. Trigger events are identical to common base.
   - `.github/workflows/pet-interaction.yml`: Triggered on cron schedule (`cron: '47 * * * *'`), `workflow_dispatch`, and `issues`. Trigger events are identical to common base.
2. **Behavioral Impact of Candidate Changes on Production:**
   - In production, `pet/ledger/contributions.json` already contains `ownerDatabaseId: 298821706` and `ownerLogin: "mnp210"`.
   - The candidate's dynamic identity resolver evaluates `${{ github.repository_owner }}` (`mnp210`) and `${{ github.repository_owner_id }}` (`298821706`), which matches the established ledger identity exactly.
   - Therefore, ordinary production scheduled runs will continue to operate normally with zero interruption.

---

## 5. Controlled Integration Strategy Comparison

| Integration Strategy | Mechanics | Pros | Cons / Risks | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Strategy A: Merge Commit (`git merge --no-ff`)** | Merge candidate into `main` generating an explicit merge commit | Preserves exact audited commit SHAs (`03d366d` & `c55454d`); 100% conflict-free; clear audit boundary | Adds one merge commit to `main` history | **RECOMMENDED** |
| **Strategy B: Pull Request on GitHub** | Push candidate branch to remote; merge via standard GitHub PR | Native GitHub PR review audit trail, CI checks run on PR head | Requires pushing candidate branch to remote first | **RECOMMENDED ALTERNATIVE** |
| **Strategy C: Rebase Candidate onto Production** | Rebase `03d366d` and `c55454d` onto `f838b3b`, then fast-forward | Linear history on `main` | Rewrites commit SHAs; invalidates SHAs recorded in R3.27–R3.29 audit reports | **NOT RECOMMENDED** |

---

## 6. Configuration & Variables Requirements for Third-Party Forks

- **Personal Repositories:**  
  Zero configuration required. Dynamic context `${{ github.repository_owner }}` and `${{ github.repository_owner_id }}` automatically resolves identity for personal installations.
- **Organization Repositories (Optional Overrides):**  
  If deployed under a GitHub Organization, the following repository variables may be configured in **Settings > Secrets and variables > Actions > Variables**:
  - `PET_OWNER_LOGIN`: Trainer username.
  - `PET_OWNER_DATABASE_ID`: Trainer numeric GitHub database ID.
  - `PET_ADMIN_LOGIN`: Administrator username authorized to dispatch admin commands.
  - `PET_ADMIN_DATABASE_ID`: Administrator numeric database ID.

---

## 7. Remote Freshness Limitations & Prerequisites

- **Locally Cached Ref:** `origin/main` = `f838b3bb3291fdfd99c981985632b6e0d7191322`.
- **Limitation:** In strict adherence to read-only constraints, no remote network calls (`git fetch`) were made.
- **Prerequisite for Execution:** Prior to performing the integration, an authorized network query (`git fetch origin main` or GitHub API check) must be performed to confirm whether any new commit has landed on production `main` since `f838b3bb3291fdfd99c981985632b6e0d7191322`.
