import type { SpeciesId } from '../../types/pet.ts';

export interface CompanionTheme {
  id: SpeciesId;
  name: string;
  primary: string;
  primaryStrong: string;
  primarySoft: string;
  secondary: string;
  secondarySoft: string;
  bgBase: string;
  bgAmbient: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  borderAccent: string;
  glow: string;
  textAccent: string;
  textSecondaryAccent: string;
}

export const COMPANION_THEMES: Record<SpeciesId, CompanionTheme> = {
  cat: {
    id: 'cat',
    name: 'Void Arcane',
    primary: '#7c3aed',
    primaryStrong: '#6d28d9',
    primarySoft: 'rgba(124, 58, 237, 0.14)',
    secondary: '#10b981',
    secondarySoft: 'rgba(16, 185, 129, 0.12)',
    bgBase: '#07090e',
    bgAmbient: 'rgba(124, 58, 237, 0.14)',
    surface: '#111022',
    surfaceElevated: '#181530',
    border: '#282347',
    borderAccent: 'rgba(139, 92, 246, 0.55)',
    glow: 'rgba(124, 58, 237, 0.22)',
    textAccent: '#c4b5fd',
    textSecondaryAccent: '#6ee7b7',
  },
  dragon: {
    id: 'dragon',
    name: 'Crimson Ember',
    primary: '#dc2626',
    primaryStrong: '#b91c1c',
    primarySoft: 'rgba(220, 38, 38, 0.14)',
    secondary: '#f59e0b',
    secondarySoft: 'rgba(245, 158, 11, 0.12)',
    bgBase: '#0b0708',
    bgAmbient: 'rgba(220, 38, 38, 0.14)',
    surface: '#160d0f',
    surfaceElevated: '#211215',
    border: '#3f1e23',
    borderAccent: 'rgba(239, 68, 68, 0.55)',
    glow: 'rgba(220, 38, 38, 0.22)',
    textAccent: '#fca5a5',
    textSecondaryAccent: '#fcd34d',
  },
  fox: {
    id: 'fox',
    name: 'Solar Spirit',
    primary: '#ea580c',
    primaryStrong: '#c2410c',
    primarySoft: 'rgba(234, 88, 12, 0.14)',
    secondary: '#eab308',
    secondarySoft: 'rgba(234, 179, 8, 0.12)',
    bgBase: '#0b0806',
    bgAmbient: 'rgba(234, 88, 12, 0.14)',
    surface: '#16100b',
    surfaceElevated: '#21170f',
    border: '#422b1a',
    borderAccent: 'rgba(249, 115, 22, 0.55)',
    glow: 'rgba(234, 88, 12, 0.22)',
    textAccent: '#fdba74',
    textSecondaryAccent: '#fde047',
  },
  slime: {
    id: 'slime',
    name: 'Cyber Plasma',
    primary: '#0891b2',
    primaryStrong: '#0e7490',
    primarySoft: 'rgba(6, 182, 212, 0.14)',
    secondary: '#a855f7',
    secondarySoft: 'rgba(168, 85, 247, 0.12)',
    bgBase: '#060a0d',
    bgAmbient: 'rgba(6, 182, 212, 0.14)',
    surface: '#0b141a',
    surfaceElevated: '#101d26',
    border: '#1b3844',
    borderAccent: 'rgba(6, 182, 212, 0.55)',
    glow: 'rgba(6, 182, 212, 0.22)',
    textAccent: '#67e8f9',
    textSecondaryAccent: '#d8b4fe',
  },
};

export function normalizeThemeSpecies(species?: string): SpeciesId {
  switch (species) {
    case 'dragon':
    case 'ignis_ember':
      return 'dragon';
    case 'fox':
    case 'kitsune_sol':
      return 'fox';
    case 'slime':
    case 'bloop_matrix':
      return 'slime';
    case 'cat':
    case 'shadow_claw':
    default:
      return 'cat';
  }
}

export function getCompanionTheme(species?: string): CompanionTheme {
  return COMPANION_THEMES[normalizeThemeSpecies(species)];
}

export function getCompanionThemeCssVars(species?: string): Record<string, string> {
  const t = getCompanionTheme(species);
  return {
    '--pet-primary': t.primary,
    '--pet-primary-strong': t.primaryStrong,
    '--pet-primary-soft': t.primarySoft,
    '--pet-secondary': t.secondary,
    '--pet-secondary-soft': t.secondarySoft,
    '--pet-bg-base': t.bgBase,
    '--pet-bg-ambient': t.bgAmbient,
    '--pet-surface': t.surface,
    '--pet-surface-elevated': t.surfaceElevated,
    '--pet-border': t.border,
    '--pet-border-accent': t.borderAccent,
    '--pet-glow': t.glow,
    '--pet-text-accent': t.textAccent,
    '--pet-text-secondary-accent': t.textSecondaryAccent,
  };
}
