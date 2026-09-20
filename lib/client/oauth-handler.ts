// lib/client/oauth-handler.ts

import { clientLogger } from '@/lib/logger/client';
import type { ClientSafeAuthConfig } from '@/lib/plugins/sanitize-plugin-definition';

/**
 * The browser only ever sees a sanitised auth config. These are exactly the fields this
 * handler reads, and they are the reason the allow-list has the shape it does — see
 * lib/plugins/sanitize-plugin-definition.ts. Nothing secret is needed to build an
 * authorize URL: client_id is public by OAuth 2.0 design (RFC 6749 section 2.2).
 */
type OAuthConfig = ClientSafeAuthConfig;

interface OAuthResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class OAuthHandler {
  // Initiate OAuth flow for a plugin
  async initiateOAuth(userId: string, pluginKey: string, authConfig: OAuthConfig): Promise<OAuthResult> {
    clientLogger.debug({ pluginKey }, 'Initiating OAuth');

    try {
      // Generate PKCE parameters if required (must be done before state generation)
      let codeVerifier: string | undefined;
      let codeChallenge: string | undefined;
      if (authConfig.requires_pkce) {
        codeVerifier = this.generateCodeVerifier();
        codeChallenge = await this.generateCodeChallenge(codeVerifier);

        clientLogger.debug({ pluginKey }, 'Generated PKCE parameters');
      }

      // Generate state parameter for security (includes code_verifier for PKCE)
      const state = this.generateOAuthState(userId, pluginKey, codeVerifier);

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

      // Add PKCE parameters if required
      if (authConfig.requires_pkce && codeChallenge) {
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
      }

      // Don't add access_type and prompt for all providers (Airtable doesn't use these)
      if (!authConfig.requires_pkce) {
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');
      }

      clientLogger.debug({ pluginKey }, 'Opening OAuth popup');

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

      clientLogger.debug({ pluginKey, success: result.success }, 'OAuth completed');

      return result;

    } catch (error: any) {
      clientLogger.error({ err: error, pluginKey }, 'OAuth error');
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
        clientLogger.debug({ origin: event.origin, expectedOrigin: window.location.origin }, 'OAuth popup message received');

        // Security check - only accept messages from same origin
        if (event.origin !== window.location.origin) {
          clientLogger.warn({ origin: event.origin }, 'Ignoring OAuth message from different origin');
          return;
        }

        clientLogger.debug({ messageType: event.data?.type, plugin: event.data?.plugin, expectedPlugin: pluginKey }, 'OAuth message inspected');

        // Check if this is our plugin connection message
        if (event.data.type === 'plugin-connected' && event.data.plugin === pluginKey) {
          clientLogger.debug({ pluginKey }, 'Plugin connection message received');
          messageReceived = true;
          cleanup();

          if (event.data.success) {
            clientLogger.debug({ pluginKey }, 'OAuth successful');
            resolve({
              success: true,
              data: event.data.data
            });
          } else {
            clientLogger.error({ pluginKey, err: event.data?.error }, 'OAuth failed');
            resolve({
              success: false,
              error: event.data.error
            });
          }
        }
      };

      // Listen for messages from popup
      clientLogger.debug({ pluginKey }, 'Setting up OAuth message listener');
      window.addEventListener('message', messageHandler);

      // Check if popup was closed manually
      popupCheckInterval = setInterval(() => {
        if (popup.closed) {
          if (!messageReceived) {
            // Give a small delay for any late messages
            setTimeout(() => {
              if (!messageReceived) {
                cleanup();
                clientLogger.debug({ pluginKey }, 'OAuth popup closed by user');
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
          clientLogger.debug({ pluginKey }, 'OAuth timed out');
          resolve({
            success: false,
            error: 'Authorization process timed out'
          });
        }
      }, 300000); // 5 minutes
    });
  }

  // Generate secure OAuth state parameter
  private generateOAuthState(userId: string, pluginKey: string, codeVerifier?: string): string {
    const state: any = {
      user_id: userId,
      plugin_key: pluginKey,
      timestamp: Date.now(),
      random: Math.random().toString(36).substring(2)
    };

    // Include code_verifier in state for PKCE (will be retrieved on server during callback)
    if (codeVerifier) {
      state.code_verifier = codeVerifier;
    }

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
  async getAuthorizationUrl(userId: string, pluginKey: string, authConfig: OAuthConfig): Promise<string> {
    // Generate PKCE parameters if required (must be done before state generation)
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (authConfig.requires_pkce) {
      codeVerifier = this.generateCodeVerifier();
      codeChallenge = await this.generateCodeChallenge(codeVerifier);
    }

    // Generate state parameter for security (includes code_verifier for PKCE)
    const state = this.generateOAuthState(userId, pluginKey, codeVerifier);

    const authUrl = new URL(authConfig.auth_url);
    authUrl.searchParams.set('client_id', authConfig.client_id);
    authUrl.searchParams.set('redirect_uri', authConfig.redirect_uri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', authConfig.required_scopes.join(' '));
    if (authConfig.user_scopes && authConfig.user_scopes.length > 0) {
      authUrl.searchParams.set('user_scope', authConfig.user_scopes.join(' '));
    }
    authUrl.searchParams.set('state', state);

    // Add PKCE parameters if required
    if (authConfig.requires_pkce && codeChallenge) {
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
    }

    // Don't add access_type and prompt for all providers
    if (!authConfig.requires_pkce) {
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
    }

    return authUrl.toString();
  }

  // Handle popup blocked scenario
  async handlePopupBlocked(userId: string, pluginKey: string, authConfig: OAuthConfig): Promise<void> {
    const authUrl = await this.getAuthorizationUrl(userId, pluginKey, authConfig);

    // Show user instructions for manual OAuth
    const userConfirmed = confirm(
      `Popup blocked! To connect ${pluginKey}, we'll open the authorization page in a new tab. ` +
      'After authorizing, you may need to refresh this page. Continue?'
    );

    if (userConfirmed) {
      window.open(authUrl, '_blank');
    }
  }

  // PKCE Helper Methods

  // Generate a random code verifier for PKCE
  private generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return this.base64URLEncode(array);
  }

  // Generate code challenge from verifier using SHA-256
  private async generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return this.base64URLEncode(new Uint8Array(hash));
  }

  // Base64 URL encode (without padding)
  private base64URLEncode(buffer: Uint8Array): string {
    const base64 = btoa(String.fromCharCode(...buffer));
    return base64
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}