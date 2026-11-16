/**
 * Standalone Pet Publication CLI Script
 * Reads repository state, renders & validates the SVG asset, writes public/pet.svg,
 * and updates README embed markers if present.
 *
 * Designed to be executed directly in GitHub Actions runners:
 *   node --experimental-strip-types scripts/publish-pet.ts
 */

import { publishPetSvg } from '../src/features/pet-engine/publication/index.ts';

async function main() {
  console.log('[publish-pet] Starting pet SVG publication process...');
  const result = await publishPetSvg();

  console.log(`[publish-pet] Pet Rendered: ${result.petName} (${result.species}, Level ${result.level}, Stage: ${result.evolutionStage})`);
  console.log(`[publish-pet] SVG Artifact: ${result.svgPath} (${result.svgBytes} bytes) - ${result.svgChanged ? 'UPDATED' : 'UNCHANGED'}`);

  if (result.readmeUpdated) {
    console.log(`[publish-pet] README Embed: ${result.readmePath} - ${result.readmeChanged ? 'UPDATED' : 'UNCHANGED'}`);
  } else {
    console.log(`[publish-pet] README Embed: No markers found or update skipped; README left untouched.`);
  }

  console.log('[publish-pet] Publication completed successfully.');
}

main().catch((err) => {
  console.error('::error::[publish-pet] Publication failed:', err);
  process.exit(1);
});
