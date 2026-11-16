/**
 * GitHub Profile Pet - Simulation Checkpoint Resolver & Recovery Manager
 * Authoritative checkpoint validation, migration, precedence resolution, and fail-closed corruption safety.
 */

import type { PetStateDocument } from '../domain/types.ts';

export type CheckpointSource =
  | 'lastSimulatedAt'
  | 'lastOfflineResolutionTime'
  | 'updatedAt'
  | 'initialization_now';

export interface ResolvedSimulationCheckpoint {
  checkpointIso: string;
  checkpointMs: number;
  source: CheckpointSource;
}

/**
 * Structured recoverable error thrown when an existing pet state document lacks
 * any trustworthy UTC timestamp and cannot safely determine elapsed time.
 * Failing closed prevents arbitrary time jumps and preserves disk state for operator audit.
 */
export class CorruptedCheckpointError extends Error {
  readonly petName: string;
  readonly generation: number;
  readonly lastSimulatedAt?: unknown;
  readonly lastOfflineResolutionTime?: unknown;
  readonly updatedAt?: unknown;
  readonly details: string;

  constructor(params: {
    petName: string;
    generation: number;
    lastSimulatedAt?: unknown;
    lastOfflineResolutionTime?: unknown;
    updatedAt?: unknown;
    details: string;
  }) {
    super(
      `CorruptedCheckpointError: No trustworthy timestamp exists for pet "${params.petName}" (generation ${params.generation}).\n` +
        `Details: ${params.details}\n` +
        ` - lastSimulatedAt: ${String(params.lastSimulatedAt)}\n` +
        ` - lastOfflineResolutionTime: ${String(params.lastOfflineResolutionTime)}\n` +
        ` - updatedAt: ${String(params.updatedAt)}\n` +
        `Failing closed to preserve original state on disk for operator inspection.`
    );
    this.name = 'CorruptedCheckpointError';
    this.petName = params.petName;
    this.generation = params.generation;
    this.lastSimulatedAt = params.lastSimulatedAt;
    this.lastOfflineResolutionTime = params.lastOfflineResolutionTime;
    this.updatedAt = params.updatedAt;
    this.details = params.details;
  }
}

/**
 * Validates that a string is a strict, well-formed ISO-8601 UTC date representation.
 * Must include 'T' separator, explicit UTC timezone ('Z', '+00:00', or '-00:00'),
 * and parse into a valid non-NaN epoch timestamp.
 */
export function isValidUtcIsoDateString(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed.includes('T')) return false;

  // Strict UTC representation check: must explicitly declare UTC timezone
  const isUtcDesignated =
    trimmed.endsWith('Z') ||
    trimmed.endsWith('+00:00') ||
    trimmed.endsWith('-00:00');

  if (!isUtcDesignated) return false;

  const d = new Date(trimmed);
  return !isNaN(d.getTime());
}

/**
 * Determines whether a pet state represents a fresh new installation.
 * A new installation is unevolved, generation 1, level 1, and has 0 XP.
 */
export function isNewInstallation(pet: PetStateDocument): boolean {
  return (
    pet.generation <= 1 &&
    (pet.level ?? 1) === 1 &&
    (pet.xp ?? 0) === 0 &&
    pet.evolutionStage === 'Hatchling'
  );
}

/**
 * Resolves the authoritative simulation checkpoint timestamp from a pet state document.
 *
 * Precedence & Migration Policy:
 * 1. Existing states with valid `lastSimulatedAt` (Phase 3C1 durable checkpoint).
 * 2. Legacy states with valid `lastOfflineResolutionTime` (Phase 1 / Phase 3B baseline).
 * 3. Legacy states with valid `updatedAt` (General fallback).
 * 4. New installations: If no timestamp exists, initialize safely to `nowMs` (documented policy).
 * 5. Existing installations with missing or corrupted timestamps:
 *    FAIL CLOSED by throwing `CorruptedCheckpointError`. Never silently invent timestamps or
 *    substitute `nowMs` on corrupted existing state.
 */
export function resolveSimulationCheckpoint(
  pet: PetStateDocument,
  nowMs: number = Date.now()
): ResolvedSimulationCheckpoint {
  // 1. Authoritative Phase 3C1 Checkpoint
  if (pet.lastSimulatedAt !== undefined && pet.lastSimulatedAt !== null) {
    if (isValidUtcIsoDateString(pet.lastSimulatedAt)) {
      const ms = new Date(pet.lastSimulatedAt).getTime();
      return {
        checkpointIso: pet.lastSimulatedAt,
        checkpointMs: ms,
        source: 'lastSimulatedAt',
      };
    }
    // If lastSimulatedAt is present but invalid/corrupted, continue to legacy fallbacks
  }

  // 2. Legacy Phase 1 / Phase 3B Offline Resolution Checkpoint
  if (pet.lastOfflineResolutionTime !== undefined && pet.lastOfflineResolutionTime !== null) {
    if (isValidUtcIsoDateString(pet.lastOfflineResolutionTime)) {
      const ms = new Date(pet.lastOfflineResolutionTime).getTime();
      return {
        checkpointIso: pet.lastOfflineResolutionTime,
        checkpointMs: ms,
        source: 'lastOfflineResolutionTime',
      };
    }
  }

  // 3. General Last Updated Checkpoint
  if (pet.updatedAt !== undefined && pet.updatedAt !== null) {
    if (isValidUtcIsoDateString(pet.updatedAt)) {
      const ms = new Date(pet.updatedAt).getTime();
      return {
        checkpointIso: pet.updatedAt,
        checkpointMs: ms,
        source: 'updatedAt',
      };
    }
  }

  // 4. New Installation Documented Initialization Policy
  if (isNewInstallation(pet)) {
    const initIso = new Date(nowMs).toISOString();
    return {
      checkpointIso: initIso,
      checkpointMs: nowMs,
      source: 'initialization_now',
    };
  }

  // 5. Existing Installation with Corrupted or Missing Checkpoint -> FAIL CLOSED
  throw new CorruptedCheckpointError({
    petName: pet.name,
    generation: pet.generation,
    lastSimulatedAt: pet.lastSimulatedAt,
    lastOfflineResolutionTime: pet.lastOfflineResolutionTime,
    updatedAt: pet.updatedAt,
    details:
      'Existing pet state contains missing, non-UTC, or malformed checkpoint timestamps with no trustworthy fallback.',
  });
}
