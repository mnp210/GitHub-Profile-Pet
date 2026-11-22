import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  writeStepSummary,
  sanitizeSecrets,
  escapeMarkdown,
  formatActivitySummary,
  formatActivityFailureSummary,
  formatPublisherSummary,
  formatPublisherFailureSummary,
  formatInboxSummary,
  formatInboxFailureSummary,
} from '../../src/features/pet-engine/reporting/stepSummary.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

describe('GitHub Actions Step Summaries & Execution Telemetry', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-test-'));
    originalEnv = process.env.GITHUB_STEP_SUMMARY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_STEP_SUMMARY = originalEnv;
    } else {
      delete process.env.GITHUB_STEP_SUMMARY;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Secret Sanitization', () => {
    it('redacts classic personal access tokens (ghp_)', () => {
      const input = 'Error connecting with ghp_123456789012345678901234567890123456 to origin';
      const output = sanitizeSecrets(input);
      assert.doesNotMatch(output, /ghp_/);
      assert.match(output, /\*\*\*REDACTED\*\*\*/);
    });

    it('redacts fine-grained personal access tokens (github_pat_)', () => {
      const input = 'Using token github_pat_11AAAAAAA_9876543210123456789012345678901234567890 for auth';
      const output = sanitizeSecrets(input);
      assert.doesNotMatch(output, /github_pat_/);
      assert.match(output, /\*\*\*REDACTED\*\*\*/);
    });

    it('redacts OAuth tokens (gho_)', () => {
      const input = 'Token gho_123456789012345678901234567890123456 expired';
      const output = sanitizeSecrets(input);
      assert.doesNotMatch(output, /gho_/);
      assert.match(output, /\*\*\*REDACTED\*\*\*/);
    });

    it('redacts Bearer and generic token authorization values', () => {
      const input = 'Authorization: Bearer secret_token_value_longer_than_20_chars_here';
      const output = sanitizeSecrets(input);
      assert.doesNotMatch(output, /secret_token_value/);
      assert.match(output, /Bearer \*\*\*REDACTED\*\*\*/);
    });

    it('handles empty or clean text safely', () => {
      assert.equal(sanitizeSecrets(''), '');
      assert.equal(sanitizeSecrets('Normal commit message without secrets'), 'Normal commit message without secrets');
    });
  });

  describe('Markdown Escaping', () => {
    it('escapes table pipes to prevent column corruption', () => {
      const input = 'Fix issue | add tests | update docs';
      const output = escapeMarkdown(input);
      assert.equal(output, 'Fix issue \\| add tests \\| update docs');
    });

    it('escapes HTML angle brackets to prevent injection', () => {
      const input = '<script>alert(1)</script> <component>';
      const output = escapeMarkdown(input);
      assert.equal(output, '&lt;script&gt;alert(1)&lt;/script&gt; &lt;component&gt;');
    });

    it('converts newlines to <br/> tags for markdown table compatibility', () => {
      const input = 'Line 1\nLine 2\r\nLine 3';
      const output = escapeMarkdown(input);
      assert.equal(output, 'Line 1<br/>Line 2<br/>Line 3');
    });
  });

  describe('writeStepSummary File Operations', () => {
    it('returns false when no path is provided and GITHUB_STEP_SUMMARY is unset', () => {
      delete process.env.GITHUB_STEP_SUMMARY;
      const result = writeStepSummary('# Test Summary');
      assert.equal(result, false);
    });

    it('appends content to custom file path when provided', () => {
      const summaryFile = path.join(tempDir, 'summary.md');
      const result = writeStepSummary('### Hello Summary', summaryFile);
      assert.equal(result, true);

      const content = fs.readFileSync(summaryFile, 'utf8');
      assert.match(content, /### Hello Summary/);
    });

    it('appends content to process.env.GITHUB_STEP_SUMMARY when set', () => {
      const summaryFile = path.join(tempDir, 'github_summary.md');
      process.env.GITHUB_STEP_SUMMARY = summaryFile;

      const result1 = writeStepSummary('### Section 1');
      const result2 = writeStepSummary('### Section 2');
      assert.equal(result1, true);
      assert.equal(result2, true);

      const content = fs.readFileSync(summaryFile, 'utf8');
      assert.match(content, /### Section 1/);
      assert.match(content, /### Section 2/);
    });

    it('gracefully handles file system write failures without throwing', () => {
      // Direct path to a directory (cannot append to dir as file)
      const invalidPath = tempDir;
      const result = writeStepSummary('Test', invalidPath);
      assert.equal(result, false);
    });
  });

  describe('Activity Progression Summary Formatter', () => {
    const mockInitialPet: PetStateDocument = {
      schemaVersion: 1,
      generation: 35,
      name: 'Shadow Claw',
      species: 'shadow_claw',
      level: 3,
      xp: 275,
      maxExp: 350,
      energy: 80,
      energyAccumulator: 0,
      hunger: 70,
      happiness: 85,
      mood: 'Happy',
      evolutionStage: 'Juvenile',
      lastInteractionTime: '2026-11-22T20:00:00.000Z',
      lastOfflineResolutionTime: null,
      lastWelcomeBonusClaimedAt: null,
      updatedAt: '2026-11-22T20:00:00.000Z',
    };

    const mockUpdatedPet: PetStateDocument = {
      ...mockInitialPet,
      level: 4,
      xp: 365,
      generation: 36,
    };

    it('formats a complete activity summary with state transition, events, and publication', () => {
      const summary = formatActivitySummary({
        eventName: 'push',
        targetRef: 'main',
        dryRun: false,
        eventsCount: 2,
        totalXpAwarded: 90,
        initialPetState: mockInitialPet,
        updatedPetState: mockUpdatedPet,
        processedEvents: [
          {
            eventType: 'commit',
            eventId: 'commit:3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52',
            actor: 'octocat',
            xpAwarded: 50,
            status: 'rewarded',
            details: 'feat: add telemetry summaries',
          },
          {
            eventType: 'pr_merged',
            eventId: 'pr_merged:42',
            actor: 'octocat',
            xpAwarded: 40,
            status: 'rewarded',
            details: 'Merged PR #42: Feature release',
          },
        ],
        reconciliation: {
          commitsDiscovered: 1,
          issuesDiscovered: 0,
          prsDiscovered: 1,
          reviewsDiscovered: 0,
          lastCommitSha: '3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52',
          completedFully: true,
        },
        publication: {
          status: 'COMMITTED_AND_PUSHED',
          commitSha: '990607837ac95617411190fd15cf895793cfcebd',
          modifiedFiles: ['pet/state/pet.json', 'public/pet.svg'],
          destinationRef: 'main',
        },
      });

      assert.match(summary, /### 🐾 GitHub Profile Pet — Activity Progression Summary/);
      assert.match(summary, /Shadow Claw/);
      assert.match(summary, /Level 4 🌟 \(Level Up!\)/);
      assert.match(summary, /\+90 XP/);
      assert.match(summary, /G35 → G36/);
      assert.match(summary, /commit:3c7fc20fa2d32409d319/);
      assert.match(summary, /@octocat/);
      assert.match(summary, /COMMITTED_AND_PUSHED/);
      assert.match(summary, /990607837ac95617411190fd15cf895793cfcebd/);
    });

    it('formats a clean NO-OP summary when 0 events evaluated', () => {
      const summary = formatActivitySummary({
        eventName: 'schedule',
        targetRef: 'main',
        dryRun: false,
        eventsCount: 0,
        totalXpAwarded: 0,
        initialPetState: mockInitialPet,
        updatedPetState: mockInitialPet,
        processedEvents: [],
        publication: {
          status: 'NO_CHANGES_COMMITTED',
        },
        notes: 'No qualifying activity events found in execution context.',
      });

      assert.match(summary, /No qualifying events detected/);
      assert.match(summary, /NO_CHANGES_COMMITTED/);
    });

    it('formats an activity failure summary with recovery guidance', () => {
      const summary = formatActivityFailureSummary({
        eventName: 'push',
        targetRef: 'main',
        stage: 'git_publication',
        error: new Error('Remote push rejected due to non-fast-forward conflict'),
      });

      assert.match(summary, /### ❌ GitHub Profile Pet — Activity Progression Failed/);
      assert.match(summary, /Remote push rejected/);
      assert.match(summary, /git_publication/);
      assert.match(summary, /Diagnostic & Recovery Steps/);
    });
  });

  describe('SVG Publication Summary Formatter', () => {
    const mockPet: PetStateDocument = {
      schemaVersion: 1,
      generation: 35,
      name: 'Shadow Claw',
      species: 'shadow_claw',
      level: 3,
      xp: 275,
      maxExp: 350,
      energy: 80,
      energyAccumulator: 0,
      hunger: 70,
      happiness: 85,
      mood: 'Happy',
      evolutionStage: 'Juvenile',
      lastInteractionTime: '2026-11-22T20:00:00.000Z',
      lastOfflineResolutionTime: null,
      lastWelcomeBonusClaimedAt: null,
      updatedAt: '2026-11-22T20:00:00.000Z',
    };

    it('formats published pipeline run with contribution sync metrics', () => {
      const summary = formatPublisherSummary({
        mode: 'passive_simulation',
        targetRef: 'main',
        dryRun: false,
        skipPush: false,
        status: 'published',
        details: 'Simulated 1 hour vitals and published badge.svg',
        commitSha: '3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52',
        stagedFiles: ['pet/state/pet.json', 'public/pet.svg', 'README.md'],
        petState: mockPet,
        syncResult: {
          incrementsEvaluated: 1,
          xpAwarded: 15,
          satietyAwarded: 5,
          deltaObserved: 2,
          queryCost: 1,
          rateLimitRemaining: 4980,
          latencyMs: 142,
        },
      });

      assert.match(summary, /### 🎨 GitHub Profile Pet — SVG Publication & Simulation Summary/);
      assert.match(summary, /PUBLISHED/);
      assert.match(summary, /Shadow Claw/);
      assert.match(summary, /4,980/);
      assert.match(summary, /142 ms/);
      assert.match(summary, /3c7fc20fa2d32409d3194b3b98fbe13d1f34ff52/);
    });

    it('formats publisher failure summary', () => {
      const summary = formatPublisherFailureSummary({
        mode: 'passive_simulation',
        targetRef: 'main',
        status: 'manifest_mismatch',
        details: 'Expected 5 files in atomic manifest',
        error: new Error('Staged file list does not match authorized set'),
      });

      assert.match(summary, /### ❌ GitHub Profile Pet — SVG Publication Failed/);
      assert.match(summary, /MANIFEST_MISMATCH/);
      assert.match(summary, /Expected 5 files in atomic manifest/);
    });
  });

  describe('Action Inbox Summary Formatter', () => {
    it('formats inbox drainage metrics and publication status', () => {
      const summary = formatInboxSummary({
        targetRef: 'main',
        dryRun: false,
        status: 'published',
        details: 'Processed 2 pet care action issues',
        commitSha: '1234567890abcdef',
        stagedFiles: ['pet/state/pet.json', 'pet/ledger/actions.json'],
        inboxResult: {
          scannedCount: 3,
          processedCount: 2,
          acceptedCount: 2,
          rejectedCount: 0,
          duplicateCount: 1,
          quarantinedCount: 0,
          newHighWaterMark: 104,
          queueDrained: true,
          hasMorePending: false,
          savedGeneration: 36,
        },
      });

      assert.match(summary, /### 📥 GitHub Profile Pet — Action Inbox Drainage Summary/);
      assert.match(summary, /Total Issues Scanned/);
      assert.match(summary, /Accepted Actions.*2 ✅/);
      assert.match(summary, /Duplicate Actions.*1 🔄/);
      assert.match(summary, /High-Water Mark.*Issue #104/);
      assert.match(summary, /Fully Drained/);
      assert.match(summary, /G36/);
    });

    it('formats inbox failure summary', () => {
      const summary = formatInboxFailureSummary({
        targetRef: 'main',
        status: 'identity_resolution_failed',
        details: 'Failed to resolve trusted trainer identity',
      });

      assert.match(summary, /### ❌ GitHub Profile Pet — Action Inbox Drainage Failed/);
      assert.match(summary, /IDENTITY_RESOLUTION_FAILED/);
    });
  });
});
