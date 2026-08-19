// app/api/plugins/disconnect/route.ts
//
// IDENTITY: both handlers resolve the acting user from the SESSION via
// resolveActingUserIdentity(). A caller-supplied `userId` is not an identity claim — it
// is an act-as request, honoured only for platform admins and audited. Before this
// change POST took `userId` from the body with NO authentication, so an anonymous
// caller could disconnect any user's plugin; GET disclosed any user's connection state.
// See docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { resolveActingUserIdentity } from '@/lib/server/route-identity';
import { createLogger } from '@/lib/logger';
import { pluginStatusCache } from '../user-status/route';

const logger = createLogger({ module: 'PluginDisconnectAPI' });

// Force dynamic rendering
export const dynamic = 'force-dynamic'

const DisconnectSchema = z.object({
  // Optional act-as target; identity still comes from the session.
  userId: z.string().optional(),
  pluginKey: z.string().min(1),
});

const StatusQuerySchema = z.object({
  userId: z.string().optional(),
  pluginKey: z.string().min(1),
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

// POST /api/plugins/disconnect
// Disconnects a plugin for the acting user
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const body = await request.json().catch(() => null);
    const parsed = DisconnectSchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ errors: parsed.error.flatten() }, 'Validation failed');
      return validationError(parsed.error.flatten());
    }

    const { pluginKey } = parsed.data;

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: 'POST /api/plugins/disconnect',
      request,
      details: { pluginKey },
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;

    requestLogger.info({ pluginKey, userId, actingAs: identity.actingAs }, 'Disconnecting plugin');

    // Get user connections instance
    const userConnections = UserPluginConnections.getInstance();

    // Disconnect the plugin (pass request for audit trail)
    const success = await userConnections.disconnectPlugin(userId, pluginKey, request);

    if (success) {
      // Invalidate cache so next request gets fresh data — keyed on the RESOLVED id, so
      // an act-as call can never touch another user's cache entry.
      pluginStatusCache.invalidate(`plugin-status-${userId}`);
      requestLogger.info({ pluginKey, userId }, 'Plugin disconnected and status cache invalidated');

      return NextResponse.json({
        success: true,
        message: `${pluginKey} disconnected successfully`,
        plugin_key: pluginKey,
        user_id: userId,
        disconnected_at: new Date().toISOString()
      });
    }

    requestLogger.warn({ pluginKey, userId }, 'Disconnect did not affect any connection');

    return NextResponse.json({
      success: false,
      error: 'Disconnect failed',
      message: `Failed to disconnect ${pluginKey}. The plugin may not be connected or there was a database error.`
    }, { status: 400 });

  } catch (error) {
    requestLogger.error({ err: error }, 'Error disconnecting plugin');

    return NextResponse.json({
      success: false,
      error: 'Disconnect failed',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
    }, { status: 500 });
  }
}

// GET /api/plugins/disconnect?pluginKey={pluginKey}
// Check if a plugin can be disconnected (for UI state)
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { searchParams } = new URL(request.url);
    const parsed = StatusQuerySchema.safeParse({
      userId: searchParams.get('userId') ?? undefined,
      pluginKey: searchParams.get('pluginKey') ?? undefined,
    });
    if (!parsed.success) {
      return validationError(parsed.error.flatten());
    }

    const { pluginKey } = parsed.data;

    const identity = await resolveActingUserIdentity({
      requestedUserId: parsed.data.userId,
      route: 'GET /api/plugins/disconnect',
      request,
      details: { pluginKey },
    });
    if (!identity.ok) {
      return NextResponse.json(
        { success: false, error: identity.error },
        { status: identity.status }
      );
    }
    const userId = identity.userId;

    requestLogger.debug({ pluginKey, userId }, 'Checking disconnect status');

    // Get user connections instance
    const userConnections = UserPluginConnections.getInstance();

    // Check connection status
    const status = await userConnections.getConnectionStatus(userId, pluginKey);

    return NextResponse.json(
      {
        success: true,
        plugin_key: pluginKey,
        user_id: userId,
        can_disconnect: status.connected,
        current_status: status.reason,
        expires_at: status.expires_at
      },
      // User-specific data: never store in a shared cache.
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );

  } catch (error) {
    requestLogger.error({ err: error }, 'Error checking disconnect status');

    return NextResponse.json({
      success: false,
      error: 'Status check failed',
      message: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
    }, { status: 500 });
  }
}
