/**
 * Agent Generation API V3 (2-Stage Pipeline)
 *
 * This is the NEW agent generation endpoint using the 2-stage approach:
 * - Stage 1: Claude Sonnet 4 designs workflow structure (strict mode)
 * - Stage 2: Claude Haiku fills parameter values
 * - 3 Validation Gates ensure quality
 *
 * Target: 95%+ success rate on simple workflows, 90%+ on complex
 * Cost: ~$0.028 per generation
 * Latency: 4-6 seconds
 *
 * To enable: Set ENABLE_TWOSTAGE_GENERATOR=true in environment
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { generateAgentTwoStage } from '@/lib/agentkit/twostage-agent-generator';
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
  enablePerformanceMetrics: true
});

export async function POST(req: Request) {
  try {
    const {
      prompt,
      clarificationAnswers,
      agentId: providedAgentId,
      sessionId: providedSessionId
    } = await req.json();

    const cookieStore = await cookies();
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
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessionId = providedSessionId ||
                      clarificationAnswers?.sessionId ||
                      req.headers.get('x-session-id') ||
                      uuidv4();

    const agentId = providedAgentId ||
                    clarificationAnswers?.agentId ||
                    req.headers.get('x-agent-id') ||
                    uuidv4();

    console.log('🎯 TWOSTAGE AGENT GENERATION V3 (2-Stage Pipeline):', {
      agentId,
      sessionId,
      promptLength: prompt?.length || 0
    });

    const startTime = Date.now();

    // Log generation start to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENT_GENERATION_STARTED,
      entityType: 'agent',
      entityId: agentId,
      userId: user.id,
      resourceName: 'TwoStage Agent Generator V3',
      details: {
        sessionId: sessionId,
        generation_method: 'twostage_v3',
        prompt_length: prompt?.length || 0,
        has_clarifications: !!(clarificationAnswers && Object.keys(clarificationAnswers).length > 0)
      },
      severity: 'info'
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

    console.log('📦 Available plugins:', allAvailablePlugins);

    // ========================================
    // 🚀 TWO-STAGE GENERATION
    // ========================================

    let result;
    try {
      result = await generateAgentTwoStage(
        user.id,
        prompt,
        allAvailablePlugins
      );
    } catch (generationError: any) {
      console.error('❌ TwoStage generation threw exception:', generationError);

      // Log failure to audit trail
      await auditTrail.log({
        action: AUDIT_EVENTS.AGENT_GENERATION_FAILED,
        entityType: 'agent',
        entityId: agentId,
        userId: user.id,
        resourceName: 'TwoStage Agent Generator',
        details: {
          sessionId,
          error: generationError.message,
          stack: generationError.stack
        },
        severity: 'error'
      });

      return NextResponse.json({
        error: 'Agent generation failed with exception',
        message: generationError.message,
        stack: DEBUG ? generationError.stack : undefined
      }, { status: 500 });
    }

    const endTime = Date.now();

    // ========================================
    // HANDLE RESULTS
    // ========================================

    if (!result.success) {
      console.error('❌ TwoStage generation failed:', result.error);

      // Log failure to audit trail
      await auditTrail.log({
        action: AUDIT_EVENTS.AGENT_GENERATION_FAILED,
        entityType: 'agent',
        entityId: agentId,
        userId: user.id,
        resourceName: 'TwoStage Agent Generator',
        details: {
          sessionId,
          error: result.error,
          stage_failed: result.stage_failed,
          validation: result.validation
        },
        severity: 'error'
      });

      return NextResponse.json({
        error: result.error,
        details: {
          stage_failed: result.stage_failed,
          validation: result.validation
        }
      }, { status: 500 });
    }

    // ========================================
    // SUCCESS - TRACK ANALYTICS
    // ========================================

    const agent = result.agent!;
    const tokensUsed = result.tokensUsed!;

    // Defensive check: ensure all required fields exist
    if (!agent.required_inputs) {
      console.error('❌ TwoStage generation returned agent without required_inputs field');
      return NextResponse.json({
        error: 'Agent generation incomplete: missing required_inputs field',
        details: {
          agent_name: agent.agent_name,
          has_workflow_steps: !!agent.workflow_steps,
          has_suggested_plugins: !!agent.suggested_plugins
        }
      }, { status: 500 });
    }

    if (!agent.workflow_steps) {
      console.error('❌ TwoStage generation returned agent without workflow_steps field');
      return NextResponse.json({
        error: 'Agent generation incomplete: missing workflow_steps field'
      }, { status: 500 });
    }

    console.log('✅ TwoStage generation SUCCESS:', {
      agent_name: agent.agent_name,
      workflow_type: agent.workflow_type,
      steps: agent.workflow_steps.length,
      inputs: agent.required_inputs.length,
      confidence: agent.confidence,
      total_tokens: tokensUsed.total,
      latency: `${result.latency_ms}ms`
    });

    // Track Stage 1 AI call (Claude Sonnet 4)
    await aiAnalytics.trackAICall({
      call_id: `twostage_stage1_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      user_id: user.id,
      session_id: sessionId,
      provider: 'anthropic',
      model_name: 'claude-sonnet-4-20250514',
      endpoint: 'messages',
      feature: 'agent_generation',
      component: 'generate-agent-v3',
      workflow_step: 'stage1_workflow_designer',
      category: 'agent_creation',
      input_tokens: tokensUsed.stage1.input,
      output_tokens: tokensUsed.stage1.output,
      cost_usd: (tokensUsed.stage1.input * 0.003 / 1000) +
                (tokensUsed.stage1.output * 0.015 / 1000),
      latency_ms: Math.floor(result.latency_ms! * 0.6), // Approximate 60% of total time
      response_size_bytes: JSON.stringify(agent).length,
      success: true,
      request_type: 'chat',
      activity_type: 'agent_generation',
      activity_name: `Generate Agent (Stage 1): ${agent.agent_name}`,
      agent_id: agentId,
      metadata: {
        stage: 'stage1',
        workflow_type: agent.workflow_type,
        confidence: agent.confidence
      }
    });

    // Track Stage 2 AI call (Claude Haiku)
    await aiAnalytics.trackAICall({
      call_id: `twostage_stage2_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
      user_id: user.id,
      session_id: sessionId,
      provider: 'anthropic',
      model_name: 'claude-haiku-3-20240307',
      endpoint: 'messages',
      feature: 'agent_generation',
      component: 'generate-agent-v3',
      workflow_step: 'stage2_parameter_filler',
      category: 'agent_creation',
      input_tokens: tokensUsed.stage2.input,
      output_tokens: tokensUsed.stage2.output,
      cost_usd: (tokensUsed.stage2.input * 0.00025 / 1000) +
                (tokensUsed.stage2.output * 0.00125 / 1000),
      latency_ms: Math.floor(result.latency_ms! * 0.4), // Approximate 40% of total time
      response_size_bytes: JSON.stringify(agent).length,
      success: true,
      request_type: 'chat',
      activity_type: 'agent_generation',
      activity_name: `Generate Agent (Stage 2): ${agent.agent_name}`,
      agent_id: agentId,
      metadata: {
        stage: 'stage2',
        parameter_mappings: result.agent?.workflow_steps.length
      }
    });

    // Log success to audit trail
    await auditTrail.log({
      action: AUDIT_EVENTS.AGENT_GENERATION_COMPLETED,
      entityType: 'agent',
      entityId: agentId,
      userId: user.id,
      resourceName: agent.agent_name,
      details: {
        sessionId,
        workflow_type: agent.workflow_type,
        steps_count: agent.workflow_steps.length,
        inputs_count: agent.required_inputs.length,
        plugins: agent.suggested_plugins,
        confidence: agent.confidence,
        total_tokens: tokensUsed.total,
        latency_ms: result.latency_ms,
        validation: result.validation
      },
      severity: 'info'
    });

    // ========================================
    // RETURN SUCCESS RESPONSE (V2-compatible format)
    // ========================================

    return NextResponse.json({
      success: true,
      agentId,
      sessionId,
      agent: {
        user_id: user.id,
        agent_name: agent.agent_name,
        user_prompt: clarificationAnswers?.originalPrompt || prompt,  // Original user prompt (not enhanced)
        system_prompt: `You are an AI agent designed to ${agent.agent_description}`,
        description: agent.agent_description,
        plugins_required: agent.suggested_plugins,
        connected_plugins: allAvailablePlugins,
        input_schema: (agent.required_inputs || []).map(input => ({
          name: input.name,
          type: input.type,
          label: input.label || input.name,
          required: input.required,
          description: input.description || '',
          placeholder: input.default_value || '',
          hidden: false
        })),
        output_schema: [],
        status: 'draft' as const,
        mode: 'on_demand' as const,
        schedule_cron: null,
        created_from_prompt: prompt,
        ai_reasoning: agent.reasoning,
        ai_confidence: agent.confidence,
        ai_generated_at: new Date().toISOString(),
        workflow_steps: agent.workflow_steps,
        pilot_steps: agent.workflow_steps,
        trigger_conditions: {
          error_handling: {
            on_failure: 'stop',
            retry_on_fail: false
          }
        },
        detected_categories: agent.suggested_plugins.map(p => ({
          plugin: p,
          detected: true
        })),
        agent_config: {
          mode: 'on_demand',
          metadata: {
            version: '3.0',
            generation_method: 'twostage_v3',
            agent_id: agentId,
            session_id: sessionId,
            prompt_type: 'enhanced',
            ai_generated_at: new Date().toISOString(),
            platform_version: 'v3.0',
            analysis_confidence: agent.confidence,
            workflow_type: agent.workflow_type
          },
          timezone: 'UTC',
          agent_name: agent.agent_name,
          description: agent.agent_description,
          user_prompt: clarificationAnswers?.originalPrompt || prompt,  // Original user prompt
          input_schema: agent.required_inputs || [],
          output_schema: [],
          workflow_steps: agent.workflow_steps || [],
          pilot_steps: agent.workflow_steps || [],
          plugins_required: agent.suggested_plugins || [],
          connected_plugins: allAvailablePlugins,
          system_prompt: `You are an AI agent designed to ${agent.agent_description}`,
          ai_context: {
            reasoning: agent.reasoning,
            confidence: agent.confidence,
            workflow_type: agent.workflow_type,
            generation_method: 'twostage_v3',
            pilot_enabled: true,
            pilot_steps_generated: true
          }
        }
      },
      extraction_details: {
        method: 'twostage_v3',
        confidence: agent.confidence,
        total_tokens: tokensUsed.total,
        stage1_tokens: tokensUsed.stage1,
        stage2_tokens: tokensUsed.stage2,
        latency_ms: result.latency_ms,
        validation_passed: result.validation,
        workflow_step_count: agent.workflow_steps.length,
        input_field_count: agent.required_inputs.length,
        has_schedule: false,
        activity_tracked: true,
        cost_estimate_usd: (
          (tokensUsed.stage1.input * 0.003 / 1000) +
          (tokensUsed.stage1.output * 0.015 / 1000) +
          (tokensUsed.stage2.input * 0.00025 / 1000) +
          (tokensUsed.stage2.output * 0.00125 / 1000)
        ).toFixed(4)
      }
    });

  } catch (error: any) {
    console.error('💥 TwoStage API error:', error);

    return NextResponse.json({
      error: 'Internal server error',
      message: error.message,
      stack: DEBUG ? error.stack : undefined
    }, { status: 500 });
  }
}
