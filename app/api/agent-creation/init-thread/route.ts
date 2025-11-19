import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import { PromptLoader } from '@/app/api/types/PromptLoader';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import type {
  InitThreadResponse,
  ThreadErrorResponse,
  CreateAgentPromptThread
} from '@/components/agent-creation/types/agent-prompt-threads';

//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v5";
//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v6-chatgpt";
//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v7-chatgpt";
//const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v8-chatgpt";
const aiAgentPromptTemplate = "Workflow-Agent-Creation-Prompt-v9-chatgpt";

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

/**
 * POST /api/agent-creation/init-thread
 *
 * Creates a new OpenAI thread with system prompt injected once for agent creation.
 * This thread will be used for phases 1-3 (analyze, clarify, enhance).
 */
export async function POST() {
  console.log('🧵 POST /api/agent-creation/init-thread - Creating new thread');

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

    // Step 3: Load the unified system prompt (v5) using PromptLoader
    let systemPrompt: string;
    try {
      const promptLoader = new PromptLoader(aiAgentPromptTemplate);
      systemPrompt = promptLoader.getPrompt();
      console.log('✅ System prompt loaded, length:', systemPrompt.length);
    } catch (promptError: any) {
      console.error('❌ Failed to load system prompt:', promptError);
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

      console.log('✅ OpenAI thread created with system prompt:', thread.id);
    } catch (threadError: any) {
      console.error('❌ Failed to create thread with system prompt:', threadError);
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

    try {
      const { data, error } = await supabase
        .from('agent_prompt_threads')
        .insert(threadRecord)
        .select()
        .single();

      if (error) {
        console.error('❌ Failed to store thread in database:', error);

        // Clean up: delete the OpenAI thread since we couldn't store it
        const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);
        await openaiProvider.deleteThread(thread.id);
        console.log('🧹 Cleaned up OpenAI thread after database failure');

        return NextResponse.json(
          {
            success: false,
            error: 'Failed to store thread in database',
            details: error.message
          } as ThreadErrorResponse,
          { status: 500 }
        );
      }

      console.log('✅ Thread stored in database:', data.id);

      // Step 7: Return success response
      const response: InitThreadResponse = {
        success: true,
        thread_id: thread.id,
        created_at: data.created_at,
        message: 'Thread created successfully'
      };

      console.log('✅ Thread initialization complete:', {
        thread_id: thread.id,
        user_id: user.id,
        db_record_id: data.id
      });

      return NextResponse.json(response);

    } catch (dbError: any) {
      console.error('❌ Database error:', dbError);

      // Clean up: delete the OpenAI thread
      const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);
      await openaiProvider.deleteThread(thread.id);
      console.log('🧹 Cleaned up OpenAI thread after database error');

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
    console.error('❌ Unexpected error in init-thread:', error);
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
