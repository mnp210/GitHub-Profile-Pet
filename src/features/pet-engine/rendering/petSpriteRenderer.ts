/**
 * GitHub Profile Pet - Character Vector Sprite Renderer
 * Generates pixel-perfect 32x32 SVG vector matrices for all companion species,
 * evolution tiers, and activity states.
 */

import type { EvolutionStage, PetSpecies } from '../domain/types.ts';
import type { PetActivityState } from './types.ts';

// ---------------------------------------------------------------------------
// 1. Color Palettes (Max 7 tones per species, strictly constrained)
// ---------------------------------------------------------------------------

export const SHADOW_CLAW_PALETTE: Record<number, string> = {
  0: 'transparent',
  1: '#1a1228', // Void Ink - Outline
  2: '#2d184a', // Deep Velvet - Base Shading
  3: '#4a247a', // Arcane Plum - Midtone Body
  4: '#6d39a8', // Astral Violet - Upper Highlight
  5: '#10b981', // Emerald Terminal - Eye Iris
  6: '#d1fae5', // Mint Gleam - Eye Specular Glint & Sparkles
  7: '#f472b6', // Rose Sigil - Inner Ear & Chest Crest
};

export const IGNIS_EMBER_PALETTE: Record<number, string> = {
  0: 'transparent',
  1: '#450a0a', // Deep Bloodstone - Outline
  2: '#7f1d1d', // Core Shadow Crimson
  3: '#b91c1c', // Ruby Midtone Scales
  4: '#dc2626', // Blazing Scarlet Highlight
  5: '#f59e0b', // Fiery Amber Eye Iris
  6: '#fbbf24', // Golden Horns & Underbelly Plate
  7: '#fef08a', // Core Ember Glow & Flame Sparks
};

export const KITSUNE_SOL_PALETTE: Record<number, string> = {
  0: 'transparent',
  1: '#431407', // Dark Umber - Outline
  2: '#9a3412', // Deep Rust Shadow
  3: '#ea580c', // Radiant Fox Orange Midtone
  4: '#fb923c', // Golden Fur Highlight
  5: '#06b6d4', // Solar Cyan Jewel Eye
  6: '#ffedd5', // Warm Cream Muzzle, Chest & Tail Tip
  7: '#fef08a', // Solar Charm Spark
};

export const BLOOP_MATRIX_PALETTE: Record<number, string> = {
  0: 'transparent',
  1: '#022c22', // Deep Cyber Matrix - Perimeter
  2: '#064e3b', // Deep Bio-Gel Shadow
  3: '#059669', // Matrix Emerald Midtone
  4: '#10b981', // Translucent Neon Gel
  5: '#38bdf8', // Floating Memory Crystal Core
  6: '#6ee7b7', // Specular Glint Highlight
  7: '#f472b6', // Kawaii Blush & Terminal Pulse
};

// ---------------------------------------------------------------------------
// 2. Matrix Generation Helpers
// ---------------------------------------------------------------------------

export function createEmptyGrid(): number[][] {
  return Array.from({ length: 32 }, () => Array(32).fill(0));
}

// ---------------------------------------------------------------------------
// 3. Shadow Claw (Cat) 32x32 Matrix Builder
// ---------------------------------------------------------------------------

