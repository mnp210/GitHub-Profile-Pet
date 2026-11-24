# Sprint 5.2A — Unlock & Reward Rules

## 1. Principles of Deterministic Unlocks

1. **One-Time Rewards:** Each cosmetic reward can only ever be granted once per profile. Unlocking an achievement repeatedly or replaying a session cannot duplicate items in the inventory.
2. **Pure Functional Evaluation:** Achievement completion is evaluated by pure functions of `ProgressionStats`, `inventory`, and `equipped`.
3. **Atomicity & Recovery:** If an achievement is completed, its status and reward are committed together in `evaluateAchievements()`. If persistence is interrupted, re-evaluation on next load recovers the reward cleanly.
4. **Untrusted Client Guard:** UI buttons or client requests cannot arbitrarily inject items. Only validated gameplay records (care actions executed through rules engine, mini-game sessions finished through session engine) mutate stats that satisfy unlock requirements.

---

## 2. Event-to-Unlock Pipeline

| Gameplay Event | Validating Engine | Progression Mutation | Candidate Achievements Evaluated |
| :--- | :--- | :--- | :--- |
| **Direct Pet Click** | `executePetAction('pet')` | `recordInteraction()` | `first_interaction` ➔ 👑 **Mini Crown** |
| **Care Action (Feed/Play/Train/Rest)** | `executePetAction()` | `recordCareAction()` | `first_care_action` ➔ 🐾 **Companion Badge**<br>`zen_mastery` ➔ 💫 **Calm Glow** |
| **Personality Switched** | `handlePersonalityChange()` | `recordPersonalityExplored()` | `personality_explorer` ➔ 👓 **Developer Glasses**<br>`guardian_honor` ➔ 🛡️ **Guardian Emblem** |
| **Mini-Game Completed** | `finishGameSession()` | `recordMiniGameCompletion()` | `first_minigame_play` ➔ ⭐ **Star Charm**<br>`all_games_completed` ➔ 🧣 **Explorer Scarf**<br>`star_catcher_expert` ➔ 🌠 **Starlight Platform**<br>`sparks_round_4` ➔ ⚡ **Neon Workshop**<br>`rhythm_groover` ➔ ☀️ **Solar Particles** |
| **Cosmetic Equipped** | `equipCosmetic()` | `stats.cosmeticsEquippedCount++` | `first_cosmetic_equipped` ➔ ✨ **Emerald Sparkle**<br>`full_ensemble` ➔ 🖼️ **Decorative Frame** |
| **Inventory Growth** | `evaluateAchievements()` | `inventory.length` | `collector_novice` ➔ 🔮 **Floating Emblem**<br>`collector_adept` ➔ 🔥 **Crimson Aura** |
| **Multi-Day Visits** | Daily UTC record | `distinctSessionDates` | `two_day_streak` ➔ 🌲 **Forest Sanctuary** |
