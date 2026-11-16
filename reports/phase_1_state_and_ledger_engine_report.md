# Phase 1 — Repository-Native State Format & Ledger Engine: Implementation & Verification Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Architecture Specification:** Sprint 2.7.4 (`docs/architecture/sprint-2.7-github-native-redesign.md`)  
**Status:** COMPLETED & VERIFIED  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 1 of the GitHub Profile Pet GitHub-native architecture migration is complete. We have successfully designed, implemented, and verified the foundational repository-native state engine and its persistence layer.

This engine completely decouples virtual companion simulation and contribution accounting from centralized databases (PostgreSQL/Neon) and external web servers. The user's own repository now possesses the complete deterministic logic required to simulate pet vitals, enforce ethical bounds, process care actions, account for GitHub activity with strict mathematical conservation, deduplicate requests with high-water mark gap classification, and persist state atomically across versioned documents.

All 29 newly authored pet-engine tests and all 121 pre-existing tests pass with zero failures (150 total tests). Strict TypeScript compilation (`npx tsc --noEmit`), ESLint validation (`npm run lint`), and Next.js production compilation (`npm run build`) pass with 0 errors and 0 warnings.

---

## 2. Implemented Component Directory Tree

```
pet/
├── state/
│   └── pet.json                          # Canonical authoritative pet state (generation: 1)
├── ledger/
│   ├── contributions.json                # Append-only contribution ledger (generation: 1)
│   └── actions.json                      # Decoupled action history & permanent gap registry (generation: 1)
└── schemas/
    ├── pet.schema.json                   # Draft 2020-12 JSON schema for pet state
    ├── contributions.schema.json         # Draft 2020-12 JSON schema for contribution accounting
    └── actions.schema.json               # Draft 2020-12 JSON schema for action ledger & gap registry

src/features/pet-engine/
├── index.ts                              # Consolidated domain entrypoint
├── domain/
│   ├── constants.ts                      # Domain constants, caps, cooldowns, floors, and reward ratios
│   └── types.ts                          # Strongly typed TypeScript interfaces for all documents
├── validation/
│   ├── stateValidator.ts                 # Runtime schema validation, bounds checking, and ISO-8601 validation
│   └── ledgerValidator.ts                # Ledger structural validation & conservation invariant assertions
├── transitions/
│   ├── progressionEngine.ts              # Mathematical XP, level-up carryover, evolution stage, mood derivation
│   ├── simulationTransitions.ts          # Passive energy recovery & safe offline decay with ethical floors
│   └── careTransitions.ts                # Deterministic care actions (feed, train, rest, pet) with cooldowns
├── accounting/
│   ├── contributionEngine.ts             # Monotonic HWM, hourly throttle, daily cap, 48h expiry, conservation
│   └── deduplicationRegistry.ts          # HWM advancement, ambiguous 404 gap pinning, sparse sets, retired gaps
└── persistence/
    ├── atomicFileWriter.ts               # Temp file write and atomic rename (fs.promises.rename)
    └── stateRepository.ts                # Multi-document generation coordination & mismatch detection

tests/pet-engine/
├── petStateValidation.test.ts            # TC-STATE-01..03: Schema conformance, vital limits, version checks
├── careTransitions.test.ts               # TC-CARE-01..07: Care actions, 60s cooldown, diminishing returns
├── progressionAndVitals.test.ts          # TC-PROG-01..05: Multi-level jumps, milestones, mood, offline simulation
├── contributionAccounting.test.ts        # TC-CONTRIB-01..06: Monotonic HWM, 5/hr throttle, 300 XP cap, 48h expiry
├── deduplicationAndGaps.test.ts          # TC-DEDUP-01..05 & TC-FILE-13: HWM gap classification, 404 pinning
└── localPersistence.test.ts              # TC-PERSIST-01..03: Atomic writes, generation mismatch detection
```

---

## 3. Schema Specifications & Document Formats

All three repository documents share a unified optimistic concurrency generation number (`generation: integer >= 1`) and schema version (`schemaVersion: 1`).

