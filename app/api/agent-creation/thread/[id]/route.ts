import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { createLogger } from '@/lib/logger';
import type {
  AgentPromptThread,
  ThreadErrorResponse
} from '@/components/agent-creation/types/agent-prompt-threads';

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
const logger = createLogger({ module: 'API', route: '/api/agent-creation/thread/:id' });

export interface ThreadResumeResponse {
  success: boolean;
  thread: AgentPromptThread;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: number;
  }>;
}

/**
 * GET /api/agent-creation/thread/[id]
 *
 * Retrieves a thread and all its messages for resuming a conversation.
 * Used when user returns to a previous agent creation session.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const threadId = params.id;

  // Generate or extract correlation ID for request tracing
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, threadId });
  const startTime = Date.now();

  requestLogger.info('Thread retrieval request received');

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

    // Step 3: Validate thread ID
    if (!threadId) {
      return NextResponse.json(
        {
          success: false,
          error: 'thread_id is required',
          details: 'Missing thread ID in request'
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    // Step 4: Retrieve thread from database
    const dbStartTime = Date.now();
    const { data: threadRecord, error: threadError } = await supabase
      .from('agent_prompt_threads')
      .select('*')
      .eq('openai_thread_id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !threadRecord) {
      const dbDuration = Date.now() - dbStartTime;
      requestLogger.error(
        { err: threadError, userId: user.id, duration: dbDuration },
        'Thread not found or unauthorized'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Thread not found or unauthorized',
          details: threadError?.message || 'Thread does not exist or does not belong to this user'
        } as ThreadErrorResponse,
        { status: 404 }
      );
    }

    const dbDuration = Date.now() - dbStartTime;
    requestLogger.debug(
      {
        dbRecordId: threadRecord.id,
        status: threadRecord.status,
        currentPhase: threadRecord.current_phase,
        expiresAt: threadRecord.expires_at,
        duration: dbDuration
      },
      'Thread found in database'
    );

    // Step 5: Check if thread is expired
    const now = new Date();
    const expiresAt = new Date(threadRecord.expires_at);

    if (threadRecord.status === 'expired' || now > expiresAt) {
      requestLogger.info(
        { status: threadRecord.status, expiresAt: threadRecord.expires_at },
        'Thread has expired'
      );

      // Update status to expired if not already
      if (threadRecord.status !== 'expired') {
        await supabase
          .from('agent_prompt_threads')
          .update({ status: 'expired' })
          .eq('id', threadRecord.id);
      }

      return NextResponse.json(
        {
          success: false,
          error: 'Thread has expired',
          details: 'This conversation has expired. Please start a new agent creation session.'
        } as ThreadErrorResponse,
        { status: 410 }
      );
    }

    // Step 6: Retrieve messages from OpenAI thread
    let messages;
    const retrievalStartTime = Date.now();
    try {
      const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);
      const messagesResponse = await openaiProvider.getThreadMessages(threadId, {
        order: 'asc' // Oldest first for chronological order
      });

      // Transform OpenAI messages to simpler format for frontend
      messages = messagesResponse.data.map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content[0]?.text?.value || '',
        created_at: msg.created_at
      }));

      const retrievalDuration = Date.now() - retrievalStartTime;
      requestLogger.info(
        { messageCount: messages.length, duration: retrievalDuration },
        'Messages retrieved from OpenAI thread'
      );
    } catch (messageError: any) {
      const retrievalDuration = Date.now() - retrievalStartTime;
      requestLogger.error(
        { err: messageError, duration: retrievalDuration },
        'Failed to retrieve messages from OpenAI thread'
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to retrieve thread messages',
          details: messageError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

    // Step 7: Return thread data and messages
    const response: ThreadResumeResponse = {
      success: true,
      thread: threadRecord as AgentPromptThread,
      messages
    };

    const totalDuration = Date.now() - startTime;
    requestLogger.info(
      {
        userId: user.id,
        messageCount: messages.length,
        currentPhase: threadRecord.current_phase,
        duration: totalDuration
      },
      'Thread retrieval complete'
    );

    return NextResponse.json(response);

  } catch (error: any) {
    const totalDuration = Date.now() - startTime;
    requestLogger.error(
      { err: error, duration: totalDuration },
      'Unexpected error in thread retrieval'
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
