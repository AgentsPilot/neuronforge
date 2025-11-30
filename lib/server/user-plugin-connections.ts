// lib/server/user-plugin-connections.ts

import { createClient } from '@supabase/supabase-js';
import { savePluginConnection } from '../plugins/savePluginConnection';
import { PluginAuthConfig, UserConnection, ConnectionStatus } from '@/lib/types/plugin-types'
import { createLogger } from '@/lib/logger';

// Create logger instance for plugin connections
const logger = createLogger({ module: 'UserPluginConnections', service: 'plugin-system' });

// Use globalThis to ensure singleton persists across module reloads (important for Next.js dev mode)
const globalForUserConnections = globalThis as unknown as {
  userConnectionsInstance: UserPluginConnections | null;
};

export class UserPluginConnections {
  private supabase: any;  
  // Cache for token validation to avoid redundant logs and calculations
  private tokenValidationCache = new Map<string, { isValid: boolean, checkedAt: number }>();
  private readonly TOKEN_CACHE_TTL = 1000; // 1 second cache

  constructor() {
    // Create client for read operations (server-side with service role key for better permissions)
    // Disable query caching to ensure fresh data for plugin connections
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        db: {
          schema: 'public',
        },
        global: {
          headers: {
            'cache-control': 'no-cache',
          },
        },
      }
    );
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
    try {
      const { data: connections, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) {
        logger.error({ err: error, userId }, 'Database error fetching connections');
        return [];
      }

      return connections || [];
    } catch (error) {
      logger.error({ err: error, userId }, 'Error fetching active connections');
      return [];
    }
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
      const { data: connection, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

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
          expires_at: connection.expires_at
        };
      }

      logger.debug({ userId, pluginKey }, 'Plugin is connected and valid');
      return {
        connected: true,
        reason: 'connected',
        expires_at: connection.expires_at
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
        plugin_name: this.getPluginDisplayName(pluginKey),
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
      const { data: connection, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .eq('status', 'active')
        .single();

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
  async handleOAuthCallback(code: string, state: string, authConfig: PluginAuthConfig, request?: any): Promise<UserConnection> {
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

      // Build token exchange parameters
      const tokenParams: Record<string, string> = {
        code,
        grant_type: 'authorization_code',
        redirect_uri: authConfig.redirect_uri,
      };

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      };

      // Add code_verifier for PKCE if present
      if (code_verifier) {
        tokenParams.code_verifier = code_verifier;
        logger.debug('Using PKCE for token exchange');

        // For PKCE flows (like Airtable), send credentials via Basic Auth header
        const credentials = Buffer.from(`${authConfig.client_id}:${authConfig.client_secret}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
        logger.debug('Sending credentials via Basic Auth header (PKCE flow)');
      } else {
        // For non-PKCE flows, send credentials in body
        tokenParams.client_id = authConfig.client_id;
        tokenParams.client_secret = authConfig.client_secret;
        logger.debug('Sending credentials in request body (standard OAuth flow)');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(authConfig.token_url, {
        method: 'POST',
        headers: headers,
        body: new URLSearchParams(tokenParams),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        logger.error({ status: tokenResponse.status, errorText }, 'Token exchange failed');
        throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      }

      const tokens = await tokenResponse.json();
      logger.debug({ hasAccessToken: !!tokens.access_token }, 'Tokens response received');

      if (!tokens.access_token) {
        throw new Error('No access token received');
      }

      logger.debug('Tokens received successfully');

      // For Slack OAuth v2, use the user token for profile fetch (authed_user.access_token)
      // For other providers, use the regular access_token
      const profileAccessToken = tokens.authed_user?.access_token || tokens.access_token;
      logger.debug({
        hasAuthedUserToken: !!tokens.authed_user?.access_token,
        hasAccessToken: !!tokens.access_token
      }, 'Determining profile access token');

      // Fetch user profile (provider-specific)
      const profile = await this.fetchUserProfile(profileAccessToken, authConfig.auth_type, authConfig.profile_url);

      // Calculate expiration
      const expiresAt = this.getExpiresAt(tokens.expires_in);

      // Store connection using existing savePluginConnection function
      const connectionData = {
        user_id,
        plugin_key,
        plugin_name: this.getPluginDisplayName(plugin_key),
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
      const existingConnection = await this.supabase
        .from('plugin_connections')
        .select('id')
        .eq('user_id', user_id)
        .eq('plugin_key', plugin_key)
        .single();

      const isNewConnection = !existingConnection.data;

      const data = await savePluginConnection(connectionData);

      logger.info({ pluginKey: plugin_key, isNewConnection }, 'Connection saved successfully');

      // Audit trail logging
      try {
        const { AuditTrail } = await import('@/lib/services/AuditTrailService');
        await AuditTrail.log({
          action: isNewConnection ? 'PLUGIN_CONNECTED' : 'PLUGIN_RECONNECTED',
          entityType: 'connection',
          entityId: data.id,
          resourceName: this.getPluginDisplayName(plugin_key),
          userId: user_id,
          request: request, // Pass request for IP/user-agent extraction
          details: {
            plugin_key,
            plugin_name: this.getPluginDisplayName(plugin_key),
            scopes: connectionData.scope,
            provider_email: profile.email,
            auth_type: authConfig.auth_type,
            username: connectionData.username,
          },
          severity: 'info',
          complianceFlags: ['SOC2'],
        });
        logger.debug({ pluginKey: plugin_key }, 'Audit trail logged for connection');
      } catch (auditError) {
        logger.error({ err: auditError, pluginKey: plugin_key }, 'Failed to log audit trail');
        // Don't fail the connection if audit logging fails
      }

      return data;
    } catch (error) {
      logger.error({ err: error }, 'OAuth callback error');

      // Audit trail for OAuth failures
      try {
        const { AuditTrail } = await import('@/lib/services/AuditTrailService');

        // Try to extract state if available
        let userId = 'unknown';
        let pluginKey = 'unknown';
        try {
          if (state) {
            const parsedState = JSON.parse(decodeURIComponent(state));
            userId = parsedState.user_id;
            pluginKey = parsedState.plugin_key;
          }
        } catch (stateError) {
          logger.error({ err: stateError }, 'Failed to parse state');
        }

        await AuditTrail.log({
          action: 'PLUGIN_AUTH_FAILED',
          entityType: 'connection',
          resourceName: pluginKey !== 'unknown' ? this.getPluginDisplayName(pluginKey) : pluginKey,
          userId: userId !== 'unknown' ? userId : null,
          request: request,
          details: {
            plugin_key: pluginKey,
            error_message: error instanceof Error ? error.message : 'Unknown error',
            auth_type: authConfig?.auth_type,
            has_code: !!code,
            has_state: !!state,
          },
          severity: 'warning',
          complianceFlags: ['SOC2'],
        });
        logger.debug({ pluginKey }, 'Audit trail logged for OAuth failure');
      } catch (auditError) {
        logger.error({ err: auditError }, 'Failed to log audit trail for OAuth failure');
        // Don't block the error throw
      }

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
      logger.debug({ refreshUrl: authConfig.refresh_url }, 'Token Refresh: Calling refresh endpoint');

      // Build refresh token parameters
      const refreshParams: Record<string, string> = {
        refresh_token: connection.refresh_token,
        grant_type: 'refresh_token',
      };

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      };

      // Check if this is a PKCE-enabled plugin (like Airtable)
      if (authConfig.requires_pkce) {
        // For PKCE plugins, send credentials via Basic Auth header
        const credentials = Buffer.from(`${authConfig.client_id}:${authConfig.client_secret}`).toString('base64');
        headers['Authorization'] = `Basic ${credentials}`;
        logger.debug('Token Refresh: Using Basic Auth for PKCE plugin');
      } else {
        // For non-PKCE plugins, send credentials in body
        refreshParams.client_id = authConfig.client_id;
        refreshParams.client_secret = authConfig.client_secret;
      }

      const response = await fetch(authConfig.refresh_url, {
        method: 'POST',
        headers: headers,
        body: new URLSearchParams(refreshParams),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({
          pluginKey: connection.plugin_key,
          status: response.status,
          errorText
        }, 'Token Refresh Failed - User needs to reconnect in Settings');
        logger.error({
          pluginKey: connection.plugin_key
        }, 'Common causes: Refresh token expired (Google: 6mo), token revoked, or OAuth credentials changed');
        return null;
      }

      const tokens = await response.json();

      const expiresAt = this.getExpiresAt(tokens.expires_in);

      // Update connection using existing save function
      const updatedConnectionData = {
        user_id: connection.user_id,
        plugin_key: connection.plugin_key,
        plugin_name: connection.plugin_name,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || connection.refresh_token,
        expires_at: expiresAt,
        scope: connection.scope,
        username: connection.username,
        email: connection.email,
        profile_data: connection.profile_data,
        settings: connection.settings || {},
        status: 'active'
      };

      const data = await savePluginConnection(updatedConnectionData);

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
  async disconnectPlugin(userId: string, pluginKey: string, request?: any): Promise<boolean> {
    logger.debug({ userId, pluginKey }, 'Disconnecting plugin');

    try {
      // Fetch connection details BEFORE disconnecting for audit trail
      const { data: connection } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      const { error } = await this.supabase
        .from('plugin_connections')
        .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey);

      if (error) {
        logger.error({ err: error, userId, pluginKey }, 'Failed to disconnect plugin');
        return false;
      }

      // Audit trail logging
      if (connection) {
        try {
          const { AuditTrail } = await import('@/lib/services/AuditTrailService');

          // Calculate connection duration
          const connectedAt = connection.connected_at ? new Date(connection.connected_at) : null;
          const connectionDurationDays = connectedAt
            ? Math.floor((Date.now() - connectedAt.getTime()) / (1000 * 60 * 60 * 24))
            : null;

          await AuditTrail.log({
            action: 'PLUGIN_DISCONNECTED',
            entityType: 'connection',
            entityId: connection.id,
            resourceName: this.getPluginDisplayName(pluginKey),
            userId: userId,
            request: request, // Pass request for IP/user-agent extraction
            details: {
              plugin_key: pluginKey,
              plugin_name: this.getPluginDisplayName(pluginKey),
              provider_email: connection.email,
              username: connection.username,
              connection_duration_days: connectionDurationDays,
              scopes: connection.scope,
            },
            severity: 'warning',
            complianceFlags: ['SOC2'],
          });
          logger.debug({ pluginKey }, 'Audit trail logged for disconnection');
        } catch (auditError) {
          logger.error({ err: auditError, pluginKey }, 'Failed to log audit trail');
          // Don't fail the disconnect if audit logging fails
        }
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
    profileData: any
  ): Promise<boolean> {
    logger.debug({ userId, pluginKey }, 'Updating profile_data');

    try {
      // Get existing connection to merge with new profile data
      const { data: existingConnection, error: fetchError } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (fetchError) {
        logger.error({ err: fetchError, userId, pluginKey }, 'Error fetching existing connection');
        return false;
      }

      // Merge new profile data with existing (new data overwrites existing keys)
      const mergedProfileData = {
        ...(existingConnection?.profile_data || {}),
        ...profileData
      };

      // Update the connection with merged profile data
      const { error: updateError } = await this.supabase
        .from('plugin_connections')
        .update({
          profile_data: mergedProfileData,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey);

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

  // Update additional configuration data for a plugin connection
  async updateAdditionalConfig(
    userId: string,
    pluginKey: string,
    additionalData: Record<string, any>
  ): Promise<boolean> {
    logger.debug({ userId, pluginKey }, 'Updating additional config');

    try {
      // Get existing connection to preserve auth data
      const { data: existingConnection, error: fetchError } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (fetchError) {
        logger.error({ err: fetchError, userId, pluginKey }, 'Error fetching existing connection');
        return false;
      }

      // Build nested structure: { auth: {...}, additional: {...} }
      const updatedProfileData = {
        auth: existingConnection?.profile_data?.auth || existingConnection?.profile_data || {},
        additional: additionalData
      };

      // Update the connection with new structure
      const { error: updateError } = await this.supabase
        .from('plugin_connections')
        .update({
          profile_data: updatedProfileData,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey);

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
  ): Promise<Record<string, any> | null> {
    logger.debug({ userId, pluginKey }, 'Getting additional config');

    try {
      const { data: connection, error } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (error || !connection) {
        logger.debug({ userId, pluginKey }, 'No connection found');
        return null;
      }

      // Return additional data if it exists in nested structure
      return connection.profile_data?.additional || null;
    } catch (error) {
      logger.error({ err: error, userId, pluginKey }, 'Error getting additional config');
      return null;
    }
  }

  // Get all user connections (for admin/debug purposes)
  async getAllUserConnections(userId: string): Promise<UserConnection[]> {
    logger.debug({ userId }, 'Getting all connections for user');
    
    try {
      const { data: connections, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .order('connected_at', { ascending: false });

      if (error) {
        logger.error({ err: error, userId }, 'Error fetching all connections');
        return [];
      }

      return connections || [];
    } catch (error) {
      logger.error({ err: error, userId }, 'Error getting all user connections');
      return [];
    }
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

  // Fetch user profile based on provider
  private async fetchUserProfile(accessToken: string, authType: string, profileUrl?: string): Promise<any> {
    logger.debug({ authType, profileUrl }, 'Fetching user profile');

    // Use provided profile_url if available, otherwise fall back to switch case
    if (!profileUrl) {
      switch (authType) {
        case 'oauth2_google':
          profileUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';
          break;
        case 'oauth2_microsoft':
          profileUrl = 'https://graph.microsoft.com/v1.0/me';
          break;
        case 'oauth2_hubspot':
          profileUrl = `https://api.hubapi.com/oauth/v1/access-tokens/${accessToken}`;
          break;
        case 'oauth2':
          // Generic oauth2 - profile_url must be provided
          throw new Error('profile_url is required for generic oauth2 auth type');
        default:
          throw new Error(`Unsupported auth type: ${authType}`);
      }
    }

    const response = await fetch(profileUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch profile: ${response.status}`);
    }

    const profile = await response.json();

    logger.debug('User profile fetched successfully');

    return profile;
  }

  // Get plugin display name for DB storage --> NEED TO BE FIXES/REMOVED in the future, need to take from plugin definition
  private getPluginDisplayName(pluginKey: string): string {
    const displayNames: Record<string, string> = {
      'gmail': 'google-mail',
    };

    return displayNames[pluginKey] || pluginKey;
  }

  // Calculate expiration date from expires_in seconds
  private getExpiresAt(expires_in: any): string | null {
    if (!expires_in) {
      return null; // Token doesn't expire (e.g., Slack without token rotation)
    }
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + expires_in);
    return expiresAt.toISOString();
  }

  // Validate OAuth state parameter
  private validateOAuthState(state: string, expectedPluginKey: string): { valid: boolean; userId: string; pluginKey: string } {
    try {
      const parsedState = JSON.parse(decodeURIComponent(state));
      const { user_id, plugin_key, timestamp } = parsedState;

      // Basic validation
      if (!user_id || !plugin_key || !timestamp) {
        throw new Error('Invalid state structure');
      }

      // Check plugin key matches
      if (plugin_key !== expectedPluginKey) {
        throw new Error('Plugin key mismatch');
      }

      // Check timestamp (reject if older than 1 hour)
      const stateAge = Date.now() - timestamp;
      if (stateAge > 3600000) { // 1 hour in milliseconds
        throw new Error('State parameter expired');
      }

      return {
        valid: true,
        userId: user_id,
        pluginKey: plugin_key
      };
    } catch (error) {
      logger.debug({ err: error }, 'OAuth state validation failed');
      return {
        valid: false,
        userId: '',
        pluginKey: ''
      };
    }
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

  // Check if user has permission for plugin
  async hasPluginPermission(userId: string, pluginKey: string): Promise<boolean> {
    // Basic implementation - in production you might have more complex permission logic
    logger.debug({ userId, pluginKey }, 'Checking plugin permission');

    // For now, all authenticated users can connect to any plugin
    // You could add role-based access control here
    return true;
  }

  // Cleanup expired connections (utility method)
  async cleanupExpiredConnections(): Promise<number> {
    logger.debug('Cleaning up expired connections');
    
    try {
      const now = new Date().toISOString();
      
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .update({ status: 'expired' })
        .lt('expires_at', now)
        .eq('status', 'active')
        .select('id');

      if (error) {
        logger.error({ err: error }, 'Error cleaning up expired connections');
        return 0;
      }

      const cleanedCount = data?.length || 0;
      logger.info({ cleanedCount }, 'Expired connections cleaned up');

      return cleanedCount;
    } catch (error) {
      logger.error({ err: error }, 'Error in cleanup process');
      return 0;
    }
  }
}