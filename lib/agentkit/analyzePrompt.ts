// lib/agentkit/analyzePrompt.ts

import { openai, AGENTKIT_CONFIG } from './agentkitClient';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

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
}

/**
 * Analyze a user prompt using AgentKit's intelligence to determine:
 * - What plugins are actually needed
 * - What inputs are required
 * - What workflow steps should be executed
 *
 * This replaces the blind GPT-4o guessing in generate-agent with intelligent analysis
 */
export async function analyzePromptWithAgentKit(
  userId: string,
  userPrompt: string,
  availablePlugins: string[]
): Promise<PromptAnalysisResult> {
  console.log(`🧠 AgentKit: Analyzing prompt for intelligent agent generation`);
  console.log(`📦 Available plugins: ${availablePlugins.join(', ')}`);

  // Get plugin manager to access plugin definitions
  const pluginManager = await PluginManagerV2.getInstance();
  const allPluginDefs = pluginManager.getAvailablePlugins();

  // Build plugin context for GPT
  const pluginContext = availablePlugins.map(pluginKey => {
    const def = allPluginDefs[pluginKey];
    if (!def) return null;

    return {
      key: pluginKey,
      name: def.plugin.name,
      description: def.plugin.description,
      context: def.plugin.context,
      actions: Object.entries(def.actions).map(([actionName, actionDef]) => ({
        name: actionName,
        description: actionDef.description,
        usage_context: actionDef.usage_context
      }))
    };
  }).filter(Boolean);

  // Create analysis prompt
  const analysisPrompt = `You are an intelligent agent analyzer. Your job is to analyze user prompts and determine EXACTLY what plugins and inputs are needed.

USER PROMPT:
"""
${userPrompt}
"""

AVAILABLE PLUGINS:
${JSON.stringify(pluginContext, null, 2)}

CRITICAL ANALYSIS RULES:
1. **ONLY** suggest plugins that are EXPLICITLY mentioned or clearly needed in the prompt
2. **NEVER** add plugins "just in case" or as defaults
3. If the prompt says "research" → use chatgpt-research
4. If the prompt says "email" or "Gmail" → use google-mail
5. If the prompt says "Drive" or "save file" → use google-drive
6. If the prompt says "Sheets" or "spreadsheet" → use google-sheets
7. If NONE of these are mentioned → suggest NO plugins, use pure AI

REQUIRED INPUTS DETECTION:
- **ALWAYS** identify missing information needed to complete the task
- If prompt says "send to Google Sheet" → need "sheet_id" or "sheet_name" input
- If prompt says "email me" without email address → need "recipient_email" input
- If prompt says "save to Drive folder" without folder → need "folder_id" or "folder_name" input
- If prompt says "search my emails" with specific criteria → need "search_query" or "date_range" input
- **BE SPECIFIC**: Each plugin action has specific required parameters - check the plugin definitions!

EXAMPLES:
✅ "Research AI trends" → chatgpt-research (research mentioned!)
✅ "Search my emails" → google-mail (emails mentioned!)
✅ "Save to Google Drive" → google-drive (Drive mentioned!) + need "file_name" input
✅ "Send to my sheet" → google-sheets + need "sheet_id" or "sheet_name" input
❌ "Summarize this text" → NO plugins (just AI processing!)
❌ "Analyze data" → NO plugins (unless storage is mentioned!)
❌ "Create report" → NO plugins (unless sending/saving mentioned!)

YOUR TASK:
Analyze the prompt and return a JSON object with:
1. agent_name: Short, descriptive name
2. description: What the agent does (1 sentence)
3. workflow_type: "pure_ai" | "data_retrieval_ai" | "ai_external_actions"
4. suggested_plugins: Array of plugin keys that are ACTUALLY needed
5. required_inputs: Array of input fields needed (only what's missing from prompt)
6. workflow_steps: Array of steps with plugin + action assignments
7. reasoning: Why you chose these plugins (or why you chose none)
8. confidence: 0-1 confidence score

OUTPUT FORMAT:
{
  "agent_name": "string",
  "description": "string",
  "workflow_type": "pure_ai|data_retrieval_ai|ai_external_actions",
  "suggested_plugins": ["plugin1", "plugin2"],
  "required_inputs": [
    {
      "name": "field_name",
      "type": "text|email|number|etc",
      "required": true|false,
      "description": "what this field is for",
      "placeholder": "example value",
      "reasoning": "why this input is needed"
    }
  ],
  "workflow_steps": [
    {
      "operation": "clear description of step",
      "plugin": "plugin_key or 'ai_processing'",
      "plugin_action": "action_name or 'process'",
      "reasoning": "why this plugin/action"
    }
  ],
  "reasoning": "overall analysis reasoning",
  "confidence": 0.95
}

BE STRICT: Only suggest plugins that are clearly needed!`;

  try {
    const completion = await openai.chat.completions.create({
      model: AGENTKIT_CONFIG.model,
      messages: [
        { role: 'system', content: 'You are a precise agent analyzer. Only suggest plugins that are explicitly needed.' },
        { role: 'user', content: analysisPrompt }
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: 'json_object' }
    });

    const rawResponse = completion.choices[0].message.content || '{}';
    console.log('\n📊 AGENTKIT ANALYSIS - RAW RESPONSE:\n', rawResponse);

    const analysis = JSON.parse(rawResponse);

    // Validate suggested plugins exist
    const validPlugins = analysis.suggested_plugins.filter((p: string) =>
      availablePlugins.includes(p)
    );

    if (validPlugins.length !== analysis.suggested_plugins.length) {
      console.warn(`⚠️ AgentKit: Some suggested plugins not available:`,
        analysis.suggested_plugins.filter((p: string) => !availablePlugins.includes(p))
      );
    }

    const result: PromptAnalysisResult = {
      agent_name: analysis.agent_name || 'Untitled Agent',
      description: analysis.description || '',
      workflow_type: analysis.workflow_type || 'pure_ai',
      suggested_plugins: validPlugins,
      required_inputs: analysis.required_inputs || [],
      workflow_steps: analysis.workflow_steps || [],
      reasoning: analysis.reasoning || '',
      confidence: analysis.confidence || 0.8
    };

    console.log('\n✅ AGENTKIT ANALYSIS RESULT:', {
      agent_name: result.agent_name,
      workflow_type: result.workflow_type,
      suggested_plugins: result.suggested_plugins,
      input_count: result.required_inputs.length,
      step_count: result.workflow_steps.length,
      confidence: result.confidence
    });

    return result;

  } catch (error: any) {
    console.error('❌ AgentKit: Analysis failed:', error);

    // Fallback to minimal analysis
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
        reasoning: 'Fallback to AI processing due to analysis error'
      }],
      reasoning: `Analysis failed: ${error.message}. Using fallback configuration.`,
      confidence: 0.5
    };
  }
}
