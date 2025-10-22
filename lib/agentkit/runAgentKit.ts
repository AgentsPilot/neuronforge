// lib/agentkit/runAgentKit.ts

import { openai, AGENTKIT_CONFIG } from './agentkitClient';
import { convertPluginsToTools, getPluginContextPrompt } from './convertPlugins';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider';
import { createClient } from '@supabase/supabase-js';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

// Initialize Supabase for analytics
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabase, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
});

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
  error?: string;
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

  // Initialize OpenAI Provider WITHOUT analytics (we'll track manually with tool call details)
  const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!);

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
      model: AGENTKIT_CONFIG.model,
      user_input: userInput.substring(0, 200), // First 200 chars
      has_input_values: inputValues ? Object.keys(inputValues).length > 0 : false,
      trigger_condition: agent.trigger_condintion
    },
    severity: 'info'
  });

  try {
    // STEP 1: Convert V2 plugins to OpenAI tools
    const tools = await convertPluginsToTools(userId, agent.plugins_required);

    if (tools.length === 0) {
      console.warn('⚠️ AgentKit: No plugins are connected');
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

    console.log(`🔧 AgentKit: Loaded ${tools.length} available actions across ${agent.plugins_required.length} plugins`);
    console.log('\n📊 AGENTKIT DEBUG - TOOLS AVAILABLE:', JSON.stringify(tools, null, 2));

    // STEP 2: Build enhanced system prompt with plugin context
    const pluginContext = await getPluginContextPrompt(userId, agent.plugins_required);

    // Check notification delivery preference from trigger_condintion
    const triggerConfig = agent.trigger_condintion?.error_handling || {};
    const deliveryMethod = triggerConfig.on_failure || 'alert'; // 'email' or 'alert'

    // Add delivery instructions based on trigger_condintion
    let deliveryInstructions = '';
    if (deliveryMethod === 'email') {
      deliveryInstructions = `\n\n## IMPORTANT: Result Delivery
- After completing the task, you MUST send the results via email using the google-mail send_email function
- Send the email to the user with a clear summary of what was accomplished
- Include all relevant details, results, and next steps in the email body
- The email subject should clearly describe the task completed`;
    } else {
      deliveryInstructions = `\n\n## IMPORTANT: Result Delivery
- Complete the task and return a clear summary
- Do NOT send emails unless explicitly requested in the task
- Return results directly for dashboard display`;
    }

    const systemPrompt = `${agent.system_prompt || agent.enhanced_prompt || agent.user_prompt}

${pluginContext}

## Instructions
- Use the available functions to accomplish the user's request
- Do NOT provide generic advice or suggestions - execute actual actions using the connected services
- If an action fails, try an alternative approach or inform the user clearly about what went wrong
- Provide specific results based on the actual data returned from function calls
- Always use the most appropriate function for the task${deliveryInstructions}`;

    console.log(`📬 AgentKit: Delivery method set to "${deliveryMethod}"`);
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

    while (iteration < AGENTKIT_CONFIG.maxIterations) {
      iteration++;
      console.log(`\n🔄 AgentKit: Iteration ${iteration}/${AGENTKIT_CONFIG.maxIterations}`);

      // Log the request being sent to OpenAI
      console.log('\n📊 AGENTKIT DEBUG - OPENAI REQUEST:', {
        model: AGENTKIT_CONFIG.model,
        temperature: AGENTKIT_CONFIG.temperature,
        tools_count: tools.length,
        messages_count: messages.length,
        iteration: iteration
      });

      // Call OpenAI with function calling enabled + analytics tracking
      // Note: We'll update activity_name after we see what tools were called
      const iterationStartTime = Date.now();
      const completion = await openaiProvider.chatCompletion(
        {
          model: AGENTKIT_CONFIG.model,
          messages: messages,
          tools: tools,
          tool_choice: "auto", // Let OpenAI decide when to use tools
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

        // Track final iteration (generating response)
        await aiAnalytics.trackAICall({
          call_id: `agentkit_iter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          user_id: userId,
          session_id: sessionId,
          provider: 'openai',
          model_name: AGENTKIT_CONFIG.model,
          endpoint: 'chat/completions',
          feature: 'agentkit_execution',
          component: 'run-agentkit',
          workflow_step: `iteration_${iteration}`,
          category: 'agent_execution',
          input_tokens: completion.usage?.prompt_tokens || 0,
          output_tokens: completion.usage?.completion_tokens || 0,
          cost_usd: ((completion.usage?.prompt_tokens || 0) * 0.0025 / 1000) +
                    ((completion.usage?.completion_tokens || 0) * 0.01 / 1000),
          latency_ms: Date.now() - iterationStartTime,
          response_size_bytes: JSON.stringify(completion).length,
          success: true,
          request_type: 'chat',
          activity_type: 'agent_execution',
          activity_name: `${agent.agent_name} - Final response`,
          agent_id: agent.id,
          activity_step: `iteration_${iteration}_of_${AGENTKIT_CONFIG.maxIterations}`
        });

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
            response_length: message.content?.length || 0
          },
          severity: 'info'
        });

        return {
          success: true,
          response: message.content || "Task completed successfully.",
          toolCalls: toolCalls,
          tokensUsed: totalTokens,
          executionTime: Date.now() - startTime,
          iterations: iteration
        };
      }

      // Add assistant's message with tool calls to conversation history
      messages.push(message);

      // STEP 5: Create descriptive activity name based on tool calls
      const toolCallDescriptions = message.tool_calls.map(tc => {
        if (tc.type === 'function') {
          const [pluginKey, actionName] = tc.function.name.split('__');
          return `${pluginKey}.${actionName}`;
        }
        return 'unknown';
      });
      const iterationActivity = toolCallDescriptions.length > 0
        ? toolCallDescriptions.join(' + ')
        : 'Processing';

      // Track this iteration with descriptive activity name
      await aiAnalytics.trackAICall({
        call_id: `agentkit_iter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: userId,
        session_id: sessionId,
        provider: 'openai',
        model_name: AGENTKIT_CONFIG.model,
        endpoint: 'chat/completions',
        feature: 'agentkit_execution',
        component: 'run-agentkit',
        workflow_step: `iteration_${iteration}`,
        category: 'agent_execution',
        input_tokens: completion.usage?.prompt_tokens || 0,
        output_tokens: completion.usage?.completion_tokens || 0,
        cost_usd: ((completion.usage?.prompt_tokens || 0) * 0.0025 / 1000) +
                  ((completion.usage?.completion_tokens || 0) * 0.01 / 1000),
        latency_ms: Date.now() - iterationStartTime,
        response_size_bytes: JSON.stringify(completion).length,
        success: true,
        request_type: 'chat',
        activity_type: 'agent_execution',
        activity_name: `${agent.agent_name} - ${iterationActivity}`,
        agent_id: agent.id,
        activity_step: `iteration_${iteration}_of_${AGENTKIT_CONFIG.maxIterations}`
      });

      // STEP 6: Execute tool calls using V2 Plugin System
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

          // Add tool result to conversation so OpenAI can use it
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result)
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
