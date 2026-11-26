# Sprint 5.1B — Gameplay Systems & Companion Play Architecture

## 1. Overview and Core Philosophy

In Sprint 5.1A, GitHub Profile Pet evolved into an expressive living companion featuring dynamic moods, distinct archetypes, and contextual idle behaviors. Sprint 5.1B elevates this companion experience by introducing an interactive **Play Zone**: a curated suite of three responsive, accessible mini-games playable directly inside the pet interface.

The design adheres to four inviolable pillars:
1. **Integrated Companion Presence:** Games are not detached canvas demos; the active pet companion attends every session, reacting in-character with authentic archetypal dialogue, cheering combos, offering comfort on misses, and celebrating personal bests.
2. **Accessible & Responsive Execution:** Every activity provides multi-modal input (touch, mouse, keyboard), zero mandatory audio dependencies, high-contrast visual cues, and graceful `prefers-reduced-motion` compliance across viewports from 360px mobile to 4K desktop.
3. **Zero-XP Economy Invariant:** Mini-games are designed purely for intrinsic engagement, bonding, and delight. Sessions award strictly **0 XP**, mutate no GitHub activity ledgers, consume no care quotas, and cannot be exploited for leaderboard or level inflation.
4. **Deterministic & Resilient Session Engine:** Game state, timer ticks, scoring formulas, streak multipliers, and high-score records are decoupled into pure TypeScript domain engines with comprehensive unit test coverage.

---

## 2. Mini-Game Catalog

| Game ID | Name | Genre / Core Mechanic | Input Modalities | Primary Feedback | Session Duration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `star_catcher` | **Star Catcher** | Reflex & Trajectory Catching (Falling cosmic bodies) | Pointer tap, drag basket, keyboard `ArrowLeft`/`ArrowRight` / `A`/`D` | Catch sparkles, combo counters, missed star dissipation | 30 seconds |
| `memory_sparks` | **Memory Sparks** | Sequence Recall & Pattern Recognition (4 Elemental Runes) | Pointer tap, keyboard numbers `1-4`, `WASD`, Arrow keys | Rune glow, resonant frequencies, sequence progress pips | Progressive rounds (1 to 6) |
| `companion_rhythm` | **Companion Rhythm** | Timing & Precision Groove (Approaching rhythm pulses) | "Strike Beat" button, keyboard `Space` / `Enter` | Timing ratings (`PERFECT`, `GOOD`, `EARLY`/`LATE`, `MISS`), combo multiplier | 16-beat track (~15-20s) |

---

## 3. Architecture & File Structure

The mini-games subsystem is modularized into distinct domain logic and presentation layers:

```
src/
├── features/
│   └── minigames/
│       ├── types.ts                    # Interfaces for sessions, game states, ratings, and catalog
│       ├── engine.ts                   # Session lifecycles (create, start, pause, resume, finish, abandon)
│       ├── starCatcher.ts              # Bounded arena physics, entity spawning, collision & tap detection
│       ├── memorySparks.ts             # Rune sequences, playback locking, round evaluation & bonuses
│       ├── companionRhythm.ts          # Deterministic track generation, timing window checks, combo math
│       ├── personalityReactions.ts     # In-character dialogue & behavior dispatcher for all 4 archetypes
│       └── index.ts                    # Public barrel export
└── components/
    └── minigames/
        ├── MiniGameHub.tsx             # Master modal dialogue, catalog picker, instructions overlay
        ├── MiniGameResults.tsx         # Unified results scorecard, personal best badge, companion reactions
        ├── StarCatcherGame.tsx         # Star Catcher interactive arena component
        ├── MemorySparksGame.tsx        # Memory Sparks 4-rune interactive compass matrix
        └── CompanionRhythmGame.tsx     # Companion Rhythm pulse timeline & strike pad
```

---

## 4. Session Lifecycle State Machine

Each game session follows a strict finite state machine governed by `src/features/minigames/engine.ts`:

```
               [ createGameSession() ]
                         │
                         ▼
                   ( status: 'idle' )
                         │
               [ startGameSession() ]
                         │
                         ▼
                 ( status: 'playing' )
                  │       ▲        │
  [ pauseGameSession ]    │        │ [ abandonGameSession ]
                  ▼       │        │
         ( status: 'paused' )      │
           [ resumeGameSession ]   ▼
                         │    ( status: 'abandoned' )
                         ▼
                ( status: 'playing' )
                         │
               [ finishGameSession() ]
                         │
                         ▼
               ( status: 'finished' )
```

### Safety & Integrity Controls:
- **Timestamp Validation:** `startTime` and `endTime` are strictly validated; sessions with backwards or negative durations are rejected.
- **Score Bounds Enforcement:** Sessions enforce game-specific maximum possible score caps (e.g. Star Catcher 2500, Memory Sparks 1500, Companion Rhythm 2000). Excessively large or negative scores fail validation.
- **Local High Score Isolation:** High scores are isolated per game key (`profile_pet_minigame_highscores`) and updated only when a session is cleanly finished with a valid, non-abandoned status.
