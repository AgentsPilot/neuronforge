// app/api/shared-agents/exists/route.ts
// Check if an agent is already shared

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { sharedAgentRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'API', route: '/api/shared-agents/exists' });

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// GET /api/shared-agents/exists?agentId=xxx - Check if agent is shared
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const userId = getUserIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  const requestLogger = logger.child({ correlationId, userId, agentId });

  requestLogger.info('Check shared status request received');

  try {
    if (!userId) {
      requestLogger.warn('Unauthorized request - missing userId');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!agentId) {
      requestLogger.warn('Missing agentId query parameter');
      return NextResponse.json(
        { success: false, error: 'agentId query parameter is required' },
        { status: 400 }
      );
    }

    // Check if shared agent exists using repository
    const { data: result, error } = await sharedAgentRepository.existsByOriginalAgent(agentId, userId);

    if (error) {
      requestLogger.error({ err: error }, 'Failed to check shared status');
      return NextResponse.json(
        { success: false, error: 'Failed to check shared status' },
        { status: 500 }
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      { duration, exists: result?.exists, sharedAgentId: result?.sharedAgentId },
      'Shared status check completed'
    );

    return NextResponse.json({
      success: true,
      exists: result?.exists || false,
      sharedAgentId: result?.sharedAgentId || null,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Check shared status request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
