import React from 'react';
import type { CosmeticId } from '@/features/progression/types';

interface CompanionDecorationOverlayProps {
  decorationId: CosmeticId | null;
  className?: string;
}

export const CompanionDecorationOverlay: React.FC<CompanionDecorationOverlayProps> = ({
  decorationId,
  className = '',
}) => {
  if (!decorationId) return null;

  switch (decorationId) {
    case 'companion_badge':
      return (
        <div
          className={`absolute bottom-3 right-4 z-20 pointer-events-none flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-500/70 shadow-[0_0_10px_rgba(245,158,11,0.3)] animate-pulse ${className}`}
          aria-hidden="true"
        >
          <span className="text-xs">🐾</span>
          <span className="text-[10px] font-mono font-bold text-amber-300 uppercase tracking-wider">
            Trusted Companion
          </span>
        </div>
      );

    case 'floating_emblem':
      return (
        <div
          className={`absolute top-10 right-4 z-20 pointer-events-none flex flex-col items-center animate-bounce ${className}`}
          aria-hidden="true"
        >
          <div className="w-7 h-7 rounded-lg bg-indigo-950/90 border-2 border-indigo-400 flex items-center justify-center text-sm shadow-[0_0_12px_rgba(99,102,241,0.5)]">
            🔮
          </div>
          <span className="text-[8px] font-mono text-indigo-300 font-bold mt-0.5">SIGIL</span>
        </div>
      );

    case 'decorative_frame':
      return (
        <div
          className={`absolute inset-0 pointer-events-none z-30 overflow-hidden border-[3px] border-amber-500/60 rounded-2xl shadow-[inset_0_0_15px_rgba(245,158,11,0.25)] ${className}`}
          aria-hidden="true"
        >
          {/* Corner gold brackets */}
          <div className="absolute top-1 left-1 w-3 h-3 border-t-2 border-l-2 border-amber-300" />
          <div className="absolute top-1 right-1 w-3 h-3 border-t-2 border-r-2 border-amber-300" />
          <div className="absolute bottom-1 left-1 w-3 h-3 border-b-2 border-l-2 border-amber-300" />
          <div className="absolute bottom-1 right-1 w-3 h-3 border-b-2 border-r-2 border-amber-300" />
        </div>
      );

    default:
      return null;
  }
};
