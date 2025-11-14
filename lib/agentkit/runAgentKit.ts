// lib/agentkit/runAgentKit.ts

import { openai, AGENTKIT_CONFIG } from './agentkitClient';
import { convertPluginsToTools, getPluginContextPrompt } from './convertPlugins';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { MemoryInjector } from '@/lib/memory/MemoryInjector';
import { MemorySummarizer } from '@/lib/memory/MemorySummarizer';
import { UserMemoryService } from '@/lib/memory/UserMemoryService';
import { v4 as uuidv4 } from 'uuid';

// Note: AI Analytics tracking happens automatically via OpenAIProvider and BaseProvider
// No need to initialize AIAnalyticsService or Supabase separately here

// Initialize Audit Trail
const auditTrail = AuditTrailService.getInstance();

export interface AgentKitExecutionResult {
  success: boolean;
  response: string;
  toolCalls: Array<{
    plugin: string;
    action: string;
    parameters: any;
    result: any;
    success: boolean;
  }>;
  tokensUsed: {
    prompt: number;
    completion: number;
    total: number;
  };
  executionTime: number;
  iterations: number;
  model?: string;
  provider?: string;
  ais_score?: number;
  error?: string;
  // Memory data for AIS tracking (NEW)
  memoryData?: {
    tokens: number;           // Memory tokens injected
    entryCount: number;       // Number of memory entries
    types: string[];          // Memory types used
  };
}

/**
 * Generate output instructions from output_schema
 * If output_schema is missing or empty, fallback to legacy trigger_condintion logic
 */
function generateOutputInstructions(outputSchema: any[], triggerCondition?: any): string {
  // Backward compatibility: If no output_schema, use legacy logic
  if (!outputSchema || outputSchema.length === 0) {
    console.log('⚠️ No output_schema found, using legacy trigger_condintion logic');
    const triggerConfig = triggerCondition?.error_handling || {};
    const deliveryMethod = triggerConfig.on_failure || 'alert';

    if (deliveryMethod === 'email') {
      return `\n\n## IMPORTANT: Result Delivery
- After completing the task, you MUST send the results via email using the google-mail send_email function
- Send the email to the user with a clear summary of what was accomplished
- Include all relevant details, results, and next steps in the email body
- The email subject should clearly describe the task completed`;
    } else {
      return `\n\n## IMPORTANT: Result Delivery
- Complete the task and return a clear summary
- Do NOT send emails unless explicitly requested in the task
- Return results directly for dashboard display`;
    }
  }

  // NEW: Schema-driven output instructions
  // Filter out error-only outputs (they trigger only on failure)
  const activeOutputs = outputSchema.filter(o => !o.config?.trigger || o.config.trigger !== 'on_error');

  if (activeOutputs.length === 0) {
    return `\n\n## Output Instructions:\n- Return results for dashboard display`;
  }

  const instructions = activeOutputs.map(output => {
    switch (output.type) {
      case 'EmailDraft':
        return `- Send results via email${output.config?.recipient ? ` to ${output.config.recipient}` : ''}`;

      case 'SummaryBlock':
        const format = output.format || 'text';
        if (format === 'table') {
          return `- Format results as an HTML table with clear columns and rows`;
        } else if (format === 'list') {
          return `- Format results as a bulleted or numbered list`;
        } else if (format === 'markdown') {
          return `- Format results using markdown formatting`;
        } else if (format === 'json') {
          return `- Format results as JSON data structure`;
        } else if (format === 'html') {
          return `- Format results as HTML content`;
        } else {
          return `- Provide a clear summary of results`;
        }

      case 'PluginAction':
        return `- Save/send results using ${output.plugin || 'the appropriate plugin'}`;

      case 'Alert':
        return `- Return results for dashboard display`;

      default:
        return `- ${output.description || 'Provide results'}`;
    }
  }).join('\n');

  return `\n\n## Output Requirements:\n${instructions}`;
}

/**
 * Main AgentKit execution function
 *
 * Orchestrates agent execution using OpenAI's function calling with the V2 Plugin System.
 * This replaces the complex 8-phase custom orchestration with OpenAI's native capabilities.
 *
 * Flow:
 * 1. Convert V2 plugin definitions to OpenAI tools
 * 2. Build enhanced system prompt with plugin context
 * 3. Execute function calling loop (up to maxIterations)
 * 4. For each tool call, execute via PluginExecuterV2
 * 5. Return results to OpenAI for final response
 *
 * @param userId - User ID for plugin connections
 * @param agent - Agent configuration from Supabase agents table
 * @param userInput - User's input/request
 * @returns Execution result with response, tool calls, and metrics
 */
