// lib/agentkit/analyzePrompt-v2-sdk.ts
// OPTION 2: Use AgentKit SDK's native planning capabilities

import { openai, AGENTKIT_CONFIG } from './agentkitClient';
import { convertPluginsToTools } from './convertPlugins';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

export interface AnalyzedWorkflowStep {
  operation: string;
  plugin: string;
  plugin_action: string;
  reasoning: string;
}

export interface AnalyzedInput {
  name: string;
  type: 'text' | 'email' | 'number' | 'file' | 'select' | 'url' | 'date' | 'textarea';
  required: boolean;
  description: string;
  placeholder?: string;
  reasoning: string;
}

export interface PromptAnalysisResult {
  agent_name: string;
  description: string;
  system_prompt: string;  // AgentKit execution system prompt
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions';
  suggested_plugins: string[];
  required_inputs: AnalyzedInput[];
  workflow_steps: AnalyzedWorkflowStep[];
  reasoning: string;
  confidence: number;
}

/**
 * Generate execution-optimized system prompt for AgentKit
 */
function generateExecutionSystemPrompt(
  userPrompt: string,
  workflowType: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions',
  workflowSteps: AnalyzedWorkflowStep[],
  requiredInputs: AnalyzedInput[]
): string {
  // Extract automation type from user prompt or workflow type
  const automationType = workflowType === 'pure_ai'
    ? 'AI processing automation'
    : workflowType === 'data_retrieval_ai'
    ? 'data retrieval automation'
    : 'workflow automation';

  // Extract clean objective from user prompt
  // If it's an enhanced prompt (contains **Data Source:**), extract from workflow steps
  // Otherwise use the user prompt as-is
  let objective: string;
  if (userPrompt.includes('**Data Source:**') || userPrompt.includes('**Processing Steps:**')) {
    // Enhanced prompt - extract objective from workflow steps
    const stepDescriptions = workflowSteps
      .filter(s => s.plugin !== 'ai_processing')
      .map(s => s.operation)
      .join(', then ');
    objective = stepDescriptions || userPrompt.substring(0, 100);
  } else {
    // Simple user prompt - use as-is (truncate if too long)
    objective = userPrompt.length > 150
      ? userPrompt.substring(0, 147) + '...'
      : userPrompt;
  }

  // Build workflow section with cleaner descriptions
  const workflowSection = workflowSteps
    .map((step, idx) => {
      if (step.plugin === 'ai_processing') {
        return `${idx + 1}. Process: ${step.operation}`;
      } else {
        // Find input fields referenced in this step
        const stepInputs = requiredInputs
          .filter(input => step.operation.toLowerCase().includes(input.name.toLowerCase()))
          .map(input => `use input: ${input.name}`)
          .join(', ');

        const inputRef = stepInputs ? ` (${stepInputs})` : '';

        // Clean up the operation description - remove redundant plugin mentions
        let cleanOperation = step.operation
          .replace(new RegExp(`using ${step.plugin}`, 'gi'), '')
          .replace(new RegExp(`with ${step.plugin}`, 'gi'), '')
          .replace(new RegExp(step.plugin_action, 'gi'), '')
          .trim();

        // If operation is now empty or just the action name, create a better description
        if (!cleanOperation || cleanOperation === step.plugin_action) {
          cleanOperation = step.plugin_action.replace(/_/g, ' ');
        }

        return `${idx + 1}. Call ${step.plugin}.${step.plugin_action} to ${cleanOperation}${inputRef}`;
      }
    })
    .join('\n');

  // Build inputs section
  const inputsSection = requiredInputs.length > 0
    ? requiredInputs.map(input => `${input.name} (${input.type})`).join(', ')
    : 'None required';

  // Build error handling based on workflow type
  const errorHandling = workflowType === 'pure_ai'
    ? 'If processing fails, report the specific error. For large inputs, process in chunks.'
    : 'Retry failed function calls once with exponential backoff. Report authentication or connectivity issues clearly. Log errors with context.';

  // Construct the system prompt
  return `You are executing ${automationType}.

OBJECTIVE: ${objective}

WORKFLOW:
${workflowSection}

INPUTS AVAILABLE: ${inputsSection}

ERROR HANDLING: ${errorHandling}`;
}

/**
 * OPTION 2: Use AgentKit SDK's native planning with plugin constraints
 *
 * Instead of custom GPT-4o analysis, we leverage AgentKit's execution intelligence
 * by doing a "dry run" planning phase using OpenAI's function calling.
 *
 * Approach:
 * 1. Convert available plugins to OpenAI tools (same as execution)
 * 2. Ask OpenAI to PLAN the workflow (not execute)
 * 3. Extract tool calls as workflow steps
 * 4. Infer required inputs from parameters
 * 5. Return structured plan
 */
