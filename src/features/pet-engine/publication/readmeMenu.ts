/**
 * GitHub Profile Pet - Repository README Interactive Pet Menu
 *
 * Implements generation, safe idempotent installation, state update, and clean uninstallation
 * of the interactive navigation Pet Menu in repository README documents.
 *
 * Architecture Invariants:
 * 1. 100% GitHub-compatible Markdown & HTML only (no inline JavaScript, React, or iframes).
 * 2. Every menu item routes to the hosted game with explicit query parameters (?repo=owner/repo&action=...).
 * 3. Delimited by distinct markers:
 *    <!-- START_SECTION:github-profile-pet-menu -->
 *    <!-- END_SECTION:github-profile-pet-menu -->
 * 4. Strictly preserves all existing, unrelated README content byte-for-byte.
 * 5. Fully idempotent: repeated installation or updates produce stable, duplicate-free results.
 * 6. Clean uninstallation: completely removes markers and content without leaving artifacts.
 * 7. State snapshot accuracy: displays last-updated timestamp and state hash with clear static snapshot notice.
 */

import type { PetState, SpeciesId } from '../../../types/pet.ts';
import { getDefaultPersonalityForSpecies } from '../../personality/personalities.ts';

export const README_MENU_MARKER_START = '<!-- START_SECTION:github-profile-pet-menu -->';
export const README_MENU_MARKER_END = '<!-- END_SECTION:github-profile-pet-menu -->';

export interface ReadmePetData {
  name: string;
  species: string;
  generation?: number;
  level: number;
  xp?: number;
  maxExp?: number;
  mood?: string;
  personality?: string;
  evolutionStage?: string;
  hunger?: number;
  happiness?: number;
  energy?: number;
  updatedAt?: string | null;
  lastSimulatedAt?: string | null;
}

export interface ReadmeMenuOptions {
  repo: string; // e.g. "mnp210/GitHub-Profile-Pet-Test"
  pet: ReadmePetData | PetState;
  hostedGameUrl?: string; // Optional custom game URL, falls back to GitHub Pages or env
  svgRelativePath?: string; // Default: 'public/pet.svg'
  lastUpdatedUtc?: string; // ISO string e.g. "2026-11-19T21:30:00Z"
  stateHash?: string; // Optional state hash or commit SHA
  lineEnding?: '\n' | '\r\n';
}

export interface ReadmeMenuUpdateResult {
  markersFound: boolean;
  changed: boolean;
  content: string;
  reason?: 'NO_MARKERS' | 'UNCHANGED' | 'UPDATED';
}

export interface ReadmeMenuInstallResult {
  installed: boolean;
  updated: boolean;
  changed: boolean;
  content: string;
  reason: 'FRESH_INSTALL' | 'UPDATED_EXISTING' | 'ALREADY_CURRENT';
}

export interface ReadmeMenuUninstallResult {
  removed: boolean;
  changed: boolean;
  content: string;
  reason: 'REMOVED' | 'NO_MARKERS_TO_REMOVE';
}

/**
 * Thrown when README menu markers are unbalanced, inverted, or duplicated.
 */
export class MalformedReadmeMenuMarkersError extends Error {
  constructor(message: string) {
    super(`Malformed README pet menu markers: ${message}`);
    this.name = 'MalformedReadmeMenuMarkersError';
  }
}

/**
 * Resolves the authoritative public web URL of the hosted playable game.
 */
export function resolveHostedGameUrl(repo: string, customUrl?: string): string {
  if (customUrl && customUrl.trim().length > 0) {
    return customUrl.trim().replace(/\/+$/, '');
  }

  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, '');
  }

  // GitHub Pages default URL format for repo "owner/name"
  if (repo && repo.includes('/')) {
    const parts = repo.trim().split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      const owner = parts[0].toLowerCase();
      const repoName = parts[1];
      return `https://${owner}.github.io/${repoName}`;
    }
  }

  if (typeof window !== 'undefined' && window.location.origin) {
    return window.location.origin;
  }

  return 'http://localhost:3000';
}

export function getSpeciesDisplayName(species: string): string {
  switch (species) {
    case 'shadow_claw':
    case 'cat':
      return 'Shadow Claw';
    case 'ignis_ember':
    case 'dragon':
      return 'Ignis Ember';
    case 'kitsune_sol':
    case 'fox':
      return 'Kitsune Sol';
    case 'bloop_matrix':
    case 'slime':
      return 'Bloop Matrix';
    default:
      return 'Shadow Claw';
  }
}

