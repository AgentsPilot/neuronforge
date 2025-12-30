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
import { createLogger, Logger } from '@/lib/logger';
import { SystemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import { PROVIDERS } from '@/lib/ai/providerFactory';
import { OPENAI_MODELS } from '@/lib/ai/providers/openaiProvider';
import { IntentClassifier } from './IntentClassifier';
import { TokenBudgetManager } from './TokenBudgetManager';
import { CompressionService } from './CompressionService';
import { RoutingService } from './RoutingService';
import type {
  TokenBudget,
  OrchestrationMetadata,
  StepMetadata,
  OrchestrationMetrics,
  CompressionPolicy,
} from './types';
import { AgentIntensityService } from '@/lib/services/AgentIntensityService';

export class OrchestrationService {
  private supabase: SupabaseClient;
  private logger: Logger;
  private configRepo: SystemConfigRepository;
  private intentClassifier: IntentClassifier;
  private budgetManager: TokenBudgetManager;
  private compressionService: CompressionService;
  private routingService: RoutingService;
  private enabled: boolean | null = null;
  private compressionEnabled: boolean | null = null;
  private routingEnabled: boolean | null = null;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'OrchestrationService' });
    this.configRepo = new SystemConfigRepository(this.supabase);
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

    this.enabled = await this.configRepo.getBoolean('orchestration_enabled', false);
    this.logger.info({ enabled: this.enabled }, 'Orchestration feature flag status');
    return this.enabled;
  }

  /**
   * Check if compression is enabled
   */
  async isCompressionEnabled(): Promise<boolean> {
    if (this.compressionEnabled !== null) {
      return this.compressionEnabled;
    }

    this.compressionEnabled = await this.configRepo.getBoolean('orchestration_compression_enabled', false);
    return this.compressionEnabled;
  }

  /**
   * Check if AIS routing is enabled
   */
  async isRoutingEnabled(): Promise<boolean> {
    if (this.routingEnabled !== null) {
      return this.routingEnabled;
    }

    this.routingEnabled = await this.configRepo.getBoolean('orchestration_ais_routing_enabled', false);
    return this.routingEnabled;
  }

  /**
   * Initialize orchestration for a workflow execution
   * Returns null if orchestration is disabled
   */
  async initialize(
    executionId: string,
    agentId: string,
    userId: string,
    steps: any[]
  ): Promise<OrchestrationMetadata | null> {
    const startTime = Date.now();

    // Check if orchestration is enabled
    const enabled = await this.isEnabled();
    if (!enabled) {
      this.logger.debug('Skipping initialization - feature disabled');
      return null;
    }

    const methodLogger = this.logger.child({ method: 'initialize', executionId });
    methodLogger.info({ stepCount: steps.length }, 'Initializing orchestration');

    try {
      // Get agent AIS scores for routing and budget scaling
      const agentAIS = await this.getAgentAIS(agentId);

      // OPTIMIZATION: Skip classification for deterministic action steps (type=action with plugin_key)
      // These steps will bypass orchestration handlers anyway, so classification is wasted
      methodLogger.debug('Classifying step intents');
      // Reset token counter for this workflow
      this.intentClassifier.resetTokenCounter();

      const intentClassificationStart = Date.now();

      // Filter steps that need classification (non-action or action without plugin)
      const stepsNeedingClassification: any[] = [];
      const stepIndexMap: Map<number, number> = new Map(); // maps original index to filtered index

      steps.forEach((step, originalIndex) => {
        const isDeterministicAction = step.type === 'action' && step.plugin_key;
        if (!isDeterministicAction) {
          stepIndexMap.set(originalIndex, stepsNeedingClassification.length);
          stepsNeedingClassification.push(step);
        }
      });

      methodLogger.debug({ skippedCount: steps.length - stepsNeedingClassification.length }, 'Skipping classification for deterministic action steps');

      // Classify only the steps that need it
      const classifiedIntents = stepsNeedingClassification.length > 0
        ? await this.intentClassifier.classifyBatch(stepsNeedingClassification)
        : [];

      // Build full intents array with placeholders for skipped steps
      const intents = steps.map((step, originalIndex) => {
        const isDeterministicAction = step.type === 'action' && step.plugin_key;
        if (isDeterministicAction) {
          // Use placeholder intent for action steps (won't be used since they skip orchestration)
          return {
            intent: 'extract' as const, // Default intent for actions (doesn't matter since it's skipped)
            confidence: 1.0,
            reasoning: 'Deterministic action step - classification skipped'
          };
        } else {
          const filteredIndex = stepIndexMap.get(originalIndex)!;
          return classifiedIntents[filteredIndex];
        }
      });

      const intentClassificationTime = Date.now() - intentClassificationStart;

      // Get tokens used for classification (orchestration overhead)
      const classificationTokens = this.intentClassifier.getClassificationTokensUsed();
      const intentDistribution = this.intentClassifier.getIntentDistribution(intents);
      methodLogger.info({ duration: intentClassificationTime, tokens: classificationTokens, intentDistribution }, 'Intent classification complete');

      // Allocate token budgets
      methodLogger.debug('Allocating token budgets');
      const budgetAllocationStart = Date.now();
      const workflow = { workflow_steps: steps };
      const budgets = await this.budgetManager.allocateBudget(workflow, intents, agentAIS);
      const budgetAllocationTime = Date.now() - budgetAllocationStart;

      methodLogger.debug({ duration: budgetAllocationTime }, 'Budget allocation complete');

      // Log budget summary
      const summary = this.budgetManager.getTotalBudgetSummary();
      methodLogger.info({ totalAllocated: summary.totalAllocated, avgPerStep: Math.round(summary.totalAllocated / steps.length) }, 'Budget summary');

      // Check Phase 2 feature flags
      const compressionEnabled = await this.isCompressionEnabled();
      const routingEnabled = await this.isRoutingEnabled();

      methodLogger.debug({ compressionEnabled, routingEnabled }, 'Phase 2 feature flags status');

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
                model: OPENAI_MODELS.GPT_5_MINI,
                provider: PROVIDERS.OPENAI,
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
        executionId,  // Use the passed executionId instead of generating a new one
        workflowId: executionId,  // workflowId is the same as executionId in our system
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
            totalTokensUsed: classificationTokens,  // ✅ Start with classification overhead tokens
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
      methodLogger.info({ duration: totalOverhead, meetsTarget: totalOverhead < 50 }, 'Initialization complete');

      return metadata;
    } catch (error) {
      this.logger.error({ err: error, executionId }, 'Initialization error');
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
      this.logger.error({ err: error, stepId }, 'Error tracking step execution');
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

    this.logger.info({
      totalTime,
      stepsCompleted: completedSteps,
      stepsFailed: metadata.globalMetrics.performance.stepsFailed,
      tokensUsed: metadata.globalMetrics.cost.totalTokensUsed,
      tokensSaved: metadata.globalMetrics.cost.totalTokensSaved,
      budgetUtilization: summary.utilizationRate
    }, 'Execution complete');

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
        this.logger.warn({ agentId }, 'No AIS metrics found for agent, using defaults');
        return undefined;
      }

      return {
        creation_score: metrics.creation_score || 5.0,
        execution_score: metrics.execution_score || 5.0,
        combined_score: metrics.combined_score || 5.0
      };
    } catch (error) {
      this.logger.error({ err: error, agentId }, 'Error fetching AIS metrics');
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
   * Get routing service instance (for enhanced routing in WorkflowOrchestrator)
   */
  getRoutingService(): RoutingService {
    return this.routingService;
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
 * @deprecated Use instance-based approach with proper Supabase client
 * This singleton uses client-side Supabase and will not work on server
 */
export const orchestrationService = new OrchestrationService();
