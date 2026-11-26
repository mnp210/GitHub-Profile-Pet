'use client';

import React from 'react';
import type { PetState, PersonalityType } from '@/types/pet';
import {
  ALL_PERSONALITIES,
  PERSONALITY_PROFILES,
  getPersonalityProfile,
} from '@/features/personality/personalities';
import { retroAudio } from '@/lib/audio/retroAudio';

interface PersonalityPanelProps {
  pet: PetState;
  onPersonalityChange?: (newPersonality: PersonalityType) => void;
  currentBehaviour?: string;
  thoughtBubble?: string;
  className?: string;
}

export const PersonalityPanel: React.FC<PersonalityPanelProps> = ({
  pet,
  onPersonalityChange,
  currentBehaviour,
  thoughtBubble,
  className = '',
}) => {
  const activePersonality = pet.personality || 'curious';
  const profile = getPersonalityProfile(activePersonality, pet.species);

  const handleSelectPersonality = (pId: PersonalityType) => {
    if (pId === activePersonality) return;
    retroAudio.playClick();
    onPersonalityChange?.(pId);
  };

  return (
    <div
      className={`bg-slate-900/90 border border-slate-700/80 rounded-xl p-4 shadow-xl backdrop-blur-sm ${className}`}
      aria-label="Companion Personality and Behaviour Panel"
    >
      {/* Header & Current Profile Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
              Companion Archetype
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-mono font-medium border ${profile.badgeBg}`}
            >
              {profile.name}
            </span>
          </div>
          <p className="text-xs text-slate-300 mt-1 italic font-mono">
            &ldquo;{profile.tagline}&rdquo;
          </p>
        </div>

        {/* Trait Pills */}
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            ★ {profile.primaryTrait}
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            ✦ {profile.secondaryTrait}
          </span>
        </div>
      </div>

      {/* Description & Living Thought */}
      <div className="mt-3 text-xs text-slate-300 leading-relaxed">
        {profile.description}
      </div>

      {/* Living Companion Telemetry: Behaviour & Thought */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
        <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
          <span className="text-slate-400">State:</span>
          <span className="text-emerald-300 font-semibold truncate capitalize">
            {currentBehaviour ? currentBehaviour.replace(/_/g, ' ') : 'Observing calmly'}
          </span>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-950/70 border border-slate-800 flex items-center gap-2">
          <span className="text-amber-400 shrink-0">💭</span>
          <span className="text-slate-400">Thought:</span>
          <span className="text-amber-200 truncate italic">
            {thoughtBubble || profile.thoughtPhrases[0]}
          </span>
        </div>
      </div>

      {/* Archetype Selector */}
      {onPersonalityChange && (
        <div className="mt-4 pt-3 border-t border-slate-800">
          <label className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase block mb-2">
            Switch Personality Archetype
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ALL_PERSONALITIES.map((pId) => {
              const pProfile = PERSONALITY_PROFILES[pId];
              const isSelected = pId === activePersonality;
              return (
                <button
                  key={pId}
                  type="button"
                  onClick={() => handleSelectPersonality(pId)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium text-left transition-all border ${
                    isSelected
                      ? `${pProfile.badgeBg} ring-1 ring-white/20 shadow-md scale-[1.02]`
                      : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/60 text-slate-300 hover:text-white'
                  }`}
                  aria-pressed={isSelected}
                  aria-label={`Select ${pProfile.name} archetype`}
                >
                  <div className="font-semibold truncate">{pProfile.name.split(' ')[0]}</div>
                  <div className="text-[10px] text-slate-400 truncate capitalize">{pId}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
