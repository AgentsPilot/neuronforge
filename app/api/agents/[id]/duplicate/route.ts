// app/api/agents/[id]/duplicate/route.ts
// Duplicate an agent

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { agentRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'API', route: '/api/agents/[id]/duplicate' });

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// POST /api/agents/[id]/duplicate - Duplicate an agent
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { id: agentId } = await params;
  const userId = getUserIdFromRequest(request);

  const requestLogger = logger.child({ correlationId, agentId, userId });

  requestLogger.info('Duplicate agent request received');

  try {
    if (!userId) {
      requestLogger.warn('Unauthorized request - missing userId');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Use repository method for duplication
    const { data: duplicatedAgent, error } = await agentRepository.duplicate(agentId, userId);

    if (error) {
      requestLogger.error({ err: error }, 'Failed to duplicate agent');
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to duplicate agent' },
        { status: 500 }
      );
    }

    if (!duplicatedAgent) {
      requestLogger.warn('Agent not found or access denied');
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      { duration, newAgentId: duplicatedAgent.id, newAgentName: duplicatedAgent.agent_name },
      'Agent duplicated successfully'
    );

    return NextResponse.json({
      success: true,
      agent: duplicatedAgent,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Duplicate agent request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}