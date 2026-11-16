/**
 * GitHub Profile Pet - SVG / XML Sanitization Utilities
 * Enforces strict XML escaping, control character stripping, and safe number formatting.
 */

/**
 * Escapes characters with special meaning in XML/SVG text and attribute values.
 * Replaces &, <, >, ", ' with their standard XML entity equivalents.
 * Strips non-printable control characters except \t, \n, \r.
 */
export function escapeXml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  const str = String(value);

  return str
    // Strip control characters (ASCII 0-8, 11-12, 14-31, 127)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // XML character entity encoding
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Formats and bounds a numeric coordinate/dimension into a finite, safe decimal.
 * Prevents NaN, Infinity, and scientific notation injection in SVG coordinates.
 */
export function sanitizeNumber(value: unknown, fallback: number = 0, precision: number = 2): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
