// app/api/llm/context/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', service: 'LLMContext' });

// Force dynamic rendering for this route
export const dynamic = 'force-dynamic';

/**
 * `userId` is still accepted for backward compatibility but is NEVER trusted: it is
 * only compared against the session so a mismatch can be logged. Identity comes from
 * the session, full stop.
 */
const QuerySchema = z.object({
  userId: z.string().min(1).max(200).optional(),
});

/**
 * GET /api/llm/context
 *
 * Returns the caller's plugin context (connected + available) for LLM prompting.
 *
 * SECURITY — this route previously required no authentication and generated the
 * context for whatever `?userId=` the caller supplied, so anyone could enumerate any
 * user's connected plugins (IDOR). Identity is now session-derived.
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Validate input
    const parsed = QuerySchema.safeParse({
      userId: request.nextUrl.searchParams.get('userId') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    // A caller asking for someone else's context is the exact shape of the old bug —
    // serve the session user and leave a trace.
    if (parsed.data.userId && parsed.data.userId !== user.id) {
      requestLogger.warn(
        { sessionUserId: user.id, requestedUserId: parsed.data.userId },
        'Ignoring caller-supplied userId; using session identity'
      );
    }

    const userId = user.id;

    // 3. Execute
    requestLogger.debug({ userId }, 'Generating LLM context');
    const pluginManager = await PluginManagerV2.getInstance();
    const context = await pluginManager.generateLLMContext(userId);

    const connectedPlugins = Object.keys(context.connected_plugins);
    const availablePlugins = Object.keys(context.available_plugins);

    requestLogger.info(
      { userId, connectedCount: connectedPlugins.length, availableCount: availablePlugins.length },
      'LLM context generated'
    );

    // 4. Return — per-session data, never shared-cacheable.
    return NextResponse.json(
      {
        success: true,
        user_id: userId,
        context,
        summary: {
          connected_plugins: connectedPlugins,
          available_plugins: availablePlugins,
          connected_count: connectedPlugins.length,
          available_count: availablePlugins.length,
        },
        generated_at: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Error generating LLM context');

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate LLM context',
        details: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined,
      },
      { status: 500 }
    );
  }
}
