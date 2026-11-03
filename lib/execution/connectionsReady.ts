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
        }
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
