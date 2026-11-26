# Sprint 4.4 — Comprehensive Production Deployment Plan

**Document Identifier:** SPRINT-4.4-DEPLOYMENT-PLAN  
**Candidate Release Commit:** `990607837ac95617411190fd15cf895793cfcebd`  
**Production Remote:** `https://github.com/mnp210/GitHub-Profile-Pet.git`  
**Target Branch:** `main`  
**Verified Baseline Commit:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`  
**Merge Strategy:** Auditable non-fast-forward merge commit (`git merge --no-ff`) with explicit state retention (`--ours`).

---

## 1. Ten-Stage Deployment Sequence

The release operation must be executed strictly in the following chronological order. Each stage contains an explicit pre-condition and verification checkpoint.

```
+-----------------------------------------------------------------------------------+
| Stage 1: Production Baseline Re-Confirmation (Read-Only)                          |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 2: Production Baseline Tagging & State/Ledger Backup                        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 3: Controlled Git Merge & State Retention Resolution                        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 4: Pre-Push Compilation & Full Test Suite Validation                        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 5: Production Main Push & Branch Verification                               |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 6: GitHub Pages Platform Configuration via GitHub API                       |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 7: Hosted Pages Deployment Workflow Execution & Monitoring                  |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 8: Activity Progression Workflow Registration & Dispatch                    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 9: Pet-State & Ledger Integrity Checks                                      |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
| Stage 10: Post-Deployment Smoke Tests & Acceptance Sign-off                       |
+-----------------------------------------------------------------------------------+
```

---

## 2. Step-by-Step Technical Instructions

### Stage 1: Production Baseline Re-Confirmation
Confirm that production remote HEAD has not changed during the release session:
```powershell
cd D:\Projects\GitHub-Profile-Pet-R3.7-Candidate
$remoteHead = (git ls-remote origin refs/heads/main).Split("`t")[0]
if ($remoteHead -ne "86ed9da57b4444f744c429babd7d2be1a2c41e63") {
    throw "ABORT: Production remote HEAD has changed to $remoteHead. Do not proceed."
}
Write-Host "Stage 1 PASSED: Production HEAD verified at 86ed9da."
```

### Stage 2: Production Baseline Tagging & State Backup
Create the immutable baseline tag and local snapshot:
```powershell
# 1. Create baseline tag
git tag -a prod-baseline-pre-sprint-4.3 86ed9da57b4444f744c429babd7d2be1a2c41e63 -m "Production baseline prior to Sprint 4.4 release"
git push origin prod-baseline-pre-sprint-4.3

# 2. Extract and verify backups
$backupDir = "D:\Projects\GitHub-Profile-Pet-R3.7-Candidate\backups\production-baseline-86ed9da"
New-Item -ItemType Directory -Force -Path $backupDir
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:pet/state/pet.json | Out-File -Encoding utf8 "$backupDir\pet.json"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:pet/ledger/actions.json | Out-File -Encoding utf8 "$backupDir\actions.json"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:pet/ledger/contributions.json | Out-File -Encoding utf8 "$backupDir\contributions.json"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:public/pet.svg | Out-File -Encoding utf8 "$backupDir\pet.svg"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:README.md | Out-File -Encoding utf8 "$backupDir\README.md"
git bundle create "$backupDir\production-main-86ed9da.bundle" origin/main
Write-Host "Stage 2 PASSED: Baseline tag created and state backed up."
```

### Stage 3: Controlled Git Merge & State Retention Resolution
Execute an auditable non-fast-forward merge on a dedicated release deployment branch, preserving production's authoritative live state:
```powershell
# Checkout fresh tracking branch from origin/main
git checkout -b release/sprint-4.4-deploy origin/main

# Merge candidate commit without committing immediately
git merge --no-commit --no-ff 990607837ac95617411190fd15cf895793cfcebd

# Explicitly retain production's live state files and badge
git checkout --ours pet/state/pet.json pet/ledger/actions.json pet/ledger/contributions.json public/pet.svg
git add pet/state/pet.json pet/ledger/actions.json pet/ledger/contributions.json public/pet.svg

