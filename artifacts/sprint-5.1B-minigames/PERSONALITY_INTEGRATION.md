# Sprint 5.1B — Companion Personality Integration

## 1. Living Companion Connection

Rather than presenting isolated, arcade-style games, the mini-games subsystem deeply integrates the 4 companion archetypes established in Sprint 5.1A:
1. **Curious Investigator** (Analytical, observational, intrigued by patterns).
2. **Determined Guardian** (Disciplined, focused, honors training and mastery).
3. **Playful Collaborator** (Joyful, energetic, celebrates every moment).
4. **Calm Zen Master** (Serene, mindful, views games as flowing balance).

---

## 2. Event-Driven Dialogue & Expression Matrix

All dialogue and behavioral transitions are managed centrally through `src/features/minigames/personalityReactions.ts`.

### Trigger Events:
- `start`: Game initiated from Hub.
- `catch_star` / `spark_correct` / `rhythm_hit`: Successful action or hit.
- `miss_star` / `spark_wrong` / `rhythm_miss`: Mistake or missed object.
- `game_complete`: Round finished (split into high-score vs standard completion).

### Archetype Expressions & Quotes

| Event | Curious Investigator | Determined Guardian | Playful Collaborator | Calm Zen Master |
| :--- | :--- | :--- | :--- | :--- |
| **Start** | *"Analyzing game vectors. Let us observe the pattern!"* | *"Focus and discipline. We will conquer this drill!"* | *"Yay, playtime! Let's get the highest score ever!"* | *"Breathe in gently. Let rhythm flow without rushing."* |
| **Combo / Success** | *"Fascinating precision! Data shows optimal trajectory."* | *"Flawless execution! Maintain that defensive stance."* | *"WOOHOO! You're on fire! Look at those sparks!"* | *"Quiet harmony. Mind and motion become one."* |
| **Miss / Mistake** | *"Anomaly detected! Recalibrating coordinates..."* | *"Shake it off! A true guardian rebounds instantly."* | *"Oopsie! All good, catch the next one!"* | *"Every miss is a gentle lesson in stillness. Stay centered."* |
| **New Best / High Score** | *"Remarkable metrics! A breakthrough performance logged."* | *"Victory earned! That is the standard of a true guardian."* | *"NEW BEST SCORE!! Confetti and fireworks everywhere!"* | *"A truly radiant round. Deep equilibrium achieved."* |
| **Standard Finish** | *"Round concluded! Diagnostic logs show steady improvement."* | *"Good round completed. Continuous practice sharpens skill."* | *"That was so much fun! Can we play again right now?"* | *"A tranquil session finished. Feeling centered and refreshed."* |

---

## 3. Behavior State Transitions

Mini-game events trigger reactive companion sprite animations:
- **Combos & High Scores:** Sets `behaviourState: 'celebrating'`, displaying celebratory aura, sparkles, and victory pose.
- **Normal Success:** Sets `behaviourState: 'playing'` (Playful), `'head_tilt'` (Curious), `'training'` (Determined), or `'happy'`.
- **Misses:** Sets `behaviourState: 'terminal_pondering'` (Curious analyzing the error) or `'idle_calm'` (graceful recovery).
