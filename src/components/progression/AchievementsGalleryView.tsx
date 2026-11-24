'use client';

import React, { useState } from 'react';
import type {
  ProgressionState,
  AchievementCategory,
} from '@/features/progression/types';
import {
  ACHIEVEMENTS_LIST,
  getAchievementsByCategory,
} from '@/features/progression/achievementsCatalog';
import { COSMETICS_CATALOG } from '@/features/progression/cosmeticsCatalog';
import { getAchievementStatuses } from '@/features/progression/engine';
import { retroAudio } from '@/lib/audio/retroAudio';

interface AchievementsGalleryViewProps {
  progression: ProgressionState;
  onOpenWardrobe?: () => void;
}

export const AchievementsGalleryView: React.FC<AchievementsGalleryViewProps> = ({
  progression,
  onOpenWardrobe,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<AchievementCategory | 'all'>('all');

  const statuses = getAchievementStatuses(progression);
  const statusMap = new Map(statuses.map((s) => [s.id, s]));

  const totalUnlocked = statuses.filter((s) => s.completed).length;
  const totalCount = statuses.length;
  const percentComplete = Math.round((totalUnlocked / totalCount) * 100);

  const displayedAchievements =
    selectedCategory === 'all'
      ? ACHIEVEMENTS_LIST
      : getAchievementsByCategory(selectedCategory);

  const categories: { id: AchievementCategory | 'all'; label: string }[] = [
    { id: 'all', label: 'All Badges' },
    { id: 'companion', label: 'Companion' },
    { id: 'minigame', label: 'Mini-Games' },
    { id: 'collection', label: 'Collection' },
    { id: 'consistency', label: 'Consistency' },
  ];

  return (
    <div className="flex flex-col w-full font-mono text-slate-100">
      {/* ── HEADER & PROGRESS SUMMARY ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-3 mb-4">
        <div>
          <h3 className="text-sm font-bold uppercase text-slate-100 flex items-center gap-2">
            <span className="text-amber-400">🏆</span>
            Companion Achievement Vault
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Earn distinct badges and unlock exclusive cosmetic rewards through gameplay milestones.
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex flex-col items-end">
            <span className="text-xs font-bold text-amber-400">
              {totalUnlocked} / {totalCount} UNLOCKED ({percentComplete}%)
            </span>
            <div className="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden mt-1">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 transition-all duration-500"
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>

          {onOpenWardrobe && (
            <button
              onClick={() => {
                retroAudio.playClick();
                onOpenWardrobe();
              }}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-purple-900/60 hover:bg-purple-800 border border-purple-500 text-purple-200 transition-all shrink-0"
            >
              🎨 Wardrobe
            </button>
          )}
        </div>
      </div>

      {/* ── CATEGORY FILTER TABS ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {categories.map((c) => {
          const isSelected = selectedCategory === c.id;
          return (
            <button
              key={c.id}
              onClick={() => {
                retroAudio.playClick();
                setSelectedCategory(c.id);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                isSelected
                  ? 'bg-amber-950/60 text-amber-300 border border-amber-500/80 shadow-sm'
                  : 'bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* ── ACHIEVEMENTS GRID ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-[500px] overflow-y-auto pr-1">
        {displayedAchievements.map((def) => {
          const status = statusMap.get(def.id);
          const isUnlocked = status?.completed ?? false;
          const progressCurrent = status?.progress ?? 0;
          const progressMax = status?.maxProgress ?? 1;
          const rewardMeta = def.rewardCosmeticId ? COSMETICS_CATALOG[def.rewardCosmeticId] : null;

          return (
            <div
              key={def.id}
              className={`p-3.5 rounded-xl border-2 transition-all flex flex-col justify-between ${
                isUnlocked
                  ? 'bg-[#10192e] border-indigo-500/80 shadow-[0_0_12px_rgba(99,102,241,0.25)]'
                  : 'bg-[#0a0e18] border-slate-800/80 opacity-70 hover:opacity-90'
              }`}
            >
              <div>
                {/* Header: Icon, Title & Badge */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl p-1.5 rounded-lg bg-[#141b2d] border border-slate-700">
                      {def.icon}
                    </span>
                    <div>
                      <h4 className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
                        {def.name}
                      </h4>
                      <span className="text-[9px] uppercase text-slate-400 font-bold tracking-wider">
                        {def.category}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border ${
                      isUnlocked
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-600 shadow-sm'
                        : 'bg-slate-900 text-slate-500 border-slate-800'
                    }`}
                  >
                    {isUnlocked ? 'UNLOCKED' : 'LOCKED'}
                  </span>
                </div>

                {/* Description */}
                <p className="text-[11px] text-slate-300 leading-relaxed mb-2.5">
                  {def.description}
                </p>

                {/* Progress bar if multi-step */}
                {progressMax > 1 && (
                  <div className="mb-2">
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>Progress</span>
                      <span className="font-bold text-slate-300">
                        {progressCurrent} / {progressMax}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isUnlocked ? 'bg-emerald-400' : 'bg-indigo-500'
                        }`}
                        style={{ width: `${Math.min(100, (progressCurrent / progressMax) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Reward Footer */}
              {rewardMeta && (
                <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
                  <span className="text-slate-400">Reward:</span>
                  <span className="font-bold text-amber-300 flex items-center gap-1">
                    <span>{rewardMeta.icon}</span>
                    <span>{rewardMeta.name}</span>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
