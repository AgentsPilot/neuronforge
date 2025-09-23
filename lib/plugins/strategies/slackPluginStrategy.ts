// Required environment variables:
// NEXT_PUBLIC_SLACK_CLIENT_ID - Slack OAuth client ID (public)
// NEXT_PUBLIC_SLACK_CLIENT_SECRET - Slack OAuth client secret (server-side only)
// NEXT_PUBLIC_APP_URL - Base URL of the application

import type { PluginStrategy } from '../pluginRegistry';
import { SupabaseClient } from '@supabase/supabase-js';

interface OAuthState {
  user_id: string;
  plugin_key: string;
  timestamp: number;
  random: string;
}

interface SlackProfile {
  id: string;
  name: string;
  email?: string;
  team: {
    id: string;
    name: string;
  };
}

interface SlackTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: {
    id: string;
    name: string;
  };
  enterprise?: {
    id: string;
    name: string;
  };
  authed_user: {
    id: string;
    scope: string;
    access_token: string;
    token_type: string;
  };
}

// Dynamic base URL construction as specified
const getBaseUrl = (): string => {
  //return typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL!;
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL
  const getHttpsUrl = () => {
    if (typeof window !== 'undefined') {
      const isLocalhost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1';
      const isHttps = window.location.protocol === 'https:';
      
      // If we're on localhost with HTTP, use ngrok
      if (isLocalhost && !isHttps) {
        const ngrokUrl = process.env.NEXT_PUBLIC_NGROK_SLACK_REDIRECT_URI || process.env.NGROK_SLACK_REDIRECT_URI;
        
        if (ngrokUrl) {
          return ngrokUrl;
        }
      }
    }
    // Default to base URL for all other cases
    return baseUrl;
  }
  return getHttpsUrl()!;
};

// OAuth configuration constants
const OAUTH_CONFIG = {
  clientId: process.env.NEXT_PUBLIC_SLACK_CLIENT_ID!,
  clientSecret: process.env.NEXT_PUBLIC_SLACK_CLIENT_SECRET!,
  redirectUri: `${getBaseUrl()}/oauth/callback/slack`, // Exact pattern as specified
  scopes: [
    'channels:read',
    'chat:write',
    'chat:write.public',
    'im:read',
    'im:write',
    'users:read',
    'groups:read'
  ],
  timeout: 5 * 60 * 1000 // 5 minutes
};

// Helper functions
const generateState = (userId: string, pluginKey: string): string => {
  const state: OAuthState = {
    user_id: userId,
    plugin_key: pluginKey,
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(2, 15)
  };
  
  return encodeURIComponent(JSON.stringify(state)); // URL encode/decode state parameter properly
};

const verifyAndDecodeState = (state: string): OAuthState => {
  try {
    const decoded = JSON.parse(decodeURIComponent(state)) as OAuthState; // Proper decoding
    
    // Verify timestamp (prevent replay attacks)
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes
    
    if (now - decoded.timestamp > maxAge) {
      throw new Error('State parameter expired');
    }
    
    if (!decoded.user_id || !decoded.plugin_key) {
      throw new Error('Invalid state parameter format');
    }
    
    return decoded;
    
  } catch (error) {
    throw new Error('Invalid or corrupted state parameter');
  }
};

const buildAuthUrl = (state: string): string => {
  const redirectUri = OAUTH_CONFIG.redirectUri;
  
  // Add debug logging
  console.log('Debug - Base URL:', getBaseUrl());
  console.log('Debug - Redirect URI:', redirectUri);
  console.log('Debug - Client ID:', OAUTH_CONFIG.clientId);
  
  const params = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: redirectUri,
    scope: OAUTH_CONFIG.scopes.join(' '),
    response_type: 'code',
    state,
    user_scope: '' // Add this for Slack OAuth v2
  });
  
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
};

