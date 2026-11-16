/**
 * GitHub Profile Pet - SVG Card Layout & Telemetry Renderer
 * Pure layout engine assembling the card surface, header badge, vitals progress tracks,
 * activity indicator, and companion speech bubble.
 */

import type { PetStateDocument } from '../domain/types.ts';
import { escapeXml, sanitizeNumber } from './svgEscape.ts';
import {
  getSpeciesMatrix,
  getSpeciesPalette,
  matrixToSvgRects,
} from './petSpriteRenderer.ts';
import type { PetActivityState, RenderSvgOptions, RenderTheme } from './types.ts';

// ---------------------------------------------------------------------------
// Species Metadata
// ---------------------------------------------------------------------------

interface SpeciesInfo {
  archetype: string;
  defaultName: string;
}

const SPECIES_INFO: Record<string, SpeciesInfo> = {
  cat: { archetype: 'Void Familiar', defaultName: 'Shadow Claw' },
  shadow_claw: { archetype: 'Void Familiar', defaultName: 'Shadow Claw' },
  dragon: { archetype: 'Ruby Drake', defaultName: 'Ignis Ember' },
  ignis_ember: { archetype: 'Ruby Drake', defaultName: 'Ignis Ember' },
  fox: { archetype: 'Nine-Tail Scout', defaultName: 'Kitsune Sol' },
  kitsune_sol: { archetype: 'Nine-Tail Scout', defaultName: 'Kitsune Sol' },
  slime: { archetype: 'Cyber Jelly', defaultName: 'Bloop Matrix' },
  bloop_matrix: { archetype: 'Cyber Jelly', defaultName: 'Bloop Matrix' },
};

const ACTIVITY_QUOTES: Record<string, Record<PetActivityState, string>> = {
  cat: {
    idle: 'Watching commit diffs with calm emerald eyes.',
    sleeping: 'Curls into a snug pixelated orb and dozes quietly.',
    eating: 'Nibbles a byte-sized salmon commit and grooms whiskers.',
    training: 'Hones void claws on terminal logs with lethal agility!',
    happy: 'Purrs contentedly and rubs void ears against your cursor.',
    tired: 'Energy low... curled beside the keyboard, resting.',
  },
  dragon: {
    idle: 'Vigilant draconic guardian ready for continuous deployment.',
    sleeping: 'Slumbers peacefully atop a warm hoard of merged PRs.',
    eating: 'Gnashes happily on a spicy flame-roasted commit banquet.',
    training: 'Practices blazing flame breath against stale git branches!',
    happy: 'Puffs a warm ember smoke-ring and leans into your hand.',
    tired: 'Ember breath sputtering... settling down to rest.',
  },
  fox: {
    idle: 'Alert solar scout scanning the horizon for clean merges.',
    sleeping: 'Tucks bushy tail over snout and drifts into serene sleep.',
    eating: 'Crunches golden solar berries with sparkling eyes.',
    training: 'Darts nimbly through rapid code review obstacle courses!',
    happy: 'Yips playfully and swishes its voluminous bushy tail.',
    tired: 'Paws are heavy... taking a restorative snooze.',
  },
  slime: {
    idle: 'Absorbing exceptions fluidly without ever crashing.',
    sleeping: 'Settles into a calm, translucent resting puddle.',
    eating: 'Absorbs green bug-fix pellets and swells happily.',
    training: 'Splashes matrix gel into rigorous tactical shapes!',
    happy: 'Jiggles warmly with iridescent gelatinous bubbles.',
    tired: 'Gel turned watery and unstable. Solidifying quietly.',
  },
};

const ACTIVITY_BADGE_LABELS: Record<PetActivityState, string> = {
  idle: 'IDLE',
  sleeping: 'RESTING Zzz',
  eating: 'EATING',
  training: 'TRAINING',
  happy: 'HAPPY ✨',
  tired: 'TIRED ⚡',
};

// ---------------------------------------------------------------------------
// Theme Palette Constants
// ---------------------------------------------------------------------------

