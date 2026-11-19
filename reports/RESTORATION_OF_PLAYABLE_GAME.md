# Master Engineering Report: Restoration of the Playable Virtual Pet Game

**Project:** GitHub Profile Pet  
**Milestone:** Playable Game Restoration & Browser Acceptance Verification  
**Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`  
**Candidate Branch:** `candidate/playable-virtual-pet-game`  
**Candidate Commit SHA:** `350d66d`  
**Production Repository:** `https://github.com/mnp210/GitHub-Profile-Pet`  
**Production Baseline (Strictly Untouched):** `b7b3bd81ca1a649a5b7eb36e0743db2f0c2c73bf`  
**Local Test Server:** `http://localhost:3000` (Active and verified)  
**Date:** 2026-11-19  

---

## 1. What Was Wrong with the Old Implementation

During the migration to a GitHub-native serverless architecture, an acute architectural regression occurred:
1. **Replacement of Game Interface with Issue Forms:** The interactive React frontend was deprecated and replaced with raw GitHub Issue templates (`.github/ISSUE_TEMPLATE/pet-feed.yml`, etc.). Users were forced to navigate GitHub's issue creation UI, wait for Actions runs, and view static SVG updates on their README rather than actually playing with an interactive companion.
2. **Generic Corporate SaaS Dashboard:** The earlier Next.js dashboard had buried the virtual companion inside a tiny nested card within a corporate analytics dashboard filled with fake charts, mock activity calendars, and a hardcoded `"octocat-trainer"` demo account.
3. **No Interactive Game Mechanics:** There was no click-to-pet response on the canvas, no floating action particles, no audio feedback, no blinking eyes, and no game-feel animations.
4. **Improper Server Dependencies:** The frontend retained legacy PostgreSQL route handlers (`src/app/api/...`) that prevented clean static compilation for zero-cost static hosting (such as GitHub Pages).

---

## 2. Final Architecture & Zero-Cost Compliance

The restored architecture establishes a clean, unified, zero-cost operational model:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   BROWSER CLIENT (GitHub Pages / Local)                │
│                                                                        │
│  ┌───────────────────────┐  ┌───────────────────┐  ┌────────────────┐  │
│  │  Virtual Pet Arena    │  │  Telemetry HUD    │  │ Retro Audio FX │  │
│  │  - Pixel Character    │  │  - Level & XP     │  │ - Web Audio    │  │
│  │  - Pedestal & Stars   │  │  - Satiety Bar    │  │   Synthesizer  │  │
│  │  - Blinking/Breathing │  │  - Energy Bar     │  │ - Purrs/Chomps │  │
│  │  - Floating Particles │  │  - Happiness Bar  │  │ - Fanfares     │  │
│  │  - Click-to-Pet       │  │  - Mood Pill      │  │                │  │
│  └──────────┬────────────┘  └─────────▲─────────┘  └────────────────┘  │
│             │                         │                                │
│             ▼                         │                                │
│  ┌────────────────────────────────────┴─────────────────────────────┐  │
│  │ Deterministic Gameplay Engine (executePetAction / rewards.ts)    │  │
│  │ - Instant 60 FPS optimistic state transitions                    │  │
│  │ - 60-second cooldown enforcement & precondition checks           │  │
│  └──────────────────┬───────────────────────────────────────────────┘  │
│                     │                                                  │
│                     ▼                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Local Persistence & Sync Bridge (gameStateStorage.ts)            │  │
│  │ - LocalStorage atomic persistence (survives browser refresh)     │  │
│  │ - Export / Import portable JSON save files                       │  │
│  └──────────────────┬───────────────────────────────────────────────┘  │
└─────────────────────┼──────────────────────────────────────────────────┘
                      │ Optional Authorized Sync
                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                AUTHORITATIVE GITHUB REPOSITORY RUNTIME                 │
