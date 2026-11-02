'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/components/UserProvider';
import { getPluginAPIClient } from '@/lib/client/plugin-api-client';
import { clientLogger } from '@/lib/logger/client';

/**
 * Connections that have died, and the one sequence that repairs them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING HERE IS NEW. IT IS THE EXISTING SEQUENCE, IN ONE PLACE.
 *
 * The platform already answers every part of this:
 *
 *   which are dead   `useAuth().connectedPlugins` — entries carry
 *                    `is_expired: true`, from `/api/plugins/user-status` →
 *                    `PluginManagerV2.getActiveExpiredPluginKeys`. Fetched
 *                    once per session, deduplicated, app-wide.
 *   silent refresh   `POST /api/plugins/refresh-token { pluginKeys }`
 *   full reconnect   `pluginAPIClient.connectPlugin(userId, key)`, which owns
 *                    the auth-config fetch, the popup-block test, the OAuth
 *                    handler and the additional-config step
 *   tell everyone    `refreshPlugins()` from the same context
 *
 * And the ESCALATION between the middle two is the part worth having written
 * down: a silent refresh first, and a full OAuth round trip only when the
 * refresh token is itself dead. `CalendarSyncSettings` does exactly this and
 * proves it works; `components/v2/Footer.tsx` drives the same client for its
 * own reconnect prompt.
 *
 * This is a hook for the reason `useChannelConnect` gives in its own header:
 * more than one surface offers connecting, and the logic must exist once, or
 * the second copy drifts the moment one is fixed. The dashboard's readiness
 * line is that second surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY EXPIRY AND NOT A FAILED AGENT
 *
 * An expired token is the CAUSE. An agent that has stopped is the consequence,
 * five failed runs and a dead-letter later, and by then the owner has lost
 * whatever the agent was doing for a day. This fires as soon as the connection
 * lapses, before anything has gone wrong.
 *
 * It does not replace the agents list: a grant that was REVOKED rather than
 * expired still reports a future `expires_at`, so only a failed run reveals
 * it. The two signals cover each other and neither is sufficient alone.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module hooks/usePluginRepair
 */

/** One dead connection, named. */
export interface BrokenConnection {
  /** The plugin key, for the repair call. */
  key: string;
  /**
   * What to call it on screen.
   *
   * `PluginManagerV2.getPluginDisplayName` via the status route, so "Gmail"
   * rather than "google-mail". Falls back to the key, never empty.
   */
  name: string;
}

export interface PluginRepair {
  /**
   * EVERY lapsed grant this user holds, platform-wide. Stable across renders.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * NOT THE ALERT LIST. SCOPE IT BEFORE SHOWING IT.
   *
   * This is the platform's answer, so it includes grants made anywhere — the
   * agent wizard, the plugin tester, a workflow from last year. Putting it
   * on a Business OS surface tells an owner who uses Gmail and nothing else
   * to reconnect Sheets, Slack and Drive, which teaches them the amber line
   * is noise.
   *
   * Business OS scopes it through `connectionsInUse`. A caller that renders
   * this unfiltered is the defect
   * `lib/business-os/plugins/__tests__/alertsOnlyOnWhatIsUsed.test.ts`
   * exists for.
   * ─────────────────────────────────────────────────────────────────────────
   */
  expired: BrokenConnection[];
  /** The key currently being repaired, or null. */
  repairing: string | null;
  /** Why the last repair failed, or null. Cleared when another starts. */
  failure: { key: string; message: string } | null;
  /** Repair one. Resolves true when the connection is live again. */
  repair: (key: string) => Promise<boolean>;
}

export function usePluginRepair(): PluginRepair {
  const { user, connectedPlugins, refreshPlugins } = useAuth();
  const [repairing, setRepairing] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);

  /*
   * Derived, never stored.
   *
   * A reconnection anywhere else in the app calls `refreshPlugins()`, which
   * replaces the context value, which recomputes this. A copy in state here
   * would keep showing a connection repaired in the footer thirty seconds ago.
   */
  const expired = useMemo<BrokenConnection[]>(() => {
    if (!connectedPlugins) return [];

    return Object.entries(connectedPlugins)
      .filter(([, plugin]) => Boolean((plugin as { is_expired?: boolean })?.is_expired))
      /*
       * ───────────────────────────────────────────────────────────────────────
       * EXPIRED IS NOT BROKEN, AND THIS LIST IS THE BROKEN ONE.
       *
       * A Google access token lives exactly one hour. `is_expired` therefore
       * goes true on EVERY Google connection sixty minutes after each refresh,
       * with the refresh token still good and the executors still refreshing
       * it on demand — and this list is what the readiness card alerts on.
       *
       * Measured on a live account: Gmail written at 21:44, `expires_at`
       * 22:44, `status: active`, refresh token present, and the owner told
       * their connection had died and to reconnect it. Hourly, for a
       * connection that was working the whole time.
       *
       * That is how an alert becomes furniture, and the page that renders this
       * already warns about it in its own words: a false amber line "teaches
       * them the amber line is noise and the next one gets skipped with it".
       *
       * `is_expired` keeps its meaning — the footer and the calendar panel
       * offer a refresh off the back of it, and should. What changes is that
       * BROKEN now means "the owner has to do something", so a connection that
       * can let itself back in is not on this list. One whose refresh token is
       * gone, or has been revoked, still is: by `can_refresh`, or by the
       * refresh failing and the agent stopping, which the agents list reports.
       * ───────────────────────────────────────────────────────────────────────
       */
      .filter(([, plugin]) => (plugin as { can_refresh?: boolean })?.can_refresh === false)
      .map(([key, plugin]) => {
        const named = plugin as { displayName?: string; name?: string };
        return { key, name: named.displayName || named.name || key };
      });
  }, [connectedPlugins]);

  const repair = useCallback(async (key: string): Promise<boolean> => {
    if (!user) return false;

    setRepairing(key);
    setFailure(null);

    try {
      /*
       * Step one: the silent refresh. Most expiries are exactly this — an
       * access token past its hour with a refresh token still good — and it
       * costs one request and no interruption.
       */
      const response = await fetch('/api/plugins/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginKeys: [key] }),
      });
      const result = await response.json();

      if (result?.success && result.refreshed?.includes(key)) {
        await refreshPlugins();
        return true;
      }

      /*
       * Step two, and only on `failed`: the refresh token itself is dead, so
       * the owner has to authorise again. `connectPlugin` owns that whole
       * round trip — we do not open a popup here.
       *
       * Gated on `failed` rather than on "not refreshed" deliberately. A route
       * error, or a key it did not recognise, is neither a success nor a dead
       * grant, and throwing an OAuth popup at an owner because a request
       * timed out is how a working connection gets disturbed.
       */
      if (result?.failed?.includes(key)) {
        const connected = await getPluginAPIClient().connectPlugin(user.id, key);

        if (connected.success) {
          await refreshPlugins();
          return true;
        }

        setFailure({ key, message: connected.error || 'reconnect_failed' });
        return false;
      }

      setFailure({ key, message: result?.message || 'refresh_failed' });
      return false;
    } catch (err) {
      clientLogger.error({ err, pluginKey: key }, 'Plugin repair failed');
      setFailure({ key, message: 'refresh_failed' });
      return false;
    } finally {
      setRepairing(null);
    }
  }, [user, refreshPlugins]);

  return { expired, repairing, failure, repair };
}
