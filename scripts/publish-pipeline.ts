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

import {
  runPublicationPipeline,
  executeBaselinePipeline,
  type SyncExecutionMode,
} from '../src/features/pet-engine/publication/index.ts';
import { resolveOwnerIdentity } from '../src/features/pet-engine/contribution/index.ts';

export function parseArgs(args: string[]): {
  refName?: string;
  gitRemote?: string;
  dryRun: boolean;
  skipPush: boolean;
  baseDir?: string;
  baselineOnly: boolean;
  expectedOwnerDatabaseId?: number;
  help: boolean;
} {
  let refName: string | undefined;
  let gitRemote: string | undefined;
  let dryRun = false;
  let skipPush = false;
  let baseDir: string | undefined;
  let baselineOnly = false;
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
    } else if (arg === '--baseline-only') {
      baselineOnly = true;
    } else if (arg === '--owner-id' && i + 1 < args.length) {
      const parsedId = parseInt(args[++i], 10);
      if (!isNaN(parsedId)) {
        expectedOwnerDatabaseId = parsedId;
      }
    } else if (arg === '--mode' && i + 1 < args.length) {
      const modeVal = args[++i];
      if (modeVal === 'baseline_only' || modeVal === 'baseline-only') {
        baselineOnly = true;
      }
    }
  }

  return { refName, gitRemote, dryRun, skipPush, baseDir, baselineOnly, expectedOwnerDatabaseId, help };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log('Usage: node --experimental-strip-types scripts/publish-pipeline.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>] [--owner-id <id>] [--baseline-only]');
    process.exit(0);
  }

  const mode: SyncExecutionMode = options.baselineOnly ? 'baseline_only' : 'runtime';

  console.log('[publish-pipeline] Initializing safe Git publication pipeline...');
  console.log(`[publish-pipeline] Execution Mode: ${mode.toUpperCase()}`);
  if (options.expectedOwnerDatabaseId) {
    console.log(`[publish-pipeline] Expected Owner Database ID: ${options.expectedOwnerDatabaseId}`);
  }
  if (options.dryRun) {
    console.log('[publish-pipeline] Mode: DRY RUN (no disk writes or publication)');
  }
  if (options.skipPush) {
    console.log('[publish-pipeline] Option: SKIP PUSH (commit locally, skip remote push)');
  }

  const token = (process.env.GITHUB_TOKEN ?? process.env.TEST_TOKEN ?? '').trim();
  if (!token && !options.dryRun) {
    console.error('::error::[publish-pipeline] Publication failed (missing_token): GITHUB_TOKEN environment variable is required for publication.');
    process.exit(1);
  }

  const baseDir = options.baseDir ?? process.cwd();
  let expectedOwnerDatabaseId = options.expectedOwnerDatabaseId;
  let targetOwnerLogin: string | undefined;

  try {
    const identity = resolveOwnerIdentity({ baseDir, env: process.env, allowLedgerFallback: true });
    targetOwnerLogin = identity.login;
    if (expectedOwnerDatabaseId === undefined && identity.databaseId) {
      expectedOwnerDatabaseId = identity.databaseId;
    }
    console.log(`[publish-pipeline] Resolved Target Owner: @${identity.login} (databaseId: ${expectedOwnerDatabaseId ?? 'unspecified'})`);
  } catch (err: unknown) {
    if (mode === 'baseline_only') {
      console.error(`::error::[publish-pipeline] Owner identity resolution failed: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (options.baselineOnly) {
    console.log('[publish-pipeline] Routing to isolated baseline establishment pipeline...');
    const result = await executeBaselinePipeline({
      refName: options.refName,
      gitRemote: options.gitRemote,
      dryRun: options.dryRun,
      skipPush: options.skipPush,
      baseDir: options.baseDir,
      expectedOwnerDatabaseId,
      targetOwnerLogin,
    });

    if (!result.success) {
      console.error(`::error::[publish-pipeline] Baseline establishment failed (${result.status}): ${result.details}`);
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
    return;
  }

  const result = await runPublicationPipeline({
    refName: options.refName,
    gitRemote: options.gitRemote,
    dryRun: options.dryRun,
    skipPush: options.skipPush,
    baseDir: options.baseDir,
    mode,
    expectedOwnerDatabaseId,
    targetOwnerLogin,
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
