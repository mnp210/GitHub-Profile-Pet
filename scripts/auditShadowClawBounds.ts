import {
  SHADOW_CLAW_ANIMATIONS,
  type Frame32,
} from '../src/lib/sprites/shadowClawSpriteData.ts';

/**
 * Validates pixel bounds and color indices for a frame
 */
function validateFrame(frame: Frame32, stateName: string, frameIdx: number) {
  let minX = 32, maxX = 0, minY = 32, maxY = 0;
  let activePixels = 0;

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = frame[y][x];
      if (c < 0 || c > 7) {
        throw new Error(`Invalid palette index ${c} at (${x}, ${y}) in ${stateName} frame ${frameIdx}`);
      }
      if (c > 0) {
        activePixels++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  // Verify bounded envelope: max 26x26 (excluding occasional leaps/particles which stay in 32x32)
  if (width > 28 || height > 28) {
    console.warn(`[WARN] ${stateName} frame ${frameIdx} width: ${width}, height: ${height} approaches outer 32x32 boundary.`);
  }

  return { activePixels, minX, maxX, minY, maxY, width, height };
}

console.log('Auditing Shadow Claw Prototype 32x32 Matrix Frames:');
let totalFrames = 0;

for (const [stateName, data] of Object.entries(SHADOW_CLAW_ANIMATIONS)) {
  console.log(`\nState: ${stateName.toUpperCase()} (${data.frameCount} frames, ${data.durationMs}ms)`);
  data.frames.forEach((frame, idx) => {
    const stats = validateFrame(frame, stateName, idx);
    console.log(`  Frame ${idx}: ${stats.activePixels} pixels, bounds [${stats.minX},${stats.minY}] to [${stats.maxX},${stats.maxY}] (${stats.width}x${stats.height}px)`);
    totalFrames++;
  });
}

console.log(`\nTotal verified production frames: ${totalFrames} frames across 8 states.`);
