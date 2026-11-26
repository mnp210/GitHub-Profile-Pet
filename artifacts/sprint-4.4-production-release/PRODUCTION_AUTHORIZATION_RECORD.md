# Sprint 4.4 — Production Release Authorization Record

**Document Identifier:** SPRINT-4.4-AUTH-RECORD  
**Candidate Commit SHA:** `990607837ac95617411190fd15cf895793cfcebd`  
**Production Remote:** `mnp210/GitHub-Profile-Pet`  
**Production Baseline SHA:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`  
**Authorization Status:** **PENDING OPERATOR EXPLICIT AUTHORIZATION**

---

## 1. Summary of Release Parameters

- **Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Candidate Commit:** `990607837ac95617411190fd15cf895793cfcebd`
- **Production Baseline Commit:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`
- **Divergence:** Candidate has 19 feature/hardening commits; Production has 10 automated publisher commits. Common ancestor: `b7b3bd8`.
- **Files & Workflows Introduced:**
  - 6 GitHub Actions workflows (`deploy-pages.yml`, `pet-activity.yml`, `pet-publish.yml`, `pet-action-inbox.yml`, `diagnostics.yml`, `ci.yml`).
  - Next.js 16.4.6 static export web game with Web Audio API sound synthesis and procedural pixel-art engine.
  - Interval-index permanent event deduplication engine (`src/features/pet-engine/activity/`).
  - Activity ledger schema (`pet/schemas/activity.schema.json`) and initialized ledger (`pet/ledger/activity.json`).
  - 747 automated test suites (200 unit tests, 547 pet engine tests).
- **Expected Production State Changes:**
  - Existing live pet (`Shadow Claw`, Level 2, 115 XP, Generation 14) and existing contribution ledgers are **100% PRESERVED** via `--ours` merge resolution.
  - `pet/ledger/activity.json` is initialized with `generation: 14` and will begin recording developer commits, issues, PRs, and reviews.
  - GitHub Pages will be activated on public production repo hosting `https://mnp210.github.io/GitHub-Profile-Pet/`.
- **Backup Locations:**
  - Local directory: `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate\backups\production-baseline-86ed9da/`
  - Git bundle: `production-main-86ed9da.bundle`
  - Tag: `prod-baseline-pre-sprint-4.3` (pointing to `86ed9da57b4444f744c429babd7d2be1a2c41e63`)
- **Rollback Target:**
  - Fast-rollback: `git push origin +prod-baseline-pre-sprint-4.3:main` (< 30 seconds RTO)
  - Code revert commit: `git revert -m 1 <MERGE_COMMIT_SHA>` (< 2 minutes RTO)
- **Remaining Operational Risks:**
  - Zero critical risks unresolved. All 11 release gates evaluated as PASS.

---

## 2. Operations to be Executed Upon Receipt of Explicit Authorization

1. Re-verify production baseline HEAD remains at `86ed9da57b4444f744c429babd7d2be1a2c41e63`.
2. Tag production baseline: `git tag -a prod-baseline-pre-sprint-4.3 86ed9da -m "Pre-4.4 baseline"` and push tag to `origin`.
3. Extract full backup snapshot and Git bundle to `backups/production-baseline-86ed9da/`.
4. Create release branch `release/sprint-4.4-deploy` from `origin/main` and merge candidate `990607837ac95617411190fd15cf895793cfcebd`.
5. Retain production state files (`pet/state/pet.json`, `pet/ledger/actions.json`, `pet/ledger/contributions.json`, `public/pet.svg`) via `--ours`.
6. Run full verification suite (`tsc`, `lint`, 747 tests).
7. Push merged branch to `origin/main`.
8. Configure GitHub Pages build source to GitHub Actions via GitHub API.
9. Dispatch and monitor `deploy-pages.yml` workflow.
10. Dispatch and monitor `pet-activity.yml` workflow.
11. Inspect post-release pet state and execute public smoke tests.
12. Generate Sprint 4.4 Final Post-Deployment Report.

---

## 3. Required Operator Authorization Statement

To authorize execution of the production deployment, the operator must provide the following exact confirmation statement:

> **"I have reviewed the Sprint 4.4 release plan. I explicitly authorize the controlled production release of candidate commit 990607837ac95617411190fd15cf895793cfcebd to mnp210/GitHub-Profile-Pet, subject to the documented backup, integrity, and rollback safeguards."**
