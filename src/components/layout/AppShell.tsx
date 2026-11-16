'use client';

import React, { useState } from 'react';
import { DashboardTab } from '@/types/navigation';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { UserAccountState } from '@/types/auth';

interface AppShellProps {
  children: (props: {
    currentTab: DashboardTab;
    setCurrentTab: (tab: DashboardTab) => void;
    account: UserAccountState;
    setAccount: React.Dispatch<React.SetStateAction<UserAccountState>>;
  }) => React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const [currentTab, setCurrentTab] = useState<DashboardTab>('overview');
  const [isOpenMobile, setIsOpenMobile] = useState<boolean>(false);
  
  // Typed User Account State (starts in 'demo' mode with simulated trainer profile)
  const [account, setAccount] = useState<UserAccountState>({
    status: 'demo',
    profile: {
      username: 'octocat-trainer',
      displayName: 'The Octocat Trainer',
      profileUrl: 'https://github.com/octocat',
    },
    lastSyncedAt: '2026-11-15T00:00:00.000Z',
  });

  const handleToggleConnection = () => {
    setAccount((prev) => {
      if (prev.status !== 'disconnected') {
        return {
          status: 'disconnected',
        };
      }
      return {
        status: 'demo',
        profile: {
          username: 'octocat-trainer',
          displayName: 'The Octocat Trainer',
          profileUrl: 'https://github.com/octocat',
        },
        lastSyncedAt: new Date().toISOString(),
      };
    });
  };

  return (
    <div className="min-h-screen bg-[#0c0e12] text-slate-100 flex flex-col lg:flex-row antialiased w-full max-w-full overflow-x-clip">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        isOpenMobile={isOpenMobile}
        onCloseMobile={() => setIsOpenMobile(false)}
        account={account}
        onToggleConnection={handleToggleConnection}
      />

      {/* Main App Canvas */}
      <div className="flex-1 flex flex-col min-w-0 w-full max-w-full overflow-x-clip">
        <Topbar
          onOpenMobileSidebar={() => setIsOpenMobile((prev) => !prev)}
          isOpenMobile={isOpenMobile}
          account={account}
          onToggleConnection={handleToggleConnection}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1140px] w-full mx-auto space-y-6 min-w-0">
          {children({
            currentTab,
            setCurrentTab,
            account,
            setAccount,
          })}
        </main>
      </div>
    </div>
  );
};
