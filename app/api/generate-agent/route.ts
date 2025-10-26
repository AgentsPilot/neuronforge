import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'
import { OpenAIProvider } from '@/lib/ai/providers/openaiProvider'
import { 
  pluginRegistry,
  getPluginDefinition,
  getConnectedPluginsWithMetadata,
  getInputTemplatesForCapability
  } from '@/lib/plugins/pluginRegistry'

// Initialize service role client for analytics
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize AI Analytics
const aiAnalytics = new AIAnalyticsService(supabaseServiceRole)

function getUsedCapabilities(steps: any[]): Record<string, string[]> {
  const used: Record<string, string[]> = {}
  steps.forEach(step => {
    if (step.plugin && step.plugin !== 'ai_processing') {
      if (!used[step.plugin]) used[step.plugin] = []
      if (!used[step.plugin].includes(step.plugin_action)) {
        used[step.plugin].push(step.plugin_action)
      }
    }
  })
  return used
}

function buildCompletePluginContext(connectedPluginKeys: string[]) {
  return connectedPluginKeys.map(key => {
    const plugin = pluginRegistry[key];
    if (!plugin) return null;
    
    return {
      key,
      name: plugin.displayName || plugin.label,
      capabilities: plugin.capabilities || [],
      capabilityDetails: plugin.capabilities?.map(cap => ({
        name: cap,
        requiredInputs: plugin.inputTemplates?.[cap] || [],
        outputs: plugin.outputTemplates?.[cap] || [],
        description: plugin.descriptions?.[cap] || `Performs ${cap} action`
      })) || []
    };
  }).filter(Boolean);
}

