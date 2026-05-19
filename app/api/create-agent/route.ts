import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { getUser } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import { auditLog } from '@/lib/services/AuditTrailService';

// Module-scoped Pino logger (per SYSTEM_LOGGING_GUIDELINES.md § Server-Side Logging).
// Each request creates a child logger with a correlation ID + route below.
// Note: the project's createLogger (lib/logger.ts) only accepts module+service
// at the top level — additional context (route, correlationId) is attached via
// pino's .child() method on the request logger.
const moduleLogger = createLogger({ module: 'API', service: 'create-agent' });

// WP-48: Service-role server client used ONLY for the `token_usage` SELECT in
// the AIS tracking section below — that table has no repository yet. Agent
// writes go through AgentRepository (which also uses supabaseServer underneath).
// Per docs/SUPABASE_CLIENTS.md decision tree: API routes that need to bypass
// RLS for read-only metrics use the documented `supabaseServer` singleton, NOT
// an ad-hoc `createClient(... SERVICE_ROLE ...)`.

// Zod schema for the request body. Fields are loose by design — the V2 UI
// passes a full agent object built either from V4 or V6 generation; we
// validate the shape, not the specific field values.
const CreateAgentSchema = z.object({
  agent: z.object({
    id: z.string().optional(),
    agent_name: z.string().min(1, 'agent_name is required'),
    user_prompt: z.string().nullish(),
    system_prompt: z.string().nullish(),
    description: z.string().nullish(),
    input_schema: z.array(z.unknown()).nullish(),
    output_schema: z.array(z.unknown()).nullish(),
    // V2 UI sends an array of plugin keys; older V4 paths emit an object.
    // The DB column is JSONB and accepts either — be permissive here.
    connected_plugins: z.union([z.array(z.unknown()), z.record(z.unknown())]).nullish(),
    status: z.string().nullish(),
    mode: z.string().nullish(),
    schedule_cron: z.string().nullish(),
    timezone: z.string().nullish(),
    trigger_conditions: z.record(z.unknown()).nullish(),
    plugins_required: z.array(z.string()).nullish(),
    workflow_steps: z.array(z.unknown()).nullish(),
    pilot_steps: z.array(z.unknown()).nullish(),
    generated_plan: z.unknown().nullish(),
    detected_categories: z.unknown().nullish(),
    ai_reasoning: z.union([z.string(), z.array(z.string())]).nullish(),
    ai_confidence: z.number().nullish(),
    created_from_prompt: z.string().nullish(),
    ai_generated_at: z.string().nullish(),
    agent_config: z.record(z.unknown()).nullish(),
  }).passthrough(),
  sessionId: z.string().optional(),
  agentId: z.string().optional(),
  thread_id: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = moduleLogger.child({ route: '/api/create-agent', correlationId });
  const startTime = Date.now();

  requestLogger.info('Agent creation request received');

  try {
    // WP-48: Real auth via Supabase SSR session (cookie-based). Replaces the
    // prior `x-user-id` header trust which couldn't distinguish a valid
    // logged-in user from a client that just sets the header.
    const user = await getUser();
    if (!user) {
      requestLogger.warn('Unauthorized — no valid session');
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          details: 'No valid session — please log in again'
        },
        { status: 401 }
      );
    }
    const userId = user.id;
    requestLogger.debug({ userId }, 'User authenticated');

    // Parse + validate request body with Zod
    const rawBody = await request.json().catch(() => null);
    if (!rawBody) {
      requestLogger.warn('Invalid JSON in request body');
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const parsed = CreateAgentSchema.safeParse(rawBody);
    if (!parsed.success) {
      requestLogger.warn(
        { issuesCount: parsed.error.issues.length, firstIssue: parsed.error.issues[0] },
        'Request body validation failed'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: process.env.NODE_ENV === 'development' ? parsed.error.issues : 'Validation failed'
        },
        { status: 400 }
      );
    }

    const { agent, sessionId: providedSessionId, agentId: providedAgentId, thread_id } = parsed.data;

    // Use the authenticated user's ID — never trust client-provided user_id
    const agentUserIdToUse = userId;
    // Use the provided agent ID for database/token-tracking consistency
    const finalAgentId = providedAgentId || agent.id;

    requestLogger.debug(
      {
        userId: agentUserIdToUse,
        finalAgentId,
        providedAgentId,
        providedSessionId,
        thread_id,
        hasAgentConfig: !!agent.agent_config,
        agentConfigKeys: agent.agent_config ? Object.keys(agent.agent_config) : [],
        agentConfigSize: agent.agent_config ? JSON.stringify(agent.agent_config).length : 0,
        idSource: providedAgentId ? 'frontend_provided' : agent.id ? 'agent_object' : 'database_generated'
      },
      'Agent creation context'
    );

    // Convert ai_reasoning array to string if it exists
    const aiReasoning = agent.ai_reasoning
      ? Array.isArray(agent.ai_reasoning)
        ? agent.ai_reasoning.join('\n')
        : agent.ai_reasoning
      : null;

    // WP-48: Build CreateAgentInput for the repository. The repository writes
    // via supabaseServer (RLS-bypassing) which is appropriate here because we've
    // already authenticated the user and we're setting user_id ourselves.
    const agentInput = {
      ...(finalAgentId && { id: finalAgentId }),
      user_id: agentUserIdToUse,                              // authenticated user — never trust client
      agent_name: agent.agent_name,
      description: agent.description ?? null,
      user_prompt: agent.user_prompt ?? null,
      system_prompt: agent.system_prompt ?? null,
      created_from_prompt: agent.created_from_prompt ?? null,
      input_schema: (agent.input_schema as unknown[] | null) ?? null,
      output_schema: (agent.output_schema as unknown[] | null) ?? null,
      plugins_required: (agent.plugins_required as string[] | null) ?? null,
      connected_plugins: (agent.connected_plugins as unknown[] | Record<string, unknown> | null) ?? null,
      workflow_steps: (agent.workflow_steps as unknown[] | null) ?? null,
      pilot_steps: (agent.pilot_steps as unknown[] | null) ?? null,
      generated_plan: agent.generated_plan ?? null,
      detected_categories: agent.detected_categories ?? null,
      trigger_conditions: (agent.trigger_conditions as Record<string, unknown> | null) ?? null,
      ai_reasoning: aiReasoning,
      ai_confidence: agent.ai_confidence ?? null,
      ai_generated_at: agent.ai_generated_at ? new Date(agent.ai_generated_at).toISOString() : null,
      agent_config: (agent.agent_config as Record<string, unknown> | null) ?? null,
      status: (agent.status as any) || 'draft',
      mode: agent.mode ?? 'on_demand',
      schedule_cron: agent.schedule_cron ?? null,
      timezone: agent.timezone ?? 'UTC',
    };

    requestLogger.info(
      {
        userId: agentUserIdToUse,
        agentName: agentInput.agent_name,
        finalAgentId: finalAgentId || 'database_generated',
        hasAgentConfig: !!agentInput.agent_config,
        pilotStepsCount: (agentInput.pilot_steps as any)?.length || 0,
        workflowStepsCount: (agentInput.workflow_steps as any)?.length || 0,
        mode: agentInput.mode,
        scheduleCron: agentInput.schedule_cron,
        timezone: agentInput.timezone
      },
      'Inserting agent via AgentRepository'
    );

    // WP-48: All agent CRUD goes through AgentRepository (per CLAUDE.md mandatory rule #1)
    const agentRepository = new AgentRepository();
    const { data, error: repoError } = await agentRepository.create(agentInput as any);

    if (repoError || !data) {
      const duration = Date.now() - startTime;
      requestLogger.error(
        { err: repoError, userId: agentUserIdToUse, duration },
        'AgentRepository.create failed'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create agent',
          details: process.env.NODE_ENV === 'development' ? repoError?.message : 'Database insert failed'
        },
        { status: 500 }
      );
    }

    requestLogger.info(
      {
        agentId: data.id,
        userId: agentUserIdToUse,
        idsMatch: finalAgentId === data.id,
        agentConfigSize: data.agent_config ? JSON.stringify(data.agent_config).length : 0,
        mode: data.mode,
        scheduleCron: data.schedule_cron,
        timezone: data.timezone
      },
      'Agent created successfully'
    );

    // Audit Trail: Log agent creation (non-blocking)
    auditLog({
      action: 'AGENT_CREATED',
      entityType: 'agent',
      entityId: data.id,
      userId: agentUserIdToUse,
      resourceName: data.agent_name || 'Unnamed Agent',
      details: {
        mode: data.mode,
        plugins_count: data.plugins_required?.length || 0,
        has_schedule: !!data.schedule_cron,
        has_workflow: !!data.workflow_steps?.length,
        workflow_steps_count: data.workflow_steps?.length || 0,
        scheduled_cron: data.schedule_cron || null,
        timezone: data.timezone || null,
        status: data.status
      },
      severity: 'info',
      request
    }).catch(err => {
      // Non-blocking — never block agent creation on audit failure
      requestLogger.warn({ err, agentId: data.id }, 'Audit log failed (non-blocking)');
    });

    // Link agent to thread if thread_id (OpenAI thread ID) provided
    if (thread_id) {
      try {
        const { getAgentPromptThreadRepository } = await import('@/lib/agent-creation/agent-prompt-thread-repository');
        const threadRepository = getAgentPromptThreadRepository();

        // Look up the internal DB record by OpenAI thread ID (same as process-message)
        const threadRecord = await threadRepository.getThreadByOpenAIId(thread_id, agentUserIdToUse);

        if (threadRecord) {
          await threadRepository.updateThread(threadRecord.id, {
            agent_id: data.id,
            status: 'completed'
          });
          requestLogger.info(
            { agentId: data.id, thread_id, dbRecordId: threadRecord.id },
            'Linked agent to thread'
          );
        } else {
          requestLogger.warn({ thread_id }, 'Thread record not found for OpenAI thread ID');
        }
      } catch (linkError: any) {
        requestLogger.warn(
          { err: linkError, thread_id, agentId: data.id },
          'Failed to link agent to thread (non-critical)'
        );
      }
    }

    // Track creation costs in AIS system now that agent exists in database
    if (providedSessionId) {
      try {
        const aisLogger = requestLogger.child({ subsystem: 'AIS', sessionId: providedSessionId, agentId: data.id });
        aisLogger.debug('Tracking creation costs');

        // Diagnostic: how many token_usage records exist for this session at all?
        const { data: allSessionRecords } = await supabaseServer
          .from('token_usage')
          .select('*')
          .eq('session_id', providedSessionId);

        aisLogger.debug(
          { recordsCount: allSessionRecords?.length || 0 },
          'token_usage records found for session'
        );

        // Get all creation-related token usage for this session
        const { data: creationTokens, error: tokenError } = await supabaseServer
          .from('token_usage')
          .select('input_tokens, output_tokens, activity_type, created_at')
          .eq('session_id', providedSessionId)
          .in('activity_type', ['agent_creation', 'agent_generation']);

        if (tokenError) {
          aisLogger.error({ err: tokenError }, 'Error fetching token usage');
        } else if (creationTokens && creationTokens.length > 0) {
          const totalCreationTokens = creationTokens.reduce((sum: number, record: any) =>
            sum + (record.input_tokens || 0) + (record.output_tokens || 0), 0
          );

          aisLogger.info(
            {
              recordsCount: creationTokens.length,
              totalCreationTokens,
              activityTypes: ['agent_creation', 'agent_generation']
            },
            'Token usage aggregated for creation costs'
          );

          // Import and call trackCreationCosts with server-side supabase client
          const { AgentIntensityService } = await import('@/lib/services/AgentIntensityService');
          const result = await AgentIntensityService.trackCreationCosts(
            supabaseServer,
            {
              agent_id: data.id,
              user_id: agentUserIdToUse,
              tokens_used: totalCreationTokens,
              creation_duration_ms: 0 // Cross-API timing not tracked yet
            }
          );

          if (result) {
            aisLogger.info(
              {
                agentId: result.agent_id,
                creationTokensUsed: result.creation_tokens_used,
                totalCreationCostUsd: result.total_creation_cost_usd
              },
              'Creation costs tracked successfully'
            );
          } else {
            aisLogger.warn('trackCreationCosts returned null');
          }
        } else {
          aisLogger.warn(
            { sessionId: providedSessionId },
            'No token usage records found for session — possible causes: session ID mismatch, generation token tracking failure, or wrong activity_type'
          );
        }
      } catch (aisError) {
        requestLogger.error(
          { err: aisError, subsystem: 'AIS' },
          'Failed to track creation costs (non-fatal)'
        );
        // Non-fatal — agent already created
      }
    } else {
      requestLogger.warn(
        { agentId: data.id },
        'No session ID provided — cannot track creation costs in AIS'
      );
    }

    const duration = Date.now() - startTime;
    requestLogger.info(
      { agentId: data.id, userId: agentUserIdToUse, duration },
      'Agent creation request completed'
    );

    // Return the structure the frontend expects
    return NextResponse.json(
      {
        success: true,
        agent: data,
        message: 'Agent created successfully',
        analytics: {
          agentId: data.id,
          sessionId: providedSessionId,
          tokenTrackingConsistent: finalAgentId === data.id
        }
      },
      { status: 201 }
    );

  } catch (error) {
    const duration = Date.now() - startTime;
    if (error instanceof SyntaxError) {
      requestLogger.warn({ err: error, duration }, 'JSON parsing error');
      return NextResponse.json(
        { success: false, error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    requestLogger.error({ err: error, duration }, 'Unhandled error in agent creation');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        } : 'An unexpected error occurred'
      },
      { status: 500 }
    );
  }
}

// Handle other HTTP methods properly
export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}

export async function PUT() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}

export async function DELETE() {
  return NextResponse.json(
    { success: false, error: 'Method not allowed. Use POST to create an agent.' },
    { status: 405 }
  );
}