export function buildCatMatrix(activity: PetActivityState, stage: EvolutionStage): number[][] {
  const g = createEmptyGrid();
  const isSleeping = activity === 'sleeping';
  const isHappy = activity === 'happy';
  const isTired = activity === 'tired';
  const isEating = activity === 'eating';
  const isTraining = activity === 'training';

  const yOff = isSleeping ? 1 : isTraining ? -1 : 0;

  // Ears
  // Left Ear
  g[5 + yOff][9] = 1; g[5 + yOff][10] = 1;
  g[6 + yOff][8] = 1; g[6 + yOff][9] = 7; g[6 + yOff][10] = 1;
  g[7 + yOff][8] = 1; g[7 + yOff][9] = 7; g[7 + yOff][10] = 7; g[7 + yOff][11] = 1;
  g[8 + yOff][7] = 1; g[8 + yOff][8] = 2; g[8 + yOff][9] = 7; g[8 + yOff][10] = 7; g[8 + yOff][11] = 1;

  // Right Ear
  g[5 + yOff][21] = 1; g[5 + yOff][22] = 1;
  g[6 + yOff][21] = 1; g[6 + yOff][22] = 7; g[6 + yOff][23] = 1;
  g[7 + yOff][20] = 1; g[7 + yOff][21] = 7; g[7 + yOff][22] = 7; g[7 + yOff][23] = 1;
  g[8 + yOff][20] = 1; g[8 + yOff][21] = 7; g[8 + yOff][22] = 7; g[8 + yOff][23] = 2; g[8 + yOff][24] = 1;

  // Crown of Head
  for (let x = 11; x <= 20; x++) g[7 + yOff][x] = 1;
  for (let x = 11; x <= 20; x++) g[8 + yOff][x] = 4;

  // Face Silhouette
  for (let y = 9; y <= 16; y++) {
    const leftX = y >= 11 && y <= 14 ? 6 : y === 10 || y === 15 ? 7 : 8;
    const rightX = y >= 11 && y <= 14 ? 25 : y === 10 || y === 15 ? 24 : 23;

    g[y + yOff][leftX] = 1;
    g[y + yOff][rightX] = 1;

    for (let x = leftX + 1; x < rightX; x++) {
      if (y === 9 || y === 10) g[y + yOff][x] = 4;
      else if (y === 11 || y === 12) g[y + yOff][x] = 3;
      else g[y + yOff][x] = 2;
    }
  }

  // Eyes & Expression
  if (isSleeping) {
    // Curled closed sleeping eyes (- -)
    g[12 + yOff][10] = 1; g[12 + yOff][11] = 1; g[12 + yOff][12] = 1;
    g[12 + yOff][19] = 1; g[12 + yOff][20] = 1; g[12 + yOff][21] = 1;
  } else if (isHappy) {
    // Happy crescent eyes (^ ^)
    g[11 + yOff][10] = 1; g[11 + yOff][12] = 1; g[11 + yOff][19] = 1; g[11 + yOff][21] = 1;
    g[12 + yOff][11] = 1; g[12 + yOff][20] = 1;
  } else if (isTired) {
    // Droopy eyelids
    g[11 + yOff][10] = 1; g[11 + yOff][11] = 1; g[11 + yOff][12] = 1;
    g[11 + yOff][19] = 1; g[11 + yOff][20] = 1; g[11 + yOff][21] = 1;
    g[12 + yOff][10] = 5; g[12 + yOff][11] = 5; g[12 + yOff][19] = 5; g[12 + yOff][20] = 5;
  } else {
    // Normal open alert emerald eyes with specular glint
    for (let ey = 11; ey <= 13; ey++) {
      for (let ex = 10; ex <= 12; ex++) g[ey + yOff][ex] = 5;
      for (let ex = 19; ex <= 21; ex++) g[ey + yOff][ex] = 5;
    }
    // Mint glint
    g[11 + yOff][10] = 6;
    g[11 + yOff][19] = 6;
  }

  // Nose and Mouth
  g[14 + yOff][15] = 7; g[14 + yOff][16] = 7; // Nose
  if (isEating) {
    g[15 + yOff][15] = 1; g[15 + yOff][16] = 1; // Open mouth chewing
    g[16 + yOff][14] = 6; g[16 + yOff][15] = 6; // Commit snack
  } else {
    g[15 + yOff][14] = 1; g[15 + yOff][17] = 1; // Neutral subtle mouth
  }

  // Torso / Body
  for (let y = 17; y <= 24; y++) {
    const leftX = y >= 20 ? 8 : 9;
    const rightX = y >= 20 ? 23 : 22;

    g[y + yOff][leftX] = 1;
    g[y + yOff][rightX] = 1;

    for (let x = leftX + 1; x < rightX; x++) {
      if (y <= 18) g[y + yOff][x] = 4;
      else if (y <= 21) g[y + yOff][x] = 3;
      else g[y + yOff][x] = 2;
    }
  }

  // Arcane Chest Sigil
  g[19 + yOff][15] = 7; g[19 + yOff][16] = 7;
  g[20 + yOff][14] = 7; g[20 + yOff][15] = 6; g[20 + yOff][16] = 6; g[20 + yOff][17] = 7;
  g[21 + yOff][15] = 7; g[21 + yOff][16] = 7;

  // Front Paws
  if (isSleeping) {
    // Tucked paws
    for (let x = 10; x <= 21; x++) g[25 + yOff][x] = 1;
  } else if (isTraining) {
    // Dash paws / extended claws
    g[24 + yOff][8] = 1; g[24 + yOff][9] = 6; g[24 + yOff][10] = 1;
    g[24 + yOff][21] = 1; g[24 + yOff][22] = 6; g[24 + yOff][23] = 1;
  } else {
    // Standing paws
    g[25 + yOff][11] = 1; g[25 + yOff][12] = 4; g[25 + yOff][13] = 1;
    g[26 + yOff][10] = 1; g[26 + yOff][11] = 6; g[26 + yOff][12] = 1; g[26 + yOff][13] = 6; g[26 + yOff][14] = 1;
    g[25 + yOff][18] = 1; g[25 + yOff][19] = 4; g[25 + yOff][20] = 1;
    g[26 + yOff][17] = 1; g[26 + yOff][18] = 6; g[26 + yOff][19] = 1; g[26 + yOff][20] = 6; g[26 + yOff][21] = 1;
  }

  // Tail
  g[21 + yOff][22] = 1; g[21 + yOff][23] = 3; g[21 + yOff][24] = 1;
  g[20 + yOff][23] = 1; g[20 + yOff][24] = 4; g[20 + yOff][25] = 1;
  g[19 + yOff][24] = 1; g[19 + yOff][25] = 4; g[19 + yOff][26] = 1;
  g[18 + yOff][25] = 1; g[18 + yOff][26] = 6; g[18 + yOff][27] = 1; // Upward tip

  // Sleep Zzz particles
  if (isSleeping) {
    g[4][25] = 6; g[4][26] = 6; g[4][27] = 6;
    g[5][26] = 6;
    g[6][25] = 6; g[6][26] = 6; g[6][27] = 6;
  }

  // Happy sparkles
  if (isHappy) {
    g[6][7] = 6; g[7][7] = 6; g[6][24] = 6; g[7][24] = 6;
  }

  // Evolution Stage Accents
  applyEvolutionDecorations(g, stage, 6, 7);

  return g;
}

