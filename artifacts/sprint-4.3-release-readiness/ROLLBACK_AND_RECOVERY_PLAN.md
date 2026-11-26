# Sprint 4.3 — Production Rollback and Recovery Plan

**Production Target:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Production Baseline Commit:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`  
**Candidate Release Commit:** `990607837ac95617411190fd15cf895793cfcebd`  
**Execution Policy:** Read-Only Planning (Do NOT execute during Sprint 4.3)  

---

## 1. Production Baseline Identification & Pre-Deployment Preservation

Prior to any deployment or merge of candidate code into `mnp210/GitHub-Profile-Pet`, the following pre-deployment preservation steps must be executed:

### Step 1: Create an Annotated Baseline Git Tag
```powershell
cd d:\Projects\GitHub-Profile-Pet
git checkout main
git pull origin main
git tag -a prod-baseline-pre-sprint-4.3 86ed9da57b4444f744c429babd7d2be1a2c41e63 -m "Production baseline snapshot prior to Sprint 4.3 release"
git push origin prod-baseline-pre-sprint-4.3
```

### Step 2: Backup Authoritative State Files
Create an immutable local copy of the 4 core state documents:
- `pet/state/pet.json`
- `pet/ledger/contributions.json`
- `pet/ledger/actions.json`
- `public/pet.svg`

Store in a timestamped backup directory:
`backups/production-pre-sprint-4.3-20261122/`

---

## 2. Trigger Conditions for Production Rollback

A production rollback is immediately initiated if any of the following occur post-deployment:
1. **GitHub Pages Deployment Failure:** Continuous 404 errors or JavaScript bundle crash on `https://mnp210.github.io/GitHub-Profile-Pet/`.
2. **Infinite Publication Loop:** GitHub Actions workflows repeatedly trigger themselves without respecting `[skip ci]`.
3. **State Corruption:** Invariant check `verifyAccountingInvariant` fails on `pet/ledger/contributions.json` or `pet/state/pet.json`.
4. **Security / Credential Alert:** Any accidental token exposure or unauthorized write access.

---

## 3. Concrete Rollback Procedures

### Phase 1: Immediate Workflow Disablement
Temporarily disable incoming automated workflows on production to prevent race conditions during recovery:
```powershell
gh workflow disable deploy-pages.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-activity.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-publisher.yml --repo mnp210/GitHub-Profile-Pet
gh workflow disable pet-interaction.yml --repo mnp210/GitHub-Profile-Pet
```

### Phase 2: Git State Reversion
Depending on the production branch history:

#### Option A: Clean Revert Commit (Recommended for shared branches)
```powershell
git checkout main
git revert --no-edit <MERGE_COMMIT_SHA> -m 1
git push origin main
```

#### Option B: Reset to Baseline Tag (If authorized on dedicated repository)
```powershell
git checkout main
git reset --hard prod-baseline-pre-sprint-4.3
git push origin main --force-with-lease
```

### Phase 3: GitHub Pages Rollback
1. Trigger a clean re-deployment of the baseline static export if Pages was previously enabled.
2. If Pages deployment failed, disable GitHub Pages in repository settings:
   ```powershell
   gh api --method DELETE repos/mnp210/GitHub-Profile-Pet/pages
   ```

### Phase 4: State Document Recovery & Invariant Verification
1. Compare current `pet/state/pet.json` with the pre-deployment backup.
2. If the automated publisher ran during the incident, ensure that elapsed inactivity decay is recalculated cleanly without duplicating or forfeiting XP.
3. Run the ledger validator to guarantee zero corrupted entries:
   ```powershell
   node -e "
     const { verifyAccountingInvariant } = require('./src/features/pet-engine/accounting/contributionEngine.ts');
     const contrib = JSON.parse(require('fs').readFileSync('pet/ledger/contributions.json', 'utf8'));
     const inv = verifyAccountingInvariant(contrib);
     if (!inv.satisfied) throw new Error('Ledger invariant violated!');
     console.log('Invariant satisfied: OK');
   "
   ```

### Phase 5: Re-enable Essential Workflows
Once the baseline state is restored and verified clean:
```powershell
gh workflow enable pet-publisher.yml --repo mnp210/GitHub-Profile-Pet
gh workflow enable pet-interaction.yml --repo mnp210/GitHub-Profile-Pet
```

---

## 4. Post-Rollback Smoke Tests

1. Verify `public/pet.svg` renders cleanly in GitHub profile README.
2. Verify hourly publisher cron runs once at minute 47 and completes with status `PUBLISHED` or `NOOP`.
3. Verify `pet/state/pet.json` maintains valid generation counters and schema version 1.
4. Verify repository working tree is 100% clean.
