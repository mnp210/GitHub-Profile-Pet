/**
 * GitHub Profile Pet - Standalone SVG Vector Generation Engine
 * Authoritative public entry point for pure, deterministic SVG rendering.
 */

import type { PetStateDocument } from '../domain/types.ts';
import { assertValidPetState } from '../validation/stateValidator.ts';
import { renderPetCard } from './petCardRenderer.ts';
import { buildSvgDocument } from './svgDocument.ts';
import { assertValidSvgOutput } from './svgValidation.ts';
import type { PetActivityState, RenderSvgOptions } from './types.ts';

const VALID_ACTIVITIES = new Set<PetActivityState>([
  'idle',
  'sleeping',
  'eating',
  'training',
  'happy',
  'tired',
]);

/**
 * Derives a deterministic activity state from pet vitals and mood
 * when not explicitly specified in rendering options.
 */
export function inferPetActivity(pet: PetStateDocument): PetActivityState {
  if (pet.energy <= 15) {
    return 'tired';
  }
  if (pet.mood === 'Resting') {
    return 'sleeping';
  }
  if (pet.mood === 'Happy') {
    return 'happy';
  }
  return 'idle';
}

/**
 * Pure, deterministic SVG rendering function.
 * Transforms a validated pet-state document into a self-contained,
 * GitHub README-compatible SVG graphic.
 *
 * Guaranteed properties:
 * - Deterministic: Identical inputs produce byte-identical SVG output.
 * - Non-mutating: The input pet state is never modified.
 * - Standalone: Zero filesystem, network, or external dependencies.
 * - Safe: Enforces XML escaping and rejects all forbidden SVG elements and scripts.
 */
export function renderPetSvg(pet: PetStateDocument, options?: RenderSvgOptions): string {
  // 1. Strict input validation
  assertValidPetState(pet);

  // 2. Resolve activity state
  let activity: PetActivityState;
  if (options?.activity) {
    if (!VALID_ACTIVITIES.has(options.activity)) {
      throw new Error(`Invalid render activity state: '${String(options.activity)}'.`);
    }
    activity = options.activity;
  } else {
    activity = inferPetActivity(pet);
  }

  // 3. Resolve options with deterministic defaults
  const theme = options?.theme ?? 'dark';
  const width = options?.width ?? 450;
  const height = options?.height ?? 200;
  const title = options?.title ?? `${pet.name} — GitHub Profile Pet`;
  const description =
    options?.description ??
    `${pet.name} is a Level ${pet.level} ${pet.species} companion in ${pet.evolutionStage} stage. Current Mood: ${pet.mood}. Energy: ${pet.energy}%, Satiety: ${pet.hunger}%, Happiness: ${pet.happiness}%.`;

  // 4. Render Card Content
  const cardContent = renderPetCard(pet, activity, {
    ...options,
    theme,
    width,
    height,
  });

  // 5. Build Complete SVG Document
  const svgOutput = buildSvgDocument(cardContent, {
    width,
    height,
    title,
    description,
    theme,
  });

  // 6. Security & Structural Output Validation
  assertValidSvgOutput(svgOutput);

  return svgOutput;
}
