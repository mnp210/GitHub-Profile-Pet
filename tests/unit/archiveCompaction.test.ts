import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  inspectActivityLedger,
  compactActivityArchive,
  verifyActivityArchive,
  recoverArchiveTransaction,
  migrateArchiveV1ToV2,
  migrateArchiveV2ToV1,
  isArchiveV2,
  computeBatchSha256,
  canonicalStringify,
} from '../../src/features/pet-engine/activity/compactor.ts';
import {
  initDefaultActivityLedger,
  evaluateActivityEvent,
  isDuplicateEvent,
  loadActivityArchive,
} from '../../src/features/pet-engine/activity/index.ts';
import type {
  ActivityEventRecord,
  ActivityLedgerDocument,
  ActivityArchiveV1Document,
  ActivityArchiveV2Document,
} from '../../src/features/pet-engine/activity/types.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';
import { ACTIVITY_ARCHIVE_RELATIVE_PATH } from '../../src/features/pet-engine/activity/constants.ts';

function createMockPetState(overrides: Partial<PetStateDocument> = {}): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 1,
    xp: 0,
    maxExp: 100,
    energy: 100,
    energyAccumulator: 0,
    hunger: 100,
    happiness: 100,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-22T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-22T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-22T00:00:00.000Z',
    updatedAt: '2026-11-22T12:00:00.000Z',
    ...overrides,
  };
}

function generateMockEvents(count: number, startId = 1): ActivityEventRecord[] {
  const types: Array<ActivityEventRecord['eventType']> = [
    'commit',
    'issue_opened',
    'pr_opened',
    'pr_merged',
    'review_submitted',
  ];
  const events: ActivityEventRecord[] = [];
  const baseTime = new Date('2026-11-01T00:00:00.000Z').getTime();

  for (let i = 0; i < count; i++) {
    const id = startId + i;
    const eventType = types[i % types.length];
    const eventId =
      eventType === 'commit'
        ? `commit:${id.toString(16).padStart(40, '0')}`
        : `${eventType}:${id}`;

    events.push({
      eventId,
      eventType,
      actor: `developer-${(i % 5) + 1}`,
      timestamp: new Date(baseTime + i * 60000).toISOString(),
      xpAwarded: eventType === 'commit' ? 15 : eventType === 'pr_merged' ? 50 : 10,
      status: 'rewarded',
      details: `Generated mock event #${id}`,
      ref: 'refs/heads/main',
    });
  }

  // Activity ledger recentEvents is ordered newest-first
  return events.reverse();
}

