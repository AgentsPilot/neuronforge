// app/api/generate-agent-v2/route.ts
// NEW: AgentKit-powered intelligent agent generation
// This replaces blind GPT guessing with AgentKit's execution intelligence

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'
import { analyzePromptDirectAgentKit } from '@/lib/agentkit/analyzePrompt-v3-direct'
import { enhanceOutputInference } from '@/lib/outputInference'
import { AuditTrailService } from '@/lib/services/AuditTrailService'
import { AUDIT_EVENTS } from '@/lib/audit/events'
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

export const runtime = 'nodejs'

// Initialize Supabase service client for analytics
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Initialize services
const auditTrail = AuditTrailService.getInstance()
const aiAnalytics = new AIAnalyticsService(supabaseServiceRole, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true
})

/**
 * Validate and fix workflow step parameters against plugin schemas
 * This catches AI mistakes where it uses wrong parameter names (e.g., "query" instead of "topic")
 */
async function validateAndFixWorkflowSteps(
  workflowSteps: any[]
): Promise<{ steps: any[]; fixes: string[] }> {
  const pluginManager = await PluginManagerV2.getInstance()
  const allPlugins = pluginManager.getAvailablePlugins()
  const fixes: string[] = []

  const validatedSteps = workflowSteps.map((step, index) => {
    // Only validate plugin_action steps (not ai_processing, conditional, etc.)
    if (step.type !== 'plugin_action' || !step.plugin || !step.plugin_action) {
      return step
    }

    const pluginDef = allPlugins[step.plugin]
    if (!pluginDef) {
      console.warn(`⚠️ [Validation] Plugin "${step.plugin}" not found in definitions`)
      return step
    }

    const actionDef = pluginDef.actions[step.plugin_action]
    if (!actionDef) {
      console.warn(`⚠️ [Validation] Action "${step.plugin_action}" not found in plugin "${step.plugin}"`)
      return step
    }

    const requiredParams = actionDef.parameters?.required || []
    const stepParams = step.params || {}

    // Check for missing required parameters
    for (const requiredParam of requiredParams) {
      if (stepParams[requiredParam] === undefined) {
        // Try to find a similar parameter that might be misnamed
        const similarParam = findSimilarParam(stepParams, requiredParam)

        if (similarParam) {
          // Auto-fix: rename the misnamed parameter
          stepParams[requiredParam] = stepParams[similarParam]
          delete stepParams[similarParam]
          const fixMsg = `Step ${index + 1} (${step.plugin}.${step.plugin_action}): Fixed param "${similarParam}" → "${requiredParam}"`
          fixes.push(fixMsg)
          console.log(`🔧 [Validation] ${fixMsg}`)
        } else {
          console.warn(`⚠️ [Validation] Step ${index + 1}: Missing required param "${requiredParam}" for ${step.plugin}.${step.plugin_action}`)
        }
      }
    }

    return { ...step, params: stepParams }
  })

  if (fixes.length > 0) {
    console.log(`✅ [Validation] Applied ${fixes.length} parameter fixes`)
  } else {
    console.log(`✅ [Validation] All workflow steps have correct parameter names`)
  }

  return { steps: validatedSteps, fixes }
}

/**
 * Find a similar parameter name that might be a common AI mistake
 */