// ---------------------------------------------------------------------------
// 4. Ignis Ember (Dragon) 32x32 Matrix Builder
// ---------------------------------------------------------------------------

export function buildDragonMatrix(activity: PetActivityState, stage: EvolutionStage): number[][] {
  const g = createEmptyGrid();
  const isSleeping = activity === 'sleeping';
  const isHappy = activity === 'happy';
  const isTired = activity === 'tired';
  const isEating = activity === 'eating';
  const isTraining = activity === 'training';
  const yOff = isSleeping ? 1 : 0;

  // Horns
  g[4 + yOff][8] = 6; g[4 + yOff][9] = 6; g[5 + yOff][9] = 6;
  g[4 + yOff][22] = 6; g[4 + yOff][23] = 6; g[5 + yOff][22] = 6;
  g[6 + yOff][10] = 1; g[6 + yOff][21] = 1;

  // Wings (Draconic Spans)
  g[10 + yOff][3] = 1; g[10 + yOff][4] = 6; g[10 + yOff][5] = 1; // Left wing tip
  g[11 + yOff][4] = 1; g[11 + yOff][5] = 3; g[11 + yOff][6] = 1;
  g[12 + yOff][5] = 1; g[12 + yOff][6] = 3; g[12 + yOff][7] = 1;

  g[10 + yOff][26] = 1; g[10 + yOff][27] = 6; g[10 + yOff][28] = 1; // Right wing tip
  g[11 + yOff][25] = 1; g[11 + yOff][26] = 3; g[11 + yOff][27] = 1;
  g[12 + yOff][24] = 1; g[12 + yOff][25] = 3; g[12 + yOff][26] = 1;

  // Head
  for (let y = 7; y <= 14; y++) {
    const leftX = y <= 10 ? 10 : 9;
    const rightX = y <= 10 ? 21 : 22;
    g[y + yOff][leftX] = 1;
    g[y + yOff][rightX] = 1;
    for (let x = leftX + 1; x < rightX; x++) {
      g[y + yOff][x] = y <= 10 ? 3 : 4;
    }
  }

  // Snout & Nostrils
  g[14 + yOff][13] = 1; g[14 + yOff][18] = 1; // Nostrils
  if (isEating) {
    g[15 + yOff][14] = 7; g[15 + yOff][15] = 7; g[15 + yOff][16] = 7; g[15 + yOff][17] = 7;
  }

  // Eyes
  if (isSleeping) {
    g[11 + yOff][11] = 1; g[11 + yOff][12] = 1;
    g[11 + yOff][19] = 1; g[11 + yOff][20] = 1;
  } else if (isHappy) {
    g[10 + yOff][11] = 1; g[10 + yOff][13] = 1; g[11 + yOff][12] = 1;
    g[10 + yOff][18] = 1; g[10 + yOff][20] = 1; g[11 + yOff][19] = 1;
  } else if (isTired) {
    g[10 + yOff][11] = 1; g[10 + yOff][12] = 1; g[11 + yOff][11] = 5;
    g[10 + yOff][19] = 1; g[10 + yOff][20] = 1; g[11 + yOff][19] = 5;
  } else {
    // Fierce amber slits
    g[10 + yOff][11] = 5; g[10 + yOff][12] = 7; g[11 + yOff][11] = 1; g[11 + yOff][12] = 5;
    g[10 + yOff][19] = 7; g[10 + yOff][20] = 5; g[11 + yOff][19] = 5; g[11 + yOff][20] = 1;
  }

  // Body & Golden Underbelly
  for (let y = 15; y <= 23; y++) {
    const leftX = 9;
    const rightX = 22;
    g[y + yOff][leftX] = 1;
    g[y + yOff][rightX] = 1;
    for (let x = leftX + 1; x < rightX; x++) {
      if (x >= 13 && x <= 18) {
        g[y + yOff][x] = y % 2 === 0 ? 6 : 5; // Golden belly plates
      } else {
        g[y + yOff][x] = 3;
      }
    }
  }

  // Tail with flame
  g[21 + yOff][23] = 1; g[21 + yOff][24] = 3; g[21 + yOff][25] = 1;
  g[20 + yOff][25] = 1; g[20 + yOff][26] = 5; g[20 + yOff][27] = 7; // Flame tip!
  g[19 + yOff][26] = 7;

  // Training flame breath
  if (isTraining) {
    g[13 + yOff][23] = 5; g[13 + yOff][24] = 7; g[13 + yOff][25] = 7;
    g[14 + yOff][24] = 5; g[14 + yOff][25] = 7;
  }

  // Sleep smoke curl
  if (isSleeping) {
    g[5][24] = 5; g[5][25] = 6;
    g[6][25] = 5;
  }

  // Claws
  g[24 + yOff][11] = 6; g[24 + yOff][12] = 6;
  g[24 + yOff][19] = 6; g[24 + yOff][20] = 6;

  applyEvolutionDecorations(g, stage, 6, 7);
  return g;
}

