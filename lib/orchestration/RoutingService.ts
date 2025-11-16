/**
 * RoutingService - Enhanced with Step Complexity Analysis
 *
 * Intelligent model routing combining:
 * - Agent-level AIS (60% weight): Overall agent complexity
 * - Step-level complexity (40% weight): Individual step analysis
 * - Intent-based optimization: Adjust routing based on task type
 *
 * Tier routing:
 * - Fast tier (Haiku/Flash): Combined score < 3.0
 * - Balanced tier (Sonnet): Combined score 3.0-6.5
 * - Powerful tier (Opus/o1): Combined score > 6.5
 *
 * Migrated from PerStepModelRouter (System 2) and TaskComplexityAnalyzer
 * All thresholds configurable via system_settings_config
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  RoutingContext,
  RoutingDecision,
  ModelTier,
  ModelConfig,
  IntentType,
  IRoutingService,
} from './types';

// ============================================================================
// STEP COMPLEXITY ANALYSIS (Migrated from TaskComplexityAnalyzer)
// ============================================================================

/**
 * Step complexity analysis result
 */
export interface StepComplexityAnalysis {
  complexityScore: number; // 0-10
  factors: {
    promptLength: number;
    dataSize: number;
    conditionCount: number;
    contextDepth: number;
    reasoningDepth: number;
    outputComplexity: number;
  };
  rawMeasurements: {
    promptLength: number;      // characters
    dataSize: number;           // bytes
    conditionCount: number;     // count
    contextDepth: number;       // count (variable references)
  };
}

/**
 * Complexity configuration (database-driven)
 */
interface ComplexityConfig {
  weights: Record<string, {
    promptLength: number;
    dataSize: number;
    conditionCount: number;
    contextDepth: number;
    reasoningDepth: number;
    outputComplexity: number;
  }>;
  thresholds: {
    promptLength: { low: number; medium: number; high: number };
    dataSize: { low: number; medium: number; high: number };
    conditionCount: { low: number; medium: number; high: number };
    contextDepth: { low: number; medium: number; high: number };
  };
  routingStrategy: {
    aisWeight: number;
    stepWeight: number;
  };
}

export class RoutingService implements IRoutingService {
  private supabase: SupabaseClient;
  private tierThresholds: { fast: number; balanced: number } | null = null;
  private modelConfigs: Map<string, ModelConfig> = new Map();
  private complexityConfig: ComplexityConfig | null = null;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Load complexity configuration from database
   */
  private async loadComplexityConfig(): Promise<void> {
    if (this.complexityConfig) return; // Already loaded

    try {
      // Fetch complexity config from ais_system_config
      const { data, error } = await this.supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', [
          'pilot_complexity_weights_generate',
          'pilot_complexity_weights_llm_decision',
          'pilot_complexity_weights_transform',
          'pilot_complexity_weights_conditional',
          'pilot_complexity_weights_action',
          'pilot_complexity_weights_default',
          'pilot_complexity_thresholds_prompt_length',
          'pilot_complexity_thresholds_data_size',
          'pilot_complexity_thresholds_condition_count',
          'pilot_complexity_thresholds_context_depth',
        ]);

      if (error) {
        console.warn('[RoutingService] Failed to load complexity config:', error);
        this.setDefaultComplexityConfig();
        return;
      }

      // Parse configuration
      const config: ComplexityConfig = {
        weights: {
          generate: this.getDefaultWeights('generate'),
          llm_decision: this.getDefaultWeights('llm_decision'),
          transform: this.getDefaultWeights('transform'),
          conditional: this.getDefaultWeights('conditional'),
          action: this.getDefaultWeights('action'),
          default: this.getDefaultWeights('default'),
        },
        thresholds: {
          promptLength: { low: 200, medium: 500, high: 1000 },
          dataSize: { low: 1024, medium: 10240, high: 51200 },
          conditionCount: { low: 2, medium: 5, high: 10 },
          contextDepth: { low: 2, medium: 5, high: 10 },
        },
        routingStrategy: {
          aisWeight: 0.6,
          stepWeight: 0.4,
        },
      };

