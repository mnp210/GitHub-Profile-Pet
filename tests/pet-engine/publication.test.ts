import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  MalformedReadmeMarkersError,
  README_MARKER_END,
  README_MARKER_START,
  extractReadmePetSnippet,
  generateReadmeEmbedSnippet,
  publishPetSvg,
  updateReadmeContent,
} from '../../src/features/pet-engine/publication/index.ts';
import { assertValidSvgOutput } from '../../src/features/pet-engine/rendering/index.ts';
import type { PetStateDocument } from '../../src/features/pet-engine/domain/types.ts';

function createValidPetState(): PetStateDocument {
  return {
    schemaVersion: 1,
    generation: 1,
    name: 'Shadow Claw',
    species: 'cat',
    level: 3,
    xp: 45,
    maxExp: 150,
    energy: 85,
    energyAccumulator: 0,
    hunger: 75,
    happiness: 90,
    mood: 'Happy',
    evolutionStage: 'Hatchling',
    lastInteractionTime: '2026-11-15T12:00:00.000Z',
    lastOfflineResolutionTime: '2026-11-15T12:00:00.000Z',
    lastWelcomeBonusClaimedAt: null,
    updatedAt: '2026-11-15T12:00:00.000Z',
  };
}

describe('GitHub Actions Runtime & Safe SVG Publication (Phase 3A)', () => {
  // 1. Workflow YAML configuration and permission validation
  it('TC-PUB-01: Workflow configuration enforces least-privilege permissions, concurrency, and bounded timeouts', async () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'pet-publisher.yml');
    const content = await fs.readFile(workflowPath, 'utf-8');

    // Least privilege: permissions: contents: write
    assert(
      content.includes('permissions:\n  contents: write') ||
        content.includes('permissions:\r\n  contents: write'),
      'Workflow must define explicit least-privilege permissions: contents: write'
    );
    assert(!content.includes('write-all'), 'Workflow must strictly avoid write-all permission');

    // Concurrency control
    assert(
      content.includes('concurrency:'),
      'Workflow must define a concurrency group'
    );
    assert(
      content.includes('cancel-in-progress: false'),
      'Workflow concurrency must set cancel-in-progress: false'
    );

    // Bounded timeouts
    assert(
      content.includes('timeout-minutes: 5'),
      'Workflow job must define a bounded timeout of 5 minutes'
    );

    // Triggers
    assert(content.includes('schedule:'), 'Workflow must include a schedule trigger');
    assert(
      content.includes("cron: '47 * * * *'"),
      'Workflow schedule must run hourly at offset minute 47 to mitigate top-of-hour GitHub Actions spikes'
    );
    assert(
      !content.includes("cron: '23 */6 * * *'"),
      'Workflow schedule must not include obsolete 6-hour cron (F-04 schedule cleanup)'
    );
    assert(content.includes('workflow_dispatch:'), 'Workflow must support manual workflow_dispatch');

    // Idempotent commit checks
    assert(
      content.includes('[skip ci]'),
      'Automated commits include [skip ci] convention for external CI pipelines'
    );
    assert(
      !content.includes('--force'),
      'Workflow must NEVER use git push --force'
    );
  });

  // 2. Deterministic SVG generation and safe publication
  it('TC-PUB-02: Generates valid, deterministic SVG and writes to target path safely', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pub-test-'));

    try {
      const stateDir = path.join(tempDir, 'pet', 'state');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(stateDir, 'pet.json'),
        JSON.stringify(createValidPetState(), null, 2),
        'utf-8'
      );

      const result = await publishPetSvg({
        baseDir: tempDir,
        updateReadme: false,
      });

      assert.equal(result.svgWritten, true);
      assert.equal(result.svgChanged, true);
      assert.equal(result.petName, 'Shadow Claw');
      assert.equal(result.species, 'cat');
      assert.equal(result.level, 3);
      assert.equal(result.evolutionStage, 'Hatchling');

      // Verify written SVG
      const writtenSvg = await fs.readFile(result.svgPath, 'utf-8');
      assertValidSvgOutput(writtenSvg);
      assert(writtenSvg.includes('Shadow Claw'));
      assert(writtenSvg.includes('LVL 3'));
      assert(writtenSvg.includes('Hatchling'));
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 3. Invalid pet state document rejection
  it('TC-PUB-03: Rejects invalid or corrupted pet state documents before file publication', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pub-test-'));

    try {
      const stateDir = path.join(tempDir, 'pet', 'state');
      await fs.mkdir(stateDir, { recursive: true });

      // Out-of-bounds energy (999)
      const corruptedState = createValidPetState();
      corruptedState.energy = 999;

      await fs.writeFile(
        path.join(stateDir, 'pet.json'),
        JSON.stringify(corruptedState, null, 2),
        'utf-8'
      );

      await assert.rejects(
        () => publishPetSvg({ baseDir: tempDir, updateReadme: false }),
        /energy must be an integer between 0 and 100/
      );

      // Verify no target file was written
      const targetExists = await fs
        .access(path.join(tempDir, 'public', 'pet.svg'))
        .then(() => true)
        .catch(() => false);
      assert.equal(targetExists, false, 'Target SVG must not exist after failed validation');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 4. Atomic publication safety — no partial or corrupted file on failure
  it('TC-PUB-04: Atomic publication safety preserves existing SVG on disk if rendering fails', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pub-test-'));

    try {
      const stateDir = path.join(tempDir, 'pet', 'state');
      const publicDir = path.join(tempDir, 'public');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.mkdir(publicDir, { recursive: true });

      // Pre-existing valid SVG on disk
      const existingSvgContent = '<svg xmlns="http://www.w3.org/2000/svg"><title>Original</title></svg>';
      const targetPath = path.join(publicDir, 'pet.svg');
      await fs.writeFile(targetPath, existingSvgContent, 'utf-8');

      // Write invalid unparseable state
      await fs.writeFile(path.join(stateDir, 'pet.json'), '{ invalid json ...', 'utf-8');

      await assert.rejects(
        () => publishPetSvg({ baseDir: tempDir, updateReadme: false }),
        /Failed to parse JSON in pet state document/
      );

      // Verify pre-existing file was NOT replaced or corrupted
      const currentContent = await fs.readFile(targetPath, 'utf-8');
      assert.equal(
        currentContent,
        existingSvgContent,
        'Original SVG must remain unchanged after failure'
      );

      // Verify no temporary files remain
      const files = await fs.readdir(publicDir);
      assert.deepEqual(files, ['pet.svg'], 'No temporary files should leak into directory');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 5. Idempotency — no unnecessary writes when output is unchanged
  it('TC-PUB-05: Idempotency avoids redundant writes when state and rendered output are identical', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pub-test-'));

    try {
      const stateDir = path.join(tempDir, 'pet', 'state');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(stateDir, 'pet.json'),
        JSON.stringify(createValidPetState(), null, 2),
        'utf-8'
      );

      // First run: writes SVG
      const res1 = await publishPetSvg({ baseDir: tempDir, updateReadme: false });
      assert.equal(res1.svgWritten, true);
      assert.equal(res1.svgChanged, true);

      const stat1 = await fs.stat(res1.svgPath);

      // Second run on identical state
      const res2 = await publishPetSvg({ baseDir: tempDir, updateReadme: false });
      assert.equal(res2.svgWritten, true);
      assert.equal(res2.svgChanged, false); // No change detected

      const stat2 = await fs.stat(res2.svgPath);
      assert.equal(stat1.mtimeMs, stat2.mtimeMs, 'File mtime must not change when content is identical');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 6. Strict preservation of unrelated README content
  it('TC-PUB-06: Strict preservation of unrelated README content before and after markers', () => {
    const existingReadme = [
      '# My Project Portfolio',
      '',
      'Welcome to my open source repositories.',
      '',
      '## Featured Projects',
      '- Next.js application',
      '- Embedded database',
      '',
      README_MARKER_START,
      '<p align="center">Old outdated pet image</p>',
      README_MARKER_END,
      '',
      '## Contact Information',
      'Reach out via email or Twitter.',
      '',
      '```typescript',
      'const code = "must be preserved";',
      '```',
    ].join('\n');

    const result = updateReadmeContent(existingReadme, 'public/pet.svg');
    assert.equal(result.markersFound, true);
    assert.equal(result.changed, true);

    // Verify content before start marker is 100% identical
    const startIndex = existingReadme.indexOf(README_MARKER_START);
    const originalBefore = existingReadme.slice(0, startIndex);
    assert(result.content.startsWith(originalBefore));

    // Verify content after end marker is 100% identical
    const endIndex = existingReadme.indexOf(README_MARKER_END) + README_MARKER_END.length;
    const originalAfter = existingReadme.slice(endIndex);
    assert(result.content.endsWith(originalAfter));

    // Verify updated embed snippet
    assert(result.content.includes('<img src="public/pet.svg"'));
    assert(!result.content.includes('Old outdated pet image'));

    // Verify snippet generators and extractors
    const expectedSnippet = generateReadmeEmbedSnippet('public/pet.svg', '\n');
    const extractedSnippet = extractReadmePetSnippet(result.content);
    assert.equal(extractedSnippet, expectedSnippet);

    // Re-running on the result produces changed: false (idempotent)
    const idempotentResult = updateReadmeContent(result.content, 'public/pet.svg');
    assert.equal(idempotentResult.changed, false);
    assert.equal(idempotentResult.content, result.content);
  });

  // 7. Safe handling when README has no markers
  it('TC-PUB-07: Leaves README 100% untouched when no markers are present', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pub-test-'));

    try {
      const stateDir = path.join(tempDir, 'pet', 'state');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(stateDir, 'pet.json'),
        JSON.stringify(createValidPetState(), null, 2),
        'utf-8'
      );

      const customReadme = '# My Personal Profile\n\nI love programming in TypeScript!\n';
      const readmePath = path.join(tempDir, 'README.md');
      await fs.writeFile(readmePath, customReadme, 'utf-8');

      const result = await publishPetSvg({
        baseDir: tempDir,
        updateReadme: true,
      });

      assert.equal(result.svgWritten, true);
      assert.equal(result.readmeUpdated, false);
      assert.equal(result.readmeChanged, false);

      // Verify file on disk was not modified
      const currentReadme = await fs.readFile(readmePath, 'utf-8');
      assert.equal(currentReadme, customReadme);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  // 8. Malformed README marker detection & rejection
  it('TC-PUB-08: Throws MalformedReadmeMarkersError when markers are unbalanced or corrupted', () => {
    // Missing end marker
    assert.throws(
      () => updateReadmeContent(`Text before\n${README_MARKER_START}\nNo end marker here.`),
      MalformedReadmeMarkersError
    );

    // Missing start marker
    assert.throws(
      () => updateReadmeContent(`Text before\nNo start marker here.\n${README_MARKER_END}`),
      MalformedReadmeMarkersError
    );

    // Inverted markers (end before start)
    assert.throws(
      () => updateReadmeContent(`${README_MARKER_END}\ncontent\n${README_MARKER_START}`),
      MalformedReadmeMarkersError
    );

    // Duplicate start markers
    assert.throws(
      () => updateReadmeContent(`${README_MARKER_START}\ncontent\n${README_MARKER_START}\n${README_MARKER_END}`),
      MalformedReadmeMarkersError
    );

    // Duplicate end markers
    assert.throws(
      () => updateReadmeContent(`${README_MARKER_START}\ncontent\n${README_MARKER_END}\n${README_MARKER_END}`),
      MalformedReadmeMarkersError
    );
  });

  // 9. Safe publication contract: atomic fast-forward-only push without unsafe rebase or force-push
  it('TC-PUB-09: Publication workflow delegates to safe publish-pipeline and never uses unsafe fetch, rebase, or force-push', async () => {
    // Verify the workflow push script contract
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'pet-publisher.yml');
    const content = await fs.readFile(workflowPath, 'utf-8');

    // Asserts invocation of safe publish-pipeline
    assert(
      content.includes('publish-pipeline.ts'),
      'Workflow must invoke scripts/publish-pipeline.ts'
    );

    // Asserts complete elimination of unsafe git rebase and fetch loops
    assert(
      !content.includes('git rebase'),
      'Workflow must strictly eliminate unsafe git rebase retry loops'
    );
    assert(
      !content.includes('git fetch'),
      'Workflow must not fetch and reconcile remote state mid-pipeline'
    );

    // Asserts strictly never force-pushing
    assert(
      !content.includes('--force'),
      'Workflow must strictly never use --force or --force-with-lease'
    );
  });

  // 10. Security and credential isolation
  it('TC-PUB-10: Publication engine and workflow maintain strict credential isolation with zero token leaks', async () => {
    const workflowPath = path.join(process.cwd(), '.github', 'workflows', 'pet-publisher.yml');
    const workflowContent = await fs.readFile(workflowPath, 'utf-8');

    // No personal access token references
    assert(
      !workflowContent.includes('PAT') && !workflowContent.includes('PERSONAL_ACCESS_TOKEN'),
      'Workflow must not request or require Personal Access Tokens'
    );

    // Uses ephemeral GITHUB_TOKEN
    assert(
      workflowContent.includes('${{ secrets.GITHUB_TOKEN }}'),
      'Workflow must use ephemeral repository GITHUB_TOKEN'
    );

    // Run publisher and inspect output for security
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-pub-test-'));
    try {
      const stateDir = path.join(tempDir, 'pet', 'state');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(stateDir, 'pet.json'),
        JSON.stringify(createValidPetState(), null, 2),
        'utf-8'
      );

      const result = await publishPetSvg({ baseDir: tempDir, updateReadme: false });
      const svg = await fs.readFile(result.svgPath, 'utf-8');

      // Assert no security credentials or private data in SVG
      assert(!svg.includes('ghp_'), 'SVG must not contain GitHub personal access tokens');
      assert(!svg.includes('ghs_'), 'SVG must not contain GitHub server tokens');
      assert(!svg.includes('Bearer'), 'SVG must not contain Bearer tokens');
      assert(!svg.includes('privateTotal'), 'SVG must not contain private contribution totals');
      assert(!svg.includes('<script'), 'SVG must not contain <script>');
      assert(!svg.includes('<foreignObject'), 'SVG must not contain <foreignObject>');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
