import { NextRequest, NextResponse } from 'next/server';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

/**
 * GET /api/plugins/schema-metadata
 *
 * Returns metadata about which plugin parameters support dynamic options.
 * This allows the frontend to determine which input fields should use dynamic dropdowns
 * without hardcoding any field names or plugin names.
 *
 * Response format:
 * {
 *   "metadata": {
 *     "channel_id": [{ plugin: "slack", action: "send_message", parameter: "channel_id", source: "list_channels" }],
 *     "spreadsheet_id": [{ plugin: "google-sheets", action: "read_range", parameter: "spreadsheet_id", source: "list_spreadsheets" }],
 *     ...
 *   }
 * }
 */
export async function GET(request: NextRequest) {
  try {
    const pluginManager = await PluginManagerV2.getInstance();

    // Get all plugin names - use the method if available, otherwise use core plugin list
    const allPlugins = typeof (pluginManager as any).getAllPluginNames === 'function'
      ? (pluginManager as any).getAllPluginNames()
      : [
          'google-mail',
          'google-drive',
          'google-sheets',
          'google-docs',
          'google-calendar',
          'slack',
          'whatsapp',
          'hubspot',
          'chatgpt-research',
          'linkedin',
          'airtable'
        ];

    // Build a map of parameter names to their dynamic options config
    const metadata: Record<string, { plugin: string; action: string; parameter: string; source: string; depends_on?: string[] }[]> = {};

    for (const pluginName of allPlugins) {
      const pluginDef = pluginManager.getPluginDefinition(pluginName);
      if (!pluginDef || !pluginDef.actions) continue;

      // Scan all actions in this plugin
      for (const actionName of Object.keys(pluginDef.actions)) {
        const actionDef = pluginManager.getActionDefinition(pluginName, actionName);
        if (!actionDef || !actionDef.parameters?.properties) continue;

        // Scan all parameters in this action
        for (const [paramName, paramSchema] of Object.entries(actionDef.parameters.properties)) {
          const dynamicOptions = (paramSchema as any)['x-dynamic-options'];

          if (dynamicOptions && dynamicOptions.source) {
            // This parameter supports dynamic options
            // Store it indexed by parameter name for easy lookup
            if (!metadata[paramName]) {
              metadata[paramName] = [];
            }

            metadata[paramName].push({
              plugin: pluginName,
              action: actionName,
              parameter: paramName,
              source: dynamicOptions.source,
              depends_on: dynamicOptions.depends_on // Include dependency information
            });
          }
        }
      }
    }

    return NextResponse.json({
      metadata,
      timestamp: Date.now()
    });

  } catch (error: any) {
    console.error('[Schema Metadata] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schema metadata', details: error.toString() },
      { status: 500 }
    );
  }
}
