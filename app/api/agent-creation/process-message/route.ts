import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context';
import type {
  ProcessMessageRequest,
  ProcessMessageResponse,
  ThreadErrorResponse,
  UpdateAgentPromptThread,
  ClarificationQuestion,
  ConnectedService,
  UserContext
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

/**
 * POST /api/agent-creation/process-message
 *
 * Processes a user message within an existing thread for any phase (1, 2, or 3).
 * Uses the same thread for all phases to leverage OpenAI's prompt caching.
 */
export async function POST(request: NextRequest) {
  console.log('💬 POST /api/agent-creation/process-message - Processing message');

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

    // Step 3: Parse request body
    let requestBody: ProcessMessageRequest;
    try {
      requestBody = await request.json();
    } catch (parseError: any) {
      console.error('❌ Failed to parse request body:', parseError);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request body',
          details: parseError.message
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    const {
      thread_id,
      phase,
      user_prompt,
      user_context,
      connected_services,
      clarification_answers,
      enhanced_prompt,
      metadata
    } = requestBody;

    // Step 4: Validate required fields
    if (!thread_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'thread_id is required',
          phase
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    if (!phase || ![1, 2, 3].includes(phase)) {
      return NextResponse.json(
        {
          success: false,
          error: 'phase must be 1, 2, or 3',
          phase
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    if (!user_prompt && phase === 1) {
      return NextResponse.json(
        {
          success: false,
          error: 'user_prompt is required for phase 1',
          phase
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    // Step 3.5: Build user context (merge client-provided with server-side user data)
    const serverUserContext: UserContext = {
      full_name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      email: user.email || '',
      role: user.user_metadata?.role || '',
      company: user.user_metadata?.company || '',
      domain: user.user_metadata?.domain || ''
    };

    // Merge client-provided context with server context (client takes priority if provided)
    const mergedUserContext: UserContext = {
      ...serverUserContext,
      ...user_context
    };

    console.log('✅ User Context (server):', serverUserContext);
    console.log('✅ User Context (merged with client):', mergedUserContext);

    let user_connected_services: string[] = [];
    let user_available_services: ConnectedService[] = [];
    console.log('✅ Connected plugins retrieved from client side:', connected_services);

    // Step 4: Get User's Connected Plugins (simple string array of plugin keys)
    if (!connected_services || connected_services.length === 0)
    {
      console.log('❌ No connected_services received from client for user:', user.id);
      try {
        const pluginManager = await PluginManagerV2.getInstance();
        const userConnectedPlugins = await pluginManager.getConnectedPlugins(user.id);
        user_connected_services = Object.keys(userConnectedPlugins);
        console.log('✅ Connected plugin keys retrieved:', user_connected_services);
      } catch (error: any) {
        console.log('UNEXPECTED_ERROR', error)
      }
    } else {
      // If connected_services passed from client, ensure it's a string array
      user_connected_services = Array.isArray(connected_services)
        ? connected_services.map((s: any) => typeof s === 'string' ? s : s.name)
        : [];
    }

    // Step 4.5: Get ALL available plugins with full context (for LLM to understand capabilities)
    try {
      const pluginManager = await PluginManagerV2.getInstance();
      const allAvailablePlugins = pluginManager.getAvailablePlugins();
      const availablePluginsKeys = Object.keys(allAvailablePlugins);
      console.log('✅ All available plugins retrieved:', availablePluginsKeys);

      // Convert to full LLM context with actions and capabilities
      const allPluginsContext = pluginManager.convertToPluginDefinitionContext(
        Object.entries(allAvailablePlugins).reduce((acc, [key, definition]) => {
          acc[key] = { definition, connection: null };
          return acc;
        }, {} as Record<string, any>)
      );

      user_available_services = allPluginsContext
        .map((p: PluginDefinitionContext) => p.toShortLLMContext())
        .map((p: any) => ({
          name: p.key,
          context: p.context
        }));
      console.log('✅ Available services formatted for LLM:', user_available_services.length, 'total');
    } catch (error: any) {
      console.error('❌ Failed to fetch available plugins:', error);
      // Don't fail the request, just log the error
    }

    console.log('✅ Request validated:', { thread_id, phase, user_id: user.id });
    console.log('✅ Request validated Full:', requestBody);

    // Step 5: Verify thread belongs to user and is active
    const { data: threadRecord, error: threadError } = await supabase
      .from('agent_prompt_threads')
      .select('*')
      .eq('openai_thread_id', thread_id)
      .eq('user_id', user.id)
      .single();

    if (threadError || !threadRecord) {
      console.error('❌ Thread not found or unauthorized:', threadError);
      return NextResponse.json(
        {
          success: false,
          error: 'Thread not found or unauthorized',
          phase,
          details: threadError?.message || 'Thread does not exist or does not belong to this user'
        } as ThreadErrorResponse,
        { status: 404 }
      );
    }

    // Check if thread is expired
    if (threadRecord.status === 'expired') {
      return NextResponse.json(
        {
          success: false,
          error: 'Thread has expired',
          phase,
          details: 'Please create a new thread to continue'
        } as ThreadErrorResponse,
        { status: 410 }
      );
    }

    console.log('✅ Thread verified:', {
      id: threadRecord.id,
      status: threadRecord.status,
      current_phase: threadRecord.current_phase
    });

    // Step 6: Build user message based on phase
    let userMessage: any;

    if (phase === 1) {
      userMessage = {
        phase: 1,
        user_prompt,
        user_context: mergedUserContext,
        analysis: null,
        connected_services: user_connected_services,
        available_services: user_available_services
      };
    } else if (phase === 2) {
      // v8: Phase 2 can receive connected_services and enhanced_prompt for refinement
      // If null, reference Phase 1 stored values from thread metadata
      userMessage = {
        phase: 2,
        connected_services: connected_services || threadRecord.metadata?.phase1_connected_services || null,
        enhanced_prompt: enhanced_prompt || null
      };
    } else if (phase === 3) {
      userMessage = {
        phase: 3,
        clarification_answers: clarification_answers || {},
        metadata: metadata || {}
        // Note: connected_services and available_services already in thread context from Phase 1, no need to resend
      };
    }

    console.log('✅ User message constructed for phase', phase);
    console.log('✅ User message', userMessage);

    // Get OpenAI provider instance with validation
    const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);

    // Step 7: Add message to thread using OpenAIProvider
    try {
      await openaiProvider.addMessageToThread(
        thread_id,
        { role: 'user', content: JSON.stringify(userMessage) }
      );
      console.log('✅ Message added to thread');
    } catch (messageError: any) {
      console.error('❌ Failed to add message to thread:', messageError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to add message to thread',
          phase,
          details: messageError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

    // Step 8: Retrieve all messages from thread using OpenAIProvider
    let allMessages;
    try {
      allMessages = await openaiProvider.getThreadMessages(thread_id, {
        order: 'asc' // Oldest first to build proper conversation history
      });
      console.log('✅ Retrieved thread messages:', allMessages.data.length);
    } catch (messageError: any) {
      console.error('❌ Failed to retrieve messages:', messageError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to retrieve thread messages',
          phase,
          details: messageError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

    // Step 9: Build conversation for Chat Completions API using OpenAIProvider
    const conversationMessages = openaiProvider.buildConversationFromThread(allMessages.data);
    console.log('✅ Conversation built:', conversationMessages.length, 'messages');
    console.log('✅ Conversation:', conversationMessages);

    // Step 10: Call Chat Completions API with conversation history and analytics tracking
    let completion;
    try {
      completion = await openaiProvider.chatCompletion(
        {
          model: 'gpt-4o',
          messages: conversationMessages,
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: 'json_object' }
        },
        {
          userId: user.id,
          feature: 'agent_creation',
          component: 'process-message',
          category: 'agent_workflow',
          activity_type: 'agent_creation',
          activity_name: `Process agent creation phase ${phase}`,
          activity_step: `phase_${phase}_processing`,
          workflow_step: `phase_${phase}`
        }
      );
      console.log('✅ Chat completion received with analytics tracking');
    } catch (completionError: any) {
      console.error('❌ Chat completion failed:', completionError);
      return NextResponse.json(
        {
          success: false,
          error: 'AI completion failed',
          phase,
          details: completionError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

    const aiResponseText = completion.choices[0]?.message?.content;
    if (!aiResponseText) {
      console.error('❌ Empty AI response');
      return NextResponse.json(
        {
          success: false,
          error: 'Empty AI response',
          phase,
          details: 'AI returned no content'
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }
    
    // Step 11: Store AI response back into thread for context using OpenAIProvider
    try {
      await openaiProvider.addMessageToThread(
        thread_id,
        { role: 'assistant', content: aiResponseText }
      );
      console.log('✅ AI response stored in thread');
    } catch (storeError: any) {
      console.error('⚠️ Failed to store AI response in thread (non-critical):', storeError);
      // Don't fail the request if storing fails
    }

    // Step 12: Parse response JSON
    let aiResponse: ProcessMessageResponse;
    try {
      //console.log('📝 AI response preview:', aiResponseText.slice(0, 200));
      console.log('📝 AI response preview:', aiResponseText);

      aiResponse = JSON.parse(aiResponseText);
      aiResponse.success = true;
      aiResponse.phase = phase;

      console.log('✅ AI response parsed successfully');

      // Step 12.4: Enrich Phase 1 response with connectedPlugins
      if (phase === 1) {
        // Return the list of connected plugin keys to frontend (already strings)
        aiResponse.connectedPlugins = user_connected_services;
        console.log('✅ Phase 1 - Returning connected plugins to frontend:', aiResponse.connectedPlugins);
      }


      // Step 12.6: Log Phase 3 OAuth gate details
      if (phase === 3) {
        console.log('🔒 Phase 3 - OAuth Gate Check:');
        console.log('  Required services:', aiResponse.requiredServices);
        console.log('  Missing plugins:', aiResponse.missingPlugins);
        console.log('  Ready for generation:', aiResponse.ready_for_generation);
        if (aiResponse.metadata?.declined_plugins_blocking) {
          console.log('  ⚠️ Declined plugins blocking:', aiResponse.metadata.declined_plugins_blocking);
        }
        if (aiResponse.error) {
          console.log('  ❌ Error:', aiResponse.error);
        }
      }

    } catch (parseError: any) {
      console.error('❌ Failed to parse AI response:', parseError);
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to parse AI response',
          phase,
          details: parseError.message
        } as ThreadErrorResponse,
        { status: 500 }
      );
    }

    // Step 13: Update thread record in database
    const updateData: UpdateAgentPromptThread = {
      current_phase: phase,
      status: phase === 3 ? 'completed' : 'active',
      metadata: {
        ...threadRecord.metadata,
        last_phase: phase,
        last_updated: new Date().toISOString(),
        // Store Phase 1 context for Phase 2 reference (v8 requirement)
        ...(phase === 1 && {
          phase1_connected_services: user_connected_services,
          phase1_available_services: user_available_services
        })
      }
    };

    try {
      await supabase
        .from('agent_prompt_threads')
        .update(updateData)
        .eq('id', threadRecord.id);

      console.log('✅ Thread record updated');
    } catch (updateError: any) {
      console.error('⚠️ Failed to update thread record (non-critical):', updateError);
      // Don't fail the request if database update fails
    }

    // Step 13: Return response
    console.log('✅ Process message complete:', {
      thread_id,
      phase,
      user_id: user.id
    });

    return NextResponse.json(aiResponse);

  } catch (error: any) {
    console.error('❌ Unexpected error in process-message:', error);
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
