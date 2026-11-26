import React from 'react';
import type { CosmeticId } from '@/features/progression/types';

interface CosmeticEffectLayerProps {
  effectId: CosmeticId | null;
  className?: string;
}

export const CosmeticEffectLayer: React.FC<CosmeticEffectLayerProps> = ({ effectId, className = '' }) => {
  if (!effectId) return null;

  switch (effectId) {
    case 'emerald_sparkle':
      return (
        <div
          className={`absolute -inset-6 pointer-events-none z-10 overflow-hidden ${className}`}
          aria-hidden="true"
        >
          {/* 4 floating emerald sparkle stars */}
          <div className="absolute top-2 left-6 w-2 h-2 bg-emerald-400 rotate-45 animate-ping opacity-75 shadow-[0_0_8px_#10b981]" />
          <div className="absolute bottom-6 right-6 w-2.5 h-2.5 bg-emerald-300 rotate-12 animate-pulse opacity-85 shadow-[0_0_10px_#34d399]" />
          <div className="absolute top-1/2 left-2 w-1.5 h-1.5 bg-teal-200 rotate-45 animate-bounce opacity-80" />
          <div className="absolute top-6 right-8 w-2 h-2 bg-emerald-200 rotate-45 animate-pulse opacity-90 shadow-[0_0_6px_#10b981]" />
        </div>
      );

    case 'solar_particles':
      return (
        <div
          className={`absolute -inset-6 pointer-events-none z-10 overflow-hidden ${className}`}
          aria-hidden="true"
        >
          {/* Warm undulating solar embers */}
          <div className="absolute -inset-2 bg-radial from-amber-500/20 via-transparent to-transparent rounded-full animate-pulse opacity-60" />
          <div className="absolute bottom-4 left-1/4 w-2 h-2 bg-amber-400 rounded-full animate-bounce opacity-80 shadow-[0_0_10px_#f59e0b]" />
          <div className="absolute bottom-8 right-1/4 w-1.5 h-1.5 bg-yellow-300 rounded-full animate-ping opacity-75" />
          <div className="absolute top-8 left-8 w-2 h-2 bg-amber-300 rotate-45 animate-pulse opacity-90 shadow-[0_0_8px_#fbbf24]" />
          <div className="absolute top-4 right-10 w-2.5 h-2.5 bg-yellow-200 rounded-full animate-bounce opacity-80" />
        </div>
      );

    case 'crimson_aura':
      return (
        <div
          className={`absolute -inset-8 pointer-events-none z-10 flex items-center justify-center ${className}`}
          aria-hidden="true"
        >
          {/* Pulsating fierce power ring */}
          <div className="w-48 h-48 rounded-full border-2 border-red-500/60 bg-red-950/20 animate-pulse shadow-[0_0_24px_rgba(239,68,68,0.4)]" />
          <div className="absolute top-3 right-6 w-2 h-2 bg-rose-400 rotate-45 animate-ping opacity-80" />
          <div className="absolute bottom-4 left-6 w-2.5 h-2.5 bg-red-400 rotate-45 animate-pulse opacity-90 shadow-[0_0_8px_#ef4444]" />
        </div>
      );

    case 'calm_glow':
      return (
        <div
          className={`absolute -inset-8 pointer-events-none z-10 flex items-center justify-center ${className}`}
          aria-hidden="true"
        >
          {/* Serene cyan harmonic halo */}
          <div className="w-44 h-44 rounded-full border border-cyan-400/50 bg-cyan-950/20 animate-pulse shadow-[0_0_20px_rgba(6,182,212,0.35)]" />
          <div className="absolute top-4 left-10 w-2 h-2 bg-cyan-300 rounded-full animate-ping opacity-60" />
          <div className="absolute bottom-6 right-10 w-2 h-2 bg-sky-200 rotate-45 animate-pulse opacity-75 shadow-[0_0_8px_#38bdf8]" />
        </div>
      );

    default:
      return null;
  }
};
