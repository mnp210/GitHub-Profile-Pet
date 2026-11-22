import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  executeActivityProcessing,
  initDefaultActivityLedger,
} from '../../src/features/pet-engine/activity/index.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

function createInitialPetState(name: string): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name,
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
    lastInteractionTime: '2026-11-19T00:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-19T00:00:00.000Z',
    lastWelcomeBonusClaimedAt: '2026-11-19T00:00:00.000Z',
    updatedAt: '2026-11-19T00:00:00.000Z',
  };
}

describe('Authoritative Repository State & Isolation - Integration Tests', () => {
  let testRoot: string;
  let repoADir: string;
  let repoBDir: string;

  before(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-isolation-test-'));
    repoADir = path.join(testRoot, 'repo-a');
    repoBDir = path.join(testRoot, 'repo-b');

    // Setup Repo A
    await fs.mkdir(path.join(repoADir, 'pet', 'state'), { recursive: true });
    await fs.mkdir(path.join(repoADir, 'pet', 'ledger'), { recursive: true });
    await fs.writeFile(
      path.join(repoADir, 'pet', 'state', 'pet.json'),
      JSON.stringify(createInitialPetState('Shadow Claw A'), null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(repoADir, 'pet', 'ledger', 'activity.json'),
      JSON.stringify(initDefaultActivityLedger(1), null, 2),
      'utf-8'
    );

    // Setup Repo B
    await fs.mkdir(path.join(repoBDir, 'pet', 'state'), { recursive: true });
    await fs.mkdir(path.join(repoBDir, 'pet', 'ledger'), { recursive: true });
    await fs.writeFile(
      path.join(repoBDir, 'pet', 'state', 'pet.json'),
      JSON.stringify(createInitialPetState('Shadow Claw B'), null, 2),
      'utf-8'
    );
    await fs.writeFile(
      path.join(repoBDir, 'pet', 'ledger', 'activity.json'),
      JSON.stringify(initDefaultActivityLedger(1), null, 2),
      'utf-8'
    );
  });

  after(async () => {
    if (testRoot) {
      await fs.rm(testRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('guarantees state and ledger isolation between two distinct repositories', async () => {
    const sharedCommitSha = 'abc1234567890123456789012345678901234567';

    // 1. Process commit in Repo A
    const resA1 = await executeActivityProcessing({
      baseDir: repoADir,
      event: {
        eventId: sharedCommitSha,
        eventType: 'commit',
        actor: 'devA',
        commitMessage: 'feat: add feature in repo A',
      },
      skipSvgRender: true,
    });

    assert.equal(resA1.result.status, 'rewarded');
    assert.equal(resA1.result.xpAwarded, 15);
    assert.equal(resA1.petState.xp, 15);

    // Verify Repo B was not touched
    const rawPetB = await fs.readFile(path.join(repoBDir, 'pet', 'state', 'pet.json'), 'utf-8');
    const petB = JSON.parse(rawPetB);
    assert.equal(petB.xp, 0);
    assert.equal(petB.name, 'Shadow Claw B');

    // 2. Process the SAME commit SHA in Repo B
    // Because deduplication is strictly repository-scoped, Repo B must award full XP
    const resB1 = await executeActivityProcessing({
      baseDir: repoBDir,
      event: {
        eventId: sharedCommitSha,
        eventType: 'commit',
        actor: 'devB',
        commitMessage: 'feat: cherry-picked commit into repo B',
      },
      skipSvgRender: true,
    });

    assert.equal(resB1.result.status, 'rewarded');
    assert.equal(resB1.result.xpAwarded, 15);
    assert.equal(resB1.petState.xp, 15);

    // 3. Process the commit in Repo A a second time (must be deduplicated in Repo A)
    const resA2 = await executeActivityProcessing({
      baseDir: repoADir,
      event: {
        eventId: sharedCommitSha,
        eventType: 'commit',
        actor: 'devA',
        commitMessage: 'replay commit in repo A',
      },
      skipSvgRender: true,
    });

    assert.equal(resA2.result.status, 'skipped_duplicate');
    assert.equal(resA2.result.xpAwarded, 0);
    assert.equal(resA2.petState.xp, 15);
  });

  it('persists state and ledger updates reliably to disk with reload integrity', async () => {
    const issueEventId = '105';

    await executeActivityProcessing({
      baseDir: repoADir,
      event: {
        eventId: issueEventId,
        eventType: 'issue_opened',
        actor: 'tester1',
        details: 'Found a visual glitch',
      },
      skipSvgRender: true,
    });

    // Re-read directly from disk
    const onDiskStateRaw = await fs.readFile(path.join(repoADir, 'pet', 'state', 'pet.json'), 'utf-8');
    const onDiskState = JSON.parse(onDiskStateRaw);
    assert.equal(onDiskState.xp, 25); // 15 from commit + 10 from issue = 25 XP

    const onDiskLedgerRaw = await fs.readFile(path.join(repoADir, 'pet', 'ledger', 'activity.json'), 'utf-8');
    const onDiskLedger = JSON.parse(onDiskLedgerRaw);
    assert.ok(onDiskLedger.processedRegistry.issueNumbers.includes(105));
    assert.equal(onDiskLedger.recentEvents.length, 3); // 2 events + 1 duplicate skip
  });

  it('fails gracefully when executed on an uninitialized repository path', async () => {
    const emptyRepoDir = path.join(testRoot, 'uninitialized-repo');
    await fs.mkdir(emptyRepoDir, { recursive: true });

    await assert.rejects(
      async () => {
        await executeActivityProcessing({
          baseDir: emptyRepoDir,
          event: {
            eventId: 'some-sha',
            eventType: 'commit',
            actor: 'dev',
          },
          skipSvgRender: true,
        });
      },
      {
        message: /Failed to load authoritative pet state/,
      }
    );
  });
});
