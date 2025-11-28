import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import { PromptLoader } from '@/app/api/types/PromptLoader';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { createLogger } from '@/lib/logger';
import type {
  InitThreadResponse,
  ThreadErrorResponse,
  CreateAgentPromptThread
} from '@/components/agent-creation/types/agent-prompt-threads';

//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v9-chatgpt";
const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v10-chatgpt";

// Initialize Supabase client
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

// Create logger instance for this route
const logger = createLogger({ module: 'API', route: '/api/agent-creation/init-thread' });

/**
 * POST /api/agent-creation/init-thread
 *
 * Creates a new OpenAI thread with system prompt injected once for agent creation.
 * This thread will be used for phases 1-3 (analyze, clarify, enhance).
 */
export async function POST(request: NextRequest) {
  // Generate or extract correlation ID for request tracing
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const startTime = Date.now();

  requestLogger.info('Thread creation request received');

  try {
    // Step 1: Check feature flag
    if (!useThreadBasedAgentCreation()) {
      requestLogger.warn('Thread-based agent creation is disabled');
      return NextResponse.json(
        {
          success: false,
          error: 'Thread-based agent creation is not enabled',
          details: 'Set NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true in environment variables'
        } as ThreadErrorResponse,
        { status: 403 }
      );
    }

    // Step 2: Authenticate user
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

    // Step 6: Store thread in database
    const threadRecord: CreateAgentPromptThread = {
      user_id: user.id,
      openai_thread_id: thread.id,
      status: 'active',
      current_phase: 1,
      agent_id: null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours from now
      metadata: {}
    };

    const dbStartTime = Date.now();
    try {
      const { data, error } = await supabase
        .from('agent_prompt_threads')
        .insert(threadRecord)
        .select()
        .single();

      if (error) {
        const dbDuration = Date.now() - dbStartTime;
        requestLogger.error(
          { err: error, threadId: thread.id, duration: dbDuration },
          'Failed to store thread in database'
        );

        // Clean up: delete the OpenAI thread since we couldn't store it
        const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);
        await openaiProvider.deleteThread(thread.id);
        requestLogger.info({ threadId: thread.id }, 'Cleaned up OpenAI thread after database failure');

        return NextResponse.json(
          {
            success: false,
            error: 'Failed to store thread in database',
            details: error.message
          } as ThreadErrorResponse,
          { status: 500 }
        );
      }

      const dbDuration = Date.now() - dbStartTime;
      requestLogger.debug({ dbRecordId: data.id, duration: dbDuration }, 'Thread stored in database');

      // Step 7: Return success response
      const response: InitThreadResponse = {
        success: true,
        thread_id: thread.id,
        created_at: data.created_at,
        message: 'Thread created successfully'
      };

      const totalDuration = Date.now() - startTime;
      requestLogger.info(
        {
          threadId: thread.id,
          userId: user.id,
          dbRecordId: data.id,
          duration: totalDuration
        },
        'Thread initialization complete'
      );

      return NextResponse.json(response);

    } catch (dbError: any) {
      const dbDuration = Date.now() - dbStartTime;
      requestLogger.error(
        { err: dbError, threadId: thread.id, duration: dbDuration },
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
          details: dbError.message
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
