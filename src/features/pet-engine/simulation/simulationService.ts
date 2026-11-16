/**
 * GitHub Profile Pet - Passive Pet Simulation Service
 * Coordinates time accounting, inactivity vitals progression, energy accumulation,
 * atomic repository persistence, crash recovery, and SVG publication.
 */

import type { PetMood, PetStateDocument } from '../domain/types.ts';
import {
  acquireLock,
  getStatePaths,
  loadRepositoryState,
  recoverRepositoryState,
  saveRepositoryState,
} from '../persistence/stateRepository.ts';
import { publishPetSvg } from '../publication/index.ts';
import { applyInactivitySimulation } from '../transitions/simulationTransitions.ts';
import { resolveSimulationCheckpoint } from './simulationCheckpoint.ts';
import type { SimulationOptions, SimulationResult } from './types.ts';

/**
 * Executes a deterministic passive simulation step for the pet.
 *
 * Guarantees:
 * 1. Safe Accounting: Elapsed time is strictly computed from durable checkpoint to UTC now.
 * 2. Clock Regression Safety: Rejects backward time jumps without corrupting checkpoints or vitals.
 * 3. Ethical Floors: Hunger never falls below 20; happiness never falls below 40.
 * 4. Fractional Energy: Accurately accumulates +0.05 energy/sec up to 100 with 6-decimal precision.
 * 5. Atomic Persistence: Commits updated pet state alongside synchronized ledger generations.
 * 6. Crash Resilience: Recovers uncommitted or committed journals prior to state mutation.
 * 7. Dry-Run Safety: `--dry-run` calculates and returns simulation telemetry with zero disk writes.
 * 8. Automatic Publication: Re-renders and publishes SVG badge when pet state changes.
 */
