import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
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
  console.log('🔍 GET /api/agent-creation/thread/:id - Retrieving thread:', threadId);

  try {
    // Step 1: Check feature flag
    if (!useThreadBasedAgentCreation()) {
      console.log('⚠️ Thread-based agent creation is disabled');
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
      console.error('❌ Unauthorized: No user found');
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
          details: 'User authentication required'
        } as ThreadErrorResponse,
        { status: 401 }
      );
    }

    console.log('✅ User authenticated:', user.id);

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
    const { data: threadRecord, error: threadError } = await supabase
      .from('agent_prompt_threads')
      .select('*')
      .eq('openai_thread_id', threadId)
      .eq('user_id', user.id)
      .single();

    if (threadError || !threadRecord) {
      console.error('❌ Thread not found or unauthorized:', threadError);
      return NextResponse.json(
        {
          success: false,
          error: 'Thread not found or unauthorized',
          details: threadError?.message || 'Thread does not exist or does not belong to this user'
        } as ThreadErrorResponse,
        { status: 404 }
      );
    }

    console.log('✅ Thread found:', {
      id: threadRecord.id,
      status: threadRecord.status,
      current_phase: threadRecord.current_phase,
      expires_at: threadRecord.expires_at
    });

    // Step 5: Check if thread is expired
    const now = new Date();
    const expiresAt = new Date(threadRecord.expires_at);

    if (threadRecord.status === 'expired' || now > expiresAt) {
      console.log('⏰ Thread has expired');

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

      console.log('✅ Retrieved', messages.length, 'messages from thread');
    } catch (messageError: any) {
      console.error('❌ Failed to retrieve messages:', messageError);
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

    console.log('✅ Thread resume data prepared:', {
      thread_id: threadId,
      user_id: user.id,
      message_count: messages.length,
      current_phase: threadRecord.current_phase
    });

    return NextResponse.json(response);

  } catch (error: any) {
    console.error('❌ Unexpected error in thread retrieval:', error);
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
