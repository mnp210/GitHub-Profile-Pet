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

import type { PetState } from '../../../types/pet.ts';

export const README_MENU_MARKER_START = '<!-- START_SECTION:github-profile-pet-menu -->';
export const README_MENU_MARKER_END = '<!-- END_SECTION:github-profile-pet-menu -->';

export interface ReadmePetData {
  name: string;
  species: string;
  level: number;
  xp?: number;
  maxExp?: number;
  mood?: string;
  evolutionStage?: string;
  hunger?: number;
  happiness?: number;
  energy?: number;
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

/**
 * Generates the standardized, GitHub-compatible Markdown/HTML Pet Menu block.
 */
export function generateReadmeMenuSnippet(options: ReadmeMenuOptions): string {
  const lineEnding = options.lineEnding ?? '\n';
  const repo = options.repo.trim();
  const pet = options.pet;
  const baseUrl = resolveHostedGameUrl(repo, options.hostedGameUrl);
  const svgPath = options.svgRelativePath || 'public/pet.svg';
  const timestamp = options.lastUpdatedUtc || new Date().toISOString();
  const hashNote = options.stateHash ? ` (Snapshot: \`${options.stateHash.slice(0, 8)}\`)` : '';

  const speciesDisplayName = getSpeciesDisplayName(pet.species);
  const petName = pet.name || speciesDisplayName;
  const stageDisplayName = pet.evolutionStage || 'Hatchling';
  const moodDisplayName = pet.mood || 'Happy';

  const energy = Math.round(pet.energy ?? 100);
  const satiety = Math.round(pet.hunger ?? 100);
  const happiness = Math.round(pet.happiness ?? 100);

  const encodedRepo = encodeURIComponent(repo);

  const lines = [
    README_MENU_MARKER_START,
    '<div align="center">',
    '',
    `### 🐾 ${petName} — Virtual Companion`,
    '',
    '<p align="center">',
    `  <a href="${baseUrl}/?repo=${encodedRepo}&action=stats">`,
    `    <img src="${svgPath}" alt="${petName}" width="420" />`,
    '  </a>',
    '</p>',
    '',
    '| Species | Stage | Level | Mood | Vitals (Energy / Sat / Joy) |',
    '| :---: | :---: | :---: | :---: | :---: |',
    `| **${speciesDisplayName}** | **${stageDisplayName}** | **Lv. ${pet.level}** | **${moodDisplayName}** | ⚡ ${energy}% &nbsp;\\|&nbsp; 🍖 ${satiety}% &nbsp;\\|&nbsp; 💖 ${happiness}% |`,
    '',
    '#### 🎮 Interactive Companion Menu',
    `[🎮 **Play with Pet**](${baseUrl}/?repo=${encodedRepo}) &bull; ` +
      `[🍖 **Feed**](${baseUrl}/?repo=${encodedRepo}&action=feed) &bull; ` +
      `[🎾 **Play**](${baseUrl}/?repo=${encodedRepo}&action=play) &bull; ` +
      `[⚔️ **Train**](${baseUrl}/?repo=${encodedRepo}&action=train) &bull; ` +
      `[🌙 **Rest**](${baseUrl}/?repo=${encodedRepo}&action=rest) &bull; ` +
      `[🐾 **Pet**](${baseUrl}/?repo=${encodedRepo}&action=pet) &bull; ` +
      `[📊 **View Pet Stats**](${baseUrl}/?repo=${encodedRepo}&action=stats)`,
    '',
    `<sub>*Last verified snapshot: ${timestamp}${hashNote}*<br />` +
      `*Note: This menu is a static snapshot. Click any action to launch the interactive game and confirm changes.*</sub>`,
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
