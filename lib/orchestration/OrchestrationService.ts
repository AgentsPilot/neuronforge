/**
 * OrchestrationService
 *
 * Main orchestration service that coordinates:
 * - Intent classification
 * - Token budget management
 * - Compression (Phase 2)
 * - AIS-based routing (Phase 2)
 *
 * Integrates with WorkflowPilot via feature flag
 */

import { supabase as defaultSupabase } from '@/lib/supabaseClient';
import type { SupabaseClient } from '@supabase/supabase-js';
import { IntentClassifier } from './IntentClassifier';
import { TokenBudgetManager } from './TokenBudgetManager';
import { CompressionService } from './CompressionService';
import { RoutingService } from './RoutingService';
import type {
  IntentClassification,
  TokenBudget,
  OrchestrationMetadata,
  StepMetadata,
  OrchestrationMetrics,
  RoutingContext,
  CompressionPolicy,
} from './types';
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';

export class OrchestrationService {
  private supabase: SupabaseClient;
  private intentClassifier: IntentClassifier;
  private budgetManager: TokenBudgetManager;
  private compressionService: CompressionService;
  private routingService: RoutingService;
  private enabled: boolean | null = null;
  private compressionEnabled: boolean | null = null;
  private routingEnabled: boolean | null = null;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.intentClassifier = new IntentClassifier(this.supabase);
    this.budgetManager = new TokenBudgetManager(this.supabase);
    this.compressionService = new CompressionService(this.supabase);
    this.routingService = new RoutingService(this.supabase);
  }

  /**
   * Check if orchestration is enabled via feature flag
   */
  async isEnabled(): Promise<boolean> {
    // Cache the flag to avoid repeated DB queries
    if (this.enabled !== null) {
      return this.enabled;
    }

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('value')
        .eq('key', 'orchestration_enabled')
        .single();

      if (error || !data) {
        console.warn('[Orchestration] Feature flag not found, defaulting to disabled');
        this.enabled = false;
        return false;
      }

      this.enabled = data.value === true;
      console.log(`[Orchestration] Feature flag: ${this.enabled ? 'ENABLED' : 'DISABLED'}`);
      return this.enabled;
    } catch (error) {
      console.error('[Orchestration] Error checking feature flag:', error);
      this.enabled = false;
      return false;
    }
  }

  /**
   * Check if compression is enabled
   */
  async isCompressionEnabled(): Promise<boolean> {
    if (this.compressionEnabled !== null) {
      return this.compressionEnabled;
    }

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('value')
        .eq('key', 'orchestration_compression_enabled')
        .single();

      this.compressionEnabled = data?.value === true || false;
      return this.compressionEnabled;
    } catch (error) {
      console.error('[Orchestration] Error checking compression flag:', error);
      this.compressionEnabled = false;
      return false;
    }
  }

  /**
   * Check if AIS routing is enabled
   */
  async isRoutingEnabled(): Promise<boolean> {
    if (this.routingEnabled !== null) {
      return this.routingEnabled;
    }

    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('value')
        .eq('key', 'orchestration_ais_routing_enabled')
        .single();

      this.routingEnabled = data?.value === true || false;
      return this.routingEnabled;
    } catch (error) {
      console.error('[Orchestration] Error checking routing flag:', error);
      this.routingEnabled = false;
      return false;
    }
  }

  /**
   * Initialize orchestration for a workflow execution
   * Returns null if orchestration is disabled
   */
  async initialize(
    workflowId: string,
    agentId: string,
    userId: string,
    steps: any[]
  ): Promise<OrchestrationMetadata | null> {
    const startTime = Date.now();

    // Check if orchestration is enabled
    const enabled = await this.isEnabled();
    if (!enabled) {
      console.log('[Orchestration] Skipping initialization - feature disabled');
      return null;
    }

    console.log(`[Orchestration] Initializing for workflow ${workflowId} with ${steps.length} steps`);

    try {
      // Get agent AIS scores for routing and budget scaling
      const agentAIS = await this.getAgentAIS(agentId);

      // Classify all steps by intent
      console.log('[Orchestration] Classifying step intents...');
      const intentClassificationStart = Date.now();
      const intents = await this.intentClassifier.classifyBatch(steps);
      const intentClassificationTime = Date.now() - intentClassificationStart;

      console.log(`[Orchestration] Intent classification complete in ${intentClassificationTime}ms`);
      console.log('[Orchestration] Intent distribution:', this.intentClassifier.getIntentDistribution(intents));

      // Allocate token budgets
      console.log('[Orchestration] Allocating token budgets...');
      const budgetAllocationStart = Date.now();
      const workflow = { workflow_steps: steps };
      const budgets = await this.budgetManager.allocateBudget(workflow, intents, agentAIS);
      const budgetAllocationTime = Date.now() - budgetAllocationStart;

      console.log(`[Orchestration] Budget allocation complete in ${budgetAllocationTime}ms`);

      // Log budget summary
      const summary = this.budgetManager.getTotalBudgetSummary();
      console.log('[Orchestration] Budget summary:', {
        totalAllocated: summary.totalAllocated,
        avgPerStep: Math.round(summary.totalAllocated / steps.length)
      });

      // Check Phase 2 feature flags
      const compressionEnabled = await this.isCompressionEnabled();
      const routingEnabled = await this.isRoutingEnabled();

      console.log(`[Orchestration] Phase 2 features - Compression: ${compressionEnabled ? 'ENABLED' : 'DISABLED'}, Routing: ${routingEnabled ? 'ENABLED' : 'DISABLED'}`);

      // Create step metadata with Phase 2 integration
      const stepMetadata: StepMetadata[] = await Promise.all(
        steps.map(async (step, index) => {
          const stepId = step.id || step.step_id || `step_${index}`;
          const budget = budgets.get(stepId);
          const intent = intents[index].intent;

          // Get compression policy for this intent
          const compressionPolicy: CompressionPolicy = compressionEnabled
            ? await this.compressionService.getPolicy(intent)
            : {
                enabled: false,
                strategy: 'none',
                targetRatio: 1.0,
                minQualityScore: 1.0,
                aggressiveness: 'low',
              };

          // Get routing decision based on AIS score
          const routingDecision = routingEnabled && agentAIS
            ? await this.routingService.route({
                agentId,
                intent,
                budgetRemaining: budget!.remaining,
                previousFailures: 0,
                agentAIS,
              })
            : {
                tier: 'balanced' as const,
                model: 'gpt-4o-mini',
                provider: 'openai',
                reason: 'Default routing (AIS routing disabled)',
                estimatedCost: 0,
                estimatedLatency: 0,
                agentAIS,
              };

          return {
            stepId,
            intent,
            classification: intents[index],
            budget: budget!,
            compressionPolicy,
            routingDecision,
            startTime: new Date(),
          };
        })
      );

      // Create orchestration metadata
      const metadata: OrchestrationMetadata = {
        executionId: crypto.randomUUID(),
        workflowId,
        agentId,
        userId,
        startTime: new Date(),
        totalBudget: {
          allocated: summary.totalAllocated,
          used: 0,
          remaining: summary.totalAllocated,
          compressed: 0,
          overageAllowed: true
        },
        budgetStrategy: 'proportional',
        featureFlags: {
          orchestrationEnabled: true,
          compressionEnabled,
          aisRoutingEnabled: routingEnabled,
          adaptiveBudgetEnabled: false // Phase 3+
        },
        steps: stepMetadata,
        globalMetrics: {
          performance: {
            totalExecutionTime: 0,
            orchestrationOverhead: Date.now() - startTime,
            intentClassificationTime,
            compressionTime: 0,
            routingDecisionTime: 0,
            avgStepLatency: 0,
            stepsCompleted: 0,
            stepsFailed: 0
          },
          cost: {
            totalTokensUsed: 0,
            totalTokensSaved: 0,
            totalCost: 0,
            costSavings: 0,
            avgCostPerStep: 0,
            budgetUtilization: 0
          },
          quality: {
            avgQualityScore: 0,
            minQualityScore: 1.0,
            compressionQualityImpact: 0,
            successRate: 0,
            retryRate: 0
          },
          timestamp: new Date()
        },
        agentAIS
      };

      const totalOverhead = Date.now() - startTime;
      console.log(`[Orchestration] Initialization complete in ${totalOverhead}ms (overhead < 50ms target: ${totalOverhead < 50 ? '✅' : '⚠️'})`);

      return metadata;
    } catch (error) {
      console.error('[Orchestration] Initialization error:', error);
      // Return null to fall back to non-orchestrated execution
      return null;
    }
  }

  /**
   * Track step execution for budget and metrics
   */
  async trackStepExecution(
    metadata: OrchestrationMetadata,
    stepId: string,
    tokensUsed: number,
    success: boolean
  ): Promise<void> {
    try {
      // Update budget tracking
      await this.budgetManager.trackUsage(stepId, tokensUsed);

      // Update step metadata
      const stepMeta = metadata.steps.find(s => s.stepId === stepId);
      if (stepMeta) {
        stepMeta.endTime = new Date();
      }

      // Update global metrics
      metadata.globalMetrics.cost.totalTokensUsed += tokensUsed;
      if (success) {
        metadata.globalMetrics.performance.stepsCompleted++;
      } else {
        metadata.globalMetrics.performance.stepsFailed++;
      }
    } catch (error) {
      console.error('[Orchestration] Error tracking step execution:', error);
      // Don't throw - execution should continue even if tracking fails
    }
  }

  /**
   * Complete orchestration and generate final metrics
   */
  async complete(metadata: OrchestrationMetadata): Promise<OrchestrationMetrics> {
    metadata.endTime = new Date();

    const summary = this.budgetManager.getTotalBudgetSummary();

    // Calculate final metrics
    const totalTime = metadata.endTime.getTime() - metadata.startTime.getTime();
    const stepCount = metadata.steps.length;

    metadata.globalMetrics.performance.totalExecutionTime = totalTime;
    metadata.globalMetrics.performance.avgStepLatency =
      stepCount > 0 ? totalTime / stepCount : 0;

    metadata.globalMetrics.cost.budgetUtilization = summary.utilizationRate;
    metadata.globalMetrics.cost.totalTokensSaved = summary.totalCompressed;
    metadata.globalMetrics.cost.avgCostPerStep =
      stepCount > 0 ? metadata.globalMetrics.cost.totalCost / stepCount : 0;

    const completedSteps = metadata.globalMetrics.performance.stepsCompleted;
    metadata.globalMetrics.quality.successRate =
      stepCount > 0 ? completedSteps / stepCount : 0;

    console.log('[Orchestration] Execution complete:', {
      totalTime: `${totalTime}ms`,
      stepsCompleted: completedSteps,
      stepsFailed: metadata.globalMetrics.performance.stepsFailed,
      tokensUsed: metadata.globalMetrics.cost.totalTokensUsed,
      tokensSaved: metadata.globalMetrics.cost.totalTokensSaved,
      budgetUtilization: `${(summary.utilizationRate * 100).toFixed(1)}%`
    });

    return metadata.globalMetrics;
  }

  /**
   * Get agent AIS scores for routing and budget decisions
   */
  private async getAgentAIS(agentId: string): Promise<{
    creation_score: number;
    execution_score: number;
    combined_score: number;
  } | undefined> {
    try {
      const metrics = await AgentIntensityService.getMetrics(this.supabase, agentId);

      if (!metrics) {
        console.warn('[Orchestration] No AIS metrics found for agent, using defaults');
        return undefined;
      }

      return {
        creation_score: metrics.creation_score || 5.0,
        execution_score: metrics.execution_score || 5.0,
        combined_score: metrics.combined_score || 5.0
      };
    } catch (error) {
      console.error('[Orchestration] Error fetching AIS metrics:', error);
      return undefined;
    }
  }

  /**
   * Check if a step can proceed based on budget
   */
  async canStepProceed(stepId: string, estimatedTokens: number): Promise<boolean> {
    return this.budgetManager.checkBudget(stepId, estimatedTokens);
  }

  /**
   * Get current budget status for a step
   */
  async getStepBudgetStatus(stepId: string): Promise<TokenBudget> {
    return this.budgetManager.getBudgetStatus(stepId);
  }

  /**
   * Record compression savings for a step
   */
  recordCompression(stepId: string, tokensSaved: number): void {
    this.budgetManager.recordCompression(stepId, tokensSaved);
  }

  /**
   * Reset orchestration state (for testing or cleanup)
   */
  reset(): void {
    this.enabled = null;
    this.compressionEnabled = null;
    this.routingEnabled = null;
    this.budgetManager.reset();
    this.intentClassifier.clearCache();
    this.compressionService.clearCache();
    this.routingService.clearCache();
  }

  /**
   * Reload configuration from database
   */
  async reloadConfig(): Promise<void> {
    this.enabled = null;
    this.compressionEnabled = null;
    this.routingEnabled = null;
    await this.intentClassifier.reloadConfig();
    await this.budgetManager.reloadConfig();
    await this.compressionService.reloadConfig();
    await this.routingService.reloadConfig();
  }
}

/**
 * Singleton instance for convenient access
 */
export const orchestrationService = new OrchestrationService();
