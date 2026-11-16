# GitHub Profile Pet — Character Art Specification & Visual Asset Roadmap

**Document Version:** 1.0.0  
**Domain:** Art Direction, Sprite Pipeline & Visual Architecture  
**Scope:** Species Aesthetics, Animation States, Pixel Grid Standardization

---

## 1. Character Art Philosophy & Visual Identity

GitHub Profile Pet companions are not generic clipart or placeholder icons. Each companion embodies an authentic developer lifestyle archetype, rendered in strict retro pixel-art discipline.

### Core Pixel Art Constraints:
1. **Integer Canvas Resolution:** 24 × 24 base logical pixel grid (scaled up with CSS `shape-rendering: crispEdges` or `image-rendering: pixelated`).
2. **Fixed Proportions:** Character bounding box strictly 20 × 20 pixels within the 24 × 24 grid, with 2px padding for bounce and animation leeway.
3. **Restrained Color Palettes:** Maximum 5–6 colors per species (1 dark outline tone, 2 core body shades, 1 eye/highlight glow, 1-2 elemental accent tones).
4. **No Sub-pixel Rendering:** Every pixel edge aligns flush to the integer grid. No anti-aliasing blurring or soft dropshadows on the sprite itself.
5. **Recognizable Silhouettes:** Each creature has an unmistakable head, ear, tail, or wing profile that remains clear even at 48 × 48 scaled down.

---

## 2. Species Audit & Aesthetic Deep Dive

### A. Shadow Claw — Void Familiar (Cat)
- **Developer Archetype:** The nocturnal late-night debugging specialist.
- **Silhouette & Recognizability:** High. Pointed triangular void ears with bright pink inner ear accents, elongated sleek feline body, and curled mystical tail.
- **Color Palette:**
  - Dark Outline / Shadow: `#2e1065` (Deep Void Indigo)
  - Primary Coat: `#5b21b6` / `#4c1d95` (Arcane Violet)
  - Eye Glow: `#10b981` (Terminal Emerald) with `#ecfdf5` specular gleam
  - Arcane Chest Rune: `#c084fc` (Lavender Starlight)
- **Distinguishing Trait:** Emerald feline pupil shine and subtle void whisker flares.

### B. Ignis Ember — Drake Pyre (Dragon)
- **Developer Archetype:** The continuous integration powerhouse; high commit frequency and blazing momentum.
- **Silhouette & Recognizability:** High. Horned draconic crest, distinct pixelated wing spans, and spiked fire tail.
- **Color Palette:**
  - Dark Outline: `#7f1d1d` (Bloodstone Crimson)
  - Scale Layers: `#b91c1c` / `#dc2626` (Ruby Core)
  - Underbelly: `#fbbf24` (Golden Ember)
  - Eye Flame: `#f59e0b` / `#fef08a` (Blazing Amber)
- **Distinguishing Trait:** Fiery horned ridges and golden scale plating.

### C. Kitsune Sol — Nine-Tail Scout (Fox)
- **Developer Archetype:** The agile architect; clean abstractions, clever algorithms, and sunny code reviews.
- **Silhouette & Recognizability:** Very High. Voluminous bushy fox tail, distinct cream cheek tufts, and alert fox ears.
- **Color Palette:**
  - Dark Outline: `#7c2d12` (Earthy Umber)
  - Fox Fur: `#ea580c` / `#f97316` (Radiant Ochre)
  - Muzzle & Chest: `#ffedd5` (Warm Cream)
  - Eye & Solar Charm: `#06b6d4` (Electric Cyan)
- **Distinguishing Trait:** Sweeping fluffy tail and cream muzzle mask.

