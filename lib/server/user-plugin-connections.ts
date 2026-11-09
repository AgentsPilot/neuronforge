// lib/server/user-plugin-connections.ts

import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { PluginAuthConfig, UserConnection, ConnectionStatus } from '@/lib/types/plugin-types'
import { createLogger } from '@/lib/logger';
import { PluginConnectionRepository, pluginConnectionRepository } from '@/lib/repositories';
import type { UpsertPluginConnectionInput } from '@/lib/repositories/types';
import { exchangeCodeForTokens, refreshAccessToken, refreshAccessTokenDetailed, fetchUserProfile, calculateExpiresAt } from '@/lib/services/OAuthTokenService';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import type { AuditLogInput } from '@/lib/audit/types';

// Create logger instance for plugin connections
const logger = createLogger({ module: 'UserPluginConnections', service: 'plugin-system' });

// Use globalThis to ensure singleton persists across module reloads (important for Next.js dev mode)
const globalForUserConnections = globalThis as unknown as {
  userConnectionsInstance: UserPluginConnections | null;
};

interface OAuthState {
  user_id: string;
  plugin_key: string;
  code_verifier?: string;
}

/**
 * Decode the callback's state value. Any failure throws a generic "Invalid
 * state": the SyntaxError from JSON.parse quotes the start of its input, and
 * that message reaches the logs, the audit row and the client.
 */
function parseOAuthState(state: string): OAuthState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(state));
  } catch {
    throw new Error('Invalid state');
  }
  const candidate = parsed as Partial<OAuthState> | null;
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.user_id !== 'string' ||
    typeof candidate.plugin_key !== 'string' ||
    (candidate.code_verifier !== undefined && typeof candidate.code_verifier !== 'string')
  ) {
    throw new Error('Invalid state');
  }
  return candidate as OAuthState;
}

/** The same settings with the dead-grant mark removed. */
function withoutRefreshFailure(settings: unknown): Record<string, unknown> {
  const { refresh_failed_at, refresh_failed_detail, ...rest } = (settings ??
    {}) as Record<string, unknown>;
  void refresh_failed_at;
  void refresh_failed_detail;
  return rest;
}

