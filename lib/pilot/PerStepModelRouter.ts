/**
 * Per-Step Model Router - Intelligent Model Selection
 *
 * Routes individual Pilot workflow steps to optimal AI models based on:
 * - Step complexity score (from TaskComplexityAnalyzer)
 * - Agent Intensity Score (AIS)
 * - Routing strategy (conservative/balanced/aggressive)
 *
 * Reduces token consumption by 30-50% by using cost-efficient models
 * for simpler tasks while reserving powerful models for complex reasoning.
 *
 * @module lib/pilot/PerStepModelRouter
 */

import { ComplexityAnalysis } from './TaskComplexityAnalyzer';
import { createClient } from '@supabase/supabase-js';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { RoutingMemoryService } from './RoutingMemoryService';

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Model configuration for a tier
 */
export interface ModelConfig {
  model: string;
  provider: 'openai' | 'anthropic';
  tier: 'tier1' | 'tier2' | 'tier3';
  estimatedCost?: number;  // Per 1M tokens
}

/**
 * Routing decision result
 */
export interface RoutingDecision {
  // Selected model
  selectedModel: ModelConfig;

  // Scores used in decision
  stepComplexity: number;     // 0-10 from TaskComplexityAnalyzer
  agentAIS: number;           // 0-10 from agent configuration
  effectiveComplexity: number; // Weighted combination

  // Routing metadata
  routingStrategy: 'conservative' | 'balanced' | 'aggressive';
  routingSource: 'per_step_routing' | 'agent_default' | 'fallback' | 'routing_memory';

  // Explanation
  explanation: string;
}

/**
 * Routing configuration (loaded from database)
 */
interface RoutingConfig {
  enabled: boolean;
  defaultStrategy: 'conservative' | 'balanced' | 'aggressive';

  strategies: {
    conservative: { aisWeight: number; stepWeight: number };  // 60/40
    balanced: { aisWeight: number; stepWeight: number };      // 40/60
    aggressive: { aisWeight: number; stepWeight: number };    // 20/80
  };

  complexityThresholds: {
    tier1Max: number;  // Max complexity for Tier 1
    tier2Max: number;  // Max complexity for Tier 2
  };

  tierModels: {
    tier1: ModelConfig;
    tier2: ModelConfig;
    tier3: ModelConfig;
  };
}

// ============================================================================
// PER-STEP MODEL ROUTER
// ============================================================================

export class PerStepModelRouter {
  private config: RoutingConfig | null = null;
  private supabase: any;
  private auditTrail: AuditTrailService;
  private routingMemory: RoutingMemoryService;

  constructor() {
    // Initialize Supabase client with service role
    this.supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    this.auditTrail = AuditTrailService.getInstance();
    this.routingMemory = RoutingMemoryService.getInstance();
  }

  /**
   * Load routing configuration from database
   */
  private async loadConfig(): Promise<void> {
    try {
      // Fetch system settings
      const { data: systemData, error: systemError } = await this.supabase
        .from('system_settings_config')
        .select('setting_key, value')
        .in('setting_key', [
          'pilot_per_step_routing_enabled',
          'pilot_routing_default_strategy',
          'pilot_routing_strategy_conservative',
          'pilot_routing_strategy_balanced',
          'pilot_routing_strategy_aggressive'
        ]);

      if (systemError) {
        console.error('❌ [PerStepModelRouter] Failed to load system config:', systemError);
        this.setDefaultConfig();
        return;
      }

      // Fetch AIS settings
      const { data: aisData, error: aisError } = await this.supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'pilot_routing_complexity_thresholds',
          'pilot_routing_tier1_model',
          'pilot_routing_tier2_model',
          'pilot_routing_tier3_model'
        ]);

      if (aisError) {
        console.error('❌ [PerStepModelRouter] Failed to load AIS config:', aisError);
        this.setDefaultConfig();
        return;
      }

