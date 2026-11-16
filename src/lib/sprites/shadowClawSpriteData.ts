/**
 * Shadow Claw (Cat) Flagship Character Prototype
 * Frame-by-Frame Pixel Matrix Definitions (32x32)
 *
 * Indexed Color Palette (7 Colors):
 * 0: Transparent
 * 1: #1a1228 (Void Ink - Outline)
 * 2: #2d184a (Deep Velvet - Base Shading)
 * 3: #4a247a (Arcane Plum - Midtone Body)
 * 4: #6d39a8 (Astral Violet - Upper Highlight)
 * 5: #10b981 (Emerald Terminal - Eye Iris)
 * 6: #d1fae5 (Mint Gleam - Eye Specular Glint)
 * 7: #f472b6 (Rose Sigil - Inner Ear & Chest Crest)
 */

export const SHADOW_CLAW_PALETTE: Record<number, string> = {
  0: 'transparent',
  1: '#1a1228',
  2: '#2d184a',
  3: '#4a247a',
  4: '#6d39a8',
  5: '#10b981',
  6: '#d1fae5',
  7: '#f472b6',
};

export type Frame32 = number[][]; // 32x32 array of color indices

/**
 * Helper to build an empty 32x32 grid
 */
export function createEmptyGrid(): Frame32 {
  return Array.from({ length: 32 }, () => Array(32).fill(0));
}

/**
 * Base Cat Generator helper for 32x32 matrix
 */