export async function analyzePromptWithAgentKitSDK(
  userId: string,
  userPrompt: string,
  availablePlugins: string[]
): Promise<PromptAnalysisResult> {
  console.log(`🧠 AgentKit SDK: Planning workflow for prompt`);
  console.log(`📦 Available plugins: ${availablePlugins.join(', ')}`);

  try {
    // STEP 1: Convert available plugins to OpenAI tools
    // This is exactly what we do during execution, ensuring consistency
    const tools = await convertPluginsToTools(userId, availablePlugins);

    console.log(`🔧 AgentKit SDK: Loaded ${tools.length} available actions`);

    // STEP 2: Create planning prompt
    // Ask OpenAI to demonstrate what tool calls would be needed
    const planningPrompt = `Analyze this automation request and demonstrate the complete workflow by making the necessary function calls.

USER REQUEST:
"""
${userPrompt}
"""

INSTRUCTIONS:
1. Identify ALL the steps needed to complete this request from start to finish
2. For EACH step, make the corresponding function call with placeholder values
3. Make ALL the calls in sequence - don't skip any steps

EXAMPLES:
- "Read emails and send summary" → Call search_emails, then call send_email
- "Get data and save to sheet" → Call to retrieve data, then call to append to sheet
- "Summarize text" → No function calls needed (pure AI)

IMPORTANT:
- Use placeholder values like "{{recipient}}" for missing information
- Make function calls in the correct order
- Include ALL steps - both reading/getting data AND sending/saving results

Now demonstrate the complete workflow for the user's request by making all necessary function calls:`;

    const messages: ChatCompletionMessageParam[] = [
      {
        role: "system",
        content: "You are a workflow execution planner. When given a user request, you demonstrate the workflow by making the exact function calls that would be needed, in the correct order. Use placeholder values for missing information."
      },
      { role: "user", content: planningPrompt }
    ];

    // STEP 3: Call OpenAI with tools available (planning mode)
    console.log(`🎯 AgentKit SDK: Requesting workflow plan from GPT-4o...`);

    const completion = await openai.chat.completions.create({
      model: AGENTKIT_CONFIG.model,
      messages: messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature: 0.1,
      max_tokens: 3000,
    });

    const message = completion.choices[0].message;

    console.log('\n📊 AGENTKIT SDK PLANNING - RESPONSE:', {
      has_content: !!message.content,
      has_tool_calls: !!message.tool_calls,
      tool_calls_count: message.tool_calls?.length || 0
    });

    // STEP 4: Extract workflow from tool calls
    const suggestedPlugins: string[] = [];
    const workflowSteps: AnalyzedWorkflowStep[] = [];
    const requiredInputsMap = new Map<string, AnalyzedInput>();

    // If OpenAI suggested tool calls, those are our workflow steps!
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== 'function') continue;

        // Parse function name (format: "pluginKey__actionName")
        const [pluginKey, actionName] = toolCall.function.name.split('__');

        if (!suggestedPlugins.includes(pluginKey)) {
          suggestedPlugins.push(pluginKey);
        }

        // Parse parameters to identify required inputs
        let parameters: any = {};
        try {
          parameters = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.warn(`⚠️ Could not parse tool arguments:`, toolCall.function.arguments);
        }

        // Extract required inputs from parameters
        // If a parameter value is missing or a placeholder, we need it as input
        for (const [paramName, paramValue] of Object.entries(parameters)) {
          if (!paramValue ||
              paramValue === 'USER_INPUT_NEEDED' ||
              paramValue === 'TO_BE_PROVIDED' ||
              (typeof paramValue === 'string' && paramValue.includes('{{')) // Template placeholder
          ) {
            const inputKey = `${pluginKey}_${actionName}_${paramName}`;
            if (!requiredInputsMap.has(inputKey)) {
              requiredInputsMap.set(inputKey, {
                name: paramName,
                type: inferInputType(paramName),
                required: true,
                description: `Required for ${pluginKey}.${actionName}`,
                placeholder: `Enter ${paramName}`,
                reasoning: `This parameter is required by the ${actionName} action`
              });
            }
          }
        }

        workflowSteps.push({
          operation: `${actionName} using ${pluginKey}`,
          plugin: pluginKey,
          plugin_action: actionName,
          reasoning: `Identified from AgentKit SDK planning`
        });
      }
    }

    // STEP 5: Parse the textual response for additional context
    const planContent = message.content || '';

    // Determine workflow type based on tool calls
    let workflowType: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions' = 'pure_ai';
    if (suggestedPlugins.length > 0) {
      // Check if any plugins are data retrieval (gmail, sheets, drive, etc.)
      const dataPlugins = ['google-mail', 'google-sheets', 'google-drive', 'google-docs', 'chatgpt-research'];
      const hasDataRetrieval = suggestedPlugins.some(p => dataPlugins.includes(p));

      // Check if any plugins perform external actions (send email, write files, etc.)
      const hasExternalActions = workflowSteps.some(step =>
        step.plugin_action.includes('send') ||
        step.plugin_action.includes('write') ||
        step.plugin_action.includes('create') ||
        step.plugin_action.includes('update') ||
        step.plugin_action.includes('append')
      );

      if (hasExternalActions) {
        workflowType = 'ai_external_actions';
      } else if (hasDataRetrieval) {
        workflowType = 'data_retrieval_ai';
      }
    }

    // Generate agent name from prompt (simple extraction)
    const agentName = generateAgentName(userPrompt);

    // STEP 6: Generate execution system prompt for AgentKit
    const workflowStepsToUse = workflowSteps.length > 0 ? workflowSteps : [{
      operation: 'Process with AI',
      plugin: 'ai_processing',
      plugin_action: 'process',
      reasoning: 'No external tools needed - pure AI processing'
    }];

    const requiredInputsArray = Array.from(requiredInputsMap.values());

    const systemPrompt = generateExecutionSystemPrompt(
      userPrompt,
      workflowType,
      workflowStepsToUse,
      requiredInputsArray
    );

    const result: PromptAnalysisResult = {
      agent_name: agentName,
      description: userPrompt.length > 100 ? userPrompt.substring(0, 97) + '...' : userPrompt,
      system_prompt: systemPrompt,
      workflow_type: workflowType,
      suggested_plugins: suggestedPlugins,
      required_inputs: requiredInputsArray,
      workflow_steps: workflowStepsToUse,
      reasoning: `AgentKit SDK Planning: ${suggestedPlugins.length > 0 ? `Identified ${suggestedPlugins.length} plugin(s) needed` : 'Pure AI processing, no plugins required'}`,
      confidence: 0.9
    };

    console.log('\n✅ AGENTKIT SDK ANALYSIS RESULT:', {
      agent_name: result.agent_name,
      workflow_type: result.workflow_type,
      suggested_plugins: result.suggested_plugins,
      input_count: result.required_inputs.length,
      step_count: result.workflow_steps.length,
      confidence: result.confidence,
      has_system_prompt: !!result.system_prompt
    });

    console.log('\n📝 Generated System Prompt:');
    console.log(result.system_prompt);
    console.log('---');

    return result;

  } catch (error: any) {
    console.error('❌ AgentKit SDK: Planning failed:', error);

    // Fallback to minimal analysis
    const fallbackSteps = [{
      operation: 'Process user request',
      plugin: 'ai_processing',
      plugin_action: 'process',
      reasoning: 'Fallback to AI processing due to planning error'
    }];

    const fallbackSystemPrompt = generateExecutionSystemPrompt(
      userPrompt,
      'pure_ai',
      fallbackSteps,
      []
    );

    return {
      agent_name: 'Custom Agent',
      description: 'AI-powered automation agent',
      system_prompt: fallbackSystemPrompt,
      workflow_type: 'pure_ai',
      suggested_plugins: [],
      required_inputs: [],
      workflow_steps: fallbackSteps,
      reasoning: `Planning failed: ${error.message}. Using fallback configuration.`,
      confidence: 0.5
    };
  }
}

