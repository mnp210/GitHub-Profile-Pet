# Phase 3C1 — Passive Pet Simulation & Background Recovery Report

**Project:** GitHub Profile Pet  
**Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Milestone:** Phase 3C1 — Passive Pet Simulation & Background Recovery  
**Status:** Completed & Formally Verified  
**Date:** 2026-11-16  

---

## 1. Executive Summary

Phase 3C1 establishes deterministic, autonomous passive simulation for GitHub Profile Pet. Operating entirely within user-owned GitHub repositories without external servers, centralized databases, or always-on computers (preserving the ₹0/month guarantee), the pet now experiences elapsed time passively:

1. **Passive Inactivity Simulation & Ethical Floors:**
   - Evaluates elapsed time from the authoritative simulation checkpoint to the current runner UTC timestamp.
   - Restores energy at the exact Phase 1 rate (+0.05 energy/sec up to 100) using a persistent 6-decimal fractional accumulator (`energyAccumulator` in `[0, 1)`), cleanly resetting to 0 upon reaching 100 energy.
   - Safely decays hunger (satiety) and happiness at 0.0001/sec while strictly enforcing ethical floors: hunger never drops below 20; happiness never drops below 40.
   - Long-interval absences (days, weeks, or months) are handled without arbitrary catch-up caps, ensuring the pet remains healthy and happy.
   - Evaluates welcome-back bonus eligibility (absence $\ge$ 24h and 24h cooldown).
   - Strict Zero-XP Invariant: passive elapsed time awards 0 XP; level and evolution stage remain completely immutable.

2. **Durable Simulation Checkpoint Architecture:**
   - Introduced `lastSimulatedAt?: string` in `PetStateDocument`, validated against `pet/schemas/pet.schema.json` and `stateValidator.ts`.
   - `resolveSimulationCheckpoint` enforces strict precedence: `lastSimulatedAt` $\to$ `lastOfflineResolutionTime` $\to$ `updatedAt` $\to$ `nowMs` fallback.
   - Safe clock regression defense: if runner clock skew or regression occurs (`nowMs < checkpointMs`), simulation immediately fails safe with 0 elapsed seconds and 0 state mutation.
   - Missing or corrupted timestamps default to `nowMs` with 0 elapsed seconds, eliminating runaway decay risk.

3. **Atomic Persistence & Crash Recovery:**
   - Multi-document atomic commit guarantees identical generation numbers across `pet/state/pet.json`, `pet/ledger/contributions.json`, and `pet/ledger/actions.json`.
   - Idempotent crash recovery: uncommitted `preparing` transactions roll back cleanly; committed `committed` transactions roll forward cleanly before simulation begins.
   - Safe `--dry-run` mode calculates projected vitals and telemetry with 0 disk writes and 0 generation advancement.

4. **Ephemeral Runner Durability & Workflow Orchestration:**
   - Updated `.github/workflows/pet-publisher.yml` with least-privilege `contents: write`, shared concurrency `pet-runtime-${{ github.repository }}` (`cancel-in-progress: false`), hourly cron `47 * * * *` (offset minute), and `workflow_dispatch`.
   - Executes `scripts/simulate-pet.ts` then `scripts/publish-pet.ts`.
   - Automatically stages and commits `pet/state/pet.json` alongside `public/pet.svg` and `README.md` with conflict retry rebase.

5. **Formal Verification:**
   - 273 automated tests passing across 34 suites (100% pass rate).
   - Zero ESLint warnings or errors.
   - Zero TypeScript compilation errors.
   - Successful Next.js production build.

---

## 2. File Invariant & Architecture Changes

