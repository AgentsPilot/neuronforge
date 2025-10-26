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

export interface AnalyzedOutput {
  name: string;
  type: 'SummaryBlock' | 'EmailDraft' | 'PluginAction' | 'Alert';
  category: 'human-facing' | 'machine-facing';
  description: string;
  format?: 'table' | 'list' | 'markdown' | 'html' | 'json' | 'text';
  plugin?: string;  // For PluginAction outputs
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
  suggested_outputs: AnalyzedOutput[];  // NEW: Output suggestions from SDK
  reasoning: string;
  confidence: number;
  tokensUsed?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Generates an execution-optimized system prompt for AgentKit function calling
 * This prompt guides the agent during actual execution with function calls
 */
function generateExecutionSystemPrompt(
  userPrompt: string,
  workflowType: string,
  workflowSteps: AnalyzedWorkflowStep[],
  suggestedPlugins: string[]
): string {
  // Extract clean objective - detect enhanced prompts and extract from steps instead
  let objective = userPrompt.substring(0, 150);

  if (userPrompt.includes('**Data Source:**') || userPrompt.includes('**Processing Steps:**')) {
    // This is an enhanced prompt - extract clean goal from workflow steps
    const stepDescriptions = workflowSteps
      .filter(s => s.plugin !== 'ai_processing')
      .map(s => s.operation)
      .join(', then ');

    if (stepDescriptions) {
      objective = stepDescriptions;
    }
  }

  // Build workflow overview from steps
  const workflowOverview = workflowSteps.map((step, idx) => {
    // Clean up redundant text in operation
    let cleanOperation = step.operation
      .replace(new RegExp(`using ${step.plugin}`, 'gi'), '')
      .replace(new RegExp(`with ${step.plugin}`, 'gi'), '')
      .replace(new RegExp(step.plugin_action, 'gi'), '')
      .trim();

    return `${idx + 1}. ${cleanOperation} (${step.plugin}.${step.plugin_action})`;
  }).join('\n');

  // Build rich system prompt for execution
  return `You are executing ${workflowType.replace(/_/g, ' ')} automation.

OBJECTIVE:
${objective}

WORKFLOW:
${workflowOverview}

AVAILABLE SERVICES:
${suggestedPlugins.join(', ')}

EXECUTION RULES:
1. Follow the workflow steps in sequence
2. Use function calls ONLY to retrieve or save data to external services
3. Use your built-in AI for all data processing, analysis, and summarization
4. Handle errors gracefully and report them
5. Return structured results

EFFICIENCY - CRITICAL:
You are a powerful AI with built-in capabilities for:
- Text summarization (any length, any amount)
- Data analysis and processing
- Information extraction and formatting
- Content generation and transformation

🚫 PROHIBITED PATTERNS (will waste resources):
- Calling summarize/process functions in loops (e.g., for each email/item/row)
- Making the same function call multiple times with different data
- Using external functions for tasks you can do natively with your AI

✅ REQUIRED PATTERNS (efficient execution):
- Retrieve all data in ONE function call
- Process/analyze/summarize ALL data using your AI brain (NO function calls)
- Send/save final results in ONE function call

EXAMPLES:
Task: "Summarize 10 emails"
❌ WRONG: search_emails → summarize_content (x10) → send_email (12 calls)
✅ RIGHT: search_emails → [AI summarizes all 10] → send_email (2 calls)

Task: "Analyze data from sheet and send to Slack"
❌ WRONG: read_sheet → process_row (x100) → send_slack (102 calls)
✅ RIGHT: read_sheet → [AI analyzes all rows] → send_slack (2 calls)

Task: "Research 3 topics and create report"
✅ RIGHT: research(topic1) → research(topic2) → research(topic3) → [AI combines] → save_report (4 calls)
Note: Multiple research calls are OK because each retrieves DIFFERENT external data

RULE OF THUMB:
- Count of function calls should be: (# of data sources) + (# of destinations) + small constant
- NOT proportional to number of items being processed
- Most tasks: 2-5 function calls total, regardless of data volume`;
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
5. **DO NOT use chatgpt-research for basic summarization - use ai_processing instead**
6. **ONLY use chatgpt-research when user asks to "research" or "find information about" topics**

# Plugin Selection Examples:
- "Summarize my emails" → google-mail ONLY (ai_processing handles summary)
- "Analyze data and email results" → google-mail ONLY (ai_processing handles analysis)
- "Email me results" → google-mail + need recipient_email input
- "Send to my sheet" → google-sheets + need spreadsheet_id and range inputs
- "Research AI trends and email report" → chatgpt-research + google-mail (actual research task)
- "Find information about quantum computing" → chatgpt-research (web research needed)

# When to use ai_processing vs chatgpt-research:
- Summarize, analyze, process existing data → ai_processing (NO plugin needed)
- Research topics, find information online → chatgpt-research plugin

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
  "suggested_outputs": [
    {
      "name": "Research Report",
      "type": "SummaryBlock",
      "category": "human-facing",
      "description": "AI research results",
      "format": "table",
      "reasoning": "User mentioned 'table' in prompt"
    },
    {
      "name": "Email Delivery",
      "type": "PluginAction",
      "category": "human-facing",
      "plugin": "google-mail",
      "description": "Send results via email",
      "reasoning": "User wants to email the results"
    }
  ],
  "reasoning": "Explain your analysis",
  "confidence": 0.95
}

# ⚡ CRITICAL - ALWAYS DETECT OUTPUT FORMAT ⚡
EVERY SummaryBlock output MUST have a "format" field. Analyze the user's prompt and detect their desired format:

**SCAN THE PROMPT FOR THESE KEYWORDS:**
- "table", "spreadsheet", "rows", "columns" → ADD: "format": "table"
- "list", "bullet points", "numbered", "bullets" → ADD: "format": "list"
- "markdown", "formatted text" → ADD: "format": "markdown"
- "JSON", "data structure", "API" → ADD: "format": "json"
- "HTML", "web page" → ADD: "format": "html"
- NO keywords → ADD: "format": "text"

**EXAMPLE:**
User says: "Create a detailed table with results"
→ You MUST add: "format": "table" to the SummaryBlock output

**EXAMPLE:**
User says: "Send me bullet points"
→ You MUST add: "format": "list" to the SummaryBlock output

# Output Type Rules:
- If workflow generates content for user → type: "SummaryBlock" with REQUIRED format field
- If workflow saves/sends to a plugin → type: "PluginAction" with plugin name
- DO NOT create error notification outputs - these are added automatically by the system
- Focus on the main deliverable outputs only

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