      // Populate from database
      data?.forEach((item) => {
        try {
          const value = JSON.parse(item.config_value);

          if (item.config_key.startsWith('pilot_complexity_weights_')) {
            const type = item.config_key.replace('pilot_complexity_weights_', '');
            config.weights[type] = value;
          } else if (item.config_key.startsWith('pilot_complexity_thresholds_')) {
            const factor = item.config_key.replace('pilot_complexity_thresholds_', '');
            if (factor === 'prompt_length') config.thresholds.promptLength = value;
            else if (factor === 'data_size') config.thresholds.dataSize = value;
            else if (factor === 'condition_count') config.thresholds.conditionCount = value;
            else if (factor === 'context_depth') config.thresholds.contextDepth = value;
          }
        } catch (parseError) {
          console.warn(`[RoutingService] Failed to parse ${item.config_key}:`, parseError);
        }
      });

      // Load routing strategy weights from system_settings_config
      const { data: strategyData } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .eq('key', 'orchestration_routing_strategy_balanced');

      if (strategyData && strategyData.length > 0) {
        try {
          const strategyWeights = JSON.parse(strategyData[0].value);
          config.routingStrategy = {
            aisWeight: strategyWeights.aisWeight || 0.6,
            stepWeight: strategyWeights.stepWeight || 0.4,
          };
        } catch (parseError) {
          console.warn('[RoutingService] Failed to parse routing strategy:', parseError);
        }
      }

