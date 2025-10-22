// app/oauth/callback/[plugin]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';

// GET /oauth/callback/[plugin]?code={code}&state={state}
// Handles OAuth callbacks from various plugins (Gmail, Slack, etc.)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ plugin: string }> }
) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const { plugin } = await params;

    console.log(`DEBUG: API - OAuth callback for plugin: ${plugin}`);

    // Check for OAuth errors
    const error = searchParams.get('error');
    if (error) {
      const errorDescription = searchParams.get('error_description');
      console.error(`DEBUG: API - OAuth error from ${plugin}:`, error, errorDescription);
      
      return new NextResponse(`
        <script>
          window.opener.postMessage({
            type: 'plugin-connected',
            plugin: '${plugin}',
            success: false,
            error: '${error}: ${errorDescription || 'OAuth authorization failed'}'
          }, '${process.env.NEXT_PUBLIC_APP_URL}');
          setTimeout(() => window.close(), 100);
        </script>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Validate required parameters
    if (!code || !state) {
      console.error(`DEBUG: API - Missing OAuth parameters for ${plugin}`);
      
      return new NextResponse(`
        <script>
          window.opener.postMessage({
            type: 'plugin-connected',
            plugin: '${plugin}',
            success: false,
            error: 'Missing authorization code or state parameter'
          }, '${process.env.NEXT_PUBLIC_APP_URL}');
          setTimeout(() => window.close(), 100);
        </script>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Get plugin manager and user connections
    const pluginManager = await PluginManagerV2.getInstance();
    const userConnections = UserPluginConnections.getInstance();

    // Map plugin to plugin key (handle variations)
    const pluginKey = mapPluginToPluginKey(plugin);
    
    // Get plugin definition
    const pluginDefinition = pluginManager.getPluginDefinition(pluginKey);
    if (!pluginDefinition) {
      console.error(`DEBUG: API - Plugin definition not found for ${pluginKey}`);
      
      return new NextResponse(`
        <script>
          window.opener.postMessage({
            type: 'plugin-connected',
            plugin: '${plugin}',
            success: false,
            error: 'Plugin configuration not found'
          }, '${process.env.NEXT_PUBLIC_APP_URL}');
          setTimeout(() => window.close(), 100);
        </script>
      `, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Handle OAuth callback
    const connection = await userConnections.handleOAuthCallback(
      code,
      state,
      pluginDefinition.plugin.auth_config,
      request // Pass request for audit trail IP/user-agent extraction
    );

    // Extract and save plugin-specific additional profile data
    await pluginSpecificExtractAndSaveAdditionalProfileData(searchParams, connection, pluginKey, userConnections);

    console.log(`DEBUG: API - OAuth callback successful for ${plugin}, user: ${connection.user_id}`);

    // Return success response that communicates with popup window
    return new NextResponse(`
      <script>
        window.opener.postMessage({
          type: 'plugin-connected',
          plugin: '${plugin}',
          success: true,
          data: {
            plugin_key: '${connection.plugin_key}',
            plugin_name: '${connection.plugin_name}',
            username: '${connection.username}',
            connected_at: '${connection.connected_at}'
          }
        }, '${process.env.NEXT_PUBLIC_APP_URL}');
        setTimeout(() => window.close(), 100);
      </script>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error: any) {
    console.error('DEBUG: API - OAuth callback error:', error);

    const { plugin } = await params;

    return new NextResponse(`
      <script>
        window.opener.postMessage({
          type: 'plugin-connected',
          plugin: '${plugin}',
          success: false,
          error: '${error.message || 'OAuth callback failed'}'
        }, '${process.env.NEXT_PUBLIC_APP_URL}');
        setTimeout(() => window.close(), 100);
      </script>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Helper function to map OAuth plugin to plugin key
function mapPluginToPluginKey(plugin: string): string {
  const pluginMap: Record<string, string> = {
    'gmail': 'google-mail', // not in use
    'google-mail': 'google-mail',
    'google': 'gmail',  // not in use

    'google-drive': 'google-drive',
    'google-sheets': 'google-sheets',
    'google-docs': 'google-docs',

    'slack': 'slack',

    'microsoft': 'outlook',
    'outlook': 'outlook',

    'google-calendar': 'google-calendar',
    'calendar': 'google-calendar',

    'whatsapp': 'whatsapp'
  };

  return pluginMap[plugin] || plugin;
}

// Extract and save plugin-specific additional profile data
async function pluginSpecificExtractAndSaveAdditionalProfileData(
  searchParams: URLSearchParams,
  connection: any,
  pluginKey: string,
  userConnections: UserPluginConnections
): Promise<void> {
  if (pluginKey === 'whatsapp') {
    try {
      // WhatsApp Embedded Signup passes phone_number_id and waba_id as URL parameters
      const phoneNumberId = searchParams.get('phone_number_id');
      const wabaId = searchParams.get('waba_id');
      
      if (phoneNumberId && wabaId) {
        // Update the connection with profile data
        await userConnections.updateConnectionProfileData(
          connection.user_id,
          pluginKey,
          {
            phone_number_id: phoneNumberId,
            waba_id: wabaId
          }
        );
        
        console.log(`DEBUG: Stored WhatsApp profile data - phone_number_id: ${phoneNumberId}, waba_id: ${wabaId}`);
      } else {
        console.warn('DEBUG: WhatsApp OAuth callback missing phone_number_id or waba_id parameters');
        console.warn('DEBUG: Available search params:', Array.from(searchParams.entries()));
      }
    } catch (error) {
      console.error('DEBUG: Failed to store WhatsApp profile data:', error);
      // Don't throw - we don't want to fail the OAuth flow if profile data storage fails
    }
  }  
  // Add other plugin-specific handlers here as needed in the future
  // else if (pluginKey === 'other-plugin') { ... }
}