// ---------------------------------------------------------------------------
// 5. Kitsune Sol (Fox) 32x32 Matrix Builder
// ---------------------------------------------------------------------------

export function buildFoxMatrix(activity: PetActivityState, stage: EvolutionStage): number[][] {
  const g = createEmptyGrid();
  const isSleeping = activity === 'sleeping';
  const isHappy = activity === 'happy';
  const isTired = activity === 'tired';
  const yOff = isSleeping ? 1 : 0;

  // Fox Ears (Large pointed with dark tips)
  g[4 + yOff][8] = 1; g[4 + yOff][9] = 1;
  g[5 + yOff][7] = 1; g[5 + yOff][8] = 6; g[5 + yOff][9] = 1;
  g[6 + yOff][7] = 1; g[6 + yOff][8] = 6; g[6 + yOff][9] = 3; g[6 + yOff][10] = 1;

  g[4 + yOff][22] = 1; g[4 + yOff][23] = 1;
  g[5 + yOff][22] = 1; g[5 + yOff][23] = 6; g[5 + yOff][24] = 1;
  g[6 + yOff][21] = 1; g[6 + yOff][22] = 3; g[6 + yOff][23] = 6; g[6 + yOff][24] = 1;

  // Head Silhouette
  for (let y = 7; y <= 15; y++) {
    const leftX = y >= 11 ? 7 : 8;
    const rightX = y >= 11 ? 24 : 23;
    g[y + yOff][leftX] = 1;
    g[y + yOff][rightX] = 1;
    for (let x = leftX + 1; x < rightX; x++) {
      // Cream cheek tufts and muzzle
      if (y >= 12 && (x <= 11 || x >= 20 || (x >= 13 && x <= 18))) {
        g[y + yOff][x] = 6; // Cream fur
      } else {
        g[y + yOff][x] = y <= 10 ? 4 : 3;
      }
    }
  }

  // Black Nose
  g[14 + yOff][15] = 1; g[14 + yOff][16] = 1;

  // Eyes (Cyan Solar Jewels)
  if (isSleeping) {
    g[11 + yOff][10] = 1; g[11 + yOff][11] = 1; g[11 + yOff][12] = 1;
    g[11 + yOff][19] = 1; g[11 + yOff][20] = 1; g[11 + yOff][21] = 1;
  } else if (isHappy) {
    g[10 + yOff][10] = 1; g[10 + yOff][12] = 1; g[11 + yOff][11] = 1;
    g[10 + yOff][19] = 1; g[10 + yOff][21] = 1; g[11 + yOff][20] = 1;
  } else if (isTired) {
    g[10 + yOff][10] = 1; g[10 + yOff][11] = 1; g[11 + yOff][10] = 5;
    g[10 + yOff][19] = 1; g[10 + yOff][20] = 1; g[11 + yOff][19] = 5;
  } else {
    g[10 + yOff][10] = 5; g[10 + yOff][11] = 5; g[10 + yOff][12] = 6;
    g[10 + yOff][19] = 6; g[10 + yOff][20] = 5; g[10 + yOff][21] = 5;
  }

  // Body & White Chest Ruff
  for (let y = 16; y <= 24; y++) {
    const leftX = 9;
    const rightX = 22;
    g[y + yOff][leftX] = 1;
    g[y + yOff][rightX] = 1;
    for (let x = leftX + 1; x < rightX; x++) {
      if (x >= 13 && x <= 18 && y <= 21) {
        g[y + yOff][x] = 6; // White chest ruff
      } else {
        g[y + yOff][x] = 3;
      }
    }
  }

  // Big Bushy Tail with White Tip
  g[18 + yOff][23] = 3; g[18 + yOff][24] = 3; g[18 + yOff][25] = 1;
  g[17 + yOff][24] = 3; g[17 + yOff][25] = 4; g[17 + yOff][26] = 1;
  g[16 + yOff][25] = 4; g[16 + yOff][26] = 6; g[16 + yOff][27] = 1; // Cream tip!
  g[15 + yOff][26] = 6; g[15 + yOff][27] = 6;

  // Dark Paws
  g[25 + yOff][11] = 1; g[25 + yOff][12] = 1;
  g[25 + yOff][19] = 1; g[25 + yOff][20] = 1;

  if (isSleeping) {
    g[5][25] = 6; g[5][26] = 6; g[6][26] = 6; // Zzz
  }

  applyEvolutionDecorations(g, stage, 5, 7);
  return g;
}

