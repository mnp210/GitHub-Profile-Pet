import React from 'react';

export interface PixelPanelProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: 'purple' | 'green' | 'amber' | 'cyan' | 'slate';
  variant?: 'default' | 'primary' | 'accent' | 'green';
  className?: string;
  headerAction?: React.ReactNode;
}

export const PixelPanel: React.FC<PixelPanelProps> = ({
  children,
  title,
  subtitle,
  badge,
  badgeColor = 'slate',
  className = '',
  headerAction,
}) => {
  const getBadgeStyle = () => {
    switch (badgeColor) {
      case 'green':
        return 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60';
      case 'amber':
        return 'bg-amber-950/60 text-amber-400 border-amber-800/60';
      case 'cyan':
        return 'bg-cyan-950/60 text-cyan-400 border-cyan-800/60';
      case 'purple':
        return 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60';
      default:
        return 'bg-[#181c24] text-slate-400 border-[#2d3342]';
    }
  };

  return (
    <section className={`relative w-full max-w-full min-w-0 p-4 md:p-5 rounded-lg bg-[#12151b] border border-[#222733] shadow-xs ${className}`}>
      {(title || badge || headerAction) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#222733] pb-3">
          <div className="flex items-center gap-2.5">
            {title && (
              <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                {title}
              </h3>
            )}
            {subtitle && (
              <span className="text-xs text-slate-500 font-normal">
                {subtitle}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {badge && (
              <span className={`px-2 py-0.5 text-[10px] font-medium tracking-wide rounded border ${getBadgeStyle()}`}>
                {badge}
              </span>
            )}
            {headerAction}
          </div>
        </div>
      )}

      {children}
    </section>
  );
};
