import React from 'react';

export interface PixelButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'accent' | 'green' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

export const PixelButton: React.FC<PixelButtonProps> = ({
  children,
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return 'px-2.5 py-1.5 text-xs gap-1.5 rounded-md';
      case 'lg':
        return 'px-4 py-2.5 text-sm font-medium gap-2 rounded-md';
      default:
        return 'px-3 py-2 text-xs md:text-sm font-medium gap-2 rounded-md';
    }
  };

  const getVariantStyles = () => {
    if (disabled) {
      return 'bg-[#181c24] text-slate-600 border border-[#222733] cursor-not-allowed opacity-60';
    }

    switch (variant) {
      case 'primary':
        return 'bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/80 shadow-xs cursor-pointer active:bg-indigo-700';
      case 'danger':
        return 'bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/60 cursor-pointer';
      case 'ghost':
        return 'bg-transparent hover:bg-[#181c24] text-slate-300 border border-transparent hover:border-[#222733] cursor-pointer';
      default:
        return 'bg-[#181c24] hover:bg-[#1f242e] text-slate-200 border border-[#2d3342] hover:border-[#3f475a] shadow-xs cursor-pointer active:bg-[#272c38]';
    }
  };

  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium transition-all duration-150 select-none ${getSizeStyles()} ${getVariantStyles()} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...props}
    >
      {icon && <span className="inline-flex shrink-0">{icon}</span>}
      <span>{children}</span>
    </button>
  );
};
