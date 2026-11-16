---
name: frontend-design
description: >-
  Guides the creation of distinctive, production-grade frontend interfaces with
  intentional visual identity, strong typography, and refined aesthetic execution.
  Use when designing or refining UI layouts, component systems, and design tokens
  while avoiding generic AI dashboard templates and uninspired visual patterns.
license: MIT
---

# Frontend Design Skill

This skill provides design direction and execution guidelines for crafting distinctive, production-grade frontend interfaces.

## Purpose

Prevent generic "AI-slop" aesthetics (cliché cards, arbitrary saturated gradients, glowing borders everywhere, uninspired default layouts) by enforcing an intentional point of view, content-derived hierarchy, and high visual craft.

---

## The Four-Point Creative Direction

Before authoring code or modifying layouts, define:

1. **Thesis:** A single clear statement connecting the interface style to the core problem and user task.
2. **System:** Disciplined color tokens (canvas, surfaces, borders, text, single restrained accent), type hierarchy, and spacing density.
3. **Signature:** One memorable domain-specific element drawn from the product's actual subject matter (e.g. in GitHub Profile Pet, the pixel-art companion character).
4. **Risk:** One deliberate, disciplined departure from generic design clichés (e.g. avoiding card wrappers around every single element, choosing refined charcoal over cyberpunk neon).

---

## Key Execution Rules

- **Restraint Over Spectacle:** Use whitespace, alignment, and type scale rather than borders, badges, and glows to convey hierarchy.
- **Content-Driven Layouts:** Derive widths and columns from data relationships rather than arbitrary fixed grid frameworks.
- **Respect the Tech Stack:** Build on the existing component architecture, CSS framework (Tailwind CSS), and design tokens without introducing redundant styling libraries.
- **Purposeful Motion:** Keep animations short, functional, and delightful; always respect `prefers-reduced-motion`.
- **Accessibility by Default:** Enforce high contrast ratios, visible focus outlines, semantic HTML, and full keyboard navigability.