export async function POST(req: Request) {
  try {
    const { 
      prompt, 
      clarificationAnswers,
      agentId: providedAgentId,
      sessionId: providedSessionId
    } = await req.json()
    
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        }
      }
    )
    
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const sessionId = providedSessionId || 
                      clarificationAnswers?.sessionId || 
                      req.headers.get('x-session-id') || 
                      uuidv4()
    
    const agentId = providedAgentId || 
                    clarificationAnswers?.agentId || 
                    req.headers.get('x-agent-id') || 
                    uuidv4()

    console.log('AGENT GENERATION API - Using CONSISTENT IDs:', {
      providedAgentId,
      providedSessionId,
      finalAgentId: agentId,
      finalSessionId: sessionId
    })

    const { data: pluginRows } = await supabase
      .from('plugin_connections')
      .select('plugin_key')
      .eq('user_id', user.id)

    const connectedPluginKeys = pluginRows?.map(p => p.plugin_key) || []
    const pluginContext = buildCompletePluginContext(connectedPluginKeys)
    const fullPrompt = prompt

    // Initialize AI Provider with analytics
    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics)

    // HYBRID SMART ANALYSIS - Single comprehensive prompt
    const smartAnalysisPrompt = `You are a brilliant agent specification generator. You must analyze workflows and determine if they need plugins or are pure AI processing.

ENHANCED WORKFLOW PLAN:
"""
${fullPrompt}
"""

AVAILABLE PLUGINS WITH COMPLETE DETAILS:
${JSON.stringify(pluginContext, null, 2)}

YOUR ANALYSIS FRAMEWORK:

1. WORKFLOW TYPE DETECTION:
   - Is this pure AI processing? (analysis, generation, transformation of provided data)
   - Does this need external data sources? (emails, files, databases)
   - Does this need external actions? (sending emails, saving files, API calls)

2. PARSE THE WORKFLOW PLAN STEP BY STEP:
   - Break down every action mentioned
   - Identify what each action needs to accomplish
   - Determine if it's AI processing or requires a plugin

3. FOR PURE AI WORKFLOWS:
   - Identify what input data the user needs to provide
   - Determine the AI processing steps required
   - Define the expected output format

4. FOR PLUGIN-BASED WORKFLOWS:
   - Match actions to available plugins and capabilities
   - Check plugin requirements against provided information
   - Identify missing inputs needed for plugin operations

5. INPUT SCHEMA GENERATION:
   - For pure AI: Create fields for data the AI needs to process
   - For plugins: Create fields for missing plugin parameters
   - Use appropriate field types and make required only when necessary

CRITICAL INPUT RULE:
- Only create input fields for information that is EXPLICITLY MISSING and REQUIRED for execution
- Do not create "configuration" or "preference" fields unless specifically mentioned
- If the workflow provides specific values (like "detailed summary"), don't make it configurable
- Focus on the gap between what's specified and what's needed to execute

MISSING vs CONFIGURATION EXAMPLES:
❌ WRONG: "detailed summary" → create summary_length field (it's already specified!)
✅ RIGHT: "send to your manager" → create manager_email field (email address missing!)
❌ WRONG: "unread emails" → create max_results field (not mentioned in workflow)
✅ RIGHT: No mention of email subject → create subject_template field (required for sending)
❌ WRONG: "summarize emails" → create summary_style field (not requested in workflow)
✅ RIGHT: "save to important folder" → create folder_path field (folder location missing!)

6. WORKFLOW STEPS CREATION:
   - For pure AI: Define the AI processing pipeline
   - For plugins: Map actions to specific plugin + capability combinations
   - Ensure logical flow and dependencies

WORKFLOW CATEGORIES:

A. PURE AI PROCESSING:
   - Text analysis, summarization, generation
   - Data transformation, classification
   - Content creation, editing, formatting
   - Research synthesis, comparison
   
B. DATA RETRIEVAL + AI:
   - Read emails/files then analyze
   - Fetch data then process
   - Monitor sources then summarize
   
C. AI + EXTERNAL ACTIONS:
   - Generate content then save/send
   - Analyze data then notify/alert
   - Process input then execute actions

CRITICAL RULES:
- If no plugins are needed, workflow_steps should describe AI processing steps
- Only use plugins when external data/actions are required
- Don't force plugin usage for pure AI tasks
- Create minimal, essential input fields
- Be precise about what the agent actually does

OUTPUT REQUIRED:
{
  "analysis": {
    "workflow_type": "pure_ai|data_retrieval_ai|ai_external_actions",
    "requires_plugins": true|false,
    "workflow_actions": [
      {
        "action_description": "what this step does",
        "execution_type": "ai_processing|plugin_action",
        "chosen_plugin": "plugin_key or null for AI processing",
        "chosen_capability": "capability_name or null for AI processing",
        "ai_processing_type": "analysis|generation|transformation|classification",
        "reasoning": "why this choice was made",
        "required_data": ["list of data this step needs"],
        "missing_data": ["data not provided in workflow plan"]
      }
    ],
    "missing_inputs_analysis": [
      {
        "input_name": "field_name",
        "input_type": "email|text|number|file|select|url|date|textarea",
        "required": true|false,
        "description": "what user needs to provide",
        "reason": "which step needs this and why",
        "example": "example value"
      }
    ]
  },
  "agent_specification": {
    "agent_name": "descriptive name based on workflow",
    "description": "clear description of what agent does",
    "system_prompt": "execution-optimized system prompt for AgentKit",
    "input_schema": [
      {
        "name": "field_name",
        "type": "email|text|number|file|select|url|date|textarea",
        "required": true|false,
        "description": "user-friendly description",
        "placeholder": "example value"
      }
    ],
    "workflow_steps": [
      {
        "operation": "clear description of what this step does",
        "plugin": "plugin_key or 'ai_processing'",
        "plugin_action": "capability_name or ai_task_type"
      }
    ],
    "schedule": "cron expression if timing mentioned or null",
    "error_notifications": {
      "on_failure": "email",
      "retry_on_fail": true
    }
  }
}

7. SYSTEM PROMPT GENERATION FOR AGENTKIT EXECUTION:
   Create a concise, function-calling optimized system_prompt that AgentKit will use during execution.
   This prompt tells GPT-4o WHAT to accomplish and HOW to execute the workflow using available functions.

   SYSTEM PROMPT FORMAT (keep to 5-15 lines total):

   "You are executing [automation type from workflow].

   OBJECTIVE: [1-2 sentence clear statement of what to accomplish based on the enhanced workflow plan]

   WORKFLOW:
   [List 3-7 numbered steps mapping to workflow_steps, each formatted as:]
   1. Call [plugin].[action] to [purpose] (use input: [input_field_name])
   2. Process: [what AI needs to do with the data]
   3. Call [plugin].[action] to [deliver results] (use input: [input_field_name])

   INPUTS AVAILABLE: [Comma-separated list of input_schema field names with types]

   ERROR HANDLING: [Concise strategy: retry policy, fallback behavior, how to report failures]"

   SYSTEM PROMPT RULES:
   - Be CONCISE (5-15 lines max) - AgentKit adds plugin descriptions, date/time, and output instructions automatically
   - Focus on FUNCTION CALLING: Explicitly state which plugin.action to call for each step
   - Map workflow_steps to specific function calls: "Call google-mail.read_emails", not "retrieve emails"
   - Include input field references: "(use input: manager_email)" so GPT knows what data is available
   - Match the OBJECTIVE to what the enhanced workflow plan describes
   - For pure AI workflows (no plugins): Focus on processing steps and output format
   - DO NOT include: Plugin descriptions, date/time context, generic instructions (AgentKit adds these)
   - DO NOT be verbose or narrative - this is for execution, not explanation

   EXAMPLES:

   Example 1 (Plugin-based):
   "You are executing an email summarization automation.

   OBJECTIVE: Retrieve unread Gmail messages from a specific sender, extract key information and action items, create detailed summaries, and save them to a Notion database.

   WORKFLOW:
   1. Call google-mail.read_emails to fetch unread messages (use input: manager_email as sender filter)
   2. Process each email: extract sender, date, subject, key points, and action items
   3. Call notion.create_page to save summary (use input: notion_database_id as target)

   INPUTS AVAILABLE: manager_email (email), notion_database_id (text)

   ERROR HANDLING: Retry failed function calls once. If Gmail fails, report authentication or connectivity issue. If Notion fails, verify database_id validity and permissions."

   Example 2 (Pure AI):
   "You are executing a text analysis and report generation automation.

   OBJECTIVE: Analyze provided text content, identify key themes and sentiment, generate a structured report with insights and recommendations.

   WORKFLOW:
   1. Process input text: identify main themes and topics
   2. Analyze sentiment and tone across the content
   3. Extract key insights and actionable recommendations
   4. Format results as a structured markdown report

   INPUTS AVAILABLE: text_content (textarea), analysis_depth (select)

   ERROR HANDLING: If input text is too large, process in chunks. Report any parsing errors with specific location."

   Example 3 (Multi-step with AI + Plugins):
   "You are executing a document processing and notification automation.

   OBJECTIVE: Search Google Drive for specific documents, analyze their content for compliance issues, and send summary notifications via Slack.

   WORKFLOW:
   1. Call google-drive.search_files to find documents (use input: search_query, folder_id)
   2. For each document: analyze content for compliance keywords and issues
   3. Create summary report of findings with severity levels
   4. Call slack.send_message to notify channel (use input: slack_channel_id)

   INPUTS AVAILABLE: search_query (text), folder_id (text), slack_channel_id (text), compliance_keywords (textarea)

   ERROR HANDLING: Retry Drive API calls once on timeout. If Slack fails, log error and continue processing remaining documents."

ANALYZE THE WORKFLOW PLAN AND CREATE THE PERFECT AGENT SPECIFICATION.`

    console.log('Making SMART ANALYSIS AI call with consistent tracking IDs:', {
      agentId,
      sessionId
    })
    
    // Single comprehensive AI call
    const completion = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: smartAnalysisPrompt },
          { role: 'user', content: `Create agent specification for this workflow plan.` }
        ],
        temperature: 0.1,
        max_tokens: 3000
      },
      {
        userId: user.id,
        sessionId: sessionId,
        feature: 'agent_generation',
        component: 'smart-injection',
        workflow_step: 'complete_analysis',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: 'Smart agent specification generation',
        activity_step: 'hybrid_analysis',
        agent_id: agentId
      }
    )

    console.log('Smart analysis call completed with tracking')

    const rawResponse = completion.choices[0]?.message?.content || ''
    
    let result;
    try {
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : rawResponse;
      result = JSON.parse(jsonString);
    } catch (e) {
      try {
        const cleaned = rawResponse
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .replace(/^\s*[\r\n]/gm, '')
          .trim()
        result = JSON.parse(cleaned)
      } catch (e2) {
        return NextResponse.json({ 
          error: 'Failed to parse AI response',
          raw_response: rawResponse.slice(0, 500)
        }, { status: 500 })
      }
    }

    const agentSpec = result.agent_specification;
    const analysis = result.analysis;

    // Validate workflow steps - handle both plugin and AI-only steps
    const validatedSteps = agentSpec.workflow_steps?.map(step => {
      if (step.plugin === 'ai_processing' || !step.plugin || step.plugin === 'null') {
        // Pure AI processing step
        return {
          ...step,
          plugin: 'ai_processing',
          validated: true,
          type: 'ai_processing'
        };
      } else {
        // Plugin-based step  
        const plugin = pluginRegistry[step.plugin];
        const isValid = plugin && plugin.capabilities.includes(step.plugin_action);
        
        return {
          ...step,
          validated: isValid,
          type: 'plugin_action',
          available_capabilities: plugin ? plugin.capabilities : []
        };
      }
    }) || [];

    // Validate input schema
    const validatedInputs = agentSpec.input_schema?.map(input => ({
      ...input,
      name: input.name || 'unnamed_field',
      type: input.type || 'text',
      required: input.required !== false,
      description: input.description || `Please provide ${input.name}`,
      placeholder: input.placeholder || input.example || ''
    })) || [];

    const usedCapabilities = getUsedCapabilities(validatedSteps)

    // Generate output inference
    const { enhanceOutputInference } = await import('@/lib/outputInference')
    const outputInference = enhanceOutputInference(
      fullPrompt,
      clarificationAnswers || {},
      connectedPluginKeys,
      validatedSteps
    )

    const validDetectedPlugins = Object.keys(usedCapabilities)
      .filter(key => pluginRegistry[key]);

    console.log('Valid detected plugins:', validDetectedPlugins);
    console.log('Used capabilities:', usedCapabilities);
    console.log('Final input schema:', validatedInputs);
    console.log('Analysis result:', analysis);

    // Log system prompt source
    if (agentSpec.system_prompt) {
      console.log('✅ Using AI-generated system_prompt from agent specification');
      console.log('System prompt preview:', agentSpec.system_prompt.substring(0, 150) + '...');
    } else {
      console.log('⚠️ No AI-generated system_prompt found, using fallback');
    }

    // Maintain the exact JSON structure expected by the system
    const agentData = {
      user_id: user.id,
      agent_name: agentSpec.agent_name || 'Untitled Agent',
      user_prompt: fullPrompt,
      system_prompt: agentSpec.system_prompt || `You are an agent that accomplishes: ${analysis?.workflow_type || agentSpec.description || 'user workflow'}`,
      description: agentSpec.description || '',
      plugins_required: validDetectedPlugins,
      connected_plugins: validDetectedPlugins,
      input_schema: validatedInputs,
      output_schema: outputInference.outputs,
      status: 'draft',
      mode: agentSpec.schedule ? 'scheduled' : 'on_demand',
      schedule_cron: agentSpec.schedule || null,
      created_from_prompt: fullPrompt,
      ai_reasoning: outputInference.reasoning,
      ai_confidence: Math.round((outputInference.confidence || 0) * 100),
      ai_generated_at: new Date().toISOString(),
      workflow_steps: validatedSteps,
      trigger_conditions: agentSpec.error_notifications ? {
        error_handling: agentSpec.error_notifications
      } : null,
      detected_categories: validDetectedPlugins.map(plugin => ({ plugin, detected: true }))
    }

    console.log('Agent generation completed successfully with full tracking:', {
      agentName: agentData.agent_name,
      pluginsUsed: validDetectedPlugins,
      workflowStepsCount: validatedSteps.length,
      inputSchemaCount: validatedInputs.length,
      workflowType: analysis?.workflow_type,
      requiresPlugins: analysis?.requires_plugins,
      agentId: agentId,
      sessionId: sessionId
    })

    return NextResponse.json({ 
      agent: agentData,
      extraction_details: {
        usedCapabilities,
        output_inference: outputInference,
        workflow_steps: validatedSteps,
        analysis: analysis,
        workflow_type: analysis?.workflow_type,
        requires_plugins: analysis?.requires_plugins,
        activity_tracked: true,
        agentId: agentId,
        sessionId: sessionId
      }
    })

  } catch (error) {
    console.error('Error in agent generation:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}