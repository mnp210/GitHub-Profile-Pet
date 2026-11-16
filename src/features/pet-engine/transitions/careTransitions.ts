/**
 * GitHub Profile Pet - Care Action Transitions
 * Pure deterministic state transition engine for feed, train, rest, and pet actions.
 */

import type { SpeciesId } from '../../../types/pet.ts';
import { getSpeciesReaction } from '../../gamification/speciesReactions.ts';
import {
  ACTION_COOLDOWN_MS,
  BASE_ACTION_REWARDS,
  DIMINISHING_MULTIPLIERS,
  INACTIVITY_HAPPINESS_FLOOR,
  INACTIVITY_HUNGER_FLOOR,
  MAX_SATIETY_LIMIT,
  REST_ENERGY_RESTORE_PER_ACTION,
  ROLLING_ACTION_WINDOW_MS,
  TRAINING_ENERGY_COST,
} from '../domain/constants.ts';
import type {
  CareActionType,
  PetSpecies,
  PetStateDocument,
  RecentActionEntry,
  TransitionOutcome,
} from '../domain/types.ts';
import {
  applyExperience,
  clampVital,
  derivePetMoodFromVitals,
} from './progressionEngine.ts';

export interface CareTransitionResult {
  nextPetState: PetStateDocument;
  nextRecentActions: RecentActionEntry[];
  outcome: TransitionOutcome;
}

function normalizeSpeciesId(species: PetSpecies): SpeciesId {
  switch (species) {
    case 'shadow_claw':
      return 'cat';
    case 'ignis_ember':
      return 'dragon';
    case 'kitsune_sol':
      return 'fox';
    case 'bloop_matrix':
      return 'slime';
    default:
      return species as SpeciesId;
  }
}

export function pruneRecentActions(
  actions: RecentActionEntry[],
  nowMs: number,
  windowMs: number = ROLLING_ACTION_WINDOW_MS
): RecentActionEntry[] {
  const cutoff = nowMs - windowMs;
  return actions.filter((entry) => entry.timestamp >= cutoff);
}

