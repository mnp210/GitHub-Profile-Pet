'use client';

import React from 'react';
import type { BondingState } from '@/features/bonding/types';
import type { PetState } from '@/types/pet';
import { BOND_MILESTONES_LIST, MAX_BOND_POINTS, getBondingPersonalityDialogue } from '@/features/bonding/bondingCatalog';

interface BondingOverviewPanelProps {
  bondingState: BondingState;
  pet: PetState;
}

export const BondingOverviewPanel: React.FC<BondingOverviewPanelProps> = ({
  bondingState,
  pet,
}) => {
  const currentMilestone = BOND_MILESTONES_LIST.find((m) => m.level === bondingState.bondLevel) || BOND_MILESTONES_LIST[0];
  const nextMilestone = BOND_MILESTONES_LIST.find((m) => m.level === bondingState.bondLevel + 1);

  const prevPoints = currentMilestone.requiredPoints;
  const targetPoints = nextMilestone ? nextMilestone.requiredPoints : MAX_BOND_POINTS;
  const progressToNext = nextMilestone
    ? Math.min(100, Math.max(0, Math.round(((bondingState.bondPoints - prevPoints) / (targetPoints - prevPoints)) * 100)))
    : 100;

  const quote = getBondingPersonalityDialogue(pet.personality || 'curious', 'milestone', currentMilestone.name);

  return (
    <div className="flex flex-col gap-5">
      {/* Primary Bond Card */}
      <div className="relative overflow-hidden p-5 bg-gradient-to-br from-purple-900/40 via-slate-900/90 to-indigo-950/40 border border-purple-500/40 rounded-2xl shadow-[0_0_20px_rgba(168,85,247,0.15)]">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-14 h-14 rounded-2xl bg-purple-900/60 border border-purple-400/50 flex items-center justify-center text-3xl shadow-[0_0_15px_rgba(168,85,247,0.3)]">
              {bondingState.bondLevel === 5 ? '🌟' : bondingState.bondLevel >= 3 ? '💖' : '🤝'}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-purple-300">
                  Bond Level {bondingState.bondLevel} of 5
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950 border border-purple-500/30 text-purple-200">
                  {bondingState.bondPoints} / {MAX_BOND_POINTS} Pts
                </span>
              </div>
              <h3 className="text-lg font-bold text-white mt-0.5">
                {currentMilestone.name}
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                {currentMilestone.description}
              </p>
            </div>
          </div>

          {/* Stats Badges */}
          <div className="flex items-center gap-2 self-stretch sm:self-auto justify-end">
            <div className="px-3 py-2 bg-slate-900/80 border border-slate-700/60 rounded-xl text-center">
              <div className="text-[10px] text-slate-400 uppercase font-medium">Days Bonded</div>
              <div className="text-sm font-bold font-mono text-purple-200">
                {bondingState.stats.daysInteractedCount}
              </div>
            </div>
            <div className="px-3 py-2 bg-slate-900/80 border border-slate-700/60 rounded-xl text-center">
              <div className="text-[10px] text-slate-400 uppercase font-medium">Activities Done</div>
              <div className="text-sm font-bold font-mono text-emerald-300">
                {bondingState.stats.totalDailyActivitiesCompleted}
              </div>
            </div>
          </div>
        </div>

        {/* Bond Progress Bar */}
        <div className="mt-5">
          <div className="flex justify-between items-center text-xs mb-1.5">
            <span className="text-slate-300 font-medium">
              {nextMilestone
                ? `Next Milestone: ${nextMilestone.name} (${nextMilestone.requiredPoints} Pts)`
                : 'Maximum Bond Level Achieved!'}
            </span>
            <span className="font-mono text-purple-300 font-bold">
              {progressToNext}%
            </span>
          </div>
          <div className="w-full bg-slate-800/80 rounded-full h-2.5 overflow-hidden border border-purple-900/50">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-all duration-500"
              style={{ width: `${progressToNext}%` }}
            />
          </div>
        </div>

        {/* Personality Quote */}
        <div className="mt-4 p-3 bg-purple-950/40 border border-purple-700/30 rounded-xl flex items-center gap-2.5">
          <span className="text-lg">💬</span>
          <p className="text-xs italic text-purple-200/90 leading-relaxed">
            &quot;{quote}&quot;
          </p>
        </div>
      </div>

      {/* Milestone Roadmap */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Companionship Milestone Roadmap
        </h4>
        <div className="space-y-2.5">
          {BOND_MILESTONES_LIST.map((m) => {
            const isUnlocked = Boolean(bondingState.unlockedMilestones[m.id]);
            const isCurrent = m.level === bondingState.bondLevel;

            return (
              <div
                key={m.id}
                className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                  isCurrent
                    ? 'bg-purple-950/30 border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                    : isUnlocked
                    ? 'bg-slate-900/50 border-emerald-500/30 text-slate-200'
                    : 'bg-slate-900/30 border-slate-800 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-9 h-9 rounded-lg border flex items-center justify-center text-sm font-bold font-mono shrink-0 ${
                      isUnlocked
                        ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800/50 border-slate-700 text-slate-500'
                    }`}
                  >
                    {isUnlocked ? '✓' : `L${m.level}`}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold truncate ${isUnlocked ? 'text-white' : 'text-slate-400'}`}>
                        {m.name}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] font-semibold bg-purple-500/20 text-purple-300 px-1.5 py-0.2 rounded border border-purple-500/40">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate mt-0.5">{m.description}</div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-xs font-mono font-semibold text-purple-300">
                    {m.requiredPoints} Pts
                  </div>
                  {m.rewardCosmeticId && (
                    <div className="text-[10px] text-amber-300/80 font-medium">
                      🎁 Cosmetic Reward
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
