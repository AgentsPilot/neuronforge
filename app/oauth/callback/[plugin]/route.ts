// app/oauth/callback/[plugin]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import type { Logger } from 'pino';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';

const logger = createLogger({ module: 'OAuthCallbackAPI' });

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

/** Escape a string for safe embedding inside a JS single-quoted literal. */
function escapeJs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\x3c')
    .replace(/>/g, '\\x3e')
    .replace(/\n/g, '\\n');
}

/** Build an HTML page that posts a message to the opener window and closes itself. */
function buildPostMessageResponse(
  plugin: string,
  payload: { success: boolean; error?: string; data?: Record<string, string> }
): NextResponse {
  const safePlugin = escapeJs(plugin);
  const safeOrigin = escapeJs(APP_URL);

  const dataBlock = payload.data
    ? `,\n              data: { ${Object.entries(payload.data).map(([k, v]) => `${k}: '${escapeJs(v)}'`).join(', ')} }`
    : '';

  const errorBlock = payload.error
    ? `,\n              error: '${escapeJs(payload.error)}'`
    : '';

  const bodyHtml = payload.success
    ? '<h3>Authorization Successful!</h3><p>Closing window...</p>'
    : '';

  const noOpenerFallback = payload.success
    ? `\n            } else {\n              document.body.innerHTML += '<p style="color: red;">Error: Could not communicate with parent window. Please close this window and try again.</p>';`
    : `\n            } else {\n              window.close();`;

  return new NextResponse(
    `<html><body>${bodyHtml}<script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'plugin-connected',
                plugin: '${safePlugin}',
                success: ${payload.success}${errorBlock}${dataBlock}
              }, '${safeOrigin}');
              setTimeout(() => window.close(), ${payload.success ? 500 : 100});
${noOpenerFallback}
            }
          </script></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}

// GET /oauth/callback/[plugin]?code={code}&state={state}
// Handles OAuth callbacks from various plugins (Gmail, Slack, etc.)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ plugin: string }> }
) {
  const { plugin } = await params;
  const requestLogger = logger.child({ plugin });

  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');

    requestLogger.info('OAuth callback received');

    // Check for OAuth errors from provider
    const oauthError = searchParams.get('error');
    if (oauthError) {
      const errorDescription = searchParams.get('error_description');
      requestLogger.error({ oauthError, errorDescription }, 'OAuth error from provider');

      return buildPostMessageResponse(plugin, {
        success: false,
        error: `${oauthError}: ${errorDescription || 'OAuth authorization failed'}`,
      });
    }

    // Validate required parameters
    if (!code || !state) {
      requestLogger.error('Missing OAuth code or state parameter');

      return buildPostMessageResponse(plugin, {
        success: false,
        error: 'Missing authorization code or state parameter',
      });
    }

    // Get plugin manager and user connections
    const pluginManager = await PluginManagerV2.getInstance();
    const userConnections = UserPluginConnections.getInstance();

    // Get plugin definition
    const pluginDefinition = pluginManager.getPluginDefinition(plugin);
    if (!pluginDefinition) {
      requestLogger.error({ plugin }, 'Plugin definition not found');

      return buildPostMessageResponse(plugin, {
        success: false,
        error: 'Plugin configuration not found',
      });
    }

    // Handle OAuth callback
    const connection = await userConnections.handleOAuthCallback(
      code,
      state,
      pluginDefinition.plugin.auth_config,
      request
    );

    // Extract and save plugin-specific profile data (driven by plugin definition)
    await extractPluginProfileData(searchParams, connection, pluginDefinition, userConnections, requestLogger);

    requestLogger.info({ userId: connection.user_id }, 'OAuth callback successful');

    return buildPostMessageResponse(plugin, {
      success: true,
      data: {
        plugin_key: connection.plugin_key,
        plugin_name: connection.plugin_name,
        username: connection.username || '',
        connected_at: connection.connected_at,
      },
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'OAuth callback failed');

    return buildPostMessageResponse(plugin, {
      success: false,
      error: error instanceof Error ? error.message : 'OAuth callback failed',
    });
  }
}

/** Extract and save plugin-specific profile data based on oauth_callback_profile_params in the plugin definition. */
async function extractPluginProfileData(
  searchParams: URLSearchParams,
  connection: any,
  pluginDefinition: any,
  userConnections: UserPluginConnections,
  requestLogger: Logger
): Promise<void> {
  const profileParams: string[] | undefined = pluginDefinition.plugin.auth_config?.oauth_callback_profile_params;
  if (!profileParams?.length) return;

  try {
    const profileData: Record<string, string> = {};
    for (const param of profileParams) {
      const value = searchParams.get(param);
      if (value) profileData[param] = value;
    }

    if (Object.keys(profileData).length > 0) {
      await userConnections.updateConnectionProfileData(
        connection.user_id,
        connection.plugin_key,
        profileData
      );
      requestLogger.info({ profileData }, 'Stored plugin profile data');
    } else {
      requestLogger.warn(
        { expectedParams: profileParams, received: Object.fromEntries(searchParams.entries()) },
        'OAuth callback missing expected profile params'
      );
    }
  } catch (error) {
    // Don't throw - profile data storage failure shouldn't break the OAuth flow
    requestLogger.error({ err: error }, 'Failed to store plugin profile data');
  }
}
