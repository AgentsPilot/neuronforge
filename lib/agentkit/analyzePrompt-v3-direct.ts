// lib/agentkit/analyzePrompt-v3-direct.ts
// OPTION 3: Direct AgentKit Prompt Injection - Simplest approach

import { openai, AGENTKIT_CONFIG } from './agentkitClient';
import { convertPluginsToTools, getPluginContextPrompt } from './convertPlugins';

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
  workflow_type: 'pure_ai' | 'data_retrieval_ai' | 'ai_external_actions';
  suggested_plugins: string[];
  required_inputs: AnalyzedInput[];
  workflow_steps: AnalyzedWorkflowStep[];
  reasoning: string;
  confidence: number;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * OPTION 3: Direct AgentKit prompt injection
 *
 * Simple approach: Give AgentKit the prompt, available plugins, and clear instructions.
 * Let AgentKit's native intelligence figure out the rest.
 */
export async function analyzePromptDirectAgentKit(
  userId: string,
  userPrompt: string,
  availablePlugins: string[]
): Promise<PromptAnalysisResult> {
  console.log(`🎯 AgentKit Direct: Analyzing prompt with native intelligence`);
  console.log(`📦 Available plugins: ${availablePlugins.join(', ')}`);

  try {
    // Get tools and plugin context (same as execution)
    const tools = await convertPluginsToTools(userId, availablePlugins);
    const pluginContext = await getPluginContextPrompt(userId, availablePlugins);

    console.log(`🔧 AgentKit Direct: Loaded ${tools.length} available actions`);

    // CRITICAL: Very clear instructions to AgentKit
    const systemPrompt = `You are an intelligent agent builder. Your job is to analyze a user's request and create a complete agent specification.

# Your Task:
Analyze the user's request and return a JSON object with the agent specification.

# Connected Services Available:
${pluginContext}

# CRITICAL RULES:
1. **ONLY use plugins that are EXPLICITLY mentioned or clearly needed**
2. **NEVER add plugins "just in case" or as defaults**
3. **Identify ALL required inputs** - check each plugin action's parameters
4. **If a parameter is missing, add it as a required input**

# Examples:
- "Summarize text" → NO plugins (pure AI)
- "Email me results" → google-mail + need recipient_email input
- "Send to my sheet" → google-sheets + need spreadsheet_id and range inputs
- "Research AI trends" → chatgpt-research (platform plugin, always available)

# Response Format:
Return a JSON object with:
{
  "agent_name": "Short descriptive name",
  "description": "What the agent does (1 sentence)",
  "workflow_type": "pure_ai|data_retrieval_ai|ai_external_actions",
  "suggested_plugins": ["plugin1", "plugin2"],
  "required_inputs": [
    {
      "name": "spreadsheet_id",
      "type": "text",
      "required": true,
      "description": "Google Sheet ID to write to",
      "placeholder": "Enter spreadsheet ID or URL",
      "reasoning": "Required by google-sheets append_rows action"
    }
  ],
  "workflow_steps": [
    {
      "operation": "Read last 10 emails",
      "plugin": "google-mail",
      "plugin_action": "search_emails",
      "reasoning": "User requested last 10 emails"
    },
    {
      "operation": "Summarize email content",
      "plugin": "ai_processing",
      "plugin_action": "process",
      "reasoning": "Summarization is AI processing"
    },
    {
      "operation": "Append summary to Google Sheet",
      "plugin": "google-sheets",
      "plugin_action": "append_rows",
      "reasoning": "User wants to send to sheet"
    }
  ],
  "reasoning": "Explain your analysis",
  "confidence": 0.95
}

# IMPORTANT - Input Detection:
For each plugin action in workflow_steps:
1. Check what parameters it requires (see Connected Services above)
2. If parameter value is NOT in the user's prompt, add it to required_inputs
3. Example: append_rows needs "spreadsheet_id", "range", "values"
   - "values" comes from AI summary
   - "spreadsheet_id" NOT in prompt → add to required_inputs
   - "range" could default to sheet name, but better to ask → add to required_inputs`;

    const completion = await openai.chat.completions.create({
      model: AGENTKIT_CONFIG.model,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Analyze this request and create an agent specification:\n\n"${userPrompt}"\n\nReturn ONLY the JSON object, nothing else.`
        }
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    });

    const rawResponse = completion.choices[0].message.content || '{}';
    console.log('\n📊 AGENTKIT DIRECT - RAW RESPONSE:\n', rawResponse);

    const analysis = JSON.parse(rawResponse);

    // Extract token usage for analytics
    const tokensUsed = {
      prompt: completion.usage?.prompt_tokens || 0,
      completion: completion.usage?.completion_tokens || 0,
      total: completion.usage?.total_tokens || 0
    };

    // Validate suggested plugins exist
    const validPlugins = (analysis.suggested_plugins || []).filter((p: string) =>
      availablePlugins.includes(p)
    );

    if (validPlugins.length !== (analysis.suggested_plugins || []).length) {
      console.warn(`⚠️ AgentKit Direct: Some suggested plugins not available:`,
        (analysis.suggested_plugins || []).filter((p: string) => !availablePlugins.includes(p))
      );
    }

    const result: PromptAnalysisResult = {
      agent_name: analysis.agent_name || 'Custom Agent',
      description: analysis.description || userPrompt.substring(0, 100),
      workflow_type: analysis.workflow_type || 'pure_ai',
      suggested_plugins: validPlugins,
      required_inputs: analysis.required_inputs || [],
      workflow_steps: analysis.workflow_steps || [{
        operation: 'Process request',
        plugin: 'ai_processing',
        plugin_action: 'process',
        reasoning: 'Default AI processing'
      }],
      reasoning: analysis.reasoning || 'Direct AgentKit analysis',
      confidence: analysis.confidence || 0.85,
      tokensUsed: tokensUsed
    };

    console.log('\n✅ AGENTKIT DIRECT ANALYSIS RESULT:', {
      agent_name: result.agent_name,
      workflow_type: result.workflow_type,
      suggested_plugins: result.suggested_plugins,
      input_count: result.required_inputs.length,
      step_count: result.workflow_steps.length,
      confidence: result.confidence
    });

    return result;

  } catch (error: any) {
    console.error('❌ AgentKit Direct: Analysis failed:', error);

    // Fallback
    return {
      agent_name: 'Custom Agent',
      description: 'AI-powered automation agent',
      workflow_type: 'pure_ai',
      suggested_plugins: [],
      required_inputs: [],
      workflow_steps: [{
        operation: 'Process user request',
        plugin: 'ai_processing',
        plugin_action: 'process',
        reasoning: 'Fallback due to analysis error'
      }],
      reasoning: `Analysis failed: ${error.message}. Using fallback.`,
      confidence: 0.5
    };
  }
}
