/**
 * GitHub Profile Pet — Dedicated Contribution Baseline Establishment CLI Script (Phase 3C2.3-B2-R3)
 *
 * Dedicated, manual-only entry point for establishing the contribution baseline.
 *
 * Strict Isolation:
 * - Does NOT invoke ordinary publication.
 * - Does NOT simulate pet vitals.
 * - Does NOT process actions.
 * - Does NOT award rewards.
 * - Does NOT publish SVG or touch README.md.
 * - Stages ONLY the 3 state documents.
 *
 * Usage:
 *   node --experimental-strip-types scripts/establish-baseline.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>]
 */

import { executeBaselinePipeline } from '../src/features/pet-engine/publication/index.ts';

export function parseArgs(args: string[]): {
  refName?: string;
  gitRemote?: string;
  dryRun: boolean;
  skipPush: boolean;
  baseDir?: string;
  expectedOwnerDatabaseId?: number;
  help: boolean;
} {
  let refName: string | undefined;
  let gitRemote: string | undefined;
  let dryRun = false;
  let skipPush = false;
  let baseDir: string | undefined;
  let expectedOwnerDatabaseId: number | undefined;
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
    } else if (arg === '--owner-id' && i + 1 < args.length) {
      const parsedId = parseInt(args[++i], 10);
      if (!isNaN(parsedId)) {
        expectedOwnerDatabaseId = parsedId;
      }
    }
  }

  return { refName, gitRemote, dryRun, skipPush, baseDir, expectedOwnerDatabaseId, help };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      'Usage: node --experimental-strip-types scripts/establish-baseline.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>] [--owner-id <id>]'
    );
    process.exit(0);
  }

  console.log('[establish-baseline] Initializing dedicated contribution baseline establishment...');
  if (options.dryRun) {
    console.log('[establish-baseline] Mode: DRY RUN (no disk writes or publication)');
  }
  if (options.skipPush) {
    console.log('[establish-baseline] Option: SKIP PUSH (commit locally, skip remote push)');
  }

  const result = await executeBaselinePipeline({
    refName: options.refName,
    gitRemote: options.gitRemote,
    dryRun: options.dryRun,
    skipPush: options.skipPush,
    baseDir: options.baseDir,
    expectedOwnerDatabaseId: options.expectedOwnerDatabaseId,
  });

  if (!result.success) {
    console.error(`::error::[establish-baseline] Baseline establishment failed (${result.status}): ${result.details}`);
    if (result.error?.stack) {
      console.error(result.error.stack);
    }
    process.exit(1);
  }

  console.log(`[establish-baseline] Status: ${result.status.toUpperCase()}`);
  console.log(`[establish-baseline] Details: ${result.details}`);
  if (result.commitSha) {
    console.log(`[establish-baseline] Commit SHA: ${result.commitSha}`);
  }
}

// Only execute when invoked directly as CLI entrypoint
const isDirectEntry =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith('establish-baseline.ts') || process.argv[1].endsWith('establish-baseline.js'));

if (isDirectEntry) {
  main().catch((err) => {
    console.error('::error::[establish-baseline] Fatal unhandled exception:', err);
    process.exit(1);
  });
}
