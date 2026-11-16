/**
 * Standalone SVG Vector Generation CLI Script
 * Reads the canonical repository state from pet/state/pet.json and
 * renders public/pet.svg using the pure rendering engine.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { renderPetSvg } from '../src/features/pet-engine/rendering/index.ts';
import type { PetStateDocument } from '../src/features/pet-engine/domain/types.ts';

async function main() {
  const baseDir = process.cwd();
  const statePath = path.join(baseDir, 'pet', 'state', 'pet.json');
  const outputPath = path.join(baseDir, 'public', 'pet.svg');

  console.log(`[render-svg] Reading pet state from: ${statePath}`);
  const raw = await fs.readFile(statePath, 'utf-8');
  const petState = JSON.parse(raw) as PetStateDocument;

  console.log(`[render-svg] Rendering SVG for ${petState.name} (${petState.species}, Lvl ${petState.level})...`);
  const svg = renderPetSvg(petState, {
    theme: 'dark',
    width: 450,
    height: 200,
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, svg, 'utf-8');
  console.log(`[render-svg] Successfully generated standalone SVG (${svg.length} bytes) at: ${outputPath}`);
}

main().catch((err) => {
  console.error('[render-svg] Error generating SVG:', err);
  process.exit(1);
});
