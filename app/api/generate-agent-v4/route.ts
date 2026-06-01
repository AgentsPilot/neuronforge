import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { V4WorkflowGenerator, WorkflowGenerationInput } from '@/lib/agentkit/v4/v4-generator';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AIAnalyticsService } from '@/lib/analytics/aiAnalytics';
import { createLogger } from '@/lib/logger';
// 2026-05-31: USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW retired.
// Route now V4-only (V6 is the production primary; this route is the dormant
// fallback when NEXT_PUBLIC_USE_V6_AGENT_GENERATION is off). V5WorkflowGenerator
// source kept for now — broader V4/V5 stack retirement is a separate cleanup.

export const runtime = 'nodejs';

// Type for loaded plugin context used in workflow generation
interface LoadedPluginContext {
  key: string;
  displayName: string;
  context: string;
  category: string;
  capabilities: string[];
  actions: Record<string, any>;
  plugin: any;
}

const logger = createLogger({ module: 'API', route: '/api/generate-agent-v4' });

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
      enhancedPromptTechnicalWorkflow,  // Phase 4 technical_workflow output (bypasses Stage 1)
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

    // Parse enhancedPromptTechnicalWorkflow if it's a string (from JSON import or manual input)
    let parsedTechnicalWorkflow = enhancedPromptTechnicalWorkflow;
    if (typeof enhancedPromptTechnicalWorkflow === 'string') {
      try {
        parsedTechnicalWorkflow = JSON.parse(enhancedPromptTechnicalWorkflow);
        logger.debug('Parsed enhancedPromptTechnicalWorkflow from string');
      } catch (e) {
        logger.warn({ error: e }, 'Failed to parse enhancedPromptTechnicalWorkflow string');
        parsedTechnicalWorkflow = null;
      }
    }

    // Check if technical workflow is provided (from enhanced prompt flow)
    const hasTechnicalWorkflow = parsedTechnicalWorkflow?.technical_workflow?.length > 0;

    // 2026-05-31: V4 is the only generator after the
    // USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW retirement.
    const generatorVersion = 'v4' as const;

    logger.info({
      agentId,
      sessionId,
      userId,
      promptLength: prompt?.length || 0,
      hasEnhancedPrompt: !!enhancedPrompt,
      hasTechnicalWorkflow,
      technicalWorkflowStepsCount: hasTechnicalWorkflow ? parsedTechnicalWorkflow.technical_workflow.length : 0,
      generatorVersion,
    }, 'Agent generation started (V4 - 3-Stage Architecture)');

    // Validate required fields
    // Either prompt, enhancedPrompt, or technical workflow must be provided
    if (!prompt && !enhancedPrompt && !hasTechnicalWorkflow) {
      return NextResponse.json(
        {
          success: false,
          error: 'prompt, enhancedPrompt, or enhancedPromptTechnicalWorkflow is required',
          details: {
            hasPrompt: !!prompt,
            hasEnhancedPrompt: !!enhancedPrompt,
            hasTechnicalWorkflow,
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
        generator_version: generatorVersion,
        prompt_length: prompt?.length || 0,
        has_enhanced_prompt: !!enhancedPrompt,
        has_technical_workflow: hasTechnicalWorkflow,
        has_clarifications: !!(clarificationAnswers && Object.keys(clarificationAnswers).length > 0),
      },
      severity: 'info',
    });

    // Get plugin manager instance (moved early for plugin resolution)
    const pluginManager = await PluginManagerV2.getInstance();

    // Determine plugins to use - prioritize services_involved from prior steps
    let pluginsToUse: string[];

    if (services_involved && services_involved.length > 0) {
      // Trust services_involved from enhance-prompt/clarity phase
      pluginsToUse = services_involved;
      logger.debug({ plugins: pluginsToUse }, 'Using services_involved from prior step');
    } else {
      // Fallback: get user's connected plugins via PluginManager (includes system plugins)
      pluginsToUse = await pluginManager.getAllActivePluginKeys(userId);
      logger.debug({ plugins: pluginsToUse }, 'Loaded all connected plugins via PluginManager');
    }

    logger.info({
      userId: user.id,
      sessionId,
      agentId,
      hasRawPrompt: !!prompt,
      hasEnhancedPrompt: !!enhancedPrompt,
      promptPreview: (prompt || enhancedPrompt || '').substring(0, 200),
      connectedPluginsCount: connectedPlugins?.length || connectedPluginData?.length || 0,
      servicesInvolvedCount: services_involved?.length || 0,
      pluginsToUseCount: pluginsToUse.length,
    }, 'Starting workflow generation');

    // Step 1: Resolve final prompt
    let finalEnhancedPrompt = enhancedPrompt;

    if (prompt && !enhancedPrompt) {
      logger.warn('No enhanced prompt provided - using raw user prompt (may result in incorrect workflow steps)');
      finalEnhancedPrompt = prompt;
    }

    // Step 2: Load connected plugin contexts
    // Use the filtered plugins (pluginsToUse) from earlier
    logger.debug({ plugins: pluginsToUse }, 'Loading plugin contexts');

    // Load full plugin contexts from plugin manager
    const pluginDefContexts = pluginManager.getPluginsDefinitionContext(pluginsToUse);

    // Convert PluginDefinitionContext to IPluginContext format
    const loadedPluginContexts: LoadedPluginContext[] = pluginDefContexts.map(ctx => ({
      key: ctx.key,
      displayName: ctx.displayName,
      context: ctx.getContext(),
      category: ctx.category,
      capabilities: ctx.capabilities,
      // Include the full context for DSL builder to access actions
      actions: ctx.actions,
      plugin: ctx.plugin,
    }));

    logger.debug({
      count: loadedPluginContexts.length,
      plugins: loadedPluginContexts.map((ctx: LoadedPluginContext) => ({
        key: ctx.key,
        displayName: ctx.displayName,
        actionsCount: Object.keys(ctx.actions || {}).length,
      })),
    }, 'Plugin contexts loaded');

    // Step 4 & 5: Generate workflow using the V4 generator.
    // Two paths:
    // - Technical Workflow: skips LLM, builds DSL directly
    // - Enhanced Prompt: Stage 1 (LLM) + Stage 2 (DSL)
    logger.debug({
      generatorVersion: 'v4',
      hasTechnicalWorkflow,
    }, 'Using V4 generator (standard flow)');

    const v4Generator = new V4WorkflowGenerator(pluginManager, {
      connectedPlugins: loadedPluginContexts,
      userId,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      aiAnalytics,
    });

    const v4Input: WorkflowGenerationInput = {
      enhancedPrompt: finalEnhancedPrompt,
      technicalWorkflow: parsedTechnicalWorkflow,
    };

    logger.debug({
      hasEnhancedPrompt: !!finalEnhancedPrompt,
      hasTechnicalWorkflow,
    }, 'Starting V4 workflow generation');

    const result = await v4Generator.generateWorkflow(v4Input, {
      connectedPlugins: loadedPluginContexts,
      userId,
    });

    if (!result.success) {
      const endTime = Date.now();
      logger.error({
        errors: result.errors,
        warnings: result.warnings,
        latencyMs: endTime - startTime,
      }, 'Generation failed');

      // Log failure to audit trail
      await auditTrail.log({
        action: AUDIT_EVENTS.AGENT_GENERATION_FAILED,
        entityType: 'agent',
        entityId: agentId,
        userId: user.id,
        resourceName: 'V4 Agent Generator',
        details: {
          sessionId,
          generator_version: generatorVersion,
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
    const technicalWorkflowUsed = result.technicalWorkflowUsed ?? false;

    logger.info({
      metadata: result.metadata,
      warningsCount: result.warnings?.length || 0,
      latencyMs: latency_ms,
      technicalWorkflowUsed,
    }, 'Generation succeeded');

    logger.debug({ workflowSteps: result.workflow?.workflow_steps }, 'Final PILOT workflow steps');

    // Convert PILOT_DSL_SCHEMA to agent format (v3-compatible)
    const workflow = result.workflow;

    // Defensive check: ensure all required fields exist
    if (!workflow.workflow_steps || workflow.workflow_steps.length === 0) {
      logger.error('Workflow generated without workflow_steps');
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
      logger.warn('Workflow generated without required_inputs, using empty array');
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
        generator_version: generatorVersion,
        workflow_type: workflow.workflow_type,
        steps_count: workflow.workflow_steps.length,
        inputs_count: workflow.required_inputs.length,
        plugins: workflow.suggested_plugins,
        confidence: workflow.confidence,
        latency_ms,
        technical_workflow_used: technicalWorkflowUsed,
      },
      severity: 'info',
    });

    // Track AI analytics (only if Stage 1 LLM was used - skip for technical workflow path)
    if (!technicalWorkflowUsed) {
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
    } else {
      logger.debug('Skipping AI analytics tracking (technical workflow path - no Stage 1 LLM call)');
    }

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
        connected_plugins: pluginsToUse,
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
        pilot_steps_original: workflow.workflow_steps, // Original workflow before any calibration
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
            generator_version: generatorVersion,
            generation_method: technicalWorkflowUsed ? 'v4_technical_workflow_dsl' : 'v4_openai_3stage',
            agent_id: agentId,
            session_id: sessionId,
            prompt_type: enhancedPrompt ? 'enhanced' : 'raw',
            architecture: technicalWorkflowUsed ? 'technical-workflow-dsl' : 'openai-3-stage',
            technical_workflow_used: technicalWorkflowUsed,
            latency_ms,
          },
        },
      },
      extraction_details: {
        version: generatorVersion,
        architecture: technicalWorkflowUsed ? 'technical-workflow-dsl' : 'openai-3-stage',
        technical_workflow_used: technicalWorkflowUsed,
        workflow_step_count: workflow.workflow_steps?.length || 0,
        activity_tracked: true,
        latency_ms,
      },
      warnings: result.warnings,
      metadata: {
        ...result.metadata,
        version: generatorVersion,
        generator_version: generatorVersion,
        technical_workflow_used: technicalWorkflowUsed,
        generatedAt: new Date().toISOString(),
        latency_ms,
      },
    });
  } catch (error: any) {
    const endTime = Date.now();
    logger.error({ err: error, latencyMs: endTime - startTime }, 'Unexpected error');

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
