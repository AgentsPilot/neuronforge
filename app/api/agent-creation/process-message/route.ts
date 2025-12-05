import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUser } from '@/lib/auth';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { PluginDefinitionContext } from '@/lib/types/plugin-definition-context';
import { createLogger } from '@/lib/logger';
import { getAgentPromptThreadRepository } from '@/lib/agent-creation/agent-prompt-thread-repository';
import type {
  ProcessMessageRequest,
  ProcessMessageResponse,
  ThreadErrorResponse,
  ClarificationQuestion,
  ConnectedService,
  UserContext
} from '@/components/agent-creation/types/agent-prompt-threads';
import { validatePhase3Response } from '@/lib/validation/phase3-schema';


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
const logger = createLogger({ module: 'API', route: '/api/agent-creation/process-message' });

/**
 * POST /api/agent-creation/process-message
 *
 * Processes a user message within an existing thread for any phase (1, 2, or 3).
 * Uses the same thread for all phases to leverage OpenAI's prompt caching.
 */
export async function POST(request: NextRequest) {
  // Generate or extract correlation ID for request tracing
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const startTime = Date.now();

  requestLogger.info('Process message request received');

  try {
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

    // Step 3: Parse request body
    let requestBody: ProcessMessageRequest;
    try {
      requestBody = await request.json();
    } catch (parseError: any) {
      requestLogger.error({ err: parseError }, 'Failed to parse request body');
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
      declined_services,      // V10: top-level field for declined plugins
      clarification_answers,
      enhanced_prompt,
      user_feedback,          // V10: refinement feedback for mini-cycle
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

    requestLogger.debug({
      userContext: mergedUserContext,
      hasClientOverrides: !!user_context
    }, 'User context prepared');

    let user_connected_services: string[] = [];
    let user_available_services: ConnectedService[] = [];

    // Step 4: Get User's Connected Plugins (simple string array of plugin keys)
    if (!connected_services || connected_services.length === 0)
    {
      requestLogger.debug('No connected services from client, fetching from server');
      try {
        const pluginManager = await PluginManagerV2.getInstance();

        // Get ALL active plugin keys (including expired OAuth tokens + system plugins)
        user_connected_services = await pluginManager.getAllActivePluginKeys(user.id);

        requestLogger.debug({
          connectedServices: user_connected_services,
          count: user_connected_services.length
        }, 'Active plugin keys retrieved from server');
      } catch (error: any) {
        requestLogger.error({ err: error }, 'Failed to retrieve active plugin keys');
      }
    } else {
      // If connected_services passed from client, ensure it's a string array
      user_connected_services = Array.isArray(connected_services)
        ? connected_services.map((s: any) => typeof s === 'string' ? s : s.name)
        : [];

      requestLogger.debug({
        connectedServices: user_connected_services,
        count: user_connected_services.length
      }, 'Connected services received from client');
    }

    // Step 4.5: Get ALL available plugins with full context (for LLM to understand capabilities)
    try {
      const pluginManager = await PluginManagerV2.getInstance();
      const allAvailablePlugins = pluginManager.getAvailablePlugins();
      const availablePluginsKeys = Object.keys(allAvailablePlugins);

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

      requestLogger.debug({
        availablePlugins: availablePluginsKeys,
        totalAvailable: user_available_services.length
      }, 'Available plugins retrieved');
    } catch (error: any) {
      requestLogger.error({ err: error }, 'Failed to fetch available plugins');
      // Don't fail the request, just log the error
    }

    requestLogger.debug({
      threadId: thread_id,
      phase,
      userId: user.id,
      hasUserPrompt: !!user_prompt,
      hasClarificationAnswers: !!clarification_answers,
      hasEnhancedPrompt: !!enhanced_prompt
    }, 'Request validated');

    // Step 5: Verify thread belongs to user and is active using repository
    const threadRecord = await threadRepository.getThreadByOpenAIId(thread_id, user.id);

    if (!threadRecord) {
      requestLogger.error({ threadId: thread_id }, 'Thread not found or unauthorized');
      return NextResponse.json(
        {
          success: false,
          error: 'Thread not found or unauthorized',
          phase,
          details: 'Thread does not exist or does not belong to this user'
        } as ThreadErrorResponse,
        { status: 404 }
      );
    }

    // Check if thread is expired
    if (threadRepository.isThreadExpired(threadRecord)) {
      requestLogger.warn({ threadId: thread_id, status: threadRecord.status }, 'Thread has expired');
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

    requestLogger.debug({
      dbRecordId: threadRecord.id,
      status: threadRecord.status,
      currentPhase: threadRecord.current_phase
    }, 'Thread verified');

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
      // V10: Phase 2 can receive connected_services, enhanced_prompt, declined_services, and user_feedback for refinement
      // If null, reference Phase 1 stored values from thread metadata
      userMessage = {
        phase: 2,
        connected_services: connected_services || threadRecord.metadata?.phase1_connected_services || null,
        enhanced_prompt: enhanced_prompt || null,
        declined_services: declined_services || [],   // V10: services user refused to connect
        user_feedback: user_feedback || null          // V10: refinement feedback for mini-cycle
      };
    } else if (phase === 3) {
      // V10: Phase 3 needs connected_services for OAuth gate re-call, declined_services, and enhanced_prompt for refinement
      userMessage = {
        phase: 3,
        clarification_answers: clarification_answers || {},
        connected_services: connected_services || threadRecord.metadata?.phase1_connected_services || [],
        declined_services: declined_services || [],   // V10: services user refused to connect
        enhanced_prompt: enhanced_prompt || null      // V10: for refinement cycles
      };
    }

    requestLogger.debug({ phase, userMessage }, 'User message constructed');

    // Get OpenAI provider instance with validation
    const openaiProvider = OpenAIProvider.getInstance(aiAnalytics);

    // Step 7: Add message to thread using OpenAIProvider
    const addMessageStartTime = Date.now();
    try {
      await openaiProvider.addMessageToThread(
        thread_id,
        { role: 'user', content: JSON.stringify(userMessage) }
      );
      const addMessageDuration = Date.now() - addMessageStartTime;
      requestLogger.debug({ threadId: thread_id, duration: addMessageDuration }, 'Message added to thread');
    } catch (messageError: any) {
      requestLogger.error({ err: messageError, threadId: thread_id }, 'Failed to add message to thread');
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
    const retrieveMessagesStartTime = Date.now();
    try {
      allMessages = await openaiProvider.getThreadMessages(thread_id, {
        order: 'asc' // Oldest first to build proper conversation history
      });
      const retrieveMessagesDuration = Date.now() - retrieveMessagesStartTime;
      requestLogger.debug({
        threadId: thread_id,
        messageCount: allMessages.data.length,
        duration: retrieveMessagesDuration
      }, 'Thread messages retrieved');
    } catch (messageError: any) {
      requestLogger.error({ err: messageError, threadId: thread_id }, 'Failed to retrieve messages');
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
    requestLogger.debug({
      messageCount: conversationMessages.length,
      conversationMessages
    }, 'Conversation built from thread');

    // Step 10: Call Chat Completions API with conversation history and analytics tracking
    let completion;
    const chatCompletionStartTime = Date.now();
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
      const chatCompletionDuration = Date.now() - chatCompletionStartTime;
      requestLogger.info({
        phase,
        model: 'gpt-4o',
        duration: chatCompletionDuration
      }, 'Chat completion received with analytics tracking');
    } catch (completionError: any) {
      requestLogger.error({ err: completionError, phase }, 'Chat completion failed');
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
      requestLogger.error({ phase }, 'Empty AI response');
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
      requestLogger.debug({ threadId: thread_id }, 'AI response stored in thread');
    } catch (storeError: any) {
      requestLogger.warn({ err: storeError, threadId: thread_id }, 'Failed to store AI response in thread (non-critical)');
      // Don't fail the request if storing fails
    }

    // Step 12: Parse and validate response JSON
    let aiResponse: ProcessMessageResponse;
    try {
      requestLogger.debug({ responsePreview: aiResponseText.substring(0, 200) }, 'AI response preview');

      const parsedJson = JSON.parse(aiResponseText);

      // Strict validation for Phase 3 responses
      if (phase === 3) {
        requestLogger.debug('Validating Phase 3 response structure');

        const validation = validatePhase3Response(parsedJson);

        if (!validation.success) {
          requestLogger.error({
            validationErrors: validation.errors,
            phase
          }, 'Phase 3 response validation failed');
          return NextResponse.json(
            {
              success: false,
              error: 'Invalid Phase 3 response structure from AI',
              phase,
              details: validation.errors?.join('; ') || 'Unknown validation error'
            } as ThreadErrorResponse,
            { status: 500 }
          );
        }

        requestLogger.debug('Phase 3 response validated successfully');
        aiResponse = validation.data as ProcessMessageResponse;
      } else {
        // Phase 1 & 2: No strict validation yet
        aiResponse = parsedJson;
      }

      aiResponse.success = true;
      aiResponse.phase = phase;

      requestLogger.debug({ phase }, 'AI response parsed successfully');

      // Step 12.4: Enrich Phase 1 response with connectedPlugins
      if (phase === 1) {
        // Return the list of connected plugin keys to frontend (already strings)
        aiResponse.connectedPlugins = user_connected_services;
        requestLogger.debug({
          connectedPlugins: aiResponse.connectedPlugins,
          count: aiResponse.connectedPlugins.length
        }, 'Phase 1 - Connected plugins added to response');
      }

      // Step 12.6: Log Phase 3 OAuth gate details
      if (phase === 3) {
        requestLogger.info({
          requiredServices: aiResponse.requiredServices,
          missingPlugins: aiResponse.missingPlugins,
          readyForGeneration: aiResponse.metadata?.ready_for_generation,
          declinedPluginsBlocking: aiResponse.metadata?.declined_plugins_blocking,
          hasError: !!aiResponse.error
        }, 'Phase 3 - OAuth gate check complete');
      }

    } catch (parseError: any) {
      requestLogger.error({ err: parseError, phase }, 'Failed to parse AI response');
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

    // Step 13: Update thread record in database using repository
    // Build iteration record for audit trail (supports mini cycles)
    const iterationRecord = {
      phase,
      timestamp: new Date().toISOString(),
      request: userMessage,
      response: aiResponse
    };

    const updatedMetadata = {
      ...threadRecord.metadata,
      last_phase: phase,
      last_updated: new Date().toISOString(),
      // Append to iterations history for full audit trail
      iterations: [
        ...(threadRecord.metadata?.iterations || []),
        iterationRecord
      ],
      // Store Phase 1 context for Phase 2 reference (v8 requirement)
      ...(phase === 1 && {
        phase1_connected_services: user_connected_services,
        phase1_available_services: user_available_services
      })
    };

    try {
      await threadRepository.updateThreadPhase(
        threadRecord.id,
        phase,
        phase === 3 ? 'completed' : 'active',
        updatedMetadata
      );

      requestLogger.debug({
        dbRecordId: threadRecord.id,
        newPhase: phase,
        newStatus: phase === 3 ? 'completed' : 'active'
      }, 'Thread record updated');
    } catch (updateError: any) {
      requestLogger.warn({ err: updateError, dbRecordId: threadRecord.id }, 'Failed to update thread record (non-critical)');
      // Don't fail the request if database update fails
    }

    // Step 14: Return response
    const totalDuration = Date.now() - startTime;
    requestLogger.info({
      threadId: thread_id,
      phase,
      userId: user.id,
      duration: totalDuration
    }, 'Process message complete');

    requestLogger.debug({ response: aiResponse }, 'Returning response to client');

    return NextResponse.json(aiResponse);

  } catch (error: any) {
    requestLogger.error({ err: error }, 'Unexpected error in process-message');
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
