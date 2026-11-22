# Sprint 4.3 — Production Release Checklist

This checklist provides the authoritative operational runbook for releasing GitHub Profile Pet candidate commit `990607837ac95617411190fd15cf895793cfcebd` into the production repository `mnp210/GitHub-Profile-Pet`.

Every step must be executed in order. Do not skip any verification check.

---

## Phase 0: Pre-Flight Gate & Verification

Before modifying any remote production branch or settings, verify the candidate environment and production baseline.

- [ ] **0.1 Verify Local Candidate Cleanliness**
  ```powershell
  cd D:\Projects\GitHub-Profile-Pet-R3.7-Candidate
  git status --porcelain
  # Expected output: (empty - clean working directory)
  ```
- [ ] **0.2 Verify Candidate HEAD Commit**
  ```powershell
  git rev-parse HEAD
  # Expected: 990607837ac95617411190fd15cf895793cfcebd
  ```
- [ ] **0.3 Verify Production Remote Reference (Read-Only)**
  ```powershell
  git fetch origin main --dry-run
  git rev-parse origin/main
  # Expected: 86ed9da57b4444f744c429babd7d2be1a2c41e63
  ```
- [ ] **0.4 Run Local Full Test Suite Sanity Check**
  ```powershell
  node --test --experimental-strip-types tests/unit/*.test.ts
  node --test --experimental-strip-types tests/pet-engine/*.test.ts
  # Expected: 200/200 unit tests passing, 547/547 engine tests passing
  ```
- [ ] **0.5 Verify Secret Scanner Cleanliness**
  ```powershell
  Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|artifacts|tests\\fixtures)\\' } | Select-String -Pattern "ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}"
  # Expected: (empty - zero exposed tokens)
  ```

---

## Phase 1: Production Baseline Preservation

Before merging, create an immutable baseline tag and backup the existing production state.

- [ ] **1.1 Tag Current Production Baseline**
  ```powershell
  git tag -a prod-baseline-pre-sprint-4.3 86ed9da57b4444f744c429babd7d2be1a2c41e63 -m "Production baseline state prior to Sprint 4.3 release"
  git push origin prod-baseline-pre-sprint-4.3
  # Confirms tag creation on remote production
  ```
- [ ] **1.2 Download & Archive Authoritative Production State**
  ```powershell
  $backupDir = "D:\Projects\GitHub-Profile-Pet-R3.7-Candidate\backups\production-pre-4.3"
  New-Item -ItemType Directory -Force -Path $backupDir
  gh api repos/mnp210/GitHub-Profile-Pet/contents/data/pet-state.json --jq .content | [System.Convert]::FromBase64String | Set-Content -Encoding Byte "$backupDir\pet-state.json"
  gh api repos/mnp210/GitHub-Profile-Pet/contents/README.md --jq .content | [System.Convert]::FromBase64String | Set-Content -Encoding Byte "$backupDir\README.md"
  # Confirms state backup safely stored locally
  ```

---

## Phase 2: Production Merge & Deployment

Execute the merge into production `main`.

- [ ] **2.1 Checkout Local Main & Rebase/Merge Candidate**
  ```powershell
  git checkout -b release/sprint-4.3-deploy origin/main
  git merge 990607837ac95617411190fd15cf895793cfcebd -m "Release: Deploy Sprint 4.3 release candidate (commit 9906078)"
  ```
- [ ] **2.2 Re-verify Test Suite on Merged Branch**
  ```powershell
  node --test --experimental-strip-types tests/pet-engine/*.test.ts
  # Expected: 547/547 passed
  ```
- [ ] **2.3 Push to Production Remote Main**
  ```powershell
  git push origin release/sprint-4.3-deploy:main
  # Production main updated to include all Sprint 4.3 features and bugfixes
  ```

---

## Phase 3: GitHub Pages Configuration

Configure GitHub Pages for the public repository.

- [ ] **3.1 Verify Production Repository Visibility**
  ```powershell
  gh repo view mnp210/GitHub-Profile-Pet --json isPrivate --jq .isPrivate
  # Expected: false (public repository)
  ```
- [ ] **3.2 Enable GitHub Pages via GitHub Actions Source**
  ```powershell
  gh api -X POST repos/mnp210/GitHub-Profile-Pet/pages -f build_type="workflow"
  # Expected: HTTP 201 Created or HTTP 200 OK
  ```
- [ ] **3.3 Trigger GitHub Pages Build & Deployment Workflow**
  ```powershell
  gh workflow run deploy-pages.yml --ref main
  gh run list --workflow=deploy-pages.yml --limit 1
  # Monitor run until completed successfully
  ```
- [ ] **3.4 Verify Hosted URL Availability**
  ```powershell
  # Expected URL: https://mnp210.github.io/GitHub-Profile-Pet/
  Invoke-WebRequest -Uri "https://mnp210.github.io/GitHub-Profile-Pet/" -Method Head
  # Expected: HTTP 200 OK
  ```

---

## Phase 4: Workflow Health & Activity Automation

Register workflows and verify recurring cron execution.

- [ ] **4.1 Verify `pet-activity.yml` Workflow Registration**
  ```powershell
  gh workflow list --repo mnp210/GitHub-Profile-Pet
  # Verify 'Pet Activity Engine' is listed and active on main branch
  ```
- [ ] **4.2 Execute Manual Activity Dispatch Test**
  ```powershell
  gh workflow run pet-activity.yml --ref main
  gh run list --workflow=pet-activity.yml --limit 1
  # Verify run succeeds, awards XP to authoritative pet-state.json
  ```
- [ ] **4.3 Execute SVG Publisher Dispatch Test**
  ```powershell
  gh workflow run pet-publish.yml --ref main
  gh run list --workflow=pet-publish.yml --limit 1
  # Verify README badge and dynamic SVGs update cleanly
  ```

---

## Phase 5: Post-Deployment Acceptance Verification

Perform end-to-end user smoke testing on the live hosted release.

- [ ] **5.1 Hosted Web Game Load**
  - Open `https://mnp210.github.io/GitHub-Profile-Pet/` in desktop and mobile viewport.
  - Verify pixel-art canvas renders selected companion sprite.
  - Verify sound effects toggle and local high scores load without console errors.
- [ ] **5.2 README Interactive Pet Menu**
  - Open `https://github.com/mnp210/GitHub-Profile-Pet/blob/main/README.md`.
  - Check dynamic SVG badges: Level, Happiness, Satiety, Energy.
  - Verify action links (`Feed`, `Play`, `Rest`) properly direct to pre-filled issue templates.
- [ ] **5.3 Issue Automation Smoke Test**
  - Open a test care action issue (`[Pet Action] Feed`).
  - Confirm `Pet Care Action Inbox` closes issue, updates satiety +25, and awards +10 XP.

---

## Phase 6: Operator Sign-off & Incident Readiness

- [ ] All 5 phases completed with green checks.
- [ ] Rollback runbook verified and operator familiar with single-command rollback:
  `git push origin +prod-baseline-pre-sprint-4.3:main`
- [ ] Release formally signed off.
