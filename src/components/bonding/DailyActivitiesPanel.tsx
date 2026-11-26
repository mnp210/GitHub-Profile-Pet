'use client';

import React from 'react';
import type { BondingState } from '@/features/bonding/types';
import { DAILY_ACTIVITIES_CATALOG } from '@/features/bonding/bondingCatalog';
import { getDailyActivitiesForDate } from '@/features/bonding/timePolicy';

interface DailyActivitiesPanelProps {
  bondingState: BondingState;
}

export const DailyActivitiesPanel: React.FC<DailyActivitiesPanelProps> = ({
  bondingState,
}) => {
  const today = bondingState.dailyActivities.dateKey;
  const activeIds = getDailyActivitiesForDate(today);

  const completedCount = activeIds.filter(
    (id) => bondingState.dailyActivities.activities[id]?.completed
  ).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-3 bg-purple-950/30 border border-purple-800/40 rounded-xl">
        <div>
          <h3 className="text-sm font-semibold text-purple-200">
            Daily Companion Focus
          </h3>
          <p className="text-xs text-purple-300/70">
            Reset UTC Day: <span className="font-mono text-purple-200">{today}</span> • No penalty for missed days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">Daily Completion:</span>
          <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-full bg-purple-900/60 border border-purple-500/40 text-purple-200">
            {completedCount} / {activeIds.length}
          </span>
        </div>
      </div>

      {/* Activities Grid */}
      <div className="grid grid-cols-1 gap-3">
        {activeIds.map((id) => {
          const def = DAILY_ACTIVITIES_CATALOG[id];
          const progress = bondingState.dailyActivities.activities[id] || {
            progress: 0,
            completed: false,
          };
          const pct = Math.min(100, Math.round((progress.progress / def.targetCount) * 100));

          return (
            <div
              key={id}
              className={`p-3.5 rounded-xl border transition-all duration-200 ${
                progress.completed
                  ? 'bg-purple-950/20 border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                  : 'bg-slate-900/60 border-slate-700/60 hover:border-purple-500/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`text-2xl p-2.5 rounded-xl border flex items-center justify-center shrink-0 ${
                    progress.completed
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700 text-slate-200'
                  }`}
                >
                  {def.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-white truncate">
                      {def.name}
                    </h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        progress.completed
                          ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {progress.completed ? '✓ Completed' : 'In Progress'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                    {def.description}
                  </p>

                  {/* Progress Meter */}
                  <div className="mt-3">
                    <div className="flex justify-between items-center text-[11px] mb-1">
                      <span className="text-slate-400">
                        Progress: {Math.min(progress.progress, def.targetCount)} / {def.targetCount}
                      </span>
                      <span className="font-mono text-purple-300 font-semibold">
                        +{def.bondPointsReward} Bond Pts
                      </span>
                    </div>
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          progress.completed ? 'bg-emerald-400' : 'bg-purple-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
