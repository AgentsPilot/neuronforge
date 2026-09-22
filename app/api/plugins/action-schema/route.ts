import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

/**
 * GET /api/plugins/action-schema?plugin=<key>[&action=<name>]
 *
 * Read-only endpoint that returns the full per-action schema block the Plugin API
 * Tester needs to (a) generate its input form (FR3) and (b) drive the destructive
 * confirm gate (FR6): `parameters`, `required_params`/`optional_params`, `rules`,
 * `capability`, `idempotent`, `output_schema`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * METADATA-ONLY INVARIANT (SA decision Q1 — CR3), AS AMENDED (F12):
 *   This endpoint returns ONLY plugin-definition metadata sourced from the static
 *   definition JSON — NEVER any user data, plugin connections, or OAuth tokens. That
 *   part still holds, and it is why the response body needs no projection.
 *   It is no longer UNAUTHENTICATED. The original justification — "a strict superset
 *   of the already-unauthenticated GET /api/plugins/execute" — died when that GET was
 *   gated (F10), and this route exposes MORE than it did (every action's parameter and
 *   output schema). Leaving it open made F10 symbolic: an attacker simply enumerated
 *   the registry here instead. A session is now required, same shape as
 *   GET /api/plugins/available and GET /api/plugins/execute.
 *   If this endpoint is ever extended to return anything user-scoped, the authz level
 *   (getUser vs AdminAccessService) MUST be revisited again.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * F1 compliance: Zod-validated query, Pino createLogger + correlationId, standard
 * error envelope (400 Zod / 404 unknown plugin+action / 500 guarded). No secrets.
 */

const logger = createLogger({ module: 'API', service: 'PluginActionSchema' });

const querySchema = z.object({
  plugin: z.string().min(1, 'plugin is required'),
  action: z.string().min(1).optional(),
});

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Authenticate — the registry is not public information (see header comment).
    const user = await getUser();
    if (!user) {
      // Session-dependent denial: no shared cache may store and replay it (QA-2, F11 rule).
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } }
      );
    }

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      plugin: searchParams.get('plugin') ?? undefined,
      action: searchParams.get('action') ?? undefined,
    });

    if (!parsed.success) {
      requestLogger.warn({ issues: parsed.error.issues }, 'Invalid action-schema query');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid query parameters',
          details:
            process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { plugin, action } = parsed.data;

    const pluginManager = await PluginManagerV2.getInstance();
    const pluginDef = pluginManager.getPluginDefinition(plugin);

    if (!pluginDef || !pluginDef.actions) {
      requestLogger.warn({ plugin }, 'Unknown plugin requested');
      return NextResponse.json(
        { success: false, error: `Unknown plugin: ${plugin}` },
        { status: 404 }
      );
    }

    // Project a single action definition into the metadata-only response shape.
    const projectAction = (name: string, def: NonNullable<ReturnType<typeof pluginManager.getActionDefinition>>) => ({
      name,
      description: def.description,
      parameters: def.parameters,
      required_params: def.required_params ?? def.parameters?.required ?? [],
      optional_params: def.optional_params ?? [],
      capability: def.capability,
      idempotent: def.idempotent,
      rules: def.rules,
      output_schema: def.output_schema,
    });

    if (action) {
      const actionDef = pluginManager.getActionDefinition(plugin, action);
      if (!actionDef) {
        requestLogger.warn({ plugin, action }, 'Unknown action requested');
        return NextResponse.json(
          { success: false, error: `Unknown action: ${action} on plugin ${plugin}` },
          { status: 404 }
        );
      }

      requestLogger.info({ plugin, action }, 'Action schema fetched');
      return NextResponse.json({
        success: true,
        plugin,
        actions: [projectAction(action, actionDef)],
        action_count: 1,
      });
    }

    const actions = Object.keys(pluginDef.actions).map((name) =>
      projectAction(name, pluginDef.actions[name])
    );

    requestLogger.info({ plugin, actionCount: actions.length }, 'Plugin action schemas fetched');
    return NextResponse.json({
      success: true,
      plugin,
      actions,
      action_count: actions.length,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to fetch action schema');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch action schema',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