### 3.1 Pet State Document (`pet/state/pet.json`)
Authoritative entity state representing the companion's current attributes, stats, and temporal markers:
- `schemaVersion`: `1`
- `generation`: Positive integer incremented on every atomic mutation.
- `name`: String (1–50 characters).
- `species`: `'cat' | 'dragon' | 'fox' | 'slime' | 'shadow_claw' | 'ignis_ember' | 'kitsune_sol' | 'bloop_matrix'`.
- `level`: Integer between `1` and `100`.
- `xp`: Integer non-negative.
- `maxExp`: Integer $\ge 100$, derived from `calculateMaxExp(level) = level * 100`.
- `energy`: Integer clamped `[0, 100]`.
- `hunger`: Integer clamped `[0, 100]` (representing fullness/satiety).
- `happiness`: Integer clamped `[0, 100]`.
- `mood`: `'Energetic' | 'Happy' | 'Focused' | 'Curious' | 'Resting'`.
- `evolutionStage`: `'Hatchling' | 'Juvenile' | 'Ascended' | 'Celestial'`.
- `lastInteractionTime`: ISO-8601 UTC timestamp.
- `lastOfflineResolutionTime`: ISO-8601 UTC timestamp.
- `lastWelcomeBonusClaimedAt`: ISO-8601 UTC timestamp or `null`.
- `updatedAt`: ISO-8601 UTC timestamp.

### 3.2 Contribution Ledger (`pet/ledger/contributions.json`)
Append-only ledger tracking observed contribution units, hourly throttles, daily caps, and verified slices:
- `monotonicPublicHwm`: Integer $\ge 0$. Monotonically non-decreasing counter of public contributions.
- `dailyAccruedXp`: Key-value map (`YYYY-MM-DD` $\to$ accrued XP $\le 300$).
- `hourlySliceUsage`: Key-value map (`YYYY-MM-DDTHH` $\to$ slices rewarded in that UTC clock hour).
- `slices`: Array of `ContributionSlice` objects:
  - `sliceId`: Unique slice identifier (`slice_YYYY-MM-DD_timestamp_index`).
  - `syncDate`: Calendar UTC date (`YYYY-MM-DD`).
  - `discoveredAt`: ISO-8601 UTC timestamp.
  - `units`: Integer $\ge 1$ (up to 5 per slice).
  - `status`: `'rewarded' | 'forfeited' | 'pending' | 'expired'`.
  - `rewardedXp`: Exact XP granted.
  - `rewardedSatiety`: Exact satiety granted.
  - `expiryAt`: ISO-8601 UTC timestamp (sync-date midnight + 48 hours).
  - `evaluatedAt`: ISO-8601 UTC timestamp.
- `monthlyHistoricalSummary`: Array of historical monthly aggregated records for slices older than 30 days.

### 3.3 Action Ledger & Deduplication Registry (`pet/ledger/actions.json`)
Partitioned document separating short-term rate-limiting history from permanent request deduplication:
- `recentActions`: Rolling array pruned past 60 seconds (`nowMs - timestamp > 60000`).
  - `action`: `'feed' | 'train' | 'rest' | 'pet'`.
  - `timestamp`: UTC millisecond timestamp.
  - `requestId`: String (e.g. `issue-42`).
- `processedRequestRegistry`: Permanent registry guaranteeing $100\%$ duplicate rejection:
  - `highWaterIssueNumber`: Highest integer $K$ where every integer $i \le K$ is unambiguously resolved.
  - `sparseProcessedIssueNumbers`: Sorted array of processed issue numbers $> \text{highWaterIssueNumber}$.
  - `retiredNonActionGaps`: Sorted array of non-action issue/PR integers $> \text{highWaterIssueNumber}$.
  - `unresolvedGaps`: Sorted array of integers blocked by ambiguous HTTP 404, rate limits, or network errors.

---

## 4. Deterministic State Transitions & Vitals Engine

### 4.1 Care Actions
- **Feed (`feed`):** Adds satiety ($+24$ base), $+5$ happiness, $+10$ base XP, 0 energy cost. Fails cleanly with `"Satiety Full"` if `hunger >= 100`.
- **Train (`train`):** Consumes 18 energy, adds $+4$ happiness, $+30$ base XP, 0 hunger cost. Fails cleanly with `"Insufficient Energy"` if `energy < 18`.
- **Rest (`rest`):** Restores $+25$ energy, adds $+2$ happiness, and strictly grants **0 XP**. Always permitted.
- **Pet (`pet`):** Adds $+12$ happiness, $+6$ base XP, 0 energy cost, 0 hunger cost. Always permitted.

