// lib/ai/modelRouter.ts
// Intelligent Model Routing based on Agent Intensity System (AIS) scores
// Routes agent executions to optimal model (GPT-4o-mini, Claude Haiku, or GPT-4o)
// Based on complexity, success rate, and execution history

import { SupabaseClient } from '@supabase/supabase-js';
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { AISConfigService } from '@/lib/services/AISConfigService';

export interface ModelSelection {
  model: string;
  provider: 'openai' | 'anthropic';
  reasoning: string;
  intensity_score: number;
}

export class ModelRouter {
  /**
   * Select optimal model for agent execution based on AIS score
   *
   * @param agentId - Agent identifier
   * @param supabase - Supabase client for database access
   * @param userId - User identifier for audit trail
   * @returns ModelSelection with model, provider, and reasoning
   */
  static async selectModel(
    agentId: string,
    supabase: SupabaseClient,
    userId: string
  ): Promise<ModelSelection> {
    try {
      // Get model routing configuration from database (Phase 3 - database-driven models)
      const modelConfig = await AISConfigService.getModelRoutingConfig(supabase);

      // Get routing thresholds from database
      const routingConfig = await SystemConfigService.getRoutingConfig(supabase);
      const lowThreshold = routingConfig.lowThreshold;
      const mediumThreshold = routingConfig.mediumThreshold;
      const minSuccessRate = routingConfig.minSuccessRate;
      const anthropicEnabled = routingConfig.anthropicEnabled;

      // 🚨 CRITICAL: Use min_executions_for_score as the SINGLE SOURCE OF TRUTH
      // This ensures routing only starts when combined_score has switched to blended formula
      // Eliminates risk of routing with stale creation-only scores
      const minExecutionsForScore = await AISConfigService.getSystemConfig(
        supabase,
        'min_executions_for_score',
        5 // Default to 5 if not configured
      );

      console.log(`🔒 [Model Router] Using min_executions_for_score (${minExecutionsForScore}) as routing threshold`);

      // Fetch AIS metrics for this agent
      const metrics = await AgentIntensityService.getMetrics(supabase, agentId);

      // CASE 1: New agent (insufficient execution history)
      // Uses min_executions_for_score to ensure combined_score is using blended formula
      if (!metrics || metrics.total_executions < minExecutionsForScore) {
        return this.logAndReturn({
          model: modelConfig.low.model,
          provider: modelConfig.low.provider,
          reasoning: `New agent (${metrics?.total_executions || 0}/${minExecutionsForScore} executions) - conservative start with cost-efficient model until blended scoring begins`,
          intensity_score: metrics?.combined_score || 5.0
        }, agentId, userId, supabase);
      }

      const score = metrics.combined_score;
      const successRate = metrics.success_rate;
      const totalExecutions = metrics.total_executions;

      console.log('📊 AIS Metrics:', {
        agent_id: agentId,
        combined_score: score,
        execution_score: metrics.execution_score,
        creation_score: metrics.creation_score,
        success_rate: successRate,
        total_executions: totalExecutions
      });

      // CASE 2: Low success rate - upgrade to premium model
      if (successRate < minSuccessRate) {
        return this.logAndReturn({
          model: modelConfig.high.model,
          provider: modelConfig.high.provider,
          reasoning: `Low success rate (${successRate.toFixed(1)}%) - upgrading to premium model for reliability`,
          intensity_score: score
        }, agentId, userId, supabase);
      }

      // CASE 3: Route based on complexity score

      // Low complexity: Use database-configured low-tier model
      if (score <= lowThreshold) {
        return this.logAndReturn({
          model: modelConfig.low.model,
          provider: modelConfig.low.provider,
          reasoning: `Low complexity (score: ${score.toFixed(2)}) - using cost-optimized model (${modelConfig.low.model})`,
          intensity_score: score
        }, agentId, userId, supabase);
      }

      // Medium complexity: Use database-configured medium-tier model
      else if (score <= mediumThreshold) {
        // Check if Anthropic provider is enabled (from database config)
        if (anthropicEnabled) {
          return this.logAndReturn({
            model: modelConfig.medium.model,
            provider: modelConfig.medium.provider,
            reasoning: `Medium complexity (score: ${score.toFixed(2)}) - balanced cost/performance with ${modelConfig.medium.model}`,
            intensity_score: score
          }, agentId, userId, supabase);
        } else {
          // Fallback to low-tier if Anthropic disabled
          return this.logAndReturn({
            model: modelConfig.low.model,
            provider: modelConfig.low.provider,
            reasoning: `Medium complexity (score: ${score.toFixed(2)}) - Anthropic disabled, using ${modelConfig.low.model}`,
            intensity_score: score
          }, agentId, userId, supabase);
        }
      }

      // High complexity: Use database-configured high-tier model
      else {
        return this.logAndReturn({
          model: modelConfig.high.model,
          provider: modelConfig.high.provider,
          reasoning: `High complexity (score: ${score.toFixed(2)}) - using premium model (${modelConfig.high.model}) for optimal results`,
          intensity_score: score
        }, agentId, userId, supabase);
      }

    } catch (error) {
      // On error, safely fallback to default model
      console.error('❌ Model routing error:', error);

      return this.logAndReturn({
        model: 'gpt-4o',
        provider: 'openai',
        reasoning: `Routing error - falling back to default model: ${error instanceof Error ? error.message : 'Unknown error'}`,
        intensity_score: 5.0
      }, agentId, userId, supabase);
    }
  }

