/**
 * GitHub Profile Pet - Passive Simulation CLI Script
 * Advances pet vitals based on elapsed time, applies offline recovery and decay,
 * commits updated state atomically, and updates the published SVG.
 *
 * Usage:
 *   node --experimental-strip-types scripts/simulate-pet.ts [--dry-run] [--base-dir <dir>] [--now <ms|iso>]
 */

import { simulatePet } from '../src/features/pet-engine/simulation/index.ts';

function parseArgs(args: string[]): {
  dryRun: boolean;
  baseDir?: string;
  nowMs?: number;
  forcePublish: boolean;
} {
  let dryRun = false;
  let baseDir: string | undefined;
  let nowMs: number | undefined;
  let forcePublish = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--force-publish') {
      forcePublish = true;
    } else if (arg === '--base-dir' && i + 1 < args.length) {
      baseDir = args[++i];
    } else if (arg === '--now' && i + 1 < args.length) {
      const val = args[++i];
      const parsed = isNaN(Number(val)) ? new Date(val).getTime() : Number(val);
      if (!isNaN(parsed)) {
        nowMs = parsed;
      }
    }
  }

  return { dryRun, baseDir, nowMs, forcePublish };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  console.log('[simulate-pet] Starting passive pet simulation...');
  if (options.dryRun) {
    console.log('[simulate-pet] Mode: DRY RUN (no disk writes or state updates)');
  }

  const result = await simulatePet({
    baseDir: options.baseDir,
    dryRun: options.dryRun,
    nowMs: options.nowMs,
    forcePublish: options.forcePublish,
  });

  console.log(`[simulate-pet] Simulation Status: ${result.simulated ? 'ADVANCED' : 'NO-OP'}`);
  console.log(`[simulate-pet] Elapsed Time: ${result.elapsedSeconds}s`);
  console.log(`[simulate-pet] Checkpoint: ${result.checkpointBefore} -> ${result.checkpointAfter}`);
  console.log(
    `[simulate-pet] Energy: ${result.energyBefore} -> ${result.energyAfter} (+${result.energyRestored}, accumulator: ${result.energyAccumulatorBefore} -> ${result.energyAccumulatorAfter})`
  );
  console.log(
    `[simulate-pet] Hunger: ${result.hungerBefore} -> ${result.hungerAfter} (-${result.hungerDecayed}, accumulator: ${result.hungerDecayAccumulatorBefore ?? 0} -> ${result.hungerDecayAccumulatorAfter ?? 0})`
  );
  console.log(
    `[simulate-pet] Happiness: ${result.happinessBefore} -> ${result.happinessAfter} (-${result.happinessDecayed}, accumulator: ${result.happinessDecayAccumulatorBefore ?? 0} -> ${result.happinessDecayAccumulatorAfter ?? 0})`
  );
  console.log(`[simulate-pet] Mood: ${result.moodBefore} -> ${result.moodAfter}`);
  console.log(`[simulate-pet] Welcome-Back Bonus Eligible: ${result.welcomeBackBonusEligible}`);

  if (result.savedGeneration !== undefined) {
    console.log(`[simulate-pet] Repository State Committed (Generation ${result.savedGeneration})`);
  }
  console.log(`[simulate-pet] SVG Published: ${result.svgPublished ? 'YES' : 'NO'}`);
  console.log(`[simulate-pet] Summary: ${result.notes}`);
}

main().catch((err) => {
  console.error('::error::[simulate-pet] Simulation failed:', err);
  process.exit(1);
});
