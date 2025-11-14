/**
 * TokenBudgetManager
 *
 * Manages token budget allocation and tracking for workflow executions
 * Key responsibilities:
 * - Allocate budgets per step based on intent and agent AIS scores
 * - Track token usage in real-time
 * - Enforce budget constraints
 * - Provide overage handling
 *
 * Integrates with:
 * - IntentClassifier (for intent-based budgets)
 * - AIS system (agent-level complexity scores)
 * - Database configuration (all budgets configurable via admin UI)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  TokenBudget,
  BudgetConstraints,
  BudgetAllocationStrategy,
  IntentType,
  IntentClassification,
  ITokenBudgetManager,
  OrchestrationConfigKey,
} from './types';
import { BudgetExceededError } from './types';

export class TokenBudgetManager implements ITokenBudgetManager {
  private supabase: SupabaseClient;
  private budgets: Map<string, TokenBudget> = new Map();
  private constraints: BudgetConstraints | null = null;
  private intentBudgets: Map<IntentType, number> | null = null;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
  }

  /**
   * Allocate budgets for all workflow steps
   * Uses agent AIS scores and intent classifications
   */
  async allocateBudget(
    workflow: any,
    intents: IntentClassification[],
    agentAIS?: { creation_score: number; execution_score: number; combined_score: number }
  ): Promise<Map<string, TokenBudget>> {
    const startTime = Date.now();

    try {
      // Load configuration
      await this.loadConfiguration();

      // Get workflow steps
      const steps = workflow.workflow_steps || workflow.steps || [];

      if (steps.length !== intents.length) {
        throw new Error(
          `Step count (${steps.length}) does not match intent count (${intents.length})`
        );
      }

      // Get allocation strategy
      const strategy = this.constraints!.allowOverage
        ? await this.getAllocationStrategy()
        : 'proportional';

      console.log(
        `[TokenBudgetManager] Allocating budget for ${steps.length} steps using "${strategy}" strategy`
      );

      // Calculate budgets based on strategy
      const budgets = await this.calculateBudgets(
        steps,
        intents,
        strategy,
        agentAIS
      );

      // Validate total budget doesn't exceed workflow limit
      const totalAllocated = Array.from(budgets.values()).reduce(
        (sum, budget) => sum + budget.allocated,
        0
      );

      if (totalAllocated > this.constraints!.maxTokensPerWorkflow) {
        console.warn(
          `[TokenBudgetManager] Total allocated (${totalAllocated}) exceeds workflow limit (${this.constraints!.maxTokensPerWorkflow}). Scaling down...`
        );
        this.scaleDownBudgets(budgets, this.constraints!.maxTokensPerWorkflow);
      }

      // Store budgets
      this.budgets = budgets;

      const elapsed = Date.now() - startTime;
      console.log(
        `[TokenBudgetManager] Allocated ${totalAllocated} tokens across ${steps.length} steps in ${elapsed}ms`
      );

      return budgets;
    } catch (error) {
      console.error('[TokenBudgetManager] Budget allocation error:', error);
      throw error;
    }
  }

  /**
   * Track token usage for a step
   */
  async trackUsage(stepId: string, tokensUsed: number): Promise<void> {
    const budget = this.budgets.get(stepId);

    if (!budget) {
      console.warn(
        `[TokenBudgetManager] No budget found for step ${stepId}, skipping tracking`
      );
      return;
    }

    // Update budget
    budget.used += tokensUsed;
    budget.remaining = Math.max(0, budget.allocated - budget.used);

    // Check for overage
    if (budget.used > budget.allocated && !budget.overageAllowed) {
      console.warn(
        `[TokenBudgetManager] Budget exceeded for step ${stepId}: used ${budget.used}, allocated ${budget.allocated}`
      );
    }

    console.log(
      `[TokenBudgetManager] Step ${stepId}: used ${budget.used}/${budget.allocated} tokens (${budget.remaining} remaining)`
    );
  }

  /**
   * Check if a step has sufficient budget
   */
  async checkBudget(stepId: string, requiredTokens: number): Promise<boolean> {
    const budget = this.budgets.get(stepId);

    if (!budget) {
      console.warn(
        `[TokenBudgetManager] No budget found for step ${stepId}, allowing by default`
      );
      return true;
    }

    // If overage allowed, check against overage limit
    if (budget.overageAllowed && budget.overageLimit) {
      const maxAllowed = budget.allocated + budget.overageLimit;
      return budget.used + requiredTokens <= maxAllowed;
    }

    // Otherwise, check against allocated budget
    return budget.used + requiredTokens <= budget.allocated;
  }

  /**
   * Get budget status for a step
   */
  async getBudgetStatus(stepId: string): Promise<TokenBudget> {
    const budget = this.budgets.get(stepId);

    if (!budget) {
      throw new Error(`No budget found for step ${stepId}`);
    }

    return { ...budget }; // Return copy
  }

  /**
   * Get total budget summary
   */
  getTotalBudgetSummary(): {
    totalAllocated: number;
    totalUsed: number;
    totalRemaining: number;
    totalCompressed: number;
    utilizationRate: number;
  } {
    const budgets = Array.from(this.budgets.values());

    const totalAllocated = budgets.reduce((sum, b) => sum + b.allocated, 0);
    const totalUsed = budgets.reduce((sum, b) => sum + b.used, 0);
    const totalRemaining = budgets.reduce((sum, b) => sum + b.remaining, 0);
    const totalCompressed = budgets.reduce((sum, b) => sum + b.compressed, 0);
    const utilizationRate = totalAllocated > 0 ? totalUsed / totalAllocated : 0;

    return {
      totalAllocated,
      totalUsed,
      totalRemaining,
      totalCompressed,
      utilizationRate,
    };
  }

  /**
   * Record compressed tokens (tokens saved via compression)
   */
  recordCompression(stepId: string, tokensSaved: number): void {
    const budget = this.budgets.get(stepId);

    if (!budget) {
      console.warn(
        `[TokenBudgetManager] No budget found for step ${stepId}, skipping compression record`
      );
      return;
    }

    budget.compressed += tokensSaved;
    console.log(
      `[TokenBudgetManager] Step ${stepId}: saved ${tokensSaved} tokens via compression (total saved: ${budget.compressed})`
    );
  }

  /**
   * Load configuration from database
   */
  private async loadConfiguration(): Promise<void> {
    // Load constraints
    if (!this.constraints) {
      this.constraints = await this.loadBudgetConstraints();
    }

    // Load intent budgets
    if (!this.intentBudgets) {
      this.intentBudgets = await this.loadIntentBudgets();
    }
  }

  /**
   * Load budget constraints from database
   */
  private async loadBudgetConstraints(): Promise<BudgetConstraints> {
    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', [
          'orchestration_max_tokens_per_step',
          'orchestration_max_tokens_per_workflow',
          'orchestration_budget_overage_allowed',
          'orchestration_budget_overage_threshold',
          'token_budget_critical_step_multiplier',
        ]);

      if (error) {
        console.warn(
          '[TokenBudgetManager] Error loading constraints, using defaults:',
          error
        );
        return this.getDefaultConstraints();
      }

      const config: Record<string, any> = {};
      data?.forEach((row) => {
        config[row.key] = row.value;
      });

      return {
        maxTokensPerStep: parseInt(
          config['orchestration_max_tokens_per_step'] || '4000'
        ),
        maxTokensPerWorkflow: parseInt(
          config['orchestration_max_tokens_per_workflow'] || '20000'
        ),
        allowOverage:
          config['orchestration_budget_overage_allowed'] === true,
        overageThreshold: parseFloat(
          config['orchestration_budget_overage_threshold'] || '1.2'
        ),
        criticalStepMultiplier: parseFloat(
          config['token_budget_critical_step_multiplier'] || '1.5'
        ),
      };
    } catch (error) {
      console.error('[TokenBudgetManager] Error loading constraints:', error);
      return this.getDefaultConstraints();
    }
  }

  /**
   * Load intent-specific budgets from database
   */
  private async loadIntentBudgets(): Promise<Map<IntentType, number>> {
    try {
      const intentTypes: IntentType[] = [
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

      const configKeys = intentTypes.map(
        (intent) => `orchestration_token_budget_${intent}`
      );

      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('key, value')
        .in('key', configKeys);

      if (error) {
        console.warn(
          '[TokenBudgetManager] Error loading intent budgets, using defaults:',
          error
        );
        return this.getDefaultIntentBudgets();
      }

      const budgets = new Map<IntentType, number>();

      // Parse configuration
      data?.forEach((row) => {
        const intent = row.key.replace(
          'orchestration_token_budget_',
          ''
        ) as IntentType;
        budgets.set(intent, parseInt(row.value));
      });

      // Fill in missing intents with defaults
      const defaults = this.getDefaultIntentBudgets();
      intentTypes.forEach((intent) => {
        if (!budgets.has(intent)) {
          budgets.set(intent, defaults.get(intent)!);
        }
      });

      return budgets;
    } catch (error) {
      console.error('[TokenBudgetManager] Error loading intent budgets:', error);
      return this.getDefaultIntentBudgets();
    }
  }

  /**
   * Get allocation strategy from database
   */
  private async getAllocationStrategy(): Promise<BudgetAllocationStrategy> {
    try {
      const { data, error } = await this.supabase
        .from('system_settings_config')
        .select('value')
        .eq('key', 'orchestration_budget_allocation_strategy')
        .single();

      if (error || !data) {
        return 'proportional';
      }

      const strategy = data.value as BudgetAllocationStrategy;
      const validStrategies: BudgetAllocationStrategy[] = [
        'equal',
        'proportional',
        'adaptive',
        'priority',
      ];

      return validStrategies.includes(strategy) ? strategy : 'proportional';
    } catch (error) {
      console.error('[TokenBudgetManager] Error loading strategy:', error);
      return 'proportional';
    }
  }

  /**
   * Calculate budgets based on strategy
   */
  private async calculateBudgets(
    steps: any[],
    intents: IntentClassification[],
    strategy: BudgetAllocationStrategy,
    agentAIS?: { creation_score: number; execution_score: number; combined_score: number }
  ): Promise<Map<string, TokenBudget>> {
    const budgets = new Map<string, TokenBudget>();

    switch (strategy) {
      case 'equal':
        return this.calculateEqualBudgets(steps, intents);
      case 'proportional':
        return this.calculateProportionalBudgets(steps, intents, agentAIS);
      case 'adaptive':
        return this.calculateAdaptiveBudgets(steps, intents, agentAIS);
      case 'priority':
        return this.calculatePriorityBudgets(steps, intents, agentAIS);
      default:
        return this.calculateProportionalBudgets(steps, intents, agentAIS);
    }
  }

  /**
   * Equal budget allocation - same budget for all steps
   */
  private calculateEqualBudgets(
    steps: any[],
    intents: IntentClassification[]
  ): Map<string, TokenBudget> {
    const budgets = new Map<string, TokenBudget>();
    const budgetPerStep = Math.floor(
      this.constraints!.maxTokensPerWorkflow / steps.length
    );

    steps.forEach((step, index) => {
      const stepId = step.id || step.step_id || `step_${index}`;
      budgets.set(stepId, {
        allocated: Math.min(budgetPerStep, this.constraints!.maxTokensPerStep),
        used: 0,
        remaining: budgetPerStep,
        compressed: 0,
        overageAllowed: this.constraints!.allowOverage,
        overageLimit: Math.floor(budgetPerStep * (this.constraints!.overageThreshold - 1)),
      });
    });

    return budgets;
  }

  /**
   * Proportional budget allocation - based on intent types
   */
  private calculateProportionalBudgets(
    steps: any[],
    intents: IntentClassification[],
    agentAIS?: { creation_score: number; execution_score: number; combined_score: number }
  ): Map<string, TokenBudget> {
    const budgets = new Map<string, TokenBudget>();

    // Calculate total baseline budget needed
    let totalBaseline = 0;
    const stepBaselines: number[] = [];

    steps.forEach((step, index) => {
      const intent = intents[index].intent;
      const baseline = this.intentBudgets!.get(intent) || 1000;
      stepBaselines.push(baseline);
      totalBaseline += baseline;
    });

    // Apply AIS multiplier if available
    let aisMultiplier = 1.0;
    if (agentAIS) {
      // Higher combined_score = more complex agent = need more tokens
      // Scale from 1.0 (score 0) to 1.5 (score 10)
      aisMultiplier = 1.0 + (agentAIS.combined_score / 10) * 0.5;
    }

    // Allocate proportionally
    steps.forEach((step, index) => {
      const stepId = step.id || step.step_id || `step_${index}`;
      const baseline = stepBaselines[index];
      const proportion = baseline / totalBaseline;
      const allocated = Math.floor(
        this.constraints!.maxTokensPerWorkflow * proportion * aisMultiplier
      );

      const finalAllocated = Math.min(
        allocated,
        this.constraints!.maxTokensPerStep
      );

      budgets.set(stepId, {
        allocated: finalAllocated,
        used: 0,
        remaining: finalAllocated,
        compressed: 0,
        overageAllowed: this.constraints!.allowOverage,
        overageLimit: Math.floor(
          finalAllocated * (this.constraints!.overageThreshold - 1)
        ),
      });
    });

    return budgets;
  }

  /**
   * Adaptive budget allocation - based on execution history
   * TODO: Implement learning from past executions
   */
  private async calculateAdaptiveBudgets(
    steps: any[],
    intents: IntentClassification[],
    agentAIS?: { creation_score: number; execution_score: number; combined_score: number }
  ): Promise<Map<string, TokenBudget>> {
    // For now, fall back to proportional
    // In Phase 2, we'll add learning from execution history
    console.log('[TokenBudgetManager] Adaptive strategy not fully implemented, using proportional');
    return this.calculateProportionalBudgets(steps, intents, agentAIS);
  }

  /**
   * Priority-based budget allocation
   * Allocates more to critical steps
   */
  private calculatePriorityBudgets(
    steps: any[],
    intents: IntentClassification[],
    agentAIS?: { creation_score: number; execution_score: number; combined_score: number }
  ): Map<string, TokenBudget> {
    const budgets = new Map<string, TokenBudget>();

    // Determine priority for each step
    const priorities = steps.map((step, index) => {
      const intent = intents[index].intent;
      const confidence = intents[index].confidence;

      // Priority scoring: validate/generate get more, conditional/filter get less
      let priority = 1.0;
      if (intent === 'generate') priority = 1.5;
      else if (intent === 'validate') priority = 1.3;
      else if (intent === 'extract') priority = 1.2;
      else if (intent === 'conditional') priority = 0.5;
      else if (intent === 'filter') priority = 0.5;

      // Adjust by confidence (higher confidence = higher priority)
      priority *= confidence;

      return priority;
    });

    const totalPriority = priorities.reduce((sum, p) => sum + p, 0);

    // Allocate based on priority
    steps.forEach((step, index) => {
      const stepId = step.id || step.step_id || `step_${index}`;
      const proportion = priorities[index] / totalPriority;
      const allocated = Math.floor(
        this.constraints!.maxTokensPerWorkflow * proportion
      );

      const finalAllocated = Math.min(
        allocated,
        this.constraints!.maxTokensPerStep
      );

      budgets.set(stepId, {
        allocated: finalAllocated,
        used: 0,
        remaining: finalAllocated,
        compressed: 0,
        overageAllowed: this.constraints!.allowOverage,
        overageLimit: Math.floor(
          finalAllocated * (this.constraints!.overageThreshold - 1)
        ),
      });
    });

    return budgets;
  }

  /**
   * Scale down budgets proportionally to fit within limit
   */
  private scaleDownBudgets(budgets: Map<string, TokenBudget>, limit: number): void {
    const totalAllocated = Array.from(budgets.values()).reduce(
      (sum, b) => sum + b.allocated,
      0
    );
    const scaleFactor = limit / totalAllocated;

    budgets.forEach((budget) => {
      budget.allocated = Math.floor(budget.allocated * scaleFactor);
      budget.remaining = budget.allocated;
      if (budget.overageLimit) {
        budget.overageLimit = Math.floor(budget.overageLimit * scaleFactor);
      }
    });
  }

  /**
   * Default constraints (fallback)
   */
  private getDefaultConstraints(): BudgetConstraints {
    return {
      maxTokensPerStep: 4000,
      maxTokensPerWorkflow: 20000,
      allowOverage: true,
      overageThreshold: 1.2,
      criticalStepMultiplier: 1.5,
    };
  }

  /**
   * Default intent budgets (fallback)
   */
  private getDefaultIntentBudgets(): Map<IntentType, number> {
    return new Map<IntentType, number>([
      ['extract', 800],
      ['summarize', 1500],
      ['generate', 2500],
      ['validate', 1000],
      ['send', 500],
      ['transform', 800],
      ['conditional', 300],
      ['aggregate', 1200],
      ['filter', 600],
      ['enrich', 1000],
    ]);
  }

  /**
   * Reset all budgets
   */
  reset(): void {
    this.budgets.clear();
    this.constraints = null;
    this.intentBudgets = null;
    console.log('[TokenBudgetManager] Reset complete');
  }

  /**
   * Reload configuration from database
   */
  async reloadConfig(): Promise<void> {
    this.constraints = null;
    this.intentBudgets = null;
    await this.loadConfiguration();
    console.log('[TokenBudgetManager] Configuration reloaded');
  }
}

/**
 * Singleton instance for convenient access
 * @deprecated Use instance-based approach with proper Supabase client
 * This singleton will fail on server-side because it requires a Supabase client
 * Usage: Create instance via OrchestrationService (already has TokenBudgetManager instance)
 */
// export const tokenBudgetManager = new TokenBudgetManager(); // Disabled - requires Supabase client
