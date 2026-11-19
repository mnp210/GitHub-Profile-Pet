import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  reconcileGitCommits,
} from '../../src/features/pet-engine/activity/index.ts';

describe('Commit Reconciliation Scale & Boundary Tests (Sprint 4.1)', () => {
  it('reconciles commits when scale exceeds the legacy 30-commit cutoff', async () => {
    // Generate mock commit log output with 100 distinct commits
    const mockCommits: string[] = [];
    const nowMs = Date.now();
    for (let i = 1; i <= 100; i++) {
      const sha = `sha${String(i).padStart(4, '0')}`;
      const timestamp = new Date(nowMs - i * 60000).toISOString();
      const message = `feat: scalable feature commit #${i}`;
      mockCommits.push(`${sha}\toctocat\tocto@cat.dev\t${message}\t${timestamp}`);
    }
    const mockStdout = mockCommits.join('\n');

    const result = await reconcileGitCommits({
      baseDir: process.cwd(),
      maxCommits: 500,
      execFn: async () => ({ stdout: mockStdout, stderr: '' }),
    });

    assert.equal(result.commits.length, 100);
    assert.equal(result.totalExamined, 100);
    assert.equal(result.latestSha, 'sha0001');
    assert.equal(result.commits[0].eventId, 'commit:sha0001');
    assert.equal(result.commits[99].eventId, 'commit:sha0100');
  });

  it('halts commit traversal immediately upon encountering stopAtSha checkpoint', async () => {
    // 50 commits total; stopAtSha is commit #15
    const mockCommits: string[] = [];
    const nowMs = Date.now();
    for (let i = 1; i <= 50; i++) {
      const sha = `sha${String(i).padStart(4, '0')}`;
      const timestamp = new Date(nowMs - i * 60000).toISOString();
      const message = `fix: commit #${i}`;
      mockCommits.push(`${sha}\talice\talice@dev.local\t${message}\t${timestamp}`);
    }
    const mockStdout = mockCommits.join('\n');

    const result = await reconcileGitCommits({
      baseDir: process.cwd(),
      maxCommits: 500,
      stopAtSha: 'sha0015',
      execFn: async () => ({ stdout: mockStdout, stderr: '' }),
    });

    // Should only include commits 1 through 14 (stopping before sha0015)
    assert.equal(result.commits.length, 14);
    assert.equal(result.totalExamined, 15);
    assert.equal(result.latestSha, 'sha0001');
    assert.equal(result.commits[13].eventId, 'commit:sha0014');
  });

  it('filters out stale commits older than the 14-day lookback window', async () => {
    const nowMs = Date.now();
    const freshTimestamp = new Date(nowMs - 2 * 24 * 3600 * 1000).toISOString(); // 2 days old
    const staleTimestamp = new Date(nowMs - 16 * 24 * 3600 * 1000).toISOString(); // 16 days old

    const mockStdout = [
      `freshsha001\tbob\tbob@dev.local\tfeat: recent work\t${freshTimestamp}`,
      `stalesha002\tbob\tbob@dev.local\tfeat: ancient work outside window\t${staleTimestamp}`,
    ].join('\n');

    const result = await reconcileGitCommits({
      baseDir: process.cwd(),
      maxCommits: 100,
      execFn: async () => ({ stdout: mockStdout, stderr: '' }),
    });

    assert.equal(result.commits.length, 1);
    assert.equal(result.commits[0].eventId, 'commit:freshsha001');
    assert.equal(result.commits[0].actor, 'bob');
  });

  it('filters out ignored automation commits, [skip ci], and known bot logins', async () => {
    const nowIso = new Date().toISOString();
    const mockStdout = [
      `qualifyingsha\tcarol\tcarol@dev.local\tfeat: legitimate user commit\t${nowIso}`,
      `skipcisha\tcarol\tcarol@dev.local\tdocs: update [skip ci]\t${nowIso}`,
      `ciskipsha\tcarol\tcarol@dev.local\tchore: build [ci skip]\t${nowIso}`,
      `botsha\tdependabot[bot]\tdependabot@github.com\tbump lodash\t${nowIso}`,
      `petstatesha\tgithub-actions[bot]\tactions@github.com\tpet: update state\t${nowIso}`,
    ].join('\n');

    const result = await reconcileGitCommits({
      baseDir: process.cwd(),
      maxCommits: 50,
      execFn: async () => ({ stdout: mockStdout, stderr: '' }),
    });

    assert.equal(result.commits.length, 1);
    assert.equal(result.commits[0].eventId, 'commit:qualifyingsha');
    assert.equal(result.commits[0].actor, 'carol');
  });
});
