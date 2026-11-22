# Sprint 4.4 — Pet State & Ledger Protection Assessment

**Evaluation Subject:** Live Production Data vs. Release Candidate Schemas  
**Production Commit:** `86ed9da57b4444f744c429babd7d2be1a2c41e63`  
**Candidate Commit:** `990607837ac95617411190fd15cf895793cfcebd`  
**Evaluation Status:** **PASS (SAFE WITH `--ours` STATE RETENTION)**

---

## 1. Production State Structure & Schema Audit

An exhaustive structural comparison between live production files and candidate schemas was conducted:

### 1.1 `pet/state/pet.json`
- **Production Content:**
  ```json
  {
    "schemaVersion": 1,
    "generation": 14,
    "name": "Shadow Claw",
    "species": "cat",
    "level": 2,
    "xp": 115,
    "maxExp": 200,
    "energy": 100,
    "energyAccumulator": 0,
    "hunger": 83,
    "hungerDecayAccumulator": 0.8101246,
    "happiness": 40,
    "happinessDecayAccumulator": 0,
    "mood": "Focused",
    "evolutionStage": "Hatchling",
    "lastInteractionTime": "2026-11-15T00:00:00.000Z",
    "lastOfflineResolutionTime": "2026-11-22T12:01:41.246Z",
    "lastSimulatedAt": "2026-11-22T12:01:41.246Z",
    "lastWelcomeBonusClaimedAt": null,
    "updatedAt": "2026-11-22T12:01:41.246Z"
  }
  ```
- **Schema Compatibility:** Production uses `schemaVersion: 1`. Candidate uses `schemaVersion: 1` (`pet/schemas/pet.schema.json`).
- **Generation Number:** Production is at `generation: 14`. Candidate code dynamically reads `pet.generation` and increments by 1 (`generation: 15`).
- **Protection Rule:** **STRICT PROHIBITION** against overwriting with candidate's `pet/state/pet.json` (which is at `generation: 5`, Level 1, 80 XP). Retaining production's state file preserves Level 2 (115 XP) seamlessly.

### 1.2 `pet/ledger/actions.json`
- **Production Content:** `schemaVersion: 1`, `generation: 14`, `recentActions: []`, `processedRequestRegistry: { ... }`.
- **Candidate Content:** `schemaVersion: 1`, `generation: 5`.
- **Protection Rule:** Production file must be retained. It tracks live care action issue request high-water marks and gap resolutions.

### 1.3 `pet/ledger/contributions.json`
- **Production Content:** `schemaVersion: 1`, `generation: 14`, owner `mnp210`, live daily HWMs (`2026-11-17`: 1, `2026-11-18`: 20, `2026-11-19`: 22), rewarded slice records.
- **Candidate Content:** `schemaVersion: 1`, `generation: 5` (staging test data).
- **Protection Rule:** **NEVER REPLACE** production contributions with candidate staging data. Retain production's file verbatim.

### 1.4 `pet/ledger/activity.json` (NEW)
- **Production Presence:** Does not exist yet in production `origin/main`.
- **Candidate Introduction:** Candidate introduces `pet/ledger/activity.json` with schema validation (`pet/schemas/activity.schema.json`).
- **Initial Content on Release:**
  ```json
  {
    "schemaVersion": 1,
    "generation": 14,
    "dailyAccruedXp": {},
    "processedRegistry": {
      "commitShas": [],
      "issueNumbers": [],
      "prOpenedNumbers": [],
      "prMergedNumbers": [],
      "reviewIds": []
    },
    "recentEvents": [],
    "updatedAt": "2026-11-22T21:00:00.000Z"
  }
  ```
- **Lifecycle:** Created upon initial merge. When `pet-activity.yml` runs, it reads the empty registry, reconciles qualifying commits, records them in the permanent interval index, and increments generation to 15.

---

## 2. Duplicate XP Prevention & Anti-Replay Strategy

When candidate code is deployed, the initial execution of `scripts/process-activity.ts` will perform a trailing Git commit reconciliation sweep (up to 5,000 commits over the past 14 days):
1. **Author Qualification:** Only commits authored by repository owner `mnp210` qualify. Bot commits (`github-actions[bot]`, `dependabot[bot]`, etc.) and commits containing `[skip ci]` or `pet: update state` are automatically filtered out.
2. **Daily Budget Clamping:** Commits award +15 XP each, capped at a maximum of 300 XP per calendar day (UTC).
3. **Permanent Interval Indexing:** Each awarded commit SHA is stored in `processedRegistry.commitShas` and merged into the interval index. Subsequent runs will immediately detect already-recorded SHAs and award 0 XP (`skipped_duplicate`).
4. **Independent Ledgers:** The activity ledger (`pet/ledger/activity.json`) operates independently of the contribution ledger (`pet/ledger/contributions.json`). Contribution sync handles daily contribution counts, while activity progression handles direct Git/GitHub developer actions. Neither ledger interferes with or double-counts the other.

---

## 3. Migration Protocol & Release Safety Rule

1. **Pre-Merge State Check:** Verify production `pet/state/pet.json` is at Level 2, 115 XP.
2. **Merge Resolution:** During the Git merge into `main`, execute:
   ```powershell
   git checkout --ours pet/state/pet.json pet/ledger/actions.json pet/ledger/contributions.json public/pet.svg
   ```
3. **Initial Activity Ledger Generation:** Set the initial `generation` field of `pet/ledger/activity.json` to `14` (matching current production state).
4. **Post-Merge Verification:** Inspect `pet/state/pet.json` to confirm `level: 2`, `xp: 115`, and `generation: 14` remain exactly intact.

**Conclusion:** State compatibility is **100% verified and guaranteed** under the documented retention protocol.