    // Prepare workflow steps (with fallback)
    const workflowSteps = analysis.workflow_steps || [{
      operation: 'Process request',
      plugin: 'ai_processing',
      plugin_action: 'process',
      reasoning: 'Default AI processing'
    }];

    // Generate execution-optimized system prompt
    const executionSystemPrompt = generateExecutionSystemPrompt(
      userPrompt,
      analysis.workflow_type || 'pure_ai',
      workflowSteps,
      validPlugins
    );

    const result: PromptAnalysisResult = {
      agent_name: analysis.agent_name || 'Custom Agent',
      description: analysis.description || userPrompt.substring(0, 100),
      system_prompt: executionSystemPrompt,
      workflow_type: analysis.workflow_type || 'pure_ai',
      suggested_plugins: validPlugins,
      required_inputs: analysis.required_inputs || [],
      workflow_steps: workflowSteps,
      suggested_outputs: analysis.suggested_outputs || [],  // NEW: Parse outputs from SDK
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
      output_count: result.suggested_outputs.length,  // NEW: Log output count
      confidence: result.confidence
    });

    return result;

  } catch (error: any) {
    console.error('❌ AgentKit Direct: Analysis failed:', error);

    // Fallback workflow steps
    const fallbackSteps = [{
      operation: 'Process user request',
      plugin: 'ai_processing',
      plugin_action: 'process',
      reasoning: 'Fallback due to analysis error'
    }];

    // Generate fallback system prompt
    const fallbackSystemPrompt = generateExecutionSystemPrompt(
      userPrompt,
      'pure_ai',
      fallbackSteps,
      []
    );

    // Fallback
    return {
      agent_name: 'Custom Agent',
      description: 'AI-powered automation agent',
      system_prompt: fallbackSystemPrompt,
      workflow_type: 'pure_ai',
      suggested_plugins: [],
      required_inputs: [],
      workflow_steps: fallbackSteps,
      suggested_outputs: [],  // NEW: Empty outputs for fallback
      reasoning: `Analysis failed: ${error.message}. Using fallback.`,
      confidence: 0.5
    };
  }
}
