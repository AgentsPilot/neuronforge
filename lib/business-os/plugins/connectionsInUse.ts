/**
 * Which plugin connections this business actually depends on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SCOPING IS THE WHOLE POINT
 *
 * `PluginManagerV2.getActiveExpiredPluginKeys` answers a platform question:
 * which of this user's OAuth grants have lapsed. Every grant, whatever made
 * it — the agent wizard, the plugin tester, a workflow built last year.
 *
 * Put that straight on the Business OS dashboard and an owner who uses Gmail
 * and nothing else is told to reconnect Google Sheets, Slack and Drive, none of
 * which this product has ever called on their behalf. An alert about something
 * the reader does not use is worse than silence: it teaches them that the
 * amber line is noise, and the next one — the one that is costing them leads —
 * gets skipped with the rest.
 *
 * So the card alerts on a connection only when a Business OS component that is
 * ACTUALLY SET UP depends on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO GATES, BOTH ALREADY IN THE CODEBASE
 *
 *   1. COULD this product ever need it — `PLUGIN_PROFILES.business_os` in
 *      `lib/server/plugin-profile.ts`, which is the load gate for the whole
 *      deployment and names the component beside each key. That list alone
 *      removes Sheets, Drive, Slack, HubSpot, Notion and the rest.
 *
 *   2. IS the component set up for this owner — the dashboard's own setup
 *      items and inbox-channel status, which it already holds. A calendar
 *      plugin matters once calendar sync is configured, a mailbox once a lead
 *      channel runs on it, and not before.
 *
 * Nothing here queries anything. It is a decision over facts the caller has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY ABSENT
 *
 * `stripe` is in the business_os profile and must never appear here. Its
 * profile entry says why: "Stripe Connect OAuth definition only; BOS never
 * invokes its executor." Payouts break in their own way and the payments card
 * says so; a plugin reconnect would not fix anything.
 *
 * `business-os`, `crm`, `scheduling`, `payments` are internal — our own data
 * access, with no OAuth grant to expire. "Reconnect Business OS" would tell an
 * owner to reconnect the page they are reading.
 *
 * @module lib/business-os/plugins/connectionsInUse
 */

/**
 * The components that reach outside, and the plugins each can run on.
 *
 * Several plugins per component because the owner chooses the vendor: a
 * calendar sync is Google's or Microsoft's, a mailbox channel is Gmail or
 * Outlook. Listing both against the component is what makes this a question
 * about the COMPONENT being set up rather than about a particular vendor.
 */
export const COMPONENT_CONNECTIONS = {
  /** The lead channel that reads enquiry email. */
  mail: ['google-mail', 'outlook'],
  /** `CalendarSyncService`, two-way. */
  calendar: ['google-calendar', 'outlook'],
  /** Channel insights: the Facebook Page and Instagram. */
  meta: ['meta-insights'],
  /** Channel insights: the Google Business Profile listing. */
  listing: ['google-business-profile'],
  /** Channel insights: GA4. */
  analytics: ['google-analytics'],
} as const;

export type BusinessOsComponent = keyof typeof COMPONENT_CONNECTIONS;

/** What the dashboard already knows about which components are set up. */
export interface ConfiguredComponents {
  /**
   * Mailbox providers with a lead channel actually set up.
   *
   * The providers, not a boolean, because a business can run two mailboxes and
   * only one of them need reconnecting. From `inboxChannelStatus().channels`.
   */
  mailProviders?: readonly string[];
  /** Calendar sync configured. From the `calendar` setup item. */
  calendar?: boolean;
  /** From the `meta_insights` setup item. */
  meta?: boolean;
  /** From the `google_business` setup item. */
  listing?: boolean;
  /** GA4 connected. No setup item offers it any more, so normally false. */
  analytics?: boolean;
}

/**
 * The plugin keys worth alerting this owner about.
 *
 * A mailbox is named by its own provider rather than by the component, so a
 * business running Gmail is never told to reconnect Outlook. Everything else
 * resolves to its component's plugins, because the owner chose that vendor
 * when they configured it and only the connected one can expire.
 */
export function connectionsInUse(configured: ConfiguredComponents): Set<string> {
  const inUse = new Set<string>();

  /* Exactly the mailboxes with a channel on them. */
  for (const provider of configured.mailProviders ?? []) {
    if ((COMPONENT_CONNECTIONS.mail as readonly string[]).includes(provider)) {
      inUse.add(provider);
    }
  }

  const add = (component: BusinessOsComponent) => {
    for (const plugin of COMPONENT_CONNECTIONS[component]) inUse.add(plugin);
  };

  if (configured.calendar) add('calendar');
  if (configured.meta) add('meta');
  if (configured.listing) add('listing');
  if (configured.analytics) add('analytics');

  return inUse;
}
