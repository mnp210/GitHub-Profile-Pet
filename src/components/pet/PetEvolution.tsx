import React from 'react';
import { EvolutionMilestone } from '@/types/pet';
import { CheckIcon } from '@/components/ui/PixelIcons';

interface PetEvolutionProps {
  currentLevel: number;
  milestones: EvolutionMilestone[];
}

export const PetEvolution: React.FC<PetEvolutionProps> = ({
  currentLevel,
  milestones,
}) => {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {milestones.map((milestone) => {
          const isUnlocked = currentLevel >= milestone.requiredLevel;

          return (
            <div
              key={milestone.stage}
              className={`p-3.5 rounded-lg border transition-colors ${
                isUnlocked
                  ? 'bg-[#181c24] border-[#2d3342]'
                  : 'bg-[#12151b] border-[#222733] opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-flex items-center justify-center h-6 w-6 rounded text-xs font-semibold ${
                      isUnlocked
                        ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                        : 'bg-[#222733] text-slate-500'
                    }`}
                  >
                    {milestone.stage}
                  </span>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-200">
                      {milestone.title}
                    </h4>
                    <span className="text-[11px] text-slate-500">
                      Requires Level {milestone.requiredLevel}
                    </span>
                  </div>
                </div>

                <span
                  className={`px-1.5 py-0.2 text-[9px] font-medium rounded border ${
                    isUnlocked
                      ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60'
                      : 'bg-[#181c24] text-slate-500 border-[#222733]'
                  }`}
                >
                  {isUnlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>

              <p className="text-xs text-slate-400 mb-2 leading-relaxed">
                {milestone.description}
              </p>

              <div className="space-y-1 border-t border-[#222733] pt-2">
                {milestone.perks.map((perk, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <span className={isUnlocked ? 'text-emerald-400' : 'text-slate-600'}>
                      {isUnlocked ? <CheckIcon size={10} /> : '▪'}
                    </span>
                    <span>{perk}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
