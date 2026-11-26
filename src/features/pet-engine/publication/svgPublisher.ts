/**
 * GitHub Profile Pet - SVG Publication Engine
 * Coordinates state loading, pure deterministic rendering, security validation,
 * atomic filesystem replacement, and README marker maintenance.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PetStateDocument } from '../domain/types.ts';
import { renderPetSvg } from '../rendering/index.ts';
import { assertValidSvgOutput } from '../rendering/svgValidation.ts';
import { assertValidPetState } from '../validation/stateValidator.ts';
import { updateReadmeContent } from './readmeEmbed.ts';
import { updateReadmeMenuContent, README_MENU_MARKER_START } from './readmeMenu.ts';
import type { PublishPetOptions, PublishResult } from './types.ts';

/**
 * Atomically writes file content using a temporary file in the target directory
 * followed by a rename operation to ensure no partial or corrupt file is published.
 */
async function atomicWriteFile(targetPath: string, content: string): Promise<void> {
  const dir = path.dirname(targetPath);
  await fs.mkdir(dir, { recursive: true });

  const tempPath = path.join(
    dir,
    `.tmp.${path.basename(targetPath)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  );

  try {
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, targetPath);
  } catch (err) {
    // Clean up temporary file on failure
    await fs.unlink(tempPath).catch(() => {});
    throw err;
  }
}

/**
 * Executes safe, idempotent publication of the pet SVG graphic and README embed.
 *
 * Guaranteed Properties:
 * 1. Safe Failure: Failed state validation or SVG assertion NEVER overwrites or corrupts published files.
 * 2. Idempotent: If output is byte-identical to existing files on disk, no write occurs.
 * 3. Atomic: Files are written via atomic rename in the target directory.
 * 4. Content Preservation: Surrounding README content outside the markers is 100% untouched.
 * 5. Platform Independent: Runs identically in local Node.js or GitHub Actions runner.
 */
export async function publishPetSvg(options: PublishPetOptions = {}): Promise<PublishResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const statePath = options.statePath ?? path.join(baseDir, 'pet', 'state', 'pet.json');
  const outputPath = options.outputPath ?? path.join(baseDir, 'public', 'pet.svg');
  const readmePath = options.readmePath ?? path.join(baseDir, 'README.md');
  const updateReadme = options.updateReadme !== false;

  // 1. Read and validate pet state
  let rawState: string;
  try {
    rawState = await fs.readFile(statePath, 'utf-8');
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new Error(`Pet state document not found at: ${statePath}`);
    }
    throw err;
  }

  let petState: PetStateDocument;
  try {
    petState = JSON.parse(rawState) as PetStateDocument;
  } catch (err: unknown) {
    throw new Error(`Failed to parse JSON in pet state document (${statePath}): ${(err as Error).message}`);
  }

  // Enforce schema and state invariant validation
  assertValidPetState(petState);

  // 2. Render SVG
  const svg = renderPetSvg(petState, {
    theme: options.theme ?? 'dark',
    customMessage: options.customMessage,
    width: 450,
    height: 200,
  });

  // 3. Strict structural and security validation
  // If this throws, execution halts immediately and no files are written
  assertValidSvgOutput(svg);

  // 4. Check if existing SVG matches (Idempotency)
  let existingSvg: string | null = null;
  try {
    existingSvg = await fs.readFile(outputPath, 'utf-8');
  } catch {
    existingSvg = null;
  }

  const svgChanged = existingSvg !== svg;
  if (svgChanged) {
    await atomicWriteFile(outputPath, svg);
  }

  // 5. Update README if requested and present
  let readmeUpdated = false;
  let readmeChanged = false;

  if (updateReadme) {
    let existingReadme: string | null = null;
    try {
      existingReadme = await fs.readFile(readmePath, 'utf-8');
    } catch {
      existingReadme = null;
    }

    if (existingReadme !== null) {
      // Calculate relative path from README directory to output SVG
      const relativeSvg = path
        .relative(path.dirname(readmePath), outputPath)
        .replace(/\\/g, '/');

      let currentReadmeContent = existingReadme;
      let anyMarkersFound = false;

      // 1. Update standard profile badge embed if markers present
      const badgeUpdateResult = updateReadmeContent(currentReadmeContent, relativeSvg);
      if (badgeUpdateResult.markersFound) {
        anyMarkersFound = true;
        currentReadmeContent = badgeUpdateResult.content;
      }

      // 2. Update interactive README Pet Menu if markers present
      if (currentReadmeContent.includes(README_MENU_MARKER_START)) {
        anyMarkersFound = true;
        const resolvedRepo =
          options.repo ||
          process.env.GITHUB_REPOSITORY ||
          'owner/github-profile-pet';

        const menuUpdateResult = updateReadmeMenuContent(currentReadmeContent, {
          repo: resolvedRepo,
          pet: petState,
          hostedGameUrl: options.hostedGameUrl,
          svgRelativePath: relativeSvg,
          lastUpdatedUtc:
            petState.updatedAt ||
            petState.lastSimulatedAt ||
            new Date().toISOString(),
        });
        currentReadmeContent = menuUpdateResult.content;
      }

      readmeUpdated = anyMarkersFound;
      readmeChanged = currentReadmeContent !== existingReadme;

      if (readmeChanged) {
        await atomicWriteFile(readmePath, currentReadmeContent);
      }
    }
  }

  return {
    svgWritten: true,
    svgPath: outputPath,
    svgBytes: Buffer.byteLength(svg, 'utf-8'),
    svgChanged,
    readmeUpdated,
    readmePath,
    readmeChanged,
    petName: petState.name,
    species: petState.species,
    level: petState.level,
    evolutionStage: petState.evolutionStage,
  };
}
