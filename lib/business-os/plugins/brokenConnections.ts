/**
 * Dead plugin connections this business actually depends on, server-side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE IS A SERVER COPY OF A QUESTION THE DASHBOARD ALREADY ANSWERS
 *
 * The readiness line answers it in the browser, from the plugin status already
 * in `useAuth()` and the setup items already on the page. That works for a
 * screen somebody is looking at.
 *
 * The morning briefing is not that. It is built by a cron with no browser, no
 * React context and no logged-in session, and it is the only surface that
 * reaches an owner who is NOT looking at the dashboard — which is the whole
 * point of putting a connection fault in it. An owner whose Gmail grant lapsed
 * on Friday evening finds out on Monday from the readiness line; the email
 * tells them on Saturday morning.
 *
 * The SCOPING is not duplicated. Both callers decide what counts through
 * `connectionsInUse`, which is the one table of which component needs which
 * plugin. Only the gathering of facts differs, because the two run in places
 * that hold different things.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NEVER THROWS
 *
 * It is read inside `buildBriefingFacts`, where every read degrades on its own
 * so that one failure cannot cost the whole briefing. A connection check that
 * threw would silence the morning email for every business on the platform, to
 * report a fault that might affect none of them.
 *
 * @module lib/business-os/plugins/brokenConnections
 */

import { createLogger } from '@/lib/logger';
import { connectionsInUse } from './connectionsInUse';

const logger = createLogger({ module: 'BrokenConnections' });

/** One dead connection, named for an owner. */
export interface BrokenConnection {
  /** The plugin key. */
  key: string;
  /** `getFriendlyPluginName`, so "Gmail" and never "google-mail". */
  name: string;
}

/**
 * The connections worth telling this owner about, or an empty array.
 *
 * Empty on any failure. See the module note: silence here costs one line of a
 * briefing, and throwing would cost every briefing.
 */
export async function brokenConnections(userId: string): Promise<BrokenConnection[]> {
  try {
    /*
     * Imported inside the function, not at module scope.
     *
     * `PluginManagerV2` reads the plugin definitions and the environment at
     * import time, and a module-scope import of it has taken out a deploy
     * before — `lib/pilot` throws without `SUPABASE_URL`, which is why the
     * scheduled-agents cron imports its runner lazily too. This module is
     * imported by the briefing, which is imported by a cron route.
     */
    const [
      { PluginManagerV2 },
      { inboxChannelStatus },
      { businessProfileRepository },
      { getFriendlyPluginName },
    ] = await Promise.all([
      import('@/lib/server/plugin-manager-v2'),
      import('@/lib/business-os/leads/inboxChannel'),
      import('@/lib/repositories/BusinessProfileRepository'),
      import('@/lib/pilot/shadow/friendlyLanguage'),
    ]);

    const pluginManager = await PluginManagerV2.getInstance();
    const expired = await pluginManager.getActiveExpiredPluginKeys(userId);

    /* Nothing lapsed: stop before asking what is configured. The common case,
       and it costs two queries to answer it the other way round. */
    if (!expired.length) return [];

    const [inbox, profile] = await Promise.all([
      inboxChannelStatus(userId),
      businessProfileRepository.findByUserId(userId),
    ]);

    const inUse = connectionsInUse({
      /* The mailboxes with a lead channel actually on them, so a Gmail
         business is never told to reconnect Outlook. */
      mailProviders: inbox.channels.map(channel => channel.provider),
      /* The owner's switch, not merely a connected calendar: somebody who
         connected Google and turned sync off is not depending on it. */
      calendar: Boolean(profile.data?.calendar_sync_enabled),
      /*
       * These three serve exactly one Business OS component each — channel
       * insights — and in this deployment's plugin profile they exist for no
       * other reason. So a LAPSED grant for one is itself the evidence the
       * owner connected it for that, and there is nothing further to ask.
       *
       * Said explicitly rather than left to a default, because reading it as
       * "always in use" is right here and would be wrong for the mailbox and
       * the calendar, which both have a switch of their own.
       */
      meta: true,
      listing: true,
      analytics: true,
    });

    /*
     * Named by `getFriendlyPluginName` and not by the plugin manager: no
     * definition file sets `displayName` or `label`, so the manager's answer is
     * the raw key for every plugin we ship. See the note on the status route.
     */
    return expired
      .filter(key => inUse.has(key))
      .map(key => ({ key, name: getFriendlyPluginName(key) }));
  } catch (err) {
    logger.warn(
      { err, userId },
      'Could not check plugin connections; the briefing will not mention them'
    );
    return [];
  }
}