function findSimilarParam(
  params: Record<string, any>,
  targetParam: string
): string | null {
  // Common AI mistakes mapping: what AI might use → what it should be
  const commonMistakes: Record<string, string[]> = {
    'topic': ['query', 'search_term', 'search_query', 'subject', 'question', 'research_topic'],
    'query': ['search', 'search_term', 'q', 'search_query'],
    'recipient_email': ['to', 'email', 'to_email', 'recipient', 'email_to'],
    'subject': ['title', 'email_subject', 'header'],
    'message': ['body', 'content', 'text', 'email_body', 'email_content'],
    'spreadsheet_id': ['sheet_id', 'spreadsheetId', 'google_sheet_id', 'sheet'],
    'values': ['data', 'rows', 'content', 'row_data'],
    'content': ['text', 'body', 'data', 'input'],
  }

  // Check if any param in the step matches a common mistake for the target
  const possibleMistakes = commonMistakes[targetParam] || []
  for (const mistake of possibleMistakes) {
    if (params[mistake] !== undefined) {
      return mistake
    }
  }

  // Fuzzy match: check for partial matches or case differences
  const paramKeys = Object.keys(params)
  for (const key of paramKeys) {
    if (key.toLowerCase() === targetParam.toLowerCase() && key !== targetParam) {
      return key
    }
    if (key.toLowerCase().includes(targetParam.toLowerCase()) ||
        targetParam.toLowerCase().includes(key.toLowerCase())) {
      return key
    }
  }

  return null
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

    console.log('🤖 AGENT GENERATION V2 (AgentKit-Powered) - Using IDs:', {
      agentId,
      sessionId
    })

    const startTime = Date.now()

    // Log generation start to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENT_GENERATION_STARTED,
      entityType: 'agent',
      entityId: agentId,
      userId: user.id,
      resourceName: 'Agent Generation V2',
      details: {
        sessionId: sessionId,
        generation_method: 'agentkit_direct_v3',
        prompt_length: prompt?.length || 0,
        has_clarifications: !!(clarificationAnswers && Object.keys(clarificationAnswers).length > 0)
      },
      severity: 'info'
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

    console.log('📦 Available plugins for analysis:', allAvailablePlugins)

    // ========================================
    // 🧠 AGENTKIT INTELLIGENT ANALYSIS
    // ========================================
    // Instead of letting GPT-4o blindly guess plugins,
    // we use AgentKit's execution intelligence to analyze what's ACTUALLY needed

    const analysisStartTime = Date.now()
    const analysis = await analyzePromptDirectAgentKit(
      user.id,
      prompt,
      allAvailablePlugins
    )
    const analysisEndTime = Date.now()

    console.log('✅ AgentKit Analysis Complete:', {
      agent_name: analysis.agent_name,
      workflow_type: analysis.workflow_type,
      suggested_plugins: analysis.suggested_plugins,
      confidence: analysis.confidence
    })

    // ========================================
    // 🔧 VALIDATE & FIX WORKFLOW STEP PARAMS
    // ========================================
    // Catch AI mistakes where it uses wrong parameter names (e.g., "query" instead of "topic")
    const { steps: validatedWorkflowSteps, fixes: paramFixes } = await validateAndFixWorkflowSteps(
      analysis.workflow_steps
    )

    // Update analysis with validated steps
    analysis.workflow_steps = validatedWorkflowSteps

    if (paramFixes.length > 0) {
      console.log('🔧 Applied parameter fixes:', paramFixes)
    }

    // Track AI analytics for the analysis call
    if (analysis.tokensUsed) {
      await aiAnalytics.trackAICall({
        call_id: `agent_gen_v2_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        user_id: user.id,
        session_id: sessionId,
        provider: 'openai',
        model_name: 'gpt-4o',
        endpoint: 'chat/completions',
        feature: 'agent_generation',
        component: 'generate-agent-v2',
        workflow_step: 'agentkit_analysis',
        category: 'agent_creation',
        input_tokens: analysis.tokensUsed.prompt,
        output_tokens: analysis.tokensUsed.completion,
        cost_usd: (analysis.tokensUsed.prompt * 0.0025 / 1000) +
                  (analysis.tokensUsed.completion * 0.01 / 1000),
        latency_ms: analysisEndTime - analysisStartTime,
        response_size_bytes: JSON.stringify(analysis).length,
        success: true,
        request_type: 'chat',
        activity_type: 'agent_generation',
        activity_name: `Generate Agent: ${analysis.agent_name}`,
        agent_id: agentId,
        activity_step: 'analysis'
      })
    }

    // Generate enhanced outputs based on AgentKit's analysis
    const outputInference = enhanceOutputInference(
      prompt,
      clarificationAnswers || {},
      analysis.suggested_plugins,
      analysis.workflow_steps,
      analysis.suggested_outputs || [],  // NEW: Pass SDK outputs
      user.email  // NEW: Pass user email for notifications
    )

    // ========================================
    // 🚀 PILOT DUAL-FORMAT GENERATION
    // ========================================
    // Generate workflow_steps (ALWAYS - for UI animation)
    const workflow_steps = analysis.workflow_steps.map(step => ({
      operation: step.operation,
      plugin: step.plugin,
      plugin_action: step.plugin_action,
      params: step.params || {}, // IMPORTANT: Preserve params from AI analysis
      validated: true,
      type: step.plugin === 'ai_processing' ? 'ai_processing' : 'plugin_action'
    }))

    // Check if Pilot is enabled
    const { SystemConfigService } = await import('@/lib/services/SystemConfigService')
    const pilotEnabled = await SystemConfigService.getBoolean(
      supabaseServiceRole,
      'pilot_enabled',
      false
    )

    console.log(`🔧 Pilot system status: ${pilotEnabled ? 'enabled' : 'disabled'}`)

    // Generate pilot_steps (ALWAYS - default format for all agents)
    // pilot_steps is the normalized Pilot format, preferred for execution
    // workflow_steps is kept for backward compatibility with old agents
    const pilot_steps = generatePilotSteps(analysis.workflow_steps, workflow_steps)
    console.log(`🚀 Generated ${pilot_steps.length} pilot_steps (normalized Pilot format)`)

    // Helper function to convert legacy format to Pilot format
    function generatePilotSteps(analysisSteps: any[], legacySteps: any[]): any[] {
      return analysisSteps.map((step, idx) => {
        const base = {
          id: `step${idx + 1}`,
          name: step.operation || `Step ${idx + 1}`,
          dependencies: idx > 0 ? [`step${idx}`] : [],
        }

        // Convert ai_processing to Pilot ai_processing - CHECK THIS FIRST!
        // Must check before generic plugin_action because ai_processing also has plugin + plugin_action fields
        if (step.plugin === 'ai_processing' || step.type === 'ai_processing' || legacySteps[idx]?.type === 'ai_processing') {
          // Use prompt from params if available, otherwise use operation
          const prompt = step.params?.prompt || step.operation
          return {
            ...base,
            type: 'ai_processing',
            prompt: prompt,
            params: step.params || {},
          }
        }

        // Convert legacy plugin_action to Pilot action
        if (step.plugin && step.plugin_action) {
          return {
            ...base,
            type: 'action',
            plugin: step.plugin,
            action: step.plugin_action,
            params: step.params || {},
          }
        }

        // Fallback: generic action
        return {
          ...base,
          type: 'action',
          plugin: step.plugin || 'unknown',
          action: step.plugin_action || 'process',
          params: step.params || {},
        }
      })
    }

    // Build agent data from AgentKit's intelligent analysis
    const agentData = {
      user_id: user.id,
      agent_name: analysis.agent_name,
      user_prompt: prompt,
      system_prompt: analysis.system_prompt,  // Use AI-generated execution-optimized system prompt
      description: analysis.description,
      plugins_required: analysis.suggested_plugins,
      connected_plugins: analysis.suggested_plugins,
      input_schema: analysis.required_inputs.map(input => ({
        name: input.name,
        type: input.type,
        label: input.label,
        required: input.required,
        description: input.description,
        placeholder: input.placeholder || ''
      })),
      output_schema: outputInference.outputs,
      status: 'draft',
      mode: 'on_demand', // Can be enhanced based on prompt analysis
      schedule_cron: null,
      created_from_prompt: prompt,
      ai_reasoning: `${analysis.reasoning}. Confidence: ${Math.round(analysis.confidence * 100)}%`,
      ai_confidence: Math.round(analysis.confidence * 100),
      ai_generated_at: new Date().toISOString(),
      workflow_steps: workflow_steps,  // Use pre-generated workflow_steps
      pilot_steps: pilot_steps,         // NEW: Pilot execution steps (NULL if not needed)
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
          version: '3.0',
          generation_method: 'agentkit_direct',
          agent_id: agentId,
          session_id: sessionId,
          prompt_type: 'agentkit_v3',
          ai_generated_at: new Date().toISOString(),
          platform_version: 'v2.0',
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
        pilot_steps: pilot_steps,  // NEW: Include pilot_steps in agent_config
        plugins_required: analysis.suggested_plugins,
        connected_plugins: analysis.suggested_plugins,
        system_prompt: analysis.system_prompt,  // Use AI-generated execution-optimized system prompt
        ai_context: {
          reasoning: analysis.reasoning,
          confidence: Math.round(analysis.confidence * 100),
          workflow_type: analysis.workflow_type,
          generation_method: 'agentkit_direct_v3',
          pilot_enabled: pilotEnabled,  // NEW: Track if Pilot was enabled during generation
          pilot_steps_generated: !!pilot_steps  // NEW: Track if pilot_steps were generated
        }
      }
    }

    console.log('✅ AgentKit agent generation completed (not saved yet - user will confirm):', {
      agent_name: agentData.agent_name,
      plugins_count: agentData.plugins_required.length,
      plugins: agentData.plugins_required,
      inputs_count: agentData.input_schema.length,
      steps_count: agentData.workflow_steps.length,
      pilot_steps_count: pilot_steps?.length || 0,  // NEW: Log pilot_steps count
      pilot_enabled: pilotEnabled
    })

    // Log successful generation to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENT_CREATED,
      entityType: 'agent',
      entityId: agentId,
      userId: user.id,
      resourceName: agentData.agent_name,
      details: {
        sessionId: sessionId,
        generation_method: 'agentkit_direct_v3',
        plugins_detected: agentData.plugins_required,
        inputs_detected: agentData.input_schema.length,
        workflow_steps: agentData.workflow_steps.length,
        confidence: Math.round(analysis.confidence * 100),
        execution_time_ms: Date.now() - startTime,
        tokens_used: analysis.tokensUsed?.total || 0,
        status: 'generated_not_saved'
      },
      severity: 'info'
    })

    // NOTE: Creation cost tracking moved to /api/create-agent
    // (Must happen AFTER agent is saved to database)

    // DON'T save to database yet - return agent data for user review
    // User will save it through the wizard when they click "Save Agent"
    return NextResponse.json({
      success: true,
      agent: agentData,
      agentId: agentId,
      sessionId: sessionId,
      extraction_details: {
        analysis: {
          method: 'agentkit_direct_v3',
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
    console.error('❌ AgentKit Agent Generation V2 Error:', error)

    // Log error to audit trail
    await auditTrail.log({
      action: 'AGENT_GENERATION_FAILED',
      entityType: 'agent',
      entityId: agentId,
      userId: user?.id || 'unknown',
      resourceName: 'Agent Generation V2',
      details: {
        sessionId: sessionId,
        generation_method: 'agentkit_direct_v3',
        error_message: error.message,
        error_stack: error.stack?.substring(0, 500),
        execution_time_ms: Date.now() - startTime
      },
      severity: 'error'
    })

    return NextResponse.json({
      error: 'Agent generation failed',
      message: error.message
    }, { status: 500 })
  }
}