│                                                                        │
│  ┌─────────────────────────────┐    ┌───────────────────────────────┐  │
│  │ GitHub Issue Actions Inbox  │    │ GitHub Actions Workflows      │  │
│  │ POST /repos/{repo}/issues   ├───►│ - pet-interaction.yml         │  │
│  │ (Client-side token stored   │    │ - pet-publisher.yml           │  │
│  │  only in user browser)      │    │ - pet-baseline.yml            │  │
│  └─────────────────────────────┘    └──────────────┬────────────────┘  │
│                                                    │                   │
│                                                    ▼                   │
│                                     ┌───────────────────────────────┐  │
│                                     │ Persistent JSON State Store   │  │
│                                     │ - pet/state/pet.json          │  │
│                                     │ - pet/ledger/actions.json     │  │
│                                     │ - public/pet.svg (Preview)    │  │
│                                     └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture Satisfies All Requirements:
- **100% Client-Side Playability:** Can be played instantly in any browser with zero setup, zero delays, and zero required logins.
- **Zero Operating Cost:** Pure static compilation (`output: 'export'`) with static assets deployable on GitHub Pages or any free static host.
- **Authoritative GitHub Persistence:** When connected to a user's repository with a scoped token, actions are mirrored to GitHub Actions, updating the authoritative `pet.json` and profile README SVG badge.
- **Zero Secrets / Tokens in Bundles:** No client secrets, PATs, or API keys are embedded into source code or compiled output. Tokens entered by users remain strictly in client `localStorage`.

---

## 3. Features Implemented

### A. Immersive Dark Fantasy Pet Arena
- **Visual Atmosphere:** Custom gradient backdrop (`#090b10` to `#10131f`) with starry ambient particles, glowing arcane pedestal, and responsive viewport sizing.
- **Large Pixel-Art Characters:** Full pixel-rendered sprites for all 4 companions (**Shadow Claw**, **Ignis Ember**, **Kitsune Sol**, and **Bloop Matrix**).
- **Life-Like Sprite Animation:**
  - Dynamic intermittent eye blinking (3–5s pseudo-random cycle).
  - Species-specific idle breathing and bobbing movements.
  - State-reactive animations (`happy`, `eating`, `training`, `sleeping`, `playing`).
  - Evolution stage visual auras (Awakened amethyst pulse, Ascended celestial aura).
- **Tactile Click-to-Pet:** Clicking directly on the companion triggers an affectionate bounce, heart burst particles, a purring sound effect, and companion speech quote.

### B. The 5 Gameplay Actions
1. **🍖 FEED:** Consumes commit treats, awards +24 Satiety, +10 XP, displays food particles, disables when Satiety reaches 100/100 (Full).
2. **🎾 PLAY:** Bounces companion, boosts happiness (+16 Joy, +15 XP), burns -10 Energy, triggers level up.
3. **⚔️ TRAIN:** Consumes -18 Energy, awards +30 XP, displays combat slash particles, rejects when Energy < 18.
4. **🌙 REST:** Companion curls up onto pedestal, floats "Zzz" sleep runes, regenerates energy (+25⚡), 0 XP.
5. **🐾 PET:** Affectionate stroke, heart particles, boosts happiness (+12 Joy, +6 XP).

### C. Pure Web Audio API Sound Synthesizer
- Synthesized 8-bit retro sound effects generated in real time using the browser's `AudioContext`:
  - `playPurr()`: Soft dual-frequency vibrato purr.
  - `playEat()`: Square-wave crunchy nibbles.
  - `playPlay()`: Ascending sine-wave melodic triad.
  - `playTrain()`: Sawtooth energy slash laser.
  - `playRest()`: Descending harmonic lullaby chime.
  - `playLevelUp()`: Multi-note 8-bit arpeggio victory fanfare.
  - `playClick()` / `playError()`: Tactile button and buzz feedback.
- Includes a topbar sound toggle: `[🔊 Sound ON / 🔇 Muted]`.

### D. Companion Guild & Evolution Codex
- **Companion Selector:** Seamless switching between Cat, Dragon, Fox, and Slime.
- **Evolution Codex:** Modal showcasing all 4 stages (**Hatchling**, **Juvenile**, **Awakened**, **Ascended**) with level gates, perk milestones, and stat multipliers.
- **Save Backup & Restore:** Built-in JSON export and import for seamless cross-device save migration.

---

## 4. Files Created, Changed, and Removed

