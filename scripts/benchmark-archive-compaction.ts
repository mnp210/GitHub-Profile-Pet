/**
 * GitHub Profile Pet - Activity Compaction Benchmark Runner (Sprint 5.0D)
 *
 * Runs synthetic performance benchmarks across 1k, 5k, 10k, 25k, and 50k records.
 * Measures inspection, dry-run, compaction, and verification durations, as well as file sizes.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  inspectActivityLedger,
  compactActivityArchive,
  verifyActivityArchive,
} from '../src/features/pet-engine/activity/compactor.ts';
import { initDefaultActivityLedger } from '../src/features/pet-engine/activity/index.ts';
import type { ActivityEventRecord } from '../src/features/pet-engine/activity/types.ts';
import { ACTIVITY_ARCHIVE_RELATIVE_PATH } from '../src/features/pet-engine/activity/constants.ts';

function generateBenchmarkEvents(count: number): ActivityEventRecord[] {
  const types: Array<ActivityEventRecord['eventType']> = [
    'commit',
    'issue_opened',
    'pr_opened',
    'pr_merged',
    'review_submitted',
  ];
  const events: ActivityEventRecord[] = [];
  const baseTime = new Date('2026-01-01T00:00:00.000Z').getTime();

  for (let i = 0; i < count; i++) {
    const eventType = types[i % types.length];
    const eventId =
      eventType === 'commit'
        ? `commit:${(i + 1).toString(16).padStart(40, '0')}`
        : `${eventType}:${i + 1}`;

    events.push({
      eventId,
      eventType,
      actor: `dev-user-${(i % 10) + 1}`,
      timestamp: new Date(baseTime + i * 1000).toISOString(),
      xpAwarded: eventType === 'commit' ? 15 : eventType === 'pr_merged' ? 50 : 10,
      status: 'rewarded',
      details: `Synthetic benchmark event #${i + 1}`,
      ref: 'refs/heads/main',
    });
  }

  return events.reverse();
}

interface BenchmarkScaleResult {
  recordCount: number;
  threshold: number;
  inspectMs: number;
  dryRunMs: number;
  compactMs: number;
  verifyMs: number;
  activeBytes: number;
  archiveBytes: number;
  totalBytes: number;
  recordsArchived: number;
  status: string;
}

async function runBenchmarkForScale(recordCount: number, threshold = 5000): Promise<BenchmarkScaleResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `pet-bench-${recordCount}-`));
  await fs.mkdir(path.join(tempDir, 'pet/ledger/archive'), { recursive: true });

  const ledger = initDefaultActivityLedger();
  ledger.recentEvents = generateBenchmarkEvents(recordCount);
  await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

  // 1. Inspect
  const t0 = performance.now();
  await inspectActivityLedger({ baseDir: tempDir, threshold });
  const inspectMs = performance.now() - t0;

  // 2. Dry-Run
  const t1 = performance.now();
  await compactActivityArchive({ baseDir: tempDir, threshold, dryRun: true });
  const dryRunMs = performance.now() - t1;

  // 3. Compaction
  const t2 = performance.now();
  const compactResult = await compactActivityArchive({ baseDir: tempDir, threshold, dryRun: false });
  const compactMs = performance.now() - t2;

  // 4. Verification
  const t3 = performance.now();
  const verifyResult = await verifyActivityArchive({ baseDir: tempDir });
  const verifyMs = performance.now() - t3;

  // 5. Measure file sizes
  const activeStat = await fs.stat(path.join(tempDir, 'pet/ledger/activity.json'));
  let archiveBytes = 0;
  try {
    const archiveStat = await fs.stat(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH));
    archiveBytes = archiveStat.size;
  } catch {}

  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  return {
    recordCount,
    threshold,
    inspectMs: Math.round(inspectMs * 10) / 10,
    dryRunMs: Math.round(dryRunMs * 10) / 10,
    compactMs: Math.round(compactMs * 10) / 10,
    verifyMs: Math.round(verifyMs * 10) / 10,
    activeBytes: activeStat.size,
    archiveBytes,
    totalBytes: activeStat.size + archiveBytes,
    recordsArchived: compactResult.archivedRecordCount,
    status: verifyResult.status,
  };
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('GitHub Profile Pet — Activity Compaction Synthetic Benchmark');
  console.log('================================================================');
  console.log('Benchmarking scales: 1,000, 5,000, 10,000, 25,000, 50,000 records...');

  const scales = [1000, 5000, 10000, 25000, 50000];
  const results: BenchmarkScaleResult[] = [];

  for (const scale of scales) {
    process.stdout.write(`Benchmarking ${scale} records... `);
    const res = await runBenchmarkForScale(scale, 5000);
    results.push(res);
    console.log(`Done in ${(res.inspectMs + res.dryRunMs + res.compactMs + res.verifyMs).toFixed(1)} ms.`);
  }

  console.log('\n### Benchmark Results Summary Table\n');
  console.log('| Records | Archived | Inspect (ms) | Dry-Run (ms) | Compact (ms) | Verify (ms) | Active Size | Archive Size | Total Size | Audit |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :---: |');

  for (const r of results) {
    const activeKb = (r.activeBytes / 1024).toFixed(1) + ' KB';
    const archiveKb = (r.archiveBytes / 1024).toFixed(1) + ' KB';
    const totalKb = (r.totalBytes / 1024).toFixed(1) + ' KB';
    console.log(
      `| ${r.recordCount.toLocaleString()} | ${r.recordsArchived.toLocaleString()} | ${r.inspectMs} ms | ${r.dryRunMs} ms | ${r.compactMs} ms | ${r.verifyMs} ms | ${activeKb} | ${archiveKb} | ${totalKb} | ${r.status} |`
    );
  }

  console.log('\nBenchmark completed successfully.');
}

void main();
