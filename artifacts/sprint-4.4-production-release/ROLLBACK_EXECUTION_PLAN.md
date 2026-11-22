# Sprint 4.4 — Comprehensive Rollback & Disaster Recovery Execution Plan

**Document Identifier:** SPRINT-4.4-ROLLBACK-RUNBOOK  
**Pre-Release Baseline SHA:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`  
**Planned Rollback Tag:** `prod-baseline-pre-sprint-4.3` (to be created on `86ed9da` as first authorized step)  
**Target Recovery Time Objective (RTO):** < 2 minutes  
**Target Recovery Point Objective (RPO):** Zero state or XP loss

---

## 1. Independent Tag Status Verification

Prior to release planning, the repository was queried to verify whether `prod-baseline-pre-sprint-4.3` already existed:
```powershell
git tag -l
git ls-remote --tags origin
# Output: (empty)
```
**Finding:** The tag does NOT yet exist on local or remote.
**Action:** As the first authorized step of Phase 1, `prod-baseline-pre-sprint-4.3` will be explicitly created and pushed to `origin`, pointing immutably to `86ed9da57b4444f744c429babd7d2be1a2c41e63`.

---

## 2. Decoupled Recovery Architecture: Application vs. Data Rollback

A critical failure mode during release incidents is restoring old snapshot files over new user activity, destroying data created between release and incident detection.

The GitHub Profile Pet rollback architecture strictly separates **Application Rollback** from **Data Reconciliation**:

```
                       [Incident Detected]
                               |
               +---------------+---------------+
               |                               |
       [Application Failure]            [Data Corruption]
               |                               |
    Step 1: Disable Workflows        Step 1: Disable Workflows
    Step 2: Revert Release Commit    Step 2: Compare Current State
    Step 3: Redeploy Pages                   vs. Backup Snapshot
    Step 4: Keep Live Pet State      Step 3: Reconcile Missing XP
                                     Step 4: Commit Reconciled State
```

---

## 3. Scenario A: Application Rollback (Code/Pages/Workflow Defect)

Use this scenario if the Next.js web application crashes, GitHub Pages throws 404/500 errors, or GitHub Actions workflows encounter unexpected runtime exceptions, **while pet state and ledgers remain intact or progressed**.

### Step 1: Immediately Disable Production Workflows
Prevent automated runners from executing during remediation:
```powershell
gh workflow disable pet-activity.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-publish.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-action-inbox.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable deploy-pages.yml --repo mnp210/GitHub-Profile-Pet
```

### Step 2: Roll Back Application Code via Revert Commit
Do NOT force-push or reset history. Create an explicit, auditable revert commit on `main`:
```powershell
cd D:\Projects\GitHub-Profile-Pet-R3.7-Candidate
git fetch origin main
git checkout main
git revert -m 1 <MERGE_COMMIT_SHA> -m "revert: Roll back Sprint 4.4 release candidate due to application incident"
git push origin main
```

### Step 3: Trigger Immediate Pages Redeployment
Ensure the previous stable static site is re-hosted:
```powershell
gh workflow run deploy-pages.yml --ref main
```

---

## 4. Scenario B: Data Rollback & Reconciliation (Corrupted Pet State)

Use this scenario only if `pet/state/pet.json` or activity ledgers were corrupted or awarded improper XP.

### Step 1: Immediately Disable Production Workflows
```powershell
gh workflow disable pet-activity.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-publish.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-action-inbox.yml --repo mnp210/GitHub-Profile-Pet
```

### Step 2: Extract Live Production State
```powershell
git fetch origin main
$liveStateRaw = git show origin/main:pet/state/pet.json | ConvertFrom-Json
$backupStateRaw = Get-Content "backups\production-baseline-86ed9da\pet.json" | ConvertFrom-Json
```

### Step 3: Reconciliation Decision Matrix
- **If corruption was total (unparseable JSON / invalid schema):**
  Restore the verified pre-release backup:
  ```powershell
  Copy-Item "backups\production-baseline-86ed9da\pet.json" "pet\state\pet.json" -Force
  Copy-Item "backups\production-baseline-86ed9da\actions.json" "pet\ledger\actions.json" -Force
  Copy-Item "backups\production-baseline-86ed9da\contributions.json" "pet\ledger\contributions.json" -Force
  git add pet/
  git commit -m "fix(pet): restore verified pre-4.4 state baseline"
  git push origin main
  ```
- **If new legitimate commits/activity occurred during the release window:**
  Run the activity processor with `--reconcile-only` against the backup baseline:
  ```powershell
  node --experimental-strip-types scripts/process-activity.ts --ref main
  git push origin main
  ```

### Step 4: Re-enable Production Workflows
```powershell
gh workflow enable pet-activity.yml --repo mnp210/GitHub-Profile-Pet
gh workflow enable pet-publish.yml --repo mnp210/GitHub-Profile-Pet
gh workflow enable pet-action-inbox.yml --repo mnp210/GitHub-Profile-Pet
```

---

## 5. Scenario C: Emergency Git Ref Rollback (Full Fast-Rollback)

If both code and state must be reset immediately to the exact pre-release baseline:
```powershell
# Point production main directly back to the verified baseline tag
git push origin +prod-baseline-pre-sprint-4.3:main
```
*Time to execute:* **< 30 seconds.**

---

## 6. Post-Rollback Verification Smoke Tests

Following any rollback execution, run the following verification checklist:
1. `git ls-remote origin refs/heads/main` points to the expected commit.
2. `gh api repos/mnp210/GitHub-Profile-Pet/contents/pet/state/pet.json --jq .content | [System.Convert]::FromBase64String | ConvertFrom-Json` returns `generation >= 14`, `level: 2`, `xp: 115`.
3. `gh run list --repo mnp210/GitHub-Profile-Pet --limit 3` shows no failing runner runs.
4. `Invoke-WebRequest -Uri "https://mnp210.github.io/GitHub-Profile-Pet/" -Method Head` returns `200 OK`.
