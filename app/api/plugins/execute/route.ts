// app/api/plugins/execute/route.ts
//
// IDENTITY (POST): the acting user is resolved from the SESSION via
// resolveActingUserIdentity(). A body `userId` is not an identity claim — it is an
// act-as request, honoured only for platform admins and audited. Before this change the
// route took `userId` straight from the body with NO authentication, so an anonymous
// caller could run any plugin action as any user, including actions backed by that
// user's OAuth credentials. See
// docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.
//
// The GET handler is deliberately left public: it returns plugin/action METADATA only,
// no user data, consistent with the metadata-only invariant documented in
// app/api/plugins/action-schema/route.ts.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { resolveActingUserIdentity } from '@/lib/server/route-identity';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PluginExecuteAPI' });

// POST /api/plugins/execute
// Executes a plugin action with parameters
// Force dynamic rendering
export const dynamic = 'force-dynamic'

const ExecuteSchema = z.object({
  // Optional act-as target; identity still comes from the session.
  userId: z.string().optional(),
  pluginName: z.string().min(1),
  actionName: z.string().min(1),
  parameters: z.record(z.any()).optional(),
});

const CatalogueQuerySchema = z.object({
  plugin: z.string().min(1).optional(),
});

function validationError(details: unknown) {
  return NextResponse.json(
    {
      success: false,
      error: 'Invalid request',
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    { status: 400 }
  );
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json().catch(() => null);
    const parsed = ExecuteSchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed');
      return validationError(parsed.error.flatten());
    }

    const { pluginName, actionName, parameters } = parsed.data;

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: 'POST /api/plugins/execute',
      request,
      details: { pluginName, actionName },
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;

    requestLogger.info(
      { pluginName, actionName, userId, actingAs: identity.actingAs },
      'Executing plugin action'
    );

    // Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Verify plugin exists
    const pluginDefinition = pluginManager.getPluginDefinition(pluginName);
    if (!pluginDefinition) {
      return NextResponse.json({
        success: false,
        error: 'Plugin not found',
        message: `Plugin ${pluginName} is not available`
      }, { status: 404 });
    }

    // Verify action exists
    const actionDefinition = pluginManager.getActionDefinition(pluginName, actionName);
    if (!actionDefinition) {
      return NextResponse.json({
        success: false,
        error: 'Action not found',
        message: `Action ${actionName} not found in plugin ${pluginName}`
      }, { status: 404 });
    }

    // Execute action using PluginExecuterV2 — always with the RESOLVED id
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(userId, pluginName, actionName, parameters || {});

    requestLogger.info(
      { pluginName, actionName, userId, success: result.success, hasData: !!result.data },
      'Plugin action execution finished'
    );

    // Return result (success or failure)
    const statusCode = result.success ? 200 : 400;
    return NextResponse.json(result, { status: statusCode });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error executing plugin action');

    return NextResponse.json({
      success: false,
      error: 'Execution failed',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
    }, { status: 500 });
  }
}

// GET /api/plugins/execute (returns available actions — metadata only, no user data)
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { searchParams } = new URL(request.url);
    const parsed = CatalogueQuerySchema.safeParse({
      plugin: searchParams.get('plugin') ?? undefined,
    });
    if (!parsed.success) {
      return validationError(parsed.error.flatten());
    }

    const pluginName = parsed.data.plugin;
    requestLogger.debug({ pluginName }, 'Getting available actions');

    const pluginManager = await PluginManagerV2.getInstance();

    if (pluginName) {
      // Get actions for specific plugin
      const pluginDefinition = pluginManager.getPluginDefinition(pluginName);
      if (!pluginDefinition) {
        return NextResponse.json({
          success: false,
          error: 'Plugin not found'
        }, { status: 404 });
      }

      const actions = Object.entries(pluginDefinition.actions).map(([actionName, action]) => ({
        name: actionName,
        description: action.description,
        usage_context: action.usage_context,
        parameters: action.parameters
      }));

      return NextResponse.json({
        success: true,
        plugin: pluginName,
        actions,
        action_count: actions.length
      });
    } else {
      // Get all available plugins and their actions
      const allPlugins = pluginManager.getAvailablePlugins();
      const pluginActions = Object.entries(allPlugins).map(([pluginKey, definition]) => ({
        plugin: pluginKey,
        name: definition.plugin.name,
        actions: Object.keys(definition.actions),
        action_count: Object.keys(definition.actions).length
      }));

      return NextResponse.json({
        success: true,
        plugins: pluginActions,
        total_plugins: pluginActions.length
      });
    }

  } catch (error) {
    requestLogger.error({ err: error }, 'Error getting plugin actions');

    return NextResponse.json({
      success: false,
      error: 'Failed to get plugin actions',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
    }, { status: 500 });
  }
}
