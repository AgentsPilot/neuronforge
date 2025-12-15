// app/api/agents/[id]/memory/count/route.ts
// Get memory count for an agent

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { agentRepository, memoryRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'API', route: '/api/agents/[id]/memory/count' });

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// GET /api/agents/[id]/memory/count - Get memory count for agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { id: agentId } = await params;
  const userId = getUserIdFromRequest(request);

  const requestLogger = logger.child({ correlationId, agentId, userId });

  requestLogger.info('Memory count request received');

  try {
    if (!userId) {
      requestLogger.warn('Unauthorized request - missing userId');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify agent ownership using repository
    const { data: agent, error: agentError } = await agentRepository.findById(agentId, userId);

    if (agentError || !agent) {
      requestLogger.warn({ err: agentError }, 'Agent not found or access denied');
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Count memories using repository
    const { data: count, error: countError } = await memoryRepository.countByAgentId(agentId);

    if (countError) {
      requestLogger.error({ err: countError }, 'Failed to count memories');
      return NextResponse.json(
        { success: false, error: 'Failed to count memories' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ duration, count: count || 0 }, 'Memory count request completed');

    return NextResponse.json({
      success: true,
      count: count || 0,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Memory count request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}