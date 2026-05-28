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
import { validatePhase2Response } from '@/lib/validation/phase2-schema';
import { isDoneIntent } from '@/lib/agent-creation/phase2-done-detector';
import {
  step as phase2LoopStep,
  INITIAL_LOOP_STATE,
  type Phase2LoopState,
} from '@/lib/agent-creation/phase2-loop-controller';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { validateContextUsage } from '@/lib/ai/context-limits';


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
 * Processes a user message within an existing thread for phases 1, 2, or 3.
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
      phase2_user_answer,     // Phase 2 single-question mode: user's reply this turn
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
      domain: user.user_metadata?.domain || '',
      ...(user.user_metadata?.timezone && { timezone: user.user_metadata.timezone })
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
    let plugin_action_summary_text = '';  // EP Key Hints (O8): action summary for connected plugins

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

      // Step 4.6: Build action summary for connected plugins (EP Key Hints — O8)
      // Scoped to connected services only to keep token cost low (~200-300 tokens for 3-4 plugins)
      if (user_connected_services.length > 0) {
        const connectedPluginContexts = allPluginsContext.filter(
          (p: PluginDefinitionContext) => user_connected_services.includes(p.key)
        );
        plugin_action_summary_text = connectedPluginContexts
          .map((p: PluginDefinitionContext) => p.toActionSummaryText())
          .join('\n');

        requestLogger.debug({
          connectedPluginsWithSummary: connectedPluginContexts.length,
          summaryLength: plugin_action_summary_text.length
        }, 'Plugin action summary built for EP Key Hints');
      }
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
      currentPhase: threadRecord.current_phase,
      aiProvider: threadRecord.ai_provider,
      aiModel: threadRecord.ai_model
    }, 'Thread verified');

    // Step 5.5: Validate AI provider and model consistency
    // Provider and model are set at thread creation and cannot change mid-thread
    const aiProvider = threadRecord.ai_provider;
    const aiModel = threadRecord.ai_model;

    // Validate that request doesn't try to change provider mid-thread
    if (requestBody.ai_provider && requestBody.ai_provider !== aiProvider) {
      requestLogger.warn({
        requestedProvider: requestBody.ai_provider,
        threadProvider: aiProvider
      }, 'Attempted to change provider mid-thread');
      return NextResponse.json(
        {
          success: false,
          error: 'Provider mismatch',
          details: `Thread was created with provider '${aiProvider}'. Cannot switch to '${requestBody.ai_provider}' mid-thread.`
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    // Validate that request doesn't try to change model mid-thread
    if (requestBody.ai_model && requestBody.ai_model !== aiModel) {
      requestLogger.warn({
        requestedModel: requestBody.ai_model,
        threadModel: aiModel
      }, 'Attempted to change model mid-thread');
      return NextResponse.json(
        {
          success: false,
          error: 'Model mismatch',
          details: `Thread was created with model '${aiModel}'. Cannot switch to '${requestBody.ai_model}' mid-thread.`
        } as ThreadErrorResponse,
        { status: 400 }
      );
    }

    requestLogger.debug({ aiProvider, aiModel }, 'AI provider verified for chat completion');

    // -----------------------------------------------------------------------
    // Phase 2 single-question mode (2026-05-27): done-keyword short-circuit
    //
    // If the user's reply matches the "I want to stop" intent (case-insensitive
    // substring match against the small `DONE_KEYWORDS` list), terminate the
    // loop immediately as `phase2_done` WITHOUT making an LLM call for this
    // turn. This is the deterministic server-side intent handling required by
    // FR6. The LLM handles every other case (substantive answers, "skip"-like
    // replies, ambiguous input, etc.) naturally on the next turn.
    //
    // We persist the loop state advance using the SAME `updateThreadPhase()`
    // call the route already makes at the bottom (no extra DB write) — so this
    // short-circuit returns its own response and exits the handler entirely.
    // The Pino termination log is emitted AFTER the `updateThreadPhase` await
    // resolves, mirroring the post-LLM path (so we never log a successful
    // termination that wasn't actually persisted).
    // -----------------------------------------------------------------------
    if (phase === 2 && typeof phase2_user_answer === 'string' && isDoneIntent(phase2_user_answer)) {
      const priorLoopState: Phase2LoopState =
        (threadRecord.metadata?.phase2_loop_state as Phase2LoopState | undefined) ?? INITIAL_LOOP_STATE;
      const nextLoopState: Phase2LoopState = {
        iteration_count: priorLoopState.iteration_count + 1,
      };

      const shortCircuitResponse: ProcessMessageResponse = {
        success: true,
        phase: 2,
        question: null,
        phase2_done: true,
        termination_reason: 'phase2_done',
      };

      const updatedMetadataDone = {
        ...threadRecord.metadata,
        last_phase: 2,
        last_updated: new Date().toISOString(),
        phase2_loop_state: nextLoopState,
        iterations: [
          ...(threadRecord.metadata?.iterations || []),
          {
            phase: 2,
            timestamp: new Date().toISOString(),
            request: { phase: 2, phase2_user_answer, server_short_circuit: 'done_keyword' },
            response: shortCircuitResponse,
          },
        ],
      };

      try {
        await threadRepository.updateThreadPhase(
          threadRecord.id,
          2,
          'active',
          updatedMetadataDone
        );
      } catch (updateError: any) {
        requestLogger.warn(
          { err: updateError, dbRecordId: threadRecord.id },
          'Failed to persist Phase 2 done-keyword short-circuit (non-critical)'
        );
        // We still return a terminating response — UI advances to Phase 3.
      }

      // Single Pino termination log line (FR8). Emitted post-persist.
      requestLogger.info(
        {
          phase: 2,
          iteration_count: nextLoopState.iteration_count,
          termination_reason: 'phase2_done',
          server_short_circuit: 'done_keyword',
        },
        'Phase 2 loop terminated'
      );

      return NextResponse.json(shortCircuitResponse);
    }

    // Step 6: Build user message based on phase
    let userMessage: any;

    if (phase === 1) {
      userMessage = {
        phase: 1,
        user_prompt,
        user_context: mergedUserContext,
        analysis: null,
        connected_services: user_connected_services,
        available_services: user_available_services,
        plugin_action_summary: plugin_action_summary_text || undefined  // EP Key Hints (O8)
      };
    } else if (phase === 2) {
      // V10: Phase 2 can receive connected_services, enhanced_prompt, declined_services, and user_feedback for refinement
      // If null, reference Phase 1 stored values from thread metadata
      // Phase 2 single-question mode (2026-05-27): include `phase2_user_answer`
      // so the LLM has the user's reply to the previous question in the same
      // message payload (the OpenAI thread already carries history, but
      // including it inline keeps the prompt structure explicit).
      userMessage = {
        phase: 2,
        connected_services: connected_services || threadRecord.metadata?.phase1_connected_services || null,
        enhanced_prompt: enhanced_prompt || null,
        declined_services: declined_services || [],   // V10: services user refused to connect
        user_feedback: user_feedback || null,         // V10: refinement feedback for mini-cycle
        phase2_user_answer: phase2_user_answer ?? null,
        plugin_action_summary: plugin_action_summary_text || undefined  // EP Key Hints (O8)
      };
    } else if (phase === 3) {
      // V10: Phase 3 needs connected_services for OAuth gate re-call, declined_services, and enhanced_prompt for refinement
      userMessage = {
        phase: 3,
        clarification_answers: clarification_answers || {},
        connected_services: connected_services || threadRecord.metadata?.phase1_connected_services || [],
        declined_services: declined_services || [],   // V10: services user refused to connect
        enhanced_prompt: enhanced_prompt || null,     // V10: for refinement cycles
        plugin_action_summary: plugin_action_summary_text || undefined  // EP Key Hints (O8)
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

    // Step 9.5: Validate context usage before making API call
    const chatProvider = ProviderFactory.getProvider(aiProvider);
    const maxOutputTokens = chatProvider.getMaxOutputTokens(aiModel);
    const contextValidation = validateContextUsage(
      conversationMessages,
      aiModel,
      maxOutputTokens
    );

    if (contextValidation.warning) {
      requestLogger.warn({
        phase,
        estimatedTokens: contextValidation.estimatedTokens,
        contextLimit: contextValidation.contextLimit,
        usagePercent: (contextValidation.usagePercent * 100).toFixed(1) + '%',
        model: aiModel
      }, contextValidation.warning);
    }

    if (!contextValidation.valid) {
      requestLogger.error({
        phase,
        estimatedTokens: contextValidation.estimatedTokens,
        contextLimit: contextValidation.contextLimit,
        usagePercent: (contextValidation.usagePercent * 100).toFixed(1) + '%',
        model: aiModel
      }, 'Context limit exceeded');
      return NextResponse.json(
        {
          success: false,
          error: 'Context limit exceeded',
          phase,
          details: contextValidation.error
        } as ThreadErrorResponse,
        { status: 413 } // Payload Too Large
      );
    }

    // Step 10: Call Chat Completions API with conversation history and analytics tracking
    // Use the resolved provider (OpenAI, Anthropic, or Kimi)
    let completion;
    const chatCompletionStartTime = Date.now();
    try {
      // Build completion params using provider's capabilities
      // Use model-specific max output tokens from centralized config
      const completionParams: any = {
        model: aiModel,
        messages: conversationMessages,
        temperature: 0.1,
        max_tokens: maxOutputTokens,
      };

      // Only add response_format if provider supports it (Anthropic/Kimi handle JSON via prompting)
      if (chatProvider.supportsResponseFormat) {
        completionParams.response_format = { type: 'json_object' };
      }

      completion = await chatProvider.chatCompletion(
        completionParams,
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
        aiProvider,
        model: aiModel,
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
    // Phase 2 single-question mode: stash the loop decision so the persist
    // block at the bottom can write `phase2_loop_state` and emit the single
    // termination Pino log AFTER `updateThreadPhase()` resolves.
    let phase2LoopDecisionForLog:
      | {
          terminate: boolean;
          iteration_count: number;
          termination_reason?: 'phase2_done' | 'cap_hit';
        }
      | null = null;
    let phase2NextLoopState: Phase2LoopState | null = null;
    try {
      requestLogger.debug({ responsePreview: aiResponseText.substring(0, 200) }, 'AI response preview');
      requestLogger.trace({ fullResponse: aiResponseText }, 'AI response full');

      const parsedJson = JSON.parse(aiResponseText);

      // -----------------------------------------------------------------------
      // Phase 2 single-question mode (2026-05-27): SNAPSHOT BEFORE MUTATION.
      //
      // CRITICAL: a few lines below this we mutate `aiResponse.success = true`
      // and `aiResponse.phase = phase`. The `.strict()` Zod schema rejects any
      // extra keys (including `success` and `phase`) — so we MUST capture the
      // raw parsed LLM payload here, BEFORE the mutation, and validate the
      // snapshot. Validating the post-mutation object would reject every call
      // and cause an infinite "shape invalid" warn breadcrumb (this is the
      // exact regression the prior R3 attempt hit).
      // -----------------------------------------------------------------------
      const rawPhase2Payload =
        phase === 2 ? { ...parsedJson } : null;

      // Strict validation for Phase 3 responses
      if (phase === 3) {
        requestLogger.debug('Validating Phase 3 response structure');

        const validation = validatePhase3Response(parsedJson);

        if (!validation.success) {
          requestLogger.error({
            validationErrors: validation.errors,
            phase,
            fullResponse: aiResponseText
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
      } else if (phase === 2) {
        // Phase 2 single-question mode: validate the SNAPSHOT (not parsedJson —
        // which is about to be mutated). On Zod failure we do NOT retry the LLM
        // and we do NOT fabricate a question — we pass the parsed payload
        // through in degraded form (FR4.11 / SA Comment 2) and let the next
        // turn recover. The loop controller still advances iteration_count so
        // the defensive cap eventually fires if the LLM never recovers.
        const phase2Validation = validatePhase2Response(rawPhase2Payload);
        const payloadValid = phase2Validation.success;

        if (!payloadValid) {
          requestLogger.warn(
            {
              phase: 2,
              validationErrors: phase2Validation.success
                ? undefined
                : phase2Validation.errors,
              fullResponse: aiResponseText,
            },
            'Phase 2 response shape invalid — degraded passthrough (no retry, no synthesis)'
          );
        }

        // Load prior loop state from thread metadata, default to initial state.
        const priorLoopState: Phase2LoopState =
          (threadRecord.metadata?.phase2_loop_state as Phase2LoopState | undefined) ?? INITIAL_LOOP_STATE;

        // Build controller input from the parsed payload (whether or not it
        // passed Zod — the controller branches on `payload_valid`).
        const llmQuestion =
          rawPhase2Payload && typeof (rawPhase2Payload as any).question !== 'undefined'
            ? (rawPhase2Payload as any).question
            : undefined;
        const llmPhase2Done =
          rawPhase2Payload && typeof (rawPhase2Payload as any).phase2_done === 'boolean'
            ? (rawPhase2Payload as any).phase2_done
            : undefined;

        const decision = phase2LoopStep({
          state: priorLoopState,
          payload_valid: payloadValid,
          llm_question: llmQuestion,
          llm_phase2_done: llmPhase2Done,
        });

        phase2NextLoopState = decision.next_state;
        phase2LoopDecisionForLog = {
          terminate: decision.decision === 'terminate',
          iteration_count: decision.next_state.iteration_count,
          termination_reason:
            decision.decision === 'terminate'
              ? decision.termination_reason
              : undefined,
        };

        // Build the response from the controller's response. We deliberately
        // do NOT pass through any of the LLM's other fields (the Phase 2
        // response contract is `{ question, phase2_done, ... }` only).
        aiResponse = {
          success: false, // will be set true below by the existing mutation
          phase: 2,
          question: decision.response.question,
          phase2_done: decision.response.phase2_done,
          ...(decision.response.inline_hint !== undefined && {
            inline_hint: decision.response.inline_hint,
          }),
          ...(decision.response.disclosure_banner !== undefined && {
            disclosure_banner: decision.response.disclosure_banner,
          }),
          ...(decision.response.termination_reason !== undefined && {
            termination_reason: decision.response.termination_reason,
          }),
        } as ProcessMessageResponse;
      } else {
        // Phase 1: No strict validation yet
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
      }),
      // Phase 2 single-question mode (2026-05-27): merge loop state onto the
      // SAME `updateThreadPhase()` call below (no separate DB write — SA
      // Comment 1). Only present when phase === 2 and the route reached the
      // post-LLM path (the done-keyword short-circuit handles its own persist).
      ...(phase === 2 && phase2NextLoopState && {
        phase2_loop_state: phase2NextLoopState
      })
    };

    // Determine thread status based on phase and response
    let newStatus: 'active' | 'completed' = 'active';
    if (phase === 3) {
      // Phase 3 is the final phase post-R1 cleanup — mark thread completed on success.
      newStatus = 'completed';
    }

    try {
      await threadRepository.updateThreadPhase(
        threadRecord.id,
        phase,
        newStatus,
        updatedMetadata
      );

      // Phase 1: Store user_prompt as top-level column for quick context
      if (phase === 1 && user_prompt) {
        await threadRepository.updateThread(threadRecord.id, {
          user_prompt: user_prompt
        });
        requestLogger.debug({ userPromptLength: user_prompt.length }, 'User prompt saved to thread');
      }

      requestLogger.debug({
        dbRecordId: threadRecord.id,
        newPhase: phase,
        newStatus
      }, 'Thread record updated');

      // Phase 2 single-question mode (2026-05-27): emit exactly ONE Pino info
      // line on loop EXIT (FR8). Placed AFTER `updateThreadPhase()` resolves so
      // we never log a successful termination that wasn't actually persisted
      // (SA Comment 1). The continue path emits no per-iteration log line —
      // FR8 mandates one log per session, at exit.
      if (
        phase === 2 &&
        phase2LoopDecisionForLog &&
        phase2LoopDecisionForLog.terminate
      ) {
        requestLogger.info(
          {
            phase: 2,
            iteration_count: phase2LoopDecisionForLog.iteration_count,
            termination_reason: phase2LoopDecisionForLog.termination_reason,
          },
          'Phase 2 loop terminated'
        );
      }
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
