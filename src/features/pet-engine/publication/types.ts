/**
 * GitHub Profile Pet - Publication Engine Types
 * Definitions for safe SVG rendering, README injection, and idempotent Git publication.
 */

export interface PublishPetOptions {
  /** Root directory of the repository (defaults to process.cwd()) */
  baseDir?: string;
  /** Explicit path to the input pet state JSON document */
  statePath?: string;
  /** Explicit path to the output SVG asset */
  outputPath?: string;
  /** Explicit path to the repository README.md */
  readmePath?: string;
  /** Whether to inspect and update README markers if present (defaults to true) */
  updateReadme?: boolean;
  /** Optional theme override ('dark' | 'light' | 'transparent') */
  theme?: 'dark' | 'light' | 'transparent';
  /** Optional custom dialogue message */
  customMessage?: string;
}

export interface PublishResult {
  /** Whether an SVG file was written/updated on disk */
  svgWritten: boolean;
  /** Absolute path where the SVG was written */
  svgPath: string;
  /** Byte length of the generated SVG */
  svgBytes: number;
  /** Whether the SVG content changed compared to what was previously on disk */
  svgChanged: boolean;
  /** Whether the README.md file was updated */
  readmeUpdated: boolean;
  /** Absolute path to the README.md */
  readmePath: string;
  /** Whether the README content changed */
  readmeChanged: boolean;
  /** Name of the pet rendered */
  petName: string;
  /** Species key of the pet */
  species: string;
  /** Level of the pet */
  level: number;
  /** Evolution stage of the pet */
  evolutionStage: string;
}

export interface ReadmeUpdateResult {
  /** Whether valid markers were found */
  markersFound: boolean;
  /** Whether the content changed compared to the input */
  changed: boolean;
  /** Resulting full README content */
  content: string;
  /** Specific reason if markers were not updated */
  reason?: 'NO_MARKERS' | 'MALFORMED_MARKERS' | 'UNCHANGED';
}
