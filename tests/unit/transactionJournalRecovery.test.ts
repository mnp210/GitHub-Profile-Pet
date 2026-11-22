import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  executeActivityTransaction,
  recoverActivityTransaction,
  ACTIVITY_TX_DIR,
  type ActivityTxManifest,
} from '../../src/features/pet-engine/activity/index.ts';

describe('Activity Transaction Journal & Crash Recovery (Sprint 4.1)', () => {
  let tempBaseDir: string;

  beforeEach(async () => {
    tempBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-tx-test-'));
  });

  afterEach(async () => {
    if (tempBaseDir) {
      await fs.rm(tempBaseDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('atomically commits and applies updates across multiple documents cleanly', async () => {
    const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
    const ledgerPath = path.join(tempBaseDir, 'pet/ledger/activity.json');
    const archivePath = path.join(tempBaseDir, 'pet/ledger/archive/activity_archive.json');

    const petData = { name: 'Shadow Claw', level: 5, xp: 450 };
    const ledgerData = { schemaVersion: '1.0.0', recentEvents: [] };
    const archiveData = { schemaVersion: '1.0.0', archivedCommitShas: ['abc1234'] };

    await executeActivityTransaction(tempBaseDir, [
      { targetPath: petPath, data: petData },
      { targetPath: ledgerPath, data: ledgerData },
      { targetPath: archivePath, data: archiveData },
    ]);

    // Destination files must exist with exact contents
    const readPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
    const readLedger = JSON.parse(await fs.readFile(ledgerPath, 'utf-8'));
    const readArchive = JSON.parse(await fs.readFile(archivePath, 'utf-8'));

    assert.equal(readPet.level, 5);
    assert.equal(readLedger.schemaVersion, '1.0.0');
    assert.deepEqual(readArchive.archivedCommitShas, ['abc1234']);

    // Transaction directory must be cleaned up
    const txDirExists = await fs
      .access(path.join(tempBaseDir, ACTIVITY_TX_DIR))
      .then(() => true)
      .catch(() => false);
    assert.equal(txDirExists, false, 'Transaction dir must be removed after successful apply');
  });

  it('rolls back uncommitted stages when crash occurs before commit point', async () => {
    const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
    await fs.mkdir(path.dirname(petPath), { recursive: true });
    await fs.writeFile(petPath, JSON.stringify({ level: 1 }), 'utf-8');

    // Simulate crash during prepare: staged folder has new state, but no committed tx.json
    const txDir = path.join(tempBaseDir, ACTIVITY_TX_DIR);
    const stagedDir = path.join(txDir, 'staged', 'pet/state');
    await fs.mkdir(stagedDir, { recursive: true });
    await fs.writeFile(path.join(stagedDir, 'pet.json'), JSON.stringify({ level: 99 }), 'utf-8');

    // Run recovery
    const recovered = await recoverActivityTransaction(tempBaseDir);
    assert.equal(recovered, true);

    // Destination file must remain UNTOUCHED (level 1, not 99)
    const currentPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
    assert.equal(currentPet.level, 1, 'Uncommitted changes must be rolled back');

    // Staged directory must be wiped
    const txDirExists = await fs
      .access(txDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(txDirExists, false);
  });

  it('rolls forward committed stages when crash occurs during file renaming', async () => {
    const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
    const ledgerPath = path.join(tempBaseDir, 'pet/ledger/activity.json');

    await fs.mkdir(path.dirname(petPath), { recursive: true });
    await fs.writeFile(petPath, JSON.stringify({ level: 1 }), 'utf-8');

    // Simulate crash after commit point:
    // tx.json exists with status 'committed', staged files are ready
    const txDir = path.join(tempBaseDir, ACTIVITY_TX_DIR);
    const stagedPetDir = path.join(txDir, 'staged', 'pet/state');
    const stagedLedgerDir = path.join(txDir, 'staged', 'pet/ledger');

    await fs.mkdir(stagedPetDir, { recursive: true });
    await fs.mkdir(stagedLedgerDir, { recursive: true });

    await fs.writeFile(path.join(stagedPetDir, 'pet.json'), JSON.stringify({ level: 2, xp: 100 }), 'utf-8');
    await fs.writeFile(path.join(stagedLedgerDir, 'activity.json'), JSON.stringify({ eventsCount: 1 }), 'utf-8');

    const manifest: ActivityTxManifest = {
      txId: 'tx-crash-recovery-test',
      status: 'committed',
      files: ['pet/state/pet.json', 'pet/ledger/activity.json'],
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(path.join(txDir, 'tx.json'), JSON.stringify(manifest), 'utf-8');

    // Run recovery
    const recovered = await recoverActivityTransaction(tempBaseDir);
    assert.equal(recovered, true);

    // Destination files must have rolled forward to new committed state
    const currentPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
    const currentLedger = JSON.parse(await fs.readFile(ledgerPath, 'utf-8'));

    assert.equal(currentPet.level, 2, 'Committed transaction must roll forward to new pet state');
    assert.equal(currentPet.xp, 100);
    assert.equal(currentLedger.eventsCount, 1, 'Committed transaction must roll forward to new ledger');

    // Transaction directory must be cleaned up
    const txDirExists = await fs
      .access(txDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(txDirExists, false);
  });

  it('handles crash before prepare (no tx directory) cleanly without error', async () => {
    const recovered = await recoverActivityTransaction(tempBaseDir);
    assert.equal(recovered, true, 'Recovery when no transaction exists should succeed idempotently');
  });

  it('rolls forward when crash occurs halfway through file replacements (some already renamed)', async () => {
    const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
    const ledgerPath = path.join(tempBaseDir, 'pet/ledger/activity.json');

    await fs.mkdir(path.dirname(petPath), { recursive: true });
    await fs.mkdir(path.dirname(ledgerPath), { recursive: true });

    // Suppose pet.json was ALREADY renamed to destination, but activity.json was still in staged/
    await fs.writeFile(petPath, JSON.stringify({ level: 3, xp: 200 }), 'utf-8');
    await fs.writeFile(ledgerPath, JSON.stringify({ oldState: true }), 'utf-8');

    const txDir = path.join(tempBaseDir, ACTIVITY_TX_DIR);
    const stagedLedgerDir = path.join(txDir, 'staged', 'pet/ledger');
    await fs.mkdir(stagedLedgerDir, { recursive: true });
    await fs.writeFile(path.join(stagedLedgerDir, 'activity.json'), JSON.stringify({ oldState: false, newState: true }), 'utf-8');

    const manifest: ActivityTxManifest = {
      txId: 'tx-crash-halfway',
      status: 'committed',
      files: ['pet/state/pet.json', 'pet/ledger/activity.json'],
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(path.join(txDir, 'tx.json'), JSON.stringify(manifest), 'utf-8');

    const recovered = await recoverActivityTransaction(tempBaseDir);
    assert.equal(recovered, true);

    const readPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
    const readLedger = JSON.parse(await fs.readFile(ledgerPath, 'utf-8'));

    assert.equal(readPet.level, 3, 'Existing applied file must remain intact');
    assert.equal(readLedger.newState, true, 'Pending staged file must be rolled forward to destination');
  });

  it('cleans up transaction directory safely when crash occurred after replacements but before cleanup', async () => {
    const petPath = path.join(tempBaseDir, 'pet/state/pet.json');
    await fs.mkdir(path.dirname(petPath), { recursive: true });
    await fs.writeFile(petPath, JSON.stringify({ level: 4 }), 'utf-8');

    const txDir = path.join(tempBaseDir, ACTIVITY_TX_DIR);
    await fs.mkdir(path.join(txDir, 'staged'), { recursive: true });
    const manifest: ActivityTxManifest = {
      txId: 'tx-crash-after-apply',
      status: 'committed',
      files: ['pet/state/pet.json'],
      timestamp: new Date().toISOString(),
    };
    await fs.writeFile(path.join(txDir, 'tx.json'), JSON.stringify(manifest), 'utf-8');

    const recovered = await recoverActivityTransaction(tempBaseDir);
    assert.equal(recovered, true);

    const readPet = JSON.parse(await fs.readFile(petPath, 'utf-8'));
    assert.equal(readPet.level, 4);

    const txDirExists = await fs
      .access(txDir)
      .then(() => true)
      .catch(() => false);
    assert.equal(txDirExists, false, 'Dangling transaction directory must be purged');
  });
});
