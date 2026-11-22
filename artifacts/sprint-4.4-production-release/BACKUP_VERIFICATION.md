# Sprint 4.4 — Pre-Release Backup & State Preservation Verification

**Document Date:** November 22, 2026  
**Target Repository:** `mnp210/GitHub-Profile-Pet`  
**Production Baseline Commit:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`  
**Backup Status:** **READY FOR EXECUTION UPON AUTHORIZATION**

---

## 1. Scope of Pre-Release Production Backup

Before any production-modifying command is executed, an immutable, multi-layered backup must be saved locally and verified.

### 1.1 Critical Files Requiring Dedicated Backup
1. `pet/state/pet.json` (authoritative pet level, XP, hunger, mood, generation)
2. `pet/ledger/actions.json` (care action request registry, high-water mark)
3. `pet/ledger/contributions.json` (daily contribution counts and reward history)
4. `public/pet.svg` (rendered companion visual badge)
5. `README.md` (authoritative interactive README with action links)

### 1.2 Git History & Full Repository Tree Backup
In addition to individual JSON state files, a full Git bundle and local tracking branch must be created:
- Tracking ref: `refs/remotes/origin/main` (pinned at `86ed9da57b4444f744c429babd7d2be1a2c41e63`)
- Git bundle: `backups/production-baseline-86ed9da.bundle`

---

## 2. Backup Execution Runbook (Phase 1 of Release)

The following commands will be executed as Step 1 of the authorized release:

```powershell
# 1. Create dedicated backup directory
$backupDir = "D:\Projects\GitHub-Profile-Pet-R3.7-Candidate\backups\production-baseline-86ed9da"
New-Item -ItemType Directory -Force -Path $backupDir

# 2. Extract authoritative files directly from production remote commit 86ed9da
cd D:\Projects\GitHub-Profile-Pet-R3.7-Candidate
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:pet/state/pet.json | Out-File -Encoding utf8 "$backupDir\pet.json"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:pet/ledger/actions.json | Out-File -Encoding utf8 "$backupDir\actions.json"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:pet/ledger/contributions.json | Out-File -Encoding utf8 "$backupDir\contributions.json"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:public/pet.svg | Out-File -Encoding utf8 "$backupDir\pet.svg"
git show 86ed9da57b4444f744c429babd7d2be1a2c41e63:README.md | Out-File -Encoding utf8 "$backupDir\README.md"

# 3. Create full Git repository bundle of production main
git bundle create "$backupDir\production-main-86ed9da.bundle" origin/main

# 4. Create immutable local reference branch
git branch backup/prod-86ed9da origin/main
```

---

## 3. Backup Integrity Verification Protocol

Immediately after creating the backup, verify file integrity:
1. **JSON Validation:**
   ```powershell
   Get-Content "$backupDir\pet.json" | ConvertFrom-Json | Select-Object schemaVersion, generation, name, level, xp
   Get-Content "$backupDir\actions.json" | ConvertFrom-Json | Select-Object schemaVersion, generation
   Get-Content "$backupDir\contributions.json" | ConvertFrom-Json | Select-Object schemaVersion, generation, ownerLogin
   ```
   *Expected values:* `generation: 14`, `level: 2`, `xp: 115`, `ownerLogin: "mnp210"`.
2. **Bundle Verification:**
   ```powershell
   git bundle verify "$backupDir\production-main-86ed9da.bundle"
   ```
   *Expected result:* The bundle header is valid and points to `86ed9da57b4444f744c429babd7d2be1a2c41e63`.

---

## 4. Restoration Verification

If data restoration is required without full branch rollback:
```powershell
# Restore authoritative production state files from verified backup
Copy-Item "$backupDir\pet.json" "pet\state\pet.json" -Force
Copy-Item "$backupDir\actions.json" "pet\ledger\actions.json" -Force
Copy-Item "$backupDir\contributions.json" "pet\ledger\contributions.json" -Force
Copy-Item "$backupDir\pet.svg" "public\pet.svg" -Force
Copy-Item "$backupDir\README.md" "README.md" -Force
```

This guarantees 100% data recoverability within seconds.