export function buildCatBase(params: {
  bodyYOffset?: number; // Breathing translation
  earLeftFlick?: boolean;
  earRightFlick?: boolean;
  eyeState?: 'open' | 'blink' | 'happy' | 'tired' | 'sleep';
  mouthState?: 'neutral' | 'open' | 'chew';
  tailState?: 'curled' | 'swish_up' | 'swish_down' | 'wag';
  pawsState?: 'standing' | 'tucked' | 'dash';
  hasCrestFlare?: boolean;
  hasParticles?: boolean;
}): Frame32 {
  const g = createEmptyGrid();
  const yOff = params.bodyYOffset || 0;

  // 1. EAR LEFT (x: 7-11, y: 5-8 + yOff)
  if (params.earLeftFlick) {
    // Left ear flapped slightly outward
    g[5 + yOff][7] = 1; g[5 + yOff][8] = 1;
    g[6 + yOff][6] = 1; g[6 + yOff][7] = 7; g[6 + yOff][8] = 1;
    g[7 + yOff][6] = 1; g[7 + yOff][7] = 7; g[7 + yOff][8] = 7; g[7 + yOff][9] = 1;
    g[8 + yOff][6] = 1; g[8 + yOff][7] = 2; g[8 + yOff][8] = 7; g[8 + yOff][9] = 7; g[8 + yOff][10] = 1;
  } else {
    // Normal pointed triangular void ear (symmetrical to right ear across x = 15.5)
    g[5 + yOff][9] = 1; g[5 + yOff][10] = 1;
    g[6 + yOff][8] = 1; g[6 + yOff][9] = 7; g[6 + yOff][10] = 1;
    g[7 + yOff][8] = 1; g[7 + yOff][9] = 7; g[7 + yOff][10] = 7; g[7 + yOff][11] = 1;
    g[8 + yOff][7] = 1; g[8 + yOff][8] = 2; g[8 + yOff][9] = 7; g[8 + yOff][10] = 7; g[8 + yOff][11] = 1;
  }

  // 2. EAR RIGHT (x: 20-24, y: 5-8 + yOff)
  if (params.earRightFlick) {
    g[5 + yOff][23] = 1; g[5 + yOff][24] = 1;
    g[6 + yOff][23] = 1; g[6 + yOff][24] = 7; g[6 + yOff][25] = 1;
    g[7 + yOff][22] = 1; g[7 + yOff][23] = 7; g[7 + yOff][24] = 7; g[7 + yOff][25] = 1;
    g[8 + yOff][21] = 1; g[8 + yOff][22] = 7; g[8 + yOff][23] = 7; g[8 + yOff][24] = 2; g[8 + yOff][25] = 1;
  } else {
    // Normal pointed triangular void ear (symmetrical to left ear across x = 15.5)
    g[5 + yOff][21] = 1; g[5 + yOff][22] = 1;
    g[6 + yOff][21] = 1; g[6 + yOff][22] = 7; g[6 + yOff][23] = 1;
    g[7 + yOff][20] = 1; g[7 + yOff][21] = 7; g[7 + yOff][22] = 7; g[7 + yOff][23] = 1;
    g[8 + yOff][20] = 1; g[8 + yOff][21] = 7; g[8 + yOff][22] = 7; g[8 + yOff][23] = 2; g[8 + yOff][24] = 1;
  }

  // 3. HEAD SILHOUETTE & CROWN BRIDGE (x: 8 to 23, y: 8 to 17 + yOff)
  // Crown bridge between ears at row 8
  const crownStart = params.earLeftFlick ? 10 : 11;
  const crownEnd = params.earRightFlick ? 21 : 20;
  for (let x = crownStart; x <= crownEnd; x++) g[8 + yOff][x] = 1;

  // Row 9: Smooth transitional forehead bridge connecting ear bases into skull
  const row9LeftOutline = params.earLeftFlick ? 7 : 8;
  const row9RightOutline = params.earRightFlick ? 24 : 23;
  g[9 + yOff][row9LeftOutline] = 1;
  g[9 + yOff][row9LeftOutline + 1] = 2; // Deep Velvet shading adjacent to outline
  g[9 + yOff][row9LeftOutline + 2] = 3; // Arcane Plum transition
  for (let x = row9LeftOutline + 3; x <= row9RightOutline - 3; x++) {
    g[9 + yOff][x] = 4; // Astral Violet crown highlight sheen
  }
  g[9 + yOff][row9RightOutline - 2] = 3; // Arcane Plum transition
  g[9 + yOff][row9RightOutline - 1] = 2; // Deep Velvet shading adjacent to outline
  g[9 + yOff][row9RightOutline] = 1;

  // Rows 10 to 16: Main head volume with lateral depth shading
  for (let y = 10; y <= 16; y++) {
    g[y + yOff][8] = 1; // Left cheek outline
    g[y + yOff][23] = 1; // Right cheek outline
    g[y + yOff][9] = 2; // Left lateral depth shadow (Deep Velvet)
    for (let x = 10; x <= 21; x++) {
      g[y + yOff][x] = y <= 12 ? 4 : 3; // Gradient from Astral Violet to Arcane Plum
    }
    g[y + yOff][22] = 2; // Right lateral depth shadow (Deep Velvet)
  }

  // Lower jawline
  for (let x = 9; x <= 22; x++) g[17 + yOff][x] = 1;

  // 4. EYES (Left: x: 10-12, Right: x: 19-21, y: 12-14 + yOff)
  const eyeY = 12 + yOff;
  if (params.eyeState === 'happy') {
    // Happy crescent squint eyes (^ ^)
    g[eyeY][10] = 1; g[eyeY][12] = 1; g[eyeY - 1][11] = 1;
    g[eyeY][19] = 1; g[eyeY][21] = 1; g[eyeY - 1][20] = 1;
  } else if (params.eyeState === 'sleep' || params.eyeState === 'blink') {
    // Closed relaxed horizontal slit
    g[eyeY][10] = 1; g[eyeY][11] = 1; g[eyeY][12] = 1;
    g[eyeY][19] = 1; g[eyeY][20] = 1; g[eyeY][21] = 1;
  } else if (params.eyeState === 'tired') {
    // Heavy half-lidded eyes
    g[eyeY - 1][10] = 1; g[eyeY - 1][11] = 1; g[eyeY - 1][12] = 1;
    g[eyeY][10] = 1; g[eyeY][11] = 5; g[eyeY][12] = 1;
    g[eyeY - 1][19] = 1; g[eyeY - 1][20] = 1; g[eyeY - 1][21] = 1;
    g[eyeY][19] = 1; g[eyeY][20] = 5; g[eyeY][21] = 1;
  } else {
    // Default open jewel eyes: 3x3 with iris, pupil, and specular gleam
    // Left eye
    g[eyeY][10] = 6; g[eyeY][11] = 5; g[eyeY][12] = 5;
    g[eyeY + 1][10] = 5; g[eyeY + 1][11] = 1; g[eyeY + 1][12] = 5; // Pupil in center
    g[eyeY + 2][10] = 1; g[eyeY + 2][11] = 5; g[eyeY + 2][12] = 1;

    // Right eye
    g[eyeY][19] = 6; g[eyeY][20] = 5; g[eyeY][21] = 5;
    g[eyeY + 1][19] = 5; g[eyeY + 1][20] = 1; g[eyeY + 1][21] = 5;
    g[eyeY + 2][19] = 1; g[eyeY + 2][20] = 5; g[eyeY + 2][21] = 1;
  }

  // 5. NOSE & MOUTH (Center x: 15-16, y: 15-16 + yOff)
  g[14 + yOff][15] = 7; g[14 + yOff][16] = 7; // Pink nose
  if (params.mouthState === 'open') {
    g[15 + yOff][15] = 1; g[15 + yOff][16] = 1; // Open mouth cavity
    g[16 + yOff][15] = 7; g[16 + yOff][16] = 7; // Tongue
    g[17 + yOff][15] = 1; g[17 + yOff][16] = 1;
  } else if (params.mouthState === 'chew') {
    g[15 + yOff][14] = 7; g[15 + yOff][15] = 1; g[15 + yOff][16] = 1; g[15 + yOff][17] = 7; // Bulging cheeks
  } else {
    g[15 + yOff][15] = 1; g[15 + yOff][16] = 1; // Subtle cat mouth line
  }

  // Whiskers (x: 5-7, 24-26)
  g[13 + yOff][6] = 4; g[13 + yOff][7] = 4;
  g[15 + yOff][5] = 4; g[15 + yOff][6] = 4;
  g[13 + yOff][24] = 4; g[13 + yOff][25] = 4;
  g[15 + yOff][25] = 4; g[15 + yOff][26] = 4;

  // 6. TORSO & CHEST (x: 10 to 21, y: 18 to 25 + yOff)
  for (let y = 18; y <= 24; y++) {
    g[y + yOff][10] = 1;
    g[y + yOff][21] = 1;
    for (let x = 11; x <= 20; x++) {
      g[y + yOff][x] = y >= 22 ? 2 : 3; // Shading to Deep Velvet
    }
  }

  // Arcane Chest Sigil
  g[19 + yOff][15] = 7; g[19 + yOff][16] = 7;
  g[20 + yOff][14] = 7; g[20 + yOff][15] = 6; g[20 + yOff][16] = 6; g[20 + yOff][17] = 7;
  g[21 + yOff][15] = 7; g[21 + yOff][16] = 7;
  if (params.hasCrestFlare) {
    g[18 + yOff][15] = 6; g[18 + yOff][16] = 6;
    g[22 + yOff][15] = 6; g[22 + yOff][16] = 6;
  }

  // 7. PAWS (Front: x: 11-13, x: 18-20, y: 25 to 27)
  if (params.pawsState === 'tucked') {
    // Tucked under body (sleeping/loafing)
    for (let x = 10; x <= 21; x++) g[25 + yOff][x] = 1;
    for (let x = 11; x <= 20; x++) g[24 + yOff][x] = 2;
  } else if (params.pawsState === 'dash') {
    // Training action leap stance
    g[24 + yOff][9] = 1; g[24 + yOff][10] = 4; g[24 + yOff][11] = 1;
    g[25 + yOff][8] = 1; g[25 + yOff][9] = 6; g[25 + yOff][10] = 1; // Extended left claw
    g[24 + yOff][20] = 1; g[24 + yOff][21] = 4; g[24 + yOff][22] = 1;
    g[25 + yOff][21] = 1; g[25 + yOff][22] = 6; g[25 + yOff][23] = 1; // Extended right claw
  } else {
    // Standing paws
    // Left Paw
    g[25 + yOff][11] = 1; g[25 + yOff][12] = 3; g[25 + yOff][13] = 1;
    g[26 + yOff][11] = 1; g[26 + yOff][12] = 4; g[26 + yOff][13] = 1;
    g[27 + yOff][10] = 1; g[27 + yOff][11] = 6; g[27 + yOff][12] = 1; g[27 + yOff][13] = 6; g[27 + yOff][14] = 1;

    // Right Paw
    g[25 + yOff][18] = 1; g[25 + yOff][19] = 3; g[25 + yOff][20] = 1;
    g[26 + yOff][18] = 1; g[26 + yOff][19] = 4; g[26 + yOff][20] = 1;
    g[27 + yOff][17] = 1; g[27 + yOff][18] = 6; g[27 + yOff][19] = 1; g[27 + yOff][20] = 6; g[27 + yOff][21] = 1;
  }

  // 8. TAIL (Right side curled or animated)
  if (params.tailState === 'swish_up') {
    g[21 + yOff][22] = 1; g[21 + yOff][23] = 3; g[21 + yOff][24] = 1;
    g[19 + yOff][24] = 1; g[19 + yOff][25] = 4; g[19 + yOff][26] = 1;
    g[17 + yOff][25] = 1; g[17 + yOff][26] = 6; g[17 + yOff][27] = 1; // Upward curled tip
  } else if (params.tailState === 'swish_down') {
    g[22 + yOff][22] = 1; g[22 + yOff][23] = 3; g[22 + yOff][24] = 1;
    g[23 + yOff][24] = 1; g[23 + yOff][25] = 4; g[23 + yOff][26] = 1;
    g[24 + yOff][26] = 1; g[24 + yOff][27] = 6; g[24 + yOff][28] = 1; // Low flick
  } else {
    // Normal curled mystical tail
    g[21 + yOff][22] = 1; g[21 + yOff][23] = 3; g[21 + yOff][24] = 1;
    g[20 + yOff][23] = 1; g[20 + yOff][24] = 4; g[20 + yOff][25] = 1;
    g[19 + yOff][24] = 1; g[19 + yOff][25] = 4; g[19 + yOff][26] = 1;
    g[18 + yOff][25] = 1; g[18 + yOff][26] = 6; g[18 + yOff][27] = 1;
  }

  // 9. PARTICLES (Zzz for sleep, sparks for evolve, heart for happy)
  if (params.hasParticles) {
    if (params.eyeState === 'sleep') {
      // Floating 'Z'
      g[6][24] = 6; g[6][25] = 6; g[6][26] = 6;
      g[7][25] = 6;
      g[8][24] = 6; g[8][25] = 6; g[8][26] = 6;
    } else if (params.hasCrestFlare) {
      // Sparkles
      g[4][7] = 6; g[4][24] = 6;
      g[28][5] = 5; g[28][26] = 5;
    }
  }

  return g;
}