// ---------------------------------------------------------------------------
// 6. Bloop Matrix (Slime) 32x32 Matrix Builder
// ---------------------------------------------------------------------------

export function buildSlimeMatrix(activity: PetActivityState, stage: EvolutionStage): number[][] {
  const g = createEmptyGrid();
  const isSleeping = activity === 'sleeping';
  const isHappy = activity === 'happy';
  const isTired = activity === 'tired';

  // Teardrop Droplet Tip
  g[7][15] = 4; g[7][16] = 4;
  g[8][14] = 4; g[8][15] = 4; g[8][16] = 4; g[8][17] = 4;

  // Dome and Gelatinous Body
  const startY = isSleeping ? 12 : 9;
  for (let y = startY; y <= 24; y++) {
    const spread = Math.min(10, Math.floor((y - startY) * 1.5) + 3);
    const leftX = 16 - spread;
    const rightX = 15 + spread;

    g[y][leftX] = 1;
    g[y][rightX] = 1;

    for (let x = leftX + 1; x < rightX; x++) {
      if (y <= startY + 2) g[y][x] = 4;
      else if (y >= 21) g[y][x] = 2;
      else g[y][x] = 3;
    }
  }

  // Specular Gel Highlight (Upper left)
  g[11][9] = 6; g[11][10] = 6;
  g[12][8] = 6; g[12][9] = 6;

  // Floating Arcane Core Crystal (Memory Node)
  g[16][15] = 5; g[16][16] = 5;
  g[17][14] = 5; g[17][15] = 6; g[17][16] = 6; g[17][17] = 5;
  g[18][15] = 5; g[18][16] = 5;

  // Expressive Kawaii Eyes
  if (isSleeping) {
    g[14][11] = 1; g[14][12] = 1;
    g[14][19] = 1; g[14][20] = 1;
  } else if (isHappy) {
    g[13][11] = 1; g[13][13] = 1; g[14][12] = 1;
    g[13][18] = 1; g[13][20] = 1; g[14][19] = 1;
  } else if (isTired) {
    g[13][11] = 1; g[13][12] = 1; g[14][11] = 1;
    g[13][19] = 1; g[13][20] = 1; g[14][19] = 1;
  } else {
    // Big round cute eyes with specular shines
    g[13][11] = 1; g[13][12] = 6; g[14][11] = 1; g[14][12] = 1;
    g[13][19] = 6; g[13][20] = 1; g[14][19] = 1; g[14][20] = 1;
  }

  // Cheerful Smile or Blush
  g[16][10] = 7; g[16][21] = 7; // Blush
  if (!isSleeping) {
    g[16][15] = 1; g[16][16] = 1; // Smile
  }

  if (isSleeping) {
    g[6][23] = 5; g[6][24] = 5; g[7][24] = 5;
  }

  applyEvolutionDecorations(g, stage, 5, 6);
  return g;
}

