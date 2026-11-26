# Sprint 5.1B — Star Catcher Technical Design

## 1. Concept & Gameplay Mechanics

**Star Catcher** is a reflex-driven cosmic catching game. Players maneuver a starlight collector basket along the base of an interactive celestial arena or directly tap falling stellar bodies before they dissipate.

### Key Characteristics:
- **Round Duration:** 30 seconds fixed countdown timer.
- **Arena Dimensions:** Normalized 0–100 horizontal and vertical percentage coordinate system, adapting dynamically to any responsive container size.
- **Entity Types:**
  - `standard`: Regular falling starlight (Speed: 18-35 units/s, Value: 10 base points).
  - `comet`: Fast, brilliant shooting star (Speed: 38-55 units/s, Value: 25 base points).
  - `nebula`: Slow, undulating cosmic cloud (Speed: 10-18 units/s, Value: 15 base points).

---

## 2. Mathematical Scoring & Streak Model

### Base Formula
$$\text{Points} = \text{Base Points} \times (1 + \lfloor \text{streak} / 3 \rfloor \times 0.25)$$

- Every 3 consecutive catches increases the streak multiplier tier by $+25\%$ (e.g., Streak 3–5 = 1.25x, Streak 6–8 = 1.50x, Streak 9+ = 1.75x).
- Letting a star touch the floor without being caught resets the streak counter to 0.
- Max theoretical score in 30 seconds under perfect play: $\approx 500 - 800$ points. Theoretical ceiling guard: 2500 points.

---

## 3. Dual Input Modality

1. **Direct Tap / Click:** Players can directly tap any falling star entity in the sky. Tapping instantly captures the entity regardless of basket position, offering an accessible, intuitive mobile experience.
2. **Basket Collection (Drag / Keyboard):** The net basket at the bottom (width: 24% of arena width) can be moved by:
   - Mouse hover / pointer drag across the arena floor.
   - Touch drag horizontally along the control lane.
   - Keyboard `ArrowLeft` / `ArrowRight` or `KeyA` / `KeyD` keys (smooth discrete steps).

---

## 4. Bounded Physics Engine (`src/features/minigames/starCatcher.ts`)

- **Tick Rate:** Independent of framerate via `deltaMs` time-step integration.
- **Spawn Interval:** Dynamically spawns new entities every 800ms–1400ms when total active entities on screen is below 6.
- **Collision Detection:** Bounding box check against bottom lane ($Y \ge 86\%$) within basket horizontal bounds $[X_{basket} - 12, X_{basket} + 12]$.
- **Dissipation:** Stars that reach $Y > 96\%$ without colliding are marked as missed and removed, triggering `miss_star` companion reactions.
