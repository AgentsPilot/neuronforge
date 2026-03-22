// lib/services/OAuthTokenService.ts
// Stateless service for OAuth HTTP interactions with external providers.
// Handles token exchange, token refresh, and user profile fetching.

import { PluginAuthConfig } from '@/lib/types/plugin-types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'OAuthTokenService', service: 'oauth' });

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  scopes?: string;
  // Slack-specific: user token returned separately
  authed_user?: { access_token: string };
  [key: string]: unknown;
}

/**
 * Builds OAuth request headers and body, handling PKCE vs standard credential placement.
 * PKCE flows send credentials via Basic Auth header; standard flows send in body.
 */
function buildOAuthRequest(
  authConfig: PluginAuthConfig,
  params: Record<string, string>,
  usePkce: boolean
): { headers: Record<string, string>; body: URLSearchParams } {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
  };

  if (usePkce) {
    const credentials = Buffer.from(`${authConfig.client_id}:${authConfig.client_secret}`).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
    logger.debug('Using Basic Auth header (PKCE flow)');
  } else {
    params.client_id = authConfig.client_id;
    params.client_secret = authConfig.client_secret;
    logger.debug('Sending credentials in request body (standard OAuth flow)');
  }

  return { headers, body: new URLSearchParams(params) };
}

/**
 * Exchanges an authorization code for OAuth tokens.
 *
 * @param code - The authorization code from the OAuth callback
 * @param authConfig - The plugin's OAuth configuration
 * @param codeVerifier - Optional PKCE code_verifier (present for PKCE flows like Airtable)
 * @returns The token response from the provider
 */
export async function exchangeCodeForTokens(
  code: string,
  authConfig: PluginAuthConfig,
  codeVerifier?: string
): Promise<OAuthTokenResponse> {
  logger.debug({ tokenUrl: authConfig.token_url, hasPkce: !!codeVerifier }, 'Exchanging code for tokens');

  const params: Record<string, string> = {
    code,
    grant_type: 'authorization_code',
    redirect_uri: authConfig.redirect_uri,
  };

  if (codeVerifier) {
    params.code_verifier = codeVerifier;
  }

  const { headers, body } = buildOAuthRequest(authConfig, params, !!codeVerifier);

  const response = await fetch(authConfig.token_url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, errorText }, 'Token exchange failed');
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const tokens: OAuthTokenResponse = await response.json();

  if (!tokens.access_token) {
    throw new Error('No access token received');
  }

  logger.debug({ hasAccessToken: true, hasRefreshToken: !!tokens.refresh_token }, 'Token exchange successful');
  return tokens;
}

/**
 * Refreshes an expired OAuth access token using a refresh token.
 *
 * @param refreshToken - The refresh token to exchange
 * @param authConfig - The plugin's OAuth configuration
 * @returns The new token response, or null if refresh failed
 */
export async function refreshAccessToken(
  refreshToken: string,
  authConfig: PluginAuthConfig
): Promise<OAuthTokenResponse | null> {
  logger.debug({ refreshUrl: authConfig.refresh_url }, 'Refreshing access token');

  const params: Record<string, string> = {
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };

  const { headers, body } = buildOAuthRequest(authConfig, params, !!authConfig.requires_pkce);

  const response = await fetch(authConfig.refresh_url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, errorText }, 'Token refresh failed');
    return null;
  }

  const tokens: OAuthTokenResponse = await response.json();
  logger.debug({ hasAccessToken: !!tokens.access_token }, 'Token refresh successful');
  return tokens;
}

/**
 * Fetches the user profile from the OAuth provider's profile endpoint.
 *
 * @param accessToken - The access token to use for the profile request
 * @param authType - The authentication type (determines fallback profile URL)
 * @param profileUrl - Optional explicit profile URL (overrides authType-based defaults)
 * @returns The raw profile data from the provider
 */
export async function fetchUserProfile(
  accessToken: string,
  authType: string,
  profileUrl?: string
): Promise<Record<string, any>> {
  logger.debug({ authType, profileUrl }, 'Fetching user profile');

  // Use provided profile_url if available, otherwise fall back to known defaults
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

/**
 * Calculates the ISO date string for when a token expires, given the `expires_in` seconds value.
 *
 * @param expiresIn - Number of seconds until the token expires, or falsy if no expiry
 * @returns ISO date string for the expiration time, or null if the token doesn't expire
 */
export function calculateExpiresAt(expiresIn: number | undefined | null): string | null {
  if (!expiresIn) {
    return null;
  }
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + expiresIn);
  return expiresAt.toISOString();
}
