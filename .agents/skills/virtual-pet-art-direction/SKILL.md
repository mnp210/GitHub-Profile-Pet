---
name: virtual-pet-art-direction
description: >-
  Enforces character art direction, sprite pipeline standards, and animation
  rules for GitHub Profile Pet companions. Use when reviewing, modifying,
  or authoring character sprites, sprite-sheets, animation frames, palettes,
  accessories, or evolution forms for Shadow Claw, Ignis Ember, Kitsune Sol, or Bloop Matrix.
---

# Virtual Pet Art Direction & Asset Pipeline Skill

This skill governs the visual quality, character design, and sprite production standards for all four companion species in **GitHub Profile Pet**.

---

## The Four Core Species & Silhouettes

Every companion must possess an unmistakable silhouette recognizable even at 32×32 pixels:

1. **Shadow Claw (Void Familiar — Cat):**
   - *Developer Archetype:* Nocturnal terminal debugging specialist.
   - *Key Silhouettes:* Pointed triangular void ears with inner pink accents, sleek crouching feline torso, emerald pixel eyes with specular glints, and curled mystical tail.
   - *Indexed Palette (6 Tones):* Outline `#1e1338`, Base `#3b1d70`, Midtone `#5b2ea6`, Highlight `#8b5cf6`, Eye Jewel `#10b981`, Sigil `#f472b6`.

2. **Ignis Ember (Ruby Drake — Dragon):**
   - *Developer Archetype:* Continuous integration powerhouse; high commit frequency.
   - *Key Silhouettes:* Horned crest, wide draconic wings, spiked tail, and golden ember underbelly.
   - *Indexed Palette (6 Tones):* Outline `#450a0a`, Base `#991b1b`, Midtone `#dc2626`, Highlight `#f87171`, Underbelly `#fbbf24`, Flame Glow `#f59e0b`.

3. **Kitsune Sol (Nine-Tail Scout — Fox):**
   - *Developer Archetype:* Agile architecture, clean code reviews, and sunny collaboration.
   - *Key Silhouettes:* Large sweeping bushy tail, cream muzzle mask, alert ears, and electric cyan eyes.
   - *Indexed Palette (6 Tones):* Outline `#431407`, Base `#c2410c`, Midtone `#ea580c`, Highlight `#fb923c`, Muzzle/Chest `#ffedd5`, Eye Jewel `#06b6d4`.

4. **Bloop Matrix (Cyber Jelly — Slime):**
   - *Developer Archetype:* Resilient systems architect; absorbs bug fixes fluidly without crashing.
   - *Key Silhouettes:* Fluid dome teardrop, floating internal memory core crystal, and organic squash-and-stretch physics.
   - *Indexed Palette (6 Tones):* Outline `#022c22`, Base `#047857`, Midtone `#10b981`, Highlight `#6ee7b7`, Core Crystal `#38bdf8`, Specular `#f0fdf4`.

---

## Standard 32×32 Matrix Frame Pipeline

- **Grid:** 32 × 32 logical pixels. Character boundary max 26 × 26 pixels centered, reserving a 3px padding envelope for animation motion.
- **Rendering:** Enforce `image-rendering: pixelated; shape-rendering: crispEdges;`. No sub-pixel smoothing.
- **Palette Constraint:** Strictly maximum 6 indexed colors per species.

### Required Frame Conventions

| State | Frame Count | Loop Timing | Frame Action |
| :--- | :--- | :--- | :--- |
| `idle` | 4 frames | 800ms ping-pong | Natural chest expansion, ear twitch on frame 3, tail sway. |
| `happy` | 4 frames | 600ms repeat | Closed smiling crescent eyes (`^ ^`), buoyant body bounce. |
| `curious` | 3 frames | 600ms one-shot | 4-degree head-tilt, dilated pupils. |
| `tired` | 2 frames | 1200ms ping-pong | Droopy eyelids, slumping posture. |
| `sleeping` | 4 frames | 1600ms loop | Curled resting ball with 3-frame pixel `Zzz` layer. |
| `eating` | 6 frames | 750ms one-shot | Wide chomp on floating commit token, cheek bulge. |
| `training` | 6 frames | 600ms one-shot | Forward dash/swipe/flame puff, quick recover. |
| `evolve` | 8 frames | 1200ms one-shot | Light burst engulfs silhouette, crest emergence pop. |

---

## Evolution-Stage Visual Changes

1. **Stage 1: Hatchling (Lvl 1–4):** Minimal base anatomy, soft ambient element tone.
2. **Stage 2: Juvenile Form (Lvl 5–9):** Accent marks expand (horns lengthen, tail fluffs out, chest crest illuminates).
3. **Stage 3: Ascended Form (Lvl 10–19):** Secondary wing pair, twin tail tips, or dual core matrix crystals.
4. **Stage 4: Celestial Form (Lvl 20+):** Mythological form with floating orbital particles and celestial crown.

---

## Cosmetic Layer Architecture

- Layer 0: Ground Platform / Habitat Shadow
- Layer 1: Base Character Sprite (Shadow Claw, Drake, etc.)
- Layer 2: Neck / Chest Wear (Bandana, Bowtie, Coffee Cup)
- Layer 3: Headwear (Beanie, Cyber Visor, Halo, Crown)

Cosmetics are strictly visual. They provide zero numerical gameplay buffs.

## References
- Specification Document: `docs/architecture/character-art-specification.md`
- Stage 1.3 Master Spec: `docs/architecture/stage-1-3-character-quality-and-gameplay-specification.md`