| Component | File Path | Phase 3C1 Modification |
|---|---|---|
| Domain Types | `src/features/pet-engine/domain/types.ts` | Added `lastSimulatedAt?: string;` to `PetStateDocument`. |
| JSON Schema | `pet/schemas/pet.schema.json` | Added `lastSimulatedAt` with `format: date-time` under `properties`. |
| Seed Document | `pet/state/pet.json` | Added initial `"lastSimulatedAt": "2026-11-15T00:00:00.000Z"`. |
| State Validator | `src/features/pet-engine/validation/stateValidator.ts` | Added ISO-8601 UTC date validation for `lastSimulatedAt`. |
| Checkpoint Resolver | `src/features/pet-engine/simulation/simulationCheckpoint.ts` | Precedence-ordered checkpoint resolution and clock regression safety. |
| Simulation Service | `src/features/pet-engine/simulation/simulationService.ts` | Orchestrates crash recovery, CAS checks, simulation, persistence, and SVG publication. |
| Simulation Types | `src/features/pet-engine/simulation/types.ts` | `SimulationOptions` and detailed `SimulationResult` telemetry. |
| Transitions Engine | `src/features/pet-engine/transitions/simulationTransitions.ts` | Updated to use `resolveSimulationCheckpoint`, regression guards, and dual checkpoint updates. |
| Care Transitions | `src/features/pet-engine/transitions/careTransitions.ts` | Updates `lastSimulatedAt` on user interactions to keep checkpoints synchronized. |
| Simulation CLI | `scripts/simulate-pet.ts` | Standalone runner supporting `--dry-run`, `--base-dir`, `--now`, and `--force-publish`. |
| Package Scripts | `package.json` | Added `"simulate:pet": "node --experimental-strip-types scripts/simulate-pet.ts"`. |
| GitHub Workflow | `.github/workflows/pet-publisher.yml` | Added hourly cron `47 * * * *`, simulation step, and `pet/state/pet.json` staging. |
| Test Suite | `tests/pet-engine/simulation.test.ts` | 14 test cases verifying all accounting, gameplay, crash, and workflow invariants. |

---

## 3. Test & Verification Evidence

### 3.1 Test Suite Summary (`npm run test:all`)

```text
▶ Care Transitions Engine (Tests 4-8) (9 tests) - PASS
▶ Contribution Accounting Engine (Tests 11-16) (7 tests) - PASS
▶ Deduplication & Gap Classification Registry (5 tests) - PASS
▶ GitHub-native Pet Interaction & Durable Action Inbox (Phase 3B) (32 tests) - PASS
▶ Local State Repository & Multi-Document Persistence (Phase 1.1) (15 tests) - PASS
▶ Pet State Schema Validation (4 tests) - PASS
▶ Progression & Vitals Simulation (7 tests) - PASS
▶ GitHub Actions Runtime & Safe SVG Publication (Phase 3A) (10 tests) - PASS
▶ Passive Pet Simulation & Background Recovery (Phase 3C1) (14 tests) - PASS
▶ Standalone SVG Vector Generation Engine (Phase 2) (22 tests) - PASS
▶ Account-Aware Dynamic Greeting Engine (4 tests) - PASS
▶ Care Action Request Payload Validation (6 tests) - PASS
▶ Production Test Identity Isolation & Fail-Closed Security (4 tests) - PASS
▶ Calendar-Aware Contribution Grid Generator (7 tests) - PASS
▶ CSRF Origin & Open-Redirect Protection (8 tests) - PASS
▶ GitHub Failure Classification & Retry Safety Unit Suite (25 tests) - PASS
▶ Persistent Session Token & Cookie Engine (6 tests) - PASS
...
ℹ tests 273
ℹ suites 34
ℹ pass 273
ℹ fail 0
```

### 3.2 CLI Dry-Run Verification (`npm run simulate:pet -- --dry-run`)

```text
[simulate-pet] Starting passive pet simulation...
[simulate-pet] Mode: DRY RUN (no disk writes or state updates)
[simulate-pet] Simulation Status: ADVANCED
[simulate-pet] Elapsed Time: 122776s
[simulate-pet] Checkpoint: 2026-11-15T00:00:00.000Z -> 2026-11-16T10:06:16.358Z
[simulate-pet] Energy: 100 -> 100 (+0, accumulator: 0 -> 0)
[simulate-pet] Hunger: 100 -> 88 (-12)
[simulate-pet] Happiness: 100 -> 88 (-12)
[simulate-pet] Mood: Happy -> Energetic
[simulate-pet] Welcome-Back Bonus Eligible: true
[simulate-pet] SVG Published: NO
[simulate-pet] Summary: Dry run: simulation calculated successfully without disk persistence.
```

### 3.3 TypeScript & Lint Verification

- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run build`: Next.js Turbopack production compilation succeeded in 2.2s.

---

## 4. Scope Confirmation

- Strictly confined to Phase 3C1 (Passive Pet Simulation & Background Recovery).
- No contribution synchronization (Phase 3C2) was implemented.
- No git commits, pushes, rebases, or branch checkouts were performed.
- Self-hosted GitHub-native architecture and ₹0/month operating guarantee preserved.
