/**
 * POST /api/v2/agents/[agentId]/estimate-effort
 *
 * On-demand Effort Estimator trigger. Synchronous — awaits the LLM call
 * (bounded by the 30s retry budget) and returns the new estimate, the
 * previous estimate, attempts count, and duration.
 *
 * This is the canonical entry point for consumers (e.g. the insights module)
 * that need to regenerate `agent_config.roi_estimate` on demand.
 *
 * Route note: `[agentId]` is used as the dynamic segment to match the
 * existing convention in `app/api/v2/agents/[agentId]/...`. Next.js requires
 * a consistent segment name across sibling routes.
 *
 * Response codes:
 *   201 — new estimate written
 *   400 — invalid body (Zod rejected)
 *   401 — unauthenticated
 *   404 — agent not found (also covers wrong-user)
 *   503 — estimator exhausted retries (slot left untouched)
 *   500 — unhandled
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { getUser } from '@/lib/auth';
import { buildUserContextFromAuth } from '@/lib/user-context';
import { estimateEffort } from '@/lib/effort-estimator';

const moduleLogger = createLogger({ module: 'API', service: 'estimate-effort' });

// Empty-body endpoint — reject any unexpected fields so future flags can be
// added intentionally. SA Phase-1 #4: future "force re-fetch" type flags
// should add fields here explicitly, NOT rely on silent passthrough.
const RequestSchema = z.object({}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { agentId } = await params;
  const requestLogger = moduleLogger.child({
    route: '/api/v2/agents/[agentId]/estimate-effort',
    correlationId,
    agentId,
  });

  try {
    const user = await getUser();
    if (!user) {
      requestLogger.warn('Unauthorized — no valid session');
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!agentId) {
      return NextResponse.json({ success: false, error: 'agentId is required' }, { status: 400 });
    }

    // Body is optional (typical: empty `{}`). Tolerate parse failure as empty.
    const rawBody = await request.json().catch(() => ({}));
    const parsed = RequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      requestLogger.warn(
        { issues: parsed.error.issues },
        'Invalid request body for estimate-effort'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details:
            process.env.NODE_ENV === 'development' ? parsed.error.issues : undefined,
        },
        { status: 400 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Estimate-effort request received');

    const result = await estimateEffort({
      agentId,
      userId: user.id,
      // undefined → estimator fetches enhanced_prompt / user_prompt from the agent row.
      enhancedPrompt: undefined,
      userContext: buildUserContextFromAuth(user),
      correlationId,
      reason: 'api_request',
    });

    if (!result.success) {
      // Two failure shapes — "agent not found" surfaced from `findById`, and
      // "retries exhausted" surfaced from `retryWithBackoff`. We distinguish
      // via attempts === 0 (no LLM call ever attempted).
      const isNotFound = result.attempts === 0;
      if (isNotFound) {
        requestLogger.warn({ err: result.errorMessage }, 'Estimate-effort: agent not found');
        return NextResponse.json(
          { success: false, error: 'Agent not found' },
          { status: 404 }
        );
      }
      requestLogger.error(
        { err: result.errorMessage, attempts: result.attempts, durationMs: result.totalDurationMs },
        'Estimate-effort: exhausted retries'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Estimator exhausted retries',
          details:
            process.env.NODE_ENV === 'development' ? result.errorMessage : undefined,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          agentId,
          estimate: result.estimate,
          previousEstimate: result.previousEstimate ?? null,
          attempts: result.attempts,
          durationMs: result.totalDurationMs,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    requestLogger.error({ err }, 'Estimate-effort: unhandled error');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development'
            ? err instanceof Error
              ? err.message
              : String(err)
            : undefined,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST.' },
    { status: 405 }
  );
}