/**
 * 8 Fully Articulated Frame Sets for Shadow Claw
 */
export const SHADOW_CLAW_ANIMATIONS: Record<string, { frameCount: number; durationMs: number; frames: Frame32[] }> = {
  idle: {
    frameCount: 4,
    durationMs: 800,
    frames: [
      buildCatBase({ bodyYOffset: 0, earLeftFlick: false, earRightFlick: false, eyeState: 'open', tailState: 'curled' }),
      buildCatBase({ bodyYOffset: -1, earLeftFlick: false, earRightFlick: false, eyeState: 'open', tailState: 'swish_up' }),
      buildCatBase({ bodyYOffset: -1, earLeftFlick: true, earRightFlick: false, eyeState: 'open', tailState: 'swish_up' }),
      buildCatBase({ bodyYOffset: 0, earLeftFlick: false, earRightFlick: false, eyeState: 'open', tailState: 'curled' }),
    ],
  },
  happy: {
    frameCount: 4,
    durationMs: 600,
    frames: [
      buildCatBase({ bodyYOffset: 0, eyeState: 'happy', tailState: 'swish_up', hasParticles: true }),
      buildCatBase({ bodyYOffset: -2, eyeState: 'happy', tailState: 'swish_down', hasParticles: true }),
      buildCatBase({ bodyYOffset: -1, eyeState: 'happy', tailState: 'swish_up', hasParticles: true }),
      buildCatBase({ bodyYOffset: 0, eyeState: 'happy', tailState: 'swish_down', hasParticles: false }),
    ],
  },
  curious: {
    frameCount: 3,
    durationMs: 600,
    frames: [
      buildCatBase({ bodyYOffset: 0, earLeftFlick: true, eyeState: 'open', tailState: 'curled' }),
      buildCatBase({ bodyYOffset: 0, earLeftFlick: true, earRightFlick: true, eyeState: 'open', tailState: 'swish_up' }),
      buildCatBase({ bodyYOffset: 0, earLeftFlick: false, earRightFlick: false, eyeState: 'open', tailState: 'curled' }),
    ],
  },
  tired: {
    frameCount: 2,
    durationMs: 1200,
    frames: [
      buildCatBase({ bodyYOffset: 0, eyeState: 'tired', tailState: 'swish_down' }),
      buildCatBase({ bodyYOffset: 1, eyeState: 'tired', tailState: 'swish_down' }),
    ],
  },
  sleeping: {
    frameCount: 4,
    durationMs: 1600,
    frames: [
      buildCatBase({ bodyYOffset: 1, eyeState: 'sleep', pawsState: 'tucked', tailState: 'curled', hasParticles: true }),
      buildCatBase({ bodyYOffset: 2, eyeState: 'sleep', pawsState: 'tucked', tailState: 'curled', hasParticles: true }),
      buildCatBase({ bodyYOffset: 1, eyeState: 'sleep', pawsState: 'tucked', tailState: 'curled', hasParticles: false }),
      buildCatBase({ bodyYOffset: 0, eyeState: 'sleep', pawsState: 'tucked', tailState: 'curled', hasParticles: true }),
    ],
  },
  eating: {
    frameCount: 6,
    durationMs: 750,
    frames: [
      buildCatBase({ bodyYOffset: 0, mouthState: 'open', eyeState: 'open' }),
      buildCatBase({ bodyYOffset: 0, mouthState: 'chew', eyeState: 'happy' }),
      buildCatBase({ bodyYOffset: -1, mouthState: 'chew', eyeState: 'happy' }),
      buildCatBase({ bodyYOffset: 0, mouthState: 'open', eyeState: 'open' }),
      buildCatBase({ bodyYOffset: 0, mouthState: 'chew', eyeState: 'happy' }),
      buildCatBase({ bodyYOffset: 0, mouthState: 'neutral', eyeState: 'open' }),
    ],
  },
  training: {
    frameCount: 6,
    durationMs: 600,
    frames: [
      buildCatBase({ bodyYOffset: 1, pawsState: 'standing', tailState: 'swish_down' }), // Anticipate
      buildCatBase({ bodyYOffset: -2, pawsState: 'dash', tailState: 'swish_up', hasCrestFlare: true }), // Leap
      buildCatBase({ bodyYOffset: -3, pawsState: 'dash', tailState: 'swish_up', hasCrestFlare: true }), // Peak swipe
      buildCatBase({ bodyYOffset: -1, pawsState: 'dash', tailState: 'swish_down' }), // Decelerate
      buildCatBase({ bodyYOffset: 0, pawsState: 'standing', tailState: 'curled' }), // Land
      buildCatBase({ bodyYOffset: 0, pawsState: 'standing', tailState: 'curled' }),
    ],
  },
  evolve: {
    frameCount: 8,
    durationMs: 1200,
    frames: [
      buildCatBase({ bodyYOffset: 0, hasCrestFlare: false }),
      buildCatBase({ bodyYOffset: 0, hasCrestFlare: true }),
      buildCatBase({ bodyYOffset: -1, hasCrestFlare: true, hasParticles: true }),
      buildCatBase({ bodyYOffset: -2, hasCrestFlare: true, hasParticles: true }),
      buildCatBase({ bodyYOffset: -3, hasCrestFlare: true, hasParticles: true }),
      buildCatBase({ bodyYOffset: -2, hasCrestFlare: true, hasParticles: true }),
      buildCatBase({ bodyYOffset: -1, hasCrestFlare: true, hasParticles: true }),
      buildCatBase({ bodyYOffset: 0, hasCrestFlare: false }),
    ],
  },
};