  /**
   * Log routing decision to audit trail and return selection
   *
   * @private
   */
  private static async logAndReturn(
    selection: ModelSelection,
    agentId: string,
    userId: string,
    supabase: SupabaseClient
  ): Promise<ModelSelection> {
    try {
      // Log to audit trail for monitoring and analysis
      const auditTrail = AuditTrailService.getInstance();
      await auditTrail.log({
        action: AUDIT_EVENTS.MODEL_ROUTING_DECISION,
        entityType: 'agent',
        entityId: agentId,
        userId: userId,
        resourceName: 'Model Router',
        details: {
          selected_model: selection.model,
          selected_provider: selection.provider,
          reasoning: selection.reasoning,
          intensity_score: selection.intensity_score,
          timestamp: new Date().toISOString()
        },
        severity: 'info'
      });
    } catch (auditError) {
      // Don't fail routing if audit logging fails
      console.error('⚠️  Audit trail logging failed (non-critical):', auditError);
    }

    // Log to console for immediate visibility
    console.log('🎯 Model Routing Decision:', {
      agent_id: agentId,
      selected_model: selection.model,
      provider: selection.provider,
      reasoning: selection.reasoning,
      intensity_score: selection.intensity_score
    });

    return selection;
  }

  /**
   * Check if intelligent routing is enabled via feature flag
   * DATABASE-DRIVEN (Phase 4): Uses SystemConfigService instead of environment variables
   *
   * @param supabase - Supabase client for database access
   * @returns true if routing enabled, false otherwise
   */
  static async isRoutingEnabled(supabase: SupabaseClient): Promise<boolean> {
    const routingConfig = await SystemConfigService.getRoutingConfig(supabase);
    return routingConfig.enabled;
  }

  /**
   * Get current routing configuration (for debugging/monitoring)
   * DATABASE-DRIVEN (Phase 4): All values loaded from database, no environment variables
   *
   * @param supabase - Supabase client for database access
   * @returns Current routing thresholds and settings
   */
  static async getConfig(supabase: SupabaseClient) {
    // Load model config from database (Phase 3)
    const modelConfig = await AISConfigService.getModelRoutingConfig(supabase);

    // Load routing thresholds from database (Phase 4 - eliminated env vars)
    const routingConfig = await SystemConfigService.getRoutingConfig(supabase);

    // Load min_executions_for_score from database
    const minExecutionsForScore = await AISConfigService.getSystemConfig(
      supabase,
      'min_executions_for_score',
      5 // Default to 5 if not configured
    );

    return {
      routing_enabled: routingConfig.enabled,
      anthropic_enabled: routingConfig.anthropicEnabled,
      thresholds: {
        low: routingConfig.lowThreshold,
        medium: routingConfig.mediumThreshold
      },
      min_executions: minExecutionsForScore,
      min_success_rate: routingConfig.minSuccessRate,
      models: {
        low: modelConfig.low,
        medium: modelConfig.medium,
        high: modelConfig.high
      }
    };
  }
}
