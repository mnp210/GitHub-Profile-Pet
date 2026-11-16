import React from 'react';
import { FlameIcon, CommitIcon, TrophyIcon, ActivityIcon } from '@/components/ui/PixelIcons';

export interface StatCardProps {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  changeDescription?: string;
  isPositive?: boolean;
  icon?: 'flame' | 'git-commit' | 'calendar' | 'trophy' | 'activity';
  variant?: 'purple' | 'green' | 'amber' | 'cyan';
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  unit,
  changeDescription,
  isPositive = true,
  icon = 'flame',
}) => {
  const renderIcon = () => {
    switch (icon) {
      case 'flame':
        return <FlameIcon size={16} className="text-amber-400" aria-hidden={true} />;
      case 'git-commit':
        return <CommitIcon size={16} className="text-emerald-400" aria-hidden={true} />;
      case 'trophy':
        return <TrophyIcon size={16} className="text-yellow-400" aria-hidden={true} />;
      default:
        return <ActivityIcon size={16} className="text-indigo-400" aria-hidden={true} />;
    }
  };

  return (
    <div className="relative p-4 rounded-lg bg-[#12151b] border border-[#222733] flex flex-col justify-between min-w-0 max-w-full">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 rounded bg-[#181c24] border border-[#222733]">
          {renderIcon()}
        </div>
        <span className="text-xs font-medium text-slate-400">
          {label}
        </span>
      </div>

      <div className="flex items-baseline gap-1.5 my-1">
        <span className="text-2xl font-bold text-slate-100 tracking-tight font-mono">
          {value}
        </span>
        {unit && (
          <span className="text-xs text-slate-500 font-medium">
            {unit}
          </span>
        )}
      </div>

      {changeDescription && (
        <div className="mt-2 pt-2 border-t border-[#222733] flex items-center justify-between text-xs">
          <span className={isPositive ? 'text-emerald-400' : 'text-slate-400'}>
            {changeDescription}
          </span>
        </div>
      )}
    </div>
  );
};
