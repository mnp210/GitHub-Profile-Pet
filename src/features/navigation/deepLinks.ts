import type { ActionType } from '../gamification/rewards';

export type DeepLinkScreen =
  | 'care'
  | 'playzone'
  | 'wardrobe'
  | 'bond'
  | 'achievements'
  | 'stats';

export interface ResolvedAppRoute {
  screen: DeepLinkScreen;
  pendingCareAction: ActionType | null;
  repo: string | null;
  isExplicitAction: boolean;
}

const CARE_CONFIRMATION_ACTIONS = new Set<ActionType>([
  'feed',
  'play',
  'train',
  'rest',
  'pet',
]);

const SCREEN_ACTION_ALIASES: Record<string, DeepLinkScreen> = {
  care: 'care',
  playzone: 'playzone',
  'play-zone': 'playzone',
  wardrobe: 'wardrobe',
  bond: 'bond',
  achievements: 'achievements',
  stats: 'stats',
  profile: 'stats',
};

/**
 * Parses URL search parameters into a deterministic application route state.
 * Preserves backwards compatibility for ?action=feed|play|train|rest|pet
 * and safely falls back to the 'care' homepage for unknown actions.
 */
export function resolveRouteFromSearch(search: string): ResolvedAppRoute {
  const params = new URLSearchParams(search);
  const rawRepo = params.get('repo')?.trim() || null;
  const rawAction = params.get('action')?.toLowerCase().trim() || '';

  if (rawAction && CARE_CONFIRMATION_ACTIONS.has(rawAction as ActionType)) {
    return {
      screen: 'care',
      pendingCareAction: rawAction as ActionType,
      repo: rawRepo,
      isExplicitAction: true,
    };
  }

  const mappedScreen = rawAction ? SCREEN_ACTION_ALIASES[rawAction] : undefined;
  if (mappedScreen) {
    return {
      screen: mappedScreen,
      pendingCareAction: null,
      repo: rawRepo,
      isExplicitAction: true,
    };
  }

  return {
    screen: 'care',
    pendingCareAction: null,
    repo: rawRepo,
    isExplicitAction: false,
  };
}

/**
 * Builds an updated URL preserving existing query params (such as `repo`)
 * while setting or clearing the `action` parameter for history navigation.
 */
export function buildDeepLinkUrl(
  currentHref: string,
  screen: DeepLinkScreen | null,
  fallbackRepo?: string
): string {
  const url = new URL(currentHref);
  if (!url.searchParams.get('repo') && fallbackRepo && fallbackRepo.trim()) {
    url.searchParams.set('repo', fallbackRepo.trim());
  }

  if (screen) {
    url.searchParams.set('action', screen);
  } else {
    url.searchParams.delete('action');
  }

  return url.toString();
}
