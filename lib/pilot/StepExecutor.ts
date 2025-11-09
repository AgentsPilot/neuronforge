/**
 * StepExecutor - Execute individual workflow steps
 *
 * Responsibilities:
 * - Route step execution based on type (action, llm_decision, transform, etc.)
 * - Execute plugin actions via PluginExecuterV2
 * - Execute LLM decisions via AgentKit
 * - Handle data transformations
 * - Track execution metrics
 *
 * @module lib/orchestrator/StepExecutor
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  WorkflowStep,
  ExecutionContext,
  StepOutput,
  ActionStep,
  LLMDecisionStep,
  AIProcessingStep,
  TransformStep,
  DelayStep,
  SwitchStep,
  EnrichmentStep,
  ValidationStep,
  ComparisonStep,
} from './types';
import { ExecutionError } from './types';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { runAgentKit } from '@/lib/agentkit/runAgentKit';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { ConditionalEvaluator } from './ConditionalEvaluator';
import { DataOperations } from './DataOperations';
import { TaskComplexityAnalyzer } from './TaskComplexityAnalyzer';
import { PerStepModelRouter } from './PerStepModelRouter';

export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private conditionalEvaluator: ConditionalEvaluator;
  private stateManager: any; // StateManager (avoiding circular dependency)
  private complexityAnalyzer: TaskComplexityAnalyzer;
  private modelRouter: PerStepModelRouter;

  constructor(supabase: SupabaseClient, stateManager?: any) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.stateManager = stateManager;
    this.complexityAnalyzer = new TaskComplexityAnalyzer();
    this.modelRouter = new PerStepModelRouter();
  }

  /**
   * Execute a single workflow step
   */
  async execute(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<StepOutput> {
    const startTime = Date.now();

    console.log(`[StepExecutor] Executing step ${step.id}: ${step.name} (type: ${step.type})`);

    // Log step execution start to workflow_step_executions table
    if (this.stateManager) {
      await this.stateManager.logStepExecution(
        context.executionId,
        step.id,
        step.name,
        step.type,
        'running',
        {
          started_at: new Date().toISOString(),
          step_description: step.description,
        }
      );
    }

    try {
      // Resolve parameters with variable substitution
      const resolvedParams = context.resolveAllVariables(step.params || {});

      let result: any;
      let tokensUsed = 0;

      // Route to appropriate executor based on step type
      switch (step.type) {
        case 'action':
          result = await this.executeAction(step as ActionStep, resolvedParams, context);
          break;

        case 'ai_processing':  // Smart Agent Builder uses this type
        case 'llm_decision':
          const llmResult = await this.executeLLMDecision(step as LLMDecisionStep | AIProcessingStep, resolvedParams, context);
          result = llmResult.data;
          tokensUsed = llmResult.tokensUsed;
          break;

        case 'conditional':
          result = await this.executeConditional(step, context);
          break;

        case 'loop':
          // Loop execution is handled by ParallelExecutor
          throw new ExecutionError(
            'Loop steps should be executed by ParallelExecutor',
            'INVALID_STEP_TYPE',
            step.id
          );

        case 'transform':
          result = await this.executeTransform(step as TransformStep, resolvedParams, context);
          break;

        case 'delay':
          await this.executeDelay(step as DelayStep, resolvedParams);
          result = { delayed: true };
          break;

        case 'parallel_group':
          // Parallel groups are handled by ParallelExecutor
          throw new ExecutionError(
            'Parallel group steps should be executed by ParallelExecutor',
            'INVALID_STEP_TYPE',
            step.id
          );

        case 'switch':
          result = await this.executeSwitch(step as SwitchStep, context);
          break;

        case 'scatter_gather':
          // Scatter-gather is handled by ParallelExecutor
          throw new ExecutionError(
            'Scatter-gather steps should be executed by ParallelExecutor',
            'INVALID_STEP_TYPE',
            step.id
          );

        case 'enrichment':
          result = await this.executeEnrichment(step as EnrichmentStep, context);
          break;

        case 'validation':
          result = await this.executeValidation(step as ValidationStep, context);
          break;

        case 'comparison':
          result = await this.executeComparison(step as ComparisonStep, context);
          break;

        default:
          throw new ExecutionError(
            `Unknown step type: ${(step as any).type}`,
            'UNKNOWN_STEP_TYPE',
            step.id
          );
      }

      const executionTime = Date.now() - startTime;

      // Build step output
      const output: StepOutput = {
        stepId: step.id,
        plugin: (step as any).plugin || 'system',
        action: (step as any).action || step.type,
        data: result,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime,
          itemCount: Array.isArray(result) ? result.length : undefined,
          tokensUsed: tokensUsed || undefined,
        },
      };

      // Update step execution to completed in workflow_step_executions table
      if (this.stateManager) {
        await this.stateManager.updateStepExecution(
          context.executionId,
          step.id,
          'completed',
          {
            success: true,
            execution_time: executionTime,
            tokens_used: tokensUsed || undefined,
            item_count: Array.isArray(result) ? result.length : undefined,
            completed_at: new Date().toISOString(),
          }
        );
      }

      // Audit trail
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_STEP_EXECUTED,
        entityType: 'agent',
        entityId: context.executionId,
        userId: context.userId,
        resourceName: step.name,
        details: {
          stepId: step.id,
          stepType: step.type,
          executionTime,
          itemCount: output.metadata.itemCount,
          tokensUsed: output.metadata.tokensUsed,
        },
        severity: 'info',
      });

      console.log(`[StepExecutor] Step ${step.id} completed successfully in ${executionTime}ms`);

      return output;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      console.error(`[StepExecutor] Step ${step.id} failed:`, error);

      // Update step execution to failed in workflow_step_executions table
      if (this.stateManager) {
        await this.stateManager.updateStepExecution(
          context.executionId,
          step.id,
          'failed',
          {
            success: false,
            execution_time: executionTime,
            error: error.message,
            failed_at: new Date().toISOString(),
          },
          error.message
        );
      }

      // Audit trail
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_STEP_FAILED,
        entityType: 'agent',
        entityId: context.executionId,
        userId: context.userId,
        resourceName: step.name,
        details: {
          stepId: step.id,
          stepType: step.type,
          error: error.message,
          errorCode: error.code,
          executionTime,
        },
        severity: 'warning',
      });

      // Build error output
      return {
        stepId: step.id,
        plugin: (step as any).plugin || 'system',
        action: (step as any).action || step.type,
        data: null,
        metadata: {
          success: false,
          executedAt: new Date().toISOString(),
          executionTime,
          error: error.message,
          errorCode: error.code,
        },
      };
    }
  }

  /**
   * Execute plugin action
   */
  private async executeAction(
    step: ActionStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    if (!step.plugin || !step.action) {
      throw new ExecutionError(
        `Action step ${step.id} missing plugin or action`,
        'MISSING_PLUGIN_ACTION',
        step.id
      );
    }

    console.log(`[StepExecutor] Executing plugin: ${step.plugin}.${step.action}`);

    // Execute via PluginExecuterV2 (use getInstance for singleton)
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(
      context.userId,
      step.plugin,
      step.action,
      params
    );

    if (!result.success) {
      throw new ExecutionError(
        result.error || `Plugin execution failed: ${step.plugin}.${step.action}`,
        'PLUGIN_EXECUTION_FAILED',
        step.id,
        { plugin: step.plugin, action: step.action, error: result.error }
      );
    }

    return result.data;
  }

  /**
   * Execute LLM decision step (uses AgentKit)
   * Also handles ai_processing steps from Smart Agent Builder
   */
  private async executeLLMDecision(
    step: LLMDecisionStep | AIProcessingStep,
    params: any,
    context: ExecutionContext
  ): Promise<{ data: any; tokensUsed: number }> {
    console.log(`[StepExecutor] Executing LLM decision: ${step.name}`);

    const stepStartTime = Date.now();
    let selectedModel: string | undefined;
    let routingDecision: any;

    // === PER-STEP INTELLIGENT ROUTING ===
    // Analyze step complexity and route to optimal model
    try {
      const isRoutingEnabled = await this.modelRouter.isEnabled();

      if (isRoutingEnabled) {
        console.log(`🎯 [StepExecutor] Per-step routing enabled - analyzing complexity...`);

        // Analyze step complexity
        const complexityAnalysis = await this.complexityAnalyzer.analyzeStep(step, context);
        console.log(`📊 [StepExecutor] Complexity: ${complexityAnalysis.complexityScore.toFixed(1)}/10`);

        // Get agent AIS (Agent Intensity Score)
        const agentAIS = (context.agent as any).agent_intensity_score || 5.0;

        // Route to optimal model (with memory-based learning)
        routingDecision = await this.modelRouter.routeStep(
          complexityAnalysis,
          agentAIS,
          (context.agent as any).model_preference,
          context.agentId  // Pass agentId for memory lookup
        );

        // Format model for AgentKit (provider:model)
        selectedModel = `${routingDecision.selectedModel.provider}:${routingDecision.selectedModel.model}`;

        console.log(`✅ [StepExecutor] Selected model: ${selectedModel}`);
        console.log(`   ${routingDecision.explanation}`);

        // Record routing decision to audit trail
        const stepIndex = context.completedSteps.length;
        await this.modelRouter.recordRoutingDecision(
          context.agentId,
          context.userId,
          context.executionId,
          stepIndex,
          step.name,
          step.type,
          complexityAnalysis,
          routingDecision
        );
      } else {
        console.log(`ℹ️ [StepExecutor] Per-step routing disabled - using agent default model`);
      }
    } catch (routingError) {
      console.error('❌ [StepExecutor] Routing failed, falling back to agent default:', routingError);
      // Continue with agent default model
    }

    // Build prompt with context
    const prompt = step.prompt || step.description || step.name;

    const contextSummary = this.buildContextSummary(context);

    const fullPrompt = `
${prompt}

## Current Context:
${contextSummary}

## Data for Analysis:
${JSON.stringify(params, null, 2)}

Please analyze the above and provide your decision/response.
    `.trim();

    // Use AgentKit for intelligent decision (with optional model override)
    // If a model was selected by routing, temporarily override the agent's model preference
    const agentForExecution = selectedModel
      ? { ...context.agent, model_preference: selectedModel }
      : context.agent;

    const result = await runAgentKit(
      context.userId,
      agentForExecution,
      fullPrompt,
      {},
      context.sessionId
    );

    if (!result.success) {
      throw new ExecutionError(
        result.error || 'LLM decision failed',
        'LLM_DECISION_FAILED',
        step.id
      );
    }

    // Update routing metrics if routing was used
    if (routingDecision) {
      const executionTimeMs = Date.now() - stepStartTime;
      const stepIndex = context.completedSteps.length;

      await this.modelRouter.updateRoutingMetrics(
        context.executionId,
        stepIndex,
        result.tokensUsed.total,
        executionTimeMs,
        true,
        undefined  // Cost calculation can be added later
      );

      // === LEARN FROM THIS EXECUTION ===
      // Feed the outcome back into routing memory for future optimization
      const RoutingMemoryService = (await import('./RoutingMemoryService')).RoutingMemoryService;
      const routingMemory = RoutingMemoryService.getInstance();

      await routingMemory.learnFromExecution(
        context.agentId,
        context.userId,
        context.executionId,
        stepIndex,
        step.type,
        routingDecision.selectedModel.tier,
        true, // success (since we got here without error)
        result.tokensUsed.total,
        executionTimeMs,
        undefined // cost will be calculated in future
      );
    }

    return {
      data: {
        decision: result.response,
        reasoning: result.response,
        toolCalls: result.toolCalls,
      },
      tokensUsed: result.tokensUsed.total,
    };
  }

  /**
   * Execute conditional step
   */
  private async executeConditional(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<any> {
    if (!step.condition) {
      throw new ExecutionError(
        `Conditional step ${step.id} missing condition`,
        'MISSING_CONDITION',
        step.id
      );
    }

    console.log(`[StepExecutor] Evaluating condition for step ${step.id}`);

    const result = this.conditionalEvaluator.evaluate(step.condition, context);

    return {
      result,
      condition: step.condition,
    };
  }

  /**
   * Execute switch/case conditional
   * Phase 2: Enhanced Conditionals
   */
  private async executeSwitch(
    step: SwitchStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`🔀 [StepExecutor] Executing switch step ${step.id}`);

    // Evaluate the switch expression
    const evaluatedValue = context.resolveVariable?.(step.evaluate) ?? step.evaluate;
    const valueStr = String(evaluatedValue);

    console.log(`🔀 [StepExecutor] Switch on "${step.evaluate}" = "${valueStr}"`);

    // Find matching case
    let matchedSteps: string[] | undefined;

    if (step.cases[valueStr]) {
      matchedSteps = step.cases[valueStr];
      console.log(`✅ [StepExecutor] Matched case "${valueStr}" → steps: ${matchedSteps.join(', ')}`);
    } else if (step.default) {
      matchedSteps = step.default;
      console.log(`⚠️  [StepExecutor] No match, using default → steps: ${matchedSteps.join(', ')}`);
    } else {
      console.log(`❌ [StepExecutor] No match and no default case`);
      matchedSteps = [];
    }

    // Store matched branch in context for routing
    context.setVariable?.(`${step.id}_branch`, matchedSteps);

    return {
      matchedCase: valueStr,
      matchedSteps,
      totalCases: Object.keys(step.cases).length,
      hasDefault: !!step.default,
    };
  }

  /**
   * Execute enrichment step
   * Phase 4: Data Operations
   */
  private async executeEnrichment(
    step: EnrichmentStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`📊 [StepExecutor] Executing enrichment step ${step.id}`);

    // Resolve all sources
    const sources: Record<string, any> = {};
    for (const source of step.sources) {
      const value = context.resolveVariable?.(source.from) ?? null;
      sources[source.key] = value;
      console.log(`📊 [StepExecutor] Source "${source.key}" resolved from ${source.from}`);
    }

    // Enrich data using DataOperations
    const result = DataOperations.enrich(sources, step.strategy, {
      joinOn: step.joinOn,
      mergeArrays: step.mergeArrays,
    });

    console.log(`✅ [StepExecutor] Enrichment complete for ${step.id}`);

    return result;
  }

  /**
   * Execute validation step
   * Phase 4: Data Operations
   */
  private async executeValidation(
    step: ValidationStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`✅ [StepExecutor] Executing validation step ${step.id}`);

    // Resolve input data
    const data = context.resolveVariable?.(step.input);

    // Validate using DataOperations
    const validationResult = DataOperations.validate(data, step.schema, step.rules);

    console.log(`✅ [StepExecutor] Validation ${validationResult.valid ? 'passed' : 'failed'} for ${step.id}`);

    // Handle validation failure
    if (!validationResult.valid) {
      const onFail = step.onValidationFail || 'throw';

      if (onFail === 'throw') {
        throw new ExecutionError(
          `Validation failed: ${validationResult.errors.join(', ')}`,
          'VALIDATION_FAILED',
          step.id,
          { errors: validationResult.errors }
        );
      } else if (onFail === 'skip') {
        console.log(`⏭  [StepExecutor] Validation failed, skipping step ${step.id}`);
      }
      // If 'continue', just log and return result
    }

    return {
      valid: validationResult.valid,
      errors: validationResult.errors,
      data,
    };
  }

  /**
   * Execute comparison step
   * Phase 4: Data Operations
   */
  private async executeComparison(
    step: ComparisonStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`🔍 [StepExecutor] Executing comparison step ${step.id}`);

    // Resolve left and right values
    const leftValue = context.resolveVariable?.(step.left);
    const rightValue = context.resolveVariable?.(step.right);

    console.log(`🔍 [StepExecutor] Comparing "${step.left}" vs "${step.right}" with operation: ${step.operation}`);

    // Compare using DataOperations
    const result = DataOperations.compare(
      leftValue,
      rightValue,
      step.operation,
      step.outputFormat || 'boolean'
    );

    console.log(`✅ [StepExecutor] Comparison complete for ${step.id}`);

    return result;
  }

  /**
   * Execute data transformation
   */
  private async executeTransform(
    step: TransformStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    const { operation, input, config } = params;

    if (!operation) {
      throw new ExecutionError(
        `Transform step ${step.id} missing operation`,
        'MISSING_OPERATION',
        step.id
      );
    }

    console.log(`[StepExecutor] Executing transform: ${operation}`);

    // Resolve input data
    const data = input ? context.resolveVariable(input) : params.data;

    if (!data) {
      throw new ExecutionError(
        `Transform step ${step.id} has no input data`,
        'MISSING_INPUT_DATA',
        step.id
      );
    }

    switch (operation) {
      case 'set':
        // Simple assignment - just return the input data as-is
        return data;

      case 'map':
        return this.transformMap(data, config, context);

      case 'filter':
        return this.transformFilter(data, config, context);

      case 'reduce':
        return this.transformReduce(data, config);

      case 'sort':
        return this.transformSort(data, config);

      case 'group':
        return this.transformGroup(data, config);

      case 'aggregate':
        return this.transformAggregate(data, config);

      default:
        throw new ExecutionError(
          `Unknown transform operation: ${operation}`,
          'UNKNOWN_TRANSFORM_OPERATION',
          step.id
        );
    }
  }

  /**
   * Map transformation
   */
  private transformMap(data: any[], mapping: Record<string, string>, context: ExecutionContext): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Map operation requires array input', 'INVALID_INPUT_TYPE');
    }

    return data.map(item => {
      const mapped: any = {};

      // Create temporary context with current item
      const tempContext = context.clone();
      tempContext.setVariable('current', item);

      for (const [key, valueExpr] of Object.entries(mapping)) {
        if (typeof valueExpr === 'string' && valueExpr.includes('{{')) {
          mapped[key] = tempContext.resolveVariable(valueExpr);
        } else {
          mapped[key] = valueExpr;
        }
      }

      return mapped;
    });
  }

  /**
   * Filter transformation
   */
  private transformFilter(data: any[], config: any, context: ExecutionContext): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Filter operation requires array input', 'INVALID_INPUT_TYPE');
    }

    return data.filter(item => {
      // Create temporary context with current item
      const tempContext = context.clone();
      tempContext.setVariable('current', item);

      return this.conditionalEvaluator.evaluate(config.condition, tempContext);
    });
  }

  /**
   * Reduce transformation
   */
  private transformReduce(data: any[], config: any): any {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Reduce operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { reducer, initialValue } = config;

    // Simple reducers
    switch (reducer) {
      case 'sum':
        return data.reduce((acc, item) => acc + (Number(item) || 0), initialValue || 0);

      case 'count':
        return data.length;

      case 'concat':
        return data.reduce((acc, item) => acc.concat(item), initialValue || []);

      case 'merge':
        return data.reduce((acc, item) => ({ ...acc, ...item }), initialValue || {});

      default:
        throw new ExecutionError(`Unknown reducer: ${reducer}`, 'UNKNOWN_REDUCER');
    }
  }

  /**
   * Sort transformation
   */
  private transformSort(data: any[], config: any): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Sort operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { field, order = 'asc' } = config;

    return [...data].sort((a, b) => {
      const aVal = field ? a[field] : a;
      const bVal = field ? b[field] : b;

      if (order === 'desc') {
        return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
      } else {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      }
    });
  }

  /**
   * Group transformation
   */
  private transformGroup(data: any[], config: any): Record<string, any[]> {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Group operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { field } = config;

    return data.reduce((acc, item) => {
      const key = field ? item[field] : item;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {} as Record<string, any[]>);
  }

  /**
   * Aggregate transformation
   */
  private transformAggregate(data: any[], config: any): any {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Aggregate operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { aggregations } = config;

    if (!aggregations || !Array.isArray(aggregations)) {
      throw new ExecutionError('Aggregate operation requires aggregations config', 'MISSING_AGGREGATIONS');
    }

    const result: any = {};

    aggregations.forEach((agg: any) => {
      const { field, operation, alias } = agg;
      const key = alias || `${field}_${operation}`;

      const values = data.map(item => item[field]).filter(v => v !== undefined && v !== null);

      switch (operation) {
        case 'sum':
          result[key] = values.reduce((acc, val) => acc + Number(val), 0);
          break;

        case 'avg':
          result[key] = values.length > 0
            ? values.reduce((acc, val) => acc + Number(val), 0) / values.length
            : 0;
          break;

        case 'min':
          result[key] = values.length > 0 ? Math.min(...values.map(Number)) : null;
          break;

        case 'max':
          result[key] = values.length > 0 ? Math.max(...values.map(Number)) : null;
          break;

        case 'count':
          result[key] = values.length;
          break;

        default:
          throw new ExecutionError(`Unknown aggregation operation: ${operation}`, 'UNKNOWN_AGGREGATION');
      }
    });

    return result;
  }

  /**
   * Execute delay step
   */
  private async executeDelay(step: DelayStep, params: any): Promise<void> {
    const { duration } = params;

    if (!duration || duration <= 0) {
      throw new ExecutionError(
        `Delay step ${step.id} has invalid duration: ${duration}`,
        'INVALID_DURATION',
        step.id
      );
    }

    console.log(`[StepExecutor] Delaying for ${duration}ms`);

    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Build context summary for LLM
   */
  private buildContextSummary(context: ExecutionContext): string {
    const completedSteps = context.completedSteps
      .map(stepId => {
        const output = context.getStepOutput(stepId);
        if (!output) return null;

        return `- ${stepId}: ${output.plugin}.${output.action} (${output.metadata.itemCount || 0} items)`;
      })
      .filter(Boolean)
      .join('\n');

    const inputValues = Object.entries(context.inputValues)
      .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
      .join('\n');

    return `
### Completed Steps:
${completedSteps || 'None'}

### Input Values:
${inputValues || 'None'}

### Progress:
- Completed: ${context.completedSteps.length}
- Failed: ${context.failedSteps.length}
- Skipped: ${context.skippedSteps.length}
    `.trim();
  }
}
