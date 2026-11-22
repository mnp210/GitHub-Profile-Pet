'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { PetState } from '@/types/pet';
import {
  createInitialStarCatcherState,
  spawnStar,
  tickStarCatcher,
  catchStarDirect,
  catchStarsWithNet,
  BASKET_WIDTH_PCT,
  StarCatcherState,
} from '@/features/minigames/starCatcher';
import { getMiniGameReaction } from '@/features/minigames/personalityReactions';
import { PetSprite } from '@/components/pet/PetSprite';
import { retroAudio } from '@/lib/audio/retroAudio';
import type { BehaviourState } from '@/features/personality/types';
import { mapBehaviourToSpriteState } from '@/features/personality/behaviourEngine';

interface StarCatcherGameProps {
  pet: PetState;
  onFinishGame: (finalScore: number, stats: { maxStreak: number; accuracy: number }) => void;
  onExit: () => void;
}

export const StarCatcherGame: React.FC<StarCatcherGameProps> = ({
  pet,
  onFinishGame,
  onExit,
}) => {
  const [gameState, setGameState] = useState<StarCatcherState>(() => createInitialStarCatcherState());
  const [isPaused, setIsPaused] = useState(false);
  const [companionReaction, setCompanionReaction] = useState<string>(() => {
    return getMiniGameReaction('start', { gameId: 'star_catcher', personality: pet.personality || 'curious' }).reactionText;
  });
  const [companionBehaviour, setCompanionBehaviour] = useState<BehaviourState>('idle_curious');
  const [floatingParticles, setFloatingParticles] = useState<{ id: number; text: string; x: number; y: number }[]>([]);

  const arenaRef = useRef<HTMLDivElement>(null);
  const lastTickTimeRef = useRef<number>(0);
  const starSpawnCounterRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);

  const personality = pet.personality || 'curious';

  const triggerParticle = (text: string, x: number, y: number) => {
    const id = Date.now() + Math.random();
    setFloatingParticles((prev) => [...prev.slice(-4), { id, text, x, y }]);
    setTimeout(() => {
      setFloatingParticles((prev) => prev.filter((p) => p.id !== id));
    }, 900);
  };

  const handleCatch = useCallback((starId: string, clientX?: number, clientY?: number) => {
    setGameState((prev) => {
      const { nextState, caughtStar, pointsAwarded } = catchStarDirect(prev, starId);
      if (caughtStar) {
        retroAudio.playPlay();
        const reaction = getMiniGameReaction('catch_star', {
          gameId: 'star_catcher',
          personality,
          streak: nextState.streak,
        });
        setCompanionReaction(reaction.reactionText);
        setCompanionBehaviour(reaction.behaviourState);

        const xPos = clientX ?? (caughtStar.x * 3);
        const yPos = clientY ?? (caughtStar.y * 2.5);
        triggerParticle(`+${pointsAwarded}`, xPos, yPos);
      }
      return nextState;
    });
  }, [personality]);

  // Main game loop (RAF)
  useEffect(() => {
    lastTickTimeRef.current = Date.now();

    const loop = () => {
      if (!isPaused) {
        const now = Date.now();
        const deltaSec = Math.min(0.1, (now - lastTickTimeRef.current) / 1000);
        lastTickTimeRef.current = now;

        setGameState((prev) => {
          if (prev.isComplete) return prev;

          // Spawn star periodically (~every 800ms)
          starSpawnCounterRef.current += deltaSec;
          let currentStars = prev.stars;
          let spawnedCount = prev.totalSpawned;

          if (starSpawnCounterRef.current >= 0.8) {
            starSpawnCounterRef.current = 0;
            const newStar = spawnStar(`star_${now}_${spawnedCount}`, now);
            currentStars = [...currentStars, newStar];
            spawnedCount += 1;
          }

          // Advance physics
          const { nextState, newMisses } = tickStarCatcher(
            { ...prev, stars: currentStars, totalSpawned: spawnedCount },
            deltaSec
          );

          // Check basket collisions
          const netResult = catchStarsWithNet(nextState);

          if (newMisses.length > 0) {
            retroAudio.playError();
            const missReact = getMiniGameReaction('miss_star', {
              gameId: 'star_catcher',
              personality,
            });
            setCompanionReaction(missReact.reactionText);
            setCompanionBehaviour(missReact.behaviourState);
          }

          return netResult.nextState;
        });
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isPaused, personality]);

  // Handle Game Completion
  useEffect(() => {
    if (gameState.isComplete) {
      const totalAttempts = gameState.totalCaught + gameState.totalMissed;
      const accuracy = totalAttempts > 0 ? (gameState.totalCaught / totalAttempts) * 100 : 100;
      onFinishGame(gameState.score, {
        maxStreak: gameState.maxStreak,
        accuracy,
      });
    }
  }, [gameState.isComplete, gameState.score, gameState.maxStreak, gameState.totalCaught, gameState.totalMissed, onFinishGame]);

  // Keyboard navigation & basket movement
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
        setIsPaused((p) => !p);
        return;
      }

      if (isPaused || gameState.isComplete) return;

      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        setGameState((prev) => ({ ...prev, basketX: Math.max(10, prev.basketX - 8) }));
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        setGameState((prev) => ({ ...prev, basketX: Math.min(90, prev.basketX + 8) }));
      } else if (e.key === ' ') {
        // Spacebar catch burst: try catching any star near the basket
        setGameState((prev) => catchStarsWithNet(prev).nextState);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPaused, gameState.isComplete]);

  // Pause on hidden document
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) setIsPaused(true);
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  return (
    <div className="flex flex-col items-center w-full max-w-2xl mx-auto space-y-3 select-none">
      {/* Top HUD: Time, Score, Combo, Controls */}
      <div className="w-full flex items-center justify-between px-3 py-2 bg-slate-900/90 border border-slate-800 rounded-xl font-mono text-xs">
        <div className="flex items-center gap-3">
          <span className="text-amber-300 font-bold flex items-center gap-1">
            <span>⭐</span> Score: {gameState.score}
          </span>
          {gameState.streak > 1 && (
            <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold animate-pulse border border-amber-500/40">
              x{gameState.streak} Combo!
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-cyan-300 font-bold">
            ⏳ {Math.ceil(gameState.timeRemainingSec)}s
          </span>
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

      {/* Main Play Arena */}
      <div
        ref={arenaRef}
        className="relative w-full aspect-16/10 sm:aspect-16/9 bg-gradient-to-b from-[#060814] via-[#0b0f24] to-[#121633] border-2 border-indigo-900/60 rounded-2xl overflow-hidden shadow-2xl relative"
        tabIndex={0}
        aria-label="Star Catcher play field"
        onMouseMove={(e) => {
          if (!arenaRef.current || isPaused) return;
          const rect = arenaRef.current.getBoundingClientRect();
          const pct = ((e.clientX - rect.left) / rect.width) * 100;
          setGameState((prev) => ({ ...prev, basketX: Math.min(90, Math.max(10, pct)) }));
        }}
        onTouchMove={(e) => {
          if (!arenaRef.current || isPaused || !e.touches[0]) return;
          const rect = arenaRef.current.getBoundingClientRect();
          const pct = ((e.touches[0].clientX - rect.left) / rect.width) * 100;
          setGameState((prev) => ({ ...prev, basketX: Math.min(90, Math.max(10, pct)) }));
        }}
      >
        {/* Background stars */}
        <div className="absolute inset-0 bg-radial from-purple-900/10 via-transparent to-black/60 pointer-events-none" />

        {/* Falling Star Entities */}
        {gameState.stars.map((star) => (
          <button
            key={star.id}
            onClick={() => handleCatch(star.id)}
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              transform: 'translate(-50%, -50%)',
            }}
            className={`absolute z-20 cursor-pointer p-2 rounded-full transition-transform active:scale-125 focus:outline-none focus:ring-2 focus:ring-amber-300 ${
              star.caught ? 'opacity-0 scale-150 duration-300' : 'animate-pulse'
            }`}
            aria-label={`Catch ${star.type} star`}
          >
            {star.type === 'golden' ? (
              <span className="text-2xl drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]">💫</span>
            ) : star.type === 'nebula' ? (
              <span className="text-2xl drop-shadow-[0_0_10px_rgba(168,85,247,0.9)]">🌌</span>
            ) : (
              <span className="text-xl drop-shadow-[0_0_8px_rgba(250,204,21,0.9)]">⭐</span>
            )}
          </button>
        ))}

        {/* Catch Basket Net */}
        <div
          style={{
            left: `${gameState.basketX}%`,
            width: `${BASKET_WIDTH_PCT}%`,
            transform: 'translateX(-50%)',
          }}
          className="absolute bottom-3 h-4 bg-gradient-to-r from-amber-500/80 via-amber-300 to-amber-500/80 rounded-full border-2 border-amber-200 shadow-[0_0_16px_rgba(251,191,36,0.8)] z-10 pointer-events-none"
        />

        {/* Floating Floating Particles */}
        {floatingParticles.map((p) => (
          <div
            key={p.id}
            style={{ left: `${p.x}px`, top: `${p.y}px` }}
            className="absolute z-30 pointer-events-none font-bold text-sm text-amber-300 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] animate-bounce font-mono"
          >
            {p.text}
          </div>
        ))}

        {/* Pause Overlay */}
        {isPaused && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm z-40 flex flex-col items-center justify-center space-y-3">
            <h3 className="text-lg font-bold text-amber-300 tracking-wider">GAME PAUSED</h3>
            <p className="text-xs text-slate-400">Press P or Resume to continue catching stars</p>
            <button
              onClick={() => setIsPaused(false)}
              className="px-4 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400"
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
            size={72}
            animationState={mapBehaviourToSpriteState(companionBehaviour)}
            showShadow={false}
          />
          <div className="max-w-[200px] sm:max-w-xs bg-slate-950/90 border border-slate-700/80 rounded-lg p-2 text-[11px] text-slate-200 shadow-lg mb-2">
            <p className="italic font-mono leading-tight">&ldquo;{companionReaction}&rdquo;</p>
          </div>
        </div>
      </div>

      <div className="text-[11px] text-slate-400 text-center">
        Tip: Move the basket across the bottom with mouse/touch or Arrow Keys. Direct clicks also catch stars!
      </div>
    </div>
  );
};