      // Parse configuration
      const config: RoutingConfig = {
        enabled: false,
        defaultStrategy: 'balanced',
        strategies: {
          conservative: { aisWeight: 0.6, stepWeight: 0.4 },
          balanced: { aisWeight: 0.4, stepWeight: 0.6 },
          aggressive: { aisWeight: 0.2, stepWeight: 0.8 }
        },
        complexityThresholds: {
          tier1Max: 3.9,
          tier2Max: 6.9
        },
        tierModels: {
          tier1: { model: 'gpt-4o-mini', provider: 'openai', tier: 'tier1' },
          tier2: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic', tier: 'tier2' },
          tier3: { model: 'gpt-4o', provider: 'openai', tier: 'tier3' }
        }
      };

      // Populate from system settings
      systemData?.forEach(item => {
        if (item.setting_key === 'pilot_per_step_routing_enabled') {
          config.enabled = item.value === true || item.value === 'true';
        } else if (item.setting_key === 'pilot_routing_default_strategy') {
          const strategy = String(item.value).replace(/"/g, '');
          config.defaultStrategy = strategy as any;
        } else if (item.setting_key === 'pilot_routing_strategy_conservative') {
          const weights = JSON.parse(item.value);
          config.strategies.conservative = weights;
        } else if (item.setting_key === 'pilot_routing_strategy_balanced') {
          const weights = JSON.parse(item.value);
          config.strategies.balanced = weights;
        } else if (item.setting_key === 'pilot_routing_strategy_aggressive') {
          const weights = JSON.parse(item.value);
          config.strategies.aggressive = weights;
        }
      });

      // Populate from AIS settings
      aisData?.forEach(item => {
        const value = JSON.parse(item.config_value);

        if (item.config_key === 'pilot_routing_complexity_thresholds') {
          config.complexityThresholds = {
            tier1Max: value.tier1_max || 3.9,
            tier2Max: value.tier2_max || 6.9
          };
        } else if (item.config_key === 'pilot_routing_tier1_model') {
          config.tierModels.tier1 = {
            model: value.model || 'gpt-4o-mini',
            provider: value.provider || 'openai',
            tier: 'tier1'
          };
        } else if (item.config_key === 'pilot_routing_tier2_model') {
          config.tierModels.tier2 = {
            model: value.model || 'claude-3-5-haiku-20241022',
            provider: value.provider || 'anthropic',
            tier: 'tier2'
          };
        } else if (item.config_key === 'pilot_routing_tier3_model') {
          config.tierModels.tier3 = {
            model: value.model || 'gpt-4o',
            provider: value.provider || 'openai',
            tier: 'tier3'
          };
        }
      });

      this.config = config;
      console.log('✅ [PerStepModelRouter] Configuration loaded from database');
      console.log(`   Enabled: ${config.enabled}`);
      console.log(`   Strategy: ${config.defaultStrategy}`);
      console.log(`   Tier 1: ${config.tierModels.tier1.model} (0-${config.complexityThresholds.tier1Max})`);
      console.log(`   Tier 2: ${config.tierModels.tier2.model} (${config.complexityThresholds.tier1Max + 0.1}-${config.complexityThresholds.tier2Max})`);
      console.log(`   Tier 3: ${config.tierModels.tier3.model} (${config.complexityThresholds.tier2Max + 0.1}-10.0)`);
    } catch (err) {
      console.error('❌ [PerStepModelRouter] Exception loading config:', err);
      this.setDefaultConfig();
    }
  }

  /**
   * Set default configuration (fallback)
   */
  private setDefaultConfig(): void {
    this.config = {
      enabled: false,
      defaultStrategy: 'balanced',
      strategies: {
        conservative: { aisWeight: 0.6, stepWeight: 0.4 },
        balanced: { aisWeight: 0.4, stepWeight: 0.6 },
        aggressive: { aisWeight: 0.2, stepWeight: 0.8 }
      },
      complexityThresholds: {
        tier1Max: 3.9,
        tier2Max: 6.9
      },
      tierModels: {
        tier1: { model: 'gpt-4o-mini', provider: 'openai', tier: 'tier1' },
        tier2: { model: 'claude-3-5-haiku-20241022', provider: 'anthropic', tier: 'tier2' },
        tier3: { model: 'gpt-4o', provider: 'openai', tier: 'tier3' }
      }
    };
    console.log('⚠️ [PerStepModelRouter] Using default configuration (routing disabled)');
  }

  /**
   * Route a step to the optimal model
   */
  async routeStep(
    complexityAnalysis: ComplexityAnalysis,
    agentAIS: number,
    agentDefaultModel?: string,
    agentId?: string
  ): Promise<RoutingDecision> {
    // Load config if not already loaded
    if (!this.config) {
      await this.loadConfig();
    }

    // If per-step routing is disabled, use agent default
    if (!this.config!.enabled) {
      return {
        selectedModel: agentDefaultModel
          ? this.parseModelString(agentDefaultModel)
          : this.config!.tierModels.tier3,
        stepComplexity: complexityAnalysis.complexityScore,
        agentAIS: agentAIS,
        effectiveComplexity: agentAIS,
        routingStrategy: this.config!.defaultStrategy,
        routingSource: 'agent_default',
        explanation: 'Per-step routing disabled, using agent default model'
      };
    }

    // Calculate effective complexity using strategy weights
    const strategy = this.config!.strategies[this.config!.defaultStrategy];
    const effectiveComplexity =
      (agentAIS * strategy.aisWeight) +
      (complexityAnalysis.complexityScore * strategy.stepWeight);

    // === CHECK MEMORY FOR LEARNED PATTERNS ===
    let memoryRecommendation = null;
    if (agentId) {
      try {
        memoryRecommendation = await this.routingMemory.getRecommendation(
          agentId,
          complexityAnalysis.stepType,
          effectiveComplexity
        );
      } catch (err) {
        console.error('❌ [PerStepModelRouter] Memory check failed:', err);
      }
    }

    // Use memory recommendation if available and confident
    if (memoryRecommendation?.shouldOverride) {
      const selectedModel = this.config!.tierModels[memoryRecommendation.recommendedTier!];

      console.log(`🧠 [PerStepModelRouter] MEMORY OVERRIDE: ${complexityAnalysis.stepName} → ${selectedModel.model}`);
      console.log(`   ${memoryRecommendation.reason}`);
      console.log(`   Historical: ${memoryRecommendation.historicalData.totalRuns} runs, ${(memoryRecommendation.historicalData.successRate * 100).toFixed(0)}% success`);

      return {
        selectedModel,
        stepComplexity: complexityAnalysis.complexityScore,
        agentAIS,
        effectiveComplexity,
        routingStrategy: this.config!.defaultStrategy,
        routingSource: 'routing_memory',
        explanation: `MEMORY: ${memoryRecommendation.reason}`
      };
    }

    // === FALLBACK TO COMPLEXITY-BASED ROUTING ===
    // Select tier based on effective complexity
    let selectedModel: ModelConfig;
    let tierName: string;

    if (effectiveComplexity <= this.config!.complexityThresholds.tier1Max) {
      selectedModel = this.config!.tierModels.tier1;
      tierName = 'Tier 1 (Low Complexity)';
    } else if (effectiveComplexity <= this.config!.complexityThresholds.tier2Max) {
      selectedModel = this.config!.tierModels.tier2;
      tierName = 'Tier 2 (Medium Complexity)';
    } else {
      selectedModel = this.config!.tierModels.tier3;
      tierName = 'Tier 3 (High Complexity)';
    }

    const explanation = `${tierName}: Step=${complexityAnalysis.complexityScore.toFixed(1)}, AIS=${agentAIS.toFixed(1)}, Effective=${effectiveComplexity.toFixed(1)} (${this.config!.defaultStrategy} strategy)`;

    console.log(`🎯 [PerStepModelRouter] ${complexityAnalysis.stepName} → ${selectedModel.model}`);
    console.log(`   ${explanation}`);

    return {
      selectedModel,
      stepComplexity: complexityAnalysis.complexityScore,
      agentAIS,
      effectiveComplexity,
      routingStrategy: this.config!.defaultStrategy,
      routingSource: 'per_step_routing',
      explanation
    };
  }

  /**
   * Parse model string to ModelConfig
   */
  private parseModelString(modelString: string): ModelConfig {
    // Handle format like "gpt-4o" or "openai:gpt-4o"
    const parts = modelString.split(':');
    const provider = parts.length > 1 ? parts[0] as any : 'openai';
    const model = parts.length > 1 ? parts[1] : parts[0];

    return {
      model,
      provider,
      tier: 'tier3'  // Assume tier3 for agent defaults
    };
  }

  /**
   * Check if per-step routing is enabled
   */
  async isEnabled(): Promise<boolean> {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config!.enabled;
  }

  /**
   * Get current routing configuration
   */
  async getConfig(): Promise<RoutingConfig | null> {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config;
  }

  /**
   * Record routing decision to audit trail
   */
  async recordRoutingDecision(
    agentId: string,
    userId: string,
    executionId: string,
    stepIndex: number,
    stepName: string,
    stepType: string,
    complexityAnalysis: ComplexityAnalysis,
    decision: RoutingDecision
  ): Promise<void> {
    try {
      // Record to specialized routing history table
      await this.supabase
        .from('pilot_step_routing_history')
        .insert({
          agent_id: agentId,
          user_id: userId,
          execution_id: executionId,
          step_index: stepIndex,
          step_name: stepName,
          step_type: stepType,
          agent_ais: decision.agentAIS,
          step_complexity: decision.stepComplexity,
          effective_complexity: decision.effectiveComplexity,
          routing_strategy: decision.routingStrategy,
          selected_tier: decision.selectedModel.tier,
          selected_model: decision.selectedModel.model,
          selected_provider: decision.selectedModel.provider,
          routing_source: decision.routingSource,
          complexity_factors: JSON.stringify({
            factorScores: complexityAnalysis.factorScores,
            rawMeasurements: complexityAnalysis.rawMeasurements,
            appliedWeights: complexityAnalysis.appliedWeights
          })
        });

      // Also log to main audit trail for compliance
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_ROUTING_DECISION,
        entityType: 'execution',
        entityId: executionId,
        userId: userId,
        resourceName: stepName,
        details: {
          agent_id: agentId,
          step_index: stepIndex,
          step_type: stepType,
          selected_model: `${decision.selectedModel.provider}:${decision.selectedModel.model}`,
          selected_tier: decision.selectedModel.tier,
          step_complexity: decision.stepComplexity.toFixed(2),
          agent_ais: decision.agentAIS.toFixed(2),
          effective_complexity: decision.effectiveComplexity.toFixed(2),
          routing_strategy: decision.routingStrategy,
          routing_source: decision.routingSource,
          explanation: decision.explanation
        }
      });

      console.log(`📊 [PerStepModelRouter] Recorded routing decision for ${stepName}`);
    } catch (err) {
      console.error('❌ [PerStepModelRouter] Failed to record routing decision:', err);
      // Don't throw - audit trail failure shouldn't break execution
    }
  }

  /**
   * Update routing decision with execution metrics
   */
  async updateRoutingMetrics(
    executionId: string,
    stepIndex: number,
    tokensUsed: number,
    executionTimeMs: number,
    success: boolean,
    estimatedCostUsd?: number
  ): Promise<void> {
    try {
      await this.supabase
        .from('pilot_step_routing_history')
        .update({
          tokens_used: tokensUsed,
          execution_time_ms: executionTimeMs,
          success: success,
          estimated_cost_usd: estimatedCostUsd
        })
        .eq('execution_id', executionId)
        .eq('step_index', stepIndex);

      console.log(`📈 [PerStepModelRouter] Updated metrics: ${tokensUsed} tokens, ${executionTimeMs}ms`);
    } catch (err) {
      console.error('❌ [PerStepModelRouter] Failed to update routing metrics:', err);
      // Don't throw - audit trail failure shouldn't break execution
    }
  }
}
