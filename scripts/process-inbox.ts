/**
 * GitHub Profile Pet - Durable Action Inbox Processor CLI
 * Scans, validates, and executes pending pet care actions submitted via GitHub Issues.
 *
 * Designed to execute directly in GitHub Actions runners on:
 *   - issues: [opened]
 *   - workflow_dispatch
 */

import { processInbox } from '../src/features/pet-engine/inbox/index.ts';

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;

  console.log('[process-inbox] Starting GitHub Profile Pet action inbox drainage...');
  if (repository) {
    console.log(`[process-inbox] Repository context: ${repository}`);
  }
  if (!token) {
    console.warn('[process-inbox] Warning: GITHUB_TOKEN environment variable is not set.');
  }

  const result = await processInbox({
    baseDir: process.cwd(),
    repository,
  });

  console.log(`[process-inbox] Drainage complete.`);
  console.log(`[process-inbox] Total Scanned: ${result.scannedCount}`);
  console.log(`[process-inbox] Actions Processed: ${result.processedCount}`);
  console.log(`[process-inbox] Accepted: ${result.acceptedCount}, Rejected: ${result.rejectedCount}, Duplicates: ${result.duplicateCount}, Quarantined: ${result.quarantinedCount}`);
  console.log(`[process-inbox] High-Water Mark: Issue #${result.newHighWaterMark}`);
  console.log(`[process-inbox] Queue Status: Drained=${result.queueDrained}, HasMorePending=${result.hasMorePending}`);
  if (result.savedGeneration !== undefined) {
    console.log(`[process-inbox] Repository State Committed (Generation ${result.savedGeneration})`);
  }
}

main().catch((err) => {
  console.error('::error::[process-inbox] Action processing failed:', err);
  process.exit(1);
});