export async function runAgentKit(
  userId: string,
  agent: {
    id: string;
    agent_name: string;
    system_prompt?: string;
    enhanced_prompt?: string;
    user_prompt: string;
    plugins_required: string[];
    input_schema?: any;
    output_schema?: any;
    trigger_condintion?: any; // Notification preference: email or alert/dashboard
  },
  userInput: string,
  inputValues?: Record<string, any>, // Input values from agent_configurations
  sessionId?: string // NEW: Session ID for analytics tracking
): Promise<AgentKitExecutionResult> {
  const startTime = Date.now();
  const toolCalls: AgentKitExecutionResult['toolCalls'] = [];

  console.log(`🤖 AgentKit: Starting execution for "${agent.agent_name}"`);
  console.log(`📦 Required plugins: ${agent.plugins_required.join(', ')}`);
  console.log(`👤 User: ${userId}`);

  // INTELLIGENT MODEL ROUTING
  // Select optimal model based on agent complexity (AIS score)
  let selectedModel: string;
  let selectedProvider: 'openai' | 'anthropic';
  let routingReasoning: string = '';

  // Initialize Supabase client for database operations
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ROUTING DECISION HIERARCHY:
  // 1st Priority: agent.model_preference (per-step routing from Pilot workflows)
  // 2nd Priority: ModelRouter.selectModel() (agent-level routing based on AIS)
  // 3rd Priority: AGENTKIT_CONFIG.model (default: gpt-4o)

  // Declare ROUTING_ENABLED at function scope so it's accessible throughout
  let ROUTING_ENABLED = false;

  // Check if per-step routing (Pilot workflows) already selected a model
  if (agent.model_preference) {
    // Per-step routing has already made a decision - respect it
    console.log('🎯 Per-Step Routing Decision (Pilot workflow) - using pre-selected model');

    const preference = agent.model_preference;

    // Parse model_preference format: "provider:model" or just "model"
    if (preference.includes(':')) {
      const [provider, model] = preference.split(':');
      selectedModel = model;
      selectedProvider = (provider as 'openai' | 'anthropic');
    } else {
      // Legacy format: just model name
      selectedModel = preference;
      selectedProvider = 'openai'; // Default to OpenAI if no provider specified
    }

    routingReasoning = 'Per-step routing selection (Pilot workflow)';

    console.log('🎯 Model Selected (Per-Step):', {
      model: selectedModel,
      provider: selectedProvider,
      reasoning: routingReasoning,
      source: 'pilot_per_step_routing'
    });
  } else {
    // No per-step routing decision - check agent-level routing

    // Fetch routing configuration from database
    try {
      ROUTING_ENABLED = await SystemConfigService.getBoolean(
        supabase,
        'intelligent_routing_enabled',
        false
      );
    } catch (configError) {
      console.error('⚠️  Failed to fetch routing config, defaulting to disabled:', configError);
      ROUTING_ENABLED = false;
    }

    if (ROUTING_ENABLED) {
      // Agent-level routing (AIS-based) is enabled
      console.log('🎯 Agent-Level Routing ENABLED - selecting optimal model based on AIS score');

      try {
        // Fetch AIS score from agent_intensity_metrics
        const { data: aisData, error: aisError } = await supabase
          .from('agent_intensity_metrics')
          .select('overall_intensity_score')
          .eq('agent_id', agent.id)
          .single();

        const aisScore = aisData?.overall_intensity_score || 5.0; // Default to balanced tier

        // Simple tier-based routing (matching orchestration config defaults)
        if (aisScore < 3.0) {
          // Fast tier
          selectedModel = 'claude-3-haiku-20240307';
          selectedProvider = 'anthropic';
          routingReasoning = `Fast tier (AIS: ${aisScore.toFixed(1)}) - Simple task`;
        } else if (aisScore < 6.5) {
          // Balanced tier
          selectedModel = 'gpt-4o-mini';
          selectedProvider = 'openai';
          routingReasoning = `Balanced tier (AIS: ${aisScore.toFixed(1)}) - Moderate complexity`;
        } else {
          // Powerful tier
          selectedModel = 'claude-3-5-sonnet-20241022';
          selectedProvider = 'anthropic';
          routingReasoning = `Powerful tier (AIS: ${aisScore.toFixed(1)}) - Complex task`;
        }

        console.log('🎯 Model Selected (Agent-Level):', {
          model: selectedModel,
          provider: selectedProvider,
          reasoning: routingReasoning,
          intensity_score: aisScore
        });
      } catch (routingError) {
        // On error, fall back to default model
        console.error('⚠️  Routing error, falling back to default GPT-4o:', routingError);
        selectedModel = AGENTKIT_CONFIG.model;
        selectedProvider = 'openai';
        routingReasoning = 'Routing error - using default model';
      }
    } else {
      // Both routing systems disabled - use default model
      console.log('🎯 All Routing DISABLED - using default GPT-4o');
      selectedModel = AGENTKIT_CONFIG.model;
      selectedProvider = 'openai';
      routingReasoning = 'All routing disabled - using system default';
    }
  }

  // Get appropriate provider instance
  const aiProvider = ProviderFactory.getProvider(selectedProvider);

  // MEMORY SYSTEM: Load context from past executions
  console.log('🧠 [Memory] Loading agent memory context...');
  const memoryInjector = new MemoryInjector(supabase);
  const memoryContext = await memoryInjector.buildMemoryContext(
    agent.id,
    userId,
    { userInput, inputValues }
  );
  const memoryPrompt = memoryInjector.formatForPrompt(memoryContext);
  console.log(`🧠 [Memory] Loaded ${memoryContext.token_count} tokens of memory context`);

  // Get next run number for this agent
  const runNumber = await memoryInjector.getNextRunNumber(agent.id);

  // Log execution start to audit trail
  await auditTrail.log({
    action: AUDIT_EVENTS.AGENTKIT_EXECUTION_STARTED,
    entityType: 'agent',
    entityId: agent.id,
    userId: userId,
    resourceName: agent.agent_name,
    details: {
      sessionId: sessionId,
      plugins_required: agent.plugins_required,
      execution_mode: 'agentkit',
      model: selectedModel, // Dynamic model based on routing
      provider: selectedProvider, // Track which provider is being used
      routing_enabled: ROUTING_ENABLED,
      routing_reasoning: routingReasoning,
      user_input: userInput.substring(0, 200), // First 200 chars
      has_input_values: inputValues ? Object.keys(inputValues).length > 0 : false,
      trigger_condition: agent.trigger_condintion
    },
    severity: 'info'
  });

  try {
    // STEP 1: Convert V2 plugins to OpenAI tools
    const tools = await convertPluginsToTools(userId, agent.plugins_required);

    // Only error if plugins were expected but couldn't be loaded
    // Allow zero tools if plugins_required is empty (text-only processing for ai_processing steps)
    if (tools.length === 0 && agent.plugins_required && agent.plugins_required.length > 0) {
      console.warn('⚠️ AgentKit: No plugins are connected, but plugins were required');
      return {
        success: false,
        response: "No plugins are connected. Please connect the required plugins in Settings → Connected Apps to use this agent.",
        toolCalls: [],
        tokensUsed: { prompt: 0, completion: 0, total: 0 },
        executionTime: Date.now() - startTime,
        iterations: 0,
        error: "NO_PLUGINS_CONNECTED"
      };
    }

    if (tools.length === 0) {
      console.log('🔧 AgentKit: Running in text-only mode (no tools)');
    } else {
      console.log(`🔧 AgentKit: Loaded ${tools.length} available actions across ${agent.plugins_required.length} plugins`);
    }
    console.log('\n📊 AGENTKIT DEBUG - TOOLS AVAILABLE:', JSON.stringify(tools, null, 2));

    // STEP 2: Build enhanced system prompt with plugin context
    const pluginContext = await getPluginContextPrompt(userId, agent.plugins_required);

    // NEW: Generate output instructions from output_schema (or fallback to legacy)
    const outputInstructions = generateOutputInstructions(agent.output_schema, agent.trigger_condintion);

    // Add current date/time context (critical for time-based operations)
    // AI models don't have real-time access - we must provide the current timestamp
    const now = new Date();
    const currentDateTime = now.toISOString();
    const readableDate = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const systemPrompt = `${agent.system_prompt || agent.enhanced_prompt || agent.user_prompt}

${pluginContext}

${memoryPrompt}

## Current Date & Time
Today is: ${readableDate}
Current timestamp: ${currentDateTime}

IMPORTANT: When the user refers to "today", "now", "this week", etc., use the date/time above as reference.

## Instructions
- Use the available functions to accomplish the user's request
- Do NOT provide generic advice or suggestions - execute actual actions using the connected services
- If an action fails, try an alternative approach or inform the user clearly about what went wrong
- Provide specific results based on the actual data returned from function calls
- Always use the most appropriate function for the task${outputInstructions}`;

    console.log(`📬 AgentKit: Output instructions generated from schema`);
    console.log(`📅 AgentKit: Current date context: ${readableDate}`);
    console.log('\n📊 AGENTKIT DEBUG - SYSTEM PROMPT:\n', systemPrompt);

    // STEP 3: Build user message with input values context
    let enhancedUserInput = userInput;

    // If input values are provided (from agent_configurations), add them to context
    if (inputValues && Object.keys(inputValues).length > 0) {
      enhancedUserInput = `${userInput}

## Available Input Data:
${Object.entries(inputValues)
  .map(([key, value]) => `- **${key}**: ${typeof value === 'object' ? JSON.stringify(value) : value}`)
  .join('\n')}

Please use these input values when executing the task.`;

      console.log(`📋 AgentKit: Using ${Object.keys(inputValues).length} input values from configuration`);
    }

    // STEP 4: Initialize conversation
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: enhancedUserInput }
    ];

    console.log('\n📊 AGENTKIT DEBUG - USER INPUT:\n', enhancedUserInput);
    console.log('\n📊 AGENTKIT DEBUG - INPUT VALUES:\n', JSON.stringify(inputValues, null, 2));
    console.log('\n📊 AGENTKIT DEBUG - AGENT CONFIG:', {
      agent_id: agent.id,
      agent_name: agent.agent_name,
      plugins_required: agent.plugins_required,
      trigger_condintion: agent.trigger_condintion,
      input_schema: agent.input_schema,
      output_schema: agent.output_schema
    });

    // STEP 5: Function calling loop
    let iteration = 0;
    let totalTokens = { prompt: 0, completion: 0, total: 0 };
    const pluginExecuter = await PluginExecuterV2.getInstance();

    // LOOP DETECTION: Track tool calls to detect infinite loops
    const recentToolCalls: string[] = [];
    const LOOP_DETECTION_WINDOW = await SystemConfigService.getNumber(
      supabase,
      'loop_detection_window',
      3 // Default: Check last 3 calls
    );
    const MAX_SAME_TOOL_REPEATS = await SystemConfigService.getNumber(
      supabase,
      'max_same_tool_repeats',
      3 // Default: same tool called 3 times in a row = loop
    );

    while (iteration < AGENTKIT_CONFIG.maxIterations) {
      iteration++;
      console.log(`\n🔄 AgentKit: Iteration ${iteration}/${AGENTKIT_CONFIG.maxIterations}`);

      // Log the request being sent to AI provider
      console.log('\n📊 AGENTKIT DEBUG - AI PROVIDER REQUEST:', {
        model: selectedModel,
        provider: selectedProvider,
        temperature: AGENTKIT_CONFIG.temperature,
        tools_count: tools.length,
        messages_count: messages.length,
        iteration: iteration,
        routing_enabled: ROUTING_ENABLED
      });

      // Call AI provider with function calling enabled + automatic analytics tracking via BaseProvider
      const completion = await aiProvider.chatCompletion(
        {
          model: selectedModel, // Dynamic model based on routing
          messages: messages,
          tools: tools,
          tool_choice: "auto", // Let AI decide when to use tools
          temperature: AGENTKIT_CONFIG.temperature,
        },
        {
          userId: userId,
          sessionId: sessionId,
          feature: 'agentkit_execution',
          component: 'run-agentkit',
          workflow_step: `iteration_${iteration}`,
          category: 'agent_execution',
          activity_type: 'agent_execution',
          activity_name: `${agent.agent_name} - Iteration ${iteration}`, // Temporary, will be enhanced below
          agent_id: agent.id,
          activity_step: `iteration_${iteration}_of_${AGENTKIT_CONFIG.maxIterations}`
        }
      );

      // Track token usage
      if (completion.usage) {
        totalTokens.prompt += completion.usage.prompt_tokens;
        totalTokens.completion += completion.usage.completion_tokens;
        totalTokens.total += completion.usage.total_tokens;

        // PER-ITERATION TOKEN LIMIT: Check if this iteration exceeded safe limits
        const MAX_TOKENS_PER_ITERATION = await SystemConfigService.getNumber(
          supabase,
          'max_tokens_per_iteration',
          50000 // Default: 50K tokens per iteration (safe threshold)
        );

        if (completion.usage.total_tokens > MAX_TOKENS_PER_ITERATION) {
          console.error(`🔴 ITERATION TOKEN LIMIT EXCEEDED: ${completion.usage.total_tokens} tokens (limit: ${MAX_TOKENS_PER_ITERATION})`);
          console.error(`   This iteration alone consumed ${completion.usage.total_tokens} tokens!`);

          // Log token limit exceeded to audit trail
          await auditTrail.log({
            action: AUDIT_EVENTS.AGENTKIT_ITERATION_TOKEN_LIMIT_EXCEEDED,
            entityType: 'agent',
            entityId: agent.id,
            userId: userId,
            resourceName: agent.agent_name,
            details: {
              sessionId: sessionId,
              iteration: iteration,
              tokens_this_iteration: completion.usage.total_tokens,
              token_limit: MAX_TOKENS_PER_ITERATION,
              total_tokens_so_far: totalTokens.total,
              prompt_tokens: completion.usage.prompt_tokens,
              completion_tokens: completion.usage.completion_tokens
            },
            severity: 'critical'
          });

          // Return error result to prevent further credit exhaustion
          return {
            success: false,
            response: '',
            error: `Iteration ${iteration} exceeded token limit: ${completion.usage.total_tokens} tokens (limit: ${MAX_TOKENS_PER_ITERATION}). Execution stopped to prevent credit exhaustion.`,
            iterations: iteration,
            tokensUsed: totalTokens,
            toolCalls: toolCalls,
            executionTime: Date.now() - startTime
          };
        }

        // CIRCUIT BREAKER: Check total execution tokens across all iterations
        const MAX_TOTAL_EXECUTION_TOKENS = await SystemConfigService.getNumber(
          supabase,
          'max_total_execution_tokens',
          200000 // Default: 200K tokens total (emergency stop)
        );

        if (totalTokens.total > MAX_TOTAL_EXECUTION_TOKENS) {
          console.error(`🔴 CIRCUIT BREAKER TRIGGERED: ${totalTokens.total} total tokens (limit: ${MAX_TOTAL_EXECUTION_TOKENS})`);
          console.error(`   Execution consumed ${totalTokens.total} tokens across ${iteration} iterations!`);

          // Log circuit breaker triggered to audit trail
          await auditTrail.log({
            action: AUDIT_EVENTS.AGENTKIT_CIRCUIT_BREAKER_TRIGGERED,
            entityType: 'agent',
            entityId: agent.id,
            userId: userId,
            resourceName: agent.agent_name,
            details: {
              sessionId: sessionId,
              iteration: iteration,
              total_tokens: totalTokens.total,
              token_limit: MAX_TOTAL_EXECUTION_TOKENS,
              prompt_tokens: totalTokens.prompt,
              completion_tokens: totalTokens.completion,
              estimated_cost_usd: (totalTokens.total / 1000000) * 3 // Rough estimate at $3/1M tokens
            },
            severity: 'critical'
          });

          // Return error result to prevent further credit exhaustion
          return {
            success: false,
            response: '',
            error: `Circuit breaker triggered: Total execution consumed ${totalTokens.total} tokens (limit: ${MAX_TOTAL_EXECUTION_TOKENS}). Execution stopped to prevent credit exhaustion.`,
            iterations: iteration,
            tokensUsed: totalTokens,
            toolCalls: toolCalls,
            executionTime: Date.now() - startTime
          };
        }
      }

      const message = completion.choices[0].message;

      console.log('\n📊 AGENTKIT DEBUG - OPENAI RESPONSE:', {
        has_content: !!message.content,
        content_length: message.content?.length || 0,
        has_tool_calls: !!message.tool_calls,
        tool_calls_count: message.tool_calls?.length || 0,
        tokens_used: completion.usage
      });

      // Check if OpenAI wants to call any tools
      if (!message.tool_calls || message.tool_calls.length === 0) {
        // No more tool calls - execution is complete!
        console.log(`✅ AgentKit: Completed in ${iteration} iterations`);
        console.log(`💰 Tokens used: ${totalTokens.total} (${totalTokens.prompt} prompt + ${totalTokens.completion} completion)`);
        console.log('\n📊 AGENTKIT DEBUG - FINAL RESPONSE:\n', message.content);

        // NOTE: Token tracking happens automatically via openaiProvider.chatCompletion() at line 294
        // No manual tracking needed here to avoid duplicates

        // EXECUTION SUMMARY - Model usage tracking
        console.log('\n' + '='.repeat(80));
        console.log('📊 AGENTKIT EXECUTION SUMMARY');
        console.log('='.repeat(80));
        console.log(`🤖 Agent: ${agent.agent_name}`);
        console.log(`🆔 Agent ID: ${agent.id}`);
        console.log(`🤝 Model Used: ${selectedModel}`);
        console.log(`🏢 Provider: ${selectedProvider.toUpperCase()}`);
        console.log(`🎯 Routing: ${ROUTING_ENABLED ? 'ENABLED ✅' : 'DISABLED ❌'}`);
        console.log(`💡 Reasoning: ${routingReasoning}`);
        console.log(`🔄 Iterations: ${iteration} / ${AGENTKIT_CONFIG.maxIterations}`);
        console.log(`🔧 Tool Calls: ${toolCalls.length} (${toolCalls.filter(tc => tc.success).length} successful)`);
        console.log(`💰 Tokens: ${totalTokens.prompt} input + ${totalTokens.completion} output = ${totalTokens.total} total`);
        console.log(`⏱️  Duration: ${Date.now() - startTime}ms`);
        console.log(`✅ Status: SUCCESS`);
        console.log('='.repeat(80) + '\n');

        // Log successful completion to audit trail
        await auditTrail.log({
          action: AUDIT_EVENTS.AGENTKIT_EXECUTION_COMPLETED,
          entityType: 'agent',
          entityId: agent.id,
          userId: userId,
          resourceName: agent.agent_name,
          details: {
            sessionId: sessionId,
            iterations: iteration,
            total_tokens: totalTokens.total,
            execution_time_ms: Date.now() - startTime,
            tool_calls_count: toolCalls.length,
            plugins_used: [...new Set(toolCalls.map(tc => tc.plugin))],
            response_length: message.content?.length || 0,
            // Model usage tracking
            model_used: selectedModel,
            provider_used: selectedProvider,
            routing_enabled: ROUTING_ENABLED,
            routing_reasoning: routingReasoning
          },
          severity: 'info'
        });

        // MEMORY SYSTEM: Async summarization (fire-and-forget)
        const executionResult = {
          success: true,
          response: message.content || "Task completed successfully.",
          toolCalls: toolCalls,
          tokensUsed: totalTokens,
          executionTime: Date.now() - startTime,
          iterations: iteration,
          model: selectedModel,
          provider: selectedProvider,
          // Memory stats for UI display
          memoryStats: {
            memoriesLoaded: memoryContext.recent_runs.length + memoryContext.user_context.length + memoryContext.relevant_patterns.length,
            recentRuns: memoryContext.recent_runs.length,
            userPreferences: memoryContext.user_context.length,
            patterns: memoryContext.relevant_patterns.length,
            tokenCount: memoryContext.token_count
          },
          // Memory data for AIS tracking (NEW)
          memoryData: {
            tokens: memoryContext.token_count,
            entryCount: memoryContext.recent_runs.length + memoryContext.user_context.length + memoryContext.relevant_patterns.length,
            types: [
              ...(memoryContext.recent_runs.length > 0 ? ['summaries'] : []),
              ...(memoryContext.user_context.length > 0 ? ['user_context'] : []),
              ...(memoryContext.relevant_patterns.length > 0 ? ['patterns'] : [])
            ]
          }
        };

        // Trigger async memory summarization (doesn't block response)
        summarizeExecutionAsync(
          supabase,
          agent,
          userId,
          executionResult,
          runNumber,
          { userInput, inputValues },
          memoryInjector
        ).catch((err: any) => {
          console.error('❌ [Memory] Async summarization failed (non-critical):', err);
        });

        return executionResult;
      }

      // Add assistant's message with tool calls to conversation history
      messages.push(message);

      // NOTE: Token tracking already happened automatically via openaiProvider.chatCompletion() at line 294
      // No manual tracking needed here to avoid duplicates

      // STEP 5: Execute tool calls using V2 Plugin System
      console.log(`🔌 AgentKit: Executing ${message.tool_calls.length} tool call(s)...`);

      for (const toolCall of message.tool_calls) {
        // Type guard to ensure we have a function tool call
        if (toolCall.type !== 'function') continue;

        // Parse function name (format: "pluginKey__actionName")
        const [pluginKey, actionName] = toolCall.function.name.split('__');

        // Parse function arguments
        let parameters: any;
        try {
          parameters = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error(`❌ AgentKit: Failed to parse tool arguments for ${toolCall.function.name}:`, toolCall.function.arguments);
          parameters = {};
        }

        console.log(`  → ${pluginKey}.${actionName}(${Object.keys(parameters).join(', ')})`);
        console.log('\n📊 AGENTKIT DEBUG - TOOL CALL PARAMS:', JSON.stringify(parameters, null, 2));

        try {
          // Execute using V2 PluginExecuterV2!
          // This will:
          // 1. Validate parameters against JSON Schema
          // 2. Get user connection with token refresh if needed
          // 3. Route to specific plugin executor (GmailPluginExecutor, etc.)
          // 4. Execute the action via the appropriate API
          // 5. Return formatted result with error mapping
          const result = await pluginExecuter.execute(
            userId,
            pluginKey,
            actionName,
            parameters
          );

          console.log('\n📊 AGENTKIT DEBUG - PLUGIN RESULT:', JSON.stringify(result, null, 2));

          if (result.success) {
            console.log(`    ✓ Success: ${result.message || 'OK'}`);

            // Log successful plugin execution to audit trail
            await auditTrail.log({
              action: AUDIT_EVENTS.AGENTKIT_PLUGIN_SUCCESS,
              entityType: 'plugin',
              entityId: pluginKey,
              userId: userId,
              resourceName: `${pluginKey}.${actionName}`,
              details: {
                sessionId: sessionId,
                agent_id: agent.id,
                agent_name: agent.agent_name,
                action: actionName,
                iteration: iteration,
                parameters_count: Object.keys(parameters).length,
                result_message: result.message
              },
              severity: 'info'
            });
          } else {
            console.log(`    ✗ Failed: ${result.error || result.message}`);

            // Log failed plugin execution to audit trail
            await auditTrail.log({
              action: AUDIT_EVENTS.AGENTKIT_PLUGIN_FAILED,
              entityType: 'plugin',
              entityId: pluginKey,
              userId: userId,
              resourceName: `${pluginKey}.${actionName}`,
              details: {
                sessionId: sessionId,
                agent_id: agent.id,
                agent_name: agent.agent_name,
                action: actionName,
                iteration: iteration,
                error: result.error || result.message,
                parameters_count: Object.keys(parameters).length
              },
              severity: 'warning'
            });
          }

          // Track tool call for analytics
          toolCalls.push({
            plugin: pluginKey,
            action: actionName,
            parameters: parameters,
            result: result,
            success: result.success
          });

          // LOOP DETECTION: Prevent infinite loops by tracking recent tool calls
          const toolSignature = `${pluginKey}.${actionName}`;
          recentToolCalls.push(toolSignature);

          // Keep only the last N calls (sliding window)
          if (recentToolCalls.length > LOOP_DETECTION_WINDOW) {
            recentToolCalls.shift();
          }

          // Check if we're in a loop (same tool called repeatedly)
          if (recentToolCalls.length >= MAX_SAME_TOOL_REPEATS) {
            const lastNCalls = recentToolCalls.slice(-MAX_SAME_TOOL_REPEATS);
            const allSame = lastNCalls.every(call => call === toolSignature);

            if (allSame) {
              console.error(`🔴 LOOP DETECTED: ${toolSignature} called ${MAX_SAME_TOOL_REPEATS} times in a row!`);
              console.error(`   Recent calls: ${recentToolCalls.join(' → ')}`);

              // Log loop detection to audit trail
              await auditTrail.log({
                action: AUDIT_EVENTS.AGENTKIT_LOOP_DETECTED,
                entityType: 'agent',
                entityId: agent.id,
                userId: userId,
                resourceName: agent.agent_name,
                details: {
                  sessionId: sessionId,
                  loop_tool: toolSignature,
                  consecutive_calls: MAX_SAME_TOOL_REPEATS,
                  recent_calls: recentToolCalls,
                  iteration: iteration,
                  tokens_used_before_stop: totalTokens.total
                },
                severity: 'critical'
              });

              // Return error result to prevent credit exhaustion
              return {
                success: false,
                response: '',
                error: `Loop detected: ${toolSignature} called ${MAX_SAME_TOOL_REPEATS} times consecutively. Execution stopped to prevent credit exhaustion.`,
                iterations: iteration,
                tokensUsed: totalTokens,
                toolCalls: toolCalls,
                executionTime: Date.now() - startTime
              };
            }
          }

          // Add tool result to conversation so OpenAI can use it
          // CRITICAL: Truncate large responses to prevent token explosion
          const resultString = JSON.stringify(result);

          // Get max response size from system config
          const MAX_TOOL_RESPONSE_CHARS = await SystemConfigService.getNumber(
            supabase,
            'max_tool_response_chars',
            8000 // Default: 8000 chars = ~2000 tokens
          );

          let truncatedContent = resultString;
          if (resultString.length > MAX_TOOL_RESPONSE_CHARS) {
            // Intelligently truncate while preserving structure
            const truncated = resultString.substring(0, MAX_TOOL_RESPONSE_CHARS);
            const itemCount = result.data?.emails?.length || result.data?.items?.length || result.data?.length || 'multiple';

            truncatedContent = truncated + `\n\n...[Response truncated for token efficiency. Original size: ${resultString.length} chars (${Math.ceil(resultString.length / 4)} tokens). Showing first ${MAX_TOOL_RESPONSE_CHARS} chars. Full data contains ${itemCount} items. Use your AI capabilities to process and analyze this data without requesting the full response again.]`;

            console.warn(`⚠️  Tool response truncated to prevent token explosion:`);
            console.warn(`    Original: ${resultString.length} chars (~${Math.ceil(resultString.length / 4)} tokens)`);
            console.warn(`    Truncated: ${MAX_TOOL_RESPONSE_CHARS} chars (~${Math.ceil(MAX_TOOL_RESPONSE_CHARS / 4)} tokens)`);
            console.warn(`    Saved: ~${Math.ceil((resultString.length - MAX_TOOL_RESPONSE_CHARS) / 4)} tokens`);
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: truncatedContent
          });

        } catch (error: any) {
          console.error(`    ✗ Execution error: ${error.message}`);

          // Track failed tool call
          toolCalls.push({
            plugin: pluginKey,
            action: actionName,
            parameters: parameters,
            result: { success: false, error: error.message },
            success: false
          });

          // Add error to conversation so OpenAI can handle it intelligently
          // OpenAI might retry with different parameters or use an alternative approach
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify({
              success: false,
              error: error.message || "Plugin execution failed",
              message: `The ${pluginKey}.${actionName} action failed. Please try an alternative approach or inform the user.`
            })
          });
        }
      }

      // Continue to next iteration with updated conversation
    }

    // Max iterations reached - task is too complex
    console.warn(`⚠️ AgentKit: Reached maximum iterations (${AGENTKIT_CONFIG.maxIterations})`);
    console.log(`💰 Tokens used: ${totalTokens.total}`);

    // Log max iterations warning to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENTKIT_MAX_ITERATIONS_REACHED,
      entityType: 'agent',
      entityId: agent.id,
      userId: userId,
      resourceName: agent.agent_name,
      details: {
        sessionId: sessionId,
        max_iterations: AGENTKIT_CONFIG.maxIterations,
        total_tokens: totalTokens.total,
        execution_time_ms: Date.now() - startTime,
        tool_calls_count: toolCalls.length,
        plugins_attempted: [...new Set(toolCalls.map(tc => tc.plugin))]
      },
      severity: 'warning'
    });

    return {
      success: false,
      response: "The task is too complex and reached the maximum number of execution steps. Please try breaking it into smaller, simpler requests.",
      toolCalls: toolCalls,
      tokensUsed: totalTokens,
      executionTime: Date.now() - startTime,
      iterations: iteration,
      error: "MAX_ITERATIONS_REACHED"
    };

  } catch (error: any) {
    console.error('❌ AgentKit: Execution error:', error);

    // Log execution failure to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENTKIT_EXECUTION_FAILED,
      entityType: 'agent',
      entityId: agent.id,
      userId: userId,
      resourceName: agent.agent_name,
      details: {
        sessionId: sessionId,
        error_message: error.message,
        error_stack: error.stack?.substring(0, 500), // First 500 chars of stack
        execution_time_ms: Date.now() - startTime,
        tool_calls_attempted: toolCalls.length,
        plugins_used: [...new Set(toolCalls.map(tc => tc.plugin))]
      },
      severity: 'warning'
    });

    return {
      success: false,
      response: `Execution failed: ${error.message}. Please try again or contact support if the issue persists.`,
      toolCalls: toolCalls,
      tokensUsed: { prompt: 0, completion: 0, total: 0 },
      executionTime: Date.now() - startTime,
      iterations: 0,
      error: error.message
    };
  }
}

