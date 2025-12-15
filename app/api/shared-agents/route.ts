// app/api/shared-agents/route.ts
// Share an agent to the community

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { agentRepository, sharedAgentRepository } from '@/lib/repositories';
import { auditLog } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'API', route: '/api/shared-agents' });

function getUserIdFromRequest(request: NextRequest): string | null {
  const userIdHeader = request.headers.get('x-user-id');
  if (userIdHeader) return userIdHeader;
  return null;
}

// POST /api/shared-agents - Share an agent
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const userId = getUserIdFromRequest(request);

  const requestLogger = logger.child({ correlationId, userId });

  requestLogger.info('Share agent request received');

  try {
    if (!userId) {
      requestLogger.warn('Unauthorized request - missing userId');
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { agentId, title, description, preview_image_url, original_prompt } = body;

    if (!agentId) {
      requestLogger.warn('Missing agentId in request body');
      return NextResponse.json(
        { success: false, error: 'agentId is required' },
        { status: 400 }
      );
    }

    requestLogger.debug({ agentId }, 'Fetching original agent');

    // Fetch the original agent using repository
    const { data: agent, error: agentError } = await agentRepository.findById(agentId, userId);

    if (agentError || !agent) {
      requestLogger.warn({ err: agentError, agentId }, 'Agent not found or access denied');
      return NextResponse.json(
        { success: false, error: 'Agent not found or access denied' },
        { status: 404 }
      );
    }

    // Cast agent to access additional database fields not in the typed interface
    const agentData = agent as typeof agent & {
      created_from_prompt?: string;
      system_prompt?: string;
      agent_config?: Record<string, unknown>;
    };

    // Check if already shared using repository
    const { data: existsResult, error: existsError } = await sharedAgentRepository.existsByOriginalAgent(agentId, userId);

    if (existsError) {
      requestLogger.error({ err: existsError }, 'Failed to check shared status');
      return NextResponse.json(
        { success: false, error: 'Failed to check shared status' },
        { status: 500 }
      );
    }

    if (existsResult?.exists) {
      requestLogger.warn({ agentId, existingSharedId: existsResult.sharedAgentId }, 'Agent is already shared');
      return NextResponse.json(
        { success: false, error: 'Agent is already shared' },
        { status: 409 }
      );
    }

    // Create shared agent using repository
    const { data: sharedAgent, error: createError } = await sharedAgentRepository.create({
      original_agent_id: agentId,
      creator_user_id: userId,
      title: title || agentData.agent_name,
      description: description || agentData.description,
      preview_image_url,
      original_prompt: original_prompt || agentData.created_from_prompt,
      system_prompt: agentData.system_prompt,
      user_prompt: agentData.user_prompt,
      input_schema: agentData.input_schema,
      output_schema: agentData.output_schema,
      plugins_required: agentData.plugins_required,
      workflow_steps: agentData.workflow_steps,
      agent_config: agentData.agent_config,
    });

    if (createError || !sharedAgent) {
      requestLogger.error({ err: createError }, 'Failed to share agent');
      return NextResponse.json(
        { success: false, error: 'Failed to share agent' },
        { status: 500 }
      );
    }

    // Audit log (non-blocking)
    auditLog({
      action: 'AGENT_SHARED',
      entityType: 'shared_agent',
      entityId: sharedAgent.id,
      userId,
      resourceName: title || agentData.agent_name,
      details: { originalAgentId: agentId },
      severity: 'info',
      request,
    }).catch(err => requestLogger.error({ err }, 'Audit log failed'));

    const duration = Date.now() - startTime;
    requestLogger.info(
      { duration, sharedAgentId: sharedAgent.id, originalAgentId: agentId },
      'Agent shared successfully'
    );

    return NextResponse.json({
      success: true,
      id: sharedAgent.id,
      sharedAgent,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    requestLogger.error({ err: error, duration }, 'Share agent request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
