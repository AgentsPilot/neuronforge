// app/api/agents/[id]/status/route.ts
// Update agent status (pause/activate)

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { AgentRepository } from '@/lib/repositories/AgentRepository';

const logger = createLogger({ module: 'AgentStatusAPI' });
const agentRepository = new AgentRepository();

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// POST /api/agents/[id]/status - Update agent status
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { id: agentId } = await params;
  const userId = getUserIdFromRequest(request);

  const requestLogger = logger.child({ correlationId, agentId, userId });

  requestLogger.info('Status update request received');

  try {
    if (!userId) {
      requestLogger.warn('Unauthorized request - missing userId');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { status } = body;

    if (!status || !['active', 'inactive'].includes(status)) {
      requestLogger.warn({ status }, 'Invalid status value');
      return NextResponse.json(
        { success: false, error: 'Invalid status. Must be "active" or "inactive"' },
        { status: 400 }
      );
    }

    requestLogger.debug({ newStatus: status }, 'Updating agent status');

    // Use repository methods for status updates
    const { data: updatedAgent, error } = status === 'inactive'
      ? await agentRepository.pause(agentId, userId)
      : await agentRepository.activate(agentId, userId);

    if (error) {
      requestLogger.error({ err: error }, 'Failed to update agent status');
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to update status' },
        { status: 500 }
      );
    }

    if (!updatedAgent) {
      requestLogger.warn('Agent not found or access denied');
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ duration, newStatus: status }, 'Agent status updated successfully');

    return NextResponse.json({
      success: true,
      agent: updatedAgent,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Status update request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