export function executeCareAction(params: {
  pet: PetStateDocument;
  action: CareActionType;
  history: RecentActionEntry[];
  nowMs: number;
  requestId: string;
}): CareTransitionResult {
  const { pet, action, history, nowMs, requestId } = params;
  const speciesId = normalizeSpeciesId(pet.species);

  // 0. Stale Event Check: eventTimestampMs must not be older than pet.lastInteractionTime
  const lastInteractionMs = new Date(pet.lastInteractionTime).getTime();
  if (nowMs < lastInteractionMs) {
    return {
      nextPetState: { ...pet },
      nextRecentActions: [...history],
      outcome: {
        success: false,
        rejectedReason: `Stale Action: Event timestamp (${new Date(nowMs).toISOString()}) is older than last interaction time (${pet.lastInteractionTime}). Actions must be processed in chronological sequence.`,
        reaction: 'Time moves forward, not backward!',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
        diminishingMultiplier: 0,
      },
    };
  }

  // 1. Cooldown Enforcement: 60 seconds strict between care actions
  const lastEntry = history.length > 0 ? history[history.length - 1] : null;
  if (lastEntry && nowMs - lastEntry.timestamp < ACTION_COOLDOWN_MS) {
    const elapsed = nowMs - lastEntry.timestamp;
    const remaining = ACTION_COOLDOWN_MS - elapsed;
    return {
      nextPetState: { ...pet },
      nextRecentActions: [...history],
      outcome: {
        success: false,
        rejectedReason: `Action Cooldown: Please wait ${Math.ceil(remaining / 1000)}s before next action.`,
        reaction: 'Paws are busy — catch your breath!',
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
        diminishingMultiplier: 0,
      },
    };
  }

  // 2. Pre-condition Validations
  if (action === 'train' && pet.energy < TRAINING_ENERGY_COST) {
    return {
      nextPetState: { ...pet },
      nextRecentActions: [...history],
      outcome: {
        success: false,
        rejectedReason: `Insufficient Energy: Training requires ${TRAINING_ENERGY_COST} energy (currently ${pet.energy}). Use REST first.`,
        reaction: getSpeciesReaction(speciesId, 'exhausted'),
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
        diminishingMultiplier: 0,
      },
    };
  }

  if (action === 'feed' && pet.hunger >= MAX_SATIETY_LIMIT) {
    return {
      nextPetState: { ...pet },
      nextRecentActions: [...history],
      outcome: {
        success: false,
        rejectedReason: `Satiety Full: Pet is at maximum fullness (${pet.hunger}/${MAX_SATIETY_LIMIT}). Train or wait to build appetite.`,
        reaction: getSpeciesReaction(speciesId, 'full'),
        xpGained: 0,
        didLevelUp: false,
        levelsGained: 0,
        diminishingMultiplier: 0,
      },
    };
  }

  // 3. Diminishing Returns Evaluation within rolling 60s window
  const activeHistory = pruneRecentActions(history, nowMs);
  const actionCount = activeHistory.filter((e) => e.action === action).length;
  const multIndex = Math.min(actionCount, DIMINISHING_MULTIPLIERS.length - 1);
  const multiplier = DIMINISHING_MULTIPLIERS[multIndex];

  const base = BASE_ACTION_REWARDS[action];
  const xpGained = action === 'rest' ? 0 : Math.max(0, Math.round(base.baseExp * multiplier));
  const happinessGained = Math.max(0, Math.round(base.baseHappiness * multiplier));
  const hungerGained = Math.max(0, Math.round(base.baseHunger * multiplier));

  // 4. Compute New Vitals
  let newEnergy = pet.energy;
  let newHunger = pet.hunger;
  let newHappiness = pet.happiness;

  if (action === 'rest') {
    newEnergy = clampVital(pet.energy + REST_ENERGY_RESTORE_PER_ACTION);
    newHappiness = clampVital(pet.happiness + happinessGained);
  } else {
    newEnergy = clampVital(pet.energy - base.energyCost);
    newHunger = clampVital(pet.hunger + hungerGained);
    newHappiness = clampVital(pet.happiness + happinessGained);
  }

  // 5. XP and Level Progression
  const progResult = applyExperience(pet.level, pet.xp, xpGained);
  const newMood = derivePetMoodFromVitals({
    energy: newEnergy,
    hunger: newHunger,
    happiness: newHappiness,
  });

  const nextIso = new Date(nowMs).toISOString();
  const nextAccumulator =
    newEnergy >= 100 ? 0 : (pet.energyAccumulator && !Number.isNaN(pet.energyAccumulator) ? pet.energyAccumulator : 0);

  const nextHungerAccumulator =
    newHunger <= INACTIVITY_HUNGER_FLOOR
      ? 0
      : (typeof pet.hungerDecayAccumulator === 'number' && !Number.isNaN(pet.hungerDecayAccumulator)
          ? pet.hungerDecayAccumulator
          : 0);

  const nextHappinessAccumulator =
    newHappiness <= INACTIVITY_HAPPINESS_FLOOR
      ? 0
      : (typeof pet.happinessDecayAccumulator === 'number' && !Number.isNaN(pet.happinessDecayAccumulator)
          ? pet.happinessDecayAccumulator
          : 0);

  // Monotonic Checkpoints: care actions must never rewind durable checkpoints or timestamps into the past
  const existingSimMs = pet.lastSimulatedAt ? new Date(pet.lastSimulatedAt).getTime() : 0;
  const nextSimulatedIso = existingSimMs > nowMs ? pet.lastSimulatedAt : nextIso;

  const existingOfflineMs = pet.lastOfflineResolutionTime ? new Date(pet.lastOfflineResolutionTime).getTime() : 0;
  const nextOfflineIso = existingOfflineMs > nowMs ? pet.lastOfflineResolutionTime : nextIso;

  const existingInteractionMs = pet.lastInteractionTime ? new Date(pet.lastInteractionTime).getTime() : 0;
  const nextInteractionIso = existingInteractionMs > nowMs ? pet.lastInteractionTime : nextIso;

  const existingUpdatedMs = pet.updatedAt ? new Date(pet.updatedAt).getTime() : 0;
  const nextUpdatedIso = existingUpdatedMs > nowMs ? pet.updatedAt : nextIso;

  const nextPetState: PetStateDocument = {
    ...pet,
    generation: pet.generation + 1,
    level: progResult.newLevel,
    xp: progResult.newXp,
    maxExp: progResult.newMaxExp,
    evolutionStage: progResult.newEvolutionStage,
    energy: newEnergy,
    energyAccumulator: nextAccumulator,
    hunger: newHunger,
    hungerDecayAccumulator: nextHungerAccumulator,
    happiness: newHappiness,
    happinessDecayAccumulator: nextHappinessAccumulator,
    mood: newMood,
    lastInteractionTime: nextInteractionIso,
    lastOfflineResolutionTime: nextOfflineIso,
    lastSimulatedAt: nextSimulatedIso,
    updatedAt: nextUpdatedIso,
  };

  const nextRecentActions: RecentActionEntry[] = [
    ...activeHistory,
    { action, timestamp: nowMs, requestId },
  ];

  const reaction = progResult.didLevelUp
    ? getSpeciesReaction(speciesId, 'level_up')
    : getSpeciesReaction(speciesId, action);

  return {
    nextPetState,
    nextRecentActions,
    outcome: {
      success: true,
      reaction,
      xpGained,
      didLevelUp: progResult.didLevelUp,
      levelsGained: progResult.levelsGained,
      diminishingMultiplier: multiplier,
    },
  };
}