const exchangeCodeForTokens = async (code: string): Promise<SlackTokenResponse> => {
  console.log('🔗 Exchanging authorization code for tokens');
  
  const tokenEndpoint = 'https://slack.com/api/oauth.v2.access';
  
  const requestBody = {
    client_id: OAUTH_CONFIG.clientId,
    client_secret: OAUTH_CONFIG.clientSecret,
    code,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    grant_type: 'authorization_code', // Add this
  };
  
  console.log('📤 Token request params:', {
    ...requestBody,
    client_secret: '[REDACTED]'
  });
  
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ HTTP error:', response.status, response.statusText, errorText);
    throw new Error(`Token exchange HTTP error: ${response.status} ${response.statusText}`);
  }

  const tokenData = await response.json();
  
  // Log the full response for debugging (remove in production)
  console.log('📥 Slack API response:', tokenData);
  
  if (!tokenData.ok) {
    console.error('❌ Slack API error:', tokenData.error);
    throw new Error(`Slack API error: ${tokenData.error}`);
  }

  console.log('✅ Tokens obtained successfully');
  return tokenData;
};

const fetchUserProfile = async (accessToken: string): Promise<SlackProfile> => {
  console.log('👤 Fetching user profile');
  
  const profileEndpoint = 'https://slack.com/api/auth.test';
  
  const response = await fetch(profileEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    console.error('❌ Profile fetch failed:', response.statusText);
    throw new Error(`Failed to fetch user profile: ${response.statusText}`);
  }

  const profile = await response.json();
  
  if (!profile.ok) {
    console.error('❌ Slack profile error:', profile.error);
    throw new Error(`Slack profile error: ${profile.error}`);
  }

  console.log('✅ User profile fetched successfully');
  return profile;
};

/**
 * Handles popup-based OAuth flow with exact PostMessage format and race condition prevention
 */
const handlePopupAuth = async (
  authUrl: string, 
  state: string, 
  supabase: SupabaseClient, 
  userId: string,
  popupWindow: Window
): Promise<void> => {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let timeoutId: NodeJS.Timeout;
    let checkClosedInterval: NodeJS.Timeout;

    console.log('📨 Slack handlePopupAuth executed');

    // Cleanup function to prevent race conditions
    const cleanup = () => {
      if (popupWindow && !popupWindow.closed) {
        popupWindow.close();
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (checkClosedInterval) {
        clearInterval(checkClosedInterval);
      }
      window.removeEventListener('message', messageHandler);
      console.log('🧹 OAuth popup cleanup completed');
    };

    
    // Message handler for popup communication with exact format requirement
    const messageHandler = async (event: MessageEvent) => {
      console.log('📨 Slack - Message handler triggered');
      console.log('📨 Event origin:', event.origin);
      console.log('📨 Window origin:', window.location.origin);
      console.log('📨 Event data:', event.data);
      //console.log('📨 Slack - Message handler for popup communication', event);

      // Strict origin validation for security
      const isValidOrigin = (origin: string): boolean => {
        // Allow localhost for development
        if (origin === 'http://localhost:3000') return true;
        
        // Allow your ngrok domain
        if (origin.includes('ngrok-free.dev') || origin.includes('ngrok.io')) return true;
        
        // Allow your production domain
        //if (origin === 'https://yourdomain.com') return true;
        
        return false;
      };

      if (!isValidOrigin(event.origin)) {
        console.warn('🚫 Received message from invalid origin:', event.origin);
        return;
      }

      // Check for exact message format: { type: 'plugin-connected', plugin: 'slack', success: boolean, data/error }
      if (event.data.type !== 'plugin-connected' || event.data.plugin !== 'slack') {
        console.log('📨 Message not for slack plugin:', event.data.type, event.data.plugin);
        return;
      }

      if (resolved) {
        console.log('📨 Already resolved, ignoring message');
        return;
      }

      resolved = true;
      console.log('📨 Valid plugin connection message received');

      try {
        const { success, data, error } = event.data;
        
        if (!success || error) {
          throw new Error(error || 'OAuth failed');
        }
        
        console.log('✅ OAuth completed successfully via message');
        cleanup();
        resolve(); // Simply resolve - the callback page already handled the token exchange
        
      } catch (error) {
        console.error('❌ OAuth message processing failed:', error);
        cleanup();
        reject(error);
      }
    };

    // Set up timeout with cleanup
    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.error('⏳ OAuth popup timeout after 5 minutes');
        cleanup();
        reject(new Error('OAuth popup timeout after 5 minutes'));
      }
    }, OAUTH_CONFIG.timeout);

    // Listen for messages from popup
    window.addEventListener('message', messageHandler);

    // Monitor popup closure with 1-second delay for race conditions
    checkClosedInterval = setInterval(() => {
      if (popupWindow?.closed) {
        console.log('🚪 Popup window closed, waiting 1 second for late messages...');
        clearInterval(checkClosedInterval);
        
        // Wait 1 second for potential late messages
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error('OAuth popup was closed by user'));
          }
        }, 1000);
      }
    }, 2000);

    // Navigate popup to OAuth URL
    try {
      console.log('🔗 Navigating popup to OAuth URL');
      popupWindow.location.href = authUrl;
    } catch (error) {
      console.error('❌ Failed to navigate popup window:', error);
      cleanup();
      reject(error);
    }
  });
};