export interface ThemeColors {
  cardBg: string;
  cardBorder: string;
  textName: string;
  textSubtitle: string;
  vitalLabel: string;
  vitalValue: string;
  trackBg: string;
  quoteText: string;
  stageShadow: string;
  badgeBg: string;
  badgeText: string;
}

export function getThemeColors(theme: RenderTheme): ThemeColors {
  switch (theme) {
    case 'light':
      return {
        cardBg: '#ffffff',
        cardBorder: '#d0d7de',
        textName: '#24292f',
        textSubtitle: '#57606a',
        vitalLabel: '#57606a',
        vitalValue: '#24292f',
        trackBg: '#eaeef2',
        quoteText: '#57606a',
        stageShadow: 'rgba(0, 0, 0, 0.08)',
        badgeBg: '#4f46e5',
        badgeText: '#ffffff',
      };
    case 'transparent':
      return {
        cardBg: 'none',
        cardBorder: '#30363d',
        textName: '#f0f6fc',
        textSubtitle: '#8b949e',
        vitalLabel: '#8b949e',
        vitalValue: '#f0f6fc',
        trackBg: '#21262d',
        quoteText: '#8b949e',
        stageShadow: 'rgba(0, 0, 0, 0.4)',
        badgeBg: '#4338ca',
        badgeText: '#e0e7ff',
      };
    case 'dark':
    default:
      return {
        cardBg: '#0d1117',
        cardBorder: '#21262d',
        textName: '#f0f6fc',
        textSubtitle: '#8b949e',
        vitalLabel: '#8b949e',
        vitalValue: '#f0f6fc',
        trackBg: '#161b22',
        quoteText: '#8b949e',
        stageShadow: 'rgba(0, 0, 0, 0.5)',
        badgeBg: '#4338ca',
        badgeText: '#e0e7ff',
      };
  }
}

// ---------------------------------------------------------------------------
// Card Layout Assembly
// ---------------------------------------------------------------------------

