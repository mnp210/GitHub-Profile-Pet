'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PetState } from '@/types/pet';
import {
  SPARK_RUNES,
  createInitialMemorySparksState,
  advanceToNextRound,
  submitRuneInput,
  MemorySparksState,
} from '@/features/minigames/memorySparks';
import { getMiniGameReaction } from '@/features/minigames/personalityReactions';
import { PetSprite } from '@/components/pet/PetSprite';
import { retroAudio } from '@/lib/audio/retroAudio';
import type { BehaviourState } from '@/features/personality/types';
import { mapBehaviourToSpriteState } from '@/features/personality/behaviourEngine';

interface MemorySparksGameProps {
  pet: PetState;
  onFinishGame: (finalScore: number, stats: { maxStreak: number; accuracy: number }) => void;
  onExit: () => void;
}

export const MemorySparksGame: React.FC<MemorySparksGameProps> = ({
  pet,
  onFinishGame,
  onExit,
}) => {
  const [gameState, setGameState] = useState<MemorySparksState>(() => createInitialMemorySparksState(2));
  const [companionReaction, setCompanionReaction] = useState<string>(() => {
    return getMiniGameReaction('start', { gameId: 'memory_sparks', personality: pet.personality || 'curious' }).reactionText;
  });
  const [companionBehaviour, setCompanionBehaviour] = useState<BehaviourState>('idle_curious');
  const [activePlaybackRune, setActivePlaybackRune] = useState<number | null>(null);

  const playbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const personality = pet.personality || 'curious';

  // Play sequence playback animation
  const playSequence = useCallback((sequence: number[]) => {
    setGameState((prev) => ({ ...prev, isInputLocked: true, activeSpark: null }));
    setActivePlaybackRune(null);

    let step = 0;
    const playNext = () => {
      if (step >= sequence.length) {
        // Sequence playback finished: unlock player input
        setActivePlaybackRune(null);
        setGameState((prev) => ({
          ...prev,
          phase: 'awaiting_input',
          isInputLocked: false,
          playerInputIndex: 0,
        }));
        return;
      }

      const runeId = sequence[step];
      setActivePlaybackRune(runeId);
      retroAudio.playClick();

      playbackTimeoutRef.current = setTimeout(() => {
        setActivePlaybackRune(null);
        step += 1;
        playbackTimeoutRef.current = setTimeout(playNext, 250);
      }, 500);
    };

    playbackTimeoutRef.current = setTimeout(playNext, 600);
  }, []);

  // Trigger sequence playback when round starts or advances
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (gameState.phase === 'showing_sequence') {
      timer = setTimeout(() => {
        playSequence(gameState.sequence);
      }, 50);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [gameState.phase, gameState.sequence, playSequence]);

  // Clean up timeouts on unmount
  useEffect(() => {
    return () => {
      if (playbackTimeoutRef.current) clearTimeout(playbackTimeoutRef.current);
    };
  }, []);

  // Handle rune tap/click input
  const handleRuneClick = useCallback((runeId: number) => {
    if (gameState.isInputLocked || gameState.phase !== 'awaiting_input') return;

    retroAudio.playClick();
    setActivePlaybackRune(runeId);
    setTimeout(() => setActivePlaybackRune(null), 200);

    const result = submitRuneInput(gameState, runeId);

    if (result.isCorrect) {
      if (result.isRoundComplete) {
        retroAudio.playLevelUp();
        const reaction = getMiniGameReaction('spark_correct', {
          gameId: 'memory_sparks',
          personality,
          streak: result.nextState.round,
        });
        setCompanionReaction(reaction.reactionText);
        setCompanionBehaviour(reaction.behaviourState);

        setGameState(result.nextState);

        // Advance to next round after short delay
        setTimeout(() => {
          setGameState((prev) => advanceToNextRound(prev));
        }, 1000);
      } else {
        setGameState(result.nextState);
      }
    } else {
      // Incorrect input: Game Over
      retroAudio.playError();
      const reaction = getMiniGameReaction('spark_wrong', {
        gameId: 'memory_sparks',
        personality,
      });
      setCompanionReaction(reaction.reactionText);
      setCompanionBehaviour(reaction.behaviourState);
      setGameState(result.nextState);

      setTimeout(() => {
        const accuracy = Math.round((result.nextState.totalCorrect / Math.max(1, result.nextState.totalCorrect + 1)) * 100);
        onFinishGame(result.nextState.score, {
          maxStreak: result.nextState.round,
          accuracy,
        });
      }, 1200);
    }
  }, [gameState, personality, onFinishGame]);

  // Keyboard navigation (1..4, WASD, Arrows)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState.isInputLocked || gameState.phase !== 'awaiting_input') return;

      if (e.key === '1' || e.key.toLowerCase() === 'w' || e.key === 'ArrowUp') {
        handleRuneClick(0);
      } else if (e.key === '2' || e.key.toLowerCase() === 'd' || e.key === 'ArrowRight') {
        handleRuneClick(1);
      } else if (e.key === '3' || e.key.toLowerCase() === 's' || e.key === 'ArrowDown') {
        handleRuneClick(2);
      } else if (e.key === '4' || e.key.toLowerCase() === 'a' || e.key === 'ArrowLeft') {
        handleRuneClick(3);
      } else if (e.key === 'Escape') {
        onExit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState.isInputLocked, gameState.phase, handleRuneClick, onExit]);

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-4 select-none">
      {/* Top HUD */}
      <div className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-purple-300 font-bold flex items-center gap-1">
            <span>🔮</span> Score: {gameState.score}
          </span>
          <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40">
            Round {gameState.round}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`text-xs px-2.5 py-0.5 rounded font-bold ${
              gameState.isInputLocked
                ? 'bg-amber-950/80 text-amber-300 border border-amber-800 animate-pulse'
                : 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
            }`}
          >
            {gameState.phase === 'showing_sequence'
              ? '👁️ Watch Sequence...'
              : gameState.phase === 'round_success'
              ? '✨ Sequence Matched!'
              : gameState.phase === 'game_over'
              ? '💥 Misaligned Rune!'
              : '👉 Your Turn!'}
          </span>
          <button
            onClick={onExit}
            className="px-2 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800"
            aria-label="Exit game"
          >
            ✕ Exit
          </button>
        </div>
      </div>

      {/* Main Sparks Arena & Rune Matrix */}
      <div className="relative w-full aspect-16/10 sm:aspect-16/9 bg-gradient-to-b from-[#0a071a] via-[#120e2e] to-[#1c1542] border-2 border-purple-900/60 rounded-2xl p-4 flex flex-col items-center justify-center shadow-2xl relative">
        {/* Background glow */}
        <div className="absolute inset-0 bg-radial from-purple-800/10 via-transparent to-black/60 pointer-events-none" />

        {/* 4 Compass-Oriented Elemental Rune Pads */}
        <div className="relative z-10 w-64 h-64 sm:w-72 sm:h-72 grid grid-cols-3 grid-rows-3 gap-2 items-center justify-items-center">
          {/* North Rune: Emerald (0) */}
          <div className="col-start-2 row-start-1">
            <button
              onClick={() => handleRuneClick(0)}
              disabled={gameState.isInputLocked}
              className={`w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center transition-all ${
                activePlaybackRune === 0
                  ? SPARK_RUNES[0].activeColorClass
                  : SPARK_RUNES[0].baseColorClass
              } ${gameState.isInputLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
              aria-label="Emerald Rune (North, key 1 or W)"
            >
              <span className="text-2xl">{SPARK_RUNES[0].glyph}</span>
              <span className="text-[10px] font-mono font-bold mt-1">1 / W</span>
            </button>
          </div>

          {/* West Rune: Cyan (3) */}
          <div className="col-start-1 row-start-2">
            <button
              onClick={() => handleRuneClick(3)}
              disabled={gameState.isInputLocked}
              className={`w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center transition-all ${
                activePlaybackRune === 3
                  ? SPARK_RUNES[3].activeColorClass
                  : SPARK_RUNES[3].baseColorClass
              } ${gameState.isInputLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
              aria-label="Cyan Rune (West, key 4 or A)"
            >
              <span className="text-2xl">{SPARK_RUNES[3].glyph}</span>
              <span className="text-[10px] font-mono font-bold mt-1">4 / A</span>
            </button>
          </div>

          {/* Center Nexus Eye */}
          <div className="col-start-2 row-start-2 w-16 h-16 rounded-full bg-slate-950 border border-purple-500/40 flex flex-col items-center justify-center text-center p-1 shadow-inner">
            <span className="text-xs font-mono text-purple-300 font-bold">
              {gameState.sequence.length}
            </span>
            <span className="text-[8px] text-slate-400 uppercase tracking-tighter">
              Runes
            </span>
          </div>

          {/* East Rune: Amber (1) */}
          <div className="col-start-3 row-start-2">
            <button
              onClick={() => handleRuneClick(1)}
              disabled={gameState.isInputLocked}
              className={`w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center transition-all ${
                activePlaybackRune === 1
                  ? SPARK_RUNES[1].activeColorClass
                  : SPARK_RUNES[1].baseColorClass
              } ${gameState.isInputLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
              aria-label="Amber Rune (East, key 2 or D)"
            >
              <span className="text-2xl">{SPARK_RUNES[1].glyph}</span>
              <span className="text-[10px] font-mono font-bold mt-1">2 / D</span>
            </button>
          </div>

          {/* South Rune: Crimson (2) */}
          <div className="col-start-2 row-start-3">
            <button
              onClick={() => handleRuneClick(2)}
              disabled={gameState.isInputLocked}
              className={`w-20 h-20 rounded-2xl border-2 flex flex-col items-center justify-center transition-all ${
                activePlaybackRune === 2
                  ? SPARK_RUNES[2].activeColorClass
                  : SPARK_RUNES[2].baseColorClass
              } ${gameState.isInputLocked ? 'cursor-not-allowed opacity-90' : 'cursor-pointer hover:scale-105 active:scale-95'}`}
              aria-label="Crimson Rune (South, key 3 or S)"
            >
              <span className="text-2xl">{SPARK_RUNES[2].glyph}</span>
              <span className="text-[10px] font-mono font-bold mt-1">3 / S</span>
            </button>
          </div>
        </div>

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

      <div className="text-[11px] text-slate-400 text-center font-mono">
        Controls: Click the runes, or use keys 1, 2, 3, 4 (or W, D, S, A / Arrow Keys).
      </div>
    </div>
  );
};
