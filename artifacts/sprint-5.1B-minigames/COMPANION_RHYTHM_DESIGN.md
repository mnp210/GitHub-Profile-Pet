# Sprint 5.1B — Companion Rhythm Technical Design

## 1. Concept & Gameplay Mechanics

**Companion Rhythm** is a rhythm precision mini-game where the player and companion groove together. Rhythm pulses travel along a horizontal track toward a glowing strike zone. Players hit the strike trigger as each pulse aligns with the target line.

### Key Characteristics:
- **Track Length:** 16 deterministic beats generated across 18,000ms (~18s).
- **Tempo:** 120 BPM base tempo with dynamic rhythmic syncopation.
- **Strike Action:** Single large accessible trigger button or keyboard `Space` / `Enter`.

---

## 2. Timing Windows & Precision Ratings

When the strike action is executed, the engine evaluates the time delta $|\Delta t| = |t_{\text{current}} - t_{\text{target}}|$ between the current track time and the nearest active beat:

| Rating | Timing Window | Base Points | Multiplier Impact | Visual Feedback |
| :--- | :--- | :--- | :--- | :--- |
| `PERFECT` | $|\Delta t| \le 100\text{ ms}$ | 50 pts | Streak $+1$, Combos active | Cyan glowing burst, high ring animation |
| `GOOD` | $100\text{ ms} < |\Delta t| \le 250\text{ ms}$ | 30 pts | Streak $+1$ | Emerald sparkle |
| `EARLY` / `LATE` | $250\text{ ms} < |\Delta t| \le 450\text{ ms}$ | 10 pts | Streak reset to 0 | Amber indicator |
| `MISS` | $|\Delta t| > 450\text{ ms}$ or unhit pulse passes strike line by $+300\text{ ms}$ | 0 pts | Streak reset to 0 | Dim gray fade |

### Combo Multiplier:
- Consecutive `PERFECT` or `GOOD` hits increment the combo counter.
- Combos award bonus points: $\text{Bonus} = \min(10, \lfloor \text{combo} / 2 \rfloor) \times 5$ pts per hit.
- Any `EARLY`, `LATE`, or `MISS` drops the active combo counter to 0.

---

## 3. Companion Dance Integration

- During high combos ($\ge 4$), the companion transitions to the `'celebrating'` behavior state with animated sparkles.
- During steady rhythm, the companion grooves in sync (`'happy'` or `'playing'`).
- On misses, the companion provides gentle encouragement (`'idle_calm'`).

---

## 4. Accessibility & Audio-Free Design

- The game is 100% playable and enjoyable without speakers or headphones.
- Visual rhythm feedback features:
  - High-contrast glowing strike ring.
  - Large text ratings displayed prominently above the strike line (`PERFECT!`, `GOOD!`, `EARLY`, `LATE`).
  - Progress bar showing song completion percentage.
