# Sprint 5.1A — Living Companion Animation System

## 1. Design Principles

In strict accordance with the project's art direction and quality assurance guidelines (`virtual-pet-art-direction` and `github-pet-quality-assurance`):
1. **Isolated Character Movement:** Animations are applied exclusively to the character sprite artwork itself. Surrounding cards, panels, and borders never jitter, shift, or induce layout reflows.
2. **Strict Reduced-Motion Compliance:** When the user enables `prefers-reduced-motion: reduce`, all keyframes, head tilts, bouncing hops, and floating particles are immediately replaced with clean, static rendering.
3. **Adaptive Cadence per Archetype:** Blinking rates, idle frequencies, and movement paces dynamically tune themselves to match the active companion's personality.

---

## 2. Dynamic Keyframe Specifications

Defined in `src/app/globals.css`:

### 1. Curious Tilt (`pet-curious-tilt`)
```css
@keyframes pet-curious-tilt {
  0%, 100% { transform: translateY(0px) rotate(0deg); }
  50% { transform: translateY(-2px) rotate(-4deg); }
}
.animate-pet-curious {
  animation: pet-curious-tilt 2.5s ease-in-out infinite;
  transform-origin: bottom center;
}
```

### 2. Playful Bounce (`pet-bounce-playful`)
```css
@keyframes pet-bounce-playful {
  0%, 100% { transform: translateY(0px) scale(1, 1); }
  30% { transform: translateY(-8px) scale(0.96, 1.04); }
  60% { transform: translateY(0px) scale(1.04, 0.96); }
  80% { transform: translateY(-3px) scale(0.98, 1.02); }
}
.animate-pet-bounce {
  animation: pet-bounce-playful 1.6s ease-in-out infinite;
  transform-origin: bottom center;
}
```

### 3. Zen Breathe (`pet-zen-breathe`)
```css
@keyframes pet-zen-breathe {
  0%, 100% { transform: scale(1, 1); }
  50% { transform: scale(1.03, 0.97); }
}
.animate-pet-zen {
  animation: pet-zen-breathe 4s ease-in-out infinite;
  transform-origin: bottom center;
}
```

### 4. Floating Resting Indicator (`float-zzz`)
```css
@keyframes float-zzz {
  0% { opacity: 0; transform: translateY(0px) translateX(0px); }
  50% { opacity: 0.9; transform: translateY(-8px) translateX(4px); }
  100% { opacity: 0; transform: translateY(-16px) translateX(8px); }
}
.animate-float-zzz {
  animation: float-zzz 2.5s ease-out infinite;
}
```

---

## 3. Personality Blinking Adaptation

In `src/components/pet/PetSprite.tsx`, the intermittent eye-blink interval modulates dynamically based on `personality`:

- **Calm Archetype:** Serene, meditative blinking every 4,500ms – 6,500ms.
- **Determined Archetype:** Focused, unwavering gaze blinking every 4,000ms – 6,000ms.
- **Curious Archetype:** Observant, attentive blinking every 3,000ms – 5,000ms.
- **Playful Archetype:** Quick, excited blinking every 2,200ms – 4,200ms.

---

## 4. Accessibility & Background Tab Throttling

```css
@media (prefers-reduced-motion: reduce) {
  .animate-pet-cat,
  .animate-pet-dragon,
  .animate-pet-fox,
  .animate-pet-slime,
  .animate-pet-curious,
  .animate-pet-bounce,
  .animate-pet-zen,
  .animate-float-zzz {
    animation: none !important;
  }
}
```

When users minimize the browser tab or switch away, `document.hidden` halts the React state interval, preventing memory churn and wasteful background timer ticks.
