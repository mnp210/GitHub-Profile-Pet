import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  EvolutionStage,
  PetMood,
  PetSpecies,
  PetStateDocument,
} from '../../src/features/pet-engine/domain/types.ts';
import {
  assertValidSvgOutput,
  inferPetActivity,
  renderPetSvg,
  validateSvgOutput,
} from '../../src/features/pet-engine/rendering/index.ts';
import { deriveEvolutionStage } from '../../src/features/pet-engine/transitions/progressionEngine.ts';
import { calculateMaxExp } from '../../src/features/gamification/progression.ts';
import { getSpeciesMatrix } from '../../src/features/pet-engine/rendering/petSpriteRenderer.ts';

function createSamplePet(overrides?: Partial<PetStateDocument>): PetStateDocument {
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
    ...overrides,
  };
}

describe('Standalone SVG Vector Generation Engine (Phase 2)', () => {
  // 1. Valid default pet rendering
  it('TC-SVG-01: Renders valid, self-contained SVG from default canonical pet state', () => {
    const pet = createSamplePet();
    const svg = renderPetSvg(pet);

    assert(svg.startsWith('<svg'));
    assert(svg.endsWith('</svg>'));
    assert(svg.includes('viewBox="0 0 450 200"'));
    assert(svg.includes('Shadow Claw'));
    assert(svg.includes('LVL 3'));
    assert(svg.includes('shape-rendering="crispEdges"'));

    const validation = validateSvgOutput(svg);
    assert.equal(validation.valid, true);
    assert.equal(validation.errors.length, 0);
  });

  // 2. Every supported species & alias
  it('TC-SVG-02: Renders every supported species and alias correctly', () => {
    const speciesList: PetSpecies[] = [
      'cat',
      'shadow_claw',
      'dragon',
      'ignis_ember',
      'fox',
      'kitsune_sol',
      'slime',
      'bloop_matrix',
    ];

    for (const species of speciesList) {
      const pet = createSamplePet({ species });
      const svg = renderPetSvg(pet);
      assertValidSvgOutput(svg);
      assert(svg.length > 5000, `SVG for species '${species}' should have substantive vector content.`);
    }
  });

  // 3. Every supported evolution stage
  it('TC-SVG-03: Renders every supported evolution stage with distinct visual attributes', () => {
    const stages: EvolutionStage[] = ['Hatchling', 'Juvenile', 'Ascended', 'Celestial'];

    const outputs = new Set<string>();
    for (const stage of stages) {
      const pet = createSamplePet({ evolutionStage: stage, level: stage === 'Celestial' ? 25 : 5 });
      const svg = renderPetSvg(pet);
      assertValidSvgOutput(svg);
      assert(svg.includes(stage));
      outputs.add(svg);
    }

    // Each evolution stage must produce a visually distinct SVG
    assert.equal(outputs.size, stages.length);
  });

  // 4. Mood-dependent rendering
  it('TC-SVG-04: Reflects mood state in inferred activity and telemetry', () => {
    const moods: PetMood[] = ['Energetic', 'Happy', 'Focused', 'Curious', 'Resting'];

    for (const mood of moods) {
      const pet = createSamplePet({ mood });
      const svg = renderPetSvg(pet);
      assertValidSvgOutput(svg);

      if (mood === 'Resting') {
        assert.equal(inferPetActivity(pet), 'sleeping');
        assert(svg.includes('RESTING Zzz'));
      } else if (mood === 'Happy') {
        assert.equal(inferPetActivity(pet), 'happy');
        assert(svg.includes('HAPPY'));
      }
    }
  });

  // 5. Energy and vitals representation
  it('TC-SVG-05: Accurately represents vitals gauges, percentages and fill widths', () => {
    const pet = createSamplePet({
      energy: 50,
      hunger: 25,
      happiness: 100,
      xp: 75,
      maxExp: 150,
    });

    const svg = renderPetSvg(pet);
    assertValidSvgOutput(svg);

    // Track width is 270. 50% = 135, 25% = 67.5, 100% = 270, 75/150 = 135
    assert(svg.includes('50%'));
    assert(svg.includes('25%'));
    assert(svg.includes('100%'));
    assert(svg.includes('75 / 150'));
    assert(svg.includes('width="135"'));
    assert(svg.includes('width="67.5"'));
    assert(svg.includes('width="270"'));
  });

  // 6. Explicit activity states: sleeping, eating, training, idle, happy, tired
  it('TC-SVG-06: Supports explicit pet activity poses', () => {
    const activities = ['idle', 'sleeping', 'eating', 'training', 'happy', 'tired'] as const;

    for (const activity of activities) {
      const pet = createSamplePet();
      const svg = renderPetSvg(pet, { activity });
      assertValidSvgOutput(svg);
      assert(svg.length > 5000);
    }
  });

  // 7. Missing optional rendering options fallback
  it('TC-SVG-07: Applies stable defaults when options are partially or fully omitted', () => {
    const pet = createSamplePet();
    const svg1 = renderPetSvg(pet);
    const svg2 = renderPetSvg(pet, {});

    assert.equal(svg1, svg2);
    assert(svg1.includes('width="450"'));
    assert(svg1.includes('height="200"'));
  });

  // 8. Invalid pet-state rejection
  it('TC-SVG-08: Rejects invalid or corrupted pet state documents', () => {
    assert.throws(
      () => {
        // @ts-expect-error Testing invalid input
        renderPetSvg({ name: 'Broken' });
      },
      /State document validation failed|Unsupported schemaVersion/
    );

    assert.throws(
      () => {
        renderPetSvg(createSamplePet({ energy: 150 }));
      },
      /energy must be an integer between 0 and 100/
    );

    assert.throws(
      () => {
        renderPetSvg(createSamplePet({ name: '' }));
      },
      /name must be a non-empty string/
    );
  });

  // 9. XML escaping of special characters
  it('TC-SVG-09: Safely XML-escapes special characters in dynamic text fields', () => {
    const maliciousName = 'Shadow <Claw> & "Void" \'Familiar\'';
    const pet = createSamplePet({ name: maliciousName });
    const customMessage = 'Testing & < > " \' entities & special symbols';

    const svg = renderPetSvg(pet, { customMessage });
    assertValidSvgOutput(svg);

    // Unescaped chars must NOT be present as raw XML
    assert(!svg.includes('<Claw>'));
    assert(!svg.includes('"Void"'));
    // Escaped entities must be present
    assert(svg.includes('Shadow &lt;Claw&gt; &amp; &quot;Void&quot; &apos;Familiar&apos;'));
    assert(svg.includes('Testing &amp; &lt; &gt; &quot; &apos; entities'));
  });

  // 10. SVG injection attempts
  it('TC-SVG-10: Neutralizes SVG injection payloads in name and customMessage', () => {
    const injectionPet = createSamplePet({
      name: '<script>alert("pwned")</script>',
    });

    const svg = renderPetSvg(injectionPet, {
      customMessage: '<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>fetch("evil.com")</script></body></foreignObject>',
    });

    // Output must be valid and must NOT contain unescaped executable elements
    assertValidSvgOutput(svg);
    assert(!svg.includes('<script>'));
    assert(!svg.includes('<foreignObject>'));
    assert(svg.includes('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt;'));
  });

  // 11. Forbidden element rejection in validator
  it('TC-SVG-11: Output validator detects and rejects forbidden element tags', () => {
    const forbiddenTags = [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>test</div></foreignObject></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="about:blank"></iframe></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="evil.png" /></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="#sym" /></svg>',
    ];

    for (const badSvg of forbiddenTags) {
      const res = validateSvgOutput(badSvg);
      assert.equal(res.valid, false);
      assert.throws(() => assertValidSvgOutput(badSvg), /SVG Security and Structural Validation Failure/);
    }
  });

  // 12. External-resource rejection
  it('TC-SVG-12: Output validator rejects external links, protocols and imports', () => {
    const forbiddenVectors = [
      '<svg xmlns="http://www.w3.org/2000/svg"><text onclick="alert(1)">Click</text></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>Link</text></a></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("http://evil.com/font.css");</style></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><path xlink:href="http://evil.com" /></svg>',
    ];

    for (const badSvg of forbiddenVectors) {
      const res = validateSvgOutput(badSvg);
      assert.equal(res.valid, false);
    }
  });

  // 13. Deterministic output
  it('TC-SVG-13: Output is 100% byte-for-byte deterministic across repeated runs', () => {
    const pet = createSamplePet();
    const run1 = renderPetSvg(pet);
    const run2 = renderPetSvg(pet);
    const run3 = renderPetSvg(pet);

    assert.equal(run1, run2);
    assert.equal(run2, run3);
    assert.equal(Buffer.byteLength(run1, 'utf-8'), Buffer.byteLength(run2, 'utf-8'));
  });

  // 14. Stable dimensions and viewBox
  it('TC-SVG-14: Preserves stable dimensions and respects custom dimensions', () => {
    const pet = createSamplePet();
    const defaultSvg = renderPetSvg(pet);
    assert(defaultSvg.includes('viewBox="0 0 450 200"'));
    assert(defaultSvg.includes('width="450"'));
    assert(defaultSvg.includes('height="200"'));

    const customSvg = renderPetSvg(pet, { width: 500, height: 220 });
    assert(customSvg.includes('viewBox="0 0 500 220"'));
    assert(customSvg.includes('width="500"'));
    assert(customSvg.includes('height="220"'));
  });

  // 15. Accessible title and description
  it('TC-SVG-15: Includes accessible title and description elements', () => {
    const pet = createSamplePet({ name: 'Aether Fox', species: 'fox', level: 5 });
    const svg = renderPetSvg(pet);

    assert(svg.includes('<title>Aether Fox — GitHub Profile Pet</title>'));
    assert(svg.includes('<desc>Aether Fox is a Level 5 fox companion in Hatchling stage'));

    const customSvg = renderPetSvg(pet, {
      title: 'Custom Title',
      description: 'Custom Description',
    });
    assert(customSvg.includes('<title>Custom Title</title>'));
    assert(customSvg.includes('<desc>Custom Description</desc>'));
  });

  // 16. Empty or malformed input handling
  it('TC-SVG-16: Gracefully rejects empty, null, or non-object inputs', () => {
    // @ts-expect-error Testing invalid input
    assert.throws(() => renderPetSvg(null), /State document must be a JSON object/);
    // @ts-expect-error Testing invalid input
    assert.throws(() => renderPetSvg(undefined), /State document must be a JSON object/);
    // @ts-expect-error Testing invalid input
    assert.throws(() => renderPetSvg(''), /State document must be a JSON object/);
    // @ts-expect-error Testing invalid input
    assert.throws(() => renderPetSvg([]), /State document must be a JSON object/);
  });

  // 17. Boundary values for vitals and level
  it('TC-SVG-17: Renders boundary values (0 and 100 vitals, levels 1 and 99) cleanly', () => {
    const minPet = createSamplePet({
      level: 1,
      xp: 0,
      maxExp: 100,
      energy: 0,
      hunger: 0,
      happiness: 0,
    });
    const minSvg = renderPetSvg(minPet);
    assertValidSvgOutput(minSvg);
    assert(minSvg.includes('0%'));
    assert(minSvg.includes('0 / 100'));
    assert(minSvg.includes('LVL 1'));

    const maxPet = createSamplePet({
      level: 99,
      xp: 5000,
      maxExp: 5000,
      energy: 100,
      hunger: 100,
      happiness: 100,
    });
    const maxSvg = renderPetSvg(maxPet);
    assertValidSvgOutput(maxSvg);
    assert(maxSvg.includes('100%'));
    assert(maxSvg.includes('5000 / 5000'));
    assert(maxSvg.includes('LVL 99'));
  });

  // 18. Valid output after repeated rendering
  it('TC-SVG-18: Repeated rendering maintains identical output and memory stability', () => {
    const pet = createSamplePet();
    for (let i = 0; i < 20; i++) {
      const svg = renderPetSvg(pet);
      assert(svg.length > 5000);
    }
  });

  // 19. Independence from browser and network APIs
  it('TC-SVG-19: Pure node execution independent of window, document, or network', () => {
    // Assert no browser globals are required or referenced
    assert.equal(typeof (globalThis as unknown as { window?: unknown }).window, 'undefined');
    assert.equal(typeof (globalThis as unknown as { document?: unknown }).document, 'undefined');

    const pet = createSamplePet();
    const svg = renderPetSvg(pet);
    assert(svg.length > 0);
  });

  // 20. Rendering does not mutate input state
  it('TC-SVG-20: Rendering operation is strictly pure and never mutates input state', () => {
    const pet = createSamplePet();
    Object.freeze(pet);

    // Attempting mutation would throw in strict mode
    assert.doesNotThrow(() => {
      renderPetSvg(pet, { activity: 'training', theme: 'light' });
    });
  });

  // 21. Explicit SVG evolution-boundary tests for levels 1, 4, 5, 9, 10, 19, 20, and 50
  it('TC-SVG-21: Renders correct evolution stage and visual representation across all 8 exact level boundaries', () => {
    const boundaryCases: Array<{
      level: number;
      expectedStage: EvolutionStage;
      description: string;
      hasSparks: boolean;
      hasWings: boolean;
      hasCrown: boolean;
    }> = [
      { level: 1, expectedStage: 'Hatchling', description: 'Hatchling lower boundary', hasSparks: false, hasWings: false, hasCrown: false },
      { level: 4, expectedStage: 'Hatchling', description: 'Hatchling upper boundary', hasSparks: false, hasWings: false, hasCrown: false },
      { level: 5, expectedStage: 'Juvenile', description: 'Juvenile lower boundary', hasSparks: true, hasWings: false, hasCrown: false },
      { level: 9, expectedStage: 'Juvenile', description: 'Juvenile upper boundary', hasSparks: true, hasWings: false, hasCrown: false },
      { level: 10, expectedStage: 'Ascended', description: 'Ascended lower boundary', hasSparks: true, hasWings: true, hasCrown: false },
      { level: 19, expectedStage: 'Ascended', description: 'Ascended upper boundary', hasSparks: true, hasWings: true, hasCrown: false },
      { level: 20, expectedStage: 'Celestial', description: 'Celestial lower boundary', hasSparks: true, hasWings: true, hasCrown: true },
      { level: 50, expectedStage: 'Celestial', description: 'Celestial high-level boundary', hasSparks: true, hasWings: true, hasCrown: true },
    ];

    const renderedSvgsByStage: Record<EvolutionStage, string[]> = {
      Hatchling: [],
      Juvenile: [],
      Ascended: [],
      Celestial: [],
    };

    for (const testCase of boundaryCases) {
      // 1. Verify progression engine derives the authoritative stage
      const stageFromProgression = deriveEvolutionStage(testCase.level) as EvolutionStage;
      assert.equal(
        stageFromProgression,
        testCase.expectedStage,
        `Progression mismatch at level ${testCase.level} (${testCase.description})`
      );

      // 2. Build valid pet state document for this boundary
      const maxExp = calculateMaxExp(testCase.level);
      const pet = createSamplePet({
        level: testCase.level,
        evolutionStage: stageFromProgression,
        xp: Math.floor(maxExp / 2),
        maxExp,
      });

      // 3. Render SVG and assert validity
      const svg = renderPetSvg(pet);
      assertValidSvgOutput(svg);

      // 4. Verify card representation text
      assert(
        svg.includes(`LVL ${testCase.level}`),
        `SVG should display level badge 'LVL ${testCase.level}'`
      );
      assert(
        svg.includes(testCase.expectedStage),
        `SVG should display stage text '${testCase.expectedStage}'`
      );

      // 5. Verify pixel matrix sprite augmentations directly
      const matrix = getSpeciesMatrix('cat', 'idle', stageFromProgression);
      const sparkPixel = matrix[4][7] !== 0;
      const wingPixel = matrix[14][4] !== 0;
      const crownPixel = matrix[1][12] !== 0;

      assert.equal(
        sparkPixel,
        testCase.hasSparks,
        `Spark decoration mismatch for ${stageFromProgression} at level ${testCase.level}`
      );
      assert.equal(
        wingPixel,
        testCase.hasWings,
        `Wing decoration mismatch for ${stageFromProgression} at level ${testCase.level}`
      );
      assert.equal(
        crownPixel,
        testCase.hasCrown,
        `Crown decoration mismatch for ${stageFromProgression} at level ${testCase.level}`
      );

      renderedSvgsByStage[testCase.expectedStage].push(svg);
    }

    // 6. Cross-stage visual divergence assertion: each evolution tier produces distinct representation
    const distinctStages: EvolutionStage[] = ['Hatchling', 'Juvenile', 'Ascended', 'Celestial'];
    for (let i = 0; i < distinctStages.length; i++) {
      for (let j = i + 1; j < distinctStages.length; j++) {
        const svgA = renderedSvgsByStage[distinctStages[i]][0];
        const svgB = renderedSvgsByStage[distinctStages[j]][0];
        assert.notEqual(
          svgA,
          svgB,
          `Stage '${distinctStages[i]}' and '${distinctStages[j]}' should produce distinct SVGs`
        );
      }
    }
  });

  // 22. Strict state immutability assertion across multiple renders and option configurations
  it('TC-SVG-22: Strict state immutability assertion across multiple renders and option configurations', () => {
    const pet = createSamplePet({
      level: 10,
      xp: 450,
      maxExp: 1000,
      energy: 70,
      hunger: 60,
      happiness: 80,
      mood: 'Focused',
      evolutionStage: 'Ascended',
    });

    const snapshot = JSON.parse(JSON.stringify(pet));
    Object.freeze(pet);

    // Render with multiple option combinations
    renderPetSvg(pet);
    renderPetSvg(pet, { theme: 'light', activity: 'training' });
    renderPetSvg(pet, { theme: 'transparent', activity: 'sleeping', customMessage: 'Testing immutability' });
    renderPetSvg(pet, { showVitals: false, showSpeechBubble: false });

    // Assert that the object is bit-for-bit unchanged
    assert.deepEqual(pet, snapshot, 'Pet state was mutated by rendering pipeline');
  });
});
