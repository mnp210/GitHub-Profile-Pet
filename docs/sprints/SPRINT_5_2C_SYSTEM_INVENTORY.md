# Sprint 5.2C — Full System Architecture & Module Inventory

**Sprint:** 5.2C  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Candidate HEAD:** `acd969fc276b36147b435e2c23f63a3f9541b496`  
**Production Baseline:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Date:** 2026-11-24  

---

## 1. Inventory Overview

This document provides a verified, code-level architectural inventory of all active subsystems in GitHub Profile Pet — Playable Edition. The architecture comprises six primary subsystems cooperating across client-side interactive gameplay and GitHub Actions backend automation.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       GitHub Profile Pet (Client Application)               │
├─────────────────────────────────────────────────────────────────────────────┤
│  Top Navigation (Brand, Play Zone, Wardrobe, Bond Lvl, Codex, Sync)         │
├───────────────────────┬─────────────────────────────────────────────────────┤
│                       │  Right Panel: Telemetry & Status HUD                │
│  Interactive Arena    │  - Level & Evolution Stage Progress                 │
│  - Environment Layer  │  - Happiness, Energy, Satiety Vitals                │
│  - Particle Effects   │  - Daily Streak & Multiplier Status                 │
│  - 24x24 Pixel Sprite ├─────────────────────────────────────────────────────┤
│  - Accessory SVG      │  Companion Guild Picker (Cat, Dragon, Fox, Slime)   │
│  - Action Buttons     ├─────────────────────────────────────────────────────┤
│  - Launchers Grid     │  Local Persistence (Export / Import / Reset)        │
├───────────────────────┴─────────────────────────────────────────────────────┤
│  Living Companion Panel (Curious, Determined, Playful, Calm Archetypes)     │
├─────────────────────────────────────────────────────────────────────────────┤
│  Interaction Ledger (Recent Care Actions, Cooldown Tracking)                │
└─────────────────────────────────────────────────────────────────────────────┘
      │                     │                     │                    │
      ▼                     ▼                     ▼                    ▼
