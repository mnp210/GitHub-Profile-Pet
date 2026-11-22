/**
 * GitHub Profile Pet - README Pet Menu Management CLI
 *
 * Usage:
 *   npx tsx scripts/manage-readme-menu.ts generate --repo owner/repo
 *   npx tsx scripts/manage-readme-menu.ts install [--readme path/to/README.md] [--repo owner/repo]
 *   npx tsx scripts/manage-readme-menu.ts uninstall [--readme path/to/README.md]
 *   npx tsx scripts/manage-readme-menu.ts check [--readme path/to/README.md]
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  generateReadmeMenuSnippet,
  installReadmeMenu,
  uninstallReadmeMenu,
  inspectMenuMarkers,
} from '../src/features/pet-engine/publication/readmeMenu.ts';
import type { PetStateDocument } from '../src/features/pet-engine/domain/types.ts';
import type { PetState } from '../src/types/pet.ts';
import { INITIAL_PET_STATE } from '../src/constants/petData.ts';

async function loadPetState(baseDir: string): Promise<PetState> {
  const statePath = path.join(baseDir, 'pet', 'state', 'pet.json');
  try {
    const raw = await fs.readFile(statePath, 'utf-8');
    const doc = JSON.parse(raw) as PetStateDocument;
    return {
      name: doc.name || 'Shadow Claw',
      species: doc.species as PetState['species'],
      level: doc.level,
      xp: doc.xp,
      maxExp: doc.maxExp,
      energy: doc.energy,
      hunger: doc.hunger,
      happiness: doc.happiness,
      mood: doc.mood,
      evolutionStage: doc.evolutionStage,
    };
  } catch {
    return INITIAL_PET_STATE;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  const baseDir = process.cwd();
  let readmePath = path.join(baseDir, 'README.md');
  let repo = process.env.GITHUB_REPOSITORY || 'owner/github-profile-pet';
  let hostedUrl: string | undefined = process.env.NEXT_PUBLIC_APP_URL;

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--readme' && args[i + 1]) {
      readmePath = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--repo' && args[i + 1]) {
      repo = args[i + 1].trim();
      i++;
    } else if (args[i] === '--url' && args[i + 1]) {
      hostedUrl = args[i + 1].trim();
      i++;
    }
  }

  const pet = await loadPetState(baseDir);

  switch (command) {
    case 'generate': {
      const snippet = generateReadmeMenuSnippet({
        repo,
        pet,
        hostedGameUrl: hostedUrl,
      });
      console.log(snippet);
      break;
    }

    case 'install': {
      let existingContent = '';
      try {
        existingContent = await fs.readFile(readmePath, 'utf-8');
      } catch {
        existingContent = '';
      }

      const result = installReadmeMenu(existingContent, {
        repo,
        pet,
        hostedGameUrl: hostedUrl,
      });

      if (result.changed) {
        await fs.writeFile(readmePath, result.content, 'utf-8');
        console.log(
          `[SUCCESS] Pet Menu successfully ${result.installed ? 'installed' : 'updated'} in ${readmePath} (${result.reason})`
        );
      } else {
        console.log(`[NO-OP] Pet Menu is already up-to-date in ${readmePath}`);
      }
      break;
    }

    case 'uninstall': {
      let existingContent = '';
      try {
        existingContent = await fs.readFile(readmePath, 'utf-8');
      } catch {
        console.log(`[WARN] README file does not exist at ${readmePath}`);
        return;
      }

      const result = uninstallReadmeMenu(existingContent);
      if (result.removed && result.changed) {
        await fs.writeFile(readmePath, result.content, 'utf-8');
        console.log(`[SUCCESS] Pet Menu successfully removed from ${readmePath}`);
      } else {
        console.log(`[NO-OP] No Pet Menu markers found to remove in ${readmePath}`);
      }
      break;
    }

    case 'check': {
      try {
        const content = await fs.readFile(readmePath, 'utf-8');
        const inspection = inspectMenuMarkers(content);
        if (inspection.hasStart && inspection.hasEnd) {
          console.log(`[OK] Valid Pet Menu markers present in ${readmePath} (indices: ${inspection.startIndex}..${inspection.endIndex})`);
        } else {
          console.log(`[INFO] No Pet Menu markers found in ${readmePath}`);
        }
      } catch (err) {
        console.error(`[ERROR] Marker check failed: ${(err as Error).message}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}. Expected 'generate', 'install', 'uninstall', or 'check'.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
