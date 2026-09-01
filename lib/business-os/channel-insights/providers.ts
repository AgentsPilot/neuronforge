/**
 * How each connectable provider is discovered and recorded.
 *
 * Kept as data rather than branches so adding a provider is one entry here plus
 * a plugin, and every surface — the connect route, the readiness chips, the
 * settings list — stays in step automatically.
 */

import type { ChannelPlatform } from '@/lib/repositories/ChannelConnectionRepository';

export type ChannelProvider = 'meta' | 'google_analytics' | 'google_business_profile';

export interface DiscoveredAccount {
  id: string;
  name: string;
  picture_url?: string | null;
  /** Secondary line in a chooser, e.g. an address or the owning GA4 account. */
  detail?: string | null;
  /** Meta only: the linked Instagram Business account, connected alongside. */
  secondary?: { platform: ChannelPlatform; id: string; name: string | null } | null;
  /** Meta only: the Page-scoped token needed for that Page's insights. */
  token?: string | null;
}

export interface ProviderConfig {
  provider: ChannelProvider;
  pluginKey: string;
  /** Primary platform recorded in channel_connections. */
  platform: ChannelPlatform;
  /** Read-only action that lists what the user can analyse. */
  listAction: string;
  /** Key holding the array in that action's result. */
  listField: string;
  /** Turns one raw entry into the shape every surface consumes. */
  toAccount: (raw: any) => DiscoveredAccount;
}

export const CHANNEL_PROVIDERS: Record<ChannelProvider, ProviderConfig> = {
  meta: {
    provider: 'meta',
    pluginKey: 'meta-insights',
    platform: 'facebook_page',
    listAction: 'list_pages',
    listField: 'pages',
    toAccount: (page: any): DiscoveredAccount => ({
      id: page.id,
      name: page.name,
      picture_url: page.picture_url ?? null,
      detail: page.category ?? null,
      // Instagram hangs off the Page, so connecting the Page connects both.
      // The user never performs a second connect.
      secondary: page.instagram_account_id
        ? {
            platform: 'instagram',
            id: page.instagram_account_id,
            name: page.instagram_username ?? null,
          }
        : null,
      token: page.access_token ?? null,
    }),
  },

  google_analytics: {
    provider: 'google_analytics',
    pluginKey: 'google-analytics',
    platform: 'ga4',
    listAction: 'list_properties',
    listField: 'properties',
    toAccount: (property: any): DiscoveredAccount => ({
      id: property.id,
      name: property.display_name || property.id,
      detail: property.account_name ?? null,
      secondary: null,
      token: null,
    }),
  },

  google_business_profile: {
    provider: 'google_business_profile',
    pluginKey: 'google-business-profile',
    platform: 'google_business_profile',
    listAction: 'list_locations',
    listField: 'locations',
    toAccount: (location: any): DiscoveredAccount => ({
      id: location.id,
      name: location.title || location.id,
      detail: location.address ?? null,
      secondary: null,
      token: null,
    }),
  },
};

/** Which platforms a provider writes, for the disconnect path. */
export function platformsForProvider(provider: ChannelProvider): ChannelPlatform[] {
  return provider === 'meta'
    ? ['facebook_page', 'instagram']
    : [CHANNEL_PROVIDERS[provider].platform];
}
