'use client';

import React from 'react';
import type { PetState } from '@/types/pet';
import type { GameSession } from '@/features/minigames/types';
import { MINI_GAMES_CATALOG } from '@/features/minigames/engine';
import { getMiniGameReaction } from '@/features/minigames/personalityReactions';
import { PetSprite } from '@/components/pet/PetSprite';
import { getPersonalityProfile } from '@/features/personality/personalities';

interface MiniGameResultsProps {
  session: GameSession;
  pet: PetState;
  onPlayAgain: () => void;
  onChooseActivity: () => void;
  onClose: () => void;
}

export const MiniGameResults: React.FC<MiniGameResultsProps> = ({
  session,
  pet,
  onPlayAgain,
  onChooseActivity,
  onClose,
}) => {
  const meta = MINI_GAMES_CATALOG[session.gameId];
  const personality = pet.personality || 'curious';
  const profile = getPersonalityProfile(personality, pet.species);

  const reaction = getMiniGameReaction('game_complete', {
    gameId: session.gameId,
    personality,
    score: session.score,
    isNewBest: session.isNewBest,
  });

  return (
    <div className="flex flex-col items-center w-full max-w-lg mx-auto p-6 bg-slate-900/95 border border-slate-800 rounded-2xl shadow-2xl backdrop-blur-md space-y-5 select-none">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl">{meta.icon}</span>
          <h2 className="text-xl font-extrabold text-white">{meta.title} Finished!</h2>
        </div>
        <p className="text-xs text-slate-400">Activity complete with {pet.name}</p>
      </div>

      {/* Companion Celebration Arena */}
      <div className="flex flex-col items-center space-y-2 py-2">
        <PetSprite
          species={pet.species}
          personality={pet.personality}
          size={110}
          animationState={session.isNewBest || session.score >= 80 ? 'celebrating' : 'happy'}
        />

        {/* Companion Speech Bubble */}
        <div className="max-w-sm bg-slate-950/90 border border-slate-700/80 rounded-xl p-3 text-center shadow-lg">
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-400 font-mono mb-1">
            <span className={`px-1.5 py-0.5 rounded border text-[10px] ${profile.badgeBg}`}>
              {profile.name}
            </span>
          </div>
          <p className="text-xs text-slate-200 italic font-mono leading-relaxed">
            &ldquo;{reaction.reactionText}&rdquo;
          </p>
        </div>
      </div>

      {/* Score & Stats Grid */}
      <div className="w-full grid grid-cols-3 gap-2.5">
        {/* Score */}
        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-center space-y-0.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
            Final Score
          </span>
          <div className="text-xl font-extrabold text-amber-300 font-mono flex items-center justify-center gap-1">
            {session.score}
          </div>
          {session.isNewBest && (
            <span className="inline-block px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
              ★ NEW BEST!
            </span>
          )}
        </div>

        {/* Max Streak */}
        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-center space-y-0.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
            Max Streak
          </span>
          <div className="text-xl font-extrabold text-purple-300 font-mono">
            {session.maxStreak}x
          </div>
          <span className="text-[9px] text-slate-500 font-mono">combo</span>
        </div>

        {/* Accuracy */}
        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl text-center space-y-0.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-mono">
            Accuracy
          </span>
          <div className="text-xl font-extrabold text-cyan-300 font-mono">
            {session.accuracy}%
          </div>
          <span className="text-[9px] text-slate-500 font-mono">precision</span>
        </div>
      </div>

      {/* Zero-XP Policy Note */}
      <div className="text-[11px] text-slate-400 text-center font-mono bg-slate-950/40 py-1.5 px-3 rounded-lg border border-slate-800/80">
        🛡️ <span className="text-slate-300">Play Mode:</span> Zero XP awarded. Pure fun, bonding, and reflex practice!
      </div>

      {/* Action Buttons */}
      <div className="w-full space-y-2 pt-2">
        <button
          onClick={onPlayAgain}
          className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider shadow-md active:scale-95 transition-transform"
        >
          🔄 Play Again
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onChooseActivity}
            className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700"
          >
            📋 Other Activities
          </button>
          <button
            onClick={onClose}
            className="py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-xs border border-slate-700"
          >
            ✕ Back to Pet Arena
          </button>
        </div>
      </div>
    </div>
  );
};
