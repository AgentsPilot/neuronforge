import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { 
  pluginRegistry,
  getPluginDefinition,
  getConnectedPluginsWithMetadata,
  getInputTemplatesForCapability
  } from '@/lib/plugins/pluginRegistry'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

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
    const { prompt, clarificationAnswers } = await req.json()
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

    const initialCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: initialSystemPrompt },
        { role: 'user', content: `Map this workflow to plugin capabilities:\n\n"${fullPrompt}"` }
      ],
      temperature: 0.1,
      max_tokens: 1000
    })

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

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        { role: 'user', content: fullPrompt }
      ],
      temperature: 0.1,
      max_tokens: 2000
    })

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

    // ADD ACTIVITY TRACKING for agent generation
    try {
      await supabase.from('token_usage').insert({
        user_id: user.id,
        model_name: 'gpt-4o',
        provider: 'openai',
        input_tokens: completion.usage?.prompt_tokens || 0,
        output_tokens: completion.usage?.completion_tokens || 0,
        cost_usd: 0.0, // Calculate based on your pricing
        request_type: 'chat',
        category: 'agent_generation',
        feature: 'agent_creation',
        component: 'agent-generator',
        workflow_step: 'final_generation',
        // ADD ACTIVITY TRACKING FIELDS
        activity_type: 'agent_creation',
        activity_name: `Creating agent: ${agentData.agent_name}`,
        activity_step: 'agent_generation',
        agent_id: clarificationAnswers?.session_id || `agent_${Date.now()}`,
        session_id: clarificationAnswers?.session_id,
        metadata: {
          agent_name: agentData.agent_name,
          plugins_used: validDetectedPlugins,
          workflow_steps_count: enhancedWorkflowSteps.length,
          input_schema_count: extracted.input_schema?.length || 0,
          has_schedule: !!extracted.schedule,
          output_inference: outputInference
        }
      })
      console.log('✅ Activity tracking completed for agent generation')
    } catch (trackingError) {
      console.warn('⚠️ Token tracking failed:', trackingError)
      // Don't fail the request if tracking fails
    }

    return NextResponse.json({ 
      agent: agentData,
      extraction_details: {
        usedCapabilities,
        output_inference: outputInference,
        workflow_steps: enhancedWorkflowSteps,
        input_template_analysis: inputTemplateAnalysis,
        activity_tracked: true
      }
    })

  } catch (error) {
    console.error('❌ Error in agent generation:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}