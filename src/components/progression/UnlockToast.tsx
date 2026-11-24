'use client';

import React, { useEffect } from 'react';

export interface UnlockToastData {
  id: string;
  type: 'achievement' | 'cosmetic';
  title: string;
  subtitle: string;
  icon: string;
}

interface UnlockToastProps {
  toast: UnlockToastData | null;
  onDismiss: () => void;
}

export const UnlockToast: React.FC<UnlockToastProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, 4500);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 p-3.5 rounded-xl bg-[#0f172a] border-2 border-amber-500/80 text-slate-100 shadow-2xl shadow-amber-950/50 animate-bounce max-w-sm font-mono select-none"
    >
      <div className="text-3xl p-2 rounded-lg bg-amber-950/60 border border-amber-600/60 flex items-center justify-center">
        {toast.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
          <span>🎉</span>
          <span>{toast.type === 'achievement' ? 'Achievement Unlocked!' : 'Cosmetic Unlocked!'}</span>
        </div>
        <div className="text-xs font-bold text-slate-100 truncate mt-0.5">{toast.title}</div>
        <div className="text-[10px] text-slate-400 truncate">{toast.subtitle}</div>
      </div>

      <button
        onClick={onDismiss}
        className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-slate-800 text-xs"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
};
