// lib/server/user-plugin-connections.ts

import { NextRequest } from 'next/server';
import { PluginAuthConfig, UserConnection, ConnectionStatus } from '@/lib/types/plugin-types'
import { createLogger } from '@/lib/logger';
import { PluginConnectionRepository, pluginConnectionRepository } from '@/lib/repositories';
import type { UpsertPluginConnectionInput } from '@/lib/repositories';
import { exchangeCodeForTokens, refreshAccessToken, fetchUserProfile, calculateExpiresAt } from '@/lib/services/OAuthTokenService';
import { AuditTrail } from '@/lib/services/AuditTrailService';
import type { AuditLogInput } from '@/lib/audit/types';

// Create logger instance for plugin connections
const logger = createLogger({ module: 'UserPluginConnections', service: 'plugin-system' });

// Use globalThis to ensure singleton persists across module reloads (important for Next.js dev mode)
const globalForUserConnections = globalThis as unknown as {
  userConnectionsInstance: UserPluginConnections | null;
};

export class UserPluginConnections {
  private repository: PluginConnectionRepository;
  // Cache for token validation to avoid redundant logs and calculations
  private tokenValidationCache = new Map<string, { isValid: boolean, checkedAt: number }>();
  private readonly TOKEN_CACHE_TTL = 1000; // 1 second cache
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
    logger.debug({ userId }, 'Getting all active plugins (including expired tokens)');

    const allConnections = await this.fetchActiveConnections(userId);

    const expiredCount = allConnections.filter(conn => !this.isTokenValid(conn.expires_at)).length;
    logger.debug({
      userId,
      totalActive: allConnections.length,
      expiredCount
    }, 'Active plugins retrieved');

    return allConnections;
  }

  // Get all connected plugin connections for user (only active plugins with valid tokens)
  // NOTE: This function does NOT refresh tokens - it only pulls active connections from the database
  // Use this for status display and operations that don't require token refresh
  async getConnectedPlugins(userId: string): Promise<UserConnection[]> {
    logger.debug({ userId }, 'Getting connected plugins');

    const connections = await this.fetchActiveConnections(userId);

    // Filter out expired connections
    const validConnections = connections.filter(conn => this.isTokenValid(conn.expires_at));

    logger.debug({ userId, validCount: validConnections.length }, 'Valid connected plugins retrieved');

    return validConnections;
  }

  // Get all connected plugin keys for user (only valid connections)
  async getConnectedPluginKeys(userId: string): Promise<string[]> {
    logger.debug({ userId }, 'Getting connected plugin keys');

    try {
      // Use getConnectedPlugins and extract just the keys
      const connections = await this.getConnectedPlugins(userId);
      const pluginKeys = connections.map(conn => conn.plugin_key);

      logger.debug({ userId, count: pluginKeys.length, pluginKeys }, 'Connected plugin keys retrieved');

      return pluginKeys;
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
    logger.debug({ userId }, 'Getting disconnected plugin keys');

    try {
      // Use provided connectedKeys if available, otherwise fetch them
      const keys = connectedKeys ?? await this.getConnectedPluginKeys(userId);

      // Create a set of connected plugin keys for fast lookup
      const connectedSet = new Set(keys);

      // Filter available plugins to find disconnected ones
      const disconnectedKeys = availablePluginKeys.filter(key => !connectedSet.has(key));

      logger.debug({
        userId,
        disconnectedCount: disconnectedKeys.length,
        availableCount: availablePluginKeys.length
      }, 'Disconnected plugin keys retrieved');

      return disconnectedKeys;
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
    logger.debug({ userId, pluginKey }, 'Getting connection data');

    // Check if this is a system plugin (no database connection required)
    if (authConfig.auth_type === 'platform_key') {
      logger.debug({ pluginKey }, 'System plugin - returning virtual connection');

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
        logger.debug({ userId, pluginKey }, 'No active connection found');
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
          logger.error({ pluginKey }, 'Smart Refresh Failed: No refresh token available - user needs to reconnect');
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

      logger.debug({ pluginKey }, 'Valid connection found - no refresh needed');
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
      const parsedState = JSON.parse(decodeURIComponent(state));
      const { user_id, plugin_key, code_verifier } = parsedState;

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
      const profile = await fetchUserProfile(profileAccessToken, authConfig.auth_type, authConfig.profile_url);

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
          const parsedState = JSON.parse(decodeURIComponent(state));
          failedUserId = parsedState.user_id;
          failedPluginKey = parsedState.plugin_key;
        }
      } catch (stateError) {
        logger.error({ err: stateError }, 'Failed to parse state');
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
  async refreshToken(connection: UserConnection, authConfig: PluginAuthConfig): Promise<UserConnection | null> {
    logger.info({
      pluginKey: connection.plugin_key,
      userId: connection.user_id
    }, 'Token Refresh: Attempting to refresh token');

    if (!connection.refresh_token) {
      logger.error({
        pluginKey: connection.plugin_key
      }, 'Token Refresh Failed: No refresh token available - user needs to reconnect');
      return null;
    }

    try {
      // Refresh token via OAuthTokenService
      const tokens = await refreshAccessToken(connection.refresh_token, authConfig);

      if (!tokens) {
        logger.error({
          pluginKey: connection.plugin_key
        }, 'Token Refresh Failed - User needs to reconnect in Settings');
        logger.error({
          pluginKey: connection.plugin_key
        }, 'Common causes: Refresh token expired (Google: 6mo), token revoked, or OAuth credentials changed');
        return null;
      }

      const expiresAt = calculateExpiresAt(tokens.expires_in);

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
        settings: connection.settings || {},
        status: 'active'
      };

      const { data, error } = await this.repository.upsert(updatedConnectionData);

      if (error || !data) {
        logger.error({ err: error, pluginKey: connection.plugin_key }, 'Failed to save refreshed token');
        return null;
      }

      logger.info({
        pluginKey: connection.plugin_key,
        expiresAt
      }, 'Token Refresh Success - New token saved');

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

    // Only log once per unique token expiry (not on every call)
    if (!cached) {
      logger.debug({
        isValid,
        expiresAt: expiryDate.toISOString()
      }, 'Token validity checked');
    }

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
    const shouldRefresh = timeUntilExpiry <= bufferMs;

    const minutesUntilExpiry = Math.floor(timeUntilExpiry / 60000);
    logger.debug({
      minutesUntilExpiry,
      shouldRefresh,
      bufferMinutes
    }, 'Token refresh check');

    return shouldRefresh;
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
