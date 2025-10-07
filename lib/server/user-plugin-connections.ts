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
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
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

      // Check if token needs refresh
      if (!this.isTokenValid(connection.expires_at)) {
        if (this.debug) console.log(`DEBUG: Token expired for ${pluginKey}, attempting refresh`);
        
        const refreshedConnection = await this.refreshToken(connection, authConfig);
        if (refreshedConnection) {
          return refreshedConnection;
        } else {
          if (this.debug) console.log(`DEBUG: Token refresh failed for ${pluginKey}`);
          return null;
        }
      }

      if (this.debug) console.log(`DEBUG: Valid connection found for ${pluginKey}`);
      return connection;
    } catch (error) {
      console.error('DEBUG: Error getting connection:', error);
      return null;
    }
  }

  // Handle OAuth callback (called from API route)
  async handleOAuthCallback(code: string, state: string, authConfig: PluginAuthConfig): Promise<UserConnection> {
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
        expires_at: expiresAt,
        scope: tokens.scope || tokens.scopes || null,
        username: profile.name || profile.email || profile.user?.name || profile.user || (plugin_key+' user'),
        email: profile.email,
        profile_data: profile,
        settings: {},
        status: 'active'
      };

      if (this.debug) console.log(`DEBUG: Saving connection for ${plugin_key}`);

      const data = await savePluginConnection(connectionData);

      if (this.debug) console.log(`DEBUG: Connection saved successfully for ${plugin_key}`);

      return data;
    } catch (error) {
      console.error('DEBUG: OAuth callback error:', error);
      throw error;
    }
  }
  
  // Refresh expired token
  async refreshToken(connection: UserConnection, authConfig: PluginAuthConfig): Promise<UserConnection | null> {
    if (this.debug) console.log(`DEBUG: Refreshing token for ${connection.plugin_key}`);
    
    if (!connection.refresh_token) {
      console.error('DEBUG: No refresh token available');
      return null;
    }

    try {
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
        console.error('DEBUG: Token refresh failed:', response.status);
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

      if (this.debug) console.log(`DEBUG: Token refreshed successfully for ${connection.plugin_key}`);
      return data;
    } catch (error) {
      console.error('DEBUG: Token refresh error:', error);
      return null;
    }
  }

  // Disconnect plugin
  async disconnectPlugin(userId: string, pluginKey: string): Promise<boolean> {
    if (this.debug) console.log(`DEBUG: Disconnecting plugin ${pluginKey} for user ${userId}`);
    
    try {
      const { error } = await this.supabase
        .from('plugin_connections')
        .update({ status: 'disconnected' })
        .eq('user_id', userId)
        .eq('plugin_key', pluginKey);

      if (error) {
        console.error('DEBUG: Failed to disconnect plugin:', error);
        return false;
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
      return true; // No expiry means it doesn't expire
    }
    
    const expiryDate = new Date(expiresAt);
    const now = new Date();
    const isValid = expiryDate.getTime() > now.getTime();
    
    if (this.debug) console.log(`DEBUG: Token valid: ${isValid}, expires: ${expiryDate.toISOString()}`);
    
    return isValid;
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
  private getExpiresAt(expires_in: any): string {
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + (expires_in || 3600));
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