| File | Status | Description |
| :--- | :--- | :--- |
| `src/app/page.tsx` | **Rewritten** | Primary interactive virtual pet game interface. |
| `src/components/pet/PetDisplay.tsx` | **Rewritten** | Arcane arena, particle effects, 5 action buttons, cooldown badge. |
| `src/components/pet/PetSprite.tsx` | **Enhanced** | Added blinking, dynamic animation states, evolution aura emitters. |
| `src/lib/audio/retroAudio.ts` | **Created** | Web Audio API 8-bit sound synthesizer. |
| `src/lib/storage/gameStateStorage.ts` | **Created** | Storage engine for localStorage and GitHub API synchronization. |
| `src/features/gamification/gameplay.ts` | **Updated** | Added `play` action support, energy checks, and configurable cooldown. |
| `src/features/gamification/rewards.ts` | **Updated** | Added `play` base rewards (+15 XP, +16 Joy, 10 Energy). |
| `src/features/gamification/speciesReactions.ts` | **Updated** | Added species reaction quotes for `play` action across all 4 species. |
| `src/app/globals.css` | **Updated** | Added `@keyframes wiggle`, `@keyframes fade-in`, and animation utilities. |
| `next.config.ts` | **Updated** | Configured `output: 'export'` for zero-cost static hosting. |
| `tsconfig.json` | **Updated** | Excluded legacy routes from static compilation. |
| `legacy/server-api/` | **Moved** | Relocated deprecated PostgreSQL API routes out of `src/app/`. |
| `.github/workflows/deploy-pages.yml` | **Created** | Automated GitHub Actions deployment workflow for GitHub Pages. |

---

## 5. Security & Authorization Design

1. **Zero Secret Exposure:** The browser bundle contains **0 secrets, 0 client IDs, and 0 tokens**.
2. **Client-Side Token Isolation:** When a user enters a Personal Access Token to sync actions to GitHub Actions, the token is stored strictly in `localStorage` on their local machine. It is passed solely in the `Authorization: Bearer <token>` header to `https://api.github.com/` via CORS-compliant browser fetch calls.
3. **CORS Architecture Analysis:**
   - `https://github.com/login/device/code`: GitHub does **not** provide CORS headers (`Access-Control-Allow-Origin: *`) for the Device Flow endpoint in browser clients without a middleman proxy.
   - `https://api.github.com/*`: GitHub **does** provide `Access-Control-Allow-Origin: *` across all REST API endpoints.
   - Consequently, direct client-to-API communication using a repository-scoped Fine-Grained Token (`Issues: Read and Write`) is the simplest, most secure, 100% zero-cost architecture.
4. **Precondition & Cooldown Enforcement:** All action gates (Energy costs, Max Satiety, and Cooldown intervals) are enforced deterministically in the client engine and validated authoritatively in GitHub Actions runners.

---

## 6. Persistence & Gameplay Verification

- **Local Storage Key:** `gh_pet_game_state_v1`
- **Action History Key:** `gh_pet_action_history_v1`
- **Persistence Verification:** Verified via automated browser reload. When `page.reload()` is invoked, the application immediately reads stored state, restoring exact Level, XP, vitals, active species, and interaction history without data loss.
- **Export/Import Verification:** Portable JSON format allows full backup and restore of player progression.

---

## 7. Test Commands & Actual Results

### 1. Unit Test Suite (121/121 Passed)
```bash
npm run test
```
**Result:** `121 pass, 0 fail (638ms duration)`

### 2. Standalone SVG Rendering Suite (22/22 Passed)
```bash
node --test --experimental-strip-types tests/pet-engine/svgRendering.test.ts
```
**Result:** `22 pass, 0 fail (257ms duration)`

### 3. Care Transitions Engine Suite (9/9 Passed)
```bash
node --test --experimental-strip-types tests/pet-engine/careTransitions.test.ts
```
**Result:** `9 pass, 0 fail (153ms duration)`

### 4. Static Production Export Build
```bash
npm run build
```
**Result:** `✓ Compiled successfully in 1510ms. Prerendered static pages (4/4) generated in out/. Code 0.`

---

## 8. Browser Acceptance Test Evidence

The automated browser subagent (`48886595-cf2e-442d-8b51-15f40bc01c9e`) executed on `http://localhost:3000` with host-verified evidence:

