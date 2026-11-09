/**
 * Are this agent's plugin connections usable, BEFORE the run starts?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS COST, MEASURED
 *
 * On a live account, 2026-11-03: the `draft_client_replies` agent ran at 09:10,
 * 09:15, 09:20, 09:25 and 09:30 and failed every time with
 *
 *   Non-retryable execution error at step "Scan the mailbox for new replies"
 *   (Your Gmail connection has expired. Please reconnect in Settings)
 *
 * Fifteen failed runs since 1 November, none successful. And the connection was
 * never actually dead: `plugin_connections.google-mail` held a healthy refresh
 * token the whole time, and each failure triggered a refresh that SUCCEEDED —
 * one second after the run it could have saved had already been written off.
 *
 * The refresh was happening at the wrong moment. `getConnection` refreshes only
 * when `expires_at` is within five minutes, so a token already rejected by the
 * provider is handed to the first step unchanged, that step fails, and the
 * failure is what finally triggers the refresh. The agent then sits with a
 * perfectly good token until the next tick, where it repeats.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SO THE QUESTION IS ASKED FIRST, AND IT IS THE SAME MACHINERY
 *
 * Nothing here is new. `UserPluginConnections.getConnection` already does the
 * smart refresh; it was simply never called until a step needed it. Calling it
 * for every plugin the plan requires, before the first step, means the token is
 * refreshed while there is still a run to save.
 *
 * `base-plugin-executor` keeps its 401 retry, and the two are not redundant:
 * this one catches the token that is KNOWN to be near expiry, that one catches
 * the token that dies early for a reason no column can predict. Together they
 * cover both, and neither is sufficient alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A BLOCKED RUN IS A SKIP, NEVER A FAILURE
 *
 * The caller's two outcomes mean different things to an owner:
 *
 *   failed   something went wrong and may go right next time
 *   skipped  there was nothing to do, and here is why
 *
 * A connection the owner has to re-authorise is the second. Retrying it every
 * five minutes produces nothing but a failure count, which is what buried the
 * one real signal: the owner's agents list showed a wall of red with no
 * statement of the single thing that would fix it. The readiness card already
 * names the broken connection and offers the reconnect; this just stops the
 * scheduler shouting over it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT FAILS OPEN, DELIBERATELY
 *
 * Every uncertainty here resolves to "let the run proceed": a plugin with no
 * definition, a lookup that throws, a manager that will not load. The failure
 * mode of the other direction is the worst one available to this file — every
 * run skipped, forever, with a reason that reads like a considered decision and
 * nothing failing anywhere. A wrong "go ahead" costs one run that would have
 * failed anyway, and the executor's own retry is still behind it.
 *
 * @module lib/execution/connectionsReady
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ConnectionsReady' });

/** One plugin the agent needs and cannot currently use. */
export interface BlockedConnection {
  /** The plugin key, as `plugins_required` names it. */
  plugin: string;
  /**
   * Why it is unusable — both need the owner, and neither is retryable.
   *
   * Not separated further on purpose: from the scheduler's side "no connection
   * row" and "a connection whose refresh the provider refused" are one thing,
   * an owner who must go and connect it. The connections surface has the detail
   * and the button.
   */
  reason: 'no_usable_connection';
}

/**
 * Does the provider still accept this token?
 *
 * `rejected` ONLY on a 401, which is the provider stating the credential is no
 * good. Everything else answers `unknown` and the run proceeds:
 *
 *   · a 403 is a SCOPE or quota problem. The token is fine and refreshing it
 *     changes nothing, so treating it as dead would skip runs for ever over a
 *     permission the owner has to grant;
 *   · a 5xx, a timeout or a network error says nothing about the credential;
 *   · a plugin declaring no `profile_url` has nothing to ask.
 *
 * The asymmetry is deliberate. A false `rejected` costs one unnecessary
 * refresh; a false `accepted` costs exactly what this function exists to
 * prevent, and the step's own 401 handling is still behind it either way.
 */
async function tokenStillAccepted(
  accessToken: string | null | undefined,
  profileUrl: string | undefined
): Promise<'accepted' | 'rejected' | 'unknown'> {
  if (!accessToken || !profileUrl) return 'unknown';

  try {
    const response = await fetch(profileUrl, {
      /*
       * Never cached. Next patches `fetch`, and this call's whole purpose is
       * to ask the provider something it has not been asked before. A replayed
       * 401 would condemn a healthy token and trigger a refresh for nothing; a
       * replayed 200 would pass a dead one straight into the run.
       */
      cache: 'no-store',
      headers: { Authorization: `Bearer ${accessToken}` },
      /* A pre-flight must never outlast the thing it is checking for. The
         route's own budget is 60s and a whole agent run has to fit inside it. */
      signal: AbortSignal.timeout(5000),
    });

    return response.status === 401 ? 'rejected' : 'accepted';
  } catch {
    /* Never reached the provider, so nothing is known and nothing is claimed. */
    return 'unknown';
  }
}