/**
 * A token's identity, carrying none of the token.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPORARY — remove once the stored-token question below is answered.
 *
 * The previous attempt at this recorded a four-character prefix, which cannot
 * discriminate anything: every Google access token begins `ya29.a0Aehf…`, so
 * `ya29` always matched `ya29` and two wrong conclusions survived a full day of
 * measurement on the strength of it.
 *
 * Twelve hex characters of a SHA-256 is the opposite trade: it tells two tokens
 * apart with certainty and reveals nothing about either. Not reversible, not a
 * credential, safe in a log and safe in a row.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function tokenFingerprint(token: string): string {
  if (!token) return 'absent';
  return createHash('sha256').update(token).digest('hex').slice(0, 12);
}

export class UserPluginConnections {
  private repository: PluginConnectionRepository;
  // Cache for token validation to avoid redundant logs and calculations
  private tokenValidationCache = new Map<string, { isValid: boolean, checkedAt: number }>();
  private readonly TOKEN_CACHE_TTL = 1000; // 1 second cache

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE REFRESH PER GRANT PER MINUTE, WHOEVER ASKS.
   *
   * A single agent run refreshes the same grant at least twice: the pre-flight
   * (`connectionsReady`) verifies the token with the provider and refreshes on
   * rejection, and then the executor refreshes again on the 401. That is two
   * hits for one logical attempt, and neither caller can see the other.
   *
   * It was not the pair that did the damage — it was the pair multiplied by a
   * retry loop that could not terminate. `retry_count` was never incremented,
   * so a failing run came back every five minutes for ten days: around 50 runs
   * a day, 100+ refreshes of one refresh token. The grant stayed broken for as
   * long as the load continued, while another agent on the same account and
   * the same plugin, running once a day, completed normally throughout.
   *
   * The retry loop is fixed where it belongs, in the scheduler. This is the
   * backstop, placed on the singleton so it holds for every caller rather than
   * for the one that remembered: a grant refreshed in the last minute is not
   * refreshed again, and the caller is handed what that refresh produced.
   *
   * A minute is safe by construction. These tokens live an hour, so nothing
   * legitimately needs refreshing twice inside sixty seconds — the only thing
   * that ever asks is two layers of one attempt not knowing about each other.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private recentRefreshes = new Map<string, { at: number; connection: UserConnection | null }>();
  private readonly REFRESH_COALESCE_MS = 60_000;
  private readonly TOKEN_CACHE_MAX_SIZE = 100;

  constructor(repository?: PluginConnectionRepository) {
    this.repository = repository || pluginConnectionRepository;
    logger.debug('UserPluginConnections instance created');
  }

  // Singleton factory for serverless functions
  // Uses globalThis to persist across module reloads in Next.js dev mode
  static getInstance(): UserPluginConnections {
    if (!globalForUserConnections.userConnectionsInstance) {
      logger.debug('Creating new UserPluginConnections instance for serverless function');
      globalForUserConnections.userConnectionsInstance = new UserPluginConnections();
    }
    return globalForUserConnections.userConnectionsInstance;
  }

  // Private helper: Fetch active plugin connections from database
  private async fetchActiveConnections(userId: string): Promise<UserConnection[]> {
    const { data, error } = await this.repository.findActiveByUser(userId);
    if (error) {
      logger.error({ err: error, userId }, 'Database error fetching connections');
      return [];
    }
    return data || [];
  }

  // Get all active plugin connections (including expired tokens that can be refreshed)
  // NOTE: This returns ALL active plugins, even with expired tokens
  // Use this for execution flows where tokens can be refreshed
  async getAllActivePlugins(userId: string): Promise<UserConnection[]> {
    return await this.fetchActiveConnections(userId);
  }

  // Get all connected plugin connections for user (only active plugins with valid tokens)
  // NOTE: This function does NOT refresh tokens - it only pulls active connections from the database
  // Use this for status display and operations that don't require token refresh
  async getConnectedPlugins(userId: string): Promise<UserConnection[]> {
    const connections = await this.fetchActiveConnections(userId);

    // Filter out expired connections
    const validConnections = connections.filter(conn => this.isTokenValid(conn.expires_at));

    return validConnections;
  }

  // Get all connected plugin keys for user (only valid connections)
  async getConnectedPluginKeys(userId: string): Promise<string[]> {
    try {
      // Use getConnectedPlugins and extract just the keys
      const connections = await this.getConnectedPlugins(userId);
      return connections.map(conn => conn.plugin_key);
    } catch (error) {
      logger.error({ err: error, userId }, 'Error getting connected plugin keys');
      return [];
    }
  }

  // Get all disconnected plugin keys for user (non-active connections)
  // @param connectedKeys - Optional pre-fetched connected keys to avoid duplicate DB query
  async getDisconnectedPluginKeys(
    userId: string,
    availablePluginKeys: string[],
    connectedKeys?: string[]
  ): Promise<string[]> {
    try {
      // Use provided connectedKeys if available, otherwise fetch them
      const keys = connectedKeys ?? await this.getConnectedPluginKeys(userId);

      // Create a set of connected plugin keys for fast lookup
      const connectedSet = new Set(keys);

      // Filter available plugins to find disconnected ones
      return availablePluginKeys.filter(key => !connectedSet.has(key));
    } catch (error) {
      logger.error({ err: error, userId }, 'Error getting disconnected plugin keys');
      // If error, return all available plugins as potentially disconnected
      return availablePluginKeys;
    }
  }

  // Get connection status for specific plugin
  async getConnectionStatus(userId: string, pluginKey: string): Promise<ConnectionStatus> {
    logger.debug({ userId, pluginKey }, 'Getting connection status');

    try {
      const { data: connection, error } = await this.repository.findByUserAndPlugin(userId, pluginKey);

      if (error || !connection) {
        logger.debug({ userId, pluginKey }, 'No connection found');
        return { connected: false, reason: 'not_connected' };
      }

      if (connection.status !== 'active') {
        logger.debug({ userId, pluginKey, status: connection.status }, 'Connection status is not active');
        return { connected: false, reason: 'connection_error' };
      }

      if (!this.isTokenValid(connection.expires_at)) {
        logger.debug({ userId, pluginKey, expiresAt: connection.expires_at }, 'Token expired');
        return {
          connected: false,
          reason: 'token_expired',
          expires_at: connection.expires_at ?? undefined
        };
      }

      logger.debug({ userId, pluginKey }, 'Plugin is connected and valid');
      return {
        connected: true,
        reason: 'connected',
        expires_at: connection.expires_at ?? undefined
      };
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error getting connection status');
      return { connected: false, reason: 'connection_error' };
    }
  }

  // Get connection data for plugin (for API calls)
  async getConnection(userId: string, pluginKey: string, authConfig: PluginAuthConfig): Promise<UserConnection | null> {
    // Check if this is a system plugin (no database connection required)
    if (authConfig.auth_type === 'platform_key') {

      // Return a virtual connection for system plugins (no DB record needed)
      return {
        user_id: userId,
        plugin_key: pluginKey,
        plugin_name: pluginKey,
        access_token: 'system', // Placeholder - not used by system plugins
        refresh_token: null,
        expires_at: null, // System plugins don't expire
        scope: null,
        username: 'System',
        email: null,
        profile_data: { isSystem: true },
        settings: {},
        status: 'active',
        id: `system-${userId}-${pluginKey}`,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    }

    // OAuth plugins: query database for connection
    try {
      const { data: connection, error } = await this.repository.findActiveByUserAndPlugin(userId, pluginKey);

      if (error || !connection) {
        return null;
      }

      // SMART REFRESH: Check if token should be refreshed (expires within 5 minutes or already expired)
      if (this.shouldRefreshToken(connection.expires_at, 5)) {
        const minutesUntilExpiry = connection.expires_at
          ? Math.floor((new Date(connection.expires_at).getTime() - Date.now()) / 60000)
          : 0;

        logger.info({
          pluginKey,
          minutesUntilExpiry
        }, 'Smart Refresh: Token expires soon, proactively refreshing before use');

        // Only attempt refresh if we have a refresh token
        if (!connection.refresh_token) {
          logger.warn({ pluginKey }, 'Smart Refresh: No refresh token available - user needs to reconnect');
          return null;
        }

        const refreshedConnection = await this.refreshToken(connection, authConfig);
        if (refreshedConnection) {
          logger.info({ pluginKey }, 'Smart Refresh Success: Token refreshed and ready for use');
          return refreshedConnection;
        } else {
          logger.error({ pluginKey }, 'Smart Refresh Failed: User needs to reconnect in Settings');
          return null;
        }
      }

      return connection;
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error getting connection');
      return null;
    }
  }

  // Handle OAuth callback (called from API route)
  async handleOAuthCallback(code: string, state: string, authConfig: PluginAuthConfig, request?: NextRequest): Promise<UserConnection> {
    logger.debug('Handling OAuth callback server-side');

    try {
      if (!code) {
        throw new Error('Authorization code missing from callback');
      }

      if (!state) {
        throw new Error('State parameter missing from callback');
      }

      // Parse state
      const { user_id, plugin_key, code_verifier } = parseOAuthState(state);

      logger.debug({ pluginKey: plugin_key, userId: user_id }, 'OAuth callback for plugin');

      // Validate environment variables
      if (!authConfig.client_id || !authConfig.client_secret) {
        throw new Error('OAuth credentials not configured');
      }

      // Exchange authorization code for tokens via OAuthTokenService
      const tokens = await exchangeCodeForTokens(code, authConfig, code_verifier);

      // For Slack OAuth v2, use the user token for profile fetch (authed_user.access_token)
      const profileAccessToken = tokens.authed_user?.access_token || tokens.access_token;

      // Fetch user profile (provider-specific)
      const profile = await fetchUserProfile(profileAccessToken, authConfig.auth_type, authConfig.profile_url, authConfig.profile_method);

      // Calculate expiration
      const expiresAt = calculateExpiresAt(tokens.expires_in);


      

      // Build connection data for upsert
      const connectionData: UpsertPluginConnectionInput = {
        user_id,
        plugin_key,
        plugin_name: plugin_key,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || null,
        expires_at: expiresAt, // null if token doesn't expire
        scope: tokens.scope || tokens.scopes || null,
        username: profile.name || profile.email || profile.user?.name || profile.user || (plugin_key+' user'),
        email: profile.email,
        profile_data: profile,
        settings: {},
        status: 'active'
      };

      logger.debug({ pluginKey: plugin_key }, 'Saving connection');

      // Check if connection already exists to determine if this is new or reconnection
      const { data: exists } = await this.repository.existsByUserAndPlugin(user_id, plugin_key);
      const isNewConnection = !exists;

      // Upsert via repository
      const { data, error: upsertError } = await this.repository.upsert(connectionData);

      if (upsertError || !data) {
        throw new Error(`Failed to save connection: ${upsertError?.message || 'Unknown error'}`);
      }

      logger.info({ pluginKey: plugin_key, isNewConnection }, 'Connection saved successfully');

      // Audit trail logging (non-blocking)
      this.audit({
        action: isNewConnection ? 'PLUGIN_CONNECTED' : 'PLUGIN_RECONNECTED',
        entityType: 'connection',
        entityId: data.id,
        resourceName: plugin_key,
        userId: user_id,
        request,
        details: {
          plugin_key,
          plugin_name: plugin_key,
          scopes: connectionData.scope,
          provider_email: profile.email,
          auth_type: authConfig.auth_type,
          username: connectionData.username,
        },
        severity: 'info',
        complianceFlags: ['SOC2'],
      });

      return data;
    } catch (error) {
      logger.error({ err: error }, 'OAuth callback error');

      // Audit trail for OAuth failures (non-blocking)
      let failedUserId: string | null = null;
      let failedPluginKey: string | null = null;
      try {
        if (state) {
          const parsedState = parseOAuthState(state);
          failedUserId = parsedState.user_id;
          failedPluginKey = parsedState.plugin_key;
        }
      } catch {
        logger.error('Failed to parse state');
      }

      this.audit({
        action: 'PLUGIN_AUTH_FAILED',
        entityType: 'connection',
        resourceName: failedPluginKey ?? undefined,
        userId: failedUserId,
        request,
        details: {
          plugin_key: failedPluginKey,
          error_message: error instanceof Error ? error.message : 'Unknown error',
          auth_type: authConfig?.auth_type,
          has_code: !!code,
          has_state: !!state,
        },
        severity: 'warning',
        complianceFlags: ['SOC2'],
      });

      throw error;
    }
  }

  // Refresh expired token
  async refreshToken(
    connection: UserConnection,
    authConfig: PluginAuthConfig,
    /*
     * The token the provider has just REFUSED, when the caller knows it.
     *
     * Only `base-plugin-executor` can know this: it is the one place that has
     * a 401 in hand. Passing it changes nothing about the request and one
     * thing about the write — see the branch below.
     */
    options?: { refusedToken?: string }
  ): Promise<UserConnection | null> {
    logger.info({
      pluginKey: connection.plugin_key,
      userId: connection.user_id
    }, 'Token Refresh: Attempting to refresh token');

    if (!connection.refresh_token) {
      logger.warn({
        pluginKey: connection.plugin_key
      }, 'Token refresh: No refresh token available - user needs to reconnect');
      return null;
    }

    const coalesceKey = `${connection.user_id}:${connection.plugin_key}`;
    const recent = this.recentRefreshes.get(coalesceKey);

    if (recent && Date.now() - recent.at < this.REFRESH_COALESCE_MS) {
      logger.info(
        {
          pluginKey: connection.plugin_key,
          userId: connection.user_id,
          agoMs: Date.now() - recent.at,
        },
        'This grant was refreshed moments ago; reusing that result instead of asking the provider again'
      );
      return recent.connection;
    }

    try {
      // Refresh token via OAuthTokenService
      const outcome = await refreshAccessTokenDetailed(connection.refresh_token, authConfig);

      if (!outcome.ok) {
        /*
         * ───────────────────────────────────────────────────────────────────
         * A DEAD GRANT IS RECORDED, SO A SURFACE CAN SAY SO.
         *
         * Returning null told the caller "no token" and told the OWNER
         * nothing. The readiness line decides what to warn about from
         * `can_refresh`, which was computed from a refresh token merely
         * EXISTING — so a grant the owner had revoked still read as
         * refreshable, readiness stayed quiet, and their agents failed in
         * silence with no way to discover why.
         *
         * Presence is not proof. The one thing that proves a grant is gone is
         * the provider refusing it, which is what we have here, so it is
         * written down: `settings.refresh_failed_at`. Nothing else can know
         * this — it is not derivable from any column.
         *
         * Only for `grant_revoked`. A transient failure marks nothing, because
         * telling an owner to re-authorise over a provider's bad minute
         * teaches them the warning means nothing.
         * ───────────────────────────────────────────────────────────────────
         */
        if (outcome.reason === 'grant_revoked') {
          await this.recordRefreshFailure(connection, outcome.detail);
        }

        logger.warn({
          pluginKey: connection.plugin_key,
          reason: outcome.reason,
          commonCauses: 'refresh token expired (Google ~6mo), token revoked, or OAuth credentials changed'
        }, 'Token refresh failed');
        /* A refusal counts. Without this the pre-flight and the executor each
           ask a dead grant inside one run, which is two refusals and twice the
           load for the same answer. */
        this.recentRefreshes.set(coalesceKey, { at: Date.now(), connection: null });
        return null;
      }

      const tokens = outcome.tokens;

      const expiresAt = calculateExpiresAt(tokens.expires_in);

      const incoming = String(tokens.access_token ?? '');

      /*
       * ───────────────────────────────────────────────────────────────────────
       * A TOKEN THE PROVIDER JUST REFUSED DOES NOT GET A FRESH HOUR.
       *
       * This is the write that hid a ten-day outage, and it hid it by being
       * two writes at once. `access_token` kept its old value — Google handed
       * back the very token Gmail had refused — while `expires_at` and
       * `last_refreshed_at` were recomputed from the response regardless. So
       * the row said "refreshed seconds ago, good for another hour" about a
       * token that was already dead, every five minutes, and no surface could
       * see otherwise: `expires_at` is the thing they all read.
       *
       * Measured on a live account on 2026-11-09: the stored token answered
       * `invalid_token` at Google's own `tokeninfo` 79 seconds after this
       * function wrote it, with `changed: false` beside it. The same account's
       * Calendar connection refreshed 13 seconds earlier in the same pass and
       * stored a token that was valid — so the write path, the column and the
       * credentials were all fine. Only this one grant kept handing back what
       * had just been refused.
       *
       * So when the caller tells us which token was refused and the provider
       * returns that same value, nothing is written. The row keeps the expiry
       * it already had, which lets it lapse honestly and lets the next run
       * try again. Re-stamping it would buy another hour of silence.
       *
       * The connection is still RETURNED, carrying that value, because the
       * caller compares it: identical means "ask again", and that decision
       * belongs to the one place holding the 401.
       *
       * Note this is deliberately narrow. A refresh that returns the same
       * token is perfectly normal and perfectly fine when the token still
       * works — Google does it whenever the current one has life left, and
       * that same account's Calendar token came back with 3396 of its 3599
       * seconds remaining. It is only a problem for a token we KNOW was just
       * refused, which is exactly what `refusedToken` names.
       * ───────────────────────────────────────────────────────────────────────
       */
      if (options?.refusedToken && incoming === options.refusedToken) {
        logger.warn(
          {
            pluginKey: connection.plugin_key,
            userId: connection.user_id,
            incomingLength: incoming.length,
            incomingPrefix: incoming.slice(0, 4),
          },
          'Refresh returned the token the provider had just refused; leaving the stored expiry alone'
        );
        const unchanged = { ...connection, access_token: incoming };
        this.recentRefreshes.set(coalesceKey, { at: Date.now(), connection: unchanged });
        return unchanged;
      }

      /*
       * ───────────────────────────────────────────────────────────────────────
       * TEMPORARY PROBE — remove once this question is answered.
       *
       * THE QUESTION. On 2026-11-09 at 21:25:23 this ran against a live Gmail
       * connection: the provider answered 200, we stored the token it
       * returned, and the provider then rejected that very token at its own
       * `tokeninfo` endpoint. The SAME refresh token, asked by hand with the
       * same client, returned a token Gmail answered 200 to — five times over.
       * The grant is healthy; what lands in the row is not.
       *
       * Eliminated by measurement rather than argument: truncation, column
       * type, encryption, write corruption, read corruption (a known-good
       * token was written and read back byte-identical and still valid),
       * scopes, revocation, concurrent-token eviction, duplicate rows, a
       * second refresh implementation, a second cron, and the retry storm.
       *
       * What is left needs three facts, recorded where they cannot be lost —
       * the log line this replaces never reached either terminal, because the
       * local server filters it and the deployed one is a different build.
       *
       *   · `previous_fp` compared against the PRECEDING pass's `incoming_fp`
       *     answers the one question a single pass cannot: did the row still
       *     hold what we last stored, or did something overwrite it in
       *     between? Two consecutive passes settle it.
       *   · `client_id_tail` — is this process using the OAuth client we
       *     believe? Everything concluded about the client so far was inferred
       *     from one token's audience, which is an inference, not a reading.
       *   · `scope` — did the provider narrow the grant on the way through?
       *
       * It rides the upsert that was happening anyway, so the normal path
       * costs no extra write.
       * ───────────────────────────────────────────────────────────────────────
       */
      const probe = {
        at: new Date().toISOString(),
        incoming_fp: tokenFingerprint(incoming),
        incoming_length: incoming.length,
        previous_fp: tokenFingerprint(String(connection.access_token ?? '')),
        previous_length: String(connection.access_token ?? '').length,
        client_id_tail: String(authConfig.client_id ?? '').slice(-6),
        rotated_refresh_token: Boolean(tokens.refresh_token),
        scope: String((tokens as { scope?: string }).scope ?? '(absent)'),
        expires_in: tokens.expires_in,
      };

      logger.info(
        { pluginKey: connection.plugin_key, userId: connection.user_id, ...probe },
        'Refresh probe: what the provider sent'
      );

      // Update connection via repository upsert
      const updatedConnectionData: UpsertPluginConnectionInput = {
        user_id: connection.user_id,
        plugin_key: connection.plugin_key,
        plugin_name: connection.plugin_name,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || connection.refresh_token,
        expires_at: expiresAt,
        scope: connection.scope || null,
        username: connection.username || '',
        email: connection.email || null,
        profile_data: connection.profile_data || null,
        /* A successful refresh clears the dead-grant mark — whatever the owner
           did to fix it worked, and the readiness line must stop warning. */
        settings: { ...withoutRefreshFailure(connection.settings), refresh_probe: probe },
        /*
         * STAMPED HERE AND NOWHERE ELSE.
         *
         * The column has always existed and nothing has ever written it, so
         * every connection reported NEVER no matter how often it refreshed.
         * `updated_at` moves on a refresh too, but it also moves on a connect,
         * a disconnect and a profile change, so it cannot answer the question
         * this column is named after.
         *
         * It misled a real investigation on 2026-11-09: a Gmail connection
         * refreshing daily read `last_refreshed_at: NEVER`, and the agent was
         * reported dead when it had been completing its runs for two days.
         */
        last_refreshed_at: new Date().toISOString(),
        status: 'active'
      };

      const { data, error } = await this.repository.upsert(updatedConnectionData);

      if (error || !data) {
        logger.error({ err: error, pluginKey: connection.plugin_key }, 'Failed to save refreshed token');
        return null;
      }

      /*
       * Did the write persist what arrived? `data` is the row the upsert
       * returned, so this is the PERSISTED value rather than a copy of the
       * payload we sent. Logged always; written to the row only when the
       * answer is no, which keeps the healthy path to one write and captures
       * the anomaly exactly when it happens.
       */
      const storedBack = String((data as { access_token?: string }).access_token ?? '');
      const persistedWhatArrived = storedBack === incoming;

      if (!persistedWhatArrived) {
        logger.error(
          {
            pluginKey: connection.plugin_key,
            userId: connection.user_id,
            incomingFp: probe.incoming_fp,
            storedFp: tokenFingerprint(storedBack),
            storedLength: storedBack.length,
          },
          'Refresh probe: the row does NOT hold the token the provider sent'
        );

        await this.repository
          .upsert({
            ...updatedConnectionData,
            settings: {
              ...updatedConnectionData.settings,
              refresh_probe: {
                ...probe,
                persisted_what_arrived: false,
                stored_fp: tokenFingerprint(storedBack),
                stored_length: storedBack.length,
              },
            },
          })
          .catch(() => {
            /* Diagnostics. Failing the refresh to record them would turn a
               working connection into a broken one. */
          });
      }

      logger.info({
        pluginKey: connection.plugin_key,
        expiresAt
      }, 'Token Refresh Success - New token saved');

      this.recentRefreshes.set(coalesceKey, { at: Date.now(), connection: data });

      /* Bounded like `tokenValidationCache` beside it: one entry per grant that
         refreshed in the last minute is tiny, but a long-lived serverless
         instance must not accumulate for ever. */
      if (this.recentRefreshes.size > this.TOKEN_CACHE_MAX_SIZE) {
        const cutoff = Date.now() - this.REFRESH_COALESCE_MS;
        for (const [key, entry] of this.recentRefreshes) {
          if (entry.at < cutoff) this.recentRefreshes.delete(key);
        }
      }

      // NOTE: We deliberately do NOT log token refreshes to audit trail
      // Token refreshes are automatic background operations, not user actions
      // Logging them would flood the audit trail with routine maintenance events
      // Only user-initiated actions (connect, disconnect, permission changes) are logged

      return data;
    } catch (error) {
      logger.error({ err: error, pluginKey: connection.plugin_key }, 'Token refresh error');
      return null;
    }
  }

  // Disconnect plugin
  async disconnectPlugin(userId: string, pluginKey: string, request?: NextRequest): Promise<boolean> {
    logger.debug({ userId, pluginKey }, 'Disconnecting plugin');

    try {
      // Fetch connection details BEFORE disconnecting for audit trail
      const { data: connection } = await this.repository.findByUserAndPlugin(userId, pluginKey);

      const { data: success, error } = await this.repository.updateStatus(
        userId,
        pluginKey,
        'disconnected',
        { disconnected_at: new Date().toISOString() }
      );

      if (error || !success) {
        logger.error({ err: error, userId, pluginKey }, 'Failed to disconnect plugin');
        return false;
      }

      // Audit trail logging (non-blocking)
      if (connection) {
        const connectedAt = connection.connected_at ? new Date(connection.connected_at) : null;
        const connectionDurationDays = connectedAt
          ? Math.floor((Date.now() - connectedAt.getTime()) / (1000 * 60 * 60 * 24))
          : null;

        this.audit({
          action: 'PLUGIN_DISCONNECTED',
          entityType: 'connection',
          entityId: connection.id,
          resourceName: pluginKey,
          userId,
          request,
          details: {
            plugin_key: pluginKey,
            plugin_name: pluginKey,
            provider_email: connection.email,
            username: connection.username,
            connection_duration_days: connectionDurationDays,
            scopes: connection.scope,
          },
          severity: 'warning',
          complianceFlags: ['SOC2'],
        });
      }

      logger.info({ userId, pluginKey }, 'Plugin disconnected successfully');
      return true;
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error disconnecting plugin');
      return false;
    }
  }

  // Update profile_data for an existing connection
  async updateConnectionProfileData(
    userId: string,
    pluginKey: string,
    profileData: Record<string, unknown>
  ): Promise<boolean> {
    logger.debug({ userId, pluginKey }, 'Updating profile_data');

    try {
      // Get existing connection to merge with new profile data
      const { data: existing, error: fetchError } = await this.repository.findProfileData(userId, pluginKey);

      if (fetchError) {
        logger.error({ err: fetchError, userId, pluginKey }, 'Error fetching existing connection');
        return false;
      }

      // Merge new profile data with existing (new data overwrites existing keys)
      const mergedProfileData = {
        ...(existing?.profile_data || {}),
        ...profileData
      };

      // Update the connection with merged profile data
      const { error: updateError } = await this.repository.updateProfileData(userId, pluginKey, mergedProfileData);

      if (updateError) {
        logger.error({ err: updateError, userId, pluginKey }, 'Failed to update profile_data');
        return false;
      }

      logger.debug({ userId, pluginKey }, 'Profile data updated successfully');
      return true;
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error updating connection profile data');
      return false;
    }
  }

  // Find an active connection by matching fields in profile_data (JSONB @> operator)
  // Used by webhook routes to look up which user owns a given external identifier
  // Example: findActiveConnectionByProfileData('whatsapp-business', { phone_number_id: '12345' })
  async findActiveConnectionByProfileData(
    pluginKey: string,
    profileDataMatch: Record<string, string>
  ): Promise<UserConnection | null> {
    logger.debug({ pluginKey, profileDataMatch }, 'Finding connection by profile_data');

    try {
      const { data: connection, error } = await this.repository.findActiveByProfileData(pluginKey, profileDataMatch);

      if (error) {
        logger.error({ err: error, pluginKey, profileDataMatch }, 'Error finding connection by profile_data');
        return null;
      }

      if (!connection) {
        logger.debug({ pluginKey, profileDataMatch }, 'No active connection found for profile_data match');
        return null;
      }

      logger.debug({ pluginKey, userId: connection.user_id }, 'Connection found by profile_data');
      return connection;
    } catch (error) {
      logger.error({ err: error, pluginKey }, 'Error in findActiveConnectionByProfileData');
      return null;
    }
  }

  // Update additional configuration data for a plugin connection
  async updateAdditionalConfig(
    userId: string,
    pluginKey: string,
    additionalData: Record<string, unknown>
  ): Promise<boolean> {
    logger.debug({ userId, pluginKey }, 'Updating additional config');

    try {
      // Get existing connection to preserve auth data
      const { data: existing, error: fetchError } = await this.repository.findProfileData(userId, pluginKey);

      if (fetchError) {
        logger.error({ err: fetchError, userId, pluginKey }, 'Error fetching existing connection');
        return false;
      }

      // Build nested structure: { auth: {...}, additional: {...} }
      const updatedProfileData = {
        auth: (existing?.profile_data as Record<string, unknown> | undefined)?.auth || existing?.profile_data || {},
        additional: additionalData
      };

      // Update the connection with new structure
      const { error: updateError } = await this.repository.updateProfileData(userId, pluginKey, updatedProfileData);

      if (updateError) {
        logger.error({ err: updateError, userId, pluginKey }, 'Failed to update additional config');
        return false;
      }

      logger.debug({ userId, pluginKey }, 'Additional config updated successfully');
      return true;
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error updating additional config');
      return false;
    }
  }

  // Get additional configuration data for a plugin connection
  async getAdditionalConfig(
    userId: string,
    pluginKey: string
  ): Promise<Record<string, unknown> | null> {
    logger.debug({ userId, pluginKey }, 'Getting additional config');

    try {
      const { data: existing, error } = await this.repository.findProfileData(userId, pluginKey);

      if (error || !existing) {
        logger.debug({ userId, pluginKey }, 'No connection found');
        return null;
      }

      // Return additional data if it exists in nested structure
      return (existing.profile_data as Record<string, unknown> | undefined)?.additional as Record<string, unknown> | null ?? null;
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error getting additional config');
      return null;
    }
  }

  // Get all user connections (for admin/debug purposes)
  async getAllUserConnections(userId: string): Promise<UserConnection[]> {
    logger.debug({ userId }, 'Getting all connections for user');

    const { data, error } = await this.repository.findAllByUser(userId);

    if (error) {
      logger.error({ err: error, userId }, 'Error fetching all connections');
      return [];
    }

    return data || [];
  }

  // Private helper methods

  /**
   * Write down that the provider refused this grant.
   *
   * On `settings` rather than a new column: no migration, and the fact belongs
   * WITH the connection it describes. Best-effort — a connection we could not
   * annotate is still a connection that failed, and the caller reports that
   * either way.
   */
  /**
   * A grant the provider refuses, recorded from OUTSIDE the refresh call.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `recordRefreshFailure` below fires when the REFRESH is refused, and that
   * misses the case this exists for: Google still issues access tokens from the
   * refresh token, and the API then rejects every one of them.
   *
   * Seen live. A mailbox channel failed six runs a day for ten days with "Your
   * Gmail connection has expired" while its connection read `status: active`
   * and `refresh_failed_at: none` — because every refresh SUCCEEDED. The
   * channel card showed a green dot and the setup wizard said "set up"
   * throughout.
   *
   * The one place that can tell is the executor's retry: it refreshes after a
   * 401, retries once, and watches that retry fail with a brand-new token. Its
   * own comment names the conclusion — "a second 401 after a fresh token means
   * the GRANT is gone, not the token" — and it had no way to write it down.
   *
   * Same marker as a refused refresh, deliberately: the owner's remedy is
   * identical (re-authorise), and every surface already reads this one field.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async recordDeadGrant(connection: UserConnection, detail: string): Promise<void> {
    await this.recordRefreshFailure(connection, detail);
  }

  private async recordRefreshFailure(connection: UserConnection, detail: string): Promise<void> {
    try {
      const settings = (connection.settings ?? {}) as Record<string, unknown>;
      await this.repository.upsert({
        user_id: connection.user_id,
        plugin_key: connection.plugin_key,
        plugin_name: connection.plugin_name,
        access_token: connection.access_token,
        refresh_token: connection.refresh_token,
        expires_at: connection.expires_at,
        scope: connection.scope || null,
        username: connection.username || '',
        email: connection.email || null,
        profile_data: connection.profile_data || null,
        settings: {
          ...settings,
          refresh_failed_at: new Date().toISOString(),
          refresh_failed_detail: detail,
        },
        status: 'active',
      } as never);
    } catch (err) {
      logger.warn(
        { err, pluginKey: connection.plugin_key },
        'Could not record the refresh failure; the connection is still reported as failed'
      );
    }
  }

  // Check if token is still valid
  public isTokenValid(expiresAt: string | null): boolean {
    if (!expiresAt) {
      return true; // No expiry means it doesn't expire
    }

    const now = Date.now();
    const cacheKey = expiresAt;

    // Check cache first to avoid redundant calculations and logs
    const cached = this.tokenValidationCache.get(cacheKey);
    if (cached && (now - cached.checkedAt) < this.TOKEN_CACHE_TTL) {
      return cached.isValid;
    }

    const expiryDate = new Date(expiresAt);
    const isValid = expiryDate.getTime() > now;

    // Token validity logging removed - too noisy

    // Evict stale entries when cache exceeds max size
    if (this.tokenValidationCache.size >= this.TOKEN_CACHE_MAX_SIZE) {
      for (const [key, entry] of this.tokenValidationCache) {
        if ((now - entry.checkedAt) >= this.TOKEN_CACHE_TTL) {
          this.tokenValidationCache.delete(key);
        }
      }
    }

    // Cache the result
    this.tokenValidationCache.set(cacheKey, { isValid, checkedAt: now });

    return isValid;
  }

  // Check if token should be refreshed (expires within buffer time)
  // This proactively refreshes tokens before they expire to prevent API failures
  public shouldRefreshToken(expiresAt: string | null, bufferMinutes: number = 5): boolean {
    if (!expiresAt) {
      return false; // No expiry means no refresh needed
    }

    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const bufferMs = bufferMinutes * 60 * 1000;
    const timeUntilExpiry = expiryDate.getTime() - now.getTime();

    // Refresh if token expires within buffer time or is already expired
    return timeUntilExpiry <= bufferMs;
  }

  // Non-blocking audit trail helper
  private audit(input: AuditLogInput): void {
    AuditTrail.log(input)
      .catch((err: unknown) => logger.error({ err }, 'Audit trail logging failed (non-blocking)'));
  }

  // Generate OAuth state parameter
  generateOAuthState(userId: string, pluginKey: string): string {
    const state = {
      user_id: userId,
      plugin_key: pluginKey,
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(2)
    };

    return encodeURIComponent(JSON.stringify(state));
  }
}