export async function simulatePet(options: SimulationOptions = {}): Promise<SimulationResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const paths = getStatePaths(baseDir);
  const nowMs = options.nowMs ?? Date.now();
  const isDryRun = options.dryRun === true;

  // 1. Acquire exclusive mutation lock (skipped in dry-run mode)
  const releaseLock = isDryRun ? null : await acquireLock(paths.lockPath);

  try {
    // 2. Recover any interrupted transactions from previous runs before reading
    if (releaseLock) {
      await recoverRepositoryState(baseDir, { lockOwnerId: releaseLock.ownerId });
    } else {
      await recoverRepositoryState(baseDir).catch(() => {});
    }

    // 3. Load authoritative repository state (verifies generation consistency)
    const state = await loadRepositoryState(baseDir, {
      lockOwnerId: releaseLock?.ownerId,
    });

    // 4. Resolve simulation checkpoint
    const checkpoint = resolveSimulationCheckpoint(state.pet, nowMs);

    // 5. Capture baseline metrics prior to simulation
    const checkpointBefore = checkpoint.checkpointIso;
    const energyBefore = state.pet.energy;
    const energyAccumulatorBefore = state.pet.energyAccumulator ?? 0;
    const hungerBefore = state.pet.hunger;
    const hungerDecayAccumulatorBefore = state.pet.hungerDecayAccumulator ?? 0;
    const happinessBefore = state.pet.happiness;
    const happinessDecayAccumulatorBefore = state.pet.happinessDecayAccumulator ?? 0;
    const moodBefore: PetMood = state.pet.mood;

    // 6. Apply inactivity simulation transitions
    const simResult = applyInactivitySimulation(state.pet, nowMs);

  // Case A: No elapsed time (or clock regression)
  if (simResult.elapsedSeconds <= 0) {
    let svgPublished = false;
    if (options.forcePublish && !isDryRun) {
      await publishPetSvg({ baseDir })
        .then((res) => {
          svgPublished = res.svgChanged || res.readmeChanged;
        })
        .catch(() => {});
    }

    return {
      simulated: false,
      elapsedSeconds: 0,
      checkpointBefore,
      checkpointAfter: checkpointBefore,
      energyBefore,
      energyAfter: energyBefore,
      energyRestored: 0,
      energyAccumulatorBefore,
      energyAccumulatorAfter: energyAccumulatorBefore,
      hungerBefore,
      hungerAfter: hungerBefore,
      hungerDecayed: 0,
      hungerDecayAccumulatorBefore,
      hungerDecayAccumulatorAfter: hungerDecayAccumulatorBefore,
      happinessBefore,
      happinessAfter: happinessBefore,
      happinessDecayed: 0,
      happinessDecayAccumulatorBefore,
      happinessDecayAccumulatorAfter: happinessDecayAccumulatorBefore,
      moodBefore,
      moodAfter: moodBefore,
      welcomeBackBonusEligible: simResult.welcomeBackBonusEligible,
      savedGeneration: state.generation,
      svgPublished,
      notes: simResult.notes,
    };
  }

  // Case B: Dry-run projection (no disk modification)
  const nextPet = simResult.nextPetState;
  const checkpointAfter = nextPet.lastSimulatedAt ?? new Date(nowMs).toISOString();

  if (isDryRun) {
    return {
      simulated: true,
      elapsedSeconds: simResult.elapsedSeconds,
      checkpointBefore,
      checkpointAfter,
      energyBefore,
      energyAfter: nextPet.energy,
      energyRestored: simResult.energyRestored,
      energyAccumulatorBefore,
      energyAccumulatorAfter: nextPet.energyAccumulator,
      hungerBefore,
      hungerAfter: nextPet.hunger,
      hungerDecayed: simResult.hungerDecayed,
      hungerDecayAccumulatorBefore,
      hungerDecayAccumulatorAfter: nextPet.hungerDecayAccumulator ?? 0,
      happinessBefore,
      happinessAfter: nextPet.happiness,
      happinessDecayed: simResult.happinessDecayed,
      happinessDecayAccumulatorBefore,
      happinessDecayAccumulatorAfter: nextPet.happinessDecayAccumulator ?? 0,
      moodBefore,
      moodAfter: nextPet.mood,
      welcomeBackBonusEligible: simResult.welcomeBackBonusEligible,
      savedGeneration: undefined,
      svgPublished: false,
      notes: 'Dry run: simulation calculated successfully without disk persistence.',
    };
  }

  // Case C: Standard execution with atomic repository persistence
  const nextGen = state.generation + 1;
  const persistentPet: PetStateDocument = {
    ...nextPet,
    generation: nextGen,
  };
  state.contributions.generation = nextGen;
  state.actions.generation = nextGen;

  await saveRepositoryState(
    baseDir,
    {
      pet: persistentPet,
      contributions: state.contributions,
      actions: state.actions,
    },
    {
      expectedGeneration: state.generation,
      existingLock: releaseLock ?? undefined,
    }
  );

  // 6. Safe SVG publication trigger
  let svgPublished = false;
  try {
    const pubResult = await publishPetSvg({ baseDir });
    svgPublished = pubResult.svgChanged || pubResult.readmeChanged;
  } catch (err) {
    console.warn(
      `[simulatePet] Warning: SVG publication failed after simulation: ${String(err)}`
    );
  }

  return {
    simulated: true,
    elapsedSeconds: simResult.elapsedSeconds,
    checkpointBefore,
    checkpointAfter,
    energyBefore,
    energyAfter: persistentPet.energy,
    energyRestored: simResult.energyRestored,
    energyAccumulatorBefore,
    energyAccumulatorAfter: persistentPet.energyAccumulator,
    hungerBefore,
    hungerAfter: persistentPet.hunger,
    hungerDecayed: simResult.hungerDecayed,
    hungerDecayAccumulatorBefore,
    hungerDecayAccumulatorAfter: persistentPet.hungerDecayAccumulator ?? 0,
    happinessBefore,
    happinessAfter: persistentPet.happiness,
    happinessDecayed: simResult.happinessDecayed,
    happinessDecayAccumulatorBefore,
    happinessDecayAccumulatorAfter: persistentPet.happinessDecayAccumulator ?? 0,
    moodBefore,
    moodAfter: persistentPet.mood,
    welcomeBackBonusEligible: simResult.welcomeBackBonusEligible,
    savedGeneration: nextGen,
    svgPublished,
    notes: simResult.notes,
  };
} finally {
  if (releaseLock) {
    await releaseLock();
  }
}
}
