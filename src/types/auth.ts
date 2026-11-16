export type AuthStatus = 'disconnected' | 'demo' | 'authenticated';

export interface GitHubUserProfile {
  username: string;
  displayName?: string;
  avatarUrl?: string;
  profileUrl?: string;
  bio?: string;
  publicRepos?: number;
  followers?: number;
}

export interface UserAccountState {
  status: AuthStatus;
  profile?: GitHubUserProfile;
  lastSyncedAt?: string;
}

export interface AccountGreeting {
  heading: string;
  subheading: string;
  badgeText?: string;
  badgeVariant?: 'purple' | 'green' | 'amber';
  isDemo: boolean;
  isConnected: boolean;
  usernameDisplay: string;
}

export function getAccountGreeting(account: UserAccountState): AccountGreeting {
  if (account.status === 'authenticated' && account.profile?.username) {
    const rawUsername = account.profile.username.replace(/^@/, '');
    return {
      heading: `WELCOME BACK, @${rawUsername.toUpperCase()}!`,
      subheading: 'Pet companion synchronized with live GitHub activity',
      badgeText: 'CONNECTED',
      badgeVariant: 'green',
      isDemo: false,
      isConnected: true,
      usernameDisplay: `@${rawUsername}`,
    };
  }

  if (account.status === 'demo') {
    const demoUsername = account.profile?.username || 'octocat-trainer';
    return {
      heading: `WELCOME BACK, ${demoUsername.toUpperCase()}!`,
      subheading: 'Pet companion synchronized with simulated GitHub telemetry',
      badgeText: 'DEMO MODE',
      badgeVariant: 'purple',
      isDemo: true,
      isConnected: true,
      usernameDisplay: demoUsername,
    };
  }

  // Disconnected state
  return {
    heading: 'WELCOME, TRAINER!',
    subheading: 'Connect your GitHub profile to awaken and power your pet',
    badgeText: 'DISCONNECTED',
    badgeVariant: 'amber',
    isDemo: false,
    isConnected: false,
    usernameDisplay: 'Guest Trainer',
  };
}
