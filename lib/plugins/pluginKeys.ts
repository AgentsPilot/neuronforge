/**
 * Canonical plugin keys.
 *
 * A plugin's key is the string that ties together its definition filename
 * (`lib/plugins/definitions/{key}-plugin-v2.json`), its entry in
 * `plugin-manager-v2.ts` / `plugin-executer-v2.ts`, its OAuth callback path
 * (`/oauth/callback/{key}`), and the `plugin_connections.plugin_key` column.
 *
 * These were previously written as string literals at each call site, which
 * drifted: `app/api/business-os/setup-status/route.ts` queried for
 * `'google_calendar'` and `'outlook_calendar'` (underscores) when the real keys
 * are `google-calendar` and `outlook`, so its calendar check silently matched
 * nothing and every user appeared to have no calendar connected.
 *
 * Import from here rather than typing the string.
 */

export const PLUGIN_KEYS = {
  // Google
  GOOGLE_MAIL: 'google-mail',
  GOOGLE_CALENDAR: 'google-calendar',
  GOOGLE_DRIVE: 'google-drive',
  GOOGLE_DOCS: 'google-docs',
  GOOGLE_SHEETS: 'google-sheets',

  // Microsoft
  OUTLOOK: 'outlook',
  ONEDRIVE: 'onedrive',

  // Communication
  SLACK: 'slack',
  DISCORD: 'discord',
  WHATSAPP_BUSINESS: 'whatsapp-business',
  LINKEDIN: 'linkedin',

  // CRM
  HUBSPOT: 'hubspot',
  SALESFORCE: 'salesforce',

  // Productivity
  NOTION: 'notion',
  AIRTABLE: 'airtable',
  DROPBOX: 'dropbox',

  // Finance
  STRIPE: 'stripe',

  // Marketing
  META_ADS: 'meta-ads',

  // Platform-key plugins (no OAuth)
  CHATGPT_RESEARCH: 'chatgpt-research',
  DOCUMENT_EXTRACTOR: 'document-extractor',
} as const;

export type PluginKey = (typeof PLUGIN_KEYS)[keyof typeof PLUGIN_KEYS];

/**
 * Plugins that can act as the user's calendar. Used to decide whether a user
 * has calendar sync available.
 */
export const CALENDAR_PLUGIN_KEYS: PluginKey[] = [
  PLUGIN_KEYS.GOOGLE_CALENDAR,
  PLUGIN_KEYS.OUTLOOK,
];
