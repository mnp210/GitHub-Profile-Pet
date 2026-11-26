'use client';

import React, { useEffect, useState } from 'react';
import type { PersonalityType } from '@/types/pet';
import { getBondingPersonalityDialogue } from '@/features/bonding/bondingCatalog';

export interface BondNotification {
  id: string;
  type: 'milestone' | 'activity' | 'challenge';
  title: string;
  message: string;
  icon: string;
  points: number;
}

interface BondMilestoneToastProps {
  notifications: BondNotification[];
  onDismiss: (id: string) => void;
  personality: PersonalityType;
}

export const BondMilestoneToast: React.FC<BondMilestoneToastProps> = ({
  notifications,
  onDismiss,
  personality,
}) => {
  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
      aria-label="Bonding milestones and activity notifications"
    >
      {notifications.map((notif) => (
        <ToastItem
          key={notif.id}
          notification={notif}
          onDismiss={onDismiss}
          personality={personality}
        />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{
  notification: BondNotification;
  onDismiss: (id: string) => void;
  personality: PersonalityType;
}> = ({ notification, onDismiss, personality }) => {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsClosing(true);
      setTimeout(() => onDismiss(notification.id), 250);
    }, 4500);

    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  const handleManualDismiss = () => {
    setIsClosing(true);
    setTimeout(() => onDismiss(notification.id), 250);
  };

  const quote = getBondingPersonalityDialogue(
    personality,
    notification.type === 'milestone' ? 'milestone' : notification.type === 'challenge' ? 'challenge_complete' : 'daily_complete',
    notification.title
  );

  return (
    <div
      className={`pointer-events-auto bg-slate-900/95 border ${
        notification.type === 'milestone'
          ? 'border-amber-400/80 shadow-[0_0_20px_rgba(251,191,36,0.3)]'
          : notification.type === 'challenge'
          ? 'border-indigo-400/80 shadow-[0_0_15px_rgba(129,140,248,0.25)]'
          : 'border-purple-500/80 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
      } rounded-xl p-3.5 backdrop-blur-md transition-all duration-200 transform ${
        isClosing ? 'opacity-0 translate-y-2 scale-95' : 'opacity-100 translate-y-0 scale-100'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="text-2xl select-none p-2 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center">
          {notification.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                notification.type === 'milestone'
                  ? 'text-amber-400'
                  : notification.type === 'challenge'
                  ? 'text-indigo-400'
                  : 'text-purple-400'
              }`}
            >
              {notification.type === 'milestone' ? 'Bond Milestone' : notification.type === 'challenge' ? 'Challenge Completed' : 'Daily Activity Done'}
            </span>
            <span className="text-xs font-mono text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-500/30">
              +{notification.points} Bond Pts
            </span>
          </div>
          <h4 className="text-sm font-bold text-white truncate mt-0.5">{notification.title}</h4>
          <p className="text-xs text-slate-300 mt-0.5 line-clamp-2">{notification.message}</p>
          <p className="text-[11px] italic text-purple-200/80 mt-1.5 border-t border-slate-800/80 pt-1 line-clamp-2">
            &quot;{quote}&quot;
          </p>
        </div>
        <button
          onClick={handleManualDismiss}
          className="text-slate-400 hover:text-white transition-colors p-1 -mr-1 -mt-1 rounded focus:outline-none focus:ring-1 focus:ring-purple-400"
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