### D. Bloop Matrix — Gelatinous Core (Slime)
- **Developer Archetype:** The resilient systems architect; absorbs bug fixes, refactors fluidly, and never crashes.
- **Silhouette & Recognizability:** High. Fluid tear-drop dome, floating internal matrix core, and gelatinous squash-and-stretch.
- **Color Palette:**
  - Gel Perimeter: `#064e3b` (Deep Matrix Moss)
  - Translucent Body: `#059669` / `#10b981` (Neon Bio-Gel)
  - Internal Energy Core: `#34d399` / `#6ee7b7` (Floating Memory Crystal)
  - Big Expressive Eyes: `#022c22` with white dot highlights
- **Distinguishing Trait:** Internal glowing core node and distinct squash-stretch physics.

---

## 3. Character Animation States Matrix

To avoid unsubstantiated claims, the application strictly distinguishes between **currently active CSS keyframe animations** and the **Stage 2 frame-by-frame sprite sheet roadmap**:

| State | Current Implementation (Stage 1.2) | Full Sprite-Sheet Roadmap (Stage 2) |
| :--- | :--- | :--- |
| **Idle** | Continuous species-specific keyframe bobbing & squash/stretch (2.2s–3.2s) | 4-frame looping breathing idle animation |
| **Happy / Pet** | Bouncing floating heart/joy chips + dynamic smiling mood badge | 3-frame tail-wag / eye-closed purr |
| **Tired / Low Energy** | 80% opacity, Amber "Tired!" badge, and mood state shifting to "RESTING" | Heavy droopy eyes, resting on belly |
| **Sleeping / Rest** | "RESTING Zzz..." floating chips, dim ambient aura, and resting pedestal | Curled sleeping ball with pixel Zzz particles |
| **Feeding** | Cyan satiety particles, chew visual confirmation, and satiety progression bar | Chomping mouth animation with commit snack pellet |
| **Training** | Amber lightning spark particles, -18⚡ deduction, and training reactions | Action dash, claw swipe, or flame puff animation |
| **Level-Up** | Celebratory gold announcement banner with species ascension lore | Golden star burst explosion & momentary aura flare |

---

## 4. Evolution-Stage Visual Specification

Each companion features 4 progressive tiers that unlock as the developer levels up:

1. **Stage 1: Hatchling (Level 1–4)**
   - Sprite Scale: Standard 20 × 20 pixel footprint.
   - Accents: Clean, minimal base anatomy; soft ambient elemental glow.
2. **Stage 2: Juvenile Form (Level 5–9)**
   - Sprite Scale: Adds secondary accent marks (horns lengthen, tail fluffs out, chest crest illuminates).
   - Accents: Secondary glowing pixel aura rings.
3. **Stage 3: Ascended Form (Level 10–19)**
   - Sprite Scale: Expanded wing spans, twin tail outlines, or dual internal matrix cores.
   - Accents: Resonant elemental audio bites and aura flares.
4. **Stage 4: Celestial Form (Level 20+)**
   - Sprite Scale: Full mythological form with crown or floating elemental orbits.
   - Accents: Maximum aura mastery and shimmering particle crown.

---

## 5. Asset Pipeline Recommendation: SVG vs. PNG Sprite-Sheets

### Audit Finding
- **Current Approach:** Mathematically constructed, inline SVG pixel grids with `shape-rendering: crispEdges`.
- **Strengths:** 100% vector scalability, 0KB network payload, crisp rendering at all DPRs (Retina, 4K), direct SVG rendering in GitHub READMEs without canvas conversion, and instantaneous recoloring via CSS variables.
- **Limitations:** Multi-frame complex animations (e.g., 8-frame walk cycles or articulated claw swipes) require excessive SVG markup and maintenance compared to standard PNG sprite sheets.

### Production Recommendation (Stage 2)
1. **Preserve Inline SVG for GitHub READMEs:** Because GitHub README embeds cannot easily cycle external PNG sheets without animated GIF bandwidth penalties, pure animated SVG remains the premier standard for the public embed.
2. **Adopt Aseprite Sprite Sheets for In-App Arena:** For future rich combat, walking, and grooming interactions in the web app, author 32 × 32 pixel sheets exported from Aseprite as dual PNG/WebP sprite sheets with CSS `steps(N)` animations.
