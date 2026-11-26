# Sprint 5.2A — Progression System & Architecture Design

## 1. Overview and Core Philosophy

In Sprint 5.1A and 5.1B, GitHub Profile Pet evolved into an expressive living companion with rich mini-games. Sprint 5.2A introduces **meaningful long-term progression** through an extensible companion collection, unlockable cosmetics, and milestone achievements.

The progression architecture is built upon five foundational design principles:
1. **Decoupled Progression Subsystem:** Achievements, cosmetic inventory, equipped cosmetic layers, and gameplay statistics are cleanly separated from the authoritative GitHub contribution XP engine and pet vital decay mechanics.
2. **Deterministic, Idempotent Evaluation:** Unlocking an achievement or cosmetic is purely functional and deterministic. Duplicate triggers, repeated replays, or stale events produce zero duplicate unlocks, timestamps, or inventory items.
3. **Zero-XP, Aesthetic-Only Economy Invariant:** Progression rewards are strictly cosmetic and collector-focused. Earning achievements or equipping accessories grants **0 XP**, creates **0 currency**, alters no contribution ledgers, and does not alter action cooldowns or daily caps.
4. **Composable Layered Rendering:** Cosmetics are rendered as modular pixel-art SVG layers overlaid on the $24 \times 24$ coordinate space without duplicating or forking companion sprite implementations.
5. **Universal Companion Compatibility:** All accessories, effects, environments, and decorations adapt fluidly across all 4 species (Shadow Claw, Ignis Ember, Kitsune Sol, Bloop Matrix) and all 4 personality archetypes (Curious, Determined, Playful, Calm).

---

## 2. Subsystem Domain Architecture

```
src/
├── features/
│   └── progression/
│       ├── types.ts                    # Interfaces for achievements, cosmetics, stats & state
│       ├── cosmeticsCatalog.ts         # Full metadata catalog for all 16 cosmetic items
│       ├── achievementsCatalog.ts      # Definitions, progress formulas & reward mappings for 15 badges
│       ├── engine.ts                   # Core progression engine (evaluation, equip, unequip, reset)
│       ├── persistence.ts              # LocalStorage loading, saving & backward-compatible migration
│       └── index.ts                    # Public barrel export
└── components/
    ├── cosmetics/
    │   ├── CosmeticAccessoryOverlay.tsx # Pixel-art SVG accessory renderer
    │   ├── CosmeticEffectLayer.tsx     # Animated particle & aura emitter
    │   ├── EnvironmentBackground.tsx   # Arena environment backdrops & grids
    │   ├── CompanionDecorationOverlay.tsx # Emblems, badges & gilded frame borders
    │   └── WardrobeView.tsx            # Interactive collection browser & live companion preview
    └── progression/
        ├── AchievementsGalleryView.tsx # Achievements gallery with category filters & progress bars
        ├── ProgressionHubModal.tsx     # Master modal dialog for Wardrobe & Achievements
        └── UnlockToast.tsx             # Non-intrusive celebration notification toast
```

---

## 3. Progression State Model

```typescript
export interface ProgressionState {
  schemaVersion: number; // Current version: 1
  inventory: CosmeticId[]; // List of owned cosmetic item IDs
  equipped: EquippedCosmetics; // Currently equipped cosmetics per slot
  achievements: Record<string, { unlockedAt: number | null }>; // Milestone completion records
  stats: ProgressionStats; // Validated gameplay statistics
}

export interface EquippedCosmetics {
  accessory: CosmeticId | null; // Hat, glasses, scarf, or emblem
  effect: CosmeticId | null;    // Particle aura or glowing halo
  environment: CosmeticId | null; // Arena habitat backdrop
  decoration: CosmeticId | null; // Pedestal medal or frame
}
```

---

## 4. Evaluation Lifecycle & Safety

Whenever a qualifying event occurs (direct companion tap, care action, personality switch, or mini-game completion), the engine runs:

```
[ Gameplay Event ] ──► [ Progression Engine Record ]
                                │
                                ▼
                    [ evaluateAchievements() ]
                                │
          ┌─────────────────────┴─────────────────────┐
          ▼                                           ▼
[ Check Condition & Progress ]               [ Idempotence Guard ]
          │                                           │
          ├─► If completed & not in achievements:     └─► If already unlocked:
          │     1. Set unlockedAt = Date.now()              Keep existing timestamp.
          │     2. Add reward to inventory (Set)            No duplicate reward.
          │     3. Push to newlyUnlocked list               No duplicate toast.
          │
          ▼
[ Save State & Display Toast ]
```