function getSpeciesArchetype(species: string): string {
  switch (species) {
    case 'shadow_claw':
    case 'cat':
      return 'Void Familiar';
    case 'ignis_ember':
    case 'dragon':
      return 'Ruby Drake';
    case 'kitsune_sol':
    case 'fox':
      return 'Nine-Tail Scout';
    case 'bloop_matrix':
    case 'slime':
      return 'Cyber Jelly';
    default:
      return 'Void Familiar';
  }
}

function toSpeciesId(species: string): SpeciesId {
  switch (species) {
    case 'ignis_ember':
    case 'dragon':
      return 'dragon';
    case 'kitsune_sol':
    case 'fox':
      return 'fox';
    case 'bloop_matrix':
    case 'slime':
      return 'slime';
    case 'shadow_claw':
    case 'cat':
    default:
      return 'cat';
  }
}

function formatProgressBar(value: number, max: number, segments = 10): string {
  const safeMax = max > 0 ? max : 100;
  const ratio = Math.max(0, Math.min(1, value / safeMax));
  const filled = Math.round(ratio * segments);
  return `${'█'.repeat(filled)}${'░'.repeat(segments - filled)}`;
}

function resolveSpriteAssetPath(
  species: string,
  mood: string,
  energy: number,
  fallbackSvgPath: string
): string {
  const speciesId = toSpeciesId(species);
  if (speciesId !== 'cat' || (fallbackSvgPath && fallbackSvgPath !== 'public/pet.svg')) {
    return fallbackSvgPath;
  }
  if (energy <= 15) {
    return 'public/sprites/pets/cat/tired_animated.svg';
  }
  if (mood === 'Resting') {
    return 'public/sprites/pets/cat/sleeping_animated.svg';
  }
  if (mood === 'Happy') {
    return 'public/sprites/pets/cat/happy_animated.svg';
  }
  return 'public/sprites/pets/cat/curious_animated.svg';
}