### 4.2 Strict Cooldowns & Diminishing Returns
- **Action Cooldown:** A strict 60-second cooldown (`ACTION_COOLDOWN_MS = 60_000`) is enforced between care actions. Actions attempted within 60s of the previous action are rejected with `"Action Cooldown: Please wait Xs"`.
- **Diminishing Returns:** Multipliers apply to reward yields for repeated actions within the rolling 60-second window:
  - 1st use: $100\%$ ($1.0$)
  - 2nd use: $60\%$ ($0.6$)
  - 3rd use: $35\%$ ($0.35$)
  - 4th use: $20\%$ ($0.20$)
  - 5th+ use: $10\%$ ($0.10$)
  Fixed resource costs (e.g. 18 energy for training) are never diminished.

### 4.3 Level Progression & Evolution Milestones
- Cumulative XP required for Level $L$:
  $$\text{TotalXP}(L) = 50 \times L \times (L - 1)$$
- Level calculation handles arbitrary multi-level jumps and overflow carryover deterministically.
- Evolution Milestones:
  - Levels 1–4: **Hatchling**
  - Levels 5–9: **Juvenile**
  - Levels 10–19: **Ascended**
  - Levels 20+: **Celestial**

### 4.4 Ethical Floors & Offline Simulation
- Passive energy restores at $+0.05\text{ energy/sec}$ ($3\text{ energy/min}$) up to 100.
- Hunger and happiness decay at safe rates of $0.0001\text{/sec}$ ($\sim 8.6\text{ pts/day}$).
- Ethical gaming bounds strictly prevent negative vitals or companion death:
  - Hunger floor: strictly stops decaying at **20**.
  - Happiness floor: strictly stops decaying at **40**.
- Extended absence ($>24\text{ hours}$) qualifies the user for the Welcome-Back bonus upon their return.

---

## 5. Contribution Accounting & The Conservation Invariant

The contribution engine enforces the non-negotiable financial and gameplay accounting rules:

1. **Monotonic High-Water Mark:**
   $$\text{HWM}_{t+1} = \max(\text{HWM}_t, \text{observedPublicTotal})$$
   Guarantees that transient GraphQL zero-returns or network hiccups never regress accrued contributions.
2. **5-Slice Hourly Throttle:**
   At most 5 contribution slices can be rewarded in any single calendar UTC hour (`YYYY-MM-DDTHH`). Additional slices discovered in the same hour enter `pending` status.
3. **Daily 300 XP Cap:**
   At most $300\text{ XP}$ can be earned from contributions per calendar UTC day (`YYYY-MM-DD`). Once the 300 XP limit is reached, excess contribution units enter `forfeited` status ($0\text{ XP}$, $0\text{ satiety}$). When partial cap room exists, slices split cleanly to preserve exact unit tracking.
4. **48-Hour Pending Slice Expiration:**
   Pending slices record $\text{expiry\_at} = \text{sync\_date}::\text{midnight} + 48\text{ hours}$ (UTC). If a pending slice reaches $\text{now} \ge \text{expiry\_at}$ without being rewarded, its status transitions to `expired` ($0\text{ XP}$, $0\text{ satiety}$).
5. **Exact 5-Increment Reward Math:**
   Each 5-unit contribution slice grants strictly **60 XP** and **19 satiety** ($12\text{ XP}$ and $3.8\text{ satiety}$ per unit).
6. **The Accounting Conservation Invariant:**
   Across every batch, reconciliation, and compaction, the engine mathematically verifies:
   $$\text{observedUnits} = \text{rewardedUnits} + \text{forfeitedUnits} + \text{pendingUnits} + \text{expiredUnits}$$

---

## 6. Deduplication, GitHub Numbering & Gap Classification

### 6.1 GitHub Gap Classification Protocol

| API Response / State | Classification | Target Collection | HWM Advancement Eligibility |
| :--- | :--- | :--- | :--- |
| `200 OK` with `pull_request` | `retired_pr` | `retiredNonActionGaps` | **Eligible** (PRs share numbering sequence) |
| `200 OK` without pending label | `retired_non_pet_issue` | `retiredNonActionGaps` | **Eligible** (Ordinary issue) |
| `200 OK` with `pet-action:pending` | `active_or_processed_pet_action` | `sparseProcessedIssueNumbers` | **Eligible** once processed or rejected |
| `410 Gone` | `retired_deleted_410` | `retiredNonActionGaps` | **Eligible** (Definitively deleted resource) |
| `404 Not Found` | `unresolved_ambiguous_404` | `unresolvedGaps` | **INELIGIBLE.** Ambiguous gap; HWM never passes. |
| `403` / `429` | `unresolved_rate_limited` | `unresolvedGaps` | **INELIGIBLE.** Rate-limited or blocked. |
| `5xx` / Network Drop | `unresolved_server_error` | `unresolvedGaps` | **INELIGIBLE.** Infrastructure failure. |
| Incomplete Pagination | `unresolved_incomplete_pagination` | `unresolvedGaps` | **INELIGIBLE.** Incomplete stream. |

