# Sprint 5.1B — Session & Score Integrity Specifications

## 1. Scope & Verification

Mini-game sessions require rigorous safeguards to ensure deterministic scoring, prevent client tampering or phantom score injections, and maintain strict data integrity.

---

## 2. Invalidation & Validation Pipeline

Every finished session is validated by `finishGameSession()` in `src/features/minigames/engine.ts`:

```typescript
export function finishGameSession(
  session: MiniGameSession,
  results: { finalScore: number; statistics?: Record<string, number> }
): MiniGameSession {
  // Guard 1: Status must be playing or paused
  if (session.status !== 'playing' && session.status !== 'paused') {
    throw new Error(`Cannot finish session in status '${session.status}'`);
  }

  // Guard 2: Score must be non-negative finite number
  const score = Math.max(0, Math.floor(results.finalScore));
  if (!Number.isFinite(score)) {
    throw new Error('Invalid score value: must be finite');
  }

  // Guard 3: Maximum score bound enforcement
  const cap = MAX_SCORE_BOUNDS[session.gameId] ?? 10000;
  if (score > cap) {
    throw new Error(`Score ${score} exceeds safety cap ${cap} for ${session.gameId}`);
  }

  // Guard 4: Timing monotonicity
  const now = Date.now();
  if (session.startTime > now) {
    throw new Error('Session start time is in the future');
  }

  return {
    ...session,
    status: 'finished',
    score,
    endTime: now,
    statistics: results.statistics,
  };
}
```

---

## 3. Storage Separation & Isolation

- **Zero Coupling with Pet Save File:** High scores are stored under the discrete localStorage key `profile_pet_minigame_highscores`.
- **Zero Token / Secret Exposure:** Mini-game payloads contain zero user tokens, authentication credentials, or repository metadata.
- **Fail-Safe High Score Reader:** `loadHighScores()` validates that every retrieved score is a finite number $\ge 0$. Malformed or corrupted storage entries are caught and safely replaced with zero defaults.
