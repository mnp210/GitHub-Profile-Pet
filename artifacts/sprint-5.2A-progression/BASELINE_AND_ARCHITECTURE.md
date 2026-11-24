# Sprint 5.2A — Baseline & Architecture Specification

## 1. Candidate Baseline Verification

- **Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Branch:** `candidate/playable-virtual-pet-game`
- **Baseline HEAD:** `1682ccb3d38a7ebfb7686949aa1a588634cc4363`
- **Production Repository:** `mnp210/GitHub-Profile-Pet` (**Read-only, 0 mutations**)
- **Reported Production Baseline:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`
- **Pre-Sprint Automated Tests:** **842 / 842 Passing**
  - Unit Tests: 295 / 295
  - Pet Engine & Durability Tests: 547 / 547

---

## 2. Existing Architecture Overview

1. **Pet State & Persistence:**
   - Managed via `loadLocalPetState()` / `saveLocalGameState()` in `src/lib/storage/gameStateStorage.ts`.
   - LocalStorage key: `profile_pet_state` and `profile_pet_actions`.
   - Isolated mini-game high scores in `profile_pet_minigame_highscores`.
2. **Four Living Personalities:**
   - Curious Investigator, Determined Guardian, Playful Collaborator, Calm Zen Master.
   - Behavior engine drives idle state transitions, ambient thought generation, and contextual mini-game reactions.
3. **Mini-Games Catalog (Sprint 5.1B):**
   - Star Catcher (`star_catcher`), Memory Sparks (`memory_sparks`), Companion Rhythm (`companion_rhythm`).
   - Pure domain engines in `src/features/minigames/`.
   - Invariant: Mini-games award strictly 0 XP and 0 currency.
4. **Pet Sprite Rendering:**
   - `src/components/pet/PetSprite.tsx` renders pixel-art SVGs on a $24 \times 24$ crisp grid for all 4 species (`cat`, `dragon`, `fox`, `slime`).
   - `src/components/pet/PetDisplay.tsx` wraps the sprite in an interactive arena with mood indicators, thought bubble, action buttons, and pedestal.

---

## 3. Sprint 5.2A Architectural Objectives

1. **Independent Progression Subsystem (`src/features/progression/`):**
   - Strict separation of concerns:
     - `achievements`: Completed milestones with timestamps and progress metrics.
     - `unlocks`: Cosmestics made available through achievements or gameplay conditions.
     - `inventory`: Cosmetics owned by the player.
     - `equipped`: Active cosmetic configuration per slot (`accessory`, `effect`, `environment`, `decoration`).
     - `stats`: Validated gameplay counts (interactions, mini-game plays, completions).
     - `github`: Authoritative contribution XP ledger remains separate and untouched.
2. **Cosmetic Rendering Layer (`src/components/cosmetics/`):**
   - Composable pixel-art SVG layers aligned on the $24 \times 24$ grid.
   - Accessory slot: Mini Crown, Developer Glasses, Star Charm, Explorer Scarf, Guardian Shoulder Emblem.
   - Effect slot: Emerald Sparkle, Solar Particles, Crimson Aura, Calm Floating Glow.
   - Environment slot: Void Chamber, Starlight Platform, Forest Sanctuary, Neon Workshop.
   - Companion Decoration slot: Small Companion Badge, Floating Emblem, Decorative Frame.
3. **Safe State Schema & Migration:**
   - Schema versioning with seamless backward compatibility.
   - Missing fields safely defaulted; invalid cosmetic IDs fall back without crashing.
4. **Economy Invariant:**
   - Cosmetic unlocks are purely aesthetic/collector items.
   - Strictly 0 XP, 0 currency, no loot boxes, no RNG, no paywalls.
