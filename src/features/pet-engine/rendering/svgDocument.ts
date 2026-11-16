/**
 * GitHub Profile Pet - SVG Document Assembly & Scoped Styling
 * Composes the complete standalone SVG container with accessible title/desc,
 * embedded styles, and deterministic formatting.
 */

import { escapeXml, sanitizeNumber } from './svgEscape.ts';
import type { RenderTheme } from './types.ts';
import { getThemeColors } from './petCardRenderer.ts';

export interface DocumentOptions {
  width: number;
  height: number;
  title: string;
  description: string;
  theme: RenderTheme;
}

export function buildSvgDocument(content: string, options: DocumentOptions): string {
  const width = sanitizeNumber(options.width, 450);
  const height = sanitizeNumber(options.height, 200);
  const escapedTitle = escapeXml(options.title);
  const escapedDesc = escapeXml(options.description);
  const colors = getThemeColors(options.theme);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" shape-rendering="crispEdges">
  <title>${escapedTitle}</title>
  <desc>${escapedDesc}</desc>
  <style>
    .pet-name {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 15px;
      font-weight: 700;
      fill: ${colors.textName};
    }
    .pet-subtitle {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 11px;
      font-weight: 500;
      fill: ${colors.textSubtitle};
    }
    .badge-text {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 9px;
      font-weight: 700;
      fill: ${colors.vitalLabel};
      letter-spacing: 0.5px;
    }
    .level-text {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 10px;
      font-weight: 700;
      fill: ${colors.badgeText};
      letter-spacing: 0.5px;
    }
    .vital-label {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 10.5px;
      font-weight: 600;
      fill: ${colors.vitalLabel};
    }
    .vital-value {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 9.5px;
      font-weight: 600;
      fill: ${colors.vitalValue};
    }
    .quote-text {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 10px;
      font-style: italic;
      fill: ${colors.quoteText};
    }
  </style>

${content}
</svg>`;
}
