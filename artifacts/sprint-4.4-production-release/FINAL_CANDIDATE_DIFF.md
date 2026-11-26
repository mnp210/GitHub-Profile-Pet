# Sprint 4.4 — Final Candidate Diff & Subsystem Impact Analysis

**Comparison Baseline:** `origin/main` (`86ed9da57b4444f744c429babd7d2be1a2c41e63`)  
**Release Candidate:** `candidate/playable-virtual-pet-game` (`990607837ac95617411190fd15cf895793cfcebd`)  
**Common Merge Ancestor:** `b7b3bd81ca1a649a5b7eb36e0743db2f0c2c73bf`  
**Total Impact:** 77 files changed, +10,860 insertions, -600 deletions

---

## 1. Subsystem Categorization

### 1.1 GitHub Actions Workflows (`.github/workflows/`) — 6 Files
- `deploy-pages.yml` (NEW): Full Next.js static build (`npm run build`), dynamic `NEXT_PUBLIC_BASE_PATH: /${{ github.event.repository.name }}`, `.nojekyll` touch, and deployment to GitHub Pages.
- `pet-activity.yml` (NEW): 30-minute cron (`*/30 * * * *`) and event-driven trigger for qualifying commits, issues, PRs, and reviews. Calls `scripts/process-activity.ts` with strict bot filtering.
- `pet-publish.yml` (MODIFIED): Hardened with dynamic branch targeting for Stage 1 remote fence checking.
- `pet-action-inbox.yml` (MODIFIED): Hardened issue inbox processing with dynamic ref targeting.
- `diagnostics.yml` (MODIFIED): Telemetry probe for GraphQL quota monitoring.
- `.github/workflows/ci.yml` (MODIFIED): Standardized Node.js 22 runner environment.

### 1.2 Pet Gameplay & Engine Subsystem (`src/features/pet-engine/`) — 22 Files
- `activity/intervalIndex.ts` (NEW): Two-tier event deduplication ledger with epoch interval compression, preventing duplicate XP awards on prunings.
- `activity/activityProcessor.ts` (NEW): Evaluates commits (+15 XP), issues (+10 XP), PRs (+25/+50 XP), and reviews (+20 XP) against daily cap and author qualification rules.
- `activity/activityTransactionJournal.ts` (NEW): Atomic write journal ensuring crash-safe rollback on interrupted writes.
- `activity/reconciliation.ts` (NEW): Sweeps trailing Git commit history (up to 5,000 commits) to capture any events missed during concurrency conflicts.
- `publication/publishPipeline.ts` (MODIFIED): Concurrency conflict resolution and dynamic branch fence checking.
- `publication/readmeMenu.ts` (NEW): Marker-based SVG status and interactive action link injector for `README.md`.

### 1.3 Web Client & UI Subsystem (`src/components/`, `src/app/`, `src/lib/`) — 16 Files
- `src/app/page.tsx` & `globals.css`: High-fidelity pixel-art companion interface, retro sound toggles, and responsive canvas viewports.
- `src/components/pet/PetDisplay.tsx` & `PetSprite.tsx`: Procedural animation engine supporting Shadow Claw, Ignis Ember, Kitsune Sol, and Bloop Matrix.
- `src/lib/audio/retroAudio.ts`: Synthesized Web Audio API sound generator for feeding, playing, and leveling up.
- `src/lib/storage/gameStateStorage.ts`: Local client persistence with automated schema version migrations.

### 1.4 Automated Test Suites (`tests/`) — 24 Files
- `tests/unit/*.test.ts`: 200 unit tests covering deduplication, token security hardening, transaction recovery, embed utilities, and XP accounting.
- `tests/pet-engine/*.test.ts`: 547 pet engine tests covering vitals math, species reactions, publication pipelines, and baseline guards.

### 1.5 Data Schemas & State Ledgers (`pet/`) — 5 Files
- `pet/schemas/activity.schema.json` (NEW): Formal Draft 2020-12 JSON Schema for `pet/ledger/activity.json`.
- `pet/schemas/activity_archive.schema.json` (NEW): Formal JSON Schema for archived activity records.
- `pet/ledger/activity.json` (NEW): Initialized empty ledger ready for production reconciliation.

---

## 2. Critical Dual-Modified File Analysis

Four files exist in both branches and have been modified on both sides since the fork point `b7b3bd8`:

| File | Production State (`86ed9da`) | Candidate State (`9906078`) | Required Resolution Strategy |
| :--- | :--- | :--- | :--- |
| `pet/state/pet.json` | **Generation 14**, Level 2, 115 XP, 83 Hunger | **Generation 5**, Level 1, 80 XP, 57 Hunger | **KEEP PRODUCTION (`--ours`)**. Preserves live Level 2 pet state; avoids resetting user progression. |
| `pet/ledger/actions.json` | **Generation 14**, live registry | **Generation 5**, candidate test registry | **KEEP PRODUCTION (`--ours`)**. Preserves live care action audit trail. |
| `pet/ledger/contributions.json` | **Generation 14**, daily HWMs from live runs | **Generation 5**, candidate staging data | **KEEP PRODUCTION (`--ours`)**. Preserves actual recorded user contribution counters. |
| `public/pet.svg` | Generated Level 2 companion badge | Generated Level 1 companion badge | **KEEP PRODUCTION (`--ours`)**. Matches live Level 2 pet state. |

**Merge Simulation Proof:**
Resolving these 4 files with `--ours` resulted in a **100% clean merge**, zero compilation errors (`npx tsc --noEmit`), and **747 of 747 automated tests passing**.