export function renderPetCard(
  pet: PetStateDocument,
  activity: PetActivityState,
  options: RenderSvgOptions
): string {
  const theme = options.theme ?? 'dark';
  const colors = getThemeColors(theme);
  const showVitals = options.showVitals !== false;
  const showSpeechBubble = options.showSpeechBubble !== false;

  const width = sanitizeNumber(options.width, 450);
  const height = sanitizeNumber(options.height, 200);

  const speciesKey = pet.species.toLowerCase();
  const info = SPECIES_INFO[speciesKey] ?? {
    archetype: 'Virtual Familiar',
    defaultName: 'Companion',
  };

  const escapedName = escapeXml(pet.name || info.defaultName);
  const escapedArchetype = escapeXml(info.archetype);
  const escapedStage = escapeXml(pet.evolutionStage);

  // Quote / Dialogue
  const normalizedSpecies = (['cat', 'dragon', 'fox', 'slime'].includes(speciesKey)
    ? speciesKey
    : speciesKey === 'shadow_claw'
      ? 'cat'
      : speciesKey === 'ignis_ember'
        ? 'dragon'
        : speciesKey === 'kitsune_sol'
          ? 'fox'
          : 'slime');

  const defaultQuote =
    ACTIVITY_QUOTES[normalizedSpecies]?.[activity] ??
    'A living virtual companion resting on your GitHub profile.';
  const rawQuote = options.customMessage ? options.customMessage.slice(0, 90) : defaultQuote;
  const escapedQuote = escapeXml(rawQuote);

  // Sprite Vector Construction
  const palette = getSpeciesPalette(pet.species);
  const matrix = getSpeciesMatrix(pet.species, activity, pet.evolutionStage);
  const spriteRects = matrixToSvgRects(matrix, palette, 3, 24, 42);

  // Vitals Bar Calculations (Track width = 270)
  const trackWidth = 270;
  const xpRatio = pet.maxExp > 0 ? Math.min(1, Math.max(0, pet.xp / pet.maxExp)) : 0;
  const energyRatio = Math.min(1, Math.max(0, pet.energy / 100));
  const hungerRatio = Math.min(1, Math.max(0, pet.hunger / 100));
  const happinessRatio = Math.min(1, Math.max(0, pet.happiness / 100));

  const xpWidth = sanitizeNumber(xpRatio * trackWidth);
  const energyWidth = sanitizeNumber(energyRatio * trackWidth);
  const hungerWidth = sanitizeNumber(hungerRatio * trackWidth);
  const happinessWidth = sanitizeNumber(happinessRatio * trackWidth);

  const activityBadgeLabel = ACTIVITY_BADGE_LABELS[activity] ?? 'ACTIVE';

  // Construct Card SVG Content
  return `  <!-- Card Background -->
  <rect width="${width}" height="${height}" rx="10" fill="${colors.cardBg}" />
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="9.5" fill="none" stroke="${colors.cardBorder}" stroke-width="1" />

  <!-- Sprite Habitat Pedestal -->
  <ellipse cx="72" cy="144" rx="44" ry="7" fill="${colors.stageShadow}" />

  <!-- Character Vector Sprite (32x32 pixel matrix at 3x scale) -->
  <g class="pet-sprite" shape-rendering="crispEdges">
      ${spriteRects}
  </g>

  <!-- Activity State Pill -->
  <g class="activity-badge">
    <rect x="28" y="160" width="88" height="18" rx="9" fill="${colors.trackBg}" stroke="${colors.cardBorder}" stroke-width="1" />
    <text x="72" y="172.5" class="badge-text" text-anchor="middle">${activityBadgeLabel}</text>
  </g>

  <!-- Header: Pet Identity & Level Badge -->
  <text x="150" y="32" class="pet-name">${escapedName}</text>
  <text x="150" y="47" class="pet-subtitle">${escapedArchetype} • ${escapedStage}</text>

  <!-- Level Badge Pill -->
  <g class="level-badge">
    <rect x="372" y="17" width="54" height="20" rx="4" fill="${colors.badgeBg}" />
    <text x="399" y="31" class="level-text" text-anchor="middle">LVL ${pet.level}</text>
  </g>

  ${
    showVitals
      ? `<!-- Vitals Telemetry Section -->
  <g class="vitals-section">
    <!-- XP Progress -->
    <text x="150" y="67" class="vital-label">EXP</text>
    <text x="420" y="67" class="vital-value" text-anchor="end">${pet.xp} / ${pet.maxExp}</text>
    <rect x="150" y="72" width="${trackWidth}" height="5" rx="2.5" fill="${colors.trackBg}" />
    <rect x="150" y="72" width="${xpWidth}" height="5" rx="2.5" fill="#818cf8" />

    <!-- Energy Gauge -->
    <text x="150" y="93" class="vital-label">⚡ Energy</text>
    <text x="420" y="93" class="vital-value" text-anchor="end">${pet.energy}%</text>
    <rect x="150" y="98" width="${trackWidth}" height="5" rx="2.5" fill="${colors.trackBg}" />
    <rect x="150" y="98" width="${energyWidth}" height="5" rx="2.5" fill="#f59e0b" />

    <!-- Satiety / Hunger Gauge -->
    <text x="150" y="119" class="vital-label">🍖 Satiety</text>
    <text x="420" y="119" class="vital-value" text-anchor="end">${pet.hunger}%</text>
    <rect x="150" y="124" width="${trackWidth}" height="5" rx="2.5" fill="${colors.trackBg}" />
    <rect x="150" y="124" width="${hungerWidth}" height="5" rx="2.5" fill="#10b981" />

    <!-- Joy / Happiness Gauge -->
    <text x="150" y="145" class="vital-label">💖 Joy</text>
    <text x="420" y="145" class="vital-value" text-anchor="end">${pet.happiness}%</text>
    <rect x="150" y="150" width="${trackWidth}" height="5" rx="2.5" fill="${colors.trackBg}" />
    <rect x="150" y="150" width="${happinessWidth}" height="5" rx="2.5" fill="#f472b6" />
  </g>`
      : ''
  }

  ${
    showSpeechBubble
      ? `<!-- Companion Speech Bubble / Quote -->
  <g class="speech-quote">
    <text x="150" y="178" class="quote-text">“${escapedQuote}”</text>
  </g>`
      : ''
  }`;
}
