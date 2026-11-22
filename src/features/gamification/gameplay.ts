import type { PetState } from '../../types/pet.ts';
import {
  type ActionHistoryEntry,
  type ActionType,
  ACTION_COOLDOWN_MS,
  calculateActionReward,
  type CalculatedReward,
  pruneExpiredActions,
} from './rewards.ts';
import {
  addExperience,
  clampVital,
  deriveEvolutionStage,
  deriveMood,
  getUpdatedMilestones,
  type MilestoneProgress,
} from './progression.ts';
import { applyRestAction } from './recovery.ts';
import { getSpeciesReaction } from './speciesReactions.ts';

export interface ActionResult {
  success: boolean;
  rejectedReason?: string;
  updatedPet: PetState;
  updatedHistory: ActionHistoryEntry[];
  reward?: CalculatedReward;
  reaction: string;
  didLevelUp: boolean;
  levelsGained: number;
  milestones: MilestoneProgress[];
  actionCooldownRemainingMs?: number;
}

export const TRAINING_ENERGY_COST = 18;
export const MAX_SATIETY_LIMIT = 100;

/**
 * Validates and executes an action on the virtual pet, returning updated state,
 * diminished rewards, reactions, and validation error messages.
 */
export function executePetAction(params: {
  pet: PetState;
  action: ActionType;
  history: ActionHistoryEntry[];
  nowMs: number;
  cooldownMs?: number;
}): ActionResult {
  const { pet, action, history, nowMs, cooldownMs = ACTION_COOLDOWN_MS } = params;

  // 1. Cooldown Check: Ensure actions are not triggered faster than cooldown
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  if (lastEntry && nowMs - lastEntry.timestamp < cooldownMs) {
    const elapsed = nowMs - lastEntry.timestamp;
    const remaining = cooldownMs - elapsed;
    return {
      success: false,
      rejectedReason: `Action Cooldown: Please wait ${Math.ceil(remaining / 100) / 10}s before next action.`,
      updatedPet: { ...pet },
      updatedHistory: history,
      reaction: 'Paws are busy — catch your breath!',
      didLevelUp: false,
      levelsGained: 0,
      milestones: getUpdatedMilestones(pet.level),
      actionCooldownRemainingMs: remaining,
    };
  }

  // 2. Action Pre-condition Validation
  if (action === 'train' && pet.energy < TRAINING_ENERGY_COST) {
    return {
      success: false,
      rejectedReason: `Insufficient Energy: Training requires ${TRAINING_ENERGY_COST} energy (currently ${pet.energy}). Use REST first.`,
      updatedPet: { ...pet },
      updatedHistory: history,
      reaction: getSpeciesReaction(pet.species, 'exhausted'),
      didLevelUp: false,
      levelsGained: 0,
      milestones: getUpdatedMilestones(pet.level),
    };
  }

  if (action === 'play' && pet.energy < 10) {
    return {
      success: false,
      rejectedReason: `Insufficient Energy: Playing requires 10 energy (currently ${pet.energy}). Use REST first.`,
      updatedPet: { ...pet },
      updatedHistory: history,
      reaction: getSpeciesReaction(pet.species, 'exhausted'),
      didLevelUp: false,
      levelsGained: 0,
      milestones: getUpdatedMilestones(pet.level),
    };
  }

  if (action === 'feed' && pet.hunger >= MAX_SATIETY_LIMIT) {
    return {
      success: false,
      rejectedReason: `Satiety Full: Pet is at maximum fullness (${pet.hunger}/${MAX_SATIETY_LIMIT}). Train or play to build appetite.`,
      updatedPet: { ...pet },
      updatedHistory: history,
      reaction: getSpeciesReaction(pet.species, 'full'),
      didLevelUp: false,
      levelsGained: 0,
      milestones: getUpdatedMilestones(pet.level),
    };
  }

  // 3. Calculate Diminishing Returns for Reward Yields
  const reward = calculateActionReward(action, history, nowMs);

  // 4. Update History (Prune expired actions > 60s, append current action)
  const prunedHistory = pruneExpiredActions(history, nowMs);
  const updatedHistory: ActionHistoryEntry[] = [
    ...prunedHistory,
    { action, timestamp: nowMs },
  ];

  // 5. Apply Vitals Changes
  let newEnergy = pet.energy;
  let newHunger = pet.hunger;
  let newHappiness = pet.happiness;

  if (action === 'rest') {
    const restResult = applyRestAction(pet.energy);
    newEnergy = restResult.newEnergy;
    newHappiness = clampVital(pet.happiness + reward.happinessGained);
  } else {
    newEnergy = clampVital(pet.energy - reward.energyCost);
    newHunger = clampVital(pet.hunger + reward.hungerGained);
    newHappiness = clampVital(pet.happiness + reward.happinessGained);
  }

  // 6. Experience & Level Progression
  const expResult = addExperience(pet.level, pet.xp, reward.expGained);
  const newEvolutionStage = deriveEvolutionStage(expResult.newLevel);
  const updatedMilestones = getUpdatedMilestones(expResult.newLevel);

  // 7. Derive Mood from new vitals
  const newMood = deriveMood({
    energy: newEnergy,
    hunger: newHunger,
    happiness: newHappiness,
  });

  // 8. Reaction text
  const reaction = expResult.didLevelUp
    ? getSpeciesReaction(pet.species, 'level_up')
    : getSpeciesReaction(pet.species, action);

  const updatedPet: PetState = {
    ...pet,
    level: expResult.newLevel,
    xp: expResult.newXp,
    maxExp: expResult.maxExp,
    energy: newEnergy,
    hunger: newHunger,
    happiness: newHappiness,
    mood: newMood,
    evolutionStage: newEvolutionStage,
  };

  return {
    success: true,
    updatedPet,
    updatedHistory,
    reward,
    reaction,
    didLevelUp: expResult.didLevelUp,
    levelsGained: expResult.levelsGained,
    milestones: updatedMilestones,
  };
}
