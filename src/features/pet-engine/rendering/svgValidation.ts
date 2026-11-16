/**
 * GitHub Profile Pet - SVG Output Security & Structural Validator
 * Guarantees that generated SVG documents are well-formed XML and free of security vectors.
 */

export interface SvgValidationResult {
  valid: boolean;
  errors: string[];
}

const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'rect',
  'circle',
  'ellipse',
  'path',
  'text',
  'title',
  'desc',
  'defs',
  'linearGradient',
  'stop',
  'clipPath',
  'style',
]);

const FORBIDDEN_TAG_PATTERNS = [
  /<script\b/i,
  /<foreignObject\b/i,
  /<iframe\b/i,
  /<image\b/i,
  /<use\b/i,
  /<embed\b/i,
  /<object\b/i,
  /<link\b/i,
  /<meta\b/i,
  /<audio\b/i,
  /<video\b/i,
  /<animate\b/i,
  /<set\b/i,
];

const FORBIDDEN_ATTR_PATTERNS = [
  /\bon\w+\s*=/i,          // Event handlers: onclick=, onload=, onerror=, etc.
  /\bjavascript\s*:/i,     // JavaScript protocol
  /\bdata\s*:/i,           // Data protocol (embedded scripts)
  /\bvbscript\s*:/i,       // VBScript protocol
  /\bxlink:href\s*=/i,     // Deprecated xlink reference
  /\bhref\s*=\s*["']https?:/i, // External hyperlinking
  /@import\b/i,            // CSS external stylesheet imports
  /\burl\s*\(\s*["']?https?:/i, // CSS external asset loads
];

/**
 * Validates a generated SVG string against structural and security requirements.
 */
export function validateSvgOutput(svg: string): SvgValidationResult {
  const errors: string[] = [];

  if (typeof svg !== 'string' || svg.trim().length === 0) {
    return { valid: false, errors: ['SVG output is empty.'] };
  }

  const trimmed = svg.trim();

  // 1. Root element structural check
  if (!trimmed.startsWith('<svg') || !trimmed.endsWith('</svg>')) {
    errors.push('SVG document must open with <svg> and terminate with </svg>.');
  }

  // 2. Required XML namespace
  if (!trimmed.includes('xmlns="http://www.w3.org/2000/svg"')) {
    errors.push('SVG root element missing required xmlns="http://www.w3.org/2000/svg" namespace.');
  }

  // 3. Check for forbidden element tags
  for (const pattern of FORBIDDEN_TAG_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(`Forbidden SVG element detected matching pattern ${pattern.source}.`);
    }
  }

  // 4. Check for forbidden attributes, protocols, and injection vectors
  for (const pattern of FORBIDDEN_ATTR_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(`Forbidden attribute or protocol detected matching pattern ${pattern.source}.`);
    }
  }

  // 5. Whitelist all element tags present in the markup
  const tagMatches = trimmed.matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)\b/g);
  for (const match of tagMatches) {
    const rawTag = match[1];
    if (rawTag.startsWith('/')) continue;
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      errors.push(`Disallowed SVG element tag detected: <${rawTag}>.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Asserts that the SVG output meets all security and structural requirements.
 * Throws an explicit Error if any violation is detected.
 */
export function assertValidSvgOutput(svg: string): void {
  const result = validateSvgOutput(svg);
  if (!result.valid) {
    throw new Error(
      `SVG Security and Structural Validation Failure:\n - ${result.errors.join('\n - ')}`
    );
  }
}
