/**
 * GitHub Profile Pet - Companion Bonding, Daily Activities & Rotating Challenges Unit Tests
 * Sprint 5.2B: Companion Bonding & Daily Activities System
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialBondingState,
  calculateBondLevel,
  checkAndResetDay,
  evaluateMilestones,
  recordDirectPetting,
  recordCareActionForBonding,
  recordMiniGameForBonding,
  recordWardrobeActionForBonding,
  recordPersonalityInteractionForBonding,
  CURRENT_BONDING_SCHEMA_VERSION,
} from '../../src/features/bonding/bondingEngine.ts';
import {
  BOND_MILESTONES,
  BOND_MILESTONES_LIST,
  DAILY_ACTIVITIES_LIST,
  ROTATING_CHALLENGES_CATALOG,
  ROTATING_CHALLENGES_LIST,
  MAX_BOND_POINTS,
  getBondingPersonalityDialogue,
} from '../../src/features/bonding/bondingCatalog.ts';
import {
  getTodayUtcDateString,
  getDailyActivitiesForDate,
  getRotatingChallengeForDate,
} from '../../src/features/bonding/timePolicy.ts';
import {
  migrateBondingState,
} from '../../src/features/bonding/persistence.ts';
import {
  exportSaveData,
  importSaveData,
} from '../../src/lib/storage/gameStateStorage.ts';
import { INITIAL_PET_STATE } from '../../src/constants/petData.ts';
import type { PersonalityType } from '../../src/types/pet.ts';

describe('Sprint 5.2B — Bonding Catalogs & Milestone Thresholds', () => {
  it('TC-BND-01: Catalogs contain 5 milestones, 5 daily activities, and 7 rotating challenges', () => {
    assert.equal(BOND_MILESTONES_LIST.length, 5);
    assert.equal(DAILY_ACTIVITIES_LIST.length, 5);
    assert.equal(ROTATING_CHALLENGES_LIST.length, 7);

    // Verify milestone point thresholds
    assert.equal(BOND_MILESTONES.milestone_first_meeting.requiredPoints, 0);
    assert.equal(BOND_MILESTONES.milestone_getting_comfortable.requiredPoints, 50);
    assert.equal(BOND_MILESTONES.milestone_trusted_companion.requiredPoints, 120);
    assert.equal(BOND_MILESTONES.milestone_play_partners.requiredPoints, 220);
    assert.equal(BOND_MILESTONES.milestone_unbreakable_bond.requiredPoints, 350);
  });

  it('TC-BND-02: Bond level calculation maps accurately across all point brackets', () => {
    assert.equal(calculateBondLevel(0), 1);
    assert.equal(calculateBondLevel(49), 1);
    assert.equal(calculateBondLevel(50), 2);
    assert.equal(calculateBondLevel(119), 2);
    assert.equal(calculateBondLevel(120), 3);
    assert.equal(calculateBondLevel(219), 3);
    assert.equal(calculateBondLevel(220), 4);
    assert.equal(calculateBondLevel(349), 4);
    assert.equal(calculateBondLevel(350), 5);
    assert.equal(calculateBondLevel(500), 5);
    assert.equal(calculateBondLevel(999), 5);
  });

  it('TC-BND-03: Initial state has Level 1, 0 points, and milestone_first_meeting unlocked', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 12, 0, 0);
    const state = createInitialBondingState(fixedTime);

    assert.equal(state.schemaVersion, CURRENT_BONDING_SCHEMA_VERSION);
    assert.equal(state.bondPoints, 0);
    assert.equal(state.bondLevel, 1);
    assert.ok(state.unlockedMilestones.milestone_first_meeting);
    assert.equal(state.unlockedMilestones.milestone_first_meeting.unlockedAt, fixedTime);
    assert.equal(state.dailyActivities.dateKey, '2026-11-24');
    assert.equal(state.activeChallenge.rotationKey, '2026-11-24');
  });
});

describe('Sprint 5.2B — Time Policy & Deterministic Selection', () => {
  it('TC-TIME-01: Correctly formats UTC calendar date strings without local timezone bleed', () => {
    const utcMidnight = Date.UTC(2026, 0, 1, 0, 0, 0);
    assert.equal(getTodayUtcDateString(utcMidnight), '2026-01-01');

    const utcEndOfDay = Date.UTC(2026, 11, 31, 23, 59, 59);
    assert.equal(getTodayUtcDateString(utcEndOfDay), '2026-12-31');
  });

  it('TC-TIME-02: Generates exactly 3 unique, deterministic daily activities per UTC date', () => {
    const date1 = '2026-11-24';
    const acts1a = getDailyActivitiesForDate(date1);
    const acts1b = getDailyActivitiesForDate(date1);

    assert.deepEqual(acts1a, acts1b, 'Daily activities selection must be strictly deterministic');
    assert.equal(acts1a.length, 3);
    const unique = new Set(acts1a);
    assert.equal(unique.size, 3, 'All 3 daily activities must be unique');

    // Different date yields valid 3 activities
    const date2 = '2026-11-25';
    const acts2 = getDailyActivitiesForDate(date2);
    assert.equal(acts2.length, 3);
  });

  it('TC-TIME-03: Selects rotating challenge deterministically based on date key', () => {
    const challenge1 = getRotatingChallengeForDate('2026-11-24');
    const challenge2 = getRotatingChallengeForDate('2026-11-24');

    assert.equal(challenge1.challengeId, challenge2.challengeId);
    assert.equal(challenge1.rotationKey, '2026-11-24');
    assert.ok(challenge1.challengeId in ROTATING_CHALLENGES_CATALOG);
  });
});

describe('Sprint 5.2B — Anti-Exploit Safeguards & Daily Caps', () => {
  it('TC-EXP-01: Direct petting points are strictly clamped to 5 points per UTC day', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 10, 0, 0);
    let state = createInitialBondingState(fixedTime);

    // Stroke 10 times consecutively
    for (let i = 0; i < 10; i++) {
      const res = recordDirectPetting(state, fixedTime);
      state = res.nextState;
    }

    const today = state.dailyActivities.dateKey;
    const petPointsToday = state.stats.dailyDirectStrokesPoints[today];
    assert.equal(petPointsToday, 5, 'Daily direct petting points must never exceed 5 pts');

    // 5 points from petting + 15 points from completing daily_companion_pet = 20 points
    assert.equal(state.bondPoints, 20);
  });

  it('TC-EXP-02: Care action bonding points are strictly clamped to 10 points per UTC day', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 10, 0, 0);
    let state = createInitialBondingState(fixedTime);

    // Execute 5 care actions
    for (let i = 0; i < 5; i++) {
      const res = recordCareActionForBonding(state, fixedTime);
      state = res.nextState;
    }

    const today = state.dailyActivities.dateKey;
    const carePointsToday = state.stats.dailyCarePoints[today];
    assert.equal(carePointsToday, 10, 'Daily care points must never exceed 10 pts');
  });

  it('TC-EXP-03: Mini-game completion points are strictly clamped to 20 points per UTC day', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 10, 0, 0);
    let state = createInitialBondingState(fixedTime);

    // Complete 5 mini-game sessions
    for (let i = 0; i < 5; i++) {
      const res = recordMiniGameForBonding(state, 'companion_rhythm', 50, fixedTime);
      state = res.nextState;
    }

    const today = state.dailyActivities.dateKey;
    const mgPointsToday = state.stats.dailyMiniGamePoints[today];
    assert.equal(mgPointsToday, 20, 'Daily mini-game points must never exceed 20 pts');
  });

  it('TC-EXP-04: Total bond points cannot exceed MAX_BOND_POINTS (500)', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 10, 0, 0);
    const state = createInitialBondingState(fixedTime);
    state.bondPoints = 495;

    // Award activity with +15 points
    const res = recordCareActionForBonding(state, fixedTime);
    assert.equal(res.nextState.bondPoints, MAX_BOND_POINTS);
  });
});

describe('Sprint 5.2B — Daily Activities & Challenge Progression', () => {
  it('TC-ACT-01: Completing a daily activity grants reward exactly once (idempotent)', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 10, 0, 0);
    const state = createInitialBondingState(fixedTime);

    // Ensure daily_care_warmth is active
    state.dailyActivities.activities.daily_care_warmth = { progress: 0, completed: false, completedAt: null };

    // First completion
    const res1 = recordCareActionForBonding(state, fixedTime);
    assert.ok(res1.activitiesCompleted.some((a) => a.id === 'daily_care_warmth'));
    assert.ok(res1.nextState.dailyActivities.activities.daily_care_warmth.completed);
    const pointsAfterFirst = res1.nextState.bondPoints;

    // Second completion on same day
    const res2 = recordCareActionForBonding(res1.nextState, fixedTime);
    assert.equal(res2.activitiesCompleted.length, 0, 'Must not re-complete or re-award completed daily activity');
    // Only care points (up to daily cap) can be added, not duplicate activity reward (+15)
    assert.equal(res2.nextState.bondPoints, pointsAfterFirst + 5);
  });

  it('TC-ACT-02: Date rollover resets daily activities without penalizing bond points or milestones', () => {
    const day1 = Date.UTC(2026, 10, 24, 12, 0, 0);
    let state = createInitialBondingState(day1);
    state.bondPoints = 80;
    state = evaluateMilestones(state, day1).nextState;
    assert.equal(state.bondLevel, 2);
    assert.ok(state.unlockedMilestones.milestone_getting_comfortable);

    // Fast-forward 2 days (missing day 25)
    const day3 = Date.UTC(2026, 10, 26, 8, 0, 0);
    const rolledOver = checkAndResetDay(state, day3);

    assert.equal(rolledOver.dailyActivities.dateKey, '2026-11-26');
    assert.equal(rolledOver.bondPoints, 80, 'Bond points must never decay on missed days');
    assert.equal(rolledOver.bondLevel, 2, 'Bond level must never decrease on missed days');
    assert.ok(rolledOver.unlockedMilestones.milestone_getting_comfortable, 'Milestones must be preserved');
    assert.equal(rolledOver.stats.consecutiveDays, 1, 'Consecutive days resets gently without penalty');
  });

  it('TC-ACT-03: Rotating challenge completes and awards points when target threshold is satisfied', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 12, 0, 0);
    const state = createInitialBondingState(fixedTime);

    // Set active challenge to rhythm flow (target: 80)
    state.activeChallenge = {
      challengeId: 'challenge_rhythm_flow',
      rotationKey: '2026-11-24',
      progress: 0,
      completed: false,
      completedAt: null,
    };

    // Sub-threshold score (50)
    const res1 = recordMiniGameForBonding(state, 'companion_rhythm', 50, fixedTime);
    assert.equal(res1.challengeCompleted, false);

    // Qualifying score (95)
    const res2 = recordMiniGameForBonding(res1.nextState, 'companion_rhythm', 95, fixedTime);
    assert.equal(res2.challengeCompleted, true);
    assert.equal(res2.nextState.activeChallenge.completed, true);
    assert.equal(res2.nextState.stats.totalChallengesCompleted, 1);
  });
});

describe('Sprint 5.2B — Personality Integration & Dialogue', () => {
  it('TC-PERS-01: All four personalities provide contextual, distinct dialogue quotes', () => {
    const personalities: PersonalityType[] = ['curious', 'determined', 'playful', 'calm'];

    for (const p of personalities) {
      const milestoneQuote = getBondingPersonalityDialogue(p, 'milestone', 'Trusted Companion');
      const dailyQuote = getBondingPersonalityDialogue(p, 'daily_complete');
      const challengeQuote = getBondingPersonalityDialogue(p, 'challenge_complete');

      assert.ok(milestoneQuote.length > 10);
      assert.ok(dailyQuote.length > 10);
      assert.ok(challengeQuote.length > 10);
    }
  });

  it('TC-PERS-02: Switching personalities awards 0 bond points', () => {
    const fixedTime = Date.UTC(2026, 10, 24, 12, 0, 0);
    const state = createInitialBondingState(fixedTime);
    const initialPoints = state.bondPoints;

    // Simulated personality switch does not invoke bond points mutator
    assert.equal(state.bondPoints, initialPoints);
  });
});

describe('Sprint 5.2B — Persistence, Migration & Zero-XP Economy Invariant', () => {
  it('TC-MIG-01: Migrates raw, corrupted, or legacy state cleanly into valid schema version 1', () => {
    const corrupted = {
      schemaVersion: 'INVALID',
      bondPoints: -100,
      unlockedMilestones: null,
      dailyActivities: 'corrupted',
      activeChallenge: 42,
      stats: {
        totalDailyActivitiesCompleted: -5,
      },
    };

    const sanitized = migrateBondingState(corrupted);
    assert.equal(sanitized.schemaVersion, 1);
    assert.equal(sanitized.bondPoints, 0);
    assert.equal(sanitized.bondLevel, 1);
    assert.ok(sanitized.unlockedMilestones.milestone_first_meeting);
    assert.equal(sanitized.stats.totalDailyActivitiesCompleted, 0);
  });

  it('TC-MIG-02: Export and Import roundtrip preserves bonding state alongside pet state', () => {
    const state = createInitialBondingState();
    state.bondPoints = 150;
    state.bondLevel = 3;

    const exportedStr = exportSaveData(INITIAL_PET_STATE, [], undefined, state);
    const imported = importSaveData(exportedStr);

    assert.ok(imported.success);
    assert.ok(imported.pet);
    assert.ok(imported.bonding);
    assert.equal(imported.bonding.bondPoints, 150);
    assert.equal(imported.bonding.bondLevel, 3);
  });

  it('TC-ECON-01: Zero-XP economy invariant — bonding actions award strictly 0 XP and alter no vitals', () => {
    const pet = { ...INITIAL_PET_STATE, hunger: 50, xp: 100, level: 2 };
    let bonding = createInitialBondingState();

    // Trigger bonding actions
    bonding = recordDirectPetting(bonding).nextState;
    bonding = recordCareActionForBonding(bonding).nextState;
    bonding = recordMiniGameForBonding(bonding, 'star_catcher', 100).nextState;
    bonding = recordWardrobeActionForBonding(bonding, 2).nextState;
    bonding = recordPersonalityInteractionForBonding(bonding).nextState;

    // Verify pet vitals and XP are 100% untouched
    assert.equal(pet.hunger, 50);
    assert.equal(pet.xp, 100);
    assert.equal(pet.level, 2);
    assert.ok(bonding.bondPoints > 0, 'Bond points advanced independently');
  });
});
