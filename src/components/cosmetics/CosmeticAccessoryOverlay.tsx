import React from 'react';
import type { CosmeticId } from '@/features/progression/types';
import type { SpeciesId } from '@/types/pet';

interface CosmeticAccessoryOverlayProps {
  accessoryId: CosmeticId | null;
  species: SpeciesId;
  size?: number;
  className?: string;
}

/**
 * Composable pixel-art SVG overlay for accessories rendered directly in scale with PetSprite.
 */
export const CosmeticAccessoryOverlay: React.FC<CosmeticAccessoryOverlayProps> = ({
  accessoryId,
  species,
  size = 180,
  className = '',
}) => {
  if (!accessoryId) return null;

  // Coordinate adjustments per species viewBox
  const isDragon = species === 'dragon';
  const isFox = species === 'fox';
  const viewBox = isDragon ? '0 0 28 28' : isFox ? '0 0 26 26' : '0 0 24 24';
  const offsetX = isDragon ? 2 : isFox ? 1 : 0;
  const offsetY = isDragon ? 0 : 0;

  const renderAccessory = () => {
    switch (accessoryId) {
      case 'mini_crown': {
        // Golden mini-crown with ruby/sapphire jewels atop head
        const cx = 10 + offsetX;
        const cy = 1 + offsetY;
        return (
          <g className="animate-pulse" opacity="0.95">
            {/* Crown base */}
            <rect x={cx} y={cy + 3} width={4} height={1} fill="#d97706" />
            <rect x={cx} y={cy + 2} width={4} height={1} fill="#fbbf24" />
            {/* Crown peaks */}
            <rect x={cx} y={cy} width={1} height={2} fill="#fbbf24" />
            <rect x={cx + 1} y={cy + 1} width={2} height={1} fill="#fbbf24" />
            <rect x={cx + 3} y={cy} width={1} height={2} fill="#fbbf24" />
            {/* Jewel sparkles */}
            <rect x={cx} y={cy} width={1} height={1} fill="#ef4444" />
            <rect x={cx + 3} y={cy} width={1} height={1} fill="#3b82f6" />
            <rect x={cx + 1} y={cy + 2} width={2} height={1} fill="#fef08a" />
          </g>
        );
      }

      case 'dev_glasses': {
        // Dark-rimmed programmer spectacles with cyan reflection glints
        const gx = 5 + offsetX;
        const gy = (species === 'slime' ? 12 : 8) + offsetY;
        return (
          <g opacity="0.95">
            {/* Left rim */}
            <rect x={gx} y={gy} width={5} height={1} fill="#0f172a" />
            <rect x={gx} y={gy + 3} width={5} height={1} fill="#0f172a" />
            <rect x={gx} y={gy} width={1} height={4} fill="#0f172a" />
            <rect x={gx + 4} y={gy} width={1} height={4} fill="#0f172a" />
            {/* Right rim */}
            <rect x={gx + 8} y={gy} width={5} height={1} fill="#0f172a" />
            <rect x={gx + 8} y={gy + 3} width={5} height={1} fill="#0f172a" />
            <rect x={gx + 8} y={gy} width={1} height={4} fill="#0f172a" />
            <rect x={gx + 12} y={gy} width={1} height={4} fill="#0f172a" />
            {/* Bridge */}
            <rect x={gx + 4} y={gy + 1} width={5} height={1} fill="#0f172a" />
            {/* Glass lens reflection */}
            <rect x={gx + 1} y={gy + 1} width={2} height={1} fill="#38bdf8" opacity="0.8" />
            <rect x={gx + 9} y={gy + 1} width={2} height={1} fill="#38bdf8" opacity="0.8" />
          </g>
        );
      }

      case 'star_charm': {
        // Golden star pendant resting on chest
        const sx = 10 + offsetX;
        const sy = (species === 'slime' ? 16 : 14) + offsetY;
        return (
          <g className="animate-bounce" opacity="0.95">
            {/* Chain links */}
            <rect x={sx - 1} y={sy - 1} width={1} height={1} fill="#94a3b8" />
            <rect x={sx + 4} y={sy - 1} width={1} height={1} fill="#94a3b8" />
            {/* Star badge */}
            <rect x={sx + 1} y={sy} width={2} height={3} fill="#fbbf24" />
            <rect x={sx} y={sy + 1} width={4} height={1} fill="#f59e0b" />
            <rect x={sx + 1} y={sy + 1} width={2} height={1} fill="#fef08a" />
          </g>
        );
      }

      case 'explorer_scarf': {
        // Knit ruby explorer scarf wrapped around neck
        const kx = 6 + offsetX;
        const ky = (species === 'slime' ? 15 : 13) + offsetY;
        return (
          <g opacity="0.95">
            {/* Collar wrap */}
            <rect x={kx} y={ky} width={12} height={2} fill="#dc2626" />
            <rect x={kx + 1} y={ky + 1} width={10} height={1} fill="#b91c1c" />
            <rect x={kx + 3} y={ky} width={2} height={2} fill="#f87171" />
            <rect x={kx + 7} y={ky} width={2} height={2} fill="#f87171" />
            {/* Trailing scarf end */}
            <rect x={kx + 2} y={ky + 2} width={3} height={3} fill="#dc2626" />
            <rect x={kx + 2} y={ky + 5} width={3} height={1} fill="#991b1b" />
            <rect x={kx + 2} y={ky + 3} width={1} height={2} fill="#fca5a5" />
          </g>
        );
      }

      case 'guardian_emblem': {
        // Silver-and-cyan heraldic shoulder guard
        const ex = 4 + offsetX;
        const ey = (species === 'slime' ? 13 : 13) + offsetY;
        return (
          <g opacity="0.95">
            {/* Shield plate */}
            <rect x={ex} y={ey} width={3} height={4} fill="#64748b" />
            <rect x={ex} y={ey + 4} width={2} height={1} fill="#475569" />
            <rect x={ex + 1} y={ey + 1} width={2} height={2} fill="#94a3b8" />
            {/* Arcane emblem rune */}
            <rect x={ex + 1} y={ey + 1} width={1} height={1} fill="#38bdf8" />
            <rect x={ex + 2} y={ey + 2} width={1} height={1} fill="#38bdf8" />
          </g>
        );
      }

      default:
        return null;
    }
  };

  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      className={`absolute inset-0 select-none pointer-events-none z-20 ${className}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {renderAccessory()}
    </svg>
  );
};