function capitalizeWord(value: string): string {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Escapes HTML-sensitive characters (&, <, >, ", ') for safe text and attribute
 * interpolation without double-escaping existing named/numeric HTML entities.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&(?!(?:amp|lt|gt|quot|#39|#x27);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates that an SVG/image path is a safe relative repository asset path.
 * Rejects URL schemes, protocol-relative URLs, backslashes, path traversal, and control/HTML chars.
 */
export function validateSafeAssetPath(assetPath: string): string {
  const trimmed = assetPath.trim();
  if (!trimmed) {
    throw new Error('Unsafe svgRelativePath: path cannot be empty.');
  }
  if (/[\u0000-\u001f\u007f<>"'`\\]/.test(trimmed)) {
    throw new Error(`Unsafe svgRelativePath: invalid characters in '${trimmed}'.`);
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/')) {
    throw new Error(`Unsafe svgRelativePath: external URL schemes and absolute paths are not allowed ('${trimmed}').`);
  }
  const segments = trimmed.split('/');
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) {
    throw new Error(`Unsafe svgRelativePath: path traversal or empty segments are not allowed ('${trimmed}').`);
  }
  if (!/\.(svg|png|jpe?g|webp|gif)$/i.test(trimmed)) {
    throw new Error(`Unsafe svgRelativePath: unsupported asset extension ('${trimmed}').`);
  }
  return trimmed;
}

/**
 * Generates the standardized, GitHub-compatible Markdown/HTML Pet Dashboard & Menu block.
 */
export function generateReadmeMenuSnippet(options: ReadmeMenuOptions): string {
  const lineEnding = options.lineEnding ?? '\n';
  const repo = options.repo.trim();
  const pet = options.pet as ReadmePetData;
  const baseUrl = resolveHostedGameUrl(repo, options.hostedGameUrl);
  const svgPath = validateSafeAssetPath(options.svgRelativePath || 'public/pet.svg');
  const rawTimestamp =
    options.lastUpdatedUtc ||
    pet.updatedAt ||
    pet.lastSimulatedAt ||
    new Date().toISOString();
  const timestamp = escapeHtml(rawTimestamp);
  const safeHash = options.stateHash ? escapeHtml(options.stateHash.slice(0, 8)) : '';
  const hashNote = safeHash ? ` &middot; Snapshot \`${safeHash}\`` : '';

  const speciesDisplayName = getSpeciesDisplayName(pet.species);
  const archetype = escapeHtml(getSpeciesArchetype(pet.species));
  const petName = escapeHtml(pet.name || speciesDisplayName);
  const petNameTableCell = petName.replace(/\|/g, '&#124;').replace(/\r?\n/g, ' ');
  const stageDisplayName = escapeHtml(pet.evolutionStage || 'Hatchling');
  const moodDisplayName = escapeHtml(pet.mood || 'Happy');
  const generation = pet.generation ?? 1;
  const rawPersonality =
    pet.personality || getDefaultPersonalityForSpecies(toSpeciesId(pet.species));
  const personalityDisplay = escapeHtml(capitalizeWord(rawPersonality));

  const energy = Math.round(pet.energy ?? 100);
  const satiety = Math.round(pet.hunger ?? 100);
  const happiness = Math.round(pet.happiness ?? 100);
  const xp = Math.max(0, Math.round(pet.xp ?? 0));
  const maxExp = Math.max(1, Math.round(pet.maxExp ?? 100));
  const xpPercent = Math.min(100, Math.round((xp / maxExp) * 100));

  const xpBar = formatProgressBar(xp, maxExp, 10);
  const energyBar = formatProgressBar(energy, 100, 10);
  const satietyBar = formatProgressBar(satiety, 100, 10);
  const happinessBar = formatProgressBar(happiness, 100, 10);

  const encodedRepo = encodeURIComponent(repo);
  const playBaseUrl = `${baseUrl}/?repo=${encodedRepo}`;
  const playBaseUrlAttr = escapeHtml(playBaseUrl);
  const spritePath = escapeHtml(
    validateSafeAssetPath(
      resolveSpriteAssetPath(pet.species, pet.mood || 'Happy', energy, svgPath)
    )
  );

  const lines = [
    README_MENU_MARKER_START,
    '<div align="center">',
    '',
    `<h2><a href="${playBaseUrlAttr}">&#9876;&#65039; ${petName} &mdash; Shadow Companion Hub</a></h2>`,
    `<p><strong>${archetype}</strong> &middot; <code>Lv. ${pet.level}</code> &middot; <code>${stageDisplayName}</code> &middot; <code>Gen #${generation}</code></p>`,
    '',
    '<table>',
    '  <thead>',
    '    <tr>',
    '      <th align="center">Companion</th>',
    '      <th align="left">Status Panel</th>',
    '    </tr>',
    '  </thead>',
    '  <tbody>',
    '    <tr>',
    '      <td align="center" width="180">',
    `        <a href="${playBaseUrlAttr}" title="Launch ${petName} in GitHub Profile Pet">`,
    `          <img src="${spritePath}" alt="${petName} sprite" width="112" height="112" />`,
    '        </a>',
    '        <br />',
    `        <a href="${playBaseUrlAttr}"><strong>&#9654; Launch Game</strong></a>`,
    '      </td>',
    '      <td align="left">',
    `        <strong>XP Progress:</strong> <code>${xpBar}</code> <strong>${xp} / ${maxExp} XP</strong> (${xpPercent}%)<br />`,
    `        <strong>Mood:</strong> ${moodDisplayName} &nbsp;&middot;&nbsp; <strong>Personality:</strong> ${personalityDisplay}<br /><br />`,
    `        <strong>Energy:</strong> <code>${energyBar}</code> ${energy}%<br />`,
    `        <strong>Satiety:</strong> <code>${satietyBar}</code> ${satiety}%<br />`,
    `        <strong>Happiness:</strong> <code>${happinessBar}</code> ${happiness}%`,
    '      </td>',
    '    </tr>',
    '  </tbody>',
    '</table>',
    '',
    '### Game Menu',
    '',
    '| Menu Section | Destination | Purpose |',
    '| :--- | :--- | :--- |',
    `| <a href="${playBaseUrlAttr}"><strong>CARE</strong></a> | [Open Care Hub](${playBaseUrl}) | Feed, train, rest, and pet ${petNameTableCell} in real time |`,
    `| <a href="${playBaseUrlAttr}"><strong>PLAY ZONE</strong></a> | [Open Game](${playBaseUrl}) | Launch interactive mini-games from the main interface |`,
    `| <a href="${playBaseUrlAttr}"><strong>WARDROBE</strong></a> | [Open Game](${playBaseUrl}) | Equip unlocked cosmetics and shadow accessories |`,
    `| <a href="${playBaseUrlAttr}"><strong>BOND</strong></a> | [Open Game](${playBaseUrl}) | Build daily companion affinity and milestones |`,
    `| <a href="${playBaseUrlAttr}"><strong>ACHIEVEMENTS</strong></a> | [Open Game](${playBaseUrl}) | Track unlocked milestones and progression rewards |`,
    `| <a href="${playBaseUrlAttr}&amp;action=stats"><strong>PET PROFILE</strong></a> | [View Pet Stats](${playBaseUrl}&action=stats) | Inspect full companion telemetry and ledger status |`,
    '',
    `**Quick Care Actions:** [Feed](${playBaseUrl}&action=feed) &middot; [Train](${playBaseUrl}&action=train) &middot; [Rest](${playBaseUrl}&action=rest) &middot; [Pet](${playBaseUrl}&action=pet)`,
    '',
    `<sub>Static snapshot synced from <code>pet/state/pet.json</code> (${timestamp}${hashNote}).<br />` +
      'GitHub READMEs do not run JavaScript or iframes; clicking any menu item launches the live web game. ' +
      '<code>CARE</code> and <code>PET PROFILE</code> use supported query parameters (<code>?repo=</code>, <code>?action=stats</code>); ' +
      '<code>PLAY ZONE</code>, <code>WARDROBE</code>, <code>BOND</code>, and <code>ACHIEVEMENTS</code> open the main game view directly.</sub>',
    '',
    '</div>',
    README_MENU_MARKER_END,
  ];

  return lines.join(lineEnding);
}

/**
 * Validates the structure and ordering of pet menu markers in document text.
 */
export function inspectMenuMarkers(content: string): {
  hasStart: boolean;
  hasEnd: boolean;
  startIndex: number;
  endIndex: number;
} {
  const hasStart = content.includes(README_MENU_MARKER_START);
  const hasEnd = content.includes(README_MENU_MARKER_END);

  if (!hasStart && !hasEnd) {
    return { hasStart: false, hasEnd: false, startIndex: -1, endIndex: -1 };
  }

  if (hasStart && !hasEnd) {
    throw new MalformedReadmeMenuMarkersError(
      `Found '${README_MENU_MARKER_START}' without matching '${README_MENU_MARKER_END}'.`
    );
  }

  if (!hasStart && hasEnd) {
    throw new MalformedReadmeMenuMarkersError(
      `Found '${README_MENU_MARKER_END}' without preceding '${README_MENU_MARKER_START}'.`
    );
  }

  const startIndex = content.indexOf(README_MENU_MARKER_START);
  const endIndex = content.indexOf(README_MENU_MARKER_END);

  if (endIndex < startIndex) {
    throw new MalformedReadmeMenuMarkersError(
      `End marker '${README_MENU_MARKER_END}' appears before start marker '${README_MENU_MARKER_START}'.`
    );
  }

  // Check for duplicate markers
  const secondStart = content.indexOf(README_MENU_MARKER_START, startIndex + 1);
  if (secondStart !== -1) {
    throw new MalformedReadmeMenuMarkersError(
      `Multiple '${README_MENU_MARKER_START}' markers found. Only one pet menu section is allowed.`
    );
  }

  const secondEnd = content.indexOf(README_MENU_MARKER_END, endIndex + 1);
  if (secondEnd !== -1) {
    throw new MalformedReadmeMenuMarkersError(
      `Multiple '${README_MENU_MARKER_END}' markers found. Only one pet menu section is allowed.`
    );
  }

  return { hasStart: true, hasEnd: true, startIndex, endIndex };
}

/**
 * Updates only the section enclosed by the pet menu markers in the provided content.
 * Leaves all text before and after the markers completely untouched.
 */
export function updateReadmeMenuContent(
  existingContent: string,
  options: ReadmeMenuOptions
): ReadmeMenuUpdateResult {
  const inspection = inspectMenuMarkers(existingContent);

  if (!inspection.hasStart || !inspection.hasEnd) {
    return {
      markersFound: false,
      changed: false,
      content: existingContent,
      reason: 'NO_MARKERS',
    };
  }

  const isCrlf = existingContent.includes('\r\n');
  const lineEnding: '\n' | '\r\n' = isCrlf ? '\r\n' : '\n';

  const newSnippet = generateReadmeMenuSnippet({
    ...options,
    lineEnding,
  });

  const before = existingContent.slice(0, inspection.startIndex);
  const after = existingContent.slice(inspection.endIndex + README_MENU_MARKER_END.length);
  const newContent = `${before}${newSnippet}${after}`;

  const changed = newContent !== existingContent;

  return {
    markersFound: true,
    changed,
    content: newContent,
    reason: changed ? 'UPDATED' : 'UNCHANGED',
  };
}

/**
 * Safely installs or updates the Pet Menu in any README.
 *
 * Idempotency guarantees:
 * - If the markers already exist, it updates the section in-place without duplicating.
 * - If the markers do not exist:
 *   - If an existing profile badge (<!-- END_SECTION:github-profile-pet -->) exists,
 *     it places the menu right after the badge.
 *   - Otherwise, it appends to the document cleanly.
 * - All unrelated content is strictly preserved.
 */
export function installReadmeMenu(
  existingContent: string,
  options: ReadmeMenuOptions,
  placement: 'after-badge' | 'append' | 'prepend' = 'after-badge'
): ReadmeMenuInstallResult {
  const inspection = inspectMenuMarkers(existingContent);

  // 1. If already present, perform in-place update (Idempotent)
  if (inspection.hasStart && inspection.hasEnd) {
    const updateRes = updateReadmeMenuContent(existingContent, options);
    return {
      installed: false,
      updated: true,
      changed: updateRes.changed,
      content: updateRes.content,
      reason: updateRes.changed ? 'UPDATED_EXISTING' : 'ALREADY_CURRENT',
    };
  }

  // 2. Fresh installation
  const isCrlf = existingContent.includes('\r\n');
  const lineEnding: '\n' | '\r\n' = isCrlf ? '\r\n' : '\n';

  const snippet = generateReadmeMenuSnippet({
    ...options,
    lineEnding,
  });

  // Handle empty or whitespace-only document
  if (!existingContent.trim()) {
    return {
      installed: true,
      updated: false,
      changed: true,
      content: `${snippet}${lineEnding}`,
      reason: 'FRESH_INSTALL',
    };
  }

  let finalContent: string;

  // Placement strategy
  const badgeEndMarker = '<!-- END_SECTION:github-profile-pet -->';
  if (placement === 'after-badge' && existingContent.includes(badgeEndMarker)) {
    const badgeIdx = existingContent.indexOf(badgeEndMarker) + badgeEndMarker.length;
    const before = existingContent.slice(0, badgeIdx);
    const after = existingContent.slice(badgeIdx);
    finalContent = `${before}${lineEnding}${lineEnding}${snippet}${after}`;
  } else if (placement === 'prepend') {
    finalContent = `${snippet}${lineEnding}${lineEnding}${existingContent}`;
  } else {
    // Append to end
    const trimmed = existingContent.replace(/\s+$/, '');
    finalContent = `${trimmed}${lineEnding}${lineEnding}${snippet}${lineEnding}`;
  }

  return {
    installed: true,
    updated: false,
    changed: finalContent !== existingContent,
    content: finalContent,
    reason: 'FRESH_INSTALL',
  };
}

/**
 * Completely and cleanly removes the Pet Menu from the README.
 * Leaves no stray comments, partial markers, or corrupted sections behind.
 */
export function uninstallReadmeMenu(existingContent: string): ReadmeMenuUninstallResult {
  const inspection = inspectMenuMarkers(existingContent);

  if (!inspection.hasStart || !inspection.hasEnd) {
    return {
      removed: false,
      changed: false,
      content: existingContent,
      reason: 'NO_MARKERS_TO_REMOVE',
    };
  }

  const before = existingContent.slice(0, inspection.startIndex);
  let after = existingContent.slice(inspection.endIndex + README_MENU_MARKER_END.length);

  // Clean up any extra leading blank lines left behind in 'after'
  if (after.startsWith('\r\n\r\n')) {
    after = after.slice(2);
  } else if (after.startsWith('\n\n')) {
    after = after.slice(1);
  }

  // If before ends with trailing blank lines, normalize to a clean single line break
  const cleanedBefore = before.replace(/\r?\n\s*\r?\n$/, existingContent.includes('\r\n') ? '\r\n' : '\n');
  const newContent = `${cleanedBefore}${after}`;

  return {
    removed: true,
    changed: newContent !== existingContent,
    content: newContent,
    reason: 'REMOVED',
  };
}