      this.complexityConfig = config;
      console.log('[RoutingService] Complexity configuration loaded from database');
    } catch (err) {
      console.error('[RoutingService] Exception loading complexity config:', err);
      this.setDefaultComplexityConfig();
    }
  }

  /**
   * Set default complexity configuration (fallback)
   */
  private setDefaultComplexityConfig(): void {
    this.complexityConfig = {
      weights: {
        generate: this.getDefaultWeights('generate'),
        llm_decision: this.getDefaultWeights('llm_decision'),
        transform: this.getDefaultWeights('transform'),
        conditional: this.getDefaultWeights('conditional'),
        action: this.getDefaultWeights('action'),
        default: this.getDefaultWeights('default'),
      },
      thresholds: {
        promptLength: { low: 200, medium: 500, high: 1000 },
        dataSize: { low: 1024, medium: 10240, high: 51200 },
        conditionCount: { low: 2, medium: 5, high: 10 },
        contextDepth: { low: 2, medium: 5, high: 10 },
      },
      routingStrategy: {
        aisWeight: 0.6,
        stepWeight: 0.4,
      },
    };
    console.log('[RoutingService] Using default complexity configuration');
  }

  /**
   * Get default weights for a step type
   */
  private getDefaultWeights(type: string): {
    promptLength: number;
    dataSize: number;
    conditionCount: number;
    contextDepth: number;
    reasoningDepth: number;
    outputComplexity: number;
  } {
    const defaults: Record<string, any> = {
      generate: { promptLength: 0.15, dataSize: 0.1, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.3, outputComplexity: 0.15 },
      llm_decision: { promptLength: 0.15, dataSize: 0.1, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.3, outputComplexity: 0.15 },
      transform: { promptLength: 0.15, dataSize: 0.3, conditionCount: 0.1, contextDepth: 0.15, reasoningDepth: 0.15, outputComplexity: 0.15 },
      conditional: { promptLength: 0.15, dataSize: 0.1, conditionCount: 0.3, contextDepth: 0.15, reasoningDepth: 0.2, outputComplexity: 0.1 },
      action: { promptLength: 0.2, dataSize: 0.15, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.2, outputComplexity: 0.15 },
      default: { promptLength: 0.2, dataSize: 0.15, conditionCount: 0.15, contextDepth: 0.15, reasoningDepth: 0.2, outputComplexity: 0.15 },
    };

    return defaults[type] || defaults.default;
  }

  // ============================================================================
  // STEP COMPLEXITY ANALYSIS METHODS
  // ============================================================================

  /**
   * Analyze step complexity
   * Migrated from TaskComplexityAnalyzer - Database-driven
   */
  async analyzeStepComplexity(step: any, context?: any): Promise<StepComplexityAnalysis> {
    // Load config if not already loaded
    await this.loadComplexityConfig();

    // Measure raw factors
    const promptLength = this.measurePromptLength(step);
    const dataSize = this.measureDataSize(step, context);
    const conditionCount = this.measureConditionCount(step);
    const contextDepth = this.measureContextDepth(step);

    // Estimate reasoning and output complexity
    const reasoningDepth = this.estimateReasoningDepth(step);
    const outputComplexity = this.estimateOutputComplexity(step);

    // Score each factor (0-10) using database thresholds
    const factors = {
      promptLength: this.scorePromptLength(promptLength),
      dataSize: this.scoreDataSize(dataSize),
      conditionCount: this.scoreConditionCount(conditionCount),
      contextDepth: this.scoreContextDepth(contextDepth),
      reasoningDepth,
      outputComplexity,
    };

    // Get weights for step type (intent) from database
    const weights = this.getComplexityWeights(step.type || step.intent);

    // Calculate weighted complexity score
    const complexityScore = Math.min(
      10,
      Math.max(
        0,
        factors.promptLength * weights.promptLength +
          factors.dataSize * weights.dataSize +
          factors.conditionCount * weights.conditionCount +
          factors.contextDepth * weights.contextDepth +
          factors.reasoningDepth * weights.reasoningDepth +
          factors.outputComplexity * weights.outputComplexity
      )
    );

    return {
      complexityScore,
      factors,
      rawMeasurements: {
        promptLength,
        dataSize,
        conditionCount,
        contextDepth,
      },
    };
  }

  /**
   * Measure prompt length (characters)
   */
  private measurePromptLength(step: any): number {
    let length = 0;
    if (step.name) length += step.name.length;
    if (step.description) length += step.description.length;
    if (step.prompt) length += step.prompt.length;
    if (step.params) length += JSON.stringify(step.params).length;
    return length;
  }

  /**
   * Measure data size (bytes)
   */
  private measureDataSize(step: any, context?: any): number {
    let size = 0;
    if (step.params) {
      size += Buffer.byteLength(JSON.stringify(step.params), 'utf8');
    }
    if (step.input && context) {
      // Estimate based on context variables
      size += Buffer.byteLength(JSON.stringify(context.variables || {}), 'utf8');
    }
    return size;
  }

  /**
   * Count conditional branches
   */
  private measureConditionCount(step: any): number {
    let count = 0;
    if (step.type === 'conditional' && step.condition) {
      count += this.countConditions(step.condition);
    }
    if (step.executeIf) {
      count += this.countConditions(step.executeIf);
    }
    if (step.type === 'switch' && step.cases) {
      count += Object.keys(step.cases).length;
    }
    return count;
  }

  /**
   * Count conditions recursively
   */
  private countConditions(condition: any): number {
    if (typeof condition === 'string') return 1;
    if (!condition || typeof condition !== 'object') return 0;

    let count = 0;
    if (condition.and) {
      count += condition.and.length;
      condition.and.forEach((c: any) => (count += this.countConditions(c)));
    }
    if (condition.or) {
      count += condition.or.length;
      condition.or.forEach((c: any) => (count += this.countConditions(c)));
    }
    if (condition.not) {
      count += 1 + this.countConditions(condition.not);
    }
    if (condition.field && condition.operator) {
      count += 1;
    }
    return count;
  }

  /**
   * Measure context depth (variable references)
   */
  private measureContextDepth(step: any): number {
    const stepJson = JSON.stringify(step);
    const matches = stepJson.match(/\{\{[^}]+\}\}/g);
    return matches ? matches.length : 0;
  }

  /**
   * Estimate reasoning depth (0-10)
   */
  private estimateReasoningDepth(step: any): number {
    const type = step.type || step.intent;
    if (type === 'generate' || type === 'llm_decision' || type === 'ai_processing') return 8;
    if (type === 'conditional' || type === 'switch' || type === 'validate') return 6;
    if (type === 'transform' || type === 'summarize') return 4;
    if (type === 'extract' || type === 'filter') return 3;
    if (type === 'action' || type === 'send') return 2;
    return 3;
  }

  /**
   * Estimate output complexity (0-10)
   */
  private estimateOutputComplexity(step: any): number {
    const type = step.type || step.intent;
    if (type === 'generate' || type === 'llm_decision') return 7;
    if (type === 'transform' && step.config) {
      const config = step.config;
      if (config.aggregations && config.aggregations.length > 3) return 8;
      if (config.mapping && Object.keys(config.mapping).length > 5) return 7;
      return 5;
    }
    if (type === 'enrich' || type === 'validate' || type === 'aggregate') return 6;
    if (type === 'extract' || type === 'summarize') return 5;
    if (type === 'action' || type === 'send') return 3;
    return 4;
  }

  /**
   * Score prompt length based on database thresholds
   */
  private scorePromptLength(length: number): number {
    const t = this.complexityConfig!.thresholds.promptLength;
    if (length < t.low) return 2;
    if (length < t.medium) return 5;
    if (length < t.high) return 7;
    return 9;
  }

  /**
   * Score data size based on database thresholds
   */
  private scoreDataSize(size: number): number {
    const t = this.complexityConfig!.thresholds.dataSize;
    if (size < t.low) return 2;
    if (size < t.medium) return 5;
    if (size < t.high) return 7;
    return 9;
  }

  /**
   * Score condition count based on database thresholds
   */
  private scoreConditionCount(count: number): number {
    const t = this.complexityConfig!.thresholds.conditionCount;
    if (count < t.low) return 2;
    if (count < t.medium) return 5;
    if (count < t.high) return 7;
    return 9;
  }

  /**
   * Score context depth based on database thresholds
   */
  private scoreContextDepth(depth: number): number {
    const t = this.complexityConfig!.thresholds.contextDepth;
    if (depth < t.low) return 2;
    if (depth < t.medium) return 5;
    if (depth < t.high) return 7;
    return 9;
  }

  /**
   * Get complexity weights for step type/intent from database
   */
  private getComplexityWeights(type: string): {
    promptLength: number;
    dataSize: number;
    conditionCount: number;
    contextDepth: number;
    reasoningDepth: number;
    outputComplexity: number;
  } {
    // Normalize type name for database lookup
    const normalizedType = type?.toLowerCase().replace(/_/g, '_') || 'default';

    // Check database config first
    if (this.complexityConfig!.weights[normalizedType]) {
      return this.complexityConfig!.weights[normalizedType];
    }

    // Fallback to default weights
    return this.complexityConfig!.weights.default;
  }

  // ============================================================================
  // ENHANCED ROUTING METHODS
  // ============================================================================

  /**
   * Route to appropriate model based on context
   * Enhanced: Combines agent AIS (60%) + step complexity (40%)
   */
  async route(context: RoutingContext, step?: any, executionContext?: any): Promise<RoutingDecision> {
    try {
      // Load complexity config if needed
      await this.loadComplexityConfig();

      let effectiveComplexity: number;
      let stepComplexityScore: number | undefined;

      // Calculate effective complexity
      if (step && this.complexityConfig) {
        // Analyze step complexity
        const stepAnalysis = await this.analyzeStepComplexity(step, executionContext);
        stepComplexityScore = stepAnalysis.complexityScore;

        // Get agent AIS
        const agentAIS = context.agentAIS?.combined_score || 5.0;

        // Combine using database-driven weights
        const weights = this.complexityConfig.routingStrategy;
        effectiveComplexity = (agentAIS * weights.aisWeight) + (stepComplexityScore * weights.stepWeight);

        console.log(
          `[Routing] Effective complexity: ${effectiveComplexity.toFixed(2)} ` +
          `(Agent AIS: ${agentAIS.toFixed(2)} [${(weights.aisWeight * 100).toFixed(0)}%], ` +
          `Step: ${stepComplexityScore.toFixed(2)} [${(weights.stepWeight * 100).toFixed(0)}%])`
        );
      } else {
        // Fallback to agent AIS only
        effectiveComplexity = context.agentAIS?.combined_score || 5.0;
        console.log(`[Routing] Using agent AIS only: ${effectiveComplexity.toFixed(2)}`);
      }

      // Determine tier based on effective complexity
      const tier = await this.getTierFromAIS(effectiveComplexity);

      // Get model configuration for tier and intent
      const modelConfig = await this.getModelConfig(tier, context.intent);

      // Calculate estimated cost and latency
      const estimatedCost = this.estimateCost(modelConfig, context.budgetRemaining);
      const estimatedLatency = this.estimateLatency(modelConfig, context);

      // Build routing decision
      const decision: RoutingDecision = {
        tier,
        model: modelConfig.model,
        provider: modelConfig.provider,
        reason: this.buildRoutingReason(tier, context, effectiveComplexity, stepComplexityScore),
        estimatedCost,
        estimatedLatency,
        agentAIS: context.agentAIS,
      };

      console.log(
        `✅ [Routing] SELECTED MODEL FOR ${context.intent.toUpperCase()} INTENT:`,
        `\n   📊 Tier: ${decision.tier}`,
        `\n   🤖 Model: ${decision.model}`,
        `\n   🏢 Provider: ${decision.provider}`,
        `\n   💡 Reason: ${decision.reason}`,
        `\n   📈 Effective Complexity: ${effectiveComplexity.toFixed(2)}/10`,
        `\n   💰 Estimated Cost: $${estimatedCost.toFixed(6)}`,
        `\n   ⏱️  Estimated Latency: ${estimatedLatency}ms`
      );

      return decision;
    } catch (error) {
      console.error('[Routing] Error during routing:', error);
      // Fallback to balanced tier on error
      return this.getDefaultDecision(context);
    }
  }

  /**
   * Get model configuration for tier and intent
   */
  async getModelConfig(tier: ModelTier, intent: IntentType): Promise<ModelConfig> {
    const cacheKey = `${tier}_${intent}`;

    // Check cache
    const cached = this.modelConfigs.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Load model configuration from database
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          `orchestration_routing_model_${tier}`,
          `orchestration_routing_provider_${tier}`,
          `orchestration_routing_max_tokens_${tier}`,
          `orchestration_routing_temperature_${tier}`,
          `orchestration_routing_cost_per_token_${tier}`,
        ]);

      if (error || !data) {
        console.warn('[Routing] Failed to load model config, using defaults');
        return this.getDefaultModelConfig(tier, intent);
      }

      // Parse configuration
      const config: Record<string, any> = {};
      data.forEach((item) => {
        config[item.key] = item.value;
      });

      const modelConfig: ModelConfig = {
        tier,
        provider: config[`orchestration_routing_provider_${tier}`] || this.getDefaultProvider(tier),
        model: config[`orchestration_routing_model_${tier}`] || this.getDefaultModel(tier),
        maxTokens: parseInt(config[`orchestration_routing_max_tokens_${tier}`] || this.getDefaultMaxTokens(tier)),
        temperature: parseFloat(config[`orchestration_routing_temperature_${tier}`] || '0.7'),
        costPerToken: parseFloat(config[`orchestration_routing_cost_per_token_${tier}`] || this.getDefaultCostPerToken(tier)),
        avgLatencyMs: this.getDefaultLatency(tier),
        supportedIntents: this.getSupportedIntents(tier),
      };

      // Cache configuration
      this.modelConfigs.set(cacheKey, modelConfig);

      return modelConfig;
    } catch (error) {
      console.error('[Routing] Error loading model config:', error);
      return this.getDefaultModelConfig(tier, intent);
    }
  }

  /**
   * Determine tier from agent-level AIS combined_score
   * Thresholds configurable via database
   */
  async getTierFromAIS(combined_score: number): Promise<ModelTier> {
    // Load tier thresholds if not cached
    if (!this.tierThresholds) {
      await this.loadTierThresholds();
    }

    const thresholds = this.tierThresholds || { fast: 3.0, balanced: 6.5 };

    if (combined_score < thresholds.fast) {
      return 'fast';
    } else if (combined_score < thresholds.balanced) {
      return 'balanced';
    } else {
      return 'powerful';
    }
  }

  /**
   * Load tier thresholds from database
   */
  private async loadTierThresholds(): Promise<void> {
    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'orchestration_routing_fast_tier_max_score',
          'orchestration_routing_balanced_tier_max_score',
        ]);

      if (error || !data) {
        console.warn('[Routing] Failed to load tier thresholds, using defaults');
        this.tierThresholds = { fast: 3.0, balanced: 6.5 };
        return;
      }

      const config: Record<string, any> = {};
      data.forEach((item) => {
        config[item.key] = item.value;
      });

      this.tierThresholds = {
        fast: parseFloat(config['orchestration_routing_fast_tier_max_score'] || '3.0'),
        balanced: parseFloat(config['orchestration_routing_balanced_tier_max_score'] || '6.5'),
      };

      console.log('[Routing] Tier thresholds loaded:', this.tierThresholds);
    } catch (error) {
      console.error('[Routing] Error loading tier thresholds:', error);
      this.tierThresholds = { fast: 3.0, balanced: 6.5 };
    }
  }

  /**
   * Estimate cost based on model and budget
   */
  private estimateCost(modelConfig: ModelConfig, budgetRemaining: number): number {
    // Estimate based on typical usage patterns
    // Assume we'll use ~70% of remaining budget
    const estimatedTokens = budgetRemaining * 0.7;
    return estimatedTokens * modelConfig.costPerToken;
  }

  /**
   * Estimate latency based on model and context
   */
  private estimateLatency(modelConfig: ModelConfig, context: RoutingContext): number {
    // Base latency from model config
    let latency = modelConfig.avgLatencyMs;

    // Adjust for budget size (more tokens = more time)
    const tokensMultiplier = Math.log10(context.budgetRemaining) / 3;
    latency *= Math.max(0.5, Math.min(2.0, tokensMultiplier));

    // Adjust for previous failures (retry penalty)
    if (context.previousFailures > 0) {
      latency *= (1 + context.previousFailures * 0.1);
    }

    return Math.round(latency);
  }

  /**
   * Build human-readable routing reason
   */
  private buildRoutingReason(
    tier: ModelTier,
    context: RoutingContext,
    effectiveComplexity?: number,
    stepComplexity?: number
  ): string {
    const agentScore = context.agentAIS?.combined_score?.toFixed(2) || 'N/A';
    const reasons: string[] = [];

    // Include both agent and step complexity if available
    if (stepComplexity !== undefined && effectiveComplexity !== undefined) {
      reasons.push(
        `Agent: ${agentScore}, Step: ${stepComplexity.toFixed(1)}, ` +
        `Effective: ${effectiveComplexity.toFixed(1)}`
      );
    } else if (context.agentAIS) {
      reasons.push(`Agent complexity: ${agentScore}`);
    }

    // Tier explanation
    if (tier === 'fast') {
      reasons.push('Low complexity → Fast tier (cost-effective)');
    } else if (tier === 'balanced') {
      reasons.push('Medium complexity → Balanced tier (optimal)');
    } else {
      reasons.push('High complexity → Powerful tier (max quality)');
    }

    if (context.previousFailures > 0) {
      reasons.push(`Previous failures: ${context.previousFailures} (escalated)`);
    }

    if (context.userTier) {
      reasons.push(`User tier: ${context.userTier}`);
    }

    return reasons.join('; ');
  }

  /**
   * Get default routing decision (fallback)
   */
  private getDefaultDecision(context: RoutingContext): RoutingDecision {
    return {
      tier: 'balanced',
      model: 'gpt-4o-mini',  // ✅ Changed from suspended Kimi to OpenAI
      provider: 'openai',  // ✅ Changed from Kimi to OpenAI
      reason: 'Default routing (error fallback)',
      estimatedCost: 0,
      estimatedLatency: 2000,
      agentAIS: context.agentAIS,
    };
  }

  /**
   * Get default model config for tier
   */
  private getDefaultModelConfig(tier: ModelTier, intent: IntentType): ModelConfig {
    const defaults: Record<ModelTier, Partial<ModelConfig>> = {
      fast: {
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        maxTokens: 2048,
        temperature: 0.7,
        costPerToken: 0.00000025, // $0.25 per 1M tokens
        avgLatencyMs: 800,
      },
      balanced: {
        provider: 'anthropic',  // ✅ Using Anthropic for Claude Haiku
        model: 'claude-3-haiku-20240307',  // ✅ Claude Haiku for balanced tier
        maxTokens: 4096,
        temperature: 0.7,
        costPerToken: 0.00000025, // $0.25 per 1M tokens (Claude Haiku pricing)
        avgLatencyMs: 800,  // Haiku is faster than gpt-4o-mini
      },
      powerful: {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        maxTokens: 8192,
        temperature: 0.7,
        costPerToken: 0.000003, // $3 per 1M tokens
        avgLatencyMs: 5000,
      },
    };

    return {
      tier,
      provider: defaults[tier].provider || 'openai',
      model: defaults[tier].model || 'gpt-4o-mini',
      maxTokens: defaults[tier].maxTokens || 4096,
      temperature: defaults[tier].temperature || 0.7,
      costPerToken: defaults[tier].costPerToken || 0.0000015,
      avgLatencyMs: defaults[tier].avgLatencyMs || 2000,
      supportedIntents: this.getSupportedIntents(tier),
    };
  }

  /**
   * Get default provider for tier
   */
  private getDefaultProvider(tier: ModelTier): string {
    const providers: Record<ModelTier, string> = {
      fast: 'anthropic',
      balanced: 'anthropic',  // ✅ Using Anthropic for Claude Haiku
      powerful: 'anthropic',
    };
    return providers[tier];
  }

  /**
   * Get default model for tier
   */
  private getDefaultModel(tier: ModelTier): string {
    const models: Record<ModelTier, string> = {
      fast: 'claude-3-haiku-20240307',
      balanced: 'claude-3-haiku-20240307',  // ✅ Claude Haiku for balanced tier
      powerful: 'claude-3-5-sonnet-20241022',
    };
    return models[tier];
  }

  /**
   * Get default max tokens for tier
   */
  private getDefaultMaxTokens(tier: ModelTier): string {
    const tokens: Record<ModelTier, string> = {
      fast: '2048',
      balanced: '4096',
      powerful: '8192',
    };
    return tokens[tier];
  }

  /**
   * Get default cost per token for tier
   */
  private getDefaultCostPerToken(tier: ModelTier): string {
    const costs: Record<ModelTier, string> = {
      fast: '0.00000025',
      balanced: '0.00000025',  // Claude Haiku pricing
      powerful: '0.000003',
    };
    return costs[tier];
  }

  /**
   * Get default latency for tier
   */
  private getDefaultLatency(tier: ModelTier): number {
    const latencies: Record<ModelTier, number> = {
      fast: 800,
      balanced: 800,  // Haiku latency
      powerful: 5000,
    };
    return latencies[tier];
  }

  /**
   * Get supported intents for tier
   */
  private getSupportedIntents(tier: ModelTier): IntentType[] {
    // All models support all intents, but with different quality levels
    return [
      'extract',
      'summarize',
      'generate',
      'validate',
      'send',
      'transform',
      'conditional',
      'aggregate',
      'filter',
      'enrich',
    ];
  }

  /**
   * Clear cache (for testing or config reload)
   */
  clearCache(): void {
    this.modelConfigs.clear();
    this.tierThresholds = null;
  }

  /**
   * Reload configuration from database
   */
  async reloadConfig(): Promise<void> {
    this.clearCache();
    await this.loadTierThresholds();
  }

  /**
   * Get tier thresholds for monitoring/debugging
   */
  getTierThresholds(): { fast: number; balanced: number } {
    return this.tierThresholds || { fast: 3.0, balanced: 6.5 };
  }

  // ============================================================================
  // PER-STEP ROUTING TRACKING (Phase: AIS Enhancement)
  // ============================================================================

  /**
   * Map 6-factor complexity to 4 AIS dimensions
   * Provides consistency between step-level and agent-level scoring
   */
  private mapComplexityToAIS(analysis: StepComplexityAnalysis): {
    token_complexity: number;
    execution_complexity: number;
    workflow_complexity: number;
    memory_complexity: number;
  } {
    return {
      // Token complexity: Average of prompt length and data size
      token_complexity: (analysis.factors.promptLength + analysis.factors.dataSize) / 2,

      // Execution complexity: Average of reasoning depth and output complexity
      execution_complexity: (analysis.factors.reasoningDepth + analysis.factors.outputComplexity) / 2,

      // Workflow complexity: Condition count directly maps
      workflow_complexity: analysis.factors.conditionCount,

      // Memory complexity: Context depth directly maps
      memory_complexity: analysis.factors.contextDepth,
    };
  }

  /**
   * Log step routing decision to database
   * Stores routing intelligence in workflow_step_executions table
   */
  async logStepRouting(
    workflowExecutionId: string,
    stepId: string,
    stepName: string,
    stepType: string,
    stepIndex: number,
    stepAnalysis: StepComplexityAnalysis,
    agentAIS: number,
    effectiveComplexity: number,
    decision: RoutingDecision
  ): Promise<void> {
    try {
      // Check if tracking is enabled
      const { data: configData } = await this.supabase
        .from('system_settings_config')
        .select('value')
        .eq('key', 'orchestration_per_step_tracking_enabled')
        .single();

      const trackingEnabled = configData?.value ?? true;
      if (!trackingEnabled) {
        console.log('[RoutingService] Per-step tracking disabled, skipping log');
        return;
      }

      // Map complexity to AIS dimensions
      const aisDimensions = this.mapComplexityToAIS(stepAnalysis);

      // Update workflow_step_executions with routing data
      // RLS policies now allow anon role to UPDATE workflow_step_executions
      const { error } = await this.supabase
        .from('workflow_step_executions')
        .update({
          // 6-factor complexity scores
          complexity_score: stepAnalysis.complexityScore,
          prompt_length_score: stepAnalysis.factors.promptLength,
          data_size_score: stepAnalysis.factors.dataSize,
          condition_count_score: stepAnalysis.factors.conditionCount,
          context_depth_score: stepAnalysis.factors.contextDepth,
          reasoning_depth_score: stepAnalysis.factors.reasoningDepth,
          output_complexity_score: stepAnalysis.factors.outputComplexity,

          // AIS-mapped dimensions (for consistency)
          ais_token_complexity: aisDimensions.token_complexity,
          ais_execution_complexity: aisDimensions.execution_complexity,
          ais_workflow_complexity: aisDimensions.workflow_complexity,
          ais_memory_complexity: aisDimensions.memory_complexity,

          // Routing decision
          agent_ais_score: agentAIS,
          effective_complexity: effectiveComplexity,
          selected_tier: decision.tier,
          selected_model: decision.model,
          selected_provider: decision.provider,
          routing_reason: decision.reason,
          estimated_cost_usd: decision.estimatedCost,
          estimated_latency_ms: decision.estimatedLatency,

          // Raw measurements (for debugging)
          raw_prompt_length: stepAnalysis.rawMeasurements.promptLength,
          raw_data_size: stepAnalysis.rawMeasurements.dataSize,
          raw_condition_count: stepAnalysis.rawMeasurements.conditionCount,
          raw_context_depth: stepAnalysis.rawMeasurements.contextDepth,

          // Timestamp
          routed_at: new Date().toISOString(),
        })
        .eq('workflow_execution_id', workflowExecutionId)
        .eq('step_id', stepId);

      if (error) {
        console.error('[RoutingService] Failed to log step routing:', error);
        // Don't throw - routing logging failures should not stop execution
      } else {
        console.log(
          `✅ [RoutingService] Logged routing for step ${stepId}: ` +
          `complexity=${stepAnalysis.complexityScore.toFixed(1)}, ` +
          `tier=${decision.tier}, model=${decision.model}`
        );
      }
    } catch (err) {
      console.error('[RoutingService] Step routing logging error:', err);
      // Don't throw - non-critical failure
    }
  }

  /**
   * Update step routing metrics with actual execution results
   * Call this after step execution completes
   */
  async updateStepRoutingMetrics(
    workflowExecutionId: string,
    stepId: string,
    actualTokensUsed: number,
    actualExecutionTime: number,
    actualCost: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Note: tokens_used, execution_time, success, error_message
      // are already updated by StateManager.updateStepExecution()
      // This method is here for future enhancements if needed

      // For now, we'll just log confirmation
      console.log(
        `✅ [RoutingService] Step ${stepId} execution metrics: ` +
        `tokens=${actualTokensUsed}, time=${actualExecutionTime}ms, ` +
        `cost=$${actualCost.toFixed(6)}, success=${success}`
      );

      // Future: Could add comparison logic here (predicted vs actual)
      // Future: Could update routing memory / ML model with outcome
    } catch (err) {
      console.error('[RoutingService] Step metrics update error:', err);
      // Don't throw - non-critical
    }
  }
}

/**
 * Singleton instance for convenient access
 * @deprecated Use instance-based approach with proper Supabase client
 * This singleton will fail on server-side because it requires a Supabase client
 * Usage: Create instance via OrchestrationService.getRoutingService()
 */
// export const routingService = new RoutingService(); // Disabled - requires Supabase client
