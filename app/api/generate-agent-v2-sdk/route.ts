// app/api/generate-agent-v2-sdk/route.ts
// OPTION 2: AgentKit SDK native planning approach

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { v4 as uuidv4 } from 'uuid'
import { analyzePromptWithAgentKitSDK } from '@/lib/agentkit/analyzePrompt-v2-sdk'
import { enhanceOutputInference } from '@/lib/outputInference'

export const runtime = 'nodejs'

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

    console.log('🤖 AGENT GENERATION V2-SDK (AgentKit Native Planning) - Using IDs:', {
      agentId,
      sessionId
    })

    // Get user's connected plugins
    const { data: pluginRows } = await supabase
      .from('plugin_connections')
      .select('plugin_key')
      .eq('user_id', user.id)

    const connectedPluginKeys = pluginRows?.map(p => p.plugin_key) || []

    // Add platform plugins (like chatgpt-research) that don't need connection
    const platformPlugins = ['chatgpt-research'];
    const allAvailablePlugins = [...new Set([...connectedPluginKeys, ...platformPlugins])];

    console.log('📦 Available plugins for SDK planning:', allAvailablePlugins)

    // ========================================
    // 🧠 AGENTKIT SDK NATIVE PLANNING
    // ========================================
    // Use AgentKit's execution engine intelligence for planning
    // This leverages OpenAI's function calling directly with our plugin constraints

    const analysis = await analyzePromptWithAgentKitSDK(
      user.id,
      prompt,
      allAvailablePlugins
    )

    console.log('✅ AgentKit SDK Planning Complete:', {
      agent_name: analysis.agent_name,
      workflow_type: analysis.workflow_type,
      suggested_plugins: analysis.suggested_plugins,
      confidence: analysis.confidence
    })

    // Generate enhanced outputs based on AgentKit's analysis
    const outputInference = enhanceOutputInference(
      prompt,
      clarificationAnswers || {},
      analysis.suggested_plugins,
      analysis.workflow_steps
    )

    // Build agent data from AgentKit SDK's planning
    const agentData = {
      user_id: user.id,
      agent_name: analysis.agent_name,
      user_prompt: prompt,
      system_prompt: analysis.system_prompt,
      description: analysis.description,
      plugins_required: analysis.suggested_plugins,
      connected_plugins: analysis.suggested_plugins,
      input_schema: analysis.required_inputs.map(input => ({
        name: input.name,
        type: input.type,
        required: input.required,
        description: input.description,
        placeholder: input.placeholder || ''
      })),
      output_schema: outputInference.outputs,
      status: 'draft',
      mode: 'on_demand',
      schedule_cron: null,
      created_from_prompt: prompt,
      ai_reasoning: `AgentKit SDK Native Planning (v2-sdk): ${analysis.reasoning}. Confidence: ${Math.round(analysis.confidence * 100)}%`,
      ai_confidence: Math.round(analysis.confidence * 100),
      ai_generated_at: new Date().toISOString(),
      workflow_steps: analysis.workflow_steps.map(step => ({
        operation: step.operation,
        plugin: step.plugin,
        plugin_action: step.plugin_action,
        validated: true,
        type: step.plugin === 'ai_processing' ? 'ai_processing' : 'plugin_action'
      })),
      trigger_conditions: {
        error_handling: {
          on_failure: 'email',
          retry_on_fail: true
        }
      },
      detected_categories: analysis.suggested_plugins.map(plugin => ({
        plugin,
        detected: true
      })),
      agent_config: {
        mode: 'on_demand',
        metadata: {
          version: '2.0-sdk',
          generation_method: 'agentkit_sdk_planning',
          agent_id: agentId,
          session_id: sessionId,
          prompt_type: 'agentkit_v2_sdk',
          ai_generated_at: new Date().toISOString(),
          platform_version: 'v2.0-sdk',
          analysis_confidence: analysis.confidence,
          workflow_type: analysis.workflow_type
        },
        timezone: 'America/New_York',
        agent_name: analysis.agent_name,
        description: analysis.description,
        user_prompt: prompt,
        input_schema: analysis.required_inputs,
        output_schema: outputInference.outputs,
        workflow_steps: analysis.workflow_steps,
        plugins_required: analysis.suggested_plugins,
        connected_plugins: analysis.suggested_plugins,
        system_prompt: analysis.system_prompt,
        ai_context: {
          reasoning: analysis.reasoning,
          confidence: Math.round(analysis.confidence * 100),
          workflow_type: analysis.workflow_type,
          generation_method: 'agentkit_sdk_planning_v2'
        }
      }
    }

    console.log('✅ AgentKit SDK-generated agent completed (not saved yet - user will confirm):', {
      agent_name: agentData.agent_name,
      plugins_count: agentData.plugins_required.length,
      plugins: agentData.plugins_required,
      inputs_count: agentData.input_schema.length,
      steps_count: agentData.workflow_steps.length
    })

    // DON'T save to database yet - return agent data for user review
    // User will save it through the wizard when they click "Save Agent"
    return NextResponse.json({
      success: true,
      agent: agentData,
      agentId: agentId,
      sessionId: sessionId,
      extraction_details: {
        analysis: {
          method: 'agentkit_sdk_planning_v2',
          confidence: analysis.confidence,
          workflow_type: analysis.workflow_type,
          reasoning: analysis.reasoning,
          suggested_plugins: analysis.suggested_plugins
        },
        workflow_steps: analysis.workflow_steps,
        activity_tracked: true,
        agentId: agentId,
        sessionId: sessionId
      }
    })

  } catch (error: any) {
    console.error('❌ AgentKit SDK Agent Generation Error:', error)
    return NextResponse.json({
      error: 'Agent generation failed',
      message: error.message
    }, { status: 500 })
  }
}
