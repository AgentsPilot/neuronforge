// app/api/test/analyze-prompt/route.ts
// Test endpoint for analyzePromptDirectAgentKit, driven by the internal
// /test-plugins-v2 harness ("AI service" = `test/analyze-prompt`).
//
// ── GATED, not deleted — and the difference matters ───────────────────────
// SA's Slice 0 ruling was to DELETE this route as callerless. It is NOT callerless:
// `app/test-plugins-v2/page.tsx` drives it as a selectable AI service, with its own
// request template (:682), provider/model selector (:3116), plugin-context loader
// (:3182) and a dispatch through `fetch(`/api/${selectedAIService}`)` (:1444). The
// endpoint name only ever appears as a VALUE, never as a fetch literal, which is why a
// path grep reports zero callers. Deleting it would have silently broken an internal
// tool, so it is gated instead and the discrepancy is recorded for SA.
//
// The hole it had was real: `userId` came from the request body and flowed into
// `analyzePromptDirectAgentKit` -> `convertPluginsToTools(userId, …)` and
// `getPluginContextPrompt(userId, …)`, which read that account's connected plugins and
// action catalogue and summarised them back through an LLM. An anonymous caller who knew
// a user id got an inventory of that user's connected services.
//
// Identity is now `getUser()` only; the body `userId` is not read.
// Middleware does not authenticate `/api/*` (middleware.ts:83).
//
// See docs/workplans/IDENTITY_SWEEP_WORKPLAN.md § Slice 0.

import { NextRequest, NextResponse } from 'next/server';
import { analyzePromptDirectAgentKit } from '@/lib/agentkit/analyzePrompt-v3-direct';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'API', route: '/api/test/analyze-prompt' });

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Gate before the body is parsed: this route spends an LLM call and reads plugin
    // connections, neither of which an anonymous caller should reach.
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { prompt, availablePlugins } = body;

    if (!prompt) {
      return NextResponse.json(
        { success: false, error: 'prompt is required' },
        { status: 400 }
      );
    }

    const pluginKeys = availablePlugins || [];

    // The analysis always runs against the SESSION user's plugin connections.
    requestLogger.info(
      { userId: user.id, pluginCount: pluginKeys.length, promptLength: prompt.length },
      'Direct prompt analysis requested'
    );

    const result = await analyzePromptDirectAgentKit(
      user.id,
      prompt,
      pluginKeys
    );

    return NextResponse.json({
      success: true,
      result
    });
  } catch (error: any) {
    requestLogger.error({ err: error }, 'Direct prompt analysis failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to analyze prompt',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined
      },
      { status: 500 }
    );
  }
}
