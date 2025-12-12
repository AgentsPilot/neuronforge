import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedServerClient } from '@/lib/supabaseServer';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';

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

    console.log('[Fetch Options] Request received:', { plugin, action, parameter, refresh, dependentValues });

    // Validate required fields
    if (!plugin || !action || !parameter) {
      return NextResponse.json(
        { error: 'Missing required fields: plugin, action, parameter' },
        { status: 400 }
      );
    }

    // Get user from session
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
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
        console.log(`[Fetch Options] Cache hit for ${cacheKey}`);
        return NextResponse.json({
          options: cached.data,
          cached: true,
          timestamp: cached.timestamp,
        });
      }
    }

    // Get user's plugin connection
    console.log('[Fetch Options] Looking for connection:', { userId, plugin });

    const { data: connections, error: connectionError } = await supabase
      .from('plugin_connections')
      .select('*')
      .eq('user_id', userId)
      .eq('plugin_key', plugin)
      .eq('status', 'active')
      .single();

    console.log('[Fetch Options] Connection query result:', { connections, connectionError });

    if (!connections) {
      // Let's also check what connections exist for this user
      const { data: allConnections } = await supabase
        .from('plugin_connections')
        .select('plugin_key, status')
        .eq('user_id', userId);

      console.log('[Fetch Options] All user connections:', allConnections);

      return NextResponse.json(
        {
          error: `No active connection found for ${plugin}. Please connect this plugin first.`,
          availableConnections: allConnections?.map(c => c.plugin_key) || []
        },
        { status: 404 }
      );
    }

    // Get plugin manager and schema
    const pluginManager = await PluginManagerV2.getInstance();
    const pluginSchema = pluginManager.getPluginDefinition(plugin);

    if (!pluginSchema) {
      return NextResponse.json(
        { error: `Plugin schema not found for ${plugin}` },
        { status: 404 }
      );
    }

    // Find the action schema
    const actionSchema = pluginManager.getActionDefinition(plugin, action);
    if (!actionSchema) {
      return NextResponse.json(
        { error: `Action ${action} not found in ${plugin} plugin` },
        { status: 404 }
      );
    }

    // Find the parameter schema with x-dynamic-options
    const paramSchema = actionSchema.parameters?.properties?.[parameter];
    if (!paramSchema || !paramSchema['x-dynamic-options']) {
      return NextResponse.json(
        { error: `Parameter ${parameter} does not support dynamic options` },
        { status: 400 }
      );
    }

    const dynamicConfig = paramSchema['x-dynamic-options'];
    const fetchMethod = dynamicConfig.source; // e.g., "list_channels", "list_spreadsheets"

    if (!fetchMethod) {
      return NextResponse.json(
        { error: `No fetch method defined in x-dynamic-options for ${parameter}` },
        { status: 400 }
      );
    }

    // Get plugin executor
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const executor = (pluginExecuter as any).getOrCreateExecutor(plugin);

    if (!executor) {
      return NextResponse.json(
        { error: `Plugin executor not found for ${plugin}` },
        { status: 404 }
      );
    }

    // Call the fetch method dynamically
    let options: OptionItem[] = [];

    try {
      if (typeof (executor as any)[fetchMethod] !== 'function') {
        return NextResponse.json(
          { error: `Method ${fetchMethod} not implemented in ${plugin} executor` },
          { status: 501 }
        );
      }

      options = await (executor as any)[fetchMethod](connections, { page, limit, ...dependentValues });

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
        options,
        cached: false,
        timestamp: Date.now(),
        total: options.length,
        page,
        limit,
        hasMore: options.length === limit, // Simple pagination indicator
      });

    } catch (fetchError: any) {
      console.error(`[Fetch Options] Error calling ${fetchMethod}:`, fetchError);
      return NextResponse.json(
        {
          error: `Failed to fetch options: ${fetchError.message}`,
          details: fetchError.toString(),
        },
        { status: 500 }
      );
    }

  } catch (error: any) {
    console.error('[Fetch Options] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.toString() },
      { status: 500 }
    );
  }
}
