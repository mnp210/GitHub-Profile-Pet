export interface ActivityMetric {
  id: string;
  label: string;
  value: string;
  unit?: string;
  changeDescription: string;
  isPositive: boolean;
  icon: 'flame' | 'git-commit' | 'calendar' | 'trophy' | 'activity';
}

export interface ContributionDay {
  date: string;
  dayOfWeek: number; // 0-6 (Sun-Sat)
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

export interface ActivitySummaryData {
  commitStreak: number;
  contributionStreak: number;
  totalContributions: number;
  longestStreak: number;
  pullRequests: number;
  issuesClosed: number;
  codeReviews: number;
}
