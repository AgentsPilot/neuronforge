import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { V4WorkflowGenerator } from '@/lib/agentkit/v4/v4-generator';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';

export const runtime = 'nodejs';

// Debug mode
const DEBUG = process.env.NODE_ENV === 'development';

// Initialize Supabase service client for analytics
const supabaseServiceRole = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize services
const auditTrail = AuditTrailService.getInstance();
const aiAnalytics = new AIAnalyticsService(supabaseServiceRole, {
  enableRealtime: true,
  enableCostTracking: true,
  enablePerformanceMetrics: true,
});

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const {
      prompt,  // Raw user prompt (will call enhance-prompt API)
      enhancedPrompt,  // Or pre-enhanced prompt
      clarificationAnswers,
      connectedPlugins,
      connectedPluginData,
      services_involved,
      sessionId: providedSessionId,
      agentId: providedAgentId,
    } = await req.json();

    // Authentication
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    // Generate IDs if not provided
    const sessionId = providedSessionId ||
                      clarificationAnswers?.sessionId ||
                      req.headers.get('x-session-id') ||
                      uuidv4();

    const agentId = providedAgentId ||
                    clarificationAnswers?.agentId ||
                    req.headers.get('x-agent-id') ||
                    uuidv4();

    const userId = user.id;

    console.log('🎯 V4 AGENT GENERATION (3-Stage Architecture):', {
      agentId,
      sessionId,
      userId,
      promptLength: prompt?.length || 0,
      hasEnhancedPrompt: !!enhancedPrompt,
    });

    // Validate required fields
    if (!prompt && !enhancedPrompt) {
      return NextResponse.json(
        {
          success: false,
          error: 'prompt or enhancedPrompt is required',
          details: {
            hasPrompt: !!prompt,
            hasEnhancedPrompt: !!enhancedPrompt,
          }
        },
        { status: 400 }
      );
    }

    // Log generation start to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENT_GENERATION_STARTED,
      entityType: 'agent',
      entityId: agentId,
      userId: user.id,
      resourceName: 'V4 Agent Generator (OpenAI 3-Stage)',
      details: {
        sessionId,
        generation_method: 'v4_openai_3stage',
        prompt_length: prompt?.length || 0,
        has_enhanced_prompt: !!enhancedPrompt,
        has_clarifications: !!(clarificationAnswers && Object.keys(clarificationAnswers).length > 0),
      },
      severity: 'info',
    });

    // Get user's connected plugins
    const { data: pluginRows } = await supabase
      .from('plugin_connections')
      .select('plugin_key')
      .eq('user_id', user.id);

    const connectedPluginKeys = pluginRows?.map(p => p.plugin_key) || [];

    // Add platform plugins (like chatgpt-research) that don't need connection
    const platformPlugins = ['chatgpt-research'];
    const allAvailablePlugins = [...new Set([...connectedPluginKeys, ...platformPlugins])];

    // Use filtered plugins from services_involved, otherwise use all
    const pluginsToUse = services_involved && services_involved.length > 0
      ? services_involved.filter((p: string) => allAvailablePlugins.includes(p))
      : allAvailablePlugins;

    console.log('📦 Available plugins:', allAvailablePlugins);
    if (services_involved && services_involved.length > 0) {
      console.log('🎯 Using filtered plugins from services_involved:', pluginsToUse);
      console.log('💰 Token savings: ~' + (allAvailablePlugins.length - pluginsToUse.length) * 30 + ' tokens');
    }

    console.log('[V4 Generator] Starting workflow generation', {
      userId: user.id,
      sessionId,
      agentId,
      hasRawPrompt: !!prompt,
      hasEnhancedPrompt: !!enhancedPrompt,
      promptPreview: (prompt || enhancedPrompt || '').substring(0, 200),
      connectedPluginsCount: connectedPlugins?.length || connectedPluginData?.length || 0,
      servicesInvolvedCount: services_involved?.length || 0,
      pluginsToUse: pluginsToUse.length,
    });

    // Step 1: Get enhanced prompt (if not already provided)
    let finalEnhancedPrompt = enhancedPrompt;
    let finalConnectedPluginData = connectedPluginData;

    if (prompt && !enhancedPrompt) {
      console.log('[V4 Generator] Calling enhance-prompt API...');

      try {
        const enhanceResponse = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/enhance-prompt`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt,
              userId,
              clarificationAnswers: clarificationAnswers || {},
              connectedPlugins: services_involved || connectedPlugins,
              connectedPluginsData: connectedPluginData,
              sessionId,
              agentId,
            }),
          }
        );

        if (!enhanceResponse.ok) {
          const error = await enhanceResponse.json();
          console.error('[V4 Generator] Enhance-prompt API failed:', error);
          return NextResponse.json(
            {
              success: false,
              error: error.error || 'Failed to enhance prompt',
              stage_failed: 'prompt_enhancement',
            },
            { status: enhanceResponse.status }
          );
        }

        const enhanceResult = await enhanceResponse.json();
        finalEnhancedPrompt = enhanceResult.enhancedPrompt;
        finalConnectedPluginData = enhanceResult.connectedPluginData;

        console.log('[V4 Generator] Enhanced prompt received:', {
          length: finalEnhancedPrompt.length,
          pluginsCount: finalConnectedPluginData?.length || 0,
        });
      } catch (error: any) {
        console.error('[V4 Generator] Enhance-prompt API call exception:', error);
        return NextResponse.json(
          {
            success: false,
            error: `Failed to call enhance-prompt API: ${error.message}`,
            stage_failed: 'prompt_enhancement',
          },
          { status: 500 }
        );
      }
    }

    // Step 2: Get plugin manager instance
    const pluginManager = await PluginManagerV2.getInstance();

    // Step 3: Load connected plugin contexts
    // Use the filtered plugins (pluginsToUse) from earlier
    console.log('[V4 Generator] Loading plugin contexts for:', pluginsToUse);

    // Load full plugin contexts from plugin manager
    const pluginDefContexts = pluginManager.getPluginsDefinitionContext(pluginsToUse);

    // Convert PluginDefinitionContext to IPluginContext format
    const loadedPluginContexts = pluginDefContexts.map(ctx => ({
      key: ctx.key,
      displayName: ctx.displayName,
      context: ctx.getContext(),
      category: ctx.category,
      capabilities: ctx.capabilities,
      // Include the full context for DSL builder to access actions
      actions: ctx.actions,
      plugin: ctx.plugin,
    }));

    console.log('[V4 Generator] Total plugins loaded:', loadedPluginContexts.length);
    for (const ctx of loadedPluginContexts) {
      console.log(`[V4 Generator] Loaded plugin: ${ctx.key}`, {
        displayName: ctx.displayName,
        actionsCount: Object.keys(ctx.actions || {}).length,
      });
    }

    // Step 4: Initialize V4 generator with Anthropic API key and analytics
    const generator = new V4WorkflowGenerator(pluginManager, {
      connectedPlugins: loadedPluginContexts,
      userId,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      aiAnalytics,
    });

    // Step 5: Generate workflow using V4 (OpenAI 3-stage architecture)
    console.log('[V4 Generator] ===== ENHANCED PROMPT =====');
    console.log(finalEnhancedPrompt);
    console.log('[V4 Generator] ===== END ENHANCED PROMPT =====');

    const result = await generator.generateWorkflow(finalEnhancedPrompt, {
      connectedPlugins: loadedPluginContexts,
      userId,
    });

    if (!result.success) {
      const endTime = Date.now();
      console.error('[V4 Generator] Generation failed', {
        errors: result.errors,
        warnings: result.warnings,
        latency_ms: endTime - startTime,
      });

      // Log failure to audit trail
      await auditTrail.log({
        action: AUDIT_EVENTS.AGENT_GENERATION_FAILED,
        entityType: 'agent',
        entityId: agentId,
        userId: user.id,
        resourceName: 'V4 Agent Generator',
        details: {
          sessionId,
          errors: result.errors,
          warnings: result.warnings,
          stage_failed: 'workflow_generation',
          latency_ms: endTime - startTime,
        },
        severity: 'critical',
      });

      return NextResponse.json(
        {
          success: false,
          error: result.errors?.join('; ') || 'Workflow generation failed',
          errors: result.errors,
          warnings: result.warnings,
          stage_failed: 'workflow_generation',
          latency_ms: endTime - startTime,
        },
        { status: 400 }
      );
    }

    const endTime = Date.now();
    const latency_ms = endTime - startTime;

    console.log('[V4 Generator] Generation succeeded', {
      metadata: result.metadata,
      warningsCount: result.warnings?.length || 0,
      latency_ms,
    });

    console.log('[V4 Generator] ===== FINAL PILOT WORKFLOW_STEPS =====');
    console.log(JSON.stringify(result.workflow?.workflow_steps, null, 2));
    console.log('[V4 Generator] ===== END WORKFLOW_STEPS =====');

    // Convert PILOT_DSL_SCHEMA to agent format (v3-compatible)
    const workflow = result.workflow;

    // Defensive check: ensure all required fields exist
    if (!workflow.workflow_steps || workflow.workflow_steps.length === 0) {
      console.error('[V4 Generator] Workflow generated without workflow_steps');
      return NextResponse.json(
        {
          success: false,
          error: 'Workflow generation incomplete: missing workflow_steps',
          stage_failed: 'dsl_building',
        },
        { status: 500 }
      );
    }

    if (!workflow.required_inputs) {
      console.warn('[V4 Generator] Workflow generated without required_inputs, using empty array');
      workflow.required_inputs = [];
    }

    // Log success to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENT_GENERATION_COMPLETED,
      entityType: 'agent',
      entityId: agentId,
      userId: user.id,
      resourceName: workflow.agent_name,
      details: {
        sessionId,
        workflow_type: workflow.workflow_type,
        steps_count: workflow.workflow_steps.length,
        inputs_count: workflow.required_inputs.length,
        plugins: workflow.suggested_plugins,
        confidence: workflow.confidence,
        latency_ms,
      },
      severity: 'info',
    });

    // Track AI analytics (V4 uses Claude Sonnet 4 for step planning)
    await aiAnalytics.trackAICall({
      call_id: `v4_step_plan_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      user_id: user.id,
      session_id: sessionId,
      provider: 'anthropic',
      model_name: 'claude-sonnet-4-20250514',
      endpoint: 'messages',
      feature: 'agent_generation',
      component: 'generate-agent-v4',
      workflow_step: 'stage1_step_plan',
      category: 'agent_creation',
      input_tokens: result.tokensUsed?.stage1.input || 0,
      output_tokens: result.tokensUsed?.stage1.output || 0,
      cost_usd: result.cost?.stage1 || 0,
      latency_ms: latency_ms,
      success: true,
      metadata: {
        architecture: 'openai-3-stage',
        steps_generated: workflow.workflow_steps.length,
        has_conditionals: workflow.workflow_steps.some((s: any) => s.type === 'conditional'),
        has_loops: workflow.workflow_steps.some((s: any) => s.type === 'scatter_gather'),
        total_tokens: result.tokensUsed?.total.total || 0,
        total_cost: result.cost?.total || 0,
      },
    });

    // Use plan_description from clarificationAnswers as the agent description
    // This is the short summary generated after the clarity phase
    const agentDescription = clarificationAnswers?.plan_description || workflow.description;

    return NextResponse.json({
      success: true,
      agentId,
      sessionId,
      agent: {
        id: agentId,
        user_id: userId,
        agent_name: workflow.agent_name,
        user_prompt: clarificationAnswers?.originalPrompt || prompt || '',  // Original user prompt (not enhanced)
        system_prompt: workflow.system_prompt,
        description: agentDescription,
        plugins_required: workflow.suggested_plugins,
        connected_plugins: allAvailablePlugins,
        input_schema: (workflow.required_inputs || []).map((input: any) => ({
          name: input.name,
          type: input.type,
          label: input.label || input.name,
          required: input.required,
          description: input.description || '',
          placeholder: input.placeholder || '',
          hidden: false,
        })),
        output_schema: [],
        status: 'draft' as const,
        mode: 'on_demand' as const,
        schedule_cron: null,
        created_from_prompt: prompt || enhancedPrompt || '',
        ai_reasoning: workflow.reasoning,
        ai_confidence: workflow.confidence,
        ai_generated_at: new Date().toISOString(),
        workflow_steps: workflow.workflow_steps,
        pilot_steps: workflow.workflow_steps,
        trigger_conditions: {
          error_handling: {
            on_failure: 'stop',
            retry_on_fail: false,
          },
        },
        detected_categories: workflow.suggested_plugins.map((p: string) => ({
          plugin: p,
          detected: true,
        })),
        agent_config: {
          mode: 'on_demand',
          metadata: {
            version: '4.0',
            generation_method: 'v4_openai_3stage',
            agent_id: agentId,
            session_id: sessionId,
            prompt_type: enhancedPrompt ? 'enhanced' : 'raw',
            architecture: 'openai-3-stage',
            latency_ms,
          },
        },
      },
      extraction_details: {
        version: 'v4',
        architecture: 'openai-3-stage',
        workflow_step_count: workflow.workflow_steps?.length || 0,
        activity_tracked: true,
        latency_ms,
      },
      warnings: result.warnings,
      metadata: {
        ...result.metadata,
        version: 'v4',
        generatedAt: new Date().toISOString(),
        latency_ms,
      },
    });
  } catch (error: any) {
    const endTime = Date.now();
    console.error('[V4 Generator] Unexpected error:', error);
    console.error('[V4 Generator] Error stack:', error.stack);

    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Internal server error during workflow generation',
        stage_failed: 'unknown',
        latency_ms: endTime - startTime,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
