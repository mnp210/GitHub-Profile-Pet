---
name: pet-gameplay-systems
description: >-
  Governs the gamification economy, diminishing returns, action cooldowns,
  vitals progression, evolution thresholds, anti-exploit rules, and unit test
  requirements for GitHub Profile Pet. Activate whenever reviewing or modifying
  rewards, leveling, energy/satiety/happiness vitals, resting mechanics, or anti-farming guards.
---

# Pet Gameplay Systems & Economy Skill

This skill enforces deterministic progression, balanced virtual pet economy, and anti-exploit rules for **GitHub Profile Pet**.

---

## Core Economic Formulas

1. **Level-Up Curve:**
   $$\text{MaxXP}(L) = L \times 100$$
   - Level 1: 100 XP.
   - Level 5 (Juvenile): Cumulative 1,000 XP.
   - Level 10 (Ascended): Cumulative 4,500 XP.
   - Level 20 (Celestial): Cumulative 19,000 XP.
   - **Overflow Carryover Rule:** When XP meets or exceeds $\text{MaxXP}$, the level increments, and remaining XP carries over without loss. Multi-level jumps must be evaluated iteratively.

2. **Rolling 60-Second Diminishing Returns:**
   - Window: `ROLLING_WINDOW_MS = 60_000` (actions older than 60s are pruned).
   - Multiplier Schedule: `[1.0, 0.60, 0.35, 0.20, 0.10]`.
   - **Independence:** Actions (`pet`, `train`, `feed`, `rest`) are tracked independently. Petting does not diminish training yields.
   - **Yield vs. Cost Isolation:** Multipliers apply strictly to rewards (XP, Happiness, Satiety). Costs (18⚡ energy cost for training) remain fixed.

3. **Base Action Yields & Constraints:**

| Action | Base XP | Base Happiness | Base Satiety | Energy Cost | Constraints / Gating |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pet** | +6 | +12 | 0 | 0 | Subject to diminishing yields. |
| **Train** | +30 | +4 | 0 | 18⚡ (Fixed) | Blocked if $\text{Energy} < 18$. Subject to diminishing yields. |
| **Feed** | +10 | +5 | +24 | 0 | Blocked if $\text{Satiety} \ge 100$. Subject to diminishing yields. |
| **Rest** | 0 (Strict) | +2 | 0 | +25⚡ (Boost) | Grants strictly 0 XP. Restores +25 energy (or +2/sec passive). |

4. **Vitals Clamping & Mood Derivation:**
   - All vitals (Energy, Satiety, Happiness) are strictly clamped to $[0, 100]$.
   - Mood derivation rules:
     - `Energy <= 20`: `'Resting'`
     - `Hunger <= 25`: `'Curious'`
     - `Happiness >= 80 && Energy >= 50`: `'Energetic'`
     - `Happiness >= 60`: `'Happy'`
     - Default: `'Focused'`

---

## Anti-Exploit & Ethical Gaming Rules

1. **800ms Cooldown Debounce:**
   - `ACTION_COOLDOWN_MS = 800`. Actions triggered within 800ms of the previous action must be rejected with an informative countdown reason.
2. **Zero Inactivity Punishment (No Pet Death):**
   - Pets NEVER starve, lose levels, lose stats, or die if a developer stops logging in or goes on vacation.
   - Inactivity merely settles mood to `Resting` and freezes energy until the user returns.
3. **Server-Authoritative Requirement (Stage 2 Backend):**
   - Gameplay calculations must remain pure functions in TypeScript with zero DOM/React dependencies so they can run identically on client and server.
   - In production, XP grants and level transitions must be evaluated and signed server-side.

---

## Unit Testing Mandate

Any modification to gameplay rules, thresholds, cooldowns, or vitals must be accompanied by comprehensive tests in `tests/unit/gameplay.test.ts` running via Node's native test runner (`npm test`). Never deploy a gameplay rule change without 100% test pass.

## References
- Core Gameplay Engine: `src/features/gamification/gameplay.ts`
- Rewards & Diminishing: `src/features/gamification/rewards.ts`
- Progression Curves: `src/features/gamification/progression.ts`
- Recovery Mechanics: `src/features/gamification/recovery.ts`
- Automated Suite: `tests/unit/gameplay.test.ts`
