import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateActionReward,
  getRewardMultiplier,
  pruneExpiredActions,
  type ActionHistoryEntry,
} from '../../src/features/gamification/rewards.ts';
import {
  addExperience,
  calculateCumulativeXpForLevel,
  calculateLevelFromTotalXp,
  calculateMaxExp,
  clampVital,
  deriveEvolutionStage,
  deriveMood,
  getUpdatedMilestones,
} from '../../src/features/gamification/progression.ts';
import { calculateElapsedRestRecovery } from '../../src/features/gamification/recovery.ts';
import {
  executePetAction,
} from '../../src/features/gamification/gameplay.ts';
import type { PetState } from '../../src/types/pet.ts';

const createBasePet = (overrides?: Partial<PetState>): PetState => ({
  name: 'Pixel Partner',
  species: 'cat',
  level: 1,
  xp: 0,
  maxExp: 100,
  mood: 'Focused',
  evolutionStage: 'Hatchling',
  hunger: 50,
  happiness: 70,
  energy: 80,
  ...overrides,
});

describe('Gamification Diminishing Returns & Rewards', () => {
  it('awards 100% full reward on first action', () => {
    const now = 100_000;
    const history: ActionHistoryEntry[] = [];
    const reward = calculateActionReward('pet', history, now);

    assert.equal(reward.multiplier, 1.0);
    assert.equal(reward.percentageDisplay, 100);
    assert.equal(reward.consecutiveCount, 1);
    assert.equal(reward.expGained, 6);
    assert.equal(reward.happinessGained, 12);
  });

  it('correctly applies diminishing multipliers (100% -> 60% -> 35% -> 20% -> 10%) on consecutive actions', () => {
    let now = 100_000;
    const history: ActionHistoryEntry[] = [];
    const expectedMultipliers = [1.0, 0.6, 0.35, 0.2, 0.1, 0.1];

    for (let i = 0; i < expectedMultipliers.length; i++) {
      const { multiplier, percentageDisplay, consecutiveCount } = getRewardMultiplier(
        history,
        'train',
        now
      );
      assert.equal(multiplier, expectedMultipliers[i]);
      assert.equal(percentageDisplay, Math.round(expectedMultipliers[i] * 100));
      assert.equal(consecutiveCount, i + 1);

      // Record action and advance clock within the 60s window
      history.push({ action: 'train', timestamp: now });
      now += 2_000;
    }
  });

  it('keeps action diminishing returns strictly independent by action type', () => {
    const now = 100_000;
    const history: ActionHistoryEntry[] = [
      { action: 'pet', timestamp: now - 5_000 },
      { action: 'pet', timestamp: now - 3_000 },
      { action: 'pet', timestamp: now - 1_000 },
    ];

    // Petting was used 3 times (4th will be 20%)
    const petReward = calculateActionReward('pet', history, now);
    assert.equal(petReward.multiplier, 0.2);

    // Training was NEVER used, must yield 100%
    const trainReward = calculateActionReward('train', history, now);
    assert.equal(trainReward.multiplier, 1.0);
    assert.equal(trainReward.consecutiveCount, 1);
    assert.equal(trainReward.energyCost, 18); // Fixed cost unmodified
  });

  it('expires actions older than 60s and restores reward multiplier to 100%', () => {
    const now = 200_000;
    const history: ActionHistoryEntry[] = [
      { action: 'feed', timestamp: now - 75_000 }, // Expired (>60s)
      { action: 'feed', timestamp: now - 65_000 }, // Expired (>60s)
    ];

    const pruned = pruneExpiredActions(history, now);
    assert.equal(pruned.length, 0);

    const reward = calculateActionReward('feed', history, now);
    assert.equal(reward.multiplier, 1.0);
    assert.equal(reward.consecutiveCount, 1);
  });
});

