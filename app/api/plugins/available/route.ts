// app/api/plugins/available/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { isPluginDiscoverable } from '@/lib/plugins/plugin-visibility';
import { toClientPluginInfo } from '@/lib/plugins/sanitize-plugin-definition';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', service: 'PluginsAvailable' });

/**
 * `includeBusinessOs` is an explicit enum rather than a truthiness check so a typo
 * (`?includeBusinessOs=ture`) fails loudly instead of silently hiding Business OS plugins.
 */
const QuerySchema = z.object({
  includeBusinessOs: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

/**
 * Every response here is per-session, the failures included: a shared cache that stored
 * a 401 (or a 400 keyed without the cookie) would replay it to the next caller.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };

/**
 * GET /api/plugins/available
 *
 * Returns the plugin registry (regardless of the caller's connections).
 *
 * SECURITY — this route previously required no authentication and returned each
 * definition's full `auth_config` *after* env substitution, i.e. real OAuth client
 * secrets and the live `STRIPE_SECRET_KEY`. Two independent guards now apply:
 *   1. every response element goes through `toClientPluginInfo()`, which allow-lists the
 *      `auth_config` fields — this is the load-bearing fix; and
 *   2. a session is required — all four known callers are already authenticated.
 * Do not reintroduce a raw `definition.plugin.auth_config` here: the branded
 * `ClientSafeAuthConfig` type makes that a compile error.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate — the registry is not public information.
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    // 2. Validate input
    const parsed = QuerySchema.safeParse({
      includeBusinessOs: request.nextUrl.searchParams.get('includeBusinessOs') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
    const { includeBusinessOs } = parsed.data;

    // 3. Execute — singleton with cold-start handling
    const pluginManager = await PluginManagerV2.getInstance();
    const availablePlugins = pluginManager.getAvailablePlugins();

    // Discovery-scoped: hide business_os plugins unless the caller explicitly opts in
    // (?includeBusinessOs=true). The public UI/settings list omits them; the internal
    // test page opts in. See docs/PLUGIN_VISIBILITY_SCOPING.md.
    const plugins = Object.entries(availablePlugins)
      .filter(([, definition]) => isPluginDiscoverable(definition, includeBusinessOs))
      .map(([key, definition]) => toClientPluginInfo(key, definition));

    requestLogger.debug(
      { userId: user.id, pluginCount: plugins.length, includeBusinessOs },
      'Available plugins listed'
    );

    // 4. Return — per-session response, so no shared/CDN cache may store it.
    return NextResponse.json(
      { success: true, plugins, total: plugins.length },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Error getting available plugins');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get available plugins',
        // Never leak internals in production (CLAUDE.md § Error Response Format).
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
