/**
 * GitHub Profile Pet - Durable Action Inbox Processor & Publication CLI (Phase 3C2.3-B0)
 * Scans, validates, and executes pending pet care actions submitted via GitHub Issues,
 * commits state transitions atomically, and performs safe fast-forward push with
 * post-publication feedback delivery.
 *
 * Usage:
 *   node --experimental-strip-types scripts/process-inbox.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>]
 */

import { runInboxPublicationPipeline } from '../src/features/pet-engine/publication/index.ts';
import { resolveOwnerIdentity } from '../src/features/pet-engine/contribution/index.ts';

export function parseArgs(args: string[]): {
  refName?: string;
  gitRemote?: string;
  dryRun: boolean;
  skipPush: boolean;
  baseDir?: string;
  maxRetries?: number;
  help: boolean;
} {
  let refName: string | undefined;
  let gitRemote: string | undefined;
  let dryRun = false;
  let skipPush = false;
  let baseDir: string | undefined;
  let maxRetries: number | undefined;
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
    } else if (arg === '--max-retries' && i + 1 < args.length) {
      maxRetries = parseInt(args[++i], 10);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--skip-push') {
      skipPush = true;
    }
  }

  return { refName, gitRemote, dryRun, skipPush, baseDir, maxRetries, help };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      'Usage: node --experimental-strip-types scripts/process-inbox.ts [--ref <refName>] [--remote <remote>] [--dry-run] [--skip-push] [--base-dir <dir>] [--max-retries <num>]'
    );
    process.exit(0);
  }

  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  console.log('[process-inbox] Starting safe GitHub Profile Pet action inbox publication pipeline...');
  if (repository) {
    console.log(`[process-inbox] Repository context: ${repository}`);
  }
  if (!token) {
    console.warn('[process-inbox] Warning: GITHUB_TOKEN environment variable is not set.');
  }
  if (options.dryRun) {
    console.log('[process-inbox] Mode: DRY RUN (no disk writes or publication)');
  }
  if (options.skipPush) {
    console.log('[process-inbox] Option: SKIP PUSH (commit locally, skip remote push)');
  }

  const baseDir = options.baseDir ?? process.cwd();
  let trustedAuthorId: number | undefined;

  try {
    const identity = resolveOwnerIdentity({ baseDir, env: process.env, allowLedgerFallback: true });
    if (typeof identity.databaseId === 'number' && Number.isInteger(identity.databaseId) && identity.databaseId > 0) {
      trustedAuthorId = identity.databaseId;
      console.log(
        `[process-inbox] Authorized Trainer Identity: @${identity.login} (databaseId: ${trustedAuthorId}, source: ${identity.sourceDatabaseId ?? identity.sourceLogin})`
      );
    } else {
      console.error(
        '::error::[process-inbox] Failed to resolve trusted owner numeric database ID. Action inbox requires valid trainer identity.'
      );
      process.exit(1);
    }
  } catch (err: unknown) {
    console.error(`::error::[process-inbox] Identity resolution failed: ${(err as Error).message}`);
    process.exit(1);
  }

  const allowAnyAuthor = process.env.PET_ALLOW_ANY_AUTHOR === 'true';
  if (allowAnyAuthor) {
    console.log('[process-inbox] Configuration: PET_ALLOW_ANY_AUTHOR is true. Community pet mode enabled.');
  }

  const result = await runInboxPublicationPipeline({
    refName: options.refName,
    gitRemote: options.gitRemote,
    dryRun: options.dryRun,
    skipPush: options.skipPush,
    baseDir: options.baseDir,
    maxRetries: options.maxRetries,
    trustedAuthorId,
    allowAnyAuthor,
  });

  if (result.inboxResult) {
    const ir = result.inboxResult;
    console.log(`[process-inbox] Inbox Drainage Summary:`);
    console.log(`  Total Scanned: ${ir.scannedCount}`);
    console.log(`  Actions Processed: ${ir.processedCount}`);
    console.log(
      `  Accepted: ${ir.acceptedCount}, Rejected: ${ir.rejectedCount}, Duplicates: ${ir.duplicateCount}, Quarantined: ${ir.quarantinedCount}`
    );
    console.log(`  High-Water Mark: Issue #${ir.newHighWaterMark}`);
    console.log(`  Queue Status: Drained=${ir.queueDrained}, HasMorePending=${ir.hasMorePending}`);
    if (ir.savedGeneration !== undefined) {
      console.log(`  State Generation: ${ir.savedGeneration}`);
    }
  }

  if (!result.success) {
    console.error(`::error::[process-inbox] Publication failed (${result.status}): ${result.details}`);
    if (result.error?.stack) {
      console.error(result.error.stack);
    }
    process.exit(1);
  }

  console.log(`[process-inbox] Status: ${result.status.toUpperCase()}`);
  console.log(`[process-inbox] Details: ${result.details}`);
  if (result.commitSha) {
    console.log(`[process-inbox] Commit SHA: ${result.commitSha}`);
  }
  if (result.destinationRef) {
    console.log(`[process-inbox] Destination Ref: ${result.destinationRef}`);
  }

  process.exit(0);
}

if (process.argv[1] && (process.argv[1].endsWith('process-inbox.ts') || process.argv[1].endsWith('process-inbox.js'))) {
  main().catch((err: unknown) => {
    const error = err as Error;
    console.error(`::error::[process-inbox] Unhandled exception: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}
