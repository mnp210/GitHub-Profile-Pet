# Sprint 5.2A — Achievement Catalog Specification

## 1. Overview

The Achievement System provides 15 structured gameplay milestones across four distinct categories. Each achievement features a stable identifier, human-readable name and description, quantitative progress tracking, and a deterministic cosmetic unlock reward.

---

## 2. Category A: Companion Milestones

| ID | Name | Description | Progress Formula | Cosmetic Reward |
| :--- | :--- | :--- | :--- | :--- |
| `first_interaction` | **First Hello** | Stroke or tap your companion for the first time. | `stats.totalInteractions >= 1` (Max: 1) | 👑 **Mini Crown** |
| `first_care_action` | **Caring Companion** | Complete your first care action (Feed, Play, Train, or Rest). | `stats.totalCareActions >= 1` (Max: 1) | 🐾 **Small Companion Badge** |
| `personality_explorer`| **Soul Seeker** | Explore at least 3 distinct living companion personality archetypes. | `stats.personalitiesExplored.length >= 3` (Max: 3) | 👓 **Developer Glasses** |
| `first_cosmetic_equipped`| **Fashion Forward** | Equip your very first cosmetic accessory or visual effect. | `stats.cosmeticsEquippedCount >= 1` (Max: 1) | ✨ **Emerald Sparkle** |

---

## 3. Category B: Mini-Game Milestones

| ID | Name | Description | Progress Formula | Cosmetic Reward |
| :--- | :--- | :--- | :--- | :--- |
| `first_minigame_play` | **Let's Play!** | Complete your first companion mini-game session. | `stats.miniGamesPlayed >= 1` (Max: 1) | ⭐ **Star Charm** |
| `all_games_completed` | **Tri-Champion** | Play and finish all 3 mini-games: Star Catcher, Memory Sparks, and Companion Rhythm. | `['star_catcher', 'memory_sparks', 'companion_rhythm'].every(g => (stats.miniGamesCompleted[g] ?? 0) >= 1)` (Max: 3) | 🧣 **Explorer Scarf** |
| `star_catcher_expert` | **Cosmic Stargazer** | Score 300 or more points in a single round of Star Catcher. | `stats.starCatcherHighScore >= 300` (Max: 300) | 🌠 **Starlight Platform** |
| `sparks_round_4` | **Synapse Surge** | Reach Round 4 or higher in Memory Sparks. | `stats.memorySparksMaxRound >= 4` (Max: 4) | ⚡ **Neon Workshop** |
| `rhythm_groover` | **Pocket Groover** | Score 250 or more points in Companion Rhythm. | `stats.companionRhythmHighScore >= 250` (Max: 250) | ☀️ **Solar Particles** |

---

## 4. Category C: Collection Milestones

| ID | Name | Description | Progress Formula | Cosmetic Reward |
| :--- | :--- | :--- | :--- | :--- |
| `collector_novice` | **Treasure Hunter** | Unlock and own at least 3 distinct cosmetic items in your wardrobe. | `inventory.length >= 3` (Max: 3) | 🔮 **Floating Emblem** |
| `collector_adept` | **Stylist Maestro** | Unlock and own at least 7 distinct cosmetic items in your wardrobe. | `inventory.length >= 7` (Max: 7) | 🔥 **Crimson Aura** |
| `full_ensemble` | **Full Ensemble** | Simultaneously equip an accessory, effect, environment, and companion decoration. | `Boolean(equipped.accessory && equipped.effect && equipped.environment && equipped.decoration)` (Max: 4) | 🖼️ **Decorative Frame** |
| `guardian_honor` | **Vow of the Guardian** | Bond with a Determined or Calm companion and complete 8 total activities. | `hasArchetype && (totalCareActions + miniGamesPlayed >= 8)` (Max: 8) | 🛡️ **Guardian Shoulder Emblem** |

---

## 5. Category D: Consistency Milestones

| ID | Name | Description | Progress Formula | Cosmetic Reward |
| :--- | :--- | :--- | :--- | :--- |
| `two_day_streak` | **Faithful Companion** | Visit and interact with your companion on at least 2 distinct calendar days. | `stats.distinctSessionDates.length >= 2` (Max: 2) | 🌲 **Forest Sanctuary** |
| `zen_mastery` | **Harmonic Equilibrium**| Participate in 15 total care or mini-game sessions with your companion. | `stats.totalCareActions + stats.miniGamesPlayed >= 15` (Max: 15) | 💫 **Calm Floating Glow** |