[Personality Subsystem] [Mini-Games]       [Progression Vault]   [Bonding Subsystem]
- Moods & Behaviors     - Star Catcher     - 16 Cosmetics        - 5 Bond Milestones
- Ambient Thoughts      - Memory Sparks    - 15 Achievements     - Daily Activities (3)
- Species Profiles      - Rhythm Game      - Wardrobe Engine     - Rotating Challenges
```

---

## 2. Detailed Subsystem Specifications

### Subsystem 1: Core Pet Engine & Backend Ingestion

- **Source Paths:**
  - `src/features/pet-engine/`: Core accounting, state publication, and SVG generation
  - `src/features/gamification/`: Reward rules (`rewards.ts`), gameplay action logic (`gameplay.ts`)
  - `src/constants/petData.ts`: Baseline stats and species metadata
  - `src/types/pet.ts`: Primary domain interfaces (`PetState`, `SpeciesId`, `PetMood`)
- **Public Interfaces:**
  - `executePetAction(params)`: Executes care action (`feed`, `play`, `train`, `rest`, `pet`) with cooldown and vitals math.
  - `calculateLevelProgress(xp)`: Derives level and stage progression.
  - `renderPetSvg(pet)`: Generates pixel-accurate $24 \times 24$ badge SVG for repository display.
- **Persistence Dependencies:**
  - Client: `localStorage.getItem('gh_pet_game_state_v1')`, `localStorage.getItem('gh_pet_action_history_v1')`
  - GitHub Actions: `pet/state/pet.json`, `pet/ledger/activity.json`, `pet/ledger/archive/activity_archive.json`
- **Events & Callbacks:**
  - `onExecuteAction`: Dispatches care action from client arena.
  - GitHub Actions dispatch: Generates issue payload for background workflow ingestion.
- **Cross-System Dependencies:**
  - Feeds stats into `PersonalityEngine` for mood and behaviour selection.
  - Feeds level thresholds into `ProgressionEngine` for achievement evaluations.
- **Automated Tests:**
  - `tests/pet-engine/*.test.ts` (547 tests)
  - `tests/unit/actionValidation.test.ts`, `tests/unit/activityProgression.test.ts`, `tests/unit/xpAccountingAccuracy.test.ts`
- **Known Limitations:**
  - Client-side offline gameplay cannot directly write to GitHub repository without user-provided PAT or dispatched issue.

---

### Subsystem 2: Living Companion & Personality System

- **Source Paths:**
  - `src/features/personality/personalities.ts`: 4 archetype profiles (Curious, Determined, Playful, Calm)
  - `src/features/personality/behaviourEngine.ts`: State machine selecting behaviors based on vitals and mood
  - `src/features/personality/ambientThoughts.ts`: Contextual thoughts based on species and personality
  - `src/components/pet/PersonalityPanel.tsx`: Interactive personality switcher and dialogue display
- **Public Interfaces:**
  - `getPersonalityProfile(personality, species)`: Metadata, preferred actions, dialogue prompts.
  - `selectNextBehaviour(context)`: Pure function evaluating pet vitals, mood, and personality to select sprite animation and reaction state.
  - `getAmbientThought(personality, species, level)`: Contextual internal monologue strings.
- **Persistence Dependencies:**
  - Persisted inside `pet.personality` within `PetState`.
- **Events & Callbacks:**
  - `onPersonalityChange`: Fired when user selects a different archetype.
- **Cross-System Dependencies:**
  - Informs `MiniGameHub` and `MiniGameResults` for personalized game reactions.
  - Informs `BondingOverviewPanel` and `BondMilestoneToast` for contextual bonding quotes.
- **Automated Tests:**
  - `tests/unit/personality.test.ts`
- **Known Limitations:**
  - Personality switching is instant and free (by design, awards 0 XP and 0 bond points).

---

### Subsystem 3: Interactive Mini-Games System

- **Source Paths:**
  - `src/features/minigames/types.ts`: Mini-game identifiers and score session types
  - `src/features/minigames/starCatcher.ts`: Star Catcher engine (tap falling celestial stars)
  - `src/features/minigames/memorySparks.ts`: Memory Sparks engine (color-sequence memory test)
  - `src/features/minigames/companionRhythm.ts`: Companion Rhythm engine (timing accuracy rhythm game)
  - `src/components/minigames/`: UI components (`MiniGameHub.tsx`, game panels, results modal)
- **Public Interfaces:**
  - `createInitialStarCatcherSession()`, `updateStarCatcherSession()`
  - `createInitialMemorySparksSession()`, `submitMemorySparksStep()`
  - `createInitialRhythmSession()`, `processRhythmHit()`
- **Persistence Dependencies:**
  - Personal high scores persisted inside `ProgressionState.stats` (`starCatcherHighScore`, `memorySparksMaxRound`, `companionRhythmHighScore`).
- **Events & Callbacks:**
  - `onGameCompleted(gameId, score, round)`: Fired on game end to trigger progression achievements and bonding rewards.
- **Cross-System Dependencies:**
  - Evaluated by `achievementsCatalog.ts` (`first_minigame_play`, `all_games_completed`, `star_catcher_expert`).
  - Evaluated by `bondingCatalog.ts` (`daily_minigame_play`, `challenge_rhythm_flow`, `challenge_spark_focus`, `challenge_starlight_collector`).
- **Automated Tests:**
  - `tests/unit/minigames.test.ts`
- **Known Limitations:**
  - Runs in requestAnimationFrame loops; pauses gracefully when window blurs or modal closes.

---

### Subsystem 4: Progression, Achievements & Wardrobe Vault

- **Source Paths:**
  - `src/features/progression/types.ts`: Catalog structures and schema definitions
  - `src/features/progression/cosmeticsCatalog.ts`: 16 unlockable cosmetics across 4 categories
  - `src/features/progression/achievementsCatalog.ts`: 15 deterministic achievements
  - `src/features/progression/engine.ts`: Pure evaluation pipeline for unlocks, equips, un-equips
  - `src/features/progression/persistence.ts`: Schema version 1 persistence and migration
  - `src/components/cosmetics/`: SVG overlay renderers (`CosmeticAccessoryOverlay.tsx`, `CosmeticEffectLayer.tsx`, `EnvironmentBackground.tsx`, `CompanionDecorationOverlay.tsx`)
  - `src/components/progression/`: UI panels (`ProgressionHubModal.tsx`, `WardrobeView.tsx`, `AchievementsGalleryView.tsx`, `UnlockToast.tsx`)
- **Public Interfaces:**
  - `evaluateAchievements(state)`: Pure idempotent evaluation of all 15 achievements.
  - `equipCosmetic(state, cosmeticId)`: Validates ownership and equips into slot.
  - `unequipCosmetic(state, category)`: Unequips slot (falls back to `void_chamber` for environment).
  - `migrateProgressionState(raw)`: Sanitizes legacy or corrupted data into valid schema v1.
- **Persistence Dependencies:**
  - `localStorage.getItem('gh_pet_progression_state_v1')`
  - Integrated into save export/import (`GamePersistenceData.progression`).
- **Events & Callbacks:**
  - `onUpdateProgression(next)`: Broadcasts progression changes.
- **Cross-System Dependencies:**
  - Consumes activity stats from core pet interactions and mini-game sessions.
  - Overlays directly on top of `PetSprite.tsx` in `PetDisplay.tsx` without sprite duplication.
- **Automated Tests:**
  - `tests/unit/progression.test.ts`
- **Known Limitations:**
  - Client-side storage only; unlocking cosmetics does not award contribution XP.

---

### Subsystem 5: Companion Bonding & Daily Focus System

- **Source Paths:**
  - `src/features/bonding/types.ts`: Bonding levels, milestones, activities, challenges
  - `src/features/bonding/bondingCatalog.ts`: 5 milestones, 5 daily activities, 7 rotating challenges
  - `src/features/bonding/timePolicy.ts`: UTC date keying, stable 3-daily hashing, challenge rotation
  - `src/features/bonding/bondingEngine.ts`: Daily reset evaluation, point capping, milestone awards
  - `src/features/bonding/persistence.ts`: Schema version 1 persistence and multi-tab broadcasting
  - `src/components/bonding/`: UI components (`BondingHubModal.tsx`, `BondingOverviewPanel.tsx`, `DailyActivitiesPanel.tsx`, `RotatingChallengesPanel.tsx`, `BondMilestoneToast.tsx`)
- **Public Interfaces:**
  - `recordDirectPetting(state)`: Advances direct petting daily progress and awards capped points (+1/stroke, max 5/day).
  - `recordCareActionForBonding(state)`: Advances care activity and awards capped points (+5/care, max 10/day).
  - `recordMiniGameForBonding(state, gameId, score)`: Advances play activity and challenge progress (+10/game, max 20/day).
  - `recordWardrobeActionForBonding(state, equippedCount)`: Advances wardrobe styling activity.
  - `checkAndResetDay(state)`: Rollover logic across UTC date boundaries.
- **Persistence Dependencies:**
  - `localStorage.getItem('gh_pet_bonding_state_v1')`
  - Integrated into save export/import (`GamePersistenceData.bonding`).
- **Events & Callbacks:**
  - Dispatches `window.dispatchEvent(new CustomEvent('gh_pet_bonding_updated'))` and handles `window.addEventListener('storage')`.
- **Cross-System Dependencies:**
  - Grants cosmetic rewards (`companion_badge`, `decorative_frame`, `star_charm`, `guardian_emblem`) into Progression Vault inventory upon milestone unlock.
- **Automated Tests:**
  - `tests/unit/bonding.test.ts`
- **Known Limitations:**
  - Non-punitive by design: missing days does not decrease bond points or drop bond levels.

---

### Subsystem 6: Application Orchestration & Storage

- **Source Paths:**
  - `src/app/page.tsx`: Single-page application root integrating all subsystems
  - `src/lib/storage/gameStateStorage.ts`: Multi-system export/import, remote GitHub synchronization
  - `src/lib/audio/retroAudio.ts`: Synthesized Web Audio sound effects engine
- **Public Interfaces:**
  - `exportSaveData(pet, history, progression, bonding)`: Exports unified JSON save string.
  - `importSaveData(jsonString)`: Safely imports and migrates all 4 subsystems.
- **Persistence Dependencies:**
  - `gh_pet_game_state_v1`, `gh_pet_action_history_v1`, `gh_pet_connected_repo_v1`, `gh_pet_progression_state_v1`, `gh_pet_bonding_state_v1`.
- **Automated Tests:**
  - `tests/unit/durabilityPreflight.test.ts`
- **Known Limitations:**
  - Token handling in Visitor Mode is strictly volatile and never saved to localStorage.
