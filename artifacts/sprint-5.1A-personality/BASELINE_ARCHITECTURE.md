# Sprint 5.1A — Baseline Architecture Inspection

**Inspection Date:** 2026-11-22  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Baseline Candidate HEAD:** `8c9cf19557bab790edbf205bb5ed97e463818a0a`  
**Production Repository:** `mnp210/GitHub-Profile-Pet` (Untouched / Read-Only)  
**Production Baseline HEAD:** `3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52`  
**Working Tree Status:** Clean  

---

## 1. Existing Pet Component Architecture

The virtual pet rendering and user experience is structured across four primary presentation components:

1. **`src/app/page.tsx` (Dashboard & Primary Game Controller):**
   - Orchestrates pet state loading from `localStorage` (`loadLocalGameState`) and backend reconciliation.
   - Manages action execution via `executePetAction` in `src/features/gamification/gameplay.ts`.
   - Coordinates cooldown timers, action history logs, sound effects, and feedback alerts.
2. **`src/components/pet/PetDisplay.tsx` (Interactive Pet Arena):**
   - Renders the primary pet stage, interactive sprite wrapper, floating speech bubbles, and care action buttons (`pet`, `train`, `feed`, `rest`, `play`).
   - Renders floating particle text (`+24 Satiety`, `Purr~`, etc.).
   - Triggers audio feedback via `retroAudio`.
3. **`src/components/pet/PetSprite.tsx` (Pixel Art Sprite Engine):**
   - Renders 24x24 / 32x32 pixel SVG vector silhouettes with `shape-rendering="crispEdges"`.
   - Supports 4 companion species:
     * `cat` (Shadow Claw — Void Familiar)
     * `dragon` (Ignis Ember — Ruby Drake)
     * `fox` (Kitsune Sol — Nine-Tail Scout)
     * `slime` (Bloop Matrix — Cyber Jelly)
   - Features periodic blinking interval (3-5s random timer) and sprite state classes: `idle`, `happy`, `eating`, `training`, `sleeping`, `playing`, `clicked`.
4. **`src/components/pet/PetStatus.tsx` & `src/components/pet/PetEvolution.tsx`:**
   - Visualizes vitals (energy, hunger, happiness) and evolution milestones.

---

## 2. Current Mood & Emotion System

Pet mood is calculated deterministically from vitals in `src/features/gamification/vitals.ts`:
```typescript
export function deriveMood(vitals: { energy: number; hunger: number; happiness: number }): PetMood {
  if (vitals.energy <= 20) return 'Resting';
  if (vitals.hunger <= 25) return 'Curious';
  if (vitals.happiness >= 80 && vitals.energy >= 50) return 'Energetic';
  if (vitals.happiness >= 60) return 'Happy';
  return 'Focused';
}
```
- Available moods: `'Energetic' | 'Happy' | 'Focused' | 'Curious' | 'Resting'`.
- Reaction texts are looked up in `getSpeciesReaction(species, action)` in `src/features/gamification/gameplay.ts`.

---

## 3. Existing Animation Capabilities

- **CSS Keyframe Animations (Tailwind / globals.css):**
  - `animate-pet-cat` (swaying tail and subtle body bob)
  - `animate-pet-dragon`, `animate-pet-fox`, `animate-pet-slime`
  - `animate-bounce` (for happy, clicked, playing states)
  - `animate-pulse` (for eating)
  - `animate-wiggle` (for training)
  - `opacity-75 scale-95` (for sleeping)
- **Eyes & Expression Changes:**
  - `blink`: closed horizontal pixel eye slits.
  - `sleeping`: closed eye slits with dimmer opacity.

---

## 4. Existing Interaction Mechanics & Gameplay Limits

- **Available Actions:** `pet`, `train`, `feed`, `rest`, `play`.
- **Cooldown & Debounce:** `ACTION_COOLDOWN_MS = 800` (800ms between actions).
- **Diminishing Returns:** `ROLLING_WINDOW_MS = 60_000` with multiplier schedule `[1.0, 0.60, 0.35, 0.20, 0.10]`.
- **Energy / Satiety Gating:**
  - Training requires $\ge 18$ energy.
  - Playing requires $\ge 10$ energy.
  - Feeding is blocked if satiety is 100.
  - Resting awards strictly 0 XP.

---

## 5. State Persistence Design

- **Browser Storage:**
  - `localStorage.getItem('github_profile_pet_state')`: stores `PetState`.
  - `localStorage.getItem('github_profile_pet_action_history')`: stores `ActionHistoryEntry[]`.
- **On-Disk Production Document (`pet/state/pet.json`):**
  - Authoritative document used by GitHub Actions workflows (`pet-activity.yml`, `pet-publisher.yml`).
  - Schema defined in `pet/schemas/pet.schema.json`.

---

## 6. Integration Opportunities for Sprint 5.1A

1. **Personality Definition:** Introduce 4 distinct personality archetypes (`curious`, `playful`, `calm`, `determined`) that modulate idle behavior probabilities, speech bubble texts, and reaction animations.
2. **Deterministic Companion Default:**
   - For Shadow Claw (Void Familiar / cat): assign `'curious'` (nocturnal terminal investigator).
   - Ignis Ember (dragon): `'determined'` (CI powerhouse).
   - Kitsune Sol (fox): `'playful'` (agile code collaborator).
   - Bloop Matrix (slime): `'calm'` (resilient fluid absorber).
3. **Dynamic Behaviour Engine:** Implement state machine with states `IDLE`, `LOOKING_AROUND`, `PLAYING`, `RESTING`, `CURIOUS`, `HAPPY`, `EXCITED`, `CELEBRATING`, `SLEEPING`.
4. **Enhanced SVG Expressions:** Add head-tilt, dilated curious eyes, sleeping Zzz bubbles, and determined focus glints.
5. **Reduced-Motion & Hidden-Tab Safety:** Pause continuous behaviour timers when document is hidden (`document.hidden`) or when `prefers-reduced-motion` is active.

---

## 7. Potential Regression Risks & Guardrails

- **XP Farming Exploits:** Personality and idle interactions must never award XP.
- **Timer Leaks & CPU Spikes:** Ensure all animation intervals use `useEffect` cleanup and visibility change listeners.
- **Schema Incompatibility:** Personality field must be optional in `pet.schema.json` so existing `pet.json` documents load with zero errors.
- **Git State Pollution:** Animation and transient idle states must remain 100% in-memory and never trigger file writes or Git commits.