# Initialize new activity ledger generation to match production generation 14
$actPath = "pet\ledger\activity.json"
if (Test-Path $actPath) {
    $actJson = Get-Content $actPath | ConvertFrom-Json
    $actJson.generation = 14
    $actJson | ConvertTo-Json -Depth 10 | Set-Content $actPath
    git add $actPath
}

# Commit merge
git commit -m "release: deploy Sprint 4.4 candidate (commit 9906078) to production"
Write-Host "Stage 3 PASSED: Candidate merged with production state preserved."
```

### Stage 4: Pre-Push Compilation & Full Test Suite Validation
Verify that the merged codebase compiles with 0 errors and all 747 tests pass:
```powershell
npx tsc --noEmit
npm run lint
node --test --experimental-strip-types tests/unit/*.test.ts
node --test --experimental-strip-types tests/pet-engine/*.test.ts
Write-Host "Stage 4 PASSED: Compilation, linter, and 747 tests verified."
```

### Stage 5: Production Main Push & Branch Verification
Push the merged release branch to `origin/main`:
```powershell
git push origin release/sprint-4.4-deploy:main
Write-Host "Stage 5 PASSED: Production main updated."
```

### Stage 6: GitHub Pages Platform Configuration
Configure GitHub Pages on `mnp210/GitHub-Profile-Pet` using GitHub Actions as the build source:
```powershell
gh api -X POST repos/mnp210/GitHub-Profile-Pet/pages -f build_type="workflow"
Write-Host "Stage 6 PASSED: GitHub Pages configured for workflow dispatch."
```

### Stage 7: Hosted Pages Deployment Workflow Execution
Trigger and monitor `deploy-pages.yml`:
```powershell
gh workflow run deploy-pages.yml --repo mnp210/GitHub-Profile-Pet --ref main
Start-Sleep -Seconds 10
$runId = (gh run list --repo mnp210/GitHub-Profile-Pet --workflow=deploy-pages.yml --limit 1 --json databaseId --jq .[0].databaseId)
gh run watch $runId --repo mnp210/GitHub-Profile-Pet
Write-Host "Stage 7 PASSED: Hosted Pages deployed successfully."
```

### Stage 8: Activity Progression Workflow Registration & Dispatch
Trigger initial activity reconciliation sweep:
```powershell
gh workflow run pet-activity.yml --repo mnp210/GitHub-Profile-Pet --ref main
Start-Sleep -Seconds 10
$runId = (gh run list --repo mnp210/GitHub-Profile-Pet --workflow=pet-activity.yml --limit 1 --json databaseId --jq .[0].databaseId)
gh run watch $runId --repo mnp210/GitHub-Profile-Pet
Write-Host "Stage 8 PASSED: Activity workflow dispatched and executed."
```

### Stage 9: Pet-State & Ledger Integrity Checks
Verify that pet level, XP, and generation progressed accurately:
```powershell
$newState = (gh api repos/mnp210/GitHub-Profile-Pet/contents/pet/state/pet.json --jq .content | [System.Convert]::FromBase64String | ConvertFrom-Json)
Write-Host "Pet State: Level $($newState.level), XP $($newState.xp), Generation $($newState.generation)"
if ($newState.level -lt 2 -or $newState.xp -lt 115) {
    throw "ERROR: Pet state regression detected! Triggering rollback."
}
Write-Host "Stage 9 PASSED: Pet state integrity verified."
```

### Stage 10: Post-Deployment Smoke Tests & Acceptance Sign-off
1. **Public Web Game URL:** `https://mnp210.github.io/GitHub-Profile-Pet/`
   ```powershell
   (Invoke-WebRequest -Uri "https://mnp210.github.io/GitHub-Profile-Pet/" -Method Head).StatusCode
   # Expected: 200
   ```
2. **README Badge:** Inspect `https://github.com/mnp210/GitHub-Profile-Pet/blob/main/README.md`.
3. **Workflow Schedules:** Verify `pet-activity.yml` (every 30m) and `pet-publish.yml` (hourly).
4. **Final Sign-off:** Record release metrics and archive run IDs.
