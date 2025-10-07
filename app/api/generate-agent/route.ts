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

function generateDynamicOutputTemplateContext(connectedPluginData: any[]): string {
  return connectedPluginData.map(plugin => {
    if (!plugin.outputTemplates) return null
    return Object.entries(plugin.outputTemplates).map(([capability, template]: [string, any]) => {
      return `${plugin.key} with ${capability} action → produces ${template.type}: ${template.description}`
    }).join('\n')
  }).filter(Boolean).join('\n')
}

function generateDynamicIntentMappingRules(connectedPluginData: any[]): string {
  const mappingRules: string[] = []
  connectedPluginData.forEach(plugin => {
    plugin.capabilities.forEach((capability: string) => {
      const capWords = capability.replace(/_/g, ' ')
      mappingRules.push(`"${capWords}" operations → ${plugin.key} (${plugin.displayName || plugin.label}) with ${capability} action`)
    })
  })
  return [...new Set(mappingRules)].join('\n')
}

function inferActionFromStep(step: any, pluginDef: any): string {
  if (!pluginDef || !step.action) return 'unknown'
  const action = step.action.toLowerCase()
  const capabilities = pluginDef.capabilities || []
  for (const capability of capabilities) {
    const capWords = capability.replace(/_/g, ' ').toLowerCase()
    if (action.includes(capWords) || capWords.split(' ').some(word => action.includes(word))) {
      return capability
    }
  }
  return capabilities[0] || 'unknown'
}

function getUsedCapabilities(steps: any[]): Record<string, string[]> {
  const used: Record<string, string[]> = {}
  steps.forEach(step => {
    if (!used[step.plugin]) used[step.plugin] = []
    if (!used[step.plugin].includes(step.plugin_action)) {
      used[step.plugin].push(step.plugin_action)
    }
  })
  return used
}

function generateInputTemplateAnalysis(
  connectedPluginData: any[],
  usedCapabilities: Record<string, string[]>
): string {
  const analyses = []
  
  for (const plugin of connectedPluginData) {
    const capsUsed = usedCapabilities[plugin.key] || []
    
    for (const capability of capsUsed) {
      const templates = getInputTemplatesForCapability(plugin.key, capability)
      
      if (templates.length > 0) {
        analyses.push(`
${plugin.key.toUpperCase()} | ${capability.toUpperCase()}:
Available input templates:
${templates.map(template => {
  let analysis = `- ${template.name} (${template.type})`
  if (template.required) analysis += ' [REQUIRED]'
  if (template.runtime_populated) analysis += ' [AUTO-POPULATED]'
  analysis += `: ${template.description}`
  if (template.placeholder) analysis += ` (placeholder: "${template.placeholder}")`
  return analysis
}).join('\n')}`)
      }
    }
  }
  
  return analyses.join('\n')
}

function generatePromptSectionAnalysis(fullPrompt: string): string {
  return `Enhanced Prompt Sections:
${fullPrompt}

Extract what is explicitly specified in each section:
- Data Source section defines what data to process
- Trigger Conditions section defines when to run
- Processing Steps section defines how to process
- Output Creation section defines what to generate
- Delivery Method section defines where/how to deliver
- Error Handling section defines notification preferences`
}

