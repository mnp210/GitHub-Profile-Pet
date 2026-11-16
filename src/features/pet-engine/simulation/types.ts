/**
 * GitHub Profile Pet - Passive Pet Simulation Types
 * Defines options, telemetry models, and results for passive background simulation.
 */

import type { PetMood } from '../domain/types.ts';

export interface SimulationOptions {
  /** Root directory for repository state (defaults to process.cwd()) */
  baseDir?: string;
  /** Custom UTC execution timestamp in milliseconds (defaults to Date.now()) */
  nowMs?: number;
  /** When true, calculates simulation outcomes without persisting to disk or updating SVG */
  dryRun?: boolean;
  /** When true, forces SVG re-publication even if vitals were unchanged */
  forcePublish?: boolean;
}

export interface SimulationResult {
  /** Whether passive simulation actually occurred and changed pet state or checkpoint */
  simulated: boolean;
  /** Total elapsed seconds since the previous simulation checkpoint */
  elapsedSeconds: number;
  /** ISO-8601 UTC timestamp of the checkpoint prior to simulation */
  checkpointBefore: string;
  /** ISO-8601 UTC timestamp of the checkpoint after simulation */
  checkpointAfter: string;
  /** Energy before simulation */
  energyBefore: number;
  /** Energy after simulation */
  energyAfter: number;
  /** Total energy restored during this interval */
  energyRestored: number;
  /** Fractional energy accumulator before simulation */
  energyAccumulatorBefore: number;
  /** Fractional energy accumulator after simulation */
  energyAccumulatorAfter: number;
  /** Hunger (satiety) before simulation */
  hungerBefore: number;
  /** Hunger (satiety) after simulation */
  hungerAfter: number;
  /** Total hunger decayed during this interval */
  hungerDecayed: number;
  /** Fractional hunger decay accumulator before simulation */
  hungerDecayAccumulatorBefore?: number;
  /** Fractional hunger decay accumulator after simulation */
  hungerDecayAccumulatorAfter?: number;
  /** Happiness before simulation */
  happinessBefore: number;
  /** Happiness after simulation */
  happinessAfter: number;
  /** Total happiness decayed during this interval */
  happinessDecayed: number;
  /** Fractional happiness decay accumulator before simulation */
  happinessDecayAccumulatorBefore?: number;
  /** Fractional happiness decay accumulator after simulation */
  happinessDecayAccumulatorAfter?: number;
  /** Mood before simulation */
  moodBefore: PetMood;
  /** Mood after simulation */
  moodAfter: PetMood;
  /** Whether the pet is eligible for the welcome-back bonus claim */
  welcomeBackBonusEligible: boolean;
  /** Committed generation number, or undefined if dryRun or no-op */
  savedGeneration?: number;
  /** Whether SVG/README publication was performed */
  svgPublished: boolean;
  /** Descriptive execution summary or notes */
  notes: string;
}
