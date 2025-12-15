// app/api/agents/[id]/metrics/route.ts
// Get basic metrics for an agent

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { agentRepository, executionRepository } from '@/lib/repositories';

const logger = createLogger({ module: 'API', route: '/api/agents/[id]/metrics' });

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// GET /api/agents/[id]/metrics - Get basic metrics for agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { id: agentId } = await params;
  const userId = getUserIdFromRequest(request);

  const requestLogger = logger.child({ correlationId, agentId, userId });

  requestLogger.info('Metrics request received');

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

    // Get executions using repository
    const { data: executions, error: execError } = await executionRepository.findByAgentId(agentId);

    if (execError) {
      requestLogger.error({ err: execError }, 'Failed to fetch executions');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch metrics' },
        { status: 500 }
      );
    }

    const metrics = {
      total_executions: executions?.length || 0,
      successful_executions: executions?.filter(e => e.status === 'completed' || e.status === 'success').length || 0,
      failed_executions: executions?.filter(e => e.status === 'failed' || e.status === 'error').length || 0,
      avg_duration_ms: 0,
    };

    // Calculate average duration
    const durationsMs = executions
      ?.filter(e => e.started_at && e.completed_at)
      .map(e => new Date(e.completed_at!).getTime() - new Date(e.started_at!).getTime())
      .filter(d => d > 0) || [];

    if (durationsMs.length > 0) {
      metrics.avg_duration_ms = Math.round(durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length);
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ duration, metrics }, 'Metrics request completed');

    return NextResponse.json({
      success: true,
      metrics,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Metrics request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
