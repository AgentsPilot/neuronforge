import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
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
 *   "success": true,
 *   "data": {
 *     "metadata": {
 *       "channel_id": [{ plugin: "slack", action: "send_message", parameter: "channel_id", source: "list_channels" }],
 *       "spreadsheet_id": [{ plugin: "google-sheets", action: "read_range", parameter: "spreadsheet_id", source: "list_spreadsheets" }],
 *       ...
 *     },
 *     "timestamp": 1234567890
 *   }
 * }
 */

const logger = createLogger({ module: 'SchemaMetadataAPI' });

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const pluginManager = await PluginManagerV2.getInstance();
    const allPlugins = pluginManager.getAllPluginNames();

    // Build a map of parameter names to their dynamic options config
    const metadata: Record<string, { plugin: string; action: string; parameter: string; source: string; depends_on?: string[] }[]> = {};

    for (const pluginName of allPlugins) {
      const pluginDef = pluginManager.getPluginDefinition(pluginName);
      if (!pluginDef || !pluginDef.actions) continue;

      for (const actionName of Object.keys(pluginDef.actions)) {
        const actionDef = pluginManager.getActionDefinition(pluginName, actionName);
        if (!actionDef || !actionDef.parameters?.properties) continue;

        for (const [paramName, paramSchema] of Object.entries(actionDef.parameters.properties)) {
          const dynamicOptions = (paramSchema as any)['x-dynamic-options'];

          if (dynamicOptions && dynamicOptions.source) {
            if (!metadata[paramName]) {
              metadata[paramName] = [];
            }

            metadata[paramName].push({
              plugin: pluginName,
              action: actionName,
              parameter: paramName,
              source: dynamicOptions.source,
              depends_on: dynamicOptions.depends_on
            });
          }
        }
      }
    }

    requestLogger.info({ userId: user.id, pluginCount: allPlugins.length }, 'Schema metadata fetched');

    return NextResponse.json({
      success: true,
      data: { metadata, timestamp: Date.now() }
    });

  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch schema metadata');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch schema metadata',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined
      },
      { status: 500 }
    );
  }
}