describe('Sprint 5.0D — Activity Archive Compaction, Integrity & Recovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-archive-test-'));
    await fs.mkdir(path.join(tempDir, 'pet/state'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'pet/ledger/archive'), { recursive: true });
  });

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe('1. Functional Compaction & Policy Enforcement', () => {
    it('returns NOT_NEEDED when active ledger record count is below threshold', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(40);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      const result = await compactActivityArchive({
        baseDir: tempDir,
        threshold: 100,
      });

      assert.equal(result.status, 'NOT_NEEDED');
      assert.equal(result.archivedRecordCount, 0);
      assert.equal(result.finalActiveRecords, 40);

      // Verify archive file was not created
      const archiveExists = await fs.access(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH)).then(() => true).catch(() => false);
      assert.equal(archiveExists, false);
    });

    it('returns NOT_NEEDED when active ledger record count exactly equals threshold', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(100);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      const result = await compactActivityArchive({
        baseDir: tempDir,
        threshold: 100,
      });

      assert.equal(result.status, 'NOT_NEEDED');
      assert.equal(result.archivedRecordCount, 0);
      assert.equal(result.finalActiveRecords, 100);
    });

    it('compacts older records beyond threshold and retains recent records in active ledger', async () => {
      const ledger = initDefaultActivityLedger();
      // 150 events generated: index 0..99 are newest, index 100..149 are oldest
      const events = generateMockEvents(150);
      ledger.recentEvents = events;
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      const result = await compactActivityArchive({
        baseDir: tempDir,
        threshold: 100,
      });

      assert.equal(result.status, 'COMPACTED');
      assert.equal(result.initialActiveRecords, 150);
      assert.equal(result.finalActiveRecords, 100);
      assert.equal(result.archivedRecordCount, 50);
      assert.ok(result.batchId);
      assert.ok(result.batchSha256);

      // Verify on-disk active ledger was truncated to exactly 100 records
      const onDiskLedger: ActivityLedgerDocument = JSON.parse(
        await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8')
      );
      assert.equal(onDiskLedger.recentEvents.length, 100);
      assert.deepEqual(onDiskLedger.recentEvents, events.slice(0, 100));

      // Verify on-disk archive document has 50 records in batch 1
      const onDiskArchive: ActivityArchiveV2Document = JSON.parse(
        await fs.readFile(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH), 'utf-8')
      );
      assert.equal(onDiskArchive.schemaVersion, 2);
      assert.equal(onDiskArchive.archivedEvents.length, 50);
      assert.equal(onDiskArchive.batches.length, 1);
      assert.equal(onDiskArchive.batches[0].recordCount, 50);
      assert.equal(onDiskArchive.batches[0].sha256, result.batchSha256);
      assert.equal(onDiskArchive.batches[0].totalXp, result.archivedXp);

      // Verify preserved records in archive match the oldest 50 events in chronological order
      const expectedOldest = events.slice(100).reverse();
      assert.deepEqual(onDiskArchive.archivedEvents, expectedOldest);
    });

    it('appends subsequent archive batches cleanly upon repeated compaction cycles', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(150);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      // First compaction: 150 -> 100 (50 archived)
      const res1 = await compactActivityArchive({ baseDir: tempDir, threshold: 100 });
      assert.equal(res1.status, 'COMPACTED');
      assert.equal(res1.archivedRecordCount, 50);

      // Add 80 more events to active ledger (now 180 total)
      const currentLedger: ActivityLedgerDocument = JSON.parse(
        await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8')
      );
      const newEvents = generateMockEvents(80, 201);
      currentLedger.recentEvents = [...newEvents, ...currentLedger.recentEvents];
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(currentLedger, null, 2));

      // Second compaction: 180 -> 100 (80 archived)
      const res2 = await compactActivityArchive({ baseDir: tempDir, threshold: 100 });
      assert.equal(res2.status, 'COMPACTED');
      assert.equal(res2.archivedRecordCount, 80);

      // Verify archive has both batches
      const archive: ActivityArchiveV2Document = JSON.parse(
        await fs.readFile(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH), 'utf-8')
      );
      assert.equal(archive.batches.length, 2);
      assert.equal(archive.archivedEvents.length, 130); // 50 + 80
      assert.equal(archive.totalArchivedEvents, 130);
      assert.notEqual(archive.batches[0].batchId, archive.batches[1].batchId);
    });

    it('enforces idempotency: consecutive run with unchanged input results in clean NOOP', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(120);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      const run1 = await compactActivityArchive({ baseDir: tempDir, threshold: 100 });
      assert.equal(run1.status, 'COMPACTED');

      // Second run immediately after
      const run2 = await compactActivityArchive({ baseDir: tempDir, threshold: 100 });
      assert.equal(run2.status, 'NOT_NEEDED');
      assert.equal(run2.archivedRecordCount, 0);

      const archive: ActivityArchiveV2Document = JSON.parse(
        await fs.readFile(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH), 'utf-8')
      );
      assert.equal(archive.batches.length, 1); // No duplicate batch created
    });

    it('dry-run mode is strictly read-only and does not modify disk', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(150);
      const originalJson = JSON.stringify(ledger, null, 2);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), originalJson);

      const dryResult = await compactActivityArchive({
        baseDir: tempDir,
        threshold: 100,
        dryRun: true,
      });

      assert.equal(dryResult.status, 'DRY_RUN');
      assert.equal(dryResult.archivedRecordCount, 50);

      // Verify active ledger file is 100% byte-for-byte identical
      const currentJson = await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8');
      assert.equal(currentJson, originalJson);

      // Verify archive file was NOT created
      const archiveExists = await fs.access(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH)).then(() => true).catch(() => false);
      assert.equal(archiveExists, false);
    });
  });

  describe('2. XP Accounting & Deduplication Integrity', () => {
    it('preserves exact total XP before and after compaction (zero XP change)', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(200);
      const totalXpBefore = ledger.recentEvents.reduce((s, e) => s + (e.xpAwarded || 0), 0);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      const result = await compactActivityArchive({ baseDir: tempDir, threshold: 100 });
      assert.equal(result.status, 'COMPACTED');
      assert.equal(result.totalCombinedXp, totalXpBefore);

      const inspection = await inspectActivityLedger({ baseDir: tempDir });
      assert.equal(inspection.totalCombinedXp, totalXpBefore);
      assert.equal(inspection.totalActiveXp + inspection.totalArchivedXp, totalXpBefore);
    });

    it('prevents replay of archived commits even if removed from active ledger', async () => {
      let pet = createMockPetState();
      const ledger = initDefaultActivityLedger();
      const initialSha = '1111111111111111111111111111111111111111';

      // Record commit
      const initialEval = evaluateActivityEvent(pet, ledger, {
        eventType: 'commit',
        eventId: `commit:${initialSha}`,
        actor: 'mnp210',
      });
      assert.equal(initialEval.result.status, 'rewarded');
      pet = initialEval.updatedPet;
      const activeLedger = initialEval.updatedLedger;

      // Add 110 more events so initialSha rolls beyond threshold of 100
      activeLedger.recentEvents = [...generateMockEvents(110), ...activeLedger.recentEvents];
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(activeLedger, null, 2));

      // Compact
      await compactActivityArchive({ baseDir: tempDir, threshold: 100 });

      // Verify initialSha is no longer in activeLedger.recentEvents
      const postLedger: ActivityLedgerDocument = JSON.parse(
        await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8')
      );
      assert.equal(postLedger.recentEvents.some((e) => e.eventId === `commit:${initialSha}`), false);

      // Load archive
      const archive = await loadActivityArchive(tempDir);
      assert.ok(archive);
      assert.ok(archive.archivedCommitShas.includes(initialSha));

      // Attempt replay of initialSha: must be rejected!
      const replayOutcome = evaluateActivityEvent(
        pet,
        postLedger,
        {
          eventType: 'commit',
          eventId: `commit:${initialSha}`,
          actor: 'mnp210',
        },
        new Date().toISOString(),
        archive.archivedCommitShas,
        isArchiveV2(archive) ? archive.archivedEvents : undefined
      );

      assert.equal(replayOutcome.result.status, 'skipped_duplicate');
      assert.equal(replayOutcome.result.xpAwarded, 0);
      assert.equal(replayOutcome.updatedPet.xp, pet.xp);
    });

    it('prevents replay of archived non-commit events (issues, PRs, reviews)', () => {
      const ledger = initDefaultActivityLedger();
      const archivedEvents = generateMockEvents(5);
      const archivedIssue = archivedEvents.find((e) => e.eventType === 'issue_opened')!;

      // isDuplicateEvent checks archivedEvents array directly
      const isDup = isDuplicateEvent(
        ledger.processedRegistry,
        archivedIssue.eventType,
        archivedIssue.eventId,
        ledger.permanentIndex,
        [],
        archivedEvents
      );
      assert.equal(isDup, true);
    });

    it('preserves all provenance metadata fields in every archived record', async () => {
      const ledger = initDefaultActivityLedger();
      const testRecord: ActivityEventRecord = {
        eventId: 'pr_merged:42',
        eventType: 'pr_merged',
        actor: 'contributor-alex',
        timestamp: '2026-11-20T10:15:30.000Z',
        xpAwarded: 50,
        status: 'rewarded',
        details: 'Merged critical performance optimization PR #42',
        ref: 'refs/pull/42/merge',
      };
      ledger.recentEvents = [...generateMockEvents(10), testRecord];
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      await compactActivityArchive({ baseDir: tempDir, threshold: 5 });

      const archive = (await loadActivityArchive(tempDir)) as ActivityArchiveV2Document;
      assert.ok(archive);
      const archivedTarget = archive.archivedEvents.find((e) => e.eventId === 'pr_merged:42');
      assert.ok(archivedTarget);
      assert.equal(archivedTarget.eventType, 'pr_merged');
      assert.equal(archivedTarget.actor, 'contributor-alex');
      assert.equal(archivedTarget.timestamp, '2026-11-20T10:15:30.000Z');
      assert.equal(archivedTarget.xpAwarded, 50);
      assert.equal(archivedTarget.status, 'rewarded');
      assert.equal(archivedTarget.details, 'Merged critical performance optimization PR #42');
      assert.equal(archivedTarget.ref, 'refs/pull/42/merge');
    });
  });

  describe('3. Transaction Atomicity & Crash Recovery', () => {
    it('rolls back uncommitted transaction staging if interrupted before commit point', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(150);
      const originalJson = JSON.stringify(ledger, null, 2);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), originalJson);

      // Simulate partial staging crash: create .activity_tx/staged with uncommitted tx.json
      const txDir = path.join(tempDir, 'pet/ledger/.activity_tx');
      const stagedDir = path.join(txDir, 'staged');
      await fs.mkdir(stagedDir, { recursive: true });
      await fs.writeFile(path.join(stagedDir, 'activity.json'), '{"corrupt": true}');

      // Recovery should roll back and clean .activity_tx
      const rec = await recoverArchiveTransaction({ baseDir: tempDir });
      assert.equal(rec.recovered, true);
      assert.equal(rec.status, 'ROLLED_BACK_UNCOMMITTED');

      // Verify active ledger is completely untouched
      const currentJson = await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8');
      assert.equal(currentJson, originalJson);

      // Verify .activity_tx directory is removed
      const txExists = await fs.access(txDir).then(() => true).catch(() => false);
      assert.equal(txExists, false);
    });

    it('rolls forward committed transaction staging if interrupted during rename apply', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(100);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      // Simulate crash after commit point: tx.json has status: "committed"
      const txDir = path.join(tempDir, 'pet/ledger/.activity_tx');
      const stagedDir = path.join(txDir, 'staged/pet/ledger');
      await fs.mkdir(stagedDir, { recursive: true });

      const newLedgerContent = JSON.stringify({ ...ledger, generation: 99 }, null, 2);
      await fs.writeFile(path.join(stagedDir, 'activity.json'), newLedgerContent);

      const manifest = {
        txId: 'tx-crash-test',
        status: 'committed',
        files: ['pet/ledger/activity.json'],
        timestamp: new Date().toISOString(),
      };
      await fs.writeFile(path.join(txDir, 'tx.json'), JSON.stringify(manifest, null, 2));

      // Recovery must roll forward and replace activity.json with the staged content
      const rec = await recoverArchiveTransaction({ baseDir: tempDir });
      assert.equal(rec.recovered, true);
      assert.equal(rec.status, 'RECOVERED_COMMITTED');

      const appliedLedger = JSON.parse(await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8'));
      assert.equal(appliedLedger.generation, 99);
    });
  });

  describe('4. Comprehensive Archive Verification Engine', () => {
    it('verifies valid active and archived ledgers with status PASS', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(120);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      await compactActivityArchive({ baseDir: tempDir, threshold: 100 });

      const audit = await verifyActivityArchive({ baseDir: tempDir });
      assert.equal(audit.status, 'PASS');
      assert.equal(audit.activeRecordCount, 100);
      assert.equal(audit.archivedRecordCount, 20);
      assert.equal(audit.totalEventCount, 120);
      assert.equal(audit.uniqueEventCount, 120);
      assert.equal(audit.batchCount, 1);
      assert.equal(audit.issues.length, 0);
    });

    it('detects and flags corrupted batch SHA-256 checksums', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(120);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      await compactActivityArchive({ baseDir: tempDir, threshold: 100 });

      // Corrupt the archive: alter the actor on an archived record
      const archivePath = path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH);
      const archive: ActivityArchiveV2Document = JSON.parse(await fs.readFile(archivePath, 'utf-8'));
      archive.archivedEvents[0].actor = 'malicious-tamperer';
      await fs.writeFile(archivePath, JSON.stringify(archive, null, 2));

      const audit = await verifyActivityArchive({ baseDir: tempDir });
      assert.equal(audit.status, 'FAIL');
      const checksumIssue = audit.issues.find((i) => i.code === 'BATCH_CHECKSUM_MISMATCH');
      assert.ok(checksumIssue);
      assert.match(checksumIssue.message, /checksum failed/i);
    });

    it('detects and flags colliding event IDs across active ledger and archive', async () => {
      const ledger = initDefaultActivityLedger();
      ledger.recentEvents = generateMockEvents(120);
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(ledger, null, 2));

      await compactActivityArchive({ baseDir: tempDir, threshold: 100 });

      // Inject duplicate eventId into active ledger that already exists in archive
      const activeLedger: ActivityLedgerDocument = JSON.parse(
        await fs.readFile(path.join(tempDir, 'pet/ledger/activity.json'), 'utf-8')
      );
      const archive: ActivityArchiveV2Document = JSON.parse(
        await fs.readFile(path.join(tempDir, ACTIVITY_ARCHIVE_RELATIVE_PATH), 'utf-8')
      );
      activeLedger.recentEvents.push(archive.archivedEvents[0]); // Duplicate!
      await fs.writeFile(path.join(tempDir, 'pet/ledger/activity.json'), JSON.stringify(activeLedger, null, 2));

      const audit = await verifyActivityArchive({ baseDir: tempDir });
      assert.equal(audit.status, 'FAIL');
      const dupIssue = audit.issues.find((i) => i.code === 'COLLIDING_EVENT_ID_ACROSS_LEDGERS');
      assert.ok(dupIssue);
    });
  });

  describe('5. Schema Versioning & Reversible Migration', () => {
    it('transparently migrates v1 archive document to v2 format preserving commit SHAs', () => {
      const v1: ActivityArchiveV1Document = {
        schemaVersion: 1,
        archivedCommitShas: ['abcd1234abcd1234abcd1234abcd1234abcd1234'],
        archivedEventCount: 1,
        updatedAt: '2026-11-19T00:00:00.000Z',
      };

      const v2 = migrateArchiveV1ToV2(v1);
      assert.equal(v2.schemaVersion, 2);
      assert.deepEqual(v2.archivedCommitShas, v1.archivedCommitShas);
      assert.equal(v2.totalArchivedEvents, 1);
      assert.deepEqual(v2.archivedEvents, []);
      assert.deepEqual(v2.batches, []);
      assert.equal(isArchiveV2(v2), true);
    });

    it('reversibly converts v2 archive back to v1 format', () => {
      const v2: ActivityArchiveV2Document = {
        schemaVersion: 2,
        archivedCommitShas: ['abcd1234abcd1234abcd1234abcd1234abcd1234'],
        archivedEvents: generateMockEvents(5),
        batches: [],
        totalArchivedEvents: 5,
        totalArchivedXp: 75,
        updatedAt: '2026-11-22T00:00:00.000Z',
      };

      const v1 = migrateArchiveV2ToV1(v2);
      assert.equal(v1.schemaVersion, 1);
      assert.deepEqual(v1.archivedCommitShas, v2.archivedCommitShas);
      assert.equal(v1.archivedEventCount, 5);
    });

    it('produces deterministic canonical stringification regardless of object key insertion order', () => {
      const obj1 = { z: 1, a: 'hello', m: { y: 2, b: 3 } };
      const obj2 = { a: 'hello', z: 1, m: { b: 3, y: 2 } };

      const canon1 = canonicalStringify(obj1);
      const canon2 = canonicalStringify(obj2);

      assert.equal(canon1, canon2);
      assert.equal(canon1, '{"a":"hello","m":{"b":3,"y":2},"z":1}');
    });

    it('computes identical SHA-256 for identical records irrespective of key order', () => {
      const events1 = generateMockEvents(3);
      const events2 = JSON.parse(JSON.stringify(events1));

      // Reorder keys in second record
      const reordered = {
        ref: events2[0].ref,
        status: events2[0].status,
        eventId: events2[0].eventId,
        actor: events2[0].actor,
        xpAwarded: events2[0].xpAwarded,
        timestamp: events2[0].timestamp,
        details: events2[0].details,
        eventType: events2[0].eventType,
      };
      events2[0] = reordered;

      const sha1 = computeBatchSha256(events1);
      const sha2 = computeBatchSha256(events2);

      assert.equal(sha1, sha2);
    });
  });
});
