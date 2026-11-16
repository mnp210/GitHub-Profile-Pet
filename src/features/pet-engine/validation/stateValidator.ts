/**
 * GitHub Profile Pet - Pet State Document Validator
 * Strictly validates pet.json schema version, types, and bounds.
 */

import { ENGINE_SCHEMA_VERSION, MAX_VITAL_LIMIT, MIN_VITAL_LIMIT } from '../domain/constants.ts';
import type { EvolutionStage, PetMood, PetSpecies, PetStateDocument } from '../domain/types.ts';

const VALID_SPECIES: Set<PetSpecies> = new Set([
  'cat',
  'dragon',
  'fox',
  'slime',
  'shadow_claw',
  'ignis_ember',
  'kitsune_sol',
  'bloop_matrix',
]);

const VALID_MOODS: Set<PetMood> = new Set([
  'Energetic',
  'Happy',
  'Focused',
  'Curious',
  'Resting',
]);

const VALID_STAGES: Set<EvolutionStage> = new Set([
  'Hatchling',
  'Juvenile',
  'Ascended',
  'Celestial',
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function isValidIsoDateString(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const d = new Date(val);
  return !isNaN(d.getTime()) && val.includes('T');
}

export function validatePetState(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { valid: false, errors: ['State document must be a JSON object.'] };
  }

  const obj = data as Record<string, unknown>;

  if (obj.schemaVersion !== ENGINE_SCHEMA_VERSION) {
    errors.push(
      `Unsupported schemaVersion: expected ${ENGINE_SCHEMA_VERSION}, received ${String(obj.schemaVersion)}.`
    );
  }

  if (typeof obj.generation !== 'number' || !Number.isInteger(obj.generation) || obj.generation < 1) {
    errors.push(`generation must be a positive integer, received: ${String(obj.generation)}.`);
  }

  if (typeof obj.name !== 'string' || obj.name.trim().length === 0 || obj.name.length > 50) {
    errors.push(`name must be a non-empty string up to 50 characters.`);
  }

  if (typeof obj.species !== 'string' || !VALID_SPECIES.has(obj.species as PetSpecies)) {
    errors.push(`Invalid species: received ${String(obj.species)}.`);
  }

  if (typeof obj.level !== 'number' || !Number.isInteger(obj.level) || obj.level < 1 || obj.level > 100) {
    errors.push(`level must be an integer between 1 and 100, received: ${String(obj.level)}.`);
  }

  if (typeof obj.xp !== 'number' || !Number.isInteger(obj.xp) || obj.xp < 0) {
    errors.push(`xp must be a non-negative integer, received: ${String(obj.xp)}.`);
  }

  if (typeof obj.maxExp !== 'number' || !Number.isInteger(obj.maxExp) || obj.maxExp < 100) {
    errors.push(`maxExp must be an integer >= 100, received: ${String(obj.maxExp)}.`);
  }

  const vitals = ['energy', 'hunger', 'happiness'] as const;
  for (const vital of vitals) {
    const val = obj[vital];
    if (
      typeof val !== 'number' ||
      !Number.isInteger(val) ||
      val < MIN_VITAL_LIMIT ||
      val > MAX_VITAL_LIMIT
    ) {
      errors.push(
        `${vital} must be an integer between ${MIN_VITAL_LIMIT} and ${MAX_VITAL_LIMIT}, received: ${String(val)}.`
      );
    }
  }

  if (
    typeof obj.energyAccumulator !== 'number' ||
    Number.isNaN(obj.energyAccumulator) ||
    obj.energyAccumulator < 0 ||
    obj.energyAccumulator > 1
  ) {
    errors.push(
      `energyAccumulator must be a number between 0 and 1, received: ${String(obj.energyAccumulator)}.`
    );
  }

  if (
    obj.hungerDecayAccumulator !== undefined &&
    (typeof obj.hungerDecayAccumulator !== 'number' ||
      Number.isNaN(obj.hungerDecayAccumulator) ||
      obj.hungerDecayAccumulator < 0 ||
      obj.hungerDecayAccumulator > 1)
  ) {
    errors.push(
      `hungerDecayAccumulator must be a number between 0 and 1, received: ${String(obj.hungerDecayAccumulator)}.`
    );
  }

  if (
    obj.happinessDecayAccumulator !== undefined &&
    (typeof obj.happinessDecayAccumulator !== 'number' ||
      Number.isNaN(obj.happinessDecayAccumulator) ||
      obj.happinessDecayAccumulator < 0 ||
      obj.happinessDecayAccumulator > 1)
  ) {
    errors.push(
      `happinessDecayAccumulator must be a number between 0 and 1, received: ${String(obj.happinessDecayAccumulator)}.`
    );
  }

  if (typeof obj.mood !== 'string' || !VALID_MOODS.has(obj.mood as PetMood)) {
    errors.push(`Invalid mood: received ${String(obj.mood)}.`);
  }

  if (typeof obj.evolutionStage !== 'string' || !VALID_STAGES.has(obj.evolutionStage as EvolutionStage)) {
    errors.push(`Invalid evolutionStage: received ${String(obj.evolutionStage)}.`);
  }

  if (!isValidIsoDateString(obj.lastInteractionTime)) {
    errors.push(`lastInteractionTime must be a valid ISO-8601 UTC date string.`);
  }

  if (!isValidIsoDateString(obj.lastOfflineResolutionTime)) {
    errors.push(`lastOfflineResolutionTime must be a valid ISO-8601 UTC date string.`);
  }

  if (obj.lastSimulatedAt !== undefined && !isValidIsoDateString(obj.lastSimulatedAt)) {
    errors.push(`lastSimulatedAt must be a valid ISO-8601 UTC date string.`);
  }

  if (obj.lastWelcomeBonusClaimedAt !== null && !isValidIsoDateString(obj.lastWelcomeBonusClaimedAt)) {
    errors.push(`lastWelcomeBonusClaimedAt must be null or a valid ISO-8601 UTC date string.`);
  }

  if (!isValidIsoDateString(obj.updatedAt)) {
    errors.push(`updatedAt must be a valid ISO-8601 UTC date string.`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function assertValidPetState(data: unknown): asserts data is PetStateDocument {
  const result = validatePetState(data);
  if (!result.valid) {
    throw new Error(`Pet state validation failed:\n - ${result.errors.join('\n - ')}`);
  }
}
