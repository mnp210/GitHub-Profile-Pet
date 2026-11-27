'use client';

import React, { useState, useEffect } from 'react';
import type { PetState } from '@/types/pet';
import type { MiniGameId, GameSession } from '@/features/minigames/types';
import {
  MINI_GAMES_CATALOG,
  loadHighScores,
  createGameSession,
  startGameSession,
  finishGameSession,
} from '@/features/minigames/engine';
import { StarCatcherGame } from './StarCatcherGame';
import { MemorySparksGame } from './MemorySparksGame';
import { CompanionRhythmGame } from './CompanionRhythmGame';
import { MiniGameResults } from './MiniGameResults';
import { retroAudio } from '@/lib/audio/retroAudio';
import { getPersonalityProfile } from '@/features/personality/personalities';

interface MiniGameHubProps {
  pet: PetState;
  isOpen: boolean;
  onClose: () => void;
  defaultGameId?: MiniGameId;
  onGameCompleted?: (gameId: MiniGameId, score: number, round?: number) => void;
}

export const MiniGameHub: React.FC<MiniGameHubProps> = ({
  pet,
  isOpen,
  onClose,
  defaultGameId,
  onGameCompleted,
}) => {
  const [selectedGameId, setSelectedGameId] = useState<MiniGameId | null>(defaultGameId || null);
  const [activeSession, setActiveSession] = useState<GameSession | null>(null);
  const [highScores, setHighScores] = useState<Record<MiniGameId, number>>(() => loadHighScores());
  const [showInstructions, setShowInstructions] = useState<boolean>(true);

  const profile = getPersonalityProfile(pet.personality, pet.species);

  // Refresh high scores when opening hub
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isOpen) {
      timer = setTimeout(() => {
        setHighScores(loadHighScores());
        if (defaultGameId) {
          setSelectedGameId(defaultGameId);
          setShowInstructions(true);
        }
      }, 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, defaultGameId]);

  if (!isOpen) return null;

  const handleSelectGame = (gameId: MiniGameId) => {
    retroAudio.playClick();
    setSelectedGameId(gameId);
    setShowInstructions(true);
    setActiveSession(null);
  };

  const handleStartGame = () => {
    if (!selectedGameId) return;
    retroAudio.playPlay();
    const session = createGameSession(selectedGameId, highScores[selectedGameId]);
    const started = startGameSession(session);
    setActiveSession(started);
    setShowInstructions(false);
  };

  const handleFinishGame = (finalScore: number, stats: { maxStreak: number; accuracy: number }) => {
    if (!activeSession) return;
    const finished = finishGameSession(activeSession, {
      finalScore,
      maxStreak: stats.maxStreak,
      accuracy: stats.accuracy,
    });
    setActiveSession(finished);
    setHighScores(loadHighScores());
    onGameCompleted?.(activeSession.gameId, finalScore, stats.maxStreak);
  };

  const handlePlayAgain = () => {
    if (!selectedGameId) return;
    handleStartGame();
  };

  const handleChooseActivity = () => {
    retroAudio.playClick();
    setSelectedGameId(null);
    setActiveSession(null);
    setShowInstructions(true);
  };

  const handleClose = () => {
    retroAudio.playClick();
    setSelectedGameId(null);
    setActiveSession(null);
    onClose();
  };

  const activeMeta = selectedGameId ? MINI_GAMES_CATALOG[selectedGameId] : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Companion Mini-Games Play Area"
    >
      <div className="relative w-full max-w-2xl bg-[#0b0e17] border-2 border-[#2b274c] rounded-2xl p-4 sm:p-6 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        {/* Hub Header */}
        <div className="flex items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="text-xl shrink-0">🎮</span>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-extrabold text-white leading-snug">
                Companion Play Zone
              </h2>
              <p className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5">
                <span>Bonding activities with <span className="text-purple-300 font-bold">{pet.name}</span></span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] border ${profile.badgeBg}`}>
                  {profile.name}
                </span>
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="shrink-0 p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 cursor-pointer"
            aria-label="Close Play Zone"
          >
            ✕
          </button>
        </div>

        {/* 1. SELECTION SCREEN (when no game is selected) */}
        {!selectedGameId && (
          <div className="space-y-4">
            <div className="text-xs text-slate-300">
              Select an activity below to play with your companion! Mini-games are designed for reflex, memory, and rhythm training with zero risk to progression.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(Object.keys(MINI_GAMES_CATALOG) as MiniGameId[]).map((gId) => {
                const meta = MINI_GAMES_CATALOG[gId];
                const best = highScores[gId] || 0;
                return (
                  <button
                    key={gId}
                    onClick={() => handleSelectGame(gId)}
                    className="p-4 rounded-xl bg-slate-900/90 hover:bg-slate-850 border border-slate-700/80 hover:border-indigo-500/80 text-left transition-all hover:scale-[1.02] active:scale-98 flex flex-col justify-between space-y-3 group shadow-lg"
                    aria-label={`Select ${meta.title}`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-3xl p-1.5 rounded-lg bg-slate-950 border border-slate-800">
                          {meta.icon}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {meta.difficulty}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white mt-2 group-hover:text-indigo-300 transition-colors">
                        {meta.title}
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">
                        {meta.tagline}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[11px] font-mono">
                      <span className="text-slate-500">Best:</span>
                      <span className="text-amber-300 font-bold">{best} pts</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="text-[11px] text-slate-500 text-center font-mono py-1">
              🛡️ Anti-Exploit Guard: Mini-games award 0 XP and preserve all daily contribution caps.
            </div>
          </div>
        )}

        {/* 2. GAME CONTAINER (when a game is selected) */}
        {selectedGameId && activeMeta && (
          <div className="space-y-4">
            {/* INSTRUCTIONS SCREEN BEFORE LAUNCH */}
            {showInstructions && !activeSession && (
              <div className="space-y-4 p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{activeMeta.icon}</span>
                    <div>
                      <h3 className="text-base font-bold text-white">{activeMeta.title}</h3>
                      <p className="text-xs text-slate-400">{activeMeta.description}</p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-amber-300">
                    High Score: {highScores[selectedGameId]}
                  </span>
                </div>

                <div className="space-y-1.5 text-xs">
                  <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                    How to Play:
                  </h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300 text-[11px]">
                    {activeMeta.instructions.map((ins, i) => (
                      <li key={i}>{ins}</li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-1.5 text-xs">
                  <h4 className="font-bold text-slate-300 uppercase tracking-wider text-[10px]">
                    Controls:
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    {activeMeta.controls.map((ctrl, i) => (
                      <div key={i} className="p-1.5 rounded bg-slate-950 border border-slate-800 flex items-center justify-between">
                        <span className="text-indigo-300">{ctrl.key}:</span>
                        <span className="text-slate-400">{ctrl.action}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    onClick={handleStartGame}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg active:scale-95 transition-transform"
                  >
                    ▶ Start Activity
                  </button>
                  <button
                    onClick={handleChooseActivity}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs border border-slate-700"
                  >
                    Back
                  </button>
                </div>
              </div>
            )}

            {/* ACTIVE GAMEPLAY */}
            {activeSession && activeSession.status !== 'completed' && (
              <>
                {selectedGameId === 'star_catcher' && (
                  <StarCatcherGame
                    pet={pet}
                    onFinishGame={handleFinishGame}
                    onExit={handleChooseActivity}
                  />
                )}
                {selectedGameId === 'memory_sparks' && (
                  <MemorySparksGame
                    pet={pet}
                    onFinishGame={handleFinishGame}
                    onExit={handleChooseActivity}
                  />
                )}
                {selectedGameId === 'companion_rhythm' && (
                  <CompanionRhythmGame
                    pet={pet}
                    onFinishGame={handleFinishGame}
                    onExit={handleChooseActivity}
                  />
                )}
              </>
            )}

            {/* RESULTS SCREEN */}
            {activeSession && activeSession.status === 'completed' && (
              <MiniGameResults
                session={activeSession}
                pet={pet}
                onPlayAgain={handlePlayAgain}
                onChooseActivity={handleChooseActivity}
                onClose={handleClose}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
