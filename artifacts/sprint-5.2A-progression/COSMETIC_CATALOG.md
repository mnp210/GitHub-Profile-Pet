# Sprint 5.2A — Cosmetic Catalog Specification

## 1. Overview

The cosmetic catalog provides 16 bespoke, collectible customization items across four distinct aesthetic slots: **Accessories**, **Effects**, **Environments**, and **Companion Decorations**.

Rarity tiers (**Common**, **Uncommon**, **Rare**, **Epic**, **Legendary**) serve purely as aesthetic and accomplishment classifications. There are no paid items, loot boxes, or random chance mechanics.

---

## 2. Item Catalog

### 2.1 Accessories (5 Items)
| ID | Name | Rarity | Category | Unlock Requirement |
| :--- | :--- | :--- | :--- | :--- |
| `mini_crown` | **Mini Crown** | Rare | Accessory | Complete your first companion interaction (Tap or Stroke). |
| `dev_glasses` | **Developer Glasses** | Uncommon | Accessory | Explore at least 3 distinct personality archetypes. |
| `star_charm` | **Star Charm** | Common | Accessory | Complete your first mini-game session. |
| `explorer_scarf`| **Explorer Scarf** | Rare | Accessory | Play and complete all 3 distinct mini-game activities. |
| `guardian_emblem`| **Guardian Shoulder Emblem** | Epic | Accessory | Bond with a Determined or Calm companion and achieve mastery. |

### 2.2 Visual Effects (4 Items)
| ID | Name | Rarity | Category | Unlock Requirement |
| :--- | :--- | :--- | :--- | :--- |
| `emerald_sparkle` | **Emerald Sparkle** | Uncommon | Effect | Equip your very first cosmetic accessory or visual effect. |
| `solar_particles` | **Solar Particles** | Rare | Effect | Score 250+ points in Companion Rhythm. |
| `crimson_aura` | **Crimson Aura** | Epic | Effect | Collect at least 7 cosmetic items in your wardrobe. |
| `calm_glow` | **Calm Floating Glow** | Rare | Effect | Reach 15 total care or mini-game activities in steady flow. |

### 2.3 Habitat Environments (4 Items)
| ID | Name | Rarity | Category | Unlock Requirement |
| :--- | :--- | :--- | :--- | :--- |
| `void_chamber` | **Void Chamber** | Common | Environment | Default companion habitat (Available on first launch). |
| `starlight_platform` | **Starlight Platform** | Rare | Environment | Score 300+ points in Star Catcher. |
| `forest_sanctuary` | **Forest Sanctuary** | Uncommon | Environment | Visit and interact with your companion on at least 2 distinct calendar days. |
| `neon_workshop` | **Neon Workshop** | Epic | Environment | Reach Round 4 or higher in Memory Sparks. |

### 2.4 Companion Decorations (3 Items)
| ID | Name | Rarity | Category | Unlock Requirement |
| :--- | :--- | :--- | :--- | :--- |
| `companion_badge` | **Small Companion Badge** | Common | Decoration | Complete your first care action (Feed, Play, Train, or Rest). |
| `floating_emblem` | **Floating Emblem** | Rare | Decoration | Collect at least 3 cosmetic items in your wardrobe. |
| `decorative_frame`| **Decorative Frame** | Epic | Decoration | Simultaneously equip an accessory, effect, environment, and decoration. |

---

## 3. Rarity Palette & Visual Tokens

| Rarity Tier | Text Color Class | Background Color Class | Border Color Class |
| :--- | :--- | :--- | :--- |
| **Common** | `text-slate-300` | `bg-slate-900/60` | `border-slate-700` |
| **Uncommon** | `text-emerald-300` | `bg-emerald-950/60` | `border-emerald-600` |
| **Rare** | `text-cyan-300` | `bg-cyan-950/60` | `border-cyan-600` |
| **Epic** | `text-purple-300` | `bg-purple-950/60` | `border-purple-600` |
| **Legendary** | `text-amber-300` | `bg-amber-950/60` | `border-amber-500` |
