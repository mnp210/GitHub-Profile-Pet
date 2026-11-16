/**
 * GitHub Profile Pet - README Embed & Marker Management
 * Safely locates and updates pet embed snippets in Markdown documents
 * while strictly preserving all unrelated content.
 */

import type { ReadmeUpdateResult } from './types.ts';

export const README_MARKER_START = '<!-- START_SECTION:github-profile-pet -->';
export const README_MARKER_END = '<!-- END_SECTION:github-profile-pet -->';

/**
 * Generates the canonical HTML embed block for the profile README.
 * Uses a centered relative image tag pointing to the published SVG asset.
 */
export function generateReadmeEmbedSnippet(
  svgRelativePath: string = 'public/pet.svg',
  lineEnding: '\n' | '\r\n' = '\n'
): string {
  const lines = [
    README_MARKER_START,
    '<p align="center">',
    `  <img src="${svgRelativePath}" alt="GitHub Profile Pet" width="450" height="200" />`,
    '</p>',
    README_MARKER_END,
  ];
  return lines.join(lineEnding);
}

/**
 * Error thrown when README markers are partially present or disordered.
 */
export class MalformedReadmeMarkersError extends Error {
  constructor(message: string) {
    super(`Malformed README pet embed markers: ${message}`);
    this.name = 'MalformedReadmeMarkersError';
  }
}

/**
 * Updates only the section enclosed by the pet markers in the provided README content.
 *
 * Safety Invariants:
 * 1. If NO markers exist, the content is returned 100% untouched.
 * 2. If markers are malformed (e.g. start without end, end before start), throws to prevent data corruption.
 * 3. All text, markdown, and whitespace before the start marker and after the end marker are preserved byte-for-byte.
 * 4. Preserves the host document's line endings (\r\n vs \n) to eliminate churn on Windows/Linux.
 */
export function updateReadmeContent(
  existingContent: string,
  svgRelativePath: string = 'public/pet.svg'
): ReadmeUpdateResult {
  const hasStart = existingContent.includes(README_MARKER_START);
  const hasEnd = existingContent.includes(README_MARKER_END);

  // 1. If neither marker is present, leave file untouched
  if (!hasStart && !hasEnd) {
    return {
      markersFound: false,
      changed: false,
      content: existingContent,
      reason: 'NO_MARKERS',
    };
  }

  // 2. Detect malformed / unbalanced markers
  if (hasStart && !hasEnd) {
    throw new MalformedReadmeMarkersError(
      `Found '${README_MARKER_START}' without matching '${README_MARKER_END}'.`
    );
  }
  if (!hasStart && hasEnd) {
    throw new MalformedReadmeMarkersError(
      `Found '${README_MARKER_END}' without preceding '${README_MARKER_START}'.`
    );
  }

  const startIndex = existingContent.indexOf(README_MARKER_START);
  const endIndex = existingContent.indexOf(README_MARKER_END);

  if (endIndex < startIndex) {
    throw new MalformedReadmeMarkersError(
      `End marker '${README_MARKER_END}' appears before start marker '${README_MARKER_START}'.`
    );
  }

  // Check for duplicate markers
  const secondStart = existingContent.indexOf(README_MARKER_START, startIndex + 1);
  if (secondStart !== -1) {
    throw new MalformedReadmeMarkersError(
      `Multiple '${README_MARKER_START}' markers found. Only one pet embed section is allowed.`
    );
  }

  const secondEnd = existingContent.indexOf(README_MARKER_END, endIndex + 1);
  if (secondEnd !== -1) {
    throw new MalformedReadmeMarkersError(
      `Multiple '${README_MARKER_END}' markers found. Only one pet embed section is allowed.`
    );
  }

  // 3. Preserve line endings of the document
  const isCrlf = existingContent.includes('\r\n');
  const lineEnding: '\n' | '\r\n' = isCrlf ? '\r\n' : '\n';

  // 4. Generate fresh embed snippet
  const newSnippet = generateReadmeEmbedSnippet(svgRelativePath, lineEnding);

  // 5. Splice strictly between the start marker and the end of the end marker
  const before = existingContent.slice(0, startIndex);
  const after = existingContent.slice(endIndex + README_MARKER_END.length);
  const newContent = `${before}${newSnippet}${after}`;

  return {
    markersFound: true,
    changed: newContent !== existingContent,
    content: newContent,
    reason: newContent === existingContent ? 'UNCHANGED' : undefined,
  };
}

/**
 * Extracts the inner content between the markers, if present.
 */
export function extractReadmePetSnippet(readmeContent: string): string | null {
  const startIndex = readmeContent.indexOf(README_MARKER_START);
  const endIndex = readmeContent.indexOf(README_MARKER_END);

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null;
  }

  return readmeContent.slice(startIndex, endIndex + README_MARKER_END.length);
}
