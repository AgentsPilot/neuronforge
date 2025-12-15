// app/api/agents/[id]/executions/route.ts
// Get executions for an agent with optional token enrichment

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { agentRepository, executionRepository } from '@/lib/repositories';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'API', route: '/api/agents/[id]/executions' });

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// GET /api/agents/[id]/executions - Get executions for agent
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const { id: agentId } = await params;
  const userId = getUserIdFromRequest(request);
  const { searchParams } = new URL(request.url);
  const limit = searchParams.get('limit');
  const includeTokens = searchParams.get('includeTokens') === 'true';

  const requestLogger = logger.child({ correlationId, agentId, userId, includeTokens });

  requestLogger.info('Executions request received');

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
        { success: false, error: 'Failed to fetch executions' },
        { status: 500 }
      );
    }

    let resultExecutions = executions || [];

    // Apply limit if provided
    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        resultExecutions = resultExecutions.slice(0, limitNum);
      }
    }

    // Enrich with token data if requested
    if (includeTokens && resultExecutions.length > 0) {
      requestLogger.debug('Enriching executions with token data');

      // Find executions missing token data
      const executionsNeedingTokenData = resultExecutions.filter(execution => {
        const logs = execution.logs as any;
        const hasCompleteTokenData =
          logs?.tokensUsed?.total &&
          logs?.tokensUsed?.prompt &&
          logs?.tokensUsed?.completion;
        return !hasCompleteTokenData;
      });

      if (executionsNeedingTokenData.length > 0) {
        const executionIds = executionsNeedingTokenData.map(e => e.id);

        // Batch fetch token data
        const { data: tokenData, error: tokenError } = await supabaseServer
          .from('token_usage')
          .select('id, execution_id, input_tokens, output_tokens, activity_type')
          .in('execution_id', executionIds);

        if (tokenError) {
          requestLogger.warn({ err: tokenError }, 'Failed to fetch token data (non-blocking)');
        } else if (tokenData) {
          // Build map of token data by execution ID
          const tokenDataByExecutionId = new Map<string, typeof tokenData>();
          tokenData.forEach((record) => {
            if (!tokenDataByExecutionId.has(record.execution_id)) {
              tokenDataByExecutionId.set(record.execution_id, []);
            }
            tokenDataByExecutionId.get(record.execution_id)!.push(record);
          });

          // Enrich executions with token data
          resultExecutions = resultExecutions.map(execution => {
            const logs = execution.logs as any;
            const hasCompleteTokenData =
              logs?.tokensUsed?.total &&
              logs?.tokensUsed?.prompt &&
              logs?.tokensUsed?.completion;

            if (hasCompleteTokenData) {
              return execution;
            }

            const tokenRecords = tokenDataByExecutionId.get(execution.id);
            if (tokenRecords && tokenRecords.length > 0) {
              const inputTokens = tokenRecords.reduce((sum, record) => sum + (record.input_tokens || 0), 0);
              const outputTokens = tokenRecords.reduce((sum, record) => sum + (record.output_tokens || 0), 0);
              const totalTokens = inputTokens + outputTokens;

              return {
                ...execution,
                logs: {
                  ...(logs || {}),
                  tokensUsed: {
                    ...(logs?.tokensUsed || {}),
                    prompt: logs?.tokensUsed?.prompt || inputTokens,
                    completion: logs?.tokensUsed?.completion || outputTokens,
                    total: logs?.tokensUsed?.total || totalTokens,
                    _source: logs?.tokensUsed?.adjusted ? 'agent_executions_with_fallback' : 'token_usage_table_batched'
                  }
                }
              };
            }

            return execution;
          });

          requestLogger.debug({ enrichedCount: executionsNeedingTokenData.length }, 'Token enrichment complete');
        }
      }
    }

    const duration = Date.now() - startTime;
    requestLogger.info({ duration, count: resultExecutions.length }, 'Executions request completed');

    return NextResponse.json({
      success: true,
      executions: resultExecutions,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Executions request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}