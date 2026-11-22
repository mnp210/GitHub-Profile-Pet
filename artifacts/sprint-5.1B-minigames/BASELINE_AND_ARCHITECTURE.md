# Sprint 5.1B — Baseline Architecture & Integration Plan

## 1. Baseline Verification

- **Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Branch:** `candidate/playable-virtual-pet-game`
- **Baseline HEAD:** `965995dbbf3b6574710c56ece6cf671f1e219e8e`
- **Working Tree:** Clean
- **Production Repository:** `mnp210/GitHub-Profile-Pet` (Maintained baseline: `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`, strictly read-only)
- **Baseline Automated Test Count:** 818 passing tests (271 unit tests + 547 pet-engine tests)

---

## 2. Existing System Architecture & Reusable Modules

Sprint 5.1B builds directly on the established modular architecture without expanding unnecessary infrastructure:

1. **Personality Engine (`src/features/personality/`):**
   - Catalog: `CURIOUS`, `DETERMINED`, `PLAYFUL`, `CALM` in `personalities.ts`.
   - Domain Types: `PersonalityProfile`, `PersonalityId`, `BehaviourState`, `CompanionReaction` in `types.ts`.
   - Dynamic Dialogue & Thought Generation: `getCompanionReaction()`, `getAmbientThought()` in `behaviourEngine.ts`.
2. **Sprite & Rendering Engine (`src/components/pet/`):**
   - `PetSprite.tsx`: Modular pixel vector SVG renderer supporting `animationState` (`idle`, `happy`, `eating`, `training`, `sleeping`, `playing`, `curious`, `celebrating`, `clicked`), blinking frequency modulation, and `prefers-reduced-motion` compliance.
   - `PetDisplay.tsx`: Dominant pet arena with floating particle emitter (`triggerParticle`), cooldown status bar, and thought bubble.
   - `PersonalityPanel.tsx`: Companion archetype profile banner, trait indicators, and interactive switcher.
3. **Audio Engine (`src/lib/audio/retroAudio.ts`):**
   - Synthesized Web Audio API sound effects (`playClick`, `playEat`, `playPlay`, `playTrain`, `playRest`, `playPurr`, `playLevelUp`, `playError`).
   - Pure client-side synthesis requiring zero external asset loading and respecting mute toggles.
4. **Game Storage & Persistence (`src/lib/storage/gameStateStorage.ts`):**
   - LocalStorage management for `PetState`, action history, connected repository config, and save import/export.

---

## 3. Mini-game System Architecture Plan

We will create a clean, dedicated domain feature at `src/features/minigames/` containing:

```
src/features/minigames/
├── types.ts                    # Game session models, score rules, input payloads
├── engine.ts                   # Core session lifecycle, validation, integrity guards
├── starCatcher.ts              # Game A: Star Catcher game engine
├── memorySparks.ts             # Game B: Memory Sparks game engine
├── companionRhythm.ts          # Game C: Companion Rhythm game engine
├── personalityReactions.ts     # In-game dialogue & companion reactions
└── index.ts                    # Public barrel exports
```

And corresponding frontend presentation components:

```
src/components/minigames/
├── MiniGameHub.tsx             # Activity selection hub & modal/drawer container
├── StarCatcherGame.tsx         # Interactive view for Star Catcher
├── MemorySparksGame.tsx        # Interactive view for Memory Sparks
├── CompanionRhythmGame.tsx     # Interactive view for Companion Rhythm
└── MiniGameResults.tsx         # Unified results, stats, and companion celebration
```

---

## 4. Invariants & Strict Boundaries

1. **Zero XP Exploitation:** Mini-games award 0 XP and 0 currency. No contribution ledgers or caps are modified.
2. **Isolated Session Integrity:** Each game session generates a UUID, validates input boundaries, and seals score upon completion. Duplicate completions are strictly rejected.
3. **Universal Accessibility:** All mini-games are playable with keyboard, mouse, or touch, provide visual fallbacks for sound cues, and respect `prefers-reduced-motion`.
