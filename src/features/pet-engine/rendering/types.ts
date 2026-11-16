/**
 * GitHub Profile Pet - SVG Vector Renderer Types & Options
 * Pure domain definitions for deterministic SVG generation.
 */

export type PetActivityState =
  | 'idle'
  | 'sleeping'
  | 'eating'
  | 'training'
  | 'happy'
  | 'tired';

export type RenderTheme = 'dark' | 'light' | 'transparent';

export interface RenderSvgOptions {
  /**
   * Visual theme palette.
   * 'dark': GitHub dark surface (#0d1117 / #12151b)
   * 'light': GitHub light surface (#ffffff)
   * 'transparent': Transparent background without outer container card fill
   * Default: 'dark'
   */
  theme?: RenderTheme;

  /**
   * Explicit pet activity state / pose.
   * If omitted, derived deterministically from pet vitals & mood.
   */
  activity?: PetActivityState;

  /**
   * Whether to display vitals gauges (Level/XP, Energy, Hunger, Happiness).
   * Default: true
   */
  showVitals?: boolean;

  /**
   * Whether to display species dialogue speech bubble.
   * Default: true
   */
  showSpeechBubble?: boolean;

  /**
   * Optional custom speech bubble message (strictly XML-escaped).
   * If omitted, uses deterministic species reactions based on activity.
   */
  customMessage?: string;

  /**
   * Total SVG rendered width in logical pixels.
   * Default: 450
   */
  width?: number;

  /**
   * Total SVG rendered height in logical pixels.
   * Default: 200
   */
  height?: number;

  /**
   * Accessible SVG title for screen readers.
   * Default: "${pet.name} — GitHub Profile Pet"
   */
  title?: string;

  /**
   * Accessible SVG description for screen readers.
   */
  description?: string;
}

export interface SpriteFrameData {
  width: number;
  height: number;
  palette: Record<number, string>;
  matrix: number[][]; // [row][col] color index
}

export interface SpeciesVisualProfile {
  displayName: string;
  archetype: string;
  palette: Record<number, string>;
  getFrame: (activity: PetActivityState, stage: string) => SpriteFrameData;
}
