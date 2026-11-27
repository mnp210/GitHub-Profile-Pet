import React from 'react';

export interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  sublabel?: string;
  variant?: 'purple' | 'green' | 'amber' | 'cyan' | 'indigo';
  size?: 'sm' | 'md' | 'lg';
  showPercentage?: boolean;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max,
  label,
  sublabel,
  variant = 'indigo',
  size = 'md',
  showPercentage = true,
  className = '',
}) => {
  const percentage = Math.min(100, Math.max(0, Math.round((value / max) * 100)));

  const getFillColor = () => {
    switch (variant) {
      case 'green':
        return 'bg-emerald-500';
      case 'amber':
        return 'bg-amber-500';
      case 'cyan':
        return 'bg-cyan-500';
      case 'purple':
      case 'indigo':
        return 'pet-themed-xp-fill';
      default:
        return 'pet-themed-xp-fill';
    }
  };

  const getHeight = () => {
    switch (size) {
      case 'sm':
        return 'h-1.5';
      case 'lg':
        return 'h-3';
      default:
        return 'h-2';
    }
  };

  return (
    <div className={`w-full ${className}`}>
      {(label || showPercentage || sublabel) && (
        <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
          <div className="flex items-center gap-1.5 font-medium text-slate-300">
            {label && <span>{label}</span>}
            {sublabel && <span className="text-[10px] text-slate-500 font-normal">({sublabel})</span>}
          </div>
          <div className="text-right text-slate-400 text-xs font-mono">
            <span className="text-slate-200 font-medium">{value}</span>
            <span className="text-slate-500">/{max}</span>
            {showPercentage && <span className="ml-1 text-slate-500">({percentage}%)</span>}
          </div>
        </div>
      )}

      {/* Progress Track */}
      <div className={`w-full bg-[#181c24] border border-[#222733] rounded-full overflow-hidden ${getHeight()}`}>
        <div
          className={`h-full transition-all duration-300 rounded-full ${getFillColor()}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
