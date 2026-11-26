# Sprint 5.2D — Production Rollback and State Recovery Plan

**Date:** 2026-11-24  
**Auditor:** Antigravity Autonomous Agent  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Proposed Release Commit:** `7d9ea7db6e4252726555340ccb71717f2359a4e9`  
**Current Production HEAD:** `062da379b8fe35b7d1dd4b7753778588fefab897`  
**Existing Production Baseline Tag:** `prod-baseline-pre-sprint-4.3` (`3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`)  
**Recovery Core Rule:** Never blindly restore old pet state or ledgers when rolling back application code.

---

## 1. Baseline Reference Fingerprints

Before any release operation is authorized, snapshot the exact production state fingerprints:

| Entity | Identifier / Commit / Blob SHA | Notes |
| :--- | :--- | :--- |
| **Production HEAD** | `062da379b8fe35b7d1dd4b7753778588fefab897` | Commit before release merge |
| **Historical Baseline Tag** | `prod-baseline-pre-sprint-4.3` (`3c7fc20`) | Pre-Sprint 4.3 snapshot |
| **Live `pet/state/pet.json`** | `df19d9882dc968fe46b39576c6ef864aa26cce2f` | Shadow Claw Level 4, 90/400 XP, Gen 42 |
| **Live `pet/ledger/activity.json`** | `9853f8da5db99988a6312b5ec3b6f1fba8661212` | High-water mark & commit logs |
| **Live `pet/ledger/actions.json`** | `e27538735c8d9f7ef49872c8f63dd9b5e6ce2799` | Care action issue high-water mark |
| **Live `pet/ledger/contributions.json`** | `bdb0ade4836a7b8ada4a6aa4d6d17121730d9dd2` | Daily contribution telemetry |
| **Live `public/pet.svg`** | `7bf3946187b7af3a14bc1ebe5ddd6dfcd2ea53c4` | Published SVG badge |

---

## 2. Decoupled Rollback Domains

Failures in production must be triaged into four independent domains to prevent collateral data loss:

```
┌────────────────────────────────────────────────────────┐
│                   INCIDENT DETECTION                   │
└───────────────────────────┬────────────────────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Domain 1:   │     │  Domain 2:   │     │  Domain 3:   │
│ Application  │     │ Static Pages │     │  Pet State   │
│ Code Defect  │     │ Deploy Break │     │  Corrupted   │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## 3. Rollback Procedures by Domain

### Domain 1: Application-Code Rollback (Reverting Next.js / Subsystems)
*Trigger:* Client-side runtime exception, game crash, or broken UI behavior reported on GitHub Pages.
*Objective:* Revert frontend codebase to pre-release state while leaving live pet state and ledgers completely intact.

**Procedure:**
1. Revert application code commits on `main` using `git revert`:
   ```bash
   git revert -m 1 <release_merge_commit_sha> --no-commit
   ```
2. **Mandatory Checkout of Live State:** Explicitly checkout the live state documents to ensure they are NOT reverted:
   ```bash
   git checkout HEAD -- pet/state/pet.json pet/ledger/ public/pet.svg
   ```
3. Commit the revert:
   ```bash
   git commit -m "revert: rollback playable edition application code while preserving live pet state"
   git push origin main
   ```
4. `deploy-pages.yml` automatically triggers and redeploys the stable pre-release static bundle.

### Domain 2: Static Deployment Rollback (GitHub Pages Artifact Failure)
*Trigger:* Next.js build error on GitHub Actions, asset 404s, or GitHub Pages deployment failure.
*Objective:* Re-deploy previous working Pages artifact without touching the repository `main` branch.

**Procedure:**
1. In the GitHub repository Actions tab, navigate to the previous successful `Deploy Playable Game to GitHub Pages` run.
2. If re-running the prior deployment is supported, re-deploy the previous Pages artifact.
3. If not, trigger a hotfix commit or revert as detailed in Domain 1.

### Domain 3: Pet State & Ledger Corruption Recovery
*Trigger:* Backend cron error or schema validation failure.
*Objective:* Recover pet state without replaying contribution rewards or wiping XP.

**Procedure:**
1. Retrieve the last known healthy state document from Git history (`df19d98`):
   ```bash
   git show df19d9882dc968fe46b39576c6ef864aa26cce2f > pet/state/pet.json
   ```
2. Validate against schema:
   ```bash
   node -e "require('./src/features/pet-engine/validation/stateValidator.ts')"
   ```
3. Do NOT wipe `pet/ledger/activity.json`. The activity ledger contains the `processedCommitShas` list and high-water mark. Keeping the ledger prevents re-awarding duplicate XP for historical commits.
4. Commit recovery:
   ```bash
   git add pet/state/pet.json
   git commit -m "fix(pet-state): restore state to healthy checkpoint df19d98 [skip ci]"
   git push origin main
   ```

---

## 4. Failure Detection & Health Criteria

A deployment is considered **failed** and requires immediate rollback if:
1. `deploy-pages.yml` finishes with conclusion `failure` or `timed_out`.
2. `https://mnp210.github.io/GitHub-Profile-Pet/` returns HTTP $4xx$ or $5xx$, or a blank screen with JavaScript console errors.
3. The pet display displays Level 1 or 3 (indicating state overwriting/reset).
4. Automated workflows (`pet-activity.yml`, `pet-publisher.yml`) fail with schema validation errors.
