import React from 'react';
import type { CosmeticId } from '@/features/progression/types';

interface EnvironmentBackgroundProps {
  environmentId: CosmeticId | null;
  className?: string;
}

export const EnvironmentBackground: React.FC<EnvironmentBackgroundProps> = ({
  environmentId,
  className = '',
}) => {
  const env = environmentId || 'void_chamber';

  switch (env) {
    case 'starlight_platform':
      return (
        <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} aria-hidden="true">
          {/* Midnight Celestial Gradient & Blue Star Clusters */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#03071e] via-[#0b132b] to-[#1c2541]" />
          <div className="absolute inset-0 bg-radial from-blue-600/15 via-transparent to-transparent opacity-80" />
          <div className="absolute top-3 left-8 w-1.5 h-1.5 bg-blue-200 rounded-full animate-ping opacity-80 shadow-[0_0_8px_#60a5fa]" />
          <div className="absolute top-12 right-12 w-2 h-2 bg-cyan-200 rotate-45 animate-pulse opacity-90 shadow-[0_0_10px_#38bdf8]" />
          <div className="absolute bottom-20 left-16 w-1 h-1 bg-indigo-300 rounded-full animate-pulse opacity-70" />
          <div className="absolute top-16 left-1/3 w-1.5 h-1.5 bg-sky-200 rounded-full animate-ping opacity-75" />
          <div className="absolute bottom-24 right-1/4 w-1 h-1 bg-blue-100 rounded-full animate-pulse opacity-60" />
          {/* Subtle celestial constellation lines */}
          <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
            <line x1="20%" y1="15%" x2="35%" y2="25%" stroke="#60a5fa" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="35%" y1="25%" x2="50%" y2="18%" stroke="#60a5fa" strokeWidth="1" strokeDasharray="3 3" />
            <line x1="70%" y1="20%" x2="85%" y2="35%" stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 3" />
          </svg>
        </div>
      );

    case 'forest_sanctuary':
      return (
        <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} aria-hidden="true">
          {/* Serene Mossy Woodland Glade & Fireflies */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#022c22] via-[#064e3b] to-[#022019]" />
          <div className="absolute inset-0 bg-radial from-emerald-500/15 via-transparent to-black/60" />
          <div className="absolute top-4 left-10 w-2 h-2 bg-emerald-300 rounded-full animate-pulse opacity-80 shadow-[0_0_10px_#10b981]" />
          <div className="absolute top-14 right-16 w-1.5 h-1.5 bg-lime-300 rounded-full animate-ping opacity-85 shadow-[0_0_8px_#84cc16]" />
          <div className="absolute bottom-16 left-12 w-2 h-2 bg-teal-200 rounded-full animate-bounce opacity-70" />
          <div className="absolute top-24 left-1/4 w-1.5 h-1.5 bg-emerald-200 rounded-full animate-pulse opacity-75" />
          {/* Soft ancient woodland canopy silhouettes */}
          <div className="absolute bottom-0 inset-x-0 h-10 bg-gradient-to-t from-[#021812] to-transparent opacity-80" />
        </div>
      );

    case 'neon_workshop':
      return (
        <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} aria-hidden="true">
          {/* Cyberpunk Terminal Workshop & Data Grid */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#020617] via-[#0f172a] to-[#020617]" />
          <div className="absolute inset-0 bg-radial from-cyan-500/15 via-transparent to-black/70" />
          {/* Digital Grid lines */}
          <div
            className="absolute inset-0 opacity-15"
            style={{
              backgroundImage: 'linear-gradient(#06b6d4 1px, transparent 1px), linear-gradient(90deg, #06b6d4 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="absolute top-2 left-4 font-mono text-[9px] text-cyan-500/50 tracking-wider">
            TERMINAL // DATA_BUS: 0x4F9E
          </div>
          <div className="absolute bottom-2 right-4 font-mono text-[9px] text-cyan-500/40 tracking-wider">
            CLOCK: 120BPM // SYS_OK
          </div>
          <div className="absolute top-8 right-8 w-2 h-2 bg-cyan-400 rotate-45 animate-ping opacity-90 shadow-[0_0_8px_#06b6d4]" />
          <div className="absolute bottom-14 left-8 w-2 h-2 bg-sky-300 animate-pulse opacity-80 shadow-[0_0_8px_#38bdf8]" />
        </div>
      );

    case 'void_chamber':
    default:
      return (
        <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} aria-hidden="true">
          {/* Default Astral Space & Purple Nebula */}
          <div className="absolute inset-0 bg-gradient-to-b from-[#090b10] via-[#10131f] to-[#0c0e16]" />
          <div className="absolute inset-0 bg-radial from-purple-900/15 via-transparent to-black/60" />
          <div className="absolute top-2 left-6 w-1 h-1 bg-purple-300 rounded-full animate-ping opacity-60" />
          <div className="absolute top-8 right-10 w-1.5 h-1.5 bg-indigo-300 rounded-full animate-pulse opacity-50" />
          <div className="absolute bottom-16 left-12 w-1 h-1 bg-cyan-300 rounded-full animate-pulse opacity-40" />
          <div className="absolute top-20 left-1/4 w-1 h-1 bg-pink-300 rounded-full animate-ping opacity-50" />
        </div>
      );
  }
};
