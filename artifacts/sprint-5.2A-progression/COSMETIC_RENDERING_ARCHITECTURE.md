# Sprint 5.2A — Cosmetic Rendering Architecture

## 1. Modular Layer Composition

To avoid sprite fragmentation and duplicate art assets, cosmetic items are implemented as a **composable visual stack** overlaid around and on top of `PetSprite`:

```
┌──────────────────────────────────────────────────────────┐
│ Arena Container (`PetDisplay.tsx` / `WardrobeView.tsx`)    │
│                                                          │
│  Layer 0: `EnvironmentBackground` (Z: 0)                 │
│           Backdrop gradients, nebulae, circuit grids     │
│                                                          │
│  Layer 1: `CompanionDecorationOverlay` (Z: 10 / 30)      │
│           Floating sigils, pedestal badges, gilded frame │
│                                                          │
│  Layer 2: Centered Sprite Arena (Z: 10)                  │
│    ├── Sublayer 2a: `CosmeticEffectLayer` (Z: 10)        │
│    │                Auras, glowing halos, floating motes │
│    ├── Sublayer 2b: `PetSprite` (Z: 15)                  │
│    │                Active species pixel-art SVG         │
│    └── Sublayer 2c: `CosmeticAccessoryOverlay` (Z: 20)   │
│                     Crown, glasses, star charm, scarf    │
│                                                          │
│  Layer 3: Top Status & Floating Action UI (Z: 10 / 30)   │
└──────────────────────────────────────────────────────────┘
```

---

## 2. Species-Aware Coordinate Transformation

Because the four species silhouettes feature slight differences in viewBox and proportions (Cat $24\times24$, Dragon $28\times28$, Fox $26\times26$, Slime $24\times24$), `CosmeticAccessoryOverlay` dynamically calculates coordinate offsets ($x, y$ shifts) to guarantee accessories align naturally:

- **Mini Crown:** Centered over the skull crown ($y \approx 1$).
- **Developer Glasses:** Positioned directly over eye slits ($y \approx 8$ for Cat/Dragon/Fox, $y \approx 12$ for Slime).
- **Star Charm:** Positioned along the chest center ($y \approx 14$ for quadrupeds, $y \approx 16$ for Slime).
- **Explorer Scarf:** Wrapped around the neck envelope ($y \approx 13$–$15$) with a dangling knit tail.
- **Guardian Emblem:** Mounted on the left shoulder/forequarter.

---

## 3. Pixel-Art Rendering Directives

All SVG layers enforce:
```css
shape-rendering: crispEdges;
image-rendering: pixelated;
```
This guarantees that rendered pixels never blur, blur-smear, or introduce anti-aliasing artifacts when scaled from small previews (160px) to full desktop displays (180px–320px).
