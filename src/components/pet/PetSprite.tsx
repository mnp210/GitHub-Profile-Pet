import React, { useState, useEffect } from 'react';
import { SpeciesId, PersonalityType } from '@/types/pet';

export type SpriteAnimationState =
  | 'idle'
  | 'happy'
  | 'eating'
  | 'training'
  | 'sleeping'
  | 'playing'
  | 'clicked'
  | 'curious'
  | 'celebrating'
  | 'looking_around';

interface PetSpriteProps {
  species: SpeciesId;
  personality?: PersonalityType;
  size?: number;
  className?: string;
  showShadow?: boolean;
  animationState?: SpriteAnimationState;
  evolutionStage?: string;
  onClick?: () => void;
}

export const PetSprite: React.FC<PetSpriteProps> = ({
  species,
  personality,
  size = 180,
  className = '',
  showShadow = true,
  animationState = 'idle',
  evolutionStage = 'Hatchling',
  onClick,
}) => {
  const [blink, setBlink] = useState(false);

  // Natural intermittent blinking cycle tailored to personality
  useEffect(() => {
    let blinkTimer: NodeJS.Timeout;
    const baseInterval =
      personality === 'calm'
        ? 4500
        : personality === 'playful'
        ? 2200
        : personality === 'determined'
        ? 4000
        : 3000;

    const triggerBlink = () => {
      setBlink(true);
      setTimeout(() => setBlink(false), 150);
      blinkTimer = setTimeout(triggerBlink, baseInterval + Math.random() * 2000);
    };

    blinkTimer = setTimeout(triggerBlink, 1500);
    return () => clearTimeout(blinkTimer);
  }, [personality]);

  const getDynamicAnimationClass = () => {
    switch (animationState) {
      case 'happy':
      case 'clicked':
        return 'animate-bounce';
      case 'celebrating':
        return 'animate-bounce scale-105';
      case 'curious':
        return 'animate-pet-curious';
      case 'looking_around':
        return 'transition-transform duration-300 translate-x-1';
      case 'eating':
        return 'animate-pulse';
      case 'training':
        return 'animate-wiggle';
      case 'sleeping':
        return 'opacity-80 scale-95';
      case 'playing':
        return 'animate-pet-bounce';
      default:
        if (personality === 'curious') return 'animate-pet-curious';
        if (personality === 'playful') return 'animate-pet-bounce';
        if (personality === 'calm') return 'animate-pet-zen';
        switch (species) {
          case 'cat':
            return 'animate-pet-cat';
          case 'dragon':
            return 'animate-pet-dragon';
          case 'fox':
            return 'animate-pet-fox';
          case 'slime':
            return 'animate-pet-slime';
          default:
            return 'animate-pet-cat';
        }
    }
  };

  const isEyesClosed = blink || animationState === 'sleeping';

  const renderCat = () => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`select-none transition-transform duration-200 ${getDynamicAnimationClass()}`}
      shapeRendering="crispEdges"
      aria-label="Shadow Claw - Void Familiar Pixel Cat"
    >
      {/* Ears - outer */}
      <rect x="4" y="2" width="4" height="2" fill="#2e1065" />
      <rect x="3" y="4" width="2" height="4" fill="#2e1065" />
      <rect x="16" y="2" width="4" height="2" fill="#2e1065" />
      <rect x="19" y="4" width="2" height="4" fill="#2e1065" />

      {/* Ears - inner pink */}
      <rect x="5" y="4" width="2" height="3" fill="#ec4899" />
      <rect x="17" y="4" width="2" height="3" fill="#ec4899" />

      {/* Head silhouette */}
      <rect x="5" y="6" width="14" height="8" fill="#4c1d95" />
      <rect x="4" y="7" width="16" height="6" fill="#5b21b6" />
      <rect x="3" y="8" width="18" height="4" fill="#6d28d9" />

      {/* Forehead markings */}
      <rect x="11" y="6" width="2" height="3" fill="#a78bfa" />
      <rect x="9" y="8" width="6" height="1" fill="#7c3aed" />

      {/* Eyes - Dynamic Emerald Pixel Glow or Closed Slits */}
      {isEyesClosed ? (
        <>
          <rect x="6" y="10" width="3" height="1" fill="#10b981" />
          <rect x="15" y="10" width="3" height="1" fill="#10b981" />
        </>
      ) : (
        <>
          <rect x="6" y="9" width="3" height="3" fill="#10b981" />
          <rect x="15" y="9" width="3" height="3" fill="#10b981" />
          <rect x="8" y="9" width="1" height="2" fill="#047857" />
          <rect x="17" y="9" width="1" height="2" fill="#047857" />
          <rect x="6" y="9" width="1" height="1" fill="#ecfdf5" />
          <rect x="15" y="9" width="1" height="1" fill="#ecfdf5" />
        </>
      )}

      {/* Nose & Mouth */}
      <rect x="11" y="11" width="2" height="1" fill="#f472b6" />
      <rect x="10" y="12" width="1" height="1" fill="#312e81" />
      <rect x="13" y="12" width="1" height="1" fill="#312e81" />

      {/* Whiskers */}
      <rect x="1" y="10" width="2" height="1" fill="#c4b5fd" opacity="0.8" />
      <rect x="1" y="12" width="3" height="1" fill="#c4b5fd" opacity="0.8" />
      <rect x="20" y="10" width="3" height="1" fill="#c4b5fd" opacity="0.8" />
      <rect x="21" y="12" width="2" height="1" fill="#c4b5fd" opacity="0.8" />

      {/* Body */}
      <rect x="6" y="14" width="12" height="7" fill="#4c1d95" />
      <rect x="7" y="13" width="10" height="8" fill="#5b21b6" />
      <rect x="9" y="14" width="6" height="5" fill="#7c3aed" />

      {/* Chest Arcane Crest */}
      <rect x="11" y="15" width="2" height="3" fill="#c084fc" />
      <rect x="10" y="16" width="4" height="1" fill="#c084fc" />

      {/* Front Paws */}
      <rect x="7" y="20" width="3" height="2" fill="#3b0764" />
      <rect x="14" y="20" width="3" height="2" fill="#3b0764" />
      <rect x="7" y="21" width="1" height="1" fill="#a78bfa" />
      <rect x="9" y="21" width="1" height="1" fill="#a78bfa" />
      <rect x="14" y="21" width="1" height="1" fill="#a78bfa" />
      <rect x="16" y="21" width="1" height="1" fill="#a78bfa" />

      {/* Tail */}
      <rect x="17" y="16" width="3" height="2" fill="#5b21b6" />
      <rect x="19" y="14" width="2" height="3" fill="#6d28d9" />
      <rect x="18" y="12" width="3" height="2" fill="#7c3aed" />
      <rect x="17" y="11" width="2" height="2" fill="#a78bfa" />
    </svg>
  );

  const renderDragon = () => (
    <svg
      viewBox="0 0 28 28"
      width={size}
      height={size}
      className={`select-none transition-transform duration-200 ${getDynamicAnimationClass()}`}
      shapeRendering="crispEdges"
      aria-label="Ignis Ember - Ruby Drake Pixel Dragon"
    >
      {/* Dragon Horns */}
      <rect x="5" y="2" width="2" height="4" fill="#f59e0b" />
      <rect x="7" y="4" width="2" height="3" fill="#fbbf24" />
      <rect x="21" y="2" width="2" height="4" fill="#f59e0b" />
      <rect x="19" y="4" width="2" height="3" fill="#fbbf24" />

      {/* Wings - Left & Right */}
      <rect x="1" y="9" width="4" height="2" fill="#991b1b" />
      <rect x="2" y="11" width="5" height="3" fill="#b91c1c" />
      <rect x="23" y="9" width="4" height="2" fill="#991b1b" />
      <rect x="21" y="11" width="5" height="3" fill="#b91c1c" />
      <rect x="1" y="8" width="2" height="2" fill="#fbbf24" />
      <rect x="25" y="8" width="2" height="2" fill="#fbbf24" />

      {/* Dragon Head */}
      <rect x="8" y="6" width="12" height="8" fill="#7f1d1d" />
      <rect x="9" y="5" width="10" height="9" fill="#991b1b" />
      <rect x="10" y="7" width="8" height="7" fill="#b91c1c" />
      <rect x="9" y="11" width="10" height="4" fill="#dc2626" />
      <rect x="11" y="12" width="6" height="2" fill="#ef4444" />
      <rect x="11" y="13" width="1" height="1" fill="#450a0a" />
      <rect x="16" y="13" width="1" height="1" fill="#450a0a" />

      {/* Eyes */}
      {isEyesClosed ? (
        <>
          <rect x="10" y="9" width="3" height="1" fill="#f59e0b" />
          <rect x="15" y="9" width="3" height="1" fill="#f59e0b" />
        </>
      ) : (
        <>
          <rect x="10" y="8" width="3" height="2" fill="#f59e0b" />
          <rect x="15" y="8" width="3" height="2" fill="#f59e0b" />
          <rect x="11" y="8" width="1" height="2" fill="#450a0a" />
          <rect x="16" y="8" width="1" height="2" fill="#450a0a" />
        </>
      )}

      {/* Back Spikes */}
      <rect x="13" y="3" width="2" height="3" fill="#f59e0b" />
      <rect x="13" y="14" width="2" height="2" fill="#f59e0b" />
      <rect x="13" y="17" width="2" height="2" fill="#f59e0b" />

      {/* Body & Belly */}
      <rect x="8" y="14" width="12" height="8" fill="#991b1b" />
      <rect x="9" y="15" width="10" height="7" fill="#b91c1c" />
      <rect x="11" y="15" width="6" height="6" fill="#f59e0b" />
      <rect x="12" y="16" width="4" height="4" fill="#fbbf24" />
      <rect x="11" y="17" width="6" height="1" fill="#d97706" />
      <rect x="11" y="19" width="6" height="1" fill="#d97706" />

      {/* Feet & Claws */}
      <rect x="8" y="22" width="4" height="2" fill="#7f1d1d" />
      <rect x="16" y="22" width="4" height="2" fill="#7f1d1d" />
      <rect x="8" y="23" width="1" height="1" fill="#fef08a" />
      <rect x="11" y="23" width="1" height="1" fill="#fef08a" />
      <rect x="16" y="23" width="1" height="1" fill="#fef08a" />
      <rect x="19" y="23" width="1" height="1" fill="#fef08a" />

      {/* Tail with Blazing Flame Tip */}
      <rect x="19" y="20" width="4" height="2" fill="#991b1b" />
      <rect x="22" y="18" width="3" height="3" fill="#b91c1c" />
      <rect x="23" y="15" width="2" height="3" fill="#dc2626" />
      <rect x="23" y="13" width="3" height="2" fill="#f59e0b" />
      <rect x="24" y="11" width="2" height="3" fill="#ef4444" />
      <rect x="25" y="12" width="1" height="2" fill="#fef08a" />
    </svg>
  );

  const renderFox = () => (
    <svg
      viewBox="0 0 26 26"
      width={size}
      height={size}
      className={`select-none transition-transform duration-200 ${getDynamicAnimationClass()}`}
      shapeRendering="crispEdges"
      aria-label="Kitsune Sol - Solar Fox"
    >
      {/* Fox Ears */}
      <rect x="4" y="2" width="4" height="3" fill="#1c1917" />
      <rect x="5" y="5" width="3" height="3" fill="#ea580c" />
      <rect x="18" y="2" width="4" height="3" fill="#1c1917" />
      <rect x="18" y="5" width="3" height="3" fill="#ea580c" />
      <rect x="6" y="4" width="2" height="3" fill="#fed7aa" />
      <rect x="18" y="4" width="2" height="3" fill="#fed7aa" />

      {/* Head */}
      <rect x="6" y="7" width="14" height="8" fill="#ea580c" />
      <rect x="5" y="8" width="16" height="6" fill="#f97316" />
      <rect x="4" y="9" width="18" height="4" fill="#fb923c" />

      {/* White cheek patches & muzzle */}
      <rect x="5" y="11" width="4" height="4" fill="#f8fafc" />
      <rect x="17" y="11" width="4" height="4" fill="#f8fafc" />
      <rect x="9" y="11" width="8" height="4" fill="#f8fafc" />
      <rect x="11" y="13" width="4" height="3" fill="#f8fafc" />
      <rect x="12" y="13" width="2" height="1" fill="#0f172a" />

      {/* Eyes */}
      {isEyesClosed ? (
        <>
          <rect x="8" y="10" width="3" height="1" fill="#f59e0b" />
          <rect x="15" y="10" width="3" height="1" fill="#f59e0b" />
        </>
      ) : (
        <>
          <rect x="8" y="9" width="3" height="2" fill="#f59e0b" />
          <rect x="15" y="9" width="3" height="2" fill="#f59e0b" />
          <rect x="9" y="9" width="1" height="2" fill="#451a03" />
          <rect x="16" y="9" width="1" height="2" fill="#451a03" />
          <rect x="8" y="9" width="1" height="1" fill="#fef3c7" />
          <rect x="15" y="9" width="1" height="1" fill="#fef3c7" />
        </>
      )}

      {/* Body & Ruff */}
      <rect x="7" y="15" width="12" height="7" fill="#ea580c" />
      <rect x="8" y="14" width="10" height="8" fill="#f97316" />
      <rect x="10" y="15" width="6" height="5" fill="#f8fafc" />
      <rect x="11" y="16" width="4" height="4" fill="#f1f5f9" />

      {/* Paws */}
      <rect x="8" y="21" width="3" height="3" fill="#292524" />
      <rect x="15" y="21" width="3" height="3" fill="#292524" />

      {/* Big Fluffy Bushy Tail with White Tip */}
      <rect x="18" y="16" width="4" height="4" fill="#ea580c" />
      <rect x="20" y="13" width="4" height="4" fill="#f97316" />
      <rect x="21" y="9" width="4" height="5" fill="#f97316" />
      <rect x="22" y="6" width="3" height="4" fill="#f8fafc" />
      <rect x="23" y="5" width="2" height="2" fill="#f8fafc" />
    </svg>
  );

  const renderSlime = () => (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`select-none transition-transform duration-200 ${getDynamicAnimationClass()}`}
      shapeRendering="crispEdges"
      aria-label="Bloop Matrix - Cyber Jelly Slime"
    >
      {/* Slime Crown / Droplet Tip */}
      <rect x="11" y="3" width="2" height="2" fill="#0891b2" />
      <rect x="10" y="5" width="4" height="2" fill="#06b6d4" />

      {/* Upper Dome */}
      <rect x="7" y="7" width="10" height="2" fill="#0891b2" />
      <rect x="5" y="9" width="14" height="3" fill="#06b6d4" />

      {/* Main Gel Body */}
      <rect x="3" y="12" width="18" height="6" fill="#06b6d4" />
      <rect x="2" y="14" width="20" height="5" fill="#0891b2" />
      <rect x="3" y="18" width="18" height="3" fill="#0e7490" />
      <rect x="5" y="20" width="14" height="2" fill="#155e75" />

      {/* Gelatinous Shading */}
      <rect x="5" y="10" width="4" height="2" fill="#67e8f9" />
      <rect x="4" y="12" width="2" height="3" fill="#67e8f9" />

      {/* Internal Arcane Core */}
      <rect x="11" y="14" width="2" height="2" fill="#c084fc" />
      <rect x="10" y="15" width="4" height="1" fill="#a855f7" />

      {/* Kawaii Eyes */}
      {isEyesClosed ? (
        <>
          <rect x="7" y="14" width="2" height="1" fill="#082f49" />
          <rect x="15" y="14" width="2" height="1" fill="#082f49" />
        </>
      ) : (
        <>
          <rect x="7" y="13" width="2" height="3" fill="#082f49" />
          <rect x="15" y="13" width="2" height="3" fill="#082f49" />
          <rect x="7" y="13" width="1" height="1" fill="#f0fdfa" />
          <rect x="15" y="13" width="1" height="1" fill="#f0fdfa" />
        </>
      )}

      {/* Blush Cheeks */}
      <rect x="5" y="16" width="2" height="1" fill="#f472b6" opacity="0.9" />
      <rect x="17" y="16" width="2" height="1" fill="#f472b6" opacity="0.9" />

      {/* Cheerful Smile */}
      <rect x="11" y="17" width="2" height="1" fill="#082f49" />
    </svg>
  );

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      aria-label={`Interactive ${species} pet. Click to pet!`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`relative inline-flex flex-col items-center justify-center cursor-pointer select-none group transition-transform hover:scale-105 active:scale-95 focus:outline-none ${className}`}
    >
      {/* Evolution Aura Particle Emitter */}
      {evolutionStage === 'Ascended' && (
        <div className="absolute -inset-4 bg-radial from-amber-500/20 via-purple-500/10 to-transparent rounded-full animate-pulse pointer-events-none" />
      )}
      {evolutionStage === 'Awakened' && (
        <div className="absolute -inset-3 bg-radial from-indigo-500/20 via-transparent to-transparent rounded-full animate-pulse pointer-events-none" />
      )}

      {/* Sleeping Zzz Indicator */}
      {animationState === 'sleeping' && (
        <div
          className="absolute -top-3 right-3 z-20 animate-float-zzz pointer-events-none select-none font-mono font-bold text-indigo-300 text-sm tracking-wider drop-shadow-md"
          aria-hidden="true"
        >
          Zzz...
        </div>
      )}

      {/* Pet Character Sprite */}
      <div className="z-10 relative">
        {species === 'cat' && renderCat()}
        {species === 'dragon' && renderDragon()}
        {species === 'fox' && renderFox()}
        {species === 'slime' && renderSlime()}
      </div>

      {/* Pixelated Ground Shadow */}
      {showShadow && (
        <div
          className="mt-1 h-3 rounded-full bg-black/50 transition-all group-hover:scale-110"
          style={{
            width: size * 0.65,
            boxShadow: '0 0 12px rgba(0,0,0,0.8)',
          }}
        />
      )}
    </div>
  );
};
