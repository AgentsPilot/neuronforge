import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import OpenAI from 'openai'
import { 
  pluginRegistry,
  getPluginDefinition,
  getConnectedPluginsWithMetadata,
  LEGACY_KEY_MAP
} from '@/lib/plugins/pluginRegistry'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

function generateDynamicInputTemplateContext(
  connectedPluginData: any[],
  usedCapabilities: Record<string, string[]>
): string {
  return connectedPluginData.map(plugin => {
    const capsUsed = usedCapabilities[plugin.key] || []
    if (!plugin.inputTemplates || capsUsed.length === 0) return null

    return capsUsed
      .filter(cap => plugin.inputTemplates[cap])
      .map(capability => {
        return plugin.inputTemplates[capability].map(template => {
          let fieldInfo = `${plugin.key} with ${capability} action → ${template.name} (type: ${template.type}`
          if (template.required) fieldInfo += ', required'
          if (template.enum) fieldInfo += `, options: [${template.enum.join(', ')}]`
          if (template.runtime_populated) fieldInfo += ', runtime_populated via ' + template.sandboxFetch
          if (template.placeholder) fieldInfo += `, placeholder: "${template.placeholder}"`
          fieldInfo += `): ${template.description}`
          return fieldInfo
        }).join('\n')
      }).join('\n')
  }).filter(Boolean).join('\n')
}

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

    const enhancedSystemPrompt = `You are an AI assistant that creates executable agent specifications by analyzing structured user workflows.

You MUST respond with valid JSON only. No markdown, no explanations, just pure JSON.

CONNECTED PLUGINS AND CAPABILITIES:
${pluginCapabilityContext}

DYNAMIC OUTPUT TEMPLATES (auto-generated from plugin registry):
${dynamicOutputTemplates}

CAPABILITY TO OPERATION MAPPING:
${dynamicIntentMappingRules}

ENHANCED PROMPT STRUCTURE ANALYSIS:
The user provides a structured workflow with sections like:
- **Data Source:** What data to process → extract specific criteria/values
- **Trigger Conditions:** When to run → extract scheduling information  
- **Processing Steps:** What operations to perform → map to plugin capabilities above
- **Output Creation:** What to generate → determine output types from templates above
- **Delivery Method:** How to deliver results → map to delivery/storage capabilities
- **Error Handling:** How to handle failures → configure error notifications

ANALYSIS INSTRUCTIONS:
1. Parse the structured sections in the enhanced prompt
2. Extract specific values mentioned (keywords, folders, email addresses, etc.)  
3. Match processing operations to plugin capabilities using the mapping above
4. Use input templates to generate required input fields
5. Use output templates to determine expected outputs
6. Create workflow steps with correct plugin and plugin_action assignments

INPUT SCHEMA GENERATION:
- Extract user-configurable values from the enhanced prompt sections
- Use plugin input templates to determine required fields (provided below AFTER workflow steps)
- Set extracted values as placeholders/defaults
- Focus only on parameters the executing agent will need

OUTPUT SCHEMA GENERATION:
- Use plugin output templates for the capabilities being used
- Generate outputs that match what the workflow will actually produce
- Include execution status and summary outputs

Required JSON structure:
{
  "agent_name": "string - descriptive name reflecting workflow purpose",
  "user_prompt": "string - clean summary of what the agent does", 
  "system_prompt": "string - detailed execution instructions for the agent executor",
  "description": "string - user-friendly description of value provided",
  "schedule": "string - cron expression if timing specified",
  "input_schema": [...],
  "workflow_steps": [...],
  "error_notifications": { ... },
  "output_format": "string"
}

CRITICAL: Use only the connected plugins, capabilities, and templates provided above. Match enhanced prompt sections to plugin capabilities using the registry metadata.`

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: enhancedSystemPrompt },
        { role: 'user', content: `Analyze this structured workflow and create an executable agent specification:

"${fullPrompt}"

ANALYSIS REQUIREMENTS:
1. Parse each section of the structured prompt (Data Source, Processing Steps, etc.)
2. Extract specific values mentioned by the user (keywords, folders, email addresses, etc.)
3. Use plugin input templates to create required input fields
4. Use plugin output templates to generate expected outputs
5. Map processing steps to precise plugin capabilities from the registry
6. Design for successful execution by an agent executor

Return only valid JSON with no additional text or formatting.` }
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
    const dynamicInputTemplates = generateDynamicInputTemplateContext(connectedPluginData, usedCapabilities)

    const { enhanceOutputInference } = await import('@/lib/outputInference')
    const outputInference = enhanceOutputInference(
      fullPrompt,
      clarificationAnswers || {},
      connectedPluginKeys,
      enhancedWorkflowSteps
    )

const validDetectedPlugins = Object.keys(usedCapabilities)
  .filter(key => pluginRegistry[key]);

console.log('🔍 Valid detected plugins AFTER:', validDetectedPlugins);

    console.log('🔍 Used capabilities:', usedCapabilities);
    console.log('🔍 Plugin registry keys:', Object.keys(pluginRegistry));
    console.log('🔍 Valid detected plugins:', validDetectedPlugins);

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

    return NextResponse.json({ 
      agent: agentData,
      extraction_details: {
        usedCapabilities,
        output_inference: outputInference,
        workflow_steps: enhancedWorkflowSteps
      }
    })

  } catch (error) {
    console.error('❌ Error in agent generation:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}