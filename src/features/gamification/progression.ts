import type { PetMood } from '../../types/pet.ts';

/**
 * Level progression formulas:
 * 1. maxExp for level L = L * 100
 *    e.g. Level 1 -> 100 XP, Level 2 -> 200 XP, Level 3 -> 300 XP.
 * 2. Cumulative threshold to reach level L:
 *    TotalXP(L) = 50 * L * (L - 1)
 *    e.g. Lvl 1 -> 0 XP, Lvl 2 -> 100 XP, Lvl 5 -> 1,000 XP, Lvl 10 -> 4,500 XP, Lvl 20 -> 19,000 XP.
 */
export function calculateMaxExp(level: number): number {
  return Math.max(100, Math.floor(level) * 100);
}

/**
 * Cumulative total XP required to reach Level L from Level 1 (with 0 starting XP):
 * TotalXP(L) = 50 * L * (L - 1)
 */
export function calculateCumulativeXpForLevel(level: number): number {
  const l = Math.max(1, Math.floor(level));
  return 50 * l * (l - 1);
}

export interface LevelProgressionState {
  level: number;
  currentXp: number;
  maxExp: number;
  xpRemaining: number;
  totalXp: number;
  evolutionStage: string;
}

/**
 * Calculates exact level, current level XP, maxExp, and remaining XP from a total cumulative XP.
 * Derived directly from TotalXP(L) = 50 * L * (L - 1).
 */
export function calculateLevelFromTotalXp(totalXp: number): LevelProgressionState {
  const total = Math.max(0, Math.floor(totalXp));
  // Exact inverse of TotalXP(L) = 50 * L * (L - 1):
  // L = 0.5 + sqrt(0.25 + total / 50)
  const lExact = 0.5 + Math.sqrt(0.25 + total / 50);
  // Account for tiny floating point imprecision near exact boundaries
  const level = Math.max(1, Math.floor(lExact + 1e-9));

  const baseCumulative = calculateCumulativeXpForLevel(level);
  const currentXp = total - baseCumulative;
  const maxExp = calculateMaxExp(level);
  const xpRemaining = maxExp - currentXp;

  return {
    level,
    currentXp,
    maxExp,
    xpRemaining,
    totalXp: total,
    evolutionStage: deriveEvolutionStage(level),
  };
}

export interface ExperienceResult {
  newLevel: number;
  newXp: number;
  maxExp: number;
  didLevelUp: boolean;
  levelsGained: number;
}

/**
 * Deterministically adds XP, handling multi-level jumps and overflow carryover.
 */
export function addExperience(
  currentLevel: number,
  currentXp: number,
  expGained: number
): ExperienceResult {
  let level = Math.max(1, currentLevel);
  let xp = Math.max(0, currentXp) + Math.max(0, expGained);
  let didLevelUp = false;
  let levelsGained = 0;

  while (true) {
    const required = calculateMaxExp(level);
    if (xp >= required) {
      xp -= required;
      level += 1;
      didLevelUp = true;
      levelsGained += 1;
    } else {
      break;
    }
  }

  return {
    newLevel: level,
    newXp: xp,
    maxExp: calculateMaxExp(level),
    didLevelUp,
    levelsGained,
  };
}

/**
 * Clamps a vital stat to [0, 100].
 */
export function clampVital(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Derives pet mood deterministically from vitals (energy, hunger/satiety, happiness).
 */
export function deriveMood(vitals: { energy: number; hunger: number; happiness: number }): PetMood {
  const { energy, hunger, happiness } = vitals;

  if (energy <= 20) {
    return 'Resting';
  }
  if (hunger <= 25) {
    return 'Curious';
  }
  if (happiness >= 80 && energy >= 50) {
    return 'Energetic';
  }
  if (happiness >= 60) {
    return 'Happy';
  }
  return 'Focused';
}

/**
 * Evolution stages based on level milestones:
 * Level 1-4: Hatchling
 * Level 5-9: Juvenile
 * Level 10-19: Ascended
 * Level 20+: Celestial
 */
export function deriveEvolutionStage(level: number): string {
  if (level >= 20) return 'Celestial';
  if (level >= 10) return 'Ascended';
  if (level >= 5) return 'Juvenile';
  return 'Hatchling';
}

export interface MilestoneProgress {
  stage: number;
  title: string;
  requiredLevel: number;
  unlocked: boolean;
  description: string;
}

export const EVOLUTION_MILESTONES: MilestoneProgress[] = [
  { stage: 1, title: 'Hatchling', requiredLevel: 1, unlocked: true, description: 'Freshly summoned pixel companion.' },
  { stage: 2, title: 'Juvenile Form', requiredLevel: 5, unlocked: false, description: 'Increased aura radius and glowing pixel accents.' },
  { stage: 3, title: 'Ascended Form', requiredLevel: 10, unlocked: false, description: 'Resonant soundwave effects and expanded companion stats.' },
  { stage: 4, title: 'Celestial Form', requiredLevel: 20, unlocked: false, description: 'Legendary particle crown and maximum aura mastery.' },
];

export function getUpdatedMilestones(level: number): MilestoneProgress[] {
  return EVOLUTION_MILESTONES.map((milestone) => ({
    ...milestone,
    unlocked: level >= milestone.requiredLevel,
  }));
}
