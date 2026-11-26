# Sprint 5.1B — Memory Sparks Technical Design

## 1. Concept & Gameplay Mechanics

**Memory Sparks** is a pattern recognition and sequence recall mini-game inspired by classic Simon-style memory challenges, themed around 4 ancient elemental runes:
- **Emerald Earth** (Rune 0): `#10b981`, Key `1` / `ArrowUp` / `W`.
- **Amber Sun** (Rune 1): `#f59e0b`, Key `2` / `ArrowRight` / `D`.
- **Crimson Flame** (Rune 2): `#ef4444`, Key `3` / `ArrowDown` / `S`.
- **Cyan Wave** (Rune 3): `#06b6d4`, Key `4` / `ArrowLeft` / `A`.

---

## 2. Round Progression & Input Locking Safety

### Round Flow:
1. **Sequence Generation:** In round $R$, a sequence of length $R + 1$ (or generated incrementally) is presented to the player.
2. **Playback Phase (`showing_sequence`):**
   - The game flashes each rune in order (illumination duration: 420ms, pause: 200ms).
   - **Crucial Invariant:** `isInputLocked` is strictly set to `true`. All pointer, touch, and keyboard events are rejected during sequence demonstration to prevent accidental input registration or race conditions.
3. **Player Recall Phase (`awaiting_input`):**
   - `isInputLocked` is toggled to `false`.
   - The player must input the sequence in the exact order demonstrated.
   - Each correct step illuminates the rune with feedback and advances `playerInputIndex`.
4. **Round Completion (`round_success`):**
   - Completing the sequence successfully awards a round completion bonus:
     $$\text{Bonus} = 25 \times \text{Round Number}$$
   - Advances to the next round up to Round 6 (Mastery).
5. **Mistake Handling (`game_over`):**
   - Entering an incorrect rune immediately ends the session, displaying the mistake and transitioning to the Results Screen.

---

## 3. Scoring Model

- **Step Points:** 15 points per correct rune entered.
- **Round Completion Bonus:** $25 \times \text{Round}$.
- **Perfect 6-Round Mastery:** Up to $\approx 600 - 800$ points. Theoretical ceiling guard: 1500 points.

---

## 4. Accessibility & Multi-Modal Controls

- **Visual Discrimination:** In addition to distinctive colors, every rune has a unique elemental glyph (`🌱`, `☀️`, `🔥`, `💧`), a numbered badge (`1`, `2`, `3`, `4`), and high-contrast border states.
- **Keyboard Mappings:** Supported via standard number row (`1`, `2`, `3`, `4`), directional arrow keys (`Up`, `Right`, `Down`, `Left`), or gaming standard (`W`, `D`, `S`, `A`).
- **Screen Reader Announcements:** ARIA live region announces rune activations and sequence completion states.
