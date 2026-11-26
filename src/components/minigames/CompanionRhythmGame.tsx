'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PetState } from '@/types/pet';
import {
  createInitialCompanionRhythmState,
  strikeRhythmBeat,
  tickRhythmTrack,
  CompanionRhythmState,
  RHYTHM_OK_WINDOW_MS,
} from '@/features/minigames/companionRhythm';
import { getMiniGameReaction } from '@/features/minigames/personalityReactions';
import { PetSprite } from '@/components/pet/PetSprite';
import { retroAudio } from '@/lib/audio/retroAudio';
import type { BehaviourState } from '@/features/personality/types';
import { mapBehaviourToSpriteState } from '@/features/personality/behaviourEngine';

interface CompanionRhythmGameProps {
  pet: PetState;
  onFinishGame: (finalScore: number, stats: { maxStreak: number; accuracy: number }) => void;
  onExit: () => void;
}

export const CompanionRhythmGame: React.FC<CompanionRhythmGameProps> = ({
  pet,
  onFinishGame,
  onExit,
}) => {
  const [gameState, setGameState] = useState<CompanionRhythmState>(() => createInitialCompanionRhythmState());
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [companionReaction, setCompanionReaction] = useState<string>(() => {
    return getMiniGameReaction('start', { gameId: 'companion_rhythm', personality: pet.personality || 'curious' }).reactionText;
  });
  const [companionBehaviour, setCompanionBehaviour] = useState<BehaviourState>('idle_curious');
  const [feedbackRating, setFeedbackRating] = useState<{ text: string; color: string } | null>(null);

  const startTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const personality = pet.personality || 'curious';

  const handleStrike = useCallback(() => {
    if (isPaused || gameState.isComplete) return;

    setGameState((prev) => {
      const { nextState, rating } = strikeRhythmBeat(prev, elapsedMs);

      if (rating) {
        if (rating === 'perfect') {
          retroAudio.playLevelUp();
          setFeedbackRating({ text: 'PERFECT! +50', color: 'text-emerald-300' });
        } else if (rating === 'good') {
          retroAudio.playPlay();
          setFeedbackRating({ text: 'GOOD! +25', color: 'text-amber-300' });
        } else if (rating === 'early' || rating === 'late') {
          retroAudio.playClick();
          setFeedbackRating({ text: `${rating.toUpperCase()} +10`, color: 'text-cyan-300' });
        } else {
          retroAudio.playError();
          setFeedbackRating({ text: 'MISS!', color: 'text-rose-400' });
        }

        const reaction = getMiniGameReaction(
          rating === 'miss' ? 'rhythm_miss' : 'rhythm_hit',
          {
            gameId: 'companion_rhythm',
            personality,
            streak: nextState.streak,
            rating,
          }
        );
        setCompanionReaction(reaction.reactionText);
        setCompanionBehaviour(reaction.behaviourState);
      }

      return nextState;
    });

    setTimeout(() => setFeedbackRating(null), 600);
  }, [isPaused, gameState.isComplete, elapsedMs, personality]);

  // Main animation timer loop
  useEffect(() => {
    startTimeRef.current = Date.now() - elapsedMs;

    const loop = () => {
      if (!isPaused) {
        const current = Date.now() - startTimeRef.current;
        setElapsedMs(current);

        setGameState((prev) => {
          if (prev.isComplete) return prev;
          const { nextState, newMisses } = tickRhythmTrack(prev, current);

          if (newMisses.length > 0) {
            retroAudio.playError();
            setFeedbackRating({ text: 'MISS!', color: 'text-rose-400' });
            const reaction = getMiniGameReaction('rhythm_miss', {
              gameId: 'companion_rhythm',
              personality,
            });
            setCompanionReaction(reaction.reactionText);
            setCompanionBehaviour(reaction.behaviourState);
          }

          return nextState;
        });
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPaused, elapsedMs, personality]);

  // Conclude game when complete
  useEffect(() => {
    if (gameState.isComplete) {
      const accuracy =
        gameState.totalNotes > 0
          ? Math.round((gameState.totalHits / gameState.totalNotes) * 100)
          : 100;
      onFinishGame(gameState.score, {
        maxStreak: gameState.maxStreak,
        accuracy,
      });
    }
  }, [gameState.isComplete, gameState.score, gameState.maxStreak, gameState.totalHits, gameState.totalNotes, onFinishGame]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        setIsPaused((p) => !p);
        return;
      }

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        handleStrike();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStrike]);

  // Target line is located at 25% across the track.
  // Notes travel from right (100%) to left over a 2000ms travel time window.
  const TRAVEL_TIME_MS = 2000;
  const TARGET_PCT = 25;

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-4 select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-cyan-300 font-bold flex items-center gap-1">
            <span>🎵</span> Score: {gameState.score}
          </span>
          {gameState.streak > 1 && (
            <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 animate-pulse">
              x{gameState.streak} Combo!
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPaused((p) => !p)}
            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            aria-label={isPaused ? 'Resume game' : 'Pause game'}
          >
            {isPaused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            onClick={onExit}
            className="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800"
            aria-label="Exit game"
          >
            ✕ Exit
          </button>
        </div>
      </div>

      {/* Main Rhythm Track Arena */}
      <div className="relative w-full aspect-16/9 bg-gradient-to-b from-[#050b17] via-[#09152b] to-[#0f2245] border-2 border-cyan-900/60 rounded-2xl p-4 flex flex-col justify-between shadow-2xl overflow-hidden relative">
        {/* Track Line */}
        <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 bg-cyan-950 border-y border-cyan-700/50" />

        {/* Target Strike Zone (Target Line at 25%) */}
        <div
          style={{ left: `${TARGET_PCT}%` }}
          className="absolute top-1/4 bottom-1/4 w-12 -translate-x-1/2 rounded-xl border-2 border-dashed border-cyan-400 bg-cyan-500/20 shadow-[0_0_20px_rgba(34,211,238,0.5)] z-10 flex items-center justify-center pointer-events-none"
        >
          <div className="w-1.5 h-full bg-cyan-300 rounded-full animate-pulse" />
        </div>

        {/* Moving Rhythm Pulses */}
        {gameState.notes.map((note) => {
          if (note.hit) return null;
          // Calculate note position percentage:
          // When note.targetTimeMs == elapsedMs, pos = TARGET_PCT
          // When note.targetTimeMs - elapsedMs == TRAVEL_TIME_MS, pos = 100%
          const timeRemaining = note.targetTimeMs - elapsedMs;
          if (timeRemaining > TRAVEL_TIME_MS || timeRemaining < -RHYTHM_OK_WINDOW_MS) return null;

          const progress = 1 - timeRemaining / TRAVEL_TIME_MS;
          const posPct = TARGET_PCT + (1 - progress) * (100 - TARGET_PCT);

          return (
            <div
              key={note.id}
              style={{ left: `${posPct}%` }}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-20 pointer-events-none"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan-300 to-indigo-600 border-2 border-white shadow-[0_0_12px_rgba(34,211,238,0.9)] flex items-center justify-center font-bold text-xs text-slate-950">
                ♪
              </div>
            </div>
          );
        })}

        {/* Feedback Rating Toast Banner */}
        <div className="relative z-30 flex justify-center h-8">
          {feedbackRating && (
            <span
              className={`text-base font-extrabold font-mono tracking-wider animate-bounce drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] ${feedbackRating.color}`}
            >
              {feedbackRating.text}
            </span>
          )}
        </div>

        {/* Pause Overlay */}
        {isPaused && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-40 flex flex-col items-center justify-center space-y-3">
            <h3 className="text-lg font-bold text-cyan-300 tracking-wider">GAME PAUSED</h3>
            <p className="text-xs text-slate-400">Press P or Resume to continue groove</p>
            <button
              onClick={() => setIsPaused(false)}
              className="px-4 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-bold text-xs hover:bg-cyan-400"
            >
              Resume
            </button>
          </div>
        )}

        {/* Companion Sideline Cheering */}
        <div className="absolute bottom-2 left-3 z-30 flex items-end gap-2 pointer-events-none">
          <PetSprite
            species={pet.species}
            personality={pet.personality}
            size={68}
            animationState={mapBehaviourToSpriteState(companionBehaviour)}
            showShadow={false}
          />
          <div className="max-w-[200px] sm:max-w-xs bg-slate-950/90 border border-slate-700/80 rounded-lg p-2 text-[11px] text-slate-200 shadow-lg mb-2">
            <p className="italic font-mono leading-tight">&ldquo;{companionReaction}&rdquo;</p>
          </div>
        </div>
      </div>

      {/* Interactive Rhythm Strike Button */}
      <div className="w-full flex justify-center">
        <button
          onClick={handleStrike}
          className="w-full sm:w-2/3 py-4 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-cyan-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-extrabold text-sm tracking-wider uppercase border border-cyan-400/60 shadow-lg shadow-cyan-950/50 active:scale-95 transition-transform"
        >
          🎵 STRIKE BEAT! (Space / Enter)
        </button>
      </div>
    </div>
  );
};
