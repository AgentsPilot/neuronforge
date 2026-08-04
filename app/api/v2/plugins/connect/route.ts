import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

const logger = createLogger({ module: 'PluginConnectAPI' });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get plugin key from request
    const body = await request.json();
    const { plugin_key } = body;

    if (!plugin_key) {
      return NextResponse.json(
        { success: false, error: 'Plugin key is required' },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id, pluginKey: plugin_key }, 'Initiating plugin OAuth connection');

    // Get plugin definition
    const pluginManager = await PluginManagerV2.getInstance();
    const pluginDef = pluginManager.getPluginDefinition(plugin_key);

    if (!pluginDef) {
      requestLogger.error({ pluginKey: plugin_key }, 'Plugin definition not found');
      return NextResponse.json(
        { success: false, error: 'Plugin not found' },
        { status: 404 }
      );
    }

    const authConfig = pluginDef.plugin.auth_config;

    if (!authConfig || !authConfig.auth_url) {
      requestLogger.error({ pluginKey: plugin_key }, 'Plugin does not support OAuth');
      return NextResponse.json(
        { success: false, error: 'Plugin does not support OAuth' },
        { status: 400 }
      );
    }

    // Build OAuth state (include user_id and plugin_key for callback)
    const state = JSON.stringify({
      user_id: user.id,
      plugin_key: plugin_key,
      timestamp: Date.now(),
    });

    // Build OAuth URL
    const redirectUri = authConfig.redirect_uri || `${process.env.NEXT_PUBLIC_APP_URL}/oauth/callback/${plugin_key}`;
    const scope = authConfig.required_scopes?.join(' ') || 'read_write';

    const authUrl = new URL(authConfig.auth_url);
    authUrl.searchParams.set('client_id', authConfig.client_id);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scope);
    authUrl.searchParams.set('state', encodeURIComponent(state));

    requestLogger.info({ userId: user.id, pluginKey: plugin_key, authUrl: authUrl.toString() }, 'OAuth URL generated');

    return NextResponse.json({
      success: true,
      authUrl: authUrl.toString(),
      pluginKey: plugin_key,
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to initiate plugin connection');
    return NextResponse.json(
      { success: false, error: 'Failed to initiate connection' },
      { status: 500 }
    );
  }
}
