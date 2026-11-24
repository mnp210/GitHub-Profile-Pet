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
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-[#0c0e18] border-2 border-indigo-500/60 rounded-2xl flex flex-col overflow-hidden shadow-2xl shadow-indigo-950/60">
        {/* ── MODAL HEADER ───────────────────────────────────────────────────── */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#121524]">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✨</span>
            <div>
              <h2 id="progression-hub-title" className="text-sm font-bold text-slate-100 uppercase tracking-wider">
                Companion Progression & Collection Vault
              </h2>
              <p className="text-[11px] text-slate-400">
                Customize your pet with unlocked cosmetics & celebrate gameplay achievements
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Top Tabs */}
            <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800">
              <button
                onClick={() => {
                  retroAudio.playClick();
                  setActiveTab('wardrobe');
                }}
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
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
                className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'achievements'
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>🏆</span>
                <span>Achievements</span>
              </button>
            </div>

            {/* Close Button */}
            <button
              onClick={() => {
                retroAudio.playClick();
                onClose();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all ml-2"
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
