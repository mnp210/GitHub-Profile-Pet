'use client';

import React from 'react';
import type { BondingState } from '@/features/bonding/types';
import { ROTATING_CHALLENGES_CATALOG, ROTATING_CHALLENGES_LIST } from '@/features/bonding/bondingCatalog';

interface RotatingChallengesPanelProps {
  bondingState: BondingState;
}

export const RotatingChallengesPanel: React.FC<RotatingChallengesPanelProps> = ({
  bondingState,
}) => {
  const activeProg = bondingState.activeChallenge;
  const challengeDef = ROTATING_CHALLENGES_CATALOG[activeProg.challengeId];
  const pct = Math.min(100, Math.round((activeProg.progress / challengeDef.targetCount) * 100));

  return (
    <div className="flex flex-col gap-4">
      {/* Banner */}
      <div className="p-3.5 bg-gradient-to-r from-indigo-950/40 to-purple-950/40 border border-indigo-700/40 rounded-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-indigo-200">
            Active Rotating Challenge
          </h3>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-indigo-900/60 border border-indigo-500/40 text-indigo-300">
            Cycle: {activeProg.rotationKey}
          </span>
        </div>
        <p className="text-xs text-indigo-300/80 mt-1">
          Challenges rotate on a predictable schedule and reward collaborative play between you and your pet.
        </p>
      </div>

      {/* Main Active Challenge Card */}
      <div
        className={`p-4 rounded-xl border transition-all ${
          activeProg.completed
            ? 'bg-indigo-950/20 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
            : 'bg-slate-900/70 border-indigo-500/30 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
        }`}
      >
        <div className="flex items-start gap-3.5">
          <div
            className={`text-3xl p-3 rounded-xl border flex items-center justify-center shrink-0 ${
              activeProg.completed
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300'
                : 'bg-indigo-950/50 border-indigo-500/40 text-indigo-200'
            }`}
          >
            {challengeDef.icon}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-base font-bold text-white truncate">
                {challengeDef.name}
              </h4>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                  activeProg.completed
                    ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/40'
                    : 'bg-indigo-900/60 text-indigo-300 border border-indigo-500/40'
                }`}
              >
                {activeProg.completed ? '✓ Completed' : 'Active Challenge'}
              </span>
            </div>

            <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
              {challengeDef.description}
            </p>

            {/* Progress Bar */}
            <div className="mt-4">
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className="text-slate-400 font-medium">
                  Objective Progress: {Math.min(activeProg.progress, challengeDef.targetCount)} / {challengeDef.targetCount}
                </span>
                <span className="font-mono text-indigo-300 font-bold">
                  +{challengeDef.bondPointsReward} Bond Pts
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    activeProg.completed ? 'bg-emerald-400' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Curated Challenge Catalog Preview */}
      <div className="mt-2">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
          Rotating Challenge Catalog Pool ({ROTATING_CHALLENGES_LIST.length} Challenges)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {ROTATING_CHALLENGES_LIST.map((c) => (
            <div
              key={c.id}
              className={`p-2.5 rounded-lg border flex items-center gap-2.5 ${
                c.id === activeProg.challengeId
                  ? 'bg-indigo-950/30 border-indigo-500/50 text-indigo-200'
                  : 'bg-slate-900/40 border-slate-800 text-slate-400'
              }`}
            >
              <span className="text-lg">{c.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white truncate flex items-center gap-1.5">
                  {c.name}
                  {c.id === activeProg.challengeId && (
                    <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded border border-indigo-500/30">
                      CURRENT
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{c.description}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