/**
 * Async memory summarization helper
 *
 * Runs in background after execution completes to create memory summary
 * Does not block user-facing response
 */
async function summarizeExecutionAsync(
  supabase: any,
  agent: any,
  userId: string,
  executionResult: any,
  runNumber: number,
  input: { userInput: string; inputValues?: Record<string, any> },
  memoryInjector: MemoryInjector
): Promise<void> {
  try {
    console.log(`🧠 [Memory] Starting async summarization for run #${runNumber}`);

    // Get recent runs for comparison context
    const recentRuns = await memoryInjector.getRecentRunsForSummarization(agent.id, 5);

    // Create summarizer (uses service role client internally)
    const summarizer = new MemorySummarizer();

    // Build summarization input
    const summarizationInput = {
      execution_id: uuidv4(),
      agent_id: agent.id,
      user_id: userId,
      run_number: runNumber,

      agent_name: agent.agent_name,
      agent_description: agent.system_prompt || agent.enhanced_prompt || agent.user_prompt,
      agent_mode: 'agentkit',

      input: input,
      output: executionResult.response,
      status: executionResult.success ? ('success' as const) : ('failed' as const),
      model_used: executionResult.model || 'unknown',
      credits_consumed: 0, // TODO: Calculate from tokens if needed
      execution_time_ms: executionResult.executionTime,
      ais_score: undefined,
      error_logs: undefined,

      recent_runs: recentRuns
    };

    // Call summarizer
    await summarizer.summarizeExecution(summarizationInput);

    console.log(`✅ [Memory] Async summarization completed for run #${runNumber}`);

    // Extract user memories (preferences, context, patterns)
    console.log(`🧠 [UserMemory] Extracting user preferences for run #${runNumber}`);
    const userMemoryService = new UserMemoryService(supabase, process.env.OPENAI_API_KEY);
    await userMemoryService.extractMemoriesFromExecution(
      userId,
      agent.id,
      summarizationInput.execution_id,
      agent.agent_name,
      JSON.stringify(input),
      executionResult.response,
      agent.system_prompt || agent.enhanced_prompt || agent.user_prompt
    );
    console.log(`✅ [UserMemory] User preference extraction completed for run #${runNumber}`);

  } catch (error) {
    console.error('❌ [Memory] Async summarization error:', error);
    // Don't throw - this is background processing
  }
}
