---
name: github-pet-product-design
description: >-
  Guides product design and visual architecture for GitHub Profile Pet.
  Use when designing screens, components, user flows, layout constraints,
  spacing, typography, color palettes, or README embed layouts to ensure
  a mature, polished developer platform with a delightful virtual companion.
---

# GitHub Profile Pet — Product Design Skill

This skill enforces the core product design principles and visual identity of **GitHub Profile Pet**.

## Product Positioning

> **"A polished, modern developer platform with a delightful virtual companion."**

The pet is the playful, expressive element. The surrounding application must remain mature, restrained, and professional.

---

## Core Visual System Rules

1. **Restrained Color Palette:**
   - **Canvas Background:** `#0c0e12` (Neutral deep charcoal).
   - **Card & Panel Surfaces:** `#12151b` (Primary surface), `#181c24` (Subtle surface lift/secondary), `#1f242e` (Interactive hover/active).
   - **Borders:** Thin 1px neutral borders (`#222733` default, `#2d3342` hover, `#3f475a` strong).
   - **Primary Typography:** `#f1f5f9` (Crisp off-white).
   - **Secondary Typography:** `#94a3b8` (Muted slate gray).
   - **Tertiary / Subtitle:** `#64748b` (Faint slate).
   - **Brand Accent:** `#4f46e5` (Disciplined deep indigo; used sparingly for primary actions, 0px blur glow).

2. **Prohibited Design Clichés (Never Re-introduce):**
   - ❌ Neon purple / electric indigo gradient washes as default branding.
   - ❌ Glowing box-shadows, scanline filters, or CRT raster overlays.
   - ❌ Repeated pixel-corner notches on every card.
   - ❌ Universal monospace typography across standard UI navigation and body text.
   - ❌ Pulsing status indicators used decoratively without functional meaning.
   - ❌ Emoji-heavy button labels or replacement of proper SVG icons.

3. **Typography Discipline:**
   - **Interface & Chrome:** System sans-serif (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`).
   - **Telemetry & Numbers:** Monospace (`ui-monospace, Menlo, Consolas`) strictly reserved for numbers, commit counts, ISO dates, and Markdown code blocks.

---

## Layout & Constraint Rules

- **Maximum Content Width:** Firmly constrained to `max-w-[1140px] mx-auto` on desktop.
- **Sidebar Width:** Compact `w-60` (240px) docked sidebar on desktop (`lg:` breakpoint); collapses cleanly to an off-canvas drawer on `< 1024px`.
- **Zero Horizontal Overflow:** All views must maintain exactly 0px horizontal page overflow across 1920px, 1440px, 990px, 390px, and 375px.

---

## Dashboard Information Hierarchy

Organize screens in order of user priority:
1. **Application Navigation & Account Context:** Compact topbar and sidebar with clear demo/auth status.
2. **Companion Identity:** Artwork stage, species, name, and current evolution stage.
3. **Companion Action Controls:** Clear, functional buttons (`Pet`, `Train (-18⚡)`, `Feed`, `Rest (+25⚡)`) with obvious disabled states.
4. **Vitals & Progression:** Clean progress tracks for Level/XP, Happiness, Energy, and Satiety.
5. **GitHub Activity Context:** Contribution matrix and streak telemetry clearly marked as simulated in demo mode.

---

## README Embed & Public Identity Rules

- **Simulated Context:** Always present README previews in an authentic GitHub dark context (`#0d1117` with `README.md` file chrome).
- **Public Disclosures:** Clearly label demo previews: *"Demo Preview (Hosted Backend Stage 2)"*. Never claim an unbuilt endpoint is live.
- **Stand-alone Server SVG:** Embeds must render server-side as pure, responsive SVG without client-side scripts, cookies, or token exposure.

## References
- System Overview: `docs/architecture/system-overview.md`
- Visual Specification: `docs/architecture/character-art-specification.md`
- Public Architecture: `docs/architecture/public-distribution-architecture.md`
