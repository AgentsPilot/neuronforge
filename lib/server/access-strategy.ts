// lib/server/access-strategy.ts

import { UserPluginConnections } from './user-plugin-connections';
import { businessProfileRepository, BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import type { PluginAuthConfig, PluginAccessStrategy, UserConnection } from '@/lib/types/plugin-types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'AccessStrategyResolver', service: 'plugin-system' });

/**
 * Result of resolving a plugin's access / eligibility strategy for a user.
 *
 * - `eligible: true`  → `connection` is the (real or virtual) UserConnection to hand the
 *   executor; it always carries `user_id` so repository-backed executors stay tenant-scoped.
 * - `eligible: false` → execution must be blocked with `errorCode` + `message`; `connection`
 *   is null. This is the single fail-closed gate for internal (`db_active`) plugins.
 */
export interface AccessResolution {
  eligible: boolean;
  connection: UserConnection | null;
  /** Error code returned to the caller when not eligible (strategy-specific — see below). */
  errorCode?: string;
  /** User-facing message when not eligible. */
  message?: string;
  /** Machine reason for logs/tests (not user-facing). */
  reason?: string;
  /** The strategy that was actually resolved (explicit or inferred). */
  strategy: PluginAccessStrategy['type'];
}

/**
 * Resolves the pluggable access / eligibility strategy for a plugin execution.
 *
 * This generalizes the previous single `auth_type === 'platform_key'` branch in
 * `UserPluginConnections.getConnection` into an explicit strategy switch. It is the ONE place
 * that answers "can this user use this plugin right now?" for every strategy, so the executor
 * template (`BasePluginExecutor`) has a single, consistent gate instead of an OAuth-shaped
 * check plus an `isSystem` short-circuit.
 *
 * Strategy selection (explicit declaration wins; otherwise inferred for backward-compat):
 *   - `plugin.access_strategy.type` if declared in the definition, else
 *   - `auth_config.auth_type === 'platform_key'` → `platform_key` (legacy system virtual connection), else
 *   - `oauth` (today's default — DB connection lookup + smart refresh).
 *
 * `db_active` is genuinely NEW eligibility logic and FAILS CLOSED: it verifies the user is an
 * active BOS tenant (has a `business_profiles` row) and denies on both no-row AND any lookup
 * error. It never returns an unconditional virtual connection the way `platform_key` does.
 */
export class AccessStrategyResolver {
  private userConnections: UserPluginConnections;
  private businessProfiles: BusinessProfileRepository;

  constructor(
    userConnections: UserPluginConnections,
    businessProfiles: BusinessProfileRepository = businessProfileRepository
  ) {
    this.userConnections = userConnections;
    this.businessProfiles = businessProfiles;
  }

  async resolve(
    userId: string,
    pluginKey: string,
    opts: { authConfig?: PluginAuthConfig; accessStrategy?: PluginAccessStrategy }
  ): Promise<AccessResolution> {
    const { authConfig, accessStrategy } = opts;

    // Connection-backed strategies (real OAuth and legacy `platform_key` system plugins) are
    // both resolved by the existing getConnection(), which itself forks on `auth_type` and
    // returns a virtual connection for `platform_key`. We report them under the `oauth` label
    // since PluginAccessStrategyType has no separate `platform_key` member. The only NEW branch
    // that must live here is `db_active`.
    switch (accessStrategy?.type) {
      case 'db_active':
        return this.resolveDbActive(userId, pluginKey);

      case 'license_tier':
        // Designed-but-unbuilt seam (Document 2). Never selectable in v1; fail closed loudly.
        logger.error({ pluginKey, userId }, 'license_tier access strategy is not implemented');
        return {
          eligible: false,
          connection: null,
          errorCode: 'access_strategy_unavailable',
          message: 'This plugin is gated by a subscription tier that is not yet available.',
          reason: 'license_tier_not_implemented',
          strategy: 'license_tier',
        };

      case 'oauth':
      default:
        return this.resolveConnectionBacked(userId, pluginKey, authConfig, 'oauth');
    }
  }

  /**
   * OAuth / platform_key path — delegate to the existing connection resolver, which returns a
   * virtual connection for `platform_key` system plugins and a DB connection (with smart
   * refresh) for OAuth plugins. Eligibility = a non-null connection, preserving the prior
   * `auth_failed` contract for OAuth callers.
   */
  private async resolveConnectionBacked(
    userId: string,
    pluginKey: string,
    authConfig: PluginAuthConfig | undefined,
    strategy: PluginAccessStrategy['type']
  ): Promise<AccessResolution> {
    if (!authConfig) {
      // An oauth/platform_key plugin with no auth_config cannot resolve a connection.
      return {
        eligible: false,
        connection: null,
        errorCode: 'auth_failed',
        message: `${pluginKey} is not configured. Please reconnect in Settings.`,
        reason: 'missing_auth_config',
        strategy,
      };
    }

    const connection = await this.userConnections.getConnection(userId, pluginKey, authConfig);
    if (!connection) {
      return {
        eligible: false,
        connection: null,
        errorCode: 'auth_failed',
        message: `${pluginKey} connection not found or expired. Please reconnect in Settings.`,
        reason: 'connection_not_found',
        strategy,
      };
    }

    return { eligible: true, connection, strategy };
  }

  /**
   * db_active — verify the user is an active BOS tenant (has a `business_profiles` row).
   * FAILS CLOSED: denies on both no-row (`data == null`) and any repository error.
   */
  private async resolveDbActive(userId: string, pluginKey: string): Promise<AccessResolution> {
    const { data, error } = await this.businessProfiles.findByUserId(userId);

    // Fail closed: any error OR missing profile → not eligible. `findByUserId` returns
    // { data: null, error: null } for a genuinely-absent profile (PGRST116) and
    // { data: null, error } on any other failure — both deny here.
    if (error || !data) {
      logger.warn(
        { userId, pluginKey, hasError: !!error, reason: error ? 'lookup_error' : 'no_active_tenant' },
        'db_active access denied (fail-closed)'
      );
      return {
        eligible: false,
        connection: null,
        errorCode: 'access_denied',
        message: 'This capability is available to active Business OS accounts only.',
        reason: error ? 'lookup_error' : 'no_active_tenant',
        strategy: 'db_active',
      };
    }

    return {
      eligible: true,
      connection: this.buildVirtualConnection(userId, pluginKey),
      strategy: 'db_active',
    };
  }

  /**
   * Virtual connection for an internal plugin — mirrors the `platform_key` virtual-connection
   * shape from UserPluginConnections.getConnection, but is only issued AFTER an eligibility
   * check. The `user_id` it carries is what the repository-backed executor scopes every query
   * by, so it must always be the server-resolved user id (never client-supplied).
   */
  private buildVirtualConnection(userId: string, pluginKey: string): UserConnection {
    const now = new Date().toISOString();
    return {
      user_id: userId,
      plugin_key: pluginKey,
      plugin_name: pluginKey,
      access_token: 'internal', // Placeholder — internal plugins hold no token.
      refresh_token: null,
      expires_at: null, // Internal plugins do not expire.
      scope: null,
      username: 'System',
      email: null,
      profile_data: { isInternal: true },
      settings: {},
      status: 'active',
      id: `internal-${userId}-${pluginKey}`,
      connected_at: now,
      updated_at: now,
    };
  }
}
