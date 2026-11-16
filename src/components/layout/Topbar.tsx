'use client';

import React from 'react';
import { MenuIcon, GitHubIcon, FlameIcon } from '@/components/ui/PixelIcons';
import { PixelButton } from '@/components/ui/PixelButton';
import { UserAccountState, getAccountGreeting } from '@/types/auth';

interface TopbarProps {
  onOpenMobileSidebar: () => void;
  isOpenMobile: boolean;
  account: UserAccountState;
  onToggleConnection: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({
  onOpenMobileSidebar,
  isOpenMobile,
  account,
  onToggleConnection,
}) => {
  const greeting = getAccountGreeting(account);

  const getBadgeStyle = () => {
    switch (greeting.badgeVariant) {
      case 'green':
        return 'bg-emerald-950/60 text-emerald-400 border-emerald-800/60';
      case 'amber':
        return 'bg-amber-950/60 text-amber-400 border-amber-800/60';
      default:
        return 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60';
    }
  };

  return (
    <header className="sticky top-0 z-30 w-full h-14 bg-[#0c0e12]/90 backdrop-blur-md border-b border-[#222733] px-4 md:px-6 flex items-center justify-between max-w-full min-w-0">
      {/* Left: Hamburger menu (mobile) + Dynamic Greeting */}
      <div className="flex items-center gap-3 min-w-0 shrink overflow-hidden mr-2">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          aria-expanded={isOpenMobile}
          aria-controls="sidebar-navigation"
          aria-label={isOpenMobile ? 'Close navigation sidebar' : 'Open navigation sidebar'}
          className="p-1.5 lg:hidden bg-[#181c24] border border-[#2d3342] text-slate-300 hover:text-white rounded-md shrink-0 cursor-pointer"
        >
          <MenuIcon size={16} aria-hidden={true} />
        </button>

        <div className="min-w-0 truncate">
          <div className="flex items-center gap-2 truncate">
            <h2 className="text-xs sm:text-sm font-semibold text-slate-100 truncate">
              {greeting.heading}
            </h2>
            {greeting.badgeText && (
              <span className={`hidden sm:inline-block px-1.5 py-0.2 text-[9px] font-medium rounded border shrink-0 ${getBadgeStyle()}`}>
                {greeting.badgeText}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 hidden md:block truncate">
            {greeting.subheading}
          </p>
        </div>
      </div>

      {/* Right: Streak status pill & Action */}
      <div className="flex items-center gap-2 shrink-0">
        {greeting.isConnected && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-[#181c24] border border-[#2d3342] rounded-md text-xs shrink-0">
            <FlameIcon size={13} className="text-amber-400" aria-hidden={true} />
            <span className="text-slate-300 text-[11px] font-medium">14-day streak</span>
          </div>
        )}

        {/* GitHub Connection Toggle */}
        <PixelButton
          size="sm"
          variant={greeting.isConnected ? 'ghost' : 'primary'}
          onClick={onToggleConnection}
          icon={<GitHubIcon size={14} aria-hidden={true} />}
          className="text-xs"
        >
          {greeting.isConnected ? 'Disconnect' : 'Connect GitHub'}
        </PixelButton>
      </div>
    </header>
  );
};
