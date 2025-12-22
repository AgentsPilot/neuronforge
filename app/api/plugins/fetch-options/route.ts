import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', service: 'PluginFetchOptions' });

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

// Simple in-memory cache with TTL
const optionsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface FetchOptionsRequest {
  plugin: string;
  action: string;
  parameter: string;
  refresh?: boolean;
  page?: number;
  limit?: number;
  dependentValues?: Record<string, any>; // Values of dependent parameters
}

interface OptionItem {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: FetchOptionsRequest = await request.json();
    const { plugin, action, parameter, refresh = false, page = 1, limit = 100, dependentValues = {} } = body;

    logger.debug({ plugin, action, parameter, refresh, dependentValues }, 'Request received');

    // Validate required fields
    if (!plugin || !action || !parameter) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: plugin, action, parameter' },
        { status: 400 }
      );
    }

    // Get user from session
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = user.id;

    // Generate cache key - include dependentValues for cascading dropdowns
    const dependentValuesKey = Object.keys(dependentValues).length > 0
      ? `:${JSON.stringify(dependentValues)}`
      : '';
    const cacheKey = `${userId}:${plugin}:${action}:${parameter}:${page}:${limit}${dependentValuesKey}`;

    // Check cache (unless refresh is requested)
    if (!refresh) {
      const cached = optionsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        logger.debug({ cacheKey }, 'Cache hit');
        return NextResponse.json({
          success: true,
          options: cached.data,
          cached: true,
          timestamp: cached.timestamp,
        }, {
          headers: {
            'X-Cache': 'HIT',
            'Cache-Control': 'private, max-age=300'
          }
        });
      }
    }

    // Get plugin executor facade (single entry point for all plugin operations)
    const pluginExecuter = await PluginExecuterV2.getInstance();

    // Get plugin schema via facade
    const pluginSchema = pluginExecuter.pluginManager.getPluginDefinition(plugin);
    if (!pluginSchema) {
      return NextResponse.json(
        { success: false, error: `Plugin schema not found for ${plugin}` },
        { status: 404 }
      );
    }

    // Get user's plugin connection via facade (includes smart token refresh)
    logger.debug({ userId, plugin }, 'Looking for connection');
    const connection = await pluginExecuter.userConnections.getConnection(
      userId,
      plugin,
      pluginSchema.plugin.auth_config
    );

    if (!connection) {
      logger.warn({ userId, plugin }, 'No active connection found');
      return NextResponse.json(
        {
          success: false,
          error: `No active connection found for ${plugin}. Please connect this plugin first.`
        },
        { status: 404 }
      );
    }

    // Find the action schema
    const actionSchema = pluginExecuter.pluginManager.getActionDefinition(plugin, action);
    if (!actionSchema) {
      return NextResponse.json(
        { success: false, error: `Action ${action} not found in ${plugin} plugin` },
        { status: 404 }
      );
    }

    // Find the parameter schema with x-dynamic-options
    const paramSchema = actionSchema.parameters?.properties?.[parameter];
    if (!paramSchema || !paramSchema['x-dynamic-options']) {
      return NextResponse.json(
        { success: false, error: `Parameter ${parameter} does not support dynamic options` },
        { status: 400 }
      );
    }

    const dynamicConfig = paramSchema['x-dynamic-options'];
    const fetchMethod = dynamicConfig.source; // e.g., "list_channels", "list_spreadsheets"

    if (!fetchMethod) {
      return NextResponse.json(
        { success: false, error: `No fetch method defined in x-dynamic-options for ${parameter}` },
        { status: 400 }
      );
    }

    // Fetch dynamic options
    let options: OptionItem[] = [];

    try {
      options = await pluginExecuter.fetchDynamicOptions(
        plugin,
        fetchMethod,
        connection,
        { page, limit, ...dependentValues }
      );

      // Cache the results
      optionsCache.set(cacheKey, {
        data: options,
        timestamp: Date.now(),
      });

      // Clean old cache entries (simple cleanup)
      if (optionsCache.size > 1000) {
        const now = Date.now();
        for (const [key, value] of optionsCache.entries()) {
          if (now - value.timestamp > CACHE_TTL_MS) {
            optionsCache.delete(key);
          }
        }
      }

      return NextResponse.json({
        success: true,
        options,
        cached: false,
        timestamp: Date.now(),
        total: options.length,
        page,
        limit,
        hasMore: options.length === limit, // Simple pagination indicator
      }, {
        headers: {
          'X-Cache': 'MISS',
          'Cache-Control': 'private, max-age=300'
        }
      });

    } catch (fetchError: any) {
      logger.error({ err: fetchError, fetchMethod, plugin }, 'Error calling fetch method');
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch options',
          message: fetchError.message
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    logger.error({ err: error }, 'Unexpected error');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        message: error.message
      },
      { status: 500 }
    );
  }
}