describe('Progression, Overflow XP & Vitals Clamping', () => {
  it('calculates level threshold deterministically', () => {
    assert.equal(calculateMaxExp(1), 100);
    assert.equal(calculateMaxExp(2), 200);
    assert.equal(calculateMaxExp(5), 500);
  });

  it('calculates cumulative level threshold TotalXP(L) = 50 * L * (L - 1)', () => {
    assert.equal(calculateCumulativeXpForLevel(1), 0);
    assert.equal(calculateCumulativeXpForLevel(2), 100);
    assert.equal(calculateCumulativeXpForLevel(3), 300);
    assert.equal(calculateCumulativeXpForLevel(4), 600);
    assert.equal(calculateCumulativeXpForLevel(5), 1000); // Juvenile Form
    assert.equal(calculateCumulativeXpForLevel(10), 4500); // Ascended Form
    assert.equal(calculateCumulativeXpForLevel(14), 9100);
    assert.equal(calculateCumulativeXpForLevel(15), 10500);
    assert.equal(calculateCumulativeXpForLevel(20), 19000); // Celestial Form
  });

  it('accurately reconciles the five previously reported 30-day simulation XP totals', () => {
    // 1. Casual Developer (918 XP)
    const p1 = calculateLevelFromTotalXp(918);
    const p1Iter = addExperience(1, 0, 918);
    assert.equal(p1.level, 4);
    assert.equal(p1.currentXp, 318);
    assert.equal(p1.maxExp, 400);
    assert.equal(p1.xpRemaining, 82);
    assert.equal(p1.evolutionStage, 'Hatchling');
    assert.equal(p1Iter.newLevel, 4);
    assert.equal(p1Iter.newXp, 318);

    // 2. Click-Farmer (554 XP)
    const p2 = calculateLevelFromTotalXp(554);
    const p2Iter = addExperience(1, 0, 554);
    assert.equal(p2.level, 3);
    assert.equal(p2.currentXp, 254);
    assert.equal(p2.maxExp, 300);
    assert.equal(p2.xpRemaining, 46);
    assert.equal(p2.evolutionStage, 'Hatchling');
    assert.equal(p2Iter.newLevel, 3);
    assert.equal(p2Iter.newXp, 254);

    // 3. 10x Developer Capped (9,165 XP)
    const p3C = calculateLevelFromTotalXp(9165);
    const p3CIter = addExperience(1, 0, 9165);
    assert.equal(p3C.level, 14);
    assert.equal(p3C.currentXp, 65);
    assert.equal(p3C.maxExp, 1400);
    assert.equal(p3C.xpRemaining, 1335);
    assert.equal(p3C.evolutionStage, 'Ascended');
    assert.equal(p3CIter.newLevel, 14);
    assert.equal(p3CIter.newXp, 65);

    // 4. 10x Developer Uncapped (20,415 XP)
    const p3U = calculateLevelFromTotalXp(20415);
    const p3UIter = addExperience(1, 0, 20415);
    assert.equal(p3U.level, 20);
    assert.equal(p3U.currentXp, 1415);
    assert.equal(p3U.maxExp, 2000);
    assert.equal(p3U.xpRemaining, 585);
    assert.equal(p3U.evolutionStage, 'Celestial');
    assert.equal(p3UIter.newLevel, 20);
    assert.equal(p3UIter.newXp, 1415);

    // 5. Low-Activity Developer (372 XP)
    const p4 = calculateLevelFromTotalXp(372);
    const p4Iter = addExperience(1, 0, 372);
    assert.equal(p4.level, 3);
    assert.equal(p4.currentXp, 72);
    assert.equal(p4.maxExp, 300);
    assert.equal(p4.xpRemaining, 228);
    assert.equal(p4.evolutionStage, 'Hatchling');
    assert.equal(p4Iter.newLevel, 3);
    assert.equal(p4Iter.newXp, 72);

    // 6. 14-Day Inactive Developer (385 XP)
    const p5 = calculateLevelFromTotalXp(385);
    const p5Iter = addExperience(1, 0, 385);
    assert.equal(p5.level, 3);
    assert.equal(p5.currentXp, 85);
    assert.equal(p5.maxExp, 300);
    assert.equal(p5.xpRemaining, 215);
    assert.equal(p5.evolutionStage, 'Hatchling');
    assert.equal(p5Iter.newLevel, 3);
    assert.equal(p5Iter.newXp, 85);
  });

  it('handles XP addition with exact level-up and overflow carryover', () => {
    // Level 1 (needs 100 XP), currently 80 XP. Gains 50 XP -> Total 130 XP.
    // Result: Level 2, 30 XP remaining, maxExp 200.
    const res1 = addExperience(1, 80, 50);
    assert.equal(res1.didLevelUp, true);
    assert.equal(res1.newLevel, 2);
    assert.equal(res1.newXp, 30);
    assert.equal(res1.maxExp, 200);
    assert.equal(res1.levelsGained, 1);

    // Massive XP burst causing multiple level jumps:
    // Level 1 with 0 XP gains 350 XP:
    // Level 1: 100 XP -> Level 2 with 250 XP
    // Level 2: 200 XP -> Level 3 with 50 XP
    const res2 = addExperience(1, 0, 350);
    assert.equal(res2.didLevelUp, true);
    assert.equal(res2.newLevel, 3);
    assert.equal(res2.newXp, 50);
    assert.equal(res2.maxExp, 300);
    assert.equal(res2.levelsGained, 2);
  });

  it('clamps all vitals strictly to [0, 100]', () => {
    assert.equal(clampVital(-25), 0);
    assert.equal(clampVital(145), 100);
    assert.equal(clampVital(72.4), 72);
  });

  it('derives pet mood accurately from vital conditions', () => {
    assert.equal(deriveMood({ energy: 15, hunger: 80, happiness: 80 }), 'Resting');
    assert.equal(deriveMood({ energy: 50, hunger: 20, happiness: 80 }), 'Curious');
    assert.equal(deriveMood({ energy: 80, hunger: 80, happiness: 90 }), 'Energetic');
    assert.equal(deriveMood({ energy: 40, hunger: 50, happiness: 65 }), 'Happy');
    assert.equal(deriveMood({ energy: 40, hunger: 50, happiness: 45 }), 'Focused');
  });

  it('determines evolution stage and updates milestones correctly', () => {
    assert.equal(deriveEvolutionStage(1), 'Hatchling');
    assert.equal(deriveEvolutionStage(5), 'Juvenile');
    assert.equal(deriveEvolutionStage(10), 'Ascended');
    assert.equal(deriveEvolutionStage(20), 'Celestial');

    const milestonesLvl5 = getUpdatedMilestones(5);
    assert.equal(milestonesLvl5[0].unlocked, true); // Level 1
    assert.equal(milestonesLvl5[1].unlocked, true); // Level 5
    assert.equal(milestonesLvl5[2].unlocked, false); // Level 10
  });
});

