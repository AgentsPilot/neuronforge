import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { PromptLoader } from '@/app/api/types/PromptLoader';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { createLogger } from '@/lib/logger';
import {
  getAgentPromptThreadRepository,
  RepositoryError
} from '@/lib/agent-creation/agent-prompt-thread-repository';
import type {
  InitThreadResponse,
  ThreadErrorResponse,
  CreateAgentPromptThread,
  InitThreadRequest
} from '@/components/agent-creation/types/agent-prompt-threads';
import { PROVIDERS } from '@/lib/ai/providerFactory';
import { resolveThreadProviderConfig } from '@/lib/agent-creation/thread-provider-config';

//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v10-chatgpt";
//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v13-chatgpt";
const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v14-chatgpt";

// Initialize Supabase client (still needed for AIAnalyticsService)
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize AI Analytics Service
const aiAnalytics = new AIAnalyticsService(supabase, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
});

// Initialize repository
const threadRepository = getAgentPromptThreadRepository();

// Create logger instance for this route
const logger = createLogger({ module: 'API', route: '/api/agent-creation/init-thread' });

/**
 * POST /api/agent-creation/init-thread
 *
 * Creates a new OpenAI thread with system prompt injected once for agent creation.
 * This thread will be used for phases 1-4 (analyze, clarify, enhance, technical workflow).
 */
export async function POST(request: NextRequest) {
  // Generate or extract correlation ID for request tracing
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const startTime = Date.now();

  requestLogger.info('Thread creation request received');

  try {
    // Step 0: Parse request body for optional provider/model
    let requestBody: InitThreadRequest = {};
    try {
      requestBody = await request.json();
    } catch {
      // Empty body is fine, use defaults
    }

    // Resolve provider and model using unified helper
    const { provider: aiProvider, model: aiModel } = resolveThreadProviderConfig(
      requestBody.ai_provider,
      requestBody.ai_model
    );

    // Validate provider
    if (!Object.values(PROVIDERS).includes(aiProvider)) {
      requestLogger.warn({ aiProvider }, 'Invalid AI provider requested');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid AI provider',
          details: `Supported providers: ${Object.values(PROVIDERS).join(', ')}`
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    requestLogger.debug({ aiProvider, aiModel }, 'AI provider configuration');

    // Step 1: Authenticate user
    const user = await getUser();
    if (!user) {
      requestLogger.warn('Unauthorized access attempt');
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          details: 'User authentication required'
        } as ThreadErrorResponse,
        { status: 401 }
      );
    }

    requestLogger.debug({ userId: user.id }, 'User authenticated');

    // Step 3: Load the unified system prompt (v5) using PromptLoader
    let systemPrompt: string;
    const promptStartTime = Date.now();
    try {
      const promptLoader = new PromptLoader(aiAgentPromptTemplate);
      systemPrompt = promptLoader.getPrompt();
      const promptDuration = Date.now() - promptStartTime;

      requestLogger.debug(
        { promptLength: systemPrompt.length, duration: promptDuration, template: aiAgentPromptTemplate },
        'System prompt loaded'
      );
    } catch (promptError: any) {
      const promptDuration = Date.now() - promptStartTime;
      requestLogger.error(
        { err: promptError, duration: promptDuration, template: aiAgentPromptTemplate },
        'Failed to load system prompt'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to load system prompt',
          details: promptError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

    // Step 4 & 5: Create OpenAI thread with system prompt using OpenAIProvider
    let thread;
    const threadStartTime = Date.now();
    try {
      // Get OpenAI provider instance with validation
      const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);

      // Create thread with system prompt injected (auto-cleanup on failure)
      thread = await openaiProvider.createThreadWithSystemPrompt(
        systemPrompt,
        {
          userId: user.id,
          feature: 'agent_creation',
          component: 'init-thread',
          category: 'thread_management',
          activity_type: 'agent_creation',
          activity_name: 'Initialize agent creation thread with system prompt',
          activity_step: 'thread_initialization'
        }
      );

      const threadDuration = Date.now() - threadStartTime;
      requestLogger.info(
        { threadId: thread.id, userId: user.id, duration: threadDuration },
        'OpenAI thread created'
      );
    } catch (threadError: any) {
      const threadDuration = Date.now() - threadStartTime;
      requestLogger.error(
        { err: threadError, userId: user.id, duration: threadDuration },
        'Failed to create OpenAI thread'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to create OpenAI thread with system prompt',
          details: threadError.message
        } as ThreadErrorResponse,
        { status: (threadError as any).cause || 500 }
      );
    }

    // Step 6: Store thread in database using repository
    // ai_provider and ai_model are stored as dedicated columns (not in metadata)
    // These values are immutable for the lifetime of the thread
    const threadData: CreateAgentPromptThread = {
      user_id: user.id,
      openai_thread_id: thread.id,
      status: 'active',
      current_phase: 1,
      agent_id: null,
      ai_provider: aiProvider,
      ai_model: aiModel,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      metadata: {}
    };

    try {
      const dbRecord = await threadRepository.createThread(threadData);

      // Step 7: Return success response
      const response: InitThreadResponse = {
        success: true,
        thread_id: thread.id,
        created_at: dbRecord.created_at,
        message: 'Thread created successfully'
      };

      const totalDuration = Date.now() - startTime;
      requestLogger.info(
        {
          threadId: thread.id,
          userId: user.id,
          dbRecordId: dbRecord.id,
          aiProvider,
          aiModel,
          duration: totalDuration
        },
        'Thread initialization complete'
      );

      requestLogger.debug({ response }, 'Returning response to client');

      return NextResponse.json(response);

    } catch (dbError: any) {
      requestLogger.error(
        { err: dbError, threadId: thread.id },
        'Database error during thread storage'
      );

      // Clean up: delete the OpenAI thread
      const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);
      await openaiProvider.deleteThread(thread.id);
      requestLogger.info({ threadId: thread.id }, 'Cleaned up OpenAI thread after database error');

      return NextResponse.json(
        {
          success: false,
          error: 'Database error',
          details: dbError instanceof RepositoryError ? dbError.message : dbError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    requestLogger.error(
      { err: error, duration: totalDuration },
      'Unexpected error in thread initialization'
    );
    return NextResponse.json(
      {
        success: false,
        error: 'Unexpected server error',
        details: error.message
      } as ThreadErrorResponse,
      { status: 500 }
    );
  }
}
