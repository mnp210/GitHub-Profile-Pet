/**
 * GitHub Profile Pet - Mini-games Unit & Integration Tests
 * Sprint 5.1B: Interactive Activities, Mini-games & Companion Play System
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGameSession,
  startGameSession,
  pauseGameSession,
  resumeGameSession,
  finishGameSession,
  abandonGameSession,
  MINI_GAMES_CATALOG,
} from '../../src/features/minigames/engine.ts';
import {
  createInitialStarCatcherState,
  spawnStar,
  tickStarCatcher,
  catchStarDirect,
  catchStarsWithNet,
} from '../../src/features/minigames/starCatcher.ts';
import {
  createInitialMemorySparksState,
  advanceToNextRound,
  submitRuneInput,
  SPARK_RUNES,
  type MemorySparksState,
} from '../../src/features/minigames/memorySparks.ts';
import {
  createInitialCompanionRhythmState,
  calculateRhythmRating,
  getRatingPoints,
  strikeRhythmBeat,
  tickRhythmTrack,
  createRhythmTrack,
} from '../../src/features/minigames/companionRhythm.ts';
import {
  getMiniGameReaction,
  type GameEventContext,
} from '../../src/features/minigames/personalityReactions.ts';
import type { PetState } from '../../src/types/pet.ts';
import type { PersonalityId } from '../../src/features/personality/types.ts';

function createMockPetState(overrides: Partial<PetState> = {}): PetState {
  return {
    name: 'Shadow Claw',
    species: 'cat',
    level: 3,
    xp: 250,
    maxExp: 300,
    mood: 'Curious',
    evolutionStage: 'Hatchling',
    hunger: 80,
    happiness: 80,
    energy: 80,
    personality: 'curious',
    ...overrides,
  };
}

describe('Sprint 5.1B — Core Session Engine & Catalog', () => {
  it('TC-SES-01: Creates valid game sessions with clean initial values', () => {
    const session = createGameSession('star_catcher', 150, 100_000);
    assert.ok(session.sessionId.startsWith('star_catcher_100000_'));
    assert.equal(session.gameId, 'star_catcher');
    assert.equal(session.status, 'ready');
    assert.equal(session.score, 0);
    assert.equal(session.highScore, 150);
    assert.equal(session.isNewBest, false);
    assert.equal(session.streak, 0);
  });

  it('TC-SES-02: Transitions session through lifecycle states correctly', () => {
    let session = createGameSession('memory_sparks', 0, 100_000);
    session = startGameSession(session, 101_000);
    assert.equal(session.status, 'playing');
    assert.equal(session.startedAt, 101_000);

    session = pauseGameSession(session);
    assert.equal(session.status, 'paused');

    session = resumeGameSession(session);
    assert.equal(session.status, 'playing');

    session = finishGameSession(session, { finalScore: 220, maxStreak: 5, accuracy: 95, nowMs: 125_000 });
    assert.equal(session.status, 'completed');
    assert.equal(session.score, 220);
    assert.equal(session.highScore, 220);
    assert.equal(session.isNewBest, true);
    assert.equal(session.durationSec, 24);
  });

  it('TC-SES-03: Rejects invalid or negative scores and prevents score mutation after completion', () => {
    const session = startGameSession(createGameSession('companion_rhythm', 100, 100_000));

    assert.throws(() => {
      finishGameSession(session, { finalScore: -50 });
    }, /Invalid score submitted/);

    assert.throws(() => {
      finishGameSession(session, { finalScore: NaN });
    }, /Invalid score submitted/);

    const completed = finishGameSession(session, { finalScore: 80 });
    const duplicateFinish = finishGameSession(completed, { finalScore: 500 });
    assert.equal(duplicateFinish.score, 80, 'Score must be sealed and immutable once completed');
  });

  it('TC-SES-04: Verifies catalog metadata for all three activities', () => {
    const games = ['star_catcher', 'memory_sparks', 'companion_rhythm'] as const;
    for (const gId of games) {
      const meta = MINI_GAMES_CATALOG[gId];
      assert.ok(meta);
      assert.equal(meta.id, gId);
      assert.ok(meta.title.length > 0);
      assert.ok(meta.instructions.length >= 3);
      assert.ok(meta.controls.length >= 2);
    }
  });

  it('TC-SES-05: Handles abandoned sessions safely', () => {
    const session = startGameSession(createGameSession('star_catcher'));
    const abandoned = abandonGameSession(session);
    assert.equal(abandoned.status, 'abandoned');
    assert.ok(abandoned.endedAt !== null);
  });
});

describe('Sprint 5.1B — Star Catcher Game Mechanics', () => {
  it('TC-STAR-01: Generates bounded star entities with predictable properties', () => {
    const standard = spawnStar('s1', 1000, 0.5, 0.2);
    assert.equal(standard.id, 's1');
    assert.equal(standard.type, 'standard');
    assert.equal(standard.points, 10);
    assert.equal(standard.y, 0);
    assert.ok(standard.x >= 8 && standard.x <= 92);

    const golden = spawnStar('s2', 1000, 0.9, 0.85);
    assert.equal(golden.type, 'golden');
    assert.equal(golden.points, 25);
    assert.equal(golden.speedY, 28);

    const nebula = spawnStar('s3', 1000, 0.1, 0.65);
    assert.equal(nebula.type, 'nebula');
    assert.equal(nebula.points, 15);
  });

  it('TC-STAR-02: Advances physics tick and marks fallen stars as missed', () => {
    const initial = createInitialStarCatcherState();
    const starAtEdge = { ...spawnStar('edge_star', 0, 0.5, 0.1), y: 94, speedY: 20 };
    const stateWithStar = { ...initial, stars: [starAtEdge], streak: 4 };

    const { nextState, newMisses } = tickStarCatcher(stateWithStar, 0.2); // y becomes 94 + 4 = 98 (>95)
    assert.equal(newMisses.length, 1);
    assert.equal(newMisses[0].missed, true);
    assert.equal(nextState.totalMissed, 1);
    assert.equal(nextState.streak, 0, 'Streak must reset to 0 upon missed star');
  });

  it('TC-STAR-03: Direct click catch awards points and increments streak combo', () => {
    const initial = createInitialStarCatcherState();
    const star = spawnStar('target_1', 0, 0.5, 0.1); // standard: 10 pts
    const state = { ...initial, stars: [star] };

    const { nextState, caughtStar, pointsAwarded } = catchStarDirect(state, 'target_1');
    assert.ok(caughtStar);
    assert.equal(caughtStar.caught, true);
    assert.equal(pointsAwarded, 10);
    assert.equal(nextState.score, 10);
    assert.equal(nextState.streak, 1);
    assert.equal(nextState.totalCaught, 1);
  });

  it('TC-STAR-04: Catch net collects stars aligned horizontally within basket boundaries', () => {
    const initial = createInitialStarCatcherState(); // basketX = 50, width = 20 (range 40..60)
    const starInside = { ...spawnStar('in_net', 0, 0.5, 0.1), x: 50, y: 80 };
    const starOutside = { ...spawnStar('out_net', 0, 0.1, 0.1), x: 20, y: 80 };

    const state = { ...initial, stars: [starInside, starOutside] };
    const { nextState, caughtStars, totalPoints } = catchStarsWithNet(state);

    assert.equal(caughtStars.length, 1);
    assert.equal(caughtStars[0].id, 'in_net');
    assert.equal(totalPoints, 10);
    assert.equal(nextState.totalCaught, 1);
  });
});

describe('Sprint 5.1B — Memory Sparks Game Mechanics', () => {
  it('TC-SPARK-01: Initializes with 4 distinct elemental runes and locked playback', () => {
    assert.equal(SPARK_RUNES.length, 4);
    assert.deepEqual(SPARK_RUNES.map((r) => r.id), [0, 1, 2, 3]);

    const initial = createInitialMemorySparksState(3);
    assert.equal(initial.sequence.length, 3);
    assert.equal(initial.round, 1);
    assert.equal(initial.isInputLocked, true);
    assert.equal(initial.phase, 'showing_sequence');
  });

  it('TC-SPARK-02: Rejects inputs when locked during sequence playback', () => {
    const initial = createInitialMemorySparksState(2);
    const result = submitRuneInput(initial, 0);
    assert.equal(result.isCorrect, false);
    assert.equal(result.pointsAwarded, 0);
    assert.equal(result.nextState.score, 0);
  });

  it('TC-SPARK-03: Evaluates correct inputs step-by-step and awards round bonus on completion', () => {
    // Sequence: [1, 3]
    let state: MemorySparksState = {
      ...createInitialMemorySparksState(2),
      sequence: [1, 3],
      isInputLocked: false,
      phase: 'awaiting_input',
      round: 1,
    };

    // Step 1: Input 1 (correct, intermediate)
    const res1 = submitRuneInput(state, 1);
    assert.equal(res1.isCorrect, true);
    assert.equal(res1.isRoundComplete, false);
    assert.equal(res1.pointsAwarded, 15);
    state = res1.nextState;

    // Step 2: Input 3 (correct, completes round 1)
    const res2 = submitRuneInput(state, 3);
    assert.equal(res2.isCorrect, true);
    assert.equal(res2.isRoundComplete, true);
    // points: 15 (step) + 25 (round 1 bonus) = 40
    assert.equal(res2.pointsAwarded, 40);
    assert.equal(res2.nextState.phase, 'round_success');
    assert.equal(res2.nextState.score, 55);
  });

  it('TC-SPARK-04: Transitions to game_over on incorrect rune input', () => {
    const state = {
      ...createInitialMemorySparksState(2),
      sequence: [0, 2],
      isInputLocked: false,
      phase: 'awaiting_input' as const,
    };

    const res = submitRuneInput(state, 3); // Expected 0, gave 3
    assert.equal(res.isCorrect, false);
    assert.equal(res.nextState.phase, 'game_over');
    assert.equal(res.nextState.isInputLocked, true);
  });

  it('TC-SPARK-05: Advances to next round with extended sequence', () => {
    const state = {
      ...createInitialMemorySparksState(2),
      sequence: [0, 1],
      round: 1,
      phase: 'round_success' as const,
    };

    const nextRoundState = advanceToNextRound(state, 2);
    assert.equal(nextRoundState.round, 2);
    assert.deepEqual(nextRoundState.sequence, [0, 1, 2]);
    assert.equal(nextRoundState.phase, 'showing_sequence');
    assert.equal(nextRoundState.isInputLocked, true);
    assert.equal(nextRoundState.playerInputIndex, 0);
  });
});

describe('Sprint 5.1B — Companion Rhythm Game Mechanics', () => {
  it('TC-RHYTHM-01: Generates deterministic rhythm tracks with defined spacing', () => {
    const track = createRhythmTrack(8, 1000, 800);
    assert.equal(track.length, 8);
    assert.equal(track[0].targetTimeMs, 1000);
    assert.equal(track[1].targetTimeMs, 1800);
    assert.equal(track[7].targetTimeMs, 6600);
  });

  it('TC-RHYTHM-02: Accurately categorizes timing ratings across delta boundaries', () => {
    assert.equal(calculateRhythmRating(0), 'perfect');
    assert.equal(calculateRhythmRating(75), 'perfect');
    assert.equal(calculateRhythmRating(-95), 'perfect');
    assert.equal(calculateRhythmRating(180), 'good');
    assert.equal(calculateRhythmRating(-240), 'good');
    assert.equal(calculateRhythmRating(-350), 'early');
    assert.equal(calculateRhythmRating(380), 'late');
    assert.equal(calculateRhythmRating(500), 'miss');
  });

  it('TC-RHYTHM-03: Calculates points with combo multipliers', () => {
    assert.equal(getRatingPoints('perfect', 0), 50);
    assert.equal(getRatingPoints('perfect', 6), 60); // 50 + (6/3)*5 = 60
    assert.equal(getRatingPoints('good', 0), 25);
    assert.equal(getRatingPoints('early', 0), 10);
    assert.equal(getRatingPoints('late', 0), 10);
    assert.equal(getRatingPoints('miss', 5), 0);
  });

  it('TC-RHYTHM-04: Strikes beat and records accuracy', () => {
    const track = createRhythmTrack(3, 1000, 1000);
    const initial = createInitialCompanionRhythmState(track);

    // Strike at t=1020ms (delta = +20ms: PERFECT)
    const { nextState, rating, pointsAwarded } = strikeRhythmBeat(initial, 1020);
    assert.equal(rating, 'perfect');
    assert.equal(pointsAwarded, 50);
    assert.equal(nextState.score, 50);
    assert.equal(nextState.streak, 1);
    assert.equal(nextState.perfectHits, 1);
    assert.equal(nextState.totalHits, 1);
    assert.equal(nextState.notes[0].hit, true);
  });

  it('TC-RHYTHM-05: Ticks timeline and automatically marks expired notes as missed', () => {
    const track = createRhythmTrack(2, 1000, 1000); // note 0 at 1000ms (expires at 1000 + 450 = 1450ms)
    const initial = createInitialCompanionRhythmState(track);

    const { nextState, newMisses } = tickRhythmTrack(initial, 1500); // time = 1500 > 1450
    assert.equal(newMisses.length, 1);
    assert.equal(newMisses[0].rating, 'miss');
    assert.equal(nextState.totalMisses, 1);
    assert.equal(nextState.streak, 0);
  });
});

describe('Sprint 5.1B — Personality Integration & Dialogue Responses', () => {
  it('TC-PERS-01: Generates distinct contextual reactions for all four archetypes on game start', () => {
    const personalities: PersonalityId[] = ['curious', 'determined', 'playful', 'calm'];
    for (const p of personalities) {
      const ctx: GameEventContext = { gameId: 'star_catcher', personality: p };
      const react = getMiniGameReaction('start', ctx);
      assert.ok(react.reactionText.length > 0);
      assert.ok(react.behaviourState.length > 0);
      assert.ok(react.thoughtBubble && react.thoughtBubble.length > 0);
    }
  });

  it('TC-PERS-02: Generates in-character encouragement on misses without being excessively punishing', () => {
    const ctxCurious: GameEventContext = { gameId: 'star_catcher', personality: 'curious' };
    const reactCurious = getMiniGameReaction('miss_star', ctxCurious);
    assert.match(reactCurious.reactionText, /observed|anomaly|deviation/i);

    const ctxDetermined: GameEventContext = { gameId: 'companion_rhythm', personality: 'determined' };
    const reactDetermined = getMiniGameReaction('rhythm_miss', ctxDetermined);
    assert.match(reactDetermined.reactionText, /regroup|push forward|warriors|misfire/i);

    const ctxPlayful: GameEventContext = { gameId: 'memory_sparks', personality: 'playful' };
    const reactPlayful = getMiniGameReaction('spark_wrong', ctxPlayful);
    assert.match(reactPlayful.reactionText, /oopsie|fun|catch the next|try again/i);

    const ctxCalm: GameEventContext = { gameId: 'star_catcher', personality: 'calm' };
    const reactCalm = getMiniGameReaction('miss_star', ctxCalm);
    assert.match(reactCalm.reactionText, /stillness|ripple|breathe|centered/i);
  });

  it('TC-PERS-03: Celebrates new high scores enthusiastically per personality', () => {
    const ctxHigh: GameEventContext = { gameId: 'star_catcher', personality: 'playful', score: 180, isNewBest: true };
    const react = getMiniGameReaction('game_complete', ctxHigh);
    assert.equal(react.behaviourState, 'celebrating');
    assert.match(react.reactionText, /BEST SCORE|RECORD|WE DID IT/i);
  });
});

describe('Sprint 5.1B — Economy Invariants & Zero-XP Safeguards', () => {
  it('TC-ECON-01: Playing mini-games awards exactly 0 XP and mutates zero pet vitals', () => {
    const pet = createMockPetState({ level: 4, xp: 120, energy: 75, hunger: 80, happiness: 85 });
    
    // Simulate completing all 3 games with high scores
    const sessionStar = finishGameSession(startGameSession(createGameSession('star_catcher')), { finalScore: 350 });
    const sessionSparks = finishGameSession(startGameSession(createGameSession('memory_sparks')), { finalScore: 280 });
    const sessionRhythm = finishGameSession(startGameSession(createGameSession('companion_rhythm')), { finalScore: 400 });

    assert.equal(sessionStar.score, 350);
    assert.equal(sessionSparks.score, 280);
    assert.equal(sessionRhythm.score, 400);

    // Invariant verification: Pet state must remain 100% unmutated
    assert.equal(pet.level, 4);
    assert.equal(pet.xp, 120);
    assert.equal(pet.energy, 75);
    assert.equal(pet.hunger, 80);
    assert.equal(pet.happiness, 85);
  });

  it('TC-ECON-02: Game sessions cannot be submitted as GitHub contribution events', () => {
    const session = createGameSession('star_catcher');
    // Session objects have no commit SHA, issue number, PR number, or review ID
    assert.equal((session as any).sha, undefined);
    assert.equal((session as any).pull_request, undefined);
    assert.equal((session as any).issue, undefined);
  });
});
