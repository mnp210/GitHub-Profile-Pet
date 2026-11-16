'use client';

import React from 'react';
import { DashboardTab, NavItem } from '@/types/navigation';
import { PawIcon, FlameIcon, TrophyIcon, ActivityIcon, SettingsIcon, GitHubIcon, CloseIcon } from '@/components/ui/PixelIcons';
import { UserAccountState } from '@/types/auth';

interface SidebarProps {
  currentTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  account: UserAccountState;
  onToggleConnection: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onTabChange,
  isOpenMobile,
  onCloseMobile,
  account,
  onToggleConnection,
}) => {
  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
    { id: 'pets', label: 'My Pets', icon: 'paw-print', badge: '4' },
    { id: 'activity', label: 'Activity', icon: 'activity' },
    { id: 'achievements', label: 'Achievements', icon: 'award' },
    { id: 'settings', label: 'Settings', icon: 'settings' },
  ];

  const getNavIcon = (iconName: string) => {
    switch (iconName) {
      case 'paw-print':
        return <PawIcon size={16} aria-hidden={true} />;
      case 'activity':
        return <FlameIcon size={16} aria-hidden={true} />;
      case 'award':
        return <TrophyIcon size={16} aria-hidden={true} />;
      case 'settings':
        return <SettingsIcon size={16} aria-hidden={true} />;
      default:
        return <ActivityIcon size={16} aria-hidden={true} />;
    }
  };

  const isConnected = account.status !== 'disconnected';

  const getAccountLabel = () => {
    if (account.status === 'authenticated') {
      return `@${account.profile?.username || 'user'}`;
    }
    if (account.status === 'demo') {
      return `${account.profile?.username || 'octocat-trainer'}`;
    }
    return 'Guest';
  };

  return (
    <>
      {/* Mobile/Tablet Backdrop Overlay */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden backdrop-blur-xs transition-opacity duration-200"
        />
      )}

      {/* Main Sidebar Shell */}
      <aside
        id="sidebar-navigation"
        aria-label="Main application navigation"
        className={`fixed lg:sticky top-0 left-0 z-50 h-screen w-60 shrink-0 bg-[#12151b] border-r border-[#222733] flex flex-col justify-between transition-transform duration-200 ease-in-out ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Branding Section */}
        <div>
          <div className="p-4 border-b border-[#222733] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-md bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400" aria-hidden="true">
                <PawIcon size={15} />
              </div>
              <div>
                <h1 className="text-xs font-semibold text-slate-100 tracking-tight">
                  Profile Pet
                </h1>
                <span className="text-[10px] text-slate-500 font-normal">
                  Companion Platform
                </span>
              </div>
            </div>

            {/* Mobile close button */}
            <button
              type="button"
              onClick={onCloseMobile}
              className="p-1 lg:hidden text-slate-400 hover:text-white rounded focus-visible:ring-1 focus-visible:ring-indigo-400"
              aria-label="Close navigation sidebar"
            >
              <CloseIcon size={16} aria-hidden={true} />
            </button>
          </div>

          {/* Navigation Links List */}
          <nav className="p-3 space-y-1">
            {navItems.map((item) => {
              const isActive = currentTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onTabChange(item.id);
                    onCloseMobile();
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors cursor-pointer text-left ${
                    isActive
                      ? 'bg-[#1f242e] text-slate-100 font-semibold border border-[#2d3342]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#181c24]'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={isActive ? 'text-indigo-400' : 'text-slate-500'}>
                      {getNavIcon(item.icon)}
                    </span>
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span
                      className={`px-1.5 py-0.2 text-[9px] font-medium rounded ${
                        isActive
                          ? 'bg-indigo-950/60 text-indigo-300 border border-indigo-800/60'
                          : 'bg-[#181c24] text-slate-500'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Account & Connection Card */}
        <div className="p-3 border-t border-[#222733]">
          <div className="p-3 rounded-lg bg-[#181c24] border border-[#222733] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-medium text-slate-400 tracking-wider">
                GitHub Account
              </span>
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isConnected ? 'bg-emerald-500' : 'bg-slate-500'
                }`}
                title={isConnected ? 'Connected' : 'Disconnected'}
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded bg-[#222733] flex items-center justify-center text-slate-300">
                <GitHubIcon size={14} aria-hidden={true} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-slate-200 truncate font-mono">
                  {getAccountLabel()}
                </div>
                <div className="text-[9px] text-slate-500 truncate">
                  {isConnected ? 'Demo Simulated' : 'Not Connected'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleConnection}
              className="w-full mt-1 px-2.5 py-1.5 rounded text-[11px] font-medium bg-[#1f242e] hover:bg-[#272c38] text-slate-300 border border-[#2d3342] transition-colors cursor-pointer text-center"
            >
              {isConnected ? 'Disconnect' : 'Connect Demo'}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
