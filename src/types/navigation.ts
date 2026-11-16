export type DashboardTab = 'overview' | 'pets' | 'activity' | 'achievements' | 'settings';

export interface NavItem {
  id: DashboardTab;
  label: string;
  icon: 'layout-dashboard' | 'paw-print' | 'activity' | 'award' | 'settings';
  badge?: string;
}
