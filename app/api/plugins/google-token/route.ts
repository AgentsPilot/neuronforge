// app/api/plugins/google-token/route.ts
// Returns OAuth token for Google plugins (for Google Picker integration)

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// Google plugins in priority order
const GOOGLE_PLUGINS = [
  'google-drive',
  'google-sheets',
  'google-docs',
  'google-calendar',
  'google-mail'
];

// GET /api/plugins/google-token?userId={userId} (optional)
// Returns OAuth token from any connected Google plugin
export async function GET(request: NextRequest) {
  try {
    // Try cookie-based authentication first, fall back to query parameter
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    const userId: string | null = user && !authError
      ? user.id
      : new URL(request.url).searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'Authentication required. Please log in or provide userId parameter.'
      }, { status: 401 });
    }

    console.log(`DEBUG: API - Getting Google OAuth token for user ${userId}`);

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Get all connected plugins for the user
    const connectedPlugins = await pluginManager.getConnectedPlugins(userId, { includeSystemPlugins: false });

    // Try each Google plugin to find a valid connection
    for (const pluginKey of GOOGLE_PLUGINS) {
      try {
        const actionablePlugin = connectedPlugins[pluginKey];

        if (actionablePlugin && actionablePlugin.connection) {
          const connection = actionablePlugin.connection;

          if (connection.access_token && connection.access_token !== 'system') {
            console.log(`DEBUG: API - Found valid Google token from ${pluginKey}`);

            // Get scopes from the plugin definition
            const scopes = actionablePlugin.definition?.plugin?.auth_config?.required_scopes || [];

            return NextResponse.json({
              success: true,
              plugin_key: pluginKey,
              access_token: connection.access_token,
              scopes: scopes,
              expires_at: connection.expires_at,
              email: connection.email
            });
          }
        }
      } catch (err) {
        // Continue to next plugin
        console.log(`DEBUG: API - No valid token from ${pluginKey}, trying next...`);
      }
    }

    // No Google plugin connected
    return NextResponse.json({
      success: false,
      error: 'No Google plugin connected',
      message: 'Please connect a Google plugin (Drive, Sheets, Docs, Calendar, or Mail) to use the file picker.',
      available_plugins: GOOGLE_PLUGINS
    }, { status: 404 });

  } catch (error: any) {
    console.error('DEBUG: API - Error getting Google token:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to get Google token',
      message: error.message
    }, { status: 500 });
  }
}