/**
 * GitHub Profile Pet - SVG Vector Generation Engine Public API
 */

export { renderPetSvg, inferPetActivity } from './svgRenderer.ts';
export { escapeXml, sanitizeNumber } from './svgEscape.ts';
export { validateSvgOutput, assertValidSvgOutput, type SvgValidationResult } from './svgValidation.ts';
export {
  getSpeciesPalette,
  getSpeciesMatrix,
  matrixToSvgRects,
  SHADOW_CLAW_PALETTE,
  IGNIS_EMBER_PALETTE,
  KITSUNE_SOL_PALETTE,
  BLOOP_MATRIX_PALETTE,
} from './petSpriteRenderer.ts';
export { renderPetCard, getThemeColors, type ThemeColors } from './petCardRenderer.ts';
export { buildSvgDocument, type DocumentOptions } from './svgDocument.ts';
export type {
  PetActivityState,
  RenderSvgOptions,
  RenderTheme,
  SpriteFrameData,
  SpeciesVisualProfile,
} from './types.ts';
