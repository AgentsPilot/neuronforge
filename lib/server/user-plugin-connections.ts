// lib/server/user-plugin-connections.ts

import { createClient } from '@supabase/supabase-js';
import { savePluginConnection } from '../plugins/savePluginConnection';
import { PluginAuthConfig, UserConnection, ConnectionStatus } from '@/lib/types/plugin-types'

let userConnectionsInstance: UserPluginConnections | null = null;

export class UserPluginConnections {
  private supabase: any;
  private debug = process.env.NODE_ENV === 'development';

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
    if (this.debug) console.log('DEBUG: Server UserPluginConnections initialized');
  }

  // Singleton factory for serverless functions
  static getInstance(): UserPluginConnections {
    if (!userConnectionsInstance) {
      if (process.env.NODE_ENV === 'development') {
        console.log('DEBUG: Creating new UserPluginConnections instance for serverless function');
      }
      userConnectionsInstance = new UserPluginConnections();
    }
    return userConnectionsInstance;
  }

  // Get all connected plugin keys for user (only valid connections)
  async getConnectedPluginKeys(userId: string): Promise<string[]> {
    if (this.debug) console.log(`DEBUG: Getting connected plugin keys for user ${userId}`);
    
    try {
      const { data: connections, error } = await this.supabase
        .from('plugin_connections')
        .select('plugin_key, expires_at')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) {
        console.error('DEBUG: Database error fetching connections:', error);
        return [];
      }

      // Filter out expired connections
      const validConnections = connections?.filter(conn => this.isTokenValid(conn.expires_at)) || [];
      const pluginKeys = validConnections.map(conn => conn.plugin_key);
      
      if (this.debug) console.log(`DEBUG: Found ${pluginKeys.length} valid connected plugins:`, pluginKeys);
      
      return pluginKeys;
    } catch (error) {
      console.error('DEBUG: Error getting connected plugin keys:', error);
      return [];
    }
  }

  // Get all disconnected plugin keys for user (non-active connections)
  async getDisconnectedPluginKeys(userId: string, availablePluginKeys: string[]): Promise<string[]> {
    if (this.debug) console.log(`DEBUG: Getting disconnected plugin keys for user ${userId}`);

    try {
      // Get all active connections
      const { data: activeConnections, error } = await this.supabase
        .from('plugin_connections')
        .select('plugin_key')
        .eq('user_id', userId)
        .eq('status', 'active');

      if (error) {
        console.error('DEBUG: Database error fetching active connections:', error);
        // If error, assume all available plugins are disconnected
        return availablePluginKeys;
      }

      // Create a set of connected plugin keys for fast lookup
      const connectedKeys = new Set(activeConnections?.map((conn: any) => conn.plugin_key) || []);

      // Filter available plugins to find disconnected ones
      const disconnectedKeys = availablePluginKeys.filter(key => !connectedKeys.has(key));

      if (this.debug) console.log(`DEBUG: Found ${disconnectedKeys.length} disconnected plugins out of ${availablePluginKeys.length} available`);

      return disconnectedKeys;
    } catch (error) {
      console.error('DEBUG: Error getting disconnected plugin keys:', error);
      // If error, return all available plugins as potentially disconnected
      return availablePluginKeys;
    }
  }

  // Get connection status for specific plugin
  async getConnectionStatus(userId: string, pluginKey: string): Promise<ConnectionStatus> {
    if (this.debug) console.log(`DEBUG: Getting connection status for ${pluginKey}`);
    
    try {
      const { data: connection, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (error || !connection) {
        if (this.debug) console.log(`DEBUG: No connection found for ${pluginKey}`);
        return { connected: false, reason: 'not_connected' };
      }

      if (connection.status !== 'active') {
        if (this.debug) console.log(`DEBUG: Connection ${pluginKey} status is ${connection.status}`);
        return { connected: false, reason: 'connection_error' };
      }

      if (!this.isTokenValid(connection.expires_at)) {
        if (this.debug) console.log(`DEBUG: Token expired for ${pluginKey}`);
        return { 
          connected: false, 
          reason: 'token_expired',
          expires_at: connection.expires_at
        };
      }

      if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} is connected and valid`);
      return { 
        connected: true, 
        reason: 'connected',
        expires_at: connection.expires_at
      };
    } catch (error) {
      console.error('DEBUG: Error getting connection status:', error);
      return { connected: false, reason: 'connection_error' };
    }
  }

  // Get connection data for plugin (for API calls)
  async getConnection(userId: string, pluginKey: string, authConfig: PluginAuthConfig): Promise<UserConnection | null> {
    if (this.debug) console.log(`DEBUG: Getting connection data for ${pluginKey}`);

    // Check if this is a system plugin (no database connection required)
    if (authConfig.auth_type === 'platform_key') {
      if (this.debug) console.log(`DEBUG: ${pluginKey} is a system plugin, returning virtual connection`);

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
        if (this.debug) console.log(`DEBUG: No active connection found for ${pluginKey}`);
        return null;
      }

      // SMART REFRESH: Check if token should be refreshed (expires within 5 minutes or already expired)
      if (this.shouldRefreshToken(connection.expires_at, 5)) {
        const minutesUntilExpiry = connection.expires_at
          ? Math.floor((new Date(connection.expires_at).getTime() - Date.now()) / 60000)
          : 0;

        console.log(`🔄 Smart Refresh: ${pluginKey} token expires in ${minutesUntilExpiry} minutes, proactively refreshing before use...`);

        // Only attempt refresh if we have a refresh token
        if (!connection.refresh_token) {
          console.error(`❌ Smart Refresh Failed: No refresh token available for ${pluginKey} - user needs to reconnect`);
          return null;
        }

        const refreshedConnection = await this.refreshToken(connection, authConfig);
        if (refreshedConnection) {
          console.log(`✅ Smart Refresh Success: ${pluginKey} token refreshed and ready for use`);
          return refreshedConnection;
        } else {
          console.error(`❌ Smart Refresh Failed: ${pluginKey} - user needs to reconnect in Settings`);
          return null;
        }
      }

      if (this.debug) console.log(`DEBUG: Valid connection found for ${pluginKey} - no refresh needed`);
      return connection;
    } catch (error) {
      console.error('DEBUG: Error getting connection:', error);
      return null;
    }
  }

  // Handle OAuth callback (called from API route)
  async handleOAuthCallback(code: string, state: string, authConfig: PluginAuthConfig, request?: any): Promise<UserConnection> {
    if (this.debug) console.log('DEBUG: Handling OAuth callback server-side');
    
    try {
      if (!code) {
        throw new Error('Authorization code missing from callback');
      }

      if (!state) {
        throw new Error('State parameter missing from callback');
      }

      // Parse state
      const parsedState = JSON.parse(decodeURIComponent(state));
      const { user_id, plugin_key } = parsedState;

      if (this.debug) console.log(`DEBUG: OAuth callback for plugin ${plugin_key}, user ${user_id}`);

      // Validate environment variables
      if (!authConfig.client_id || !authConfig.client_secret) {
        throw new Error('OAuth credentials not configured');
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(authConfig.token_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          client_id: authConfig.client_id,
          client_secret: authConfig.client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: authConfig.redirect_uri,
        }),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('DEBUG: Token exchange failed:', errorText);
        throw new Error(`Token exchange failed: ${tokenResponse.status}`);
      }

      const tokens = await tokenResponse.json();
      if (this.debug) console.log('DEBUG: tokens response: ', tokens);

      if (!tokens.access_token) {
        throw new Error('No access token received');
      }

      if (this.debug) console.log('DEBUG: Tokens received successfully');

      // For Slack OAuth v2, use the user token for profile fetch (authed_user.access_token)
      // For other providers, use the regular access_token
      if (this.debug) console.log(`DEBUG: tokens.authed_user?.access_token: ${tokens.authed_user?.access_token} tokens.access_token: ${tokens.access_token}`);
      const profileAccessToken = tokens.authed_user?.access_token || tokens.access_token;

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

      if (this.debug) console.log(`DEBUG: Saving connection for ${plugin_key}`);

      // Check if connection already exists to determine if this is new or reconnection
      const existingConnection = await this.supabase
        .from('plugin_connections')
        .select('id')
        .eq('user_id', user_id)
        .eq('plugin_key', plugin_key)
        .single();

      const isNewConnection = !existingConnection.data;

      const data = await savePluginConnection(connectionData);

      if (this.debug) console.log(`DEBUG: Connection saved successfully for ${plugin_key}`);

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
        if (this.debug) console.log(`DEBUG: Audit trail logged for ${plugin_key} connection`);
      } catch (auditError) {
        console.error('DEBUG: Failed to log audit trail:', auditError);
        // Don't fail the connection if audit logging fails
      }

      return data;
    } catch (error) {
      console.error('DEBUG: OAuth callback error:', error);

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
          console.error('DEBUG: Failed to parse state:', stateError);
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
        if (this.debug) console.log(`DEBUG: Audit trail logged for OAuth failure`);
      } catch (auditError) {
        console.error('DEBUG: Failed to log audit trail for OAuth failure:', auditError);
        // Don't block the error throw
      }

      throw error;
    }
  }
  
  // Refresh expired token
  async refreshToken(connection: UserConnection, authConfig: PluginAuthConfig): Promise<UserConnection | null> {
    console.log(`🔄 Token Refresh: Attempting to refresh token for ${connection.plugin_key} (user: ${connection.user_id})`);

    if (!connection.refresh_token) {
      console.error(`❌ Token Refresh Failed: No refresh token available for ${connection.plugin_key}`);
      console.error(`   This usually means the user needs to reconnect the plugin to get a new refresh token`);
      return null;
    }

    try {
      console.log(`📤 Token Refresh: Calling refresh endpoint: ${authConfig.refresh_url}`);
      const response = await fetch(authConfig.refresh_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: authConfig.client_id,
          client_secret: authConfig.client_secret,
          refresh_token: connection.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Token Refresh Failed: ${connection.plugin_key} - Status ${response.status}`);
        console.error(`   Response: ${errorText}`);
        console.error(`   This usually means:`);
        console.error(`   - The refresh token has expired (Google tokens expire after 6 months of non-use)`);
        console.error(`   - The refresh token was revoked by the user`);
        console.error(`   - OAuth credentials changed`);
        console.error(`   User needs to reconnect the plugin in Settings → Connected Apps`);
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

      console.log(`✅ Token Refresh Success: ${connection.plugin_key} - New token expires at ${expiresAt}`);

      // NOTE: We deliberately do NOT log token refreshes to audit trail
      // Token refreshes are automatic background operations, not user actions
      // Logging them would flood the audit trail with routine maintenance events
      // Only user-initiated actions (connect, disconnect, permission changes) are logged

      return data;
    } catch (error) {
      console.error('DEBUG: Token refresh error:', error);
      return null;
    }
  }

  // Disconnect plugin
  async disconnectPlugin(userId: string, pluginKey: string, request?: any): Promise<boolean> {
    if (this.debug) console.log(`DEBUG: Disconnecting plugin ${pluginKey} for user ${userId}`);

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
        console.error('DEBUG: Failed to disconnect plugin:', error);
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
          if (this.debug) console.log(`DEBUG: Audit trail logged for ${pluginKey} disconnection`);
        } catch (auditError) {
          console.error('DEBUG: Failed to log audit trail:', auditError);
          // Don't fail the disconnect if audit logging fails
        }
      }

      if (this.debug) console.log(`DEBUG: Plugin ${pluginKey} disconnected successfully`);
      return true;
    } catch (error) {
      console.error('DEBUG: Error disconnecting plugin:', error);
      return false;
    }
  }

  // Update profile_data for an existing connection
  async updateConnectionProfileData(
    userId: string,
    pluginKey: string,
    profileData: any
  ): Promise<boolean> {
    if (this.debug) console.log(`DEBUG: Updating profile_data for ${pluginKey}, user ${userId}`);

    try {
      // Get existing connection to merge with new profile data
      const { data: existingConnection, error: fetchError } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (fetchError) {
        console.error('DEBUG: Error fetching existing connection:', fetchError);
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
        console.error('DEBUG: Failed to update profile_data:', updateError);
        return false;
      }

      if (this.debug) console.log(`DEBUG: Profile data updated successfully for ${pluginKey}`);
      return true;
    } catch (error) {
      console.error('DEBUG: Error updating connection profile data:', error);
      return false;
    }
  }

  // Update additional configuration data for a plugin connection
  async updateAdditionalConfig(
    userId: string,
    pluginKey: string,
    additionalData: Record<string, any>
  ): Promise<boolean> {
    if (this.debug) console.log(`DEBUG: Updating additional config for ${pluginKey}, user ${userId}`);

    try {
      // Get existing connection to preserve auth data
      const { data: existingConnection, error: fetchError } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (fetchError) {
        console.error('DEBUG: Error fetching existing connection:', fetchError);
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
        console.error('DEBUG: Failed to update additional config:', updateError);
        return false;
      }

      if (this.debug) console.log(`DEBUG: Additional config updated successfully for ${pluginKey}`);
      return true;
    } catch (error) {
      console.error('DEBUG: Error updating additional config:', error);
      return false;
    }
  }

  // Get additional configuration data for a plugin connection
  async getAdditionalConfig(
    userId: string,
    pluginKey: string
  ): Promise<Record<string, any> | null> {
    if (this.debug) console.log(`DEBUG: Getting additional config for ${pluginKey}, user ${userId}`);

    try {
      const { data: connection, error } = await this.supabase
        .from('plugin_connections')
        .select('profile_data')
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey)
        .single();

      if (error || !connection) {
        if (this.debug) console.log(`DEBUG: No connection found for ${pluginKey}`);
        return null;
      }

      // Return additional data if it exists in nested structure
      return connection.profile_data?.additional || null;
    } catch (error) {
      console.error('DEBUG: Error getting additional config:', error);
      return null;
    }
  }

  // Get all user connections (for admin/debug purposes)
  async getAllUserConnections(userId: string): Promise<UserConnection[]> {
    if (this.debug) console.log(`DEBUG: Getting all connections for user ${userId}`);
    
    try {
      const { data: connections, error } = await this.supabase
        .from('plugin_connections')
        .select('*')
        .eq('user_id', userId)
        .order('connected_at', { ascending: false });

      if (error) {
        console.error('DEBUG: Error fetching all connections:', error);
        return [];
      }

      return connections || [];
    } catch (error) {
      console.error('DEBUG: Error getting all user connections:', error);
      return [];
    }
  }

  // Private helper methods

  // Check if token is still valid
  public isTokenValid(expiresAt: string | null): boolean {
    if (!expiresAt) {
      if (this.debug) console.log(`DEBUG: Token has no expiry, considered valid`);
      return true; // No expiry means it doesn't expire
    }

    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const isValid = expiryDate.getTime() > now.getTime();

    if (this.debug) console.log(`DEBUG: Token valid: ${isValid}, expires: ${expiryDate.toISOString()}`);

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

    if (this.debug) {
      const minutesUntilExpiry = Math.floor(timeUntilExpiry / 60000);
      console.log(`DEBUG: Token expires in ${minutesUntilExpiry} minutes. Should refresh: ${shouldRefresh} (buffer: ${bufferMinutes} min)`);
    }

    return shouldRefresh;
  }

  // Fetch user profile based on provider
  private async fetchUserProfile(accessToken: string, authType: string, profileUrl?: string): Promise<any> {
    if (this.debug) console.log(`DEBUG: Fetching user profile for auth type: ${authType} profileUrl: ${profileUrl}`);

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
    
    if (this.debug) console.log('DEBUG: User profile fetched successfully: ', profile);
    
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
      if (this.debug) console.log('DEBUG: OAuth state validation failed:', error);
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
    if (this.debug) console.log(`DEBUG: Checking plugin permission for user ${userId}, plugin ${pluginKey}`);
    
    // For now, all authenticated users can connect to any plugin
    // You could add role-based access control here
    return true;
  }

  // Cleanup expired connections (utility method)
  async cleanupExpiredConnections(): Promise<number> {
    if (this.debug) console.log('DEBUG: Cleaning up expired connections');
    
    try {
      const now = new Date().toISOString();
      
      const { data, error } = await this.supabase
        .from('plugin_connections')
        .update({ status: 'expired' })
        .lt('expires_at', now)
        .eq('status', 'active')
        .select('id');

      if (error) {
        console.error('DEBUG: Error cleaning up expired connections:', error);
        return 0;
      }

      const cleanedCount = data?.length || 0;
      if (this.debug) console.log(`DEBUG: Cleaned up ${cleanedCount} expired connections`);
      
      return cleanedCount;
    } catch (error) {
      console.error('DEBUG: Error in cleanup process:', error);
      return 0;
    }
  }
}