describe('Gameplay Engine Execution & Validation Rules', () => {
  it('blocks training when energy is below cost (18)', () => {
    const pet = createBasePet({ energy: 10 });
    const result = executePetAction({
      pet,
      action: 'train',
      history: [],
      nowMs: 100_000,
    });

    assert.equal(result.success, false);
    assert.match(result.rejectedReason || '', /Insufficient Energy/);
    assert.equal(result.updatedPet.energy, 10);
  });

  it('blocks feeding when satiety is already full (100)', () => {
    const pet = createBasePet({ hunger: 100 });
    const result = executePetAction({
      pet,
      action: 'feed',
      history: [],
      nowMs: 100_000,
    });

    assert.equal(result.success, false);
    assert.match(result.rejectedReason || '', /Satiety Full/);
    assert.equal(result.updatedPet.hunger, 100);
  });

  it('rejects rapid actions triggered within cooldown threshold (<800ms)', () => {
    const pet = createBasePet();
    const history: ActionHistoryEntry[] = [{ action: 'pet', timestamp: 100_000 }];

    const result = executePetAction({
      pet,
      action: 'pet',
      history,
      nowMs: 100_500, // Only 500ms later (<800ms)
    });

    assert.equal(result.success, false);
    assert.match(result.rejectedReason || '', /Action Cooldown/);
  });

  it('executes REST action restoring energy without awarding XP', () => {
    const pet = createBasePet({ energy: 30, xp: 40 });
    const result = executePetAction({
      pet,
      action: 'rest',
      history: [],
      nowMs: 100_000,
    });

    assert.equal(result.success, true);
    assert.equal(result.reward?.expGained, 0);
    assert.equal(result.updatedPet.xp, 40); // XP unchanged
    assert.equal(result.updatedPet.energy, 55); // 30 + 25 = 55
  });

  it('executes valid TRAINING action, deducting fixed energy and applying XP', () => {
    const pet = createBasePet({ energy: 80, xp: 20 });
    const result = executePetAction({
      pet,
      action: 'train',
      history: [],
      nowMs: 100_000,
    });

    assert.equal(result.success, true);
    assert.equal(result.updatedPet.energy, 62); // 80 - 18 = 62
    assert.equal(result.updatedPet.xp, 50); // 20 + 30 = 50
    assert.equal(result.reward?.multiplier, 1.0);
  });

  it('restores resting energy passively over elapsed seconds', () => {
    const initialEnergy = 40;
    const { newEnergy, energyRestored } = calculateElapsedRestRecovery(10, initialEnergy);
    // 10s * 2 energy/sec = 20 energy
    assert.equal(energyRestored, 20);
    assert.equal(newEnergy, 60);
  });
});