### 6.2 Acceptance Test TC-FILE-13 Verification
The acceptance scenario specified in Sprint 2.7.4 was verified in `deduplicationAndGaps.test.ts`:
- Baseline: $\text{HWM} = 42$.
- Integer 43 returns `404 Not Found` $\to$ classified as `unresolved_ambiguous_404`, stored in `unresolvedGaps: [43]`.
- Integer 44 is pet action #44 $\to$ processed and stored in `sparseProcessedIssueNumbers: [44]`.
- Integer 45 is Pull Request #45 $\to$ retired into `retiredNonActionGaps: [45]`.
- **Result:**
  - High-Water Mark **strictly remains at 42**. It does NOT skip past unresolved gap 43.
  - The engine does not deadlock: Issue #44 is executed cleanly.
  - Deduplication remains $100\%$ accurate: `isRequestProcessed(44)` returns `true`.

---

## 7. Local Atomic Persistence & Generation Coordination

### 7.1 Atomic Write Engine (`atomicFileWriter.ts`)
To prevent partial writes or file corruption during process termination or runner cancellation, all file writes:
1. Write serialized JSON to a unique temporary file: `${targetPath}.${Date.now()}.${randomSuffix}.tmp`.
2. Atomically rename the temporary file over the destination file using `fs.promises.rename()`.
3. If an error occurs, clean up the temporary file automatically.

### 7.2 Generation Coordination & Mismatch Guard (`stateRepository.ts`)
- All three documents (`pet.json`, `contributions.json`, `actions.json`) advance in lockstep with matching generations.
- On loading, `loadRepositoryState()` validates that `pet.generation === contributions.generation === actions.generation`.
- If an interrupted or asymmetric write left the files out of sync (e.g. `pet.json` at generation 5 while `contributions.json` is at generation 6), `GenerationMismatchError` is raised, detailing the exact mismatch.

---

## 8. Verification & Gate Checks

| Verification Command | Purpose | Output / Result | Status |
| :--- | :--- | :--- | :---: |
| `npm run test:pet-engine` | Run all 6 pet-engine test suites (29 tests) | 29 passing, 0 failing (316ms) | **PASSED** |
| `npm test` | Run complete existing unit test suite (24 suites) | 121 passing, 0 failing (1123ms) | **PASSED** |
| `npm run test:all` | Run combined test suite (30 suites, 150 tests) | 150 passing, 0 failing (825ms) | **PASSED** |
| `npm run lint` | ESLint static analysis | 0 errors, 0 warnings | **PASSED** |
| `npx tsc --noEmit` | Strict TypeScript compilation check | Exited with code 0 | **PASSED** |
| `npm run build` | Next.js production bundle compilation | 14/14 static pages generated cleanly | **PASSED** |

---

## 9. Preservation of Legacy Assets & Zero External Drift

- **No Remote Git Changes:** Zero Git commits, pushes, resets, rebases, or checkouts were performed.
- **No External GitHub API Calls:** Zero network requests were made to GitHub REST or GraphQL APIs.
- **No Workflow Modification:** No GitHub Actions workflow files were created or modified during this phase.
- **Legacy Assets Preserved:** All existing Next.js routes (`src/app/`), components (`src/components/`), database repositories (`src/lib/db/`), and schema migrations (`migrations/001-010`) remain intact and unaltered.

---

## 10. Phase 1 Sign-Off & Transition to Phase 2

Phase 1 has satisfied all requirements set forth in the Sprint 2.7.4 specification and the user directive.

**Recommended Next Step:**
Proceed to **Phase 2: Standalone SVG Vector Generation Engine** (`scripts/render-svg.ts`), which will implement zero-dependency pixel-to-vector SVG generation for `public/pet.svg` using `shadowClawSpriteData.ts` and the Phase 1 state schema.
