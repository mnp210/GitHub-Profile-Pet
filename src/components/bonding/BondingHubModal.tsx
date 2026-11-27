'use client';

import React, { useState, useEffect } from 'react';
import type { BondingState } from '@/features/bonding/types';
import type { PetState } from '@/types/pet';
import { BondingOverviewPanel } from './BondingOverviewPanel';
import { DailyActivitiesPanel } from './DailyActivitiesPanel';
import { RotatingChallengesPanel } from './RotatingChallengesPanel';
import { retroAudio } from '@/lib/audio/retroAudio';

interface BondingHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'overview' | 'daily' | 'challenges';
  pet: PetState;
  bondingState: BondingState;
}

export const BondingHubModal: React.FC<BondingHubModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'overview',
  pet,
  bondingState,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'daily' | 'challenges'>(defaultTab);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      timer = setTimeout(() => {
        setActiveTab(defaultTab);
      }, 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, defaultTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleTabSwitch = (tab: 'overview' | 'daily' | 'challenges') => {
    setActiveTab(tab);
    try {
      retroAudio.playClick();
    } catch {
      // Audio optional
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bonding-hub-title"
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] bg-slate-900 border border-purple-500/50 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start sm:items-center justify-between gap-3 px-4 sm:px-5 py-3.5 sm:py-4 border-b border-purple-800/40 bg-slate-950/70 min-w-0">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="w-9 h-9 shrink-0 rounded-xl bg-purple-900/60 border border-purple-400/40 flex items-center justify-center text-lg">
              🤝
            </div>
            <div className="min-w-0">
              <h2 id="bonding-hub-title" className="text-sm sm:text-base font-bold text-white tracking-wide leading-snug break-words">
                Companion Bonding & Daily Focus
              </h2>
              <p className="text-[11px] sm:text-xs text-purple-300/80 leading-snug break-words">
                Bond Level {bondingState.bondLevel} • {bondingState.bondPoints} Pts • {pet.name} ({pet.personality})
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="shrink-0 p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800/80 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
            aria-label="Close bonding hub"
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 px-4 sm:px-5 py-2.5 bg-slate-950/40 border-b border-slate-800">
          <button
            onClick={() => handleTabSwitch('overview')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'overview'
                ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            Bonding Overview
          </button>
          <button
            onClick={() => handleTabSwitch('daily')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'daily'
                ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <span>Daily Activities</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-purple-950 border border-purple-400/30 text-purple-200">
              3
            </span>
          </button>
          <button
            onClick={() => handleTabSwitch('challenges')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === 'challenges'
                ? 'bg-purple-600 text-white shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <span>Rotating Challenge</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-950 border border-indigo-400/30 text-indigo-200">
              Active
            </span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {activeTab === 'overview' && (
            <BondingOverviewPanel bondingState={bondingState} pet={pet} />
          )}
          {activeTab === 'daily' && (
            <DailyActivitiesPanel bondingState={bondingState} />
          )}
          {activeTab === 'challenges' && (
            <RotatingChallengesPanel bondingState={bondingState} />
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/70 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>🛡️</span>
            <span>Aesthetic & companion progression. Awards strictly 0 XP.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
