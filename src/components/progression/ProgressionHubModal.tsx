'use client';

import React, { useState, useEffect } from 'react';
import type { ProgressionState } from '@/features/progression/types';
import type { PetState, PetSpeciesMeta } from '@/types/pet';
import { WardrobeView } from '@/components/cosmetics/WardrobeView';
import { AchievementsGalleryView } from '@/components/progression/AchievementsGalleryView';
import { retroAudio } from '@/lib/audio/retroAudio';

interface ProgressionHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'wardrobe' | 'achievements';
  pet: PetState;
  speciesMeta: PetSpeciesMeta;
  progression: ProgressionState;
  onUpdateProgression: (next: ProgressionState) => void;
}

export const ProgressionHubModal: React.FC<ProgressionHubModalProps> = ({
  isOpen,
  onClose,
  defaultTab = 'wardrobe',
  pet,
  speciesMeta,
  progression,
  onUpdateProgression,
}) => {
  const [activeTab, setActiveTab] = useState<'wardrobe' | 'achievements'>(defaultTab);

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

  // Handle Escape key to close
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="progression-hub-title"
    >
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-[#0c0e18] border border-purple-500/40 rounded-2xl flex flex-col overflow-hidden shadow-2xl shadow-purple-950/50">
        {/* ── MODAL HEADER ───────────────────────────────────────────────────── */}
        <div className="p-3.5 sm:p-4 border-b border-slate-800/90 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-[#121524] min-w-0">
          <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
            <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 min-w-0">
              <span className="text-xl sm:text-2xl shrink-0">✨</span>
              <div className="min-w-0">
                <h2 id="progression-hub-title" className="text-xs sm:text-sm font-bold text-slate-100 uppercase tracking-wider leading-snug break-words">
                  Companion Progression & Collection Vault
                </h2>
                <p className="text-[11px] text-slate-400 leading-snug">
                  Customize your pet with unlocked cosmetics & celebrate gameplay achievements
                </p>
              </div>
            </div>

            {/* Close Button (always visible top-right on mobile) */}
            <button
              onClick={() => {
                retroAudio.playClick();
                onClose();
              }}
              className="sm:hidden shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close progression vault"
            >
              ✕
            </button>
          </div>

          <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto shrink-0">
            {/* Top Tabs */}
            <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800 w-full sm:w-auto min-w-0">
              <button
                onClick={() => {
                  retroAudio.playClick();
                  setActiveTab('wardrobe');
                }}
                className={`flex-1 sm:flex-initial justify-center px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeTab === 'wardrobe'
                    ? 'bg-purple-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🎨</span>
                <span>Wardrobe</span>
              </button>

              <button
                onClick={() => {
                  retroAudio.playClick();
                  setActiveTab('achievements');
                }}
                className={`flex-1 sm:flex-initial justify-center px-2.5 sm:px-3 py-1.5 sm:py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                  activeTab === 'achievements'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🏆</span>
                <span>Achievements</span>
              </button>
            </div>

            {/* Close Button (desktop inline) */}
            <button
              onClick={() => {
                retroAudio.playClick();
                onClose();
              }}
              className="hidden sm:inline-flex shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors ml-1 cursor-pointer"
              aria-label="Close progression vault"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── MODAL BODY ─────────────────────────────────────────────────────── */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          {activeTab === 'wardrobe' ? (
            <WardrobeView
              pet={pet}
              speciesMeta={speciesMeta}
              progression={progression}
              onUpdateProgression={onUpdateProgression}
            />
          ) : (
            <AchievementsGalleryView
              progression={progression}
              onOpenWardrobe={() => setActiveTab('wardrobe')}
            />
          )}
        </div>

        {/* ── MODAL FOOTER ───────────────────────────────────────────────────── */}
        <div className="p-3 border-t border-slate-800/80 bg-[#0a0d16] flex items-center justify-between text-[11px] text-slate-500 font-mono">
          <div className="flex items-center gap-2">
            <span>🛡️ Anti-Exploit Guarantee:</span>
            <span className="text-slate-400">Cosmetics are strictly aesthetic. Zero XP or currency inflation.</span>
          </div>
          <button
            onClick={() => {
              retroAudio.playClick();
              onClose();
            }}
            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
