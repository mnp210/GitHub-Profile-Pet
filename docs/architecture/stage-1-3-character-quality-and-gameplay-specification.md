# STAGE 1.3 — CHARACTER QUALITY & GAMEPLAY FOUNDATION SPECIFICATION
## GitHub Profile Pet Platform Architecture & Production Blueprint

**Author:** Staff Software Architect & Game Systems Designer  
**Scope:** Character Art Audit & Pipeline, Customization, Economy Engine, Onboarding Journey, Public README Showcase & Domain Data Model  
**Project Workspace:** `D:\Projects\GitHub-Profile-Pet`  
**Status:** Complete Architectural Proposal (Pre-Implementation Verification)

---

## 1. Character Art Quality Audit & Production Sprite Pipeline

### 1.1 In-Depth Audit of Current SVG Sprite Prototype

The current inline SVG sprites ([PetSprite.tsx](file:///d:/Projects/GitHub-Profile-Pet/src/components/pet/PetSprite.tsx)) were authored in Stage 1.2 as a mathematical proof-of-concept. While effective for testing responsive boundaries and color tokens, they suffer from fundamental artistic limitations:

| Species | Current Prototype Analysis | Silhouette Recognition | Facial Expression & Personality | Small-Size Readability (32-48px) |
| :--- | :--- | :--- | :--- | :--- |
| **Shadow Claw** *(Cat)* | 24×24 integer rects, emerald eye slit, static chest crest | **Medium-High:** Ears and curled tail are clear, but paws lack ground weight. | **Rigid:** Monolithic eye blocks cannot squint, blink, or emote during rest/eating. | **Fair:** Ear tips read well; whisker lines become noisy sub-pixel artifacts at <36px. |
| **Ignis Ember** *(Dragon)* | Horn crest, ruby scale gradient, wing polygons | **Medium:** Wing silhouettes blend into the torso without clear outline contrast. | **Stern / Static:** Snout has no mouth articulacy; cannot puff smoke or breathe fire. | **Poor:** Wing and tail spikes cluster into a red blob below 40px in README embeds. |
| **Kitsune Sol** *(Fox)* | Ochre body, cream muzzle, sweeping bushy tail | **High:** The sweeping fluffy tail is the strongest natural silhouette. | **Blank:** Eyes lack personality; expression does not reflect its "clever" lore. | **Good:** Orange and white fur demarcation maintains high contrast even down to 32px. |
| **Bloop Matrix** *(Slime)* | Gel perimeter with floating matrix crystal inside | **Medium-Low:** Reads as a simple dome blob; lacks distinct gelatinous rim lighting. | **Rudimentary:** 2-pixel black dots with white highlight; lacks true jelly deformation. | **Fair:** Simple shape scales easily, but looks overly generic without squish frames. |

### 1.2 Production Sprite-Sheet Specification

To transition from rudimentary CSS bobbing to authentic game-feel, all four companions will follow a **Standardized 32×32 Matrix Frame Pipeline**:

1. **Resolution & Canvas:**
   - Base canvas: **32 × 32 pixels** (upgrade from 24×24 to allow expressive eye, muzzle, and accessory details while keeping crisp integer pixels).
   - Display scaling: `image-rendering: pixelated; shape-rendering: crispEdges;`.
   - Grid bounding box: Character occupies max 26×26 pixels centered, with a 3px padding zone for ear flicks, wing flaps, and tail motions.
2. **Standard Color Palette Discipline (Indexed Color):**
   - Maximum 6 indexed tones per creature:
     - 1 Deep Outline Tone (hue-shifted dark, never pure `#000000`).
     - 2 Core Body Tones (Base + Midtone Shadow).
     - 1 Specular Highlight Tone.
     - 1 Eye / Glow Accent Tone.
     - 1 Secondary Accessory / Chest Tone.
3. **Required Frame States & Timing Matrix:**

| State Sheet | Frame Count | Loop Type | Duration / FPS | Visual Description & Expressive Detail |
| :--- | :--- | :--- | :--- | :--- |
| `idle.png` | 4 frames | Ping-Pong Loop | 800ms (5 fps) | Natural chest breathing, ear twitch on frame 3, tail sway. |
| `happy.png` | 4 frames | Repeat Loop | 600ms (6.6 fps) | Closed smiling crescent eyes (`^ ^`), buoyant body bounce, sparkle particle tick. |
| `curious.png` | 3 frames | One-Shot / Hold | 600ms (5 fps) | Head-tilt 4 degrees, widened speculative pupils, raised ear/wing. |
| `tired.png` | 2 frames | Slow Ping-Pong | 1200ms (1.6 fps) | Droopy eyelids, slumping shoulder posture, heavy ground contact. |
| `sleeping.png` | 4 frames | Loop | 1600ms (2.5 fps) | Curled ball posture, rhythmic slow expansion, floating 3-frame pixel `Zzz` layer. |
| `eating.png` | 6 frames | One-Shot | 750ms (8 fps) | Mouth opens wide, chomps floating commit token, happy eye squeeze, cheeks bulge. |
| `training.png` | 6 frames | One-Shot | 600ms (10 fps) | Anticipation windup, energetic forward dash/swipe/flame puff, quick recover. |
| `evolve.png` | 8 frames | Dramatic One-Shot | 1200ms (6.6 fps) | Shimmering light engulfs silhouette, expansion pop, tier 2/3 crest emergence. |

4. **Asset Export Pipeline & Naming Conventions:**
   - Authoring Source: `.aseprite` (layers: `shadow`, `base_body`, `face_features`, `accessories`, `particles`).
   - Export Artifacts:
     - Web App: Packed WebP / PNG horizontal strips (`/public/sprites/pets/{species}/{state}.png`).
     - GitHub README Embed: Frame-optimized animated standalone SVG with embedded CSS `@keyframes steps(N)` for zero-dependency standalone rendering.
   - Naming Convention: `{species}_{evolutionStage}_{animationState}_32x32.png`  
     *(e.g., `cat_stage1_idle_32x32.png`, `cat_stage2_training_32x32.png`)*.

---

## 2. Polished Prototype Character Art Proposal: Shadow Claw (Cat)

As requested, we establish the production quality standard on **Shadow Claw** before expanding to the remaining three species.

```text
       SHADOW CLAW — IDLE & ANIMATION FRAME ARCHITECTURE (32x32 GRID)

       Frame 0: Neutral Rest         Frame 1: Inhale Lift          Frame 2: Ear Flick Peak       Frame 3: Exhale Settle
       [ . . . . . . . . . . . ]     [ . . . . . . . . . . . ]     [ . . . . . . . . . . . ]     [ . . . . . . . . . . . ]
       [ . . █ █ . . . █ █ . . ]     [ . . █ █ . . . █ █ . . ]     [ . . █ █ . . . . █ █ . ]     [ . . █ █ . . . █ █ . . ]
       [ . █ ░ ░ █ . █ ░ ░ █ . ]     [ . █ ░ ░ █ . █ ░ ░ █ . ]     [ . █ ░ ░ █ . . █ ░ ░ █ ]     [ . █ ░ ░ █ . █ ░ ░ █ . ]
       [ █ █ █ █ █ █ █ █ █ █ █ ]     [ █ █ █ █ █ █ █ █ █ █ █ ]     [ █ █ █ █ █ █ █ █ █ █ █ ]     [ █ █ █ █ █ █ █ █ █ █ █ ]
       [ █ ░ ░ ░ ░ ░ ░ ░ ░ ░ █ ]     [ █ ░ ░ ░ ░ ░ ░ ░ ░ ░ █ ]     [ █ ░ ░ ░ ░ ░ ░ ░ ░ ░ █ ]     [ █ ░ ░ ░ ░ ░ ░ ░ ░ ░ █ ]
       [ █ ░ ▧ ▧ ░ ░ ░ ▧ ▧ ░ █ ]     [ █ ░ ▧ ▧ ░ ░ ░ ▧ ▧ ░ █ ]     [ █ ░ ▧ ▧ ░ ░ ░ ▧ ▧ ░ █ ]     [ █ ░ ▧ ▧ ░ ░ ░ ▧ ▧ ░ █ ]
       [ █ ░ ▧ █ ░ ░ ░ ▧ █ ░ █ ]     [ █ ░ ▧ █ ░ ░ ░ ▧ █ ░ █ ]     [ █ ░ ▧ █ ░ ░ ░ ▧ █ ░ █ ]     [ █ ░ ▧ █ ░ ░ ░ ▧ █ ░ █ ]
       [ . █ ░ ░ ░ █ ░ ░ ░ █ . ]     [ . █ ░ ░ ░ █ ░ ░ ░ █ . ]     [ . █ ░ ░ ░ █ ░ ░ ░ █ . ]     [ . █ ░ ░ ░ █ ░ ░ ░ █ . ]
       [ . . █ ░ ░ ░ ░ ░ █ . . ]     [ . . █ ░ ░ ░ ░ ░ █ . . ]     [ . . █ ░ ░ ░ ░ ░ █ . . ]     [ . . █ ░ ░ ░ ░ ░ █ . . ]
       [ . █ █ ░ ░ ░ ░ ░ █ █ . ]     [ . █ █ ░ ░ ░ ░ ░ █ █ . ]     [ . █ █ ░ ░ ░ ░ ░ █ █ . ]     [ . █ █ ░ ░ ░ ░ ░ █ █ . ]
       [ █ ░ ░ ░ ★ ░ ★ ░ ░ ░ █ ]     [ █ ░ ░ ░ ★ ░ ★ ░ ░ ░ █ ]     [ █ ░ ░ ░ ★ ░ ★ ░ ░ ░ █ ]     [ █ ░ ░ ░ ★ ░ ★ ░ ░ ░ █ ]
       [ █ ░ ░ ░ ░ ★ ░ ░ ░ ░ █ ]     [ █ ░ ░ ░ ░ ★ ░ ░ ░ ░ █ ]     [ █ ░ ░ ░ ░ ★ ░ ░ ░ ░ █ ]     [ █ ░ ░ ░ ░ ★ ░ ░ ░ ░ █ ]
       [ . █ █ ░ ░ ░ ░ ░ █ █ . ] █   [ . █ █ ░ ░ ░ ░ ░ █ █ . ] . █ [ . █ █ ░ ░ ░ ░ ░ █ █ . ] . █ [ . █ █ ░ ░ ░ ░ ░ █ █ . ] █
       [ . █ ░ █ . . . █ ░ █ . ] █   [ . █ ░ █ . . . █ ░ █ . ] █   [ . █ ░ █ . . . █ ░ █ . ] █   [ . █ ░ █ . . . █ ░ █ . ] █
       [ █ ░ ░ █ . . . █ ░ ░ █ █     [ █ ░ ░ █ . . . █ ░ ░ █ █     [ █ ░ ░ █ . . . █ ░ ░ █ █     [ █ ░ ░ █ . . . █ ░ ░ █ █
       [ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ]     [ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ]     [ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ]     [ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ▄ ]
```

### Specific Palette Definition (6 Indexed Colors):
1. **Outline:** `#1e1338` (Deep Void Plum — provides contrast against dark GitHub surfaces `#0d1117` and light READMEs without harsh black).
2. **Base Shading:** `#3b1d70` (Twilight Velvet).
3. **Midtone Body:** `#5b2ea6` (Arcane Violet).
4. **Specular Edge:** `#8b5cf6` (Soft Starlight Lavender).
5. **Eye Jewel Glow:** `#10b981` (Terminal Emerald) with specular dot `#ecfdf5`.
6. **Inner Ear / Chest Sigil:** `#f472b6` (Rose Quartz Pulse).

---

## 3. Pet Identity, Traits & Cosmetic Customization System

### 3.1 Personality Traits (Flavor & Micro-Behaviors)
During adoption, each companion receives an inherent Personality Trait. Traits influence idle dialog, reaction animations, and favored interactions without skewing core progression math:

- **Night Owl:** Purrs enthusiastically for commits pushed between 22:00 and 04:00 UTC; sleepy animation during daytime hours.
- **Clean Architect:** High happiness boost on pull request merge feeds; reacts with a satisfied nod to refactoring commits.
- **Bug Hunter:** Alert ear-perk animation on git issue closure events; training reaction displays particle bug-squash effects.
- **Relentless:** Energy recovers 10% faster while resting; energetic idle bounce.

### 3.2 Cosmetic Accessories Architecture
Cosmetic layers are rendered dynamically as independent layered sprite overlays (`z-index: 10` on top of base sprite `z-index: 5`):

```text
                  COSMETIC LAYERING TOPOLOGY
  ┌────────────────────────────────────────────────────────┐
  │ [Layer 3] Headwear (Beanie, Cyber Visor, Halo, Crown)  │
  ├────────────────────────────────────────────────────────┤
  │ [Layer 2] Neck / Chest (Bandana, Bowtie, Coffee Cup)   │
  ├────────────────────────────────────────────────────────┤
  │ [Layer 1] Base Character Sprite (Shadow Claw / Drake)  │
  ├────────────────────────────────────────────────────────┤
  │ [Layer 0] Ground Platform / Habitat Shadow             │
  └────────────────────────────────────────────────────────┘
```

- **Separation of Power & Appearance:** Accessories provide zero stat buffs (no "+5% XP" pay-to-win or grind incentives).
- **Unlock Conditions:** Tied to organic developer milestones (e.g., "Night Beanie" unlocked on 10 midnight commits; "Gold Crown" unlocked at Level 20 Celestial Form).
- **Live Preview Buffer:** In-app customizer allows equipping, previewing in both dark and light GitHub README contexts, and saving with a single client-side or server confirmation.

---

## 4. Gameplay Economy & Progression Specification

### 4.1 Exhaustive Audit of Progression Constants & Formulas

```text
                                PROGRESSION LOOP
  GitHub Activity  ────┐
  (Commits / PRs)      ▼
                   [ XP POOL ] ───> Level Up (Lvl * 100) ───> Stage Evolution
  Direct Care      ────┘                                       (Lvl 1, 5, 10, 20)
  (Pet, Train, Feed)   │
                       ├───> Vitals Clamping (0-100)
                       └───> 60s Rolling Diminishing Multipliers (1.0 -> 0.10)
```

1. **Experience Curve Formula:**
   $$\text{MaxXP}(L) = L \times 100$$
   - Level 1: 100 XP required.
   - Level 5 (Stage 2 Juvenile): Cumulative 1,000 XP.
   - Level 10 (Stage 3 Ascended): Cumulative 4,500 XP.
   - Level 20 (Stage 4 Celestial): Cumulative 19,000 XP.
   - *Overflow Handling:* Guaranteed zero-loss carryover mathematically verified in test suite.
2. **Action Rewards & Diminishing Returns:**
   - Rolling Window: **60 seconds**.
   - Schedule: $1.0 \to 0.60 \to 0.35 \to 0.20 \to 0.10$ for consecutive uses within 60s.
   - Base Action Table:
     - **Pet:** $+6\text{ XP}$, $+12\text{ Happiness}$, $0\text{ Energy Cost}$. (Diminishing yields).
     - **Train:** $+30\text{ XP}$, $+4\text{ Happiness}$, $-18\text{ Energy Cost}$. (*Fixed 18 cost, diminishing XP/Happiness*).
     - **Feed Commit:** $+10\text{ XP}$, $+24\text{ Satiety}$, $+5\text{ Happiness}$, $0\text{ Energy Cost}$.
     - **Rest:** $+25\text{ Energy}$ (instant action) or $+2\text{ Energy/sec}$ (passive resting). Strictly $0\text{ XP}$.

### 4.2 Exploitation Analysis & Anti-Abuse Guards

| Exploit Vector | Risk Level | Mitigation Guard Implemented & Specified |
| :--- | :--- | :--- |
| **Rapid Double-Clicking / Autoclickers** | High | 800ms debounce cooldown (`ACTION_COOLDOWN_MS = 800`). Subsequent clicks within window rejected with countdown timer. |
| **Infinite Training XP Farming** | Critical | Strict Energy Check: Action rejected if $\text{Energy} < 18$. Energy cost is never diminished by multipliers. |
| **Overfeeding Spam** | Medium | Satiety Gate: Action rejected when $\text{Satiety} \ge 100$ ("Pet is full"). |
| **Macro Scripting All Actions in Parallel** | High | Independent 60s rolling windows ensure diminishing returns hit 10% rate within 5 actions. |
| **Inactivity Punishment / Pet Death** | High (UX) | **Zero Pet Death Policy:** Pets never die, starve, or lose levels due to user vacation. Inactivity merely settles mood to `Resting` and freezes energy until the developer returns. |

### 4.3 Realistic Progression Scenario: Adoption to Juvenile (Stage 2)
- **Day 1 (Adoption):** Developer connects GitHub. Starts Level 1 (0/100 XP).
  - Performs initial onboarding care: 2 pets ($+10\text{ XP}$), 1 feed ($+10\text{ XP}$), 2 trainings ($+48\text{ XP}$, $-36\text{ Energy}$).
  - Pushes 3 GitHub commits ($3 \times 25\text{ XP} = +75\text{ XP}$).
  - *Result:* Reaches Level 2 (43/200 XP).
- **Day 2–4:** Routine GitHub workflow (4 commits/day = $+100\text{ XP/day}$) plus casual care.
  - Cumulative XP reaches 1,000 XP.
  - **Milestone Unlocked:** Level 5 reached! Companion automatically evolves into **Juvenile Form**, unlocking glowing aura, enlarged wings/ears, and the "Juvenile Ascendant" badge.

---

## 5. First-Time User Onboarding Journey

```text
  [ Step 1: Discover ] ───> [ Step 2: Auth ] ───> [ Step 3: Hatch ] ───> [ Step 4: Name ]
   Public Landing Page      GitHub OAuth (read)    Select 1 of 4 Roster   Custom Identity
                                                                                 │
  [ Step 7: Embed ]   <─── [ Step 6: Dashboard ] <─── [ Step 5: Briefing ] <─────┘
   Copy README SVG          Full Control Center     3-Slide Care Intro
```

1. **Step 1: Discover (Public Landing View):**
   - Clean, modern introduction explaining the value proposition: *Your GitHub coding habits nurture a live pixel companion on your profile.*
   - Visual demo of the embed operating live on a mock GitHub profile README.
2. **Step 2: Authenticate (GitHub OAuth):**
   - Click "Connect with GitHub".
   - Minimal permissions dialog: `read:user` (public profile and public activity stream only). No private repo write access requested.
3. **Step 3: Companion Selection (Hatchery):**
   - 4-card interactive bestiary (Shadow Claw, Ignis Ember, Kitsune Sol, Bloop Matrix).
   - Real-time idle animation preview and developer archetype alignment.
4. **Step 4: Naming & Trait Assignment:**
   - Input custom companion name (2-20 characters, sanitized, profanity filtered).
   - Select initial personality trait.
5. **Step 5: Companion Care Briefing:**
   - 3-card non-blocking carousel explaining vitals: Commits feed XP; Resting restores Energy; Petting maintains Happiness.
6. **Step 6: Dashboard Arrival:**
   - Arrives at the main application canvas with adopted pet active and initial Level 1 telemetry.
7. **Step 7: Profile Publication:**
   - Dedicated prompt in Settings view to copy the 1-line Markdown embed snippet for their profile `README.md`.

---

## 6. Public Profile & README Showcase Architecture

### 6.1 Dedicated Public URL Structure
Every adopted pet receives an immutable, publicly accessible profile page:
`https://githubprofilepet.io/u/:username`

Visitors viewing this URL can inspect the companion without requiring a login or GitHub authorization:
- Live high-resolution rendering of the pet with equipped cosmetics.
- Pet bio, current level, evolution form, and date of adoption.
- Public achievement badges (e.g., "14-Day Streak", "Midnight Pusher").
- Cumulative GitHub contributions nurtured.
- Privacy toggle in user settings: `Public`, `Unlisted`, or `Minimal (Stats Hidden)`.

### 6.2 Three Standalone SVG README Layout Formats
To fit various README designs, the server SVG renderer will support three distinct layout modes via URL query parameters:

```text
1. COMPACT BADGE (?layout=compact) [320x80 px]
   ┌────────────────────────────────────────────────────┐
   │ [Sprite]  SHADOW CLAW (LVL 5)   14-Day Streak 🔥   │
   │           Void Familiar         840 Commits        │
   └────────────────────────────────────────────────────┘

2. SHOWCASE CARD (?layout=showcase - Default) [480x160 px]
   ┌────────────────────────────────────────────────────┐
   │ ┌─────────┐  NOCTURNE (LVL 5)            STAGE 2   │
   │ │  Sprite │  Void Familiar • Juvenile Form         │
   │ │  32x32  │  [■■■■■■■■■■■■■■■■░░░░] 340/500 XP    │
   │ └─────────┘  Happiness: 90%  |  Streak: 14 Days   │
   └────────────────────────────────────────────────────┘

3. JOURNEY TIMELINE (?layout=journey) [640x200 px]
   ┌────────────────────────────────────────────────────┐
   │ [Pet Arena] ───> [Evolution Milestones Track]      │
   │ Hatchling (✓) ──> Juvenile (✓) ──> Ascended (L10)   │
   └────────────────────────────────────────────────────┘
```

---

## 7. Backend-Ready Domain Model & System Boundaries

### 7.1 Entity-Relationship Specification (PostgreSQL / Prisma Schema Draft)

```text
  ┌────────────────┐       1:1       ┌────────────────┐       1:N       ┌─────────────────────┐
  │  UserAccount   ├─────────────────┤    PetState    ├─────────────────┤ PetActionHistory    │
  │  id (UUID)     │                 │  id (UUID)     │                 │  id (UUID)          │
  │  githubId      │                 │  userId (FK)   │                 │  action (enum)      │
  │  username      │                 │  species (enum)│                 │  timestamp (UTC)    │
  │  encryptedToken│                 │  name          │                 │  rewardExp          │
  └───────┬────────┘                 │  level         │                 └─────────────────────┘
          │                          │  xp, maxExp    │
          │ 1:1                      │  energy        │       1:N       ┌─────────────────────┐
          ▼                          │  hunger        ├─────────────────┤ UserCosmetics       │
  ┌────────────────┐                 │  happiness     │                 │  id (UUID)          │
  │ ProfileSettings│                 │  mood          │                 │  accessoryId        │
  │  isPublic      │                 └────────────────┘                 │  isEquipped (bool)  │
  │  readmeTheme   │                                                    └─────────────────────┘
  │  syncCadence   │
  └────────────────┘
```

### 7.2 Strict Server-Authoritative Boundaries
To prevent client-side inspection or tampering:
1. **Server-Authoritative Calculations:**
   - XP awards, level thresholds, and energy deductions must be computed and signed on the server. The client dashboard sends action intents (e.g., `POST /api/pet/action { type: "train" }`); the backend evaluates cooldowns, verifies energy $\ge 18$, mutates state, and returns the verified new state.
2. **GitHub Webhook & Cron Ingestion Idempotency:**
   - Ingestion jobs process GitHub push events via commit SHA hashing:
     $$\text{EventKey} = \text{hash}(\text{githubUserId} + \text{commitSha} + \text{timestamp})$$
   - Duplicate pushes or overlapping polling jobs are discarded via unique database constraint on `EventKey`, guaranteeing zero double-counted XP.
3. **Account Deletion & Data Subject Rights (GDPR/CCPA):**
   - Single-click "Delete Account" permanently purges encrypted OAuth tokens, pet records, and cached SVG entries from database and edge caches within 60 seconds.

---

## 8. Prioritized Stage 2 Implementation Plan

1. **Sprint 2.1 — Persistent Storage & Core Engine Migration:**
   - Provision PostgreSQL database and Prisma ORM schemas matching the domain model.
   - Extract `gameplay.ts`, `rewards.ts`, and `progression.ts` into shared server-authoritative service modules.
2. **Sprint 2.2 — GitHub OAuth 2.0 & Session Gateway:**
   - Implement NextAuth.js or IronSession with GitHub OAuth provider (`read:user` scope).
   - AES-256-GCM token encryption at rest.
3. **Sprint 2.3 — Server-Side SVG README Endpoint:**
   - Deploy `/api/pet/[username]/svg` dynamic route with Camo ETag cache invalidation and layout options (`compact`, `showcase`).
4. **Sprint 2.4 — Live GitHub GraphQL Activity Synchronizer:**
   - Implement scheduled edge cron jobs syncing user contribution totals and awarding daily activity XP.
5. **Sprint 2.5 — Aseprite Character Asset Integration:**
   - Replace prototype inline SVG with the multi-frame 32×32 pixel sprite sheets authored in Section 2.

---

## 9. Identified Risks & Open Design Decisions

| Risk / Decision Item | Severity | Recommended Approach |
| :--- | :--- | :--- |
| **GitHub Camo Image Cache Latency** | Medium | GitHub Camo can take 2–5 minutes to revalidate even with updated ETags. Maintain clear client messaging that README updates may trail dashboard actions by a few minutes. |
| **Private Repository Contributions** | Low-Medium | Developers whose activity occurs in private repos must be able to opt-in to `repo` scope or toggle "Include private contributions" via GitHub settings without exposing repo names or source code. |
| **Sprite Art Production Bottleneck** | Medium | Authoring 4 species across 7 animation states = 28 distinct sprite sheets. Produce and ship Shadow Claw first as the flagship companion, rolling out the remaining three progressively in Stage 2. |