/**
 * The plugins this agent needs that are not usable, after trying to refresh.
 *
 * An empty array means every required connection is live — including any that
 * were near expiry and have just been refreshed as a side effect of asking.
 *
 * Internal plugins (`business-os`, and anything else on `platform_key`) are not
 * connections at all: they hold no grant and cannot expire, so they are never
 * reported. `business-os` appears in almost every plan's `plugins_required`,
 * and blocking on it would stop every agent on the platform.
 */
export async function connectionsReady(
  userId: string,
  pluginsRequired: readonly string[]
): Promise<BlockedConnection[]> {
  if (!pluginsRequired.length) return [];

  try {
    /*
     * Lazy, like every other entry into the plugin layer from a cron.
     * `PluginManagerV2` reads the plugin definitions and the environment at
     * module scope, and a module-scope import of it from a route took out a
     * deploy on 2026-10-25.
     */
    const [{ PluginManagerV2 }, { UserPluginConnections }] = await Promise.all([
      import('@/lib/server/plugin-manager-v2'),
      import('@/lib/server/user-plugin-connections'),
    ]);

    const pluginManager = await PluginManagerV2.getInstance();
    const userConnections = UserPluginConnections.getInstance();

    const blocked: BlockedConnection[] = [];

    for (const plugin of new Set(pluginsRequired)) {
      const authConfig = pluginManager.getPluginDefinition(plugin)?.plugin?.auth_config;

      /* No definition, or a definition with no auth: nothing to check, and
         nothing this file is entitled to block on. */
      if (!authConfig) continue;

      /* Ours, not the owner's. No grant, no expiry, nothing to reconnect. */
      if (authConfig.auth_type === 'platform_key') continue;

      try {
        /* The refresh happens INSIDE this call when the token is near expiry —
           that is the whole point of asking now rather than at step time. */
        const connection = await userConnections.getConnection(userId, plugin, authConfig);

        if (!connection) {
          blocked.push({ plugin, reason: 'no_usable_connection' });
          continue;
        }

        /*
         * ─────────────────────────────────────────────────────────────────────
         * AND THEN ASK THE PROVIDER, BECAUSE `expires_at` IS A HINT.
         *
         * `getConnection` refreshes only within five minutes of the stored
         * expiry. That trusts a column, and the column is routinely wrong in
         * the one direction that matters: a token can be rejected long before
         * it expires — revoked, superseded, the grant re-scoped — and Google
         * then answers 401 while our row still says valid for another half
         * hour.
         *
         * Measured on a live account, 2026-11-04 15:30. The stored Gmail token
         * returned:
         *
         *   401  "Request had invalid authentication credentials"
         *
         * while one refresh call produced a token that read the mailbox fine on
         * the very next request. The connection was healthy throughout. The
         * owner was shown "Your Gmail connection has expired. Please reconnect"
         * for two days about a connection that was one API call from working,
         * and reconnecting would have fixed nothing.
         *
         * So the pre-flight VERIFIES rather than assumes: one cheap call to the
         * profile endpoint every OAuth plugin already declares, and on a 401 the
         * token is refreshed here — while there is still a run to save, rather
         * than one second after it was written off.
         * ─────────────────────────────────────────────────────────────────────
         */
        const verdict = await tokenStillAccepted(connection.access_token, authConfig.profile_url);

        if (verdict !== 'rejected') continue; // accepted, or nothing to ask

        const refreshed = await userConnections.refreshToken(connection, authConfig);

        if (!refreshed) {
          /* Proven dead AND unrefreshable. This is the one case where the owner
             genuinely must reconnect, and the only one worth blocking on. */
          logger.warn(
            { userId, plugin },
            'The provider rejected this token and it could not be refreshed; the owner must reconnect'
          );
          blocked.push({ plugin, reason: 'no_usable_connection' });
          continue;
        }

        logger.info(
          { userId, plugin },
          'Provider rejected a token our expiry still called valid; refreshed before the run'
        );
      } catch (err) {
        /* Fail open: one plugin we could not ask about is not grounds for
           refusing the run. Logged, because a connection check that throws
           every time would otherwise be invisible. */
        logger.warn(
          { err, userId, plugin },
          'Could not check a connection before the run; letting the run proceed'
        );
      }
    }

    return blocked;
  } catch (err) {
    /* The plugin layer itself would not load. Same rule, one level up. */
    logger.warn(
      { err, userId },
      'Connection pre-flight unavailable; letting the run proceed'
    );
    return [];
  }
}