/**
 * Infer input type from parameter name
 */
function inferInputType(paramName: string): AnalyzedInput['type'] {
  const lower = paramName.toLowerCase();

  if (lower.includes('email')) return 'email';
  if (lower.includes('url') || lower.includes('link')) return 'url';
  if (lower.includes('date') || lower.includes('time')) return 'date';
  if (lower.includes('number') || lower.includes('count') || lower.includes('amount')) return 'number';
  if (lower.includes('description') || lower.includes('body') || lower.includes('content')) return 'textarea';
  if (lower.includes('file') || lower.includes('document')) return 'file';

  return 'text';
}

/**
 * Generate a short agent name from the user prompt
 */
function generateAgentName(prompt: string): string {
  // Extract key action words
  const words = prompt.toLowerCase().split(' ');
  const actionWords = ['read', 'send', 'create', 'update', 'delete', 'search', 'find', 'analyze', 'summarize', 'research'];
  const nounWords = ['email', 'sheet', 'document', 'file', 'data', 'report', 'summary'];

  let name = '';

  // Find action
  const action = words.find(w => actionWords.includes(w)) || 'Process';
  name = action.charAt(0).toUpperCase() + action.slice(1);

  // Find noun
  const noun = words.find(w => nounWords.includes(w));
  if (noun) {
    name += ' ' + noun.charAt(0).toUpperCase() + noun.slice(1);
  }

  // Add "Agent" suffix if name is too short
  if (name.split(' ').length < 2) {
    name += ' Agent';
  }

  return name;
}
