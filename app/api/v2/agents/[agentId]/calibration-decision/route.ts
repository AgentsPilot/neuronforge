// app/api/v2/agents/[agentId]/calibration-decision/route.ts
// Records the user's response to the post-creation calibration prompt
// (accepted | declined). Distinct from calibration outcome tracking.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';
import { agentRepository } from '@/lib/repositories/AgentRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CalibrationDecisionAPI', service: 'v6-calibration' });

const bodySchema = z.object({
  decision: z.enum(['accepted', 'declined']),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const { agentId } = await context.params;

    // 1. Authenticate
    const supabase = await createAuthenticatedServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const parsed = bodySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }

    const { decision } = parsed.data;

    // 3. Persist via the repository (user-scoped write)
    const { error } = await agentRepository.recordCalibrationPromptDecision(
      agentId,
      user.id,
      decision
    );

    if (error) {
      requestLogger.error({ err: error, agentId, decision }, 'Failed to record calibration prompt decision');
      return NextResponse.json(
        { success: false, error: 'Failed to record decision' },
        { status: 500 }
      );
    }

    requestLogger.info({ agentId, userId: user.id, decision }, 'Calibration prompt decision recorded');

    return NextResponse.json({ success: true });

  } catch (error) {
    requestLogger.error({ err: error }, 'Calibration decision request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