// ---------------------------------------------------------------------------
// 7. Evolution Augmentations (Stages 2, 3, 4)
// ---------------------------------------------------------------------------

function applyEvolutionDecorations(
  g: number[][],
  stage: EvolutionStage,
  sparkleColor: number,
  gemColor: number
): void {
  if (stage === 'Juvenile' || stage === 'Ascended' || stage === 'Celestial') {
    // Stage 2+: Elemental ambient sparks
    g[4][7] = sparkleColor;
    g[4][24] = sparkleColor;
  }

  if (stage === 'Ascended' || stage === 'Celestial') {
    // Stage 3+: Dual aura wings / crest flare
    g[14][4] = gemColor; g[14][5] = sparkleColor;
    g[14][26] = sparkleColor; g[14][27] = gemColor;
  }

  if (stage === 'Celestial') {
    // Stage 4: Celestial Crown (x: 12-19, y: 1-3)
    g[1][12] = gemColor; g[1][15] = gemColor; g[1][16] = gemColor; g[1][19] = gemColor;
    g[2][13] = 6; g[2][15] = 6; g[2][16] = 6; g[2][18] = 6;
    for (let x = 12; x <= 19; x++) g[3][x] = gemColor;
  }
}

// ---------------------------------------------------------------------------
// 8. Public Species Registry & Vector Conversion
// ---------------------------------------------------------------------------

export function getSpeciesPalette(species: PetSpecies): Record<number, string> {
  switch (species) {
    case 'dragon':
    case 'ignis_ember':
      return IGNIS_EMBER_PALETTE;
    case 'fox':
    case 'kitsune_sol':
      return KITSUNE_SOL_PALETTE;
    case 'slime':
    case 'bloop_matrix':
      return BLOOP_MATRIX_PALETTE;
    case 'cat':
    case 'shadow_claw':
    default:
      return SHADOW_CLAW_PALETTE;
  }
}

export function getSpeciesMatrix(
  species: PetSpecies,
  activity: PetActivityState,
  stage: EvolutionStage
): number[][] {
  switch (species) {
    case 'dragon':
    case 'ignis_ember':
      return buildDragonMatrix(activity, stage);
    case 'fox':
    case 'kitsune_sol':
      return buildFoxMatrix(activity, stage);
    case 'slime':
    case 'bloop_matrix':
      return buildSlimeMatrix(activity, stage);
    case 'cat':
    case 'shadow_claw':
    default:
      return buildCatMatrix(activity, stage);
  }
}

/**
 * Converts a 32x32 color-index matrix into optimized SVG <rect> markup.
 * Combines consecutive horizontal pixels of identical color into a single wider <rect>.
 */
export function matrixToSvgRects(
  matrix: number[][],
  palette: Record<number, string>,
  scale: number = 3,
  offsetX: number = 0,
  offsetY: number = 0
): string {
  const rects: string[] = [];

  for (let y = 0; y < matrix.length; y++) {
    const row = matrix[y];
    let x = 0;

    while (x < row.length) {
      const colorIndex = row[x];
      if (colorIndex === 0 || !palette[colorIndex]) {
        x++;
        continue;
      }

      // Count run length of identical color
      let runLength = 1;
      while (x + runLength < row.length && row[x + runLength] === colorIndex) {
        runLength++;
      }

      const fill = palette[colorIndex];
      const rx = offsetX + x * scale;
      const ry = offsetY + y * scale;
      const rw = runLength * scale;
      const rh = scale;

      rects.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="${fill}" />`);
      x += runLength;
    }
  }

  return rects.join('\n      ');
}