/**
 * Stores connection data in Supabase database as objects (NOT JSON.stringify)
 */
const storeConnection = async ({
  supabase,
  userId,
  tokenData,
  profile
}: {
  supabase: SupabaseClient;
  userId: string;
  tokenData: SlackTokenResponse;
  profile: SlackProfile;
}): Promise<any> => {
  console.log('💾 Storing Slack connection to database');
  
  const connectionData = {
    user_id: userId,
    plugin_key: 'slack', // MUST use 'slack' consistently
    plugin_name: 'Slack',
    access_token: tokenData.access_token,
    expires_at: null, // Slack tokens don't expire
    scope: tokenData.scope,
    username: profile.name,
    email: profile.email || null,
    profile_data: profile, // Store as object, not JSON.stringify
    settings: {}, // Store as object, not JSON.stringify
    status: 'active',
    connected_at: new Date().toISOString() // Store connected_at timestamp
  };

  const { data, error } = await supabase
    .from('plugin_connections')
    .upsert(connectionData, {
      onConflict: 'user_id,plugin_key'
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Failed to store Slack connection:', error);
    throw new Error(`Failed to store connection: ${error.message}`);
  }

  console.log('✅ Slack connection stored successfully');
  return data;
};

// Main strategy object export
export const slackStrategy: PluginStrategy = {
  pluginKey: 'slack',
  name: 'Slack',
  /**
   * Initiates OAuth 2.0 connection flow with popup window (popup is Window object)
   */
  connect: async ({ supabase, popup, userId }: { 
    supabase: SupabaseClient; 
    popup: Window; // popup is Window object, not boolean
    userId: string; 
  }): Promise<void> => {
    try {
      console.log('📱 Starting Slack OAuth connection for user:', userId);      
      
      if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
        throw new Error('Missing required Slack OAuth environment variables');
      }

      if (!popup || typeof popup.location === 'undefined') {
        throw new Error('Invalid popup window provided');
      }
      
      // Generate secure state parameter with 'slack' plugin key
      const state = generateState(userId, 'slack');
      
      // Build OAuth URL
      const authUrl = buildAuthUrl(state);
      console.log('🔗 OAuth URL generated');
      
      // Handle popup auth with provided Window object
      await handlePopupAuth(authUrl, state, supabase, userId, popup);
    } catch (error) {
      console.error('❌ Slack OAuth connection failed:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to initiate Slack connection: ${errMsg}`);
    }
  },

  /**
   * Handles OAuth callback with authorization code
   */
  handleOAuthCallback: async ({ code, state, supabase }: { 
    code: string; 
    state: string; 
    supabase: SupabaseClient; 
  }): Promise<any> => {
    try {
      console.log('📱 Processing Slack OAuth callback');
      
      // Verify and decode state parameter
      const stateData = verifyAndDecodeState(state);
      console.log('✅ State parameter verified');
      
      // Exchange code for tokens
      const tokenData = await exchangeCodeForTokens(code);
      
      // Fetch user profile
      const profile = await fetchUserProfile(tokenData.access_token);
      
      // Store connection in database
      const connection = await storeConnection({
        supabase,
        userId: stateData.user_id,
        tokenData,
        profile
      });
      
      console.log('✅ Slack connection established successfully');
      return connection;
      
    } catch (error) {
      console.error('❌ Slack OAuth callback failed:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`OAuth callback failed: ${errMsg}`);
    }
  }
};