export async function POST(req: Request) {
  try {
    // FIXED: Extract agent ID and session ID from request body
    const { 
      prompt, 
      clarificationAnswers,
      agentId: providedAgentId,    // FIXED: Extract agent ID from request body
      sessionId: providedSessionId // FIXED: Extract session ID from request body
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

    // FIXED: Use provided IDs with proper fallback and prioritization
    const sessionId = providedSessionId || 
                      clarificationAnswers?.sessionId || 
                      req.headers.get('x-session-id') || 
                      uuidv4()
    
    const agentId = providedAgentId || 
                    clarificationAnswers?.agentId || 
                    req.headers.get('x-agent-id') || 
                    uuidv4()

    console.log('🆔 AGENT GENERATION API - Using CONSISTENT IDs:', {
      providedAgentId,        // FIXED: Log provided agent ID
      providedSessionId,      // FIXED: Log provided session ID
      finalAgentId: agentId,
      finalSessionId: sessionId,
      agentIdSource: providedAgentId ? 'request_body' : 
                     clarificationAnswers?.agentId ? 'clarificationAnswers' : 
                     req.headers.get('x-agent-id') ? 'header' : 'generated',
      sessionIdSource: providedSessionId ? 'request_body' : 
                       clarificationAnswers?.sessionId ? 'clarificationAnswers' : 
                       req.headers.get('x-session-id') ? 'header' : 'generated',
      agentIdConsistent: true // FIXED: Track consistency
    })

    const { data: pluginRows } = await supabase
      .from('plugin_connections')
      .select('plugin_key')
      .eq('user_id', user.id)

    const connectedPluginKeys = pluginRows?.map(p => p.plugin_key) || []
    const connectedPluginData = getConnectedPluginsWithMetadata(connectedPluginKeys)
    const fullPrompt = prompt

    const pluginCapabilityContext = connectedPluginData.map(plugin =>
      `${plugin.key} (${plugin.displayName || plugin.label}): ${plugin.capabilities.join(', ')}`
    ).join('\n')

    const dynamicOutputTemplates = generateDynamicOutputTemplateContext(connectedPluginData)
    const dynamicIntentMappingRules = generateDynamicIntentMappingRules(connectedPluginData)

    // PHASE 1: Initial workflow analysis to determine used capabilities
    const initialSystemPrompt = `Analyze this workflow and determine which plugin capabilities will be used.

CONNECTED PLUGINS: ${pluginCapabilityContext}
CAPABILITY MAPPING: ${dynamicIntentMappingRules}

CRITICAL DOCUMENT GENERATION RULE:
When users request document creation (PDF, Word, CSV, etc.), this is handled by AI naturally within existing plugins, NOT as separate workflow steps.

EXAMPLES:
❌ WRONG - Don't create separate document generation steps:
{
  "operation": "Create PDF document",
  "plugin": "pdf-creator",
  "plugin_action": "generate_pdf"
}

✅ CORRECT - Include document format in the processing step:
{
  "operation": "Summarize emails and format as PDF document",
  "plugin": "chatgpt-research",
  "plugin_action": "summarize"
}

Map operations to correct capabilities:
- "read gmail" → google-mail with read_email
- "summarize and create PDF/Word/CSV" → chatgpt-research with summarize (AI handles format)
- "upload to drive" → google-drive with upload_files
- "send alert" → google-mail with send_email

Return JSON: {"workflow_steps": [{"operation": "description", "plugin": "plugin_key", "plugin_action": "capability"}]}`

    // Initialize AI Provider with analytics
    const openaiProvider = new OpenAIProvider(process.env.OPENAI_API_KEY!, aiAnalytics)

    console.log('📊 Making INITIAL AI call with consistent tracking IDs:', {
      agentId,
      sessionId
    })
    
    // PHASE 1: Track initial analysis call - FIXED: Use consistent agent ID
    const initialCompletion = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: initialSystemPrompt },
          { role: 'user', content: `Map this workflow to plugin capabilities:\n\n"${fullPrompt}"` }
        ],
        temperature: 0.1,
        max_tokens: 1000
      },
      {
        userId: user.id,
        sessionId: sessionId,           // FIXED: Use consistent session ID
        feature: 'agent_generation',
        component: 'agent-generator',
        workflow_step: 'initial_analysis',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: 'Analyzing workflow capabilities',
        activity_step: 'capability_mapping',
        agent_id: agentId               // FIXED: Use consistent agent ID
      }
    )

    console.log('✅ Initial analysis call completed with tracking')

    const initialRaw = initialCompletion.choices[0]?.message?.content || ''
    let preliminarySteps = []
    
    try {
      const initialData = JSON.parse(initialRaw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
      preliminarySteps = initialData.workflow_steps || []
    } catch (e) {
      console.log('Could not parse initial analysis, proceeding with empty steps')
    }

    const preliminaryCapabilities = getUsedCapabilities(preliminarySteps)
    
    // PHASE 2: Generate input template analysis and prompt section analysis
    const inputTemplateAnalysis = generateInputTemplateAnalysis(connectedPluginData, preliminaryCapabilities)
    const promptSectionAnalysis = generatePromptSectionAnalysis(fullPrompt)
    
    // PHASE 3: Strict gap analysis with proper JSON structure
    const enhancedSystemPrompt = `You are an AI agent-generation assistant. Your job is to turn a structured user workflow into an executable AI agent specification.

CRITICAL: You must perform STRICT GAP ANALYSIS between what's specified in the prompt vs what's needed.

CRITICAL DOCUMENT GENERATION RULE:
When users request document creation (PDF, Word, CSV, etc.), this is handled by AI naturally within existing plugins, NOT as separate workflow steps.

WORKFLOW MAPPING RULES:
- "read emails" → google-mail with read_email
- "summarize and create PDF/Word/CSV" → chatgpt-research with summarize (AI handles document format)
- "upload file to drive" → google-drive with upload_files  
- "send email with attachment" → google-mail with send_email

EXAMPLES:
When prompt says "Create a PDF containing email summaries":
✅ CORRECT workflow:
{
  "operation": "Summarize emails and format as PDF document",
  "plugin": "chatgpt-research",
  "plugin_action": "summarize"
}

❌ WRONG - Don't create separate PDF generation steps:
{
  "operation": "Generate PDF",
  "plugin": "pdf-creator",
  "plugin_action": "create_pdf"
}

---
📋 ENHANCED PROMPT ANALYSIS:
${promptSectionAnalysis}

---
🔍 AVAILABLE INPUT TEMPLATES:
${inputTemplateAnalysis}

---
🧠 STRICT GAP ANALYSIS RULES:

STEP 1: For each plugin capability being used, check what input fields are available.
STEP 2: For each available input field, ask: "Is this value EXPLICITLY specified in the enhanced prompt sections above?"
STEP 3: If YES → SKIP the field completely (don't create input for it)
STEP 4: If NO and field is essential for execution → CREATE input field with proper structure

EXPLICIT SPECIFICATIONS IN THIS PROMPT:
- Data Source section specifies: specific data to read → SKIP any query/filter fields
- Trigger section specifies: timing → SKIP any time/schedule fields  
- Processing section specifies: how to process → SKIP any processing style fields
- Output Creation section specifies: document format → AI handles this naturally
- The prompt mentions "send to manager" but NO specific email → CREATE manager email field

MAXIMUM TARGET: 2-3 input fields for non-technical users.

---
🧾 REQUIRED JSON STRUCTURE:

Each input field MUST have this exact structure:
{
  "name": "field_name",
  "type": "string|email|select|number",
  "required": true|false,
  "description": "User-friendly description",
  "placeholder": "Example value"
}

COMPLETE JSON RESPONSE:
{
  "agent_name": "Daily Email Summary to Manager",
  "user_prompt": "Reads emails daily, creates summary document, and sends to manager",
  "system_prompt": "You are an email processing agent that reads Gmail, summarizes content, creates documents, and sends them via email.",
  "description": "Automates daily email processing and reporting",
  "schedule": "0 8 * * *",
  "input_schema": [
    {
      "name": "manager_email",
      "type": "email",
      "required": true,
      "description": "Email address of the manager to send the summary",
      "placeholder": "manager@example.com"
    }
  ],
  "workflow_steps": [
    {
      "operation": "Read last 10 emails from Gmail",
      "plugin": "google-mail",
      "plugin_action": "read_email"
    },
    {
      "operation": "Summarize emails and format as PDF document",
      "plugin": "chatgpt-research",
      "plugin_action": "summarize"
    },
    {
      "operation": "Send PDF summary to manager",
      "plugin": "google-mail",
      "plugin_action": "send_email"
    }
  ],
  "error_notifications": {
    "on_failure": "email",
    "retry_on_fail": true
  },
  "output_format": "pdf"
}

---
🚨 CRITICAL REQUIREMENTS:
1. Use ONLY the input field structure shown above
2. Perform strict gap analysis - only create fields for MISSING values
3. Target maximum 2-3 input fields total
4. Never create fields for values already specified in prompt sections
5. Document generation happens within existing plugins (chatgpt-research)
6. Return valid JSON only, no markdown or explanations

Analyze the enhanced prompt and create agent specification with minimal essential inputs only.`

    console.log('📊 Making FINAL AI call with consistent tracking IDs:', {
      agentId,
      sessionId
    })

    // PHASE 3: Track final generation call - FIXED: Use consistent agent ID
    const completion = await openaiProvider.chatCompletion(
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: enhancedSystemPrompt },
          { role: 'user', content: fullPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000
      },
      {
        userId: user.id,
        sessionId: sessionId,           // FIXED: Use consistent session ID
        feature: 'agent_generation',
        component: 'agent-generator',
        workflow_step: 'agent_specification',
        category: 'agent_creation',
        activity_type: 'agent_creation',
        activity_name: `Creating agent specification`,
        activity_step: 'specification_generation',
        agent_id: agentId               // FIXED: Use consistent agent ID
      }
    )

    console.log('✅ Final generation call completed with tracking')

    const raw = completion.choices[0]?.message?.content || ''
    const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/)
    const jsonString = jsonMatch ? jsonMatch[1] : raw.trim()

    let extracted
    try {
      extracted = JSON.parse(jsonString)
    } catch (e) {
      try {
        const cleaned = raw
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .replace(/^\s*[\r\n]/gm, '')
          .trim()
        extracted = JSON.parse(cleaned)
      } catch (e2) {
        return NextResponse.json({ 
          error: 'Failed to parse AI response',
          raw_response: raw.slice(0, 500)
        }, { status: 500 })
      }
    }

    const enhancedWorkflowSteps = extracted.workflow_steps?.map((step: any) => {
      const pluginDef = getPluginDefinition(step.plugin)
      const pluginAction = step.plugin_action || inferActionFromStep(step, pluginDef)
      return {
        ...step,
        plugin_action: pluginAction,
        validated: pluginDef && pluginDef.capabilities.includes(pluginAction)
      }
    }) || []

    const usedCapabilities = getUsedCapabilities(enhancedWorkflowSteps)

    const { enhanceOutputInference } = await import('@/lib/outputInference')
    const outputInference = enhanceOutputInference(
      fullPrompt,
      clarificationAnswers || {},
      connectedPluginKeys,
      enhancedWorkflowSteps
    )

    const validDetectedPlugins = Object.keys(usedCapabilities)
      .filter(key => pluginRegistry[key]);

    console.log('🔍 Valid detected plugins:', validDetectedPlugins);
    console.log('🔍 Used capabilities:', usedCapabilities);
    console.log('🔍 Final input schema:', extracted.input_schema);

    const agentData = {
      user_id: user.id,
      agent_name: extracted.agent_name || 'Untitled Agent',
      user_prompt: fullPrompt,
      system_prompt: extracted.system_prompt || 'You are a helpful assistant.',
      description: extracted.description || '',
      plugins_required: validDetectedPlugins,
      connected_plugins: validDetectedPlugins,
      input_schema: extracted.input_schema || [],
      output_schema: outputInference.outputs,
      status: 'draft',
      mode: extracted.schedule ? 'scheduled' : 'on_demand',
      schedule_cron: extracted.schedule || null,
      created_from_prompt: extracted.user_prompt,
      ai_reasoning: outputInference.reasoning,
      ai_confidence: Math.round((outputInference.confidence || 0) * 100),
      ai_generated_at: new Date().toISOString(),
      workflow_steps: enhancedWorkflowSteps,
      trigger_conditions: extracted.error_notifications ? {
        error_handling: extracted.error_notifications
      } : null,
      detected_categories: validDetectedPlugins.map(plugin => ({ plugin, detected: true }))
    }

    console.log('✅ Agent generation completed successfully with full tracking:', {
      agentName: agentData.agent_name,
      pluginsUsed: validDetectedPlugins,
      workflowStepsCount: enhancedWorkflowSteps.length,
      inputSchemaCount: extracted.input_schema?.length || 0,
      agentId: agentId,                // FIXED: Log consistent agent ID
      sessionId: sessionId             // FIXED: Log consistent session ID
    })

    // FIXED: Return consistent agent ID and session ID in response
    return NextResponse.json({ 
      agent: agentData,
      extraction_details: {
        usedCapabilities,
        output_inference: outputInference,
        workflow_steps: enhancedWorkflowSteps,
        input_template_analysis: inputTemplateAnalysis,
        activity_tracked: true,
        agentId: agentId,              // FIXED: Return consistent agent ID
        sessionId: sessionId           // FIXED: Return consistent session ID
      }
    })

  } catch (error) {
    console.error('❌ Error in agent generation:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}