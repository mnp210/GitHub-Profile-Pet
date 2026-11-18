/**
 * GitHub Profile Pet — Safe Git Publication Pipeline CLI Script (Phase 3C2.2.4)
 *
 * Coordinates end-to-end contribution synchronization, pet simulation,
 * state persistence, SVG badge rendering, manifest verification, and atomic
 * fast-forward Git publication.
 *
 * Usage:
 *   node --experimental-strip-types scripts/publish-pipeline.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>]
 */

import { runPublicationPipeline } from '../src/features/pet-engine/publication/index.ts';

export function parseArgs(args: string[]): {
  refName?: string;
  gitRemote?: string;
  dryRun: boolean;
  skipPush: boolean;
  baseDir?: string;
  help: boolean;
} {
  let refName: string | undefined;
  let gitRemote: string | undefined;
  let dryRun = false;
  let skipPush = false;
  let baseDir: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--ref' && i + 1 < args.length) {
      refName = args[++i];
    } else if (arg === '--remote' && i + 1 < args.length) {
      gitRemote = args[++i];
    } else if (arg === '--base-dir' && i + 1 < args.length) {
      baseDir = args[++i];
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--skip-push') {
      skipPush = true;
    }
  }

  return { refName, gitRemote, dryRun, skipPush, baseDir, help };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log('Usage: node --experimental-strip-types scripts/publish-pipeline.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>]');
    process.exit(0);
  }

  console.log('[publish-pipeline] Initializing safe Git publication pipeline...');
  if (options.dryRun) {
    console.log('[publish-pipeline] Mode: DRY RUN (no disk writes or publication)');
  }
  if (options.skipPush) {
    console.log('[publish-pipeline] Option: SKIP PUSH (commit locally, skip remote push)');
  }

  const result = await runPublicationPipeline({
    refName: options.refName,
    gitRemote: options.gitRemote,
    dryRun: options.dryRun,
    skipPush: options.skipPush,
    baseDir: options.baseDir,
  });

  if (!result.success) {
    console.error(`::error::[publish-pipeline] Publication failed (${result.status}): ${result.details}`);
    if (result.error?.stack) {
      console.error(result.error.stack);
    }
    process.exit(1);
  }

  console.log(`[publish-pipeline] Status: ${result.status.toUpperCase()}`);
  console.log(`[publish-pipeline] Details: ${result.details}`);
  if (result.commitSha) {
    console.log(`[publish-pipeline] Commit SHA: ${result.commitSha}`);
  }
  if (result.destinationRef) {
    console.log(`[publish-pipeline] Destination Ref: ${result.destinationRef}`);
  }

  process.exit(0);
}

if (process.argv[1] && (process.argv[1].endsWith('publish-pipeline.ts') || process.argv[1].endsWith('publish-pipeline.js'))) {
  main().catch((err: unknown) => {
    const error = err as Error;
    console.error(`::error::[publish-pipeline] Unhandled exception: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}
