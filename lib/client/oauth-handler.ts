// lib/client/oauth-handler.ts

interface OAuthConfig {
  auth_url: string;
  client_id: string;
  redirect_uri: string;
  required_scopes: string[];
  user_scopes?: string[];
}

interface OAuthResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class OAuthHandler {
  private debug = process.env.NODE_ENV === 'development';

  // Initiate OAuth flow for a plugin
  async initiateOAuth(userId: string, pluginKey: string, authConfig: OAuthConfig): Promise<OAuthResult> {
    if (this.debug) console.log(`DEBUG: Client - Initiating OAuth for ${pluginKey}`);

    try {
      // Generate state parameter for security
      const state = this.generateOAuthState(userId, pluginKey);

      // Build OAuth URL
      const authUrl = new URL(authConfig.auth_url);
      authUrl.searchParams.set('client_id', authConfig.client_id);
      authUrl.searchParams.set('redirect_uri', authConfig.redirect_uri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', authConfig.required_scopes.join(' '));
      if (authConfig.user_scopes && authConfig.user_scopes.length > 0) {
        authUrl.searchParams.set('user_scope', authConfig.user_scopes.join(' '));
      }
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');

      if (this.debug) console.log(`DEBUG: Client - Opening OAuth popup for ${pluginKey}`);

      // Open popup window
      const popup = window.open(
        authUrl.toString(),
        `oauth_${pluginKey}`,
        'width=500,height=600,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site and try again.');
      }

      // Wait for OAuth completion
      const result = await this.waitForOAuthCompletion(popup, pluginKey);

      if (this.debug) console.log(`DEBUG: Client - OAuth completed for ${pluginKey}:`, { success: result.success });

      return result;

    } catch (error: any) {
      console.error(`DEBUG: Client - OAuth error for ${pluginKey}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Wait for OAuth completion via popup communication
  private waitForOAuthCompletion(popup: Window, pluginKey: string): Promise<OAuthResult> {
    return new Promise((resolve, reject) => {
      let messageReceived = false;
      let popupCheckInterval: NodeJS.Timeout;
      let timeoutId: NodeJS.Timeout;

      const cleanup = () => {
        if (popupCheckInterval) clearInterval(popupCheckInterval);
        if (timeoutId) clearTimeout(timeoutId);
        window.removeEventListener('message', messageHandler);
      };

      const messageHandler = (event: MessageEvent) => {
        if (this.debug) console.log(`DEBUG: Client - Received message:`, event.data);

        // Security check - only accept messages from same origin
        if (event.origin !== window.location.origin) {
          if (this.debug) console.log(`DEBUG: Client - Ignoring message from different origin: ${event.origin}`);
          return;
        }

        // Check if this is our plugin connection message
        if (event.data.type === 'plugin-connected' && event.data.plugin === pluginKey) {
          messageReceived = true;
          cleanup();

          if (event.data.success) {
            if (this.debug) console.log(`DEBUG: Client - OAuth successful for ${pluginKey}`);
            resolve({
              success: true,
              data: event.data.data
            });
          } else {
            console.error(`DEBUG: Client - OAuth failed for ${pluginKey}:`, event.data.error);
            resolve({
              success: false,
              error: event.data.error
            });
          }
        }
      };

      // Listen for messages from popup
      window.addEventListener('message', messageHandler);

      // Check if popup was closed manually
      popupCheckInterval = setInterval(() => {
        if (popup.closed) {
          if (!messageReceived) {
            // Give a small delay for any late messages
            setTimeout(() => {
              if (!messageReceived) {
                cleanup();
                if (this.debug) console.log(`DEBUG: Client - OAuth popup closed by user for ${pluginKey}`);
                resolve({
                  success: false,
                  error: 'Authorization window was closed before completion'
                });
              }
            }, 1000);
          }
        }
      }, 2000);

      // Timeout after 5 minutes
      timeoutId = setTimeout(() => {
        if (!popup.closed && !messageReceived) {
          cleanup();
          popup.close();
          if (this.debug) console.log(`DEBUG: Client - OAuth timeout for ${pluginKey}`);
          resolve({
            success: false,
            error: 'Authorization process timed out'
          });
        }
      }, 300000); // 5 minutes
    });
  }

  // Generate secure OAuth state parameter
  private generateOAuthState(userId: string, pluginKey: string): string {
    const state = {
      user_id: userId,
      plugin_key: pluginKey,
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(2)
    };

    return encodeURIComponent(JSON.stringify(state));
  }

  // Check if popups are blocked (utility method)
  async testPopupBlocking(): Promise<boolean> {
    try {
      const testPopup = window.open('', 'popup_test', 'width=1,height=1');
      if (!testPopup) {
        return true; // Popups are blocked
      }
      testPopup.close();
      return false; // Popups are allowed
    } catch (error) {
      return true; // Popups are blocked
    }
  }

  // Get OAuth authorization URL (for manual navigation if popups fail)
  getAuthorizationUrl(userId: string, pluginKey: string, authConfig: OAuthConfig): string {
    const state = this.generateOAuthState(userId, pluginKey);

    const authUrl = new URL(authConfig.auth_url);
    authUrl.searchParams.set('client_id', authConfig.client_id);
    authUrl.searchParams.set('redirect_uri', authConfig.redirect_uri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', authConfig.required_scopes.join(' '));
    if (authConfig.user_scopes && authConfig.user_scopes.length > 0) {
      authUrl.searchParams.set('user_scope', authConfig.user_scopes.join(' '));
    }
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    return authUrl.toString();
  }

  // Handle popup blocked scenario
  async handlePopupBlocked(userId: string, pluginKey: string, authConfig: OAuthConfig): Promise<void> {
    const authUrl = this.getAuthorizationUrl(userId, pluginKey, authConfig);
    
    // Show user instructions for manual OAuth
    const userConfirmed = confirm(
      `Popup blocked! To connect ${pluginKey}, we'll open the authorization page in a new tab. ` +
      'After authorizing, you may need to refresh this page. Continue?'
    );

    if (userConfirmed) {
      window.open(authUrl, '_blank');
    }
  }
}