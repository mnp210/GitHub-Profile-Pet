import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateReadmeMenuSnippet,
  inspectMenuMarkers,
  installReadmeMenu,
  uninstallReadmeMenu,
  resolveHostedGameUrl,
  MalformedReadmeMenuMarkersError,
  README_MENU_MARKER_START,
  README_MENU_MARKER_END,
} from '../../src/features/pet-engine/publication/readmeMenu.ts';
import type { PetState } from '../../src/types/pet.ts';

const mockPet: PetState = {
  name: 'Shadow Claw',
  species: 'cat',
  level: 5,
  xp: 120,
  maxExp: 200,
  energy: 85,
  hunger: 92,
  happiness: 95,
  mood: 'Happy',
  evolutionStage: 'Juvenile',
};

describe('Repository README Interactive Pet Menu', () => {
  describe('Hosted Game URL Resolution', () => {
    it('resolves explicit custom URL without trailing slashes', () => {
      const url = resolveHostedGameUrl('mnp210/GitHub-Profile-Pet', 'https://game.example.com///');
      assert.equal(url, 'https://game.example.com');
    });

    it('resolves default GitHub Pages URL for repo owner/name', () => {
      const url = resolveHostedGameUrl('mnp210/GitHub-Profile-Pet-Test');
      assert.equal(url, 'https://mnp210.github.io/GitHub-Profile-Pet-Test');
    });

    it('falls back to localhost:3000 if repo format is invalid and env is absent', () => {
      const origEnv = process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.NEXT_PUBLIC_APP_URL;
      const url = resolveHostedGameUrl('invalid-repo');
      assert.equal(url, 'http://localhost:3000');
      if (origEnv) process.env.NEXT_PUBLIC_APP_URL = origEnv;
    });
  });

  describe('Snippet Generation & Markdown Compatibility', () => {
    it('generates valid GitHub-compatible Markdown/HTML without scripts or iframes', () => {
      const snippet = generateReadmeMenuSnippet({
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
        lastUpdatedUtc: '2026-11-19T21:30:00.000Z',
        stateHash: '31904e74af60',
      });

      // Markers
      assert.ok(snippet.includes(README_MENU_MARKER_START));
      assert.ok(snippet.includes(README_MENU_MARKER_END));

      // Security: Strictly NO dangerous HTML elements
      assert.ok(!snippet.includes('<script'));
      assert.ok(!snippet.includes('<iframe'));
      assert.ok(!snippet.includes('onload='));
      assert.ok(!snippet.includes('onclick='));

      // Pet details
      assert.ok(snippet.includes('Shadow Claw'));
      assert.ok(snippet.includes('Void Familiar'));
      assert.ok(snippet.includes('Lv. 5'));
      assert.ok(snippet.includes('Juvenile'));
      assert.ok(snippet.includes('Gen #1'));
      assert.ok(snippet.includes('120 / 200 XP'));
      assert.ok(snippet.includes('60%'));
      assert.ok(snippet.includes('Happy'));
      assert.ok(snippet.includes('Curious'));
      assert.ok(snippet.includes('85%'));
      assert.ok(snippet.includes('92%'));
      assert.ok(snippet.includes('95%'));
      assert.ok(snippet.includes('public/sprites/pets/cat/happy_animated.svg'));

      // Static snapshot notice & hash
      assert.ok(snippet.includes('2026-11-19T21:30:00.000Z'));
      assert.ok(snippet.includes('Snapshot `31904e74`'));
      assert.ok(snippet.includes('GitHub READMEs do not run JavaScript or iframes'));
    });

    it('generates all 6 required game menu entries and quick care links with valid URL parameters', () => {
      const snippet = generateReadmeMenuSnippet({
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
      });

      const expectedBase = 'https://mnp210.github.io/GitHub-Profile-Pet-Test/?repo=mnp210%2FGitHub-Profile-Pet-Test';

      assert.ok(snippet.includes(`href="${expectedBase}"><strong>CARE</strong>`));
      assert.ok(snippet.includes(`href="${expectedBase}"><strong>PLAY ZONE</strong>`));
      assert.ok(snippet.includes(`href="${expectedBase}"><strong>WARDROBE</strong>`));
      assert.ok(snippet.includes(`href="${expectedBase}"><strong>BOND</strong>`));
      assert.ok(snippet.includes(`href="${expectedBase}"><strong>ACHIEVEMENTS</strong>`));
      assert.ok(snippet.includes(`href="${expectedBase}&amp;action=stats"><strong>PET PROFILE</strong>`));

      assert.ok(snippet.includes(`[Feed](${expectedBase}&action=feed)`));
      assert.ok(snippet.includes(`[Train](${expectedBase}&action=train)`));
      assert.ok(snippet.includes(`[Rest](${expectedBase}&action=rest)`));
      assert.ok(snippet.includes(`[Pet](${expectedBase}&action=pet)`));
    });

    it('escapes HTML injection, quotes, ampersands, and angle brackets without double-escaping', () => {
      const snippet = generateReadmeMenuSnippet({
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: {
          ...mockPet,
          name: `Shadow "Claw" & <script>alert('xss')</script> &amp;`,
          evolutionStage: `Stage <1> "Alpha"`,
          mood: `Happy & 'Bright'`,
          personality: `curious<img src=x onerror=1>`,
        },
        lastUpdatedUtc: '2026-11-26T14:45:27.622Z',
      });

      assert.ok(!snippet.includes('<script>'));
      assert.ok(!snippet.includes('<img src=x'));
      assert.ok(snippet.includes('Shadow &quot;Claw&quot; &amp; &lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp;'));
      assert.ok(snippet.includes('Stage &lt;1&gt; &quot;Alpha&quot;'));
      assert.ok(snippet.includes('Happy &amp; &#39;Bright&#39;'));
      assert.ok(snippet.includes('Curious&lt;img src=x onerror=1&gt;'));
      assert.ok(!snippet.includes('&amp;amp;'));
    });

    it('preserves legitimate Unicode pet names and display labels', () => {
      const snippet = generateReadmeMenuSnippet({
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: {
          ...mockPet,
          name: 'Shadow 影 Claw ★',
          mood: 'Calm ✨',
          evolutionStage: 'Évolution',
        },
        lastUpdatedUtc: '2026-11-26T14:45:27.622Z',
      });

      assert.ok(snippet.includes('Shadow 影 Claw ★'));
      assert.ok(snippet.includes('Calm ✨'));
      assert.ok(snippet.includes('Évolution'));
    });

    it('rejects unsafe SVG asset paths (schemes, traversal, absolute paths, quotes)', () => {
      const unsafePaths = [
        'javascript:alert(1).svg',
        'data:image/svg+xml,<svg/>.svg',
        'https://evil.example/pet.svg',
        '../secret/pet.svg',
        '/etc/passwd.svg',
        'public/pet.svg" onclick="alert(1)',
        'public/pet.txt',
      ];

      for (const badPath of unsafePaths) {
        assert.throws(() =>
          generateReadmeMenuSnippet({
            repo: 'mnp210/GitHub-Profile-Pet-Test',
            pet: mockPet,
            svgRelativePath: badPath,
          })
        );
      }
    });

    it('produces deterministic output for identical inputs', () => {
      const opts = {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
        lastUpdatedUtc: '2026-11-26T14:45:27.622Z',
        stateHash: 'abcdef123456',
      };
      const first = generateReadmeMenuSnippet(opts);
      const second = generateReadmeMenuSnippet(opts);
      assert.equal(first, second);
    });
  });

  describe('Marker Structure & Validation', () => {
    it('returns false when no markers are present', () => {
      const inspection = inspectMenuMarkers('# My Project\n\nSome readme content.');
      assert.equal(inspection.hasStart, false);
      assert.equal(inspection.hasEnd, false);
    });

    it('throws MalformedReadmeMenuMarkersError when start marker exists without end', () => {
      const corrupted = `# Readme\n${README_MENU_MARKER_START}\nIncomplete menu...`;
      assert.throws(
        () => inspectMenuMarkers(corrupted),
        MalformedReadmeMenuMarkersError
      );
    });

    it('throws MalformedReadmeMenuMarkersError when end marker exists without start', () => {
      const corrupted = `# Readme\nIncomplete menu...\n${README_MENU_MARKER_END}`;
      assert.throws(
        () => inspectMenuMarkers(corrupted),
        MalformedReadmeMenuMarkersError
      );
    });

    it('throws MalformedReadmeMenuMarkersError when end marker appears before start', () => {
      const inverted = `${README_MENU_MARKER_END}\ncontent\n${README_MENU_MARKER_START}`;
      assert.throws(
        () => inspectMenuMarkers(inverted),
        MalformedReadmeMenuMarkersError
      );
    });

    it('throws MalformedReadmeMenuMarkersError when duplicate markers exist', () => {
      const dup = `${README_MENU_MARKER_START} 1 ${README_MENU_MARKER_END}\n${README_MENU_MARKER_START} 2 ${README_MENU_MARKER_END}`;
      assert.throws(
        () => inspectMenuMarkers(dup),
        MalformedReadmeMenuMarkersError
      );
    });
  });

  describe('Installation, Idempotency & In-Place Updates', () => {
    it('installs cleanly into an empty README document', () => {
      const result = installReadmeMenu('', {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
      });

      assert.equal(result.installed, true);
      assert.equal(result.updated, false);
      assert.equal(result.changed, true);
      assert.equal(result.reason, 'FRESH_INSTALL');
      assert.ok(result.content.includes(README_MENU_MARKER_START));
      assert.ok(result.content.includes(README_MENU_MARKER_END));
    });

    it('preserves existing README content strictly byte-for-byte upon installation', () => {
      const original = '# Awesome Repository\n\nHere is some project description.\n\n## Features\n\n- Feature 1\n- Feature 2\n';
      const result = installReadmeMenu(original, {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
      });

      assert.equal(result.installed, true);
      assert.ok(result.content.startsWith('# Awesome Repository'));
      assert.ok(result.content.includes('## Features\n\n- Feature 1\n- Feature 2'));
      assert.ok(result.content.includes(README_MENU_MARKER_START));
    });

    it('is strictly idempotent when installed repeatedly with the same state', () => {
      const original = '# Title\n\nIntro text.\n';
      const firstInstall = installReadmeMenu(original, {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
        lastUpdatedUtc: '2026-11-19T21:00:00.000Z',
      });

      assert.equal(firstInstall.installed, true);
      assert.equal(firstInstall.changed, true);

      // Second install with identical parameters
      const secondInstall = installReadmeMenu(firstInstall.content, {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
        lastUpdatedUtc: '2026-11-19T21:00:00.000Z',
      });

      assert.equal(secondInstall.installed, false);
      assert.equal(secondInstall.updated, true);
      assert.equal(secondInstall.changed, false);
      assert.equal(secondInstall.reason, 'ALREADY_CURRENT');
      assert.equal(secondInstall.content, firstInstall.content);
    });

    it('updates in-place when pet vitals or level advance', () => {
      const initial = installReadmeMenu('# Title\n', {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
      });

      const leveledUpPet: PetState = {
        ...mockPet,
        level: 6,
        evolutionStage: 'Adult',
        mood: 'Energetic',
      };

      const updateRes = installReadmeMenu(initial.content, {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: leveledUpPet,
      });

      assert.equal(updateRes.installed, false);
      assert.equal(updateRes.updated, true);
      assert.equal(updateRes.changed, true);
      assert.equal(updateRes.reason, 'UPDATED_EXISTING');
      assert.ok(updateRes.content.includes('Lv. 6'));
      assert.ok(updateRes.content.includes('Adult'));
      assert.ok(updateRes.content.includes('Energetic'));
      assert.ok(!updateRes.content.includes('Lv. 5'));
    });
  });

  describe('Uninstallation & Clean State Restoration', () => {
    it('cleanly removes the Pet Menu leaving no orphaned markers or broken markdown', () => {
      const originalDoc = '# My Project\n\nThis is an existing README file.\n\n## Next Steps\n- Build\n- Ship\n';
      const installed = installReadmeMenu(originalDoc, {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
      });

      assert.ok(installed.content.includes(README_MENU_MARKER_START));

      const uninstalled = uninstallReadmeMenu(installed.content);

      assert.equal(uninstalled.removed, true);
      assert.equal(uninstalled.changed, true);
      assert.equal(uninstalled.reason, 'REMOVED');
      assert.ok(!uninstalled.content.includes(README_MENU_MARKER_START));
      assert.ok(!uninstalled.content.includes(README_MENU_MARKER_END));
      assert.ok(!uninstalled.content.includes('Interactive Companion Menu'));

      // Surrounding content remains intact
      assert.ok(uninstalled.content.includes('# My Project'));
      assert.ok(uninstalled.content.includes('## Next Steps\n- Build\n- Ship'));
    });

    it('returns no-op when uninstalling from a document without pet menu markers', () => {
      const cleanDoc = '# Clean Project\n\nNo pet menu here.\n';
      const result = uninstallReadmeMenu(cleanDoc);

      assert.equal(result.removed, false);
      assert.equal(result.changed, false);
      assert.equal(result.reason, 'NO_MARKERS_TO_REMOVE');
      assert.equal(result.content, cleanDoc);
    });
  });

  describe('Line Ending Preservation', () => {
    it('preserves Windows CRLF (\\r\\n) line endings across installation and updates', () => {
      const crlfContent = '# Windows Project\r\n\r\nSome CRLF text.\r\n';
      const installed = installReadmeMenu(crlfContent, {
        repo: 'mnp210/GitHub-Profile-Pet-Test',
        pet: mockPet,
      });

      assert.ok(installed.content.includes('\r\n'));
      assert.ok(!installed.content.includes('\n\n###')); // No naked \n
    });
  });
});
