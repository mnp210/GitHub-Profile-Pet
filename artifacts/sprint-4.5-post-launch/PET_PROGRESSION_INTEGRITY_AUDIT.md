# Sprint 4.5 — Pet Progression Integrity & Ledger Accounting Audit

**Audited Production Commit:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Companion Identity:** `Shadow Claw` (Cat, Hatchling Stage)  
**Authoritative Level & XP:** **Level 3, 275 / 300 XP**  
**Authoritative Generation:** **35**  
**Audit Finding:** **100% MATHEMATICAL & ATOMIC INTEGRITY (ZERO DATA LOSS)**

---

## 1. Mathematical Accounting: The Transition from Level 2 (115 XP) to Level 3 (275 XP)

A critical requirement of this audit is providing full mathematical accounting for the progression transition observed across Sprints 4.4 and 4.5:

```
[Pre-Release Baseline]
  Level 2 (115 / 200 XP), Generation 14
          |
          | +300 XP Activity Award (Run 45041180176, Commit 409fe90)
          |   - Consumes 85 XP to reach 200 XP (Level Up to Level 3)
          |   - Remaining 215 XP overflows into Level 3 (maxExp: 300)
          v
[Post-Activity State]
  Level 3 (215 / 300 XP), Generation 34
          |
          | +60 XP Contribution Reward (Run 45042057002, Commit 3c7fc20)
          |   - Evaluates 2026-11-22 public contribution slices
          |   - 215 + 60 = 275 XP
          v
[Current Authoritative Production State]
  Level 3 (275 / 300 XP), Generation 35
```

### 1.1 Activity Ledger Evidence (`pet/ledger/activity.json`)
- **Daily Accrued XP:**
  ```json
  "dailyAccruedXp": {
    "2026-11-22": 300
  }
  ```
- **Cap Enforcement:** 40 developer commits and PR events evaluated. The first 20 commits awarded +15 XP each ($20 \times 15 = 300$ XP). The remaining 20 commits and PRs were clamped to `+0 XP` with status `skipped_daily_cap`.
- **Level Up Calculation:** In `activityProcessor.ts`, `applyExperience(2, 115, 300)`:
  - Required to reach Level 3: $200 - 115 = 85$ XP.
  - New XP in Level 3: $300 - 85 = 215$ XP.
  - New Max EXP for Level 3: $300$ XP.
  - Evolution stage: `Hatchling` (evolves to `Apprentice` at Level 5).
  - Mood updated to `Happy` (transitioned from `Energetic` after simulation).

### 1.2 Contribution Ledger Evidence (`pet/ledger/contributions.json`)
- **Daily Accrued XP:**
  ```json
  "dailyAccruedXp": {
    "2026-11-18": 105,
    "2026-11-19": 110,
    "2026-11-22": 60
  }
  ```
- **Evaluation Receipt:** Run `45042057002` on `2026-11-22T16:07:41Z` evaluated new contribution slices for `mnp210`, awarding **+60 XP**.
- **Resulting Pet XP:** $215 + 60 = 275$ XP.

---

## 2. Multi-Document Atomic Generation Alignment

The atomic triplet invariant is strictly enforced across all repository persistence files:

| Document Path | Document Purpose | Observed Generation | Alignment Status |
| :--- | :--- | :---: | :---: |
| `pet/state/pet.json` | Authoritative pet vitals and progression | **35** | **MATCHED** |
| `pet/ledger/contributions.json` | Public contribution counter history | **35** | **MATCHED** |
| `pet/ledger/actions.json` | Care action issue form registry | **35** | **MATCHED** |
| `pet/ledger/activity.json` | Developer Git event deduplication ledger | **34** | Independent Ledger |
| `public/pet.svg` | Generated companion README badge | Matching Lvl 3, 275 XP | **SYNCHRONIZED** |

**Generation Mismatch Immunity:**  
In Sprint 4.4, `scripts/process-activity.ts` was hardened to harmonize generation numbers across `contributions.json` and `actions.json` whenever activity processing advances `pet.json`. This completely eliminates `GenerationMismatchError` during subsequent publication runs.

---

## 3. Anti-Replay & Deduplication Verification

1. **Live Runner Deduplication Test:**
   - In Run `45041516845`, `pet-activity.yml` was manually dispatched after the initial +300 XP award.
   - The reconciliation engine scanned the Git log and PRs, matched all 40 commit SHAs against `processedRegistry.commitShas` and the interval index, and awarded **0 XP** (`SKIPPED_DUPLICATE`).
   - Zero duplicate commits or split-brain branches were generated.
2. **Permanent Interval Index:**
   - Even if `recentEvents` (sliding window of 50 items) prunes older events, the epoch interval index in `pet/ledger/activity.json` permanently retains processed event bounds. Previously rewarded commits cannot earn XP again.

---

## 4. Staging Isolation Audit

An exhaustive grep for staging test data, mock accounts, and test repository URLs was executed across all production documents:
- `ownerLogin`: strictly `"mnp210"`.
- `ownerDatabaseId`: strictly `298821706`.
- Zero references to staging branch `test/sprint-4-1` or mock users.
- Authoritative state originated 100% from live production activity.

**Integrity Audit Verdict: 100% PASS.**