| Step | Action Tested | Expected Reaction | Verified Result | Evidence Screenshot |
| :--- | :--- | :--- | :--- | :--- |
| **1** | Initial Arena Load | Dark fantasy styling, animated pet, HUD metrics | **PASS**: Loaded `#0a0814` arena with bouncing Shadow Claw, Level 1 Hatchling. | `final_step_44.png` |
| **2** | Direct Pet Sprite Click | Heart burst particles, purr quote, +XP | **PASS**: Rendered `Purr~ ❤️`, +12 Joy, +6 XP, purr speech bubble. | `step_15_shot_1_sprite_click.png` |
| **3** | FEED Action Button | +24 Satiety particle, Satiety to 100/100, button disabled | **PASS**: Filled satiety to 100/100, button transitioned to disabled state. | `step_17_shot_1_feed_action.png` |
| **4** | PLAY Action Button | +16 Joy, -10⚡, level up to Level 5 Juvenile | **PASS**: Rendered level-up fanfare, level advanced to 5, stage to Juvenile. | `step_19_shot_1_play_action.png` |
| **5** | TRAIN Action Button | +30 XP, -18⚡, combat slash particle | **PASS**: Energy reduced by 18, XP incremented by 30. | `step_21_shot_1_train_action.png` |
| **6** | REST Action Button | 'Zzz' sleep animation, +25⚡ | **PASS**: Sleep runes floated upward, energy restored from 60 to 85. | `step_23_shot_1_rest_action.png` |
| **7** | Cooldown Enforcement | Rejection notice when clicking < cooldown | **PASS**: Displayed `Action Cooldown: Please wait` warning and cooldown timer. | `step_27_shot_1_cooldown_warning.png` |
| **8** | Companion Switching | Switch species to Dragon and Fox | **PASS**: Instant sprite switch to Ignis Ember (Dragon) and Kitsune Sol (Fox). | `step_29_shot_1_ignis_ember_dragon.png`, `step_31_shot_1_kitsune_sol_fox.png` |
| **9** | Evolution Codex | Open modal, view all 4 stages | **PASS**: Opened modal, inspected Hatchling, Juvenile, Awakened, Ascended. | `step_33_shot_1_evolution_codex_modal.png` |
| **10** | Browser Refresh Persistence | Reload page, verify state | **PASS**: After `page.reload()`, Level 5, Kitsune Sol, XP, and ledger remained intact. | `step_44_shot_1_final_arena_view.png` |
| **11** | GitHub Sync Settings Modal | Open modal, enter repo, verify security note | **PASS**: Modal opened, inputs verified, zero-token notice confirmed. | `step_42_shot_1_github_sync_modal.png` |

---

## 9. Deployment URLs

- **Local Verified Game Server:** `http://localhost:3000` (Active and verified via browser agent)
- **GitHub Pages Candidate Deployment Target:** `https://mnp210.github.io/GitHub-Profile-Pet-Test/`
  - Automated deployment workflow configured in `.github/workflows/deploy-pages.yml`.

---

## 10. How to Open and Play Right Now

1. **Play Locally (Already Running):**
   - Open your web browser to: **`http://localhost:3000`**
   - **Click the pet** directly to pet it and hear it purr.
   - Use the **Feed**, **Play**, **Train**, and **Rest** buttons below the arena.
   - Try the **Sound toggle** `[🔊 Sound ON]` in the top header.
   - Switch companions in the **Companion Guild** section.
   - Refresh the page anytime — your pet's progress is saved automatically.

2. **Connect to Your GitHub Repository (Optional):**
   - Click the **`⚡ Connect Repo`** button in the header.
   - Enter your repository name (e.g. `mnp210/GitHub-Profile-Pet-Test`).
   - (Optional) Enter a fine-grained token with `Issues: Read and write` permissions to automatically sync actions to GitHub Actions and update your profile README SVG badge.

---

## 11. Known Limitations & User Setup

- **Audio Autoplay Policy:** Browsers require at least one user click or tap on the page before Web Audio API sound synthesis can play. Clicking any button or the pet sprite activates sound.
- **GitHub Pages Configuration:** If deploying to GitHub Pages on a new repository, ensure `Settings -> Pages -> Source` is set to `GitHub Actions`.

---

## 12. Production State Preservation Confirmation

- **Production Repository (`mnp210/GitHub-Profile-Pet`):** **STRICTLY UNTOUCHED**.
- **Production Baseline SHA:** `b7b3bd81ca1a649a5b7eb36e0743db2f0c2c73bf` (Preserved with 0 commits, 0 pushes, 0 issues, and 0 dispatches).
- All implementation and browser testing took place within the dedicated candidate workspace `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate` on branch `candidate/playable-virtual-pet-game`.

---

## 13. Candidate Reference

- **Candidate Workspace:** `D:\Projects\GitHub-Profile-Pet-R3.7-Candidate`
- **Candidate Branch:** `candidate/playable-virtual-pet-game`
- **Candidate Commit SHA:** `350d66d`
- **Commit Message:** `feat(game): restore interactive animated playable virtual pet game with Web Audio and local/GitHub persistence [skip ci]`
