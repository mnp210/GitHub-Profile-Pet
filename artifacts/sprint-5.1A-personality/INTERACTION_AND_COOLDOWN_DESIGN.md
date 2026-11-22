# Sprint 5.1A — Interaction, Economy & Anti-Exploit Design

## 1. Gamification Economy Invariant

A central engineering requirement of Sprint 5.1A is protecting the established contribution economy:

$$\Delta \text{XP}_{\text{personality\_change}} = 0$$
$$\Delta \text{Vitals}_{\text{personality\_change}} = 0$$

Under no circumstances does switching between companion archetypes, clicking thought bubbles, or examining companion traits award experience points, restore energy, adjust satiety, or modify levels.

---

## 2. Interaction Flows & Cooldown Guarding

The application features two layers of user interaction:

### Layer A: Authoritative Care Actions
- **Trigger:** Feed, Play, Train, Rest, Pet buttons.
- **Rules Engine:** Governed by `executePetAction` in `src/features/gamification/gameplay.ts`.
- **Enforcements:**
  1. **800ms Cooldown:** Rapid clicks within 800ms are rejected with `Action Cooldown: Please wait...`.
  2. **Diminishing Returns:** Consecutive actions decay according to the established curve:
     $$100\% \to 60\% \to 35\% \to 20\% \to 10\%$$
  3. **Daily Cap:** Progression remains bound by the 300 XP/day ceiling.
- **Personality Integration:** Upon successful execution, the dialogue returned is dynamically authored by the companion's active personality profile (e.g., *Curious* praises algorithmic efficiency, while *Determined* emphasizes discipline).

### Layer B: Direct Companion Stroking
- **Trigger:** Direct click or `Enter`/`Space` keypress on the `PetSprite` canvas.
- **Behavior:**
  - Invokes `executePetAction('pet')`, ensuring standard cooldown and rewards are applied if available.
  - If on cooldown, gracefully triggers visual particle feedback (e.g., `Tilt~`, `Bounce!`, `Nod!`) and audio purr without awarding unauthorized XP.
  - Adapts animation state (`curious`, `playing`, or `happy`) for 800ms before returning to ambient idle.

---

## 3. Anti-Farming & Replay Prevention Summary

| Attack Vector | Protection Mechanism | Verification Status |
| :--- | :--- | :--- |
| Rapid personality switching | Pure in-memory React state update; 0 XP awarded | Verified via `TC-ECON-01` |
| Fast cursor click spamming | `ACTION_COOLDOWN_MS` (800ms) guard | Verified via `TC-ECON-02` |
| Diminishing return bypass | Timestamped `ActionHistoryEntry` log | Verified via `gameplay.test.ts` |
| Stale state injection | State validation with schema clamping | Verified via `petStateValidation.test.ts` |
