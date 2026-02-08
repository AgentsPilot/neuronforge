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
  DeterministicExtractionStep,
  IStateManager,
  IParallelExecutor,
} from './types';
import { ExecutionError } from './types';
import { ExecutionContext } from './ExecutionContext';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { runAgentKit } from '@/lib/agentkit/runAgentKit';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { ConditionalEvaluator } from './ConditionalEvaluator';
import { DataOperations } from './DataOperations';
import { StepCache } from './StepCache';
import { AISConfigService } from '@/lib/services/AISConfigService';
import { createLogger } from '@/lib/logger';
import { schemaExtractor, analyzeOutputSchema } from './utils/SchemaAwareDataExtractor';
import { VisionContentBuilder } from './utils/VisionContentBuilder';
import { DeterministicExtractor } from '@/lib/extraction';
import { IssueCollector } from './shadow/IssueCollector';
import { FailureClassifier } from './shadow/FailureClassifier';

// Create module-level logger for structured logging to dev.log
const logger = createLogger({ module: 'StepExecutor', service: 'workflow-pilot' });
// TODO: Implement these classes for per-step routing
// import { TaskComplexityAnalyzer } from './TaskComplexityAnalyzer';
// import { PerStepModelRouter } from './PerStepModelRouter';

export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private conditionalEvaluator: ConditionalEvaluator;
  private stateManager?: IStateManager; // Wave 7: Now properly typed
  private stepCache: StepCache;
  private parallelExecutor?: IParallelExecutor; // Wave 7: Now properly typed
  // Batch calibration services
  private issueCollector: IssueCollector;
  private failureClassifier: FailureClassifier;
  // private complexityAnalyzer: TaskComplexityAnalyzer;
  // private modelRouter: PerStepModelRouter;

  constructor(supabase: SupabaseClient, stateManager?: IStateManager, stepCache?: StepCache) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.stateManager = stateManager;
    this.stepCache = stepCache || new StepCache(false);
    this.issueCollector = new IssueCollector();
    this.failureClassifier = new FailureClassifier();
    // this.complexityAnalyzer = new TaskComplexityAnalyzer();
    // this.modelRouter = new PerStepModelRouter();
  }

  /**
   * Inject ParallelExecutor to handle nested scatter-gather steps
   * Called after construction to avoid circular dependency
   */
  setParallelExecutor(parallelExecutor: IParallelExecutor): void {
    this.parallelExecutor = parallelExecutor;
  }

  /**
   * Execute a single workflow step
   */
  async execute(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<StepOutput> {
    const startTime = Date.now();

    logger.info({ stepId: step.id, stepName: step.name, stepType: step.type }, 'Executing step');

    // === BATCH CALIBRATION: DEPENDENCY CHECK ===
    // In batch mode, check if dependencies failed with non-recoverable errors
    if (context.batchCalibrationMode) {
      const shouldSkip = this.shouldSkipDueToDependencies(step, context);
      if (shouldSkip) {
        logger.info({
          stepId: step.id,
          stepName: step.name,
          reason: 'dependency_failed'
        }, 'Skipping step due to failed dependency');

        // Skip this step to avoid cascading errors
        context.skippedSteps.push(step.id);

        // Log skipped step to database
        if (this.stateManager) {
          await this.stateManager.logStepExecution(
            context.executionId,
            step.id,
            step.name,
            step.type,
            'skipped',
            {
              skipped: true,
              reason: 'dependency_failed',
              message: 'Skipped because a required upstream step failed'
            }
          );
        }

        return {
          stepId: step.id,
          plugin: (step as any).plugin || 'system',
          action: (step as any).action || step.type,
          data: null,
          metadata: {
            success: false,
            executedAt: new Date().toISOString(),
            executionTime: 0,
            skipped: true,
            // @ts-ignore - adding custom metadata for batch calibration
            reason: 'dependency_failed',
            // @ts-ignore
            message: 'Skipped because a required upstream step failed'
          }
        };
      }
    }

    // === CACHING CHECK ===
    // Check cache before execution (for deterministic steps only)
    const cacheableTypes = ['action', 'transform', 'validation', 'comparison'];
    if (cacheableTypes.includes(step.type)) {
      const stepParams = (step as any).params || {};
      const cachedOutput = this.stepCache.get(step.id, step.type, stepParams);
      if (cachedOutput) {
        logger.debug({ stepId: step.id }, 'Cache hit - skipping execution');
        return cachedOutput;
      }
    }

    // === ORCHESTRATION INTEGRATION (Phase 4) ===
    // Check if step should use orchestration (only AI tasks, not deterministic plugin actions)
    const shouldUseOrchestration = this.shouldUseOrchestration(step);

    if (shouldUseOrchestration && context.orchestrator && context.orchestrator.isActive()) {
      logger.info({ stepId: step.id, stepType: step.type }, 'Using orchestration for AI task');

      try {
        // ✅ CRITICAL: Resolve variables BEFORE passing to orchestration
        // This ensures {{step1.data.emails}} is resolved to actual data for Step 2
        // For AI processing steps, check BOTH params AND input fields
        const stepAny = step as any;
        const stepParams = stepAny.params || {};

        // ✅ FIX: Include 'input' field if present (used by ai_processing steps)
        if (stepAny.input !== undefined) {
          stepParams.input = stepAny.input;
        }
        // Include 'prompt' field if present
        if (stepAny.prompt !== undefined) {
          stepParams.prompt = stepAny.prompt;
        }

        const resolvedParams = context.resolveAllVariables(stepParams);

        logger.debug({ stepId: step.id, paramsBefore: stepParams }, 'Orchestration step params BEFORE resolution');
        logger.debug({ stepId: step.id, paramsAfter: resolvedParams }, 'Orchestration step params AFTER resolution');

        // Execute via orchestration handlers
        const orchestrationResult = await context.orchestrator.executeStep(
          step.id,
          {
            step,
            params: resolvedParams,  // ✅ Use resolved params instead of raw params
            context: context.variables,  // Keep for backward compatibility
            executionContext: context,  // ✅ Pass full ExecutionContext for variable resolution
          },
          context.memoryContext,
          context.agent.plugins_required
        );

        if (orchestrationResult) {
          // Return orchestrated result
          logger.info({
            stepId: step.id,
            tokensUsed: orchestrationResult.tokensUsed.total,
            tokensSaved: orchestrationResult.tokensSaved
          }, 'Orchestration executed step successfully');

          return {
            stepId: step.id,
            plugin: (step as any).plugin || 'system',
            action: (step as any).action || step.type,
            data: orchestrationResult.output,
            metadata: {
              success: true,
              executedAt: new Date().toISOString(),
              executionTime: orchestrationResult.executionTime,
              tokensUsed: orchestrationResult.tokensUsed,
              // Orchestration-specific metadata
              compressionApplied: orchestrationResult.compressionApplied,
              tokensSaved: orchestrationResult.tokensSaved,
              routedModel: orchestrationResult.routedModel,
              orchestrated: true,
            },
          };
        }
      } catch (orchestrationError: any) {
        logger.warn({ err: orchestrationError, stepId: step.id }, 'Orchestration failed - falling back to normal execution');
        // Fall through to normal execution
      }
    } else if (!shouldUseOrchestration && context.orchestrator?.isActive()) {
      logger.debug({ stepId: step.id, stepType: step.type }, 'Skipping orchestration for deterministic step - executing plugin directly');
    }

    // === NORMAL EXECUTION (Fallback or when orchestration is disabled) ===

    // Log step execution start to workflow_step_executions table
    if (this.stateManager) {
      const metadata: any = {
        started_at: new Date().toISOString(),
        step_description: step.description,
      };

      // Include plugin info for action steps
      if (step.type === 'action') {
        if ((step as any).plugin) {
          metadata.plugin = (step as any).plugin;
        }
        if ((step as any).action) {
          metadata.action = (step as any).action;
        }
      }

      await this.stateManager.logStepExecution(
        context.executionId,
        step.id,
        step.name,
        step.type,
        'running',
        metadata
      );
    }

    try {
      // Resolve parameters with variable substitution
      // For action steps: resolve step.params
      // For other step types (transform, loop, etc.): resolve top-level fields
      let resolvedParams: any;

      if (step.type === 'action') {
        resolvedParams = context.resolveAllVariables(step.params || {});
      } else {
        // For non-action steps, only include fields that actually exist on the step
        const fieldsToResolve: any = {};
        const stepAny = step as any;

        if ('operation' in stepAny) fieldsToResolve.operation = stepAny.operation;
        if ('input' in stepAny) fieldsToResolve.input = stepAny.input;
        if ('config' in stepAny) fieldsToResolve.config = stepAny.config;
        if ('condition' in stepAny) fieldsToResolve.condition = stepAny.condition;
        if ('iterateOver' in stepAny) fieldsToResolve.iterateOver = stepAny.iterateOver;
        if ('maxIterations' in stepAny) fieldsToResolve.maxIterations = stepAny.maxIterations;
        if ('left' in stepAny) fieldsToResolve.left = stepAny.left;
        if ('right' in stepAny) fieldsToResolve.right = stepAny.right;
        if ('scatter' in stepAny) fieldsToResolve.scatter = stepAny.scatter;
        if ('gather' in stepAny) fieldsToResolve.gather = stepAny.gather;

        resolvedParams = context.resolveAllVariables(fieldsToResolve);
      }

      // Log variable resolution for debugging
      logger.debug({
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        paramsBefore: step.type === 'action' ? (step as ActionStep).params : step,
      }, 'Step params BEFORE resolution');

      logger.debug({
        stepId: step.id,
        stepName: step.name,
        stepType: step.type,
        paramsAfter: resolvedParams,
      }, 'Step params AFTER resolution');

      let result: any;
      let tokensUsed: number | { total: number; prompt: number; completion: number } = 0;

      // Route to appropriate executor based on step type
      switch (step.type) {
        case 'action':
          // ✅ P0 FIX: Capture plugin tokens from executeAction return value
          const actionResult = await this.executeAction(step as ActionStep, resolvedParams, context);
          result = actionResult.data;
          tokensUsed = actionResult.pluginTokens || 0;
          logger.debug({ stepId: step.id, tokensUsed }, 'Plugin action returned tokens');
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

        case 'parallel':
          // V6 Format: Parallel step with nested steps to run concurrently
          if (!this.parallelExecutor) {
            throw new ExecutionError(
              'Parallel steps require ParallelExecutor to be injected via setParallelExecutor()',
              'MISSING_PARALLEL_EXECUTOR',
              step.id
            );
          }
          logger.info({ stepId: step.id, nestedSteps: (step as any).steps?.length }, 'Executing parallel step');
          result = await this.parallelExecutor.executeParallel((step as any).steps || [], context);
          // Convert Map to object for consistent output format
          if (result instanceof Map) {
            const resultObj: Record<string, any> = {};
            result.forEach((value, key) => {
              resultObj[key] = value?.data ?? value;
            });
            result = resultObj;
          }
          break;

        case 'switch':
          result = await this.executeSwitch(step as SwitchStep, context);
          break;

        case 'scatter_gather':
          // V4 Format: Nested scatter-gather steps are delegated to ParallelExecutor
          if (!this.parallelExecutor) {
            throw new ExecutionError(
              'Scatter-gather steps require ParallelExecutor to be injected via setParallelExecutor()',
              'MISSING_PARALLEL_EXECUTOR',
              step.id
            );
          }
          logger.info({ stepId: step.id }, 'Delegating scatter-gather step to ParallelExecutor');
          result = await this.parallelExecutor.executeScatterGather(step, context);
          break;

        case 'enrichment':
          result = await this.executeEnrichment(step as EnrichmentStep, context);
          break;

        case 'validation':
          result = await this.executeValidation(step as ValidationStep, context);
          break;

        case 'comparison':
          result = await this.executeComparison(step as ComparisonStep, context);
          break;

        case 'deterministic_extraction':
          result = await this.executeDeterministicExtraction(step, resolvedParams, context);
          break;

        default:
          throw new ExecutionError(
            `Unknown step type: ${(step as any).type}`,
            'UNKNOWN_STEP_TYPE',
            step.id
          );
      }

      const executionTime = Date.now() - startTime;

      // Calculate item count for business intelligence
      // Handles both direct arrays and nested array structures
      const itemCount = this.calculateItemCount(result);

      // 🔍 Extract field names for business intelligence (BEFORE building output)
      // This ensures field_names are included in output.metadata for WorkflowPilot
      let fieldNames: string[] = [];
      if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
        // Extract field names from first item (for UI preview)
        fieldNames = Object.keys(result[0]).slice(0, 10);
        console.log(`✅ [StepExecutor] Extracted ${fieldNames.length} field names from step ${step.id}:`, fieldNames);
      } else if (result && typeof result === 'object' && !Array.isArray(result)) {
        // For object results, get top-level keys
        fieldNames = Object.keys(result).slice(0, 10);
        console.log(`✅ [StepExecutor] Extracted ${fieldNames.length} fields from object result (step ${step.id}):`, fieldNames);
      } else if (itemCount > 0) {
        // Log when we have items but no field extraction
        console.warn(`⚠️  [StepExecutor] Step ${step.id} (${step.name}) has ${itemCount} items but no field names extracted.`);
        console.warn(`    Result type: ${typeof result}, isArray: ${Array.isArray(result)}, hasData: ${result && 'data' in result}`);
      }

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
          itemCount,
          tokensUsed: tokensUsed || undefined,
          field_names: fieldNames.length > 0 ? fieldNames : undefined, // ✅ CRITICAL: Include field_names in output.metadata
        },
      };

      // 🔍 DEBUG: Log step output for debugging
      console.log(`🔍 [StepExecutor] Step ${step.id} completed:`, {
        stepId: step.id,
        stepType: step.type,
        operation: (step as any).operation,
        dataType: typeof result,
        dataIsArray: Array.isArray(result),
        dataLength: Array.isArray(result) ? result.length : undefined,
        dataPreview: Array.isArray(result)
          ? `array[${result.length}]${result.length > 0 ? ` first item: ${JSON.stringify(result[0])?.slice(0, 100) || 'undefined'}` : ' (empty)'}`
          : (JSON.stringify(result) || 'undefined').slice(0, 200)
      });

      // Cache step output in database for resume flow (privacy-first: temporary storage)
      // IMPORTANT: Must await to prevent race condition on resume
      try {
        const { executionOutputCache } = await import('./ExecutionOutputCache');
        await executionOutputCache.setStepOutput(
          context.executionId,
          step.id,
          result, // Full data (temporary in execution_trace.cached_outputs)
          {
            plugin: step.plugin,
            action: (step as any).action,
            success: true,
            execution_time: executionTime,
            tokens_used: tokensUsed || undefined,
            item_count: itemCount, // ✅ Use calculated item count
          }
        );
      } catch (err) {
        console.warn(`[StepExecutor] Failed to cache step ${step.id} output (non-critical):`, err);
      }

      // ✅ NOTE: Step execution metadata will be updated by WorkflowPilot
      // We've already included field_names in output.metadata above (line ~448)
      // WorkflowPilot will call updateStepExecution with the complete metadata

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

      logger.info({ stepId: step.id, executionTimeMs: executionTime }, 'Step completed successfully');

      // === CACHE STORAGE ===
      // Store in cache if step type is cacheable
      if (cacheableTypes.includes(step.type)) {
        const stepParams = (step as any).params || {};
        this.stepCache.set(step.id, step.type, stepParams, output);
        logger.debug({ stepId: step.id }, 'Cached step result');
      }

      return output;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      logger.error({ err: error, stepId: step.id, executionTimeMs: executionTime }, 'Step execution failed');

      // === BATCH CALIBRATION: COLLECT ISSUE AND DECIDE CONTINUATION ===
      if (context.batchCalibrationMode) {
        // Collect the issue for later presentation to user
        const issue = this.issueCollector.collectFromError(
          error,
          step.id,
          step.name,
          step.type,
          context
        );
        context.collectedIssues.push(issue);

        // Mark step as failed
        context.failedSteps.push(step.id);

        // Classify error to decide if we should continue or stop
        const classification = this.failureClassifier.classify(
          {
            message: error.message,
            code: error.code
          },
          {
            stepId: step.id,
            stepName: step.name,
            stepType: step.type,
            plugin: (step as any).plugin,
            action: (step as any).action,
            availableVariableKeys: Object.keys(context.variables),
            completedSteps: context.completedSteps,
            retryCount: 0
          }
        );

        const shouldContinue = this.shouldContinueAfterError(classification);

        logger.info({
          stepId: step.id,
          category: classification.category,
          severity: classification.severity,
          shouldContinue
        }, 'Batch calibration: error classified');

        // Update step execution to failed in database
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
              failure_category: classification.category,
              failure_sub_type: classification.sub_type,
              // @ts-ignore - adding custom field for batch calibration
              recoverable: shouldContinue
            },
            error.message
          );
        }

        if (shouldContinue) {
          // Return empty output to allow downstream steps to attempt
          logger.info({ stepId: step.id }, 'Batch calibration: continuing despite error (recoverable)');

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
              failure_category: classification.category,
              // @ts-ignore - adding custom fields for batch calibration
              failed: true,
              // @ts-ignore
              issue: issue.id,
              // @ts-ignore
              recoverable: true
            }
          };
        } else {
          // Stop execution - this is a non-recoverable error
          logger.warn({ stepId: step.id, category: classification.category }, 'Batch calibration: stopping execution (fatal error)');

          throw new ExecutionError(
            `Calibration stopped at ${step.name}: ${error.message}. ` +
            `This error prevents downstream steps from executing. ` +
            `Fix this issue and retry calibration.`,
            error.code || 'FATAL_ERROR',
            step.id,
            // @ts-ignore - adding custom flag
            { cause: error, stopCalibration: true }
          );
        }
      }

      // === NORMAL MODE: Original error handling ===
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
   *
   * ✅ P0 FIX: Track execution time and cost for direct plugin actions
   * Even though plugins don't consume LLM tokens, we track execution metadata
   * for complete platform usage analytics and cost attribution
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

    logger.info({ stepId: step.id, plugin: step.plugin, action: step.action }, 'Executing plugin action');

    const actionStartTime = Date.now();

    // ✅ SMART PARAMETER TRANSFORMATION
    // Auto-transform parameters to match plugin schema expectations
    const transformedParams = await this.transformParametersForPlugin(
      step.plugin,
      step.action,
      params,
      context
    );

    // Log transformed params for debugging plugin execution
    logger.debug({
      stepId: step.id,
      plugin: step.plugin,
      action: step.action,
      transformedParams,
    }, 'Plugin action transformed params');

    // Execute via PluginExecuterV2 (use getInstance for singleton)
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(
      context.userId,
      step.plugin,
      step.action,
      transformedParams
    );

    const actionDuration = Date.now() - actionStartTime;

    if (!result.success) {
      logger.error({
        stepId: step.id,
        plugin: step.plugin,
        action: step.action,
        error: result.error,
        message: result.message
      }, 'Plugin execution failed');
      throw new ExecutionError(
        result.message || result.error || `Plugin execution failed: ${step.plugin}.${step.action}`,
        step.id,
        { plugin: step.plugin, action: step.action, error: result.error, message: result.message }
      );
    }

    // ✅ P0 FIX: Track plugin action execution in token_usage table
    // Plugin actions don't consume LLM tokens directly, but we track equivalent token cost
    // Fetches token pricing from ais_system_config.calculator_tokens_per_plugin (default: 400)
    let pluginTokens = 0;
    try {
      // Fetch plugin token cost from database
      pluginTokens = await AISConfigService.getSystemConfig(
        this.supabase,
        'calculator_tokens_per_plugin',
        400 // Fallback default
      );

      await this.supabase.from('token_usage').insert({
        user_id: context.userId,
        agent_id: context.agentId,
        execution_id: context.executionId,
        session_id: context.sessionId,
        input_tokens: pluginTokens,  // Plugin equivalent token cost
        output_tokens: 0,  // All cost attributed to input for simplicity
        cost_usd: 0,  // Cost calculated from tokens using model pricing
        feature: 'pilot',
        component: 'plugin_action',
        activity_type: 'plugin_call',
        model_name: `${step.plugin}.${step.action}`,
        provider: 'plugin_registry_v2',
        metadata: {
          plugin: step.plugin,
          action: step.action,
          execution_time_ms: actionDuration,
          step_id: step.id,
          step_name: step.name,
          success: true,
          plugin_tokens: pluginTokens,
        }
      });

      logger.debug({
        stepId: step.id,
        plugin: step.plugin,
        action: step.action,
        durationMs: actionDuration,
        pluginTokens
      }, 'Tracked plugin action execution');
    } catch (trackingError) {
      // Token tracking failures should NOT fail plugin execution
      logger.warn({ err: trackingError, stepId: step.id }, 'Failed to track plugin action (non-critical)');
    }

    // ✅ P0 FIX: Return plugin tokens so they flow through StepOutput → ExecutionContext
    // This ensures tokens are properly tracked via setStepOutput() which handles retries correctly
    //
    // ✅ SCHEMA-DRIVEN: Attach source plugin/action metadata for downstream transforms
    // This allows transform operations to use schema-aware data handling without hardcoding
    const outputData = result.data;
    if (outputData && typeof outputData === 'object') {
      // Attach source metadata as non-enumerable properties (won't appear in JSON serialization)
      Object.defineProperty(outputData, '_sourcePlugin', {
        value: step.plugin,
        enumerable: false,
        writable: false
      });
      Object.defineProperty(outputData, '_sourceAction', {
        value: step.action,
        enumerable: false,
        writable: false
      });
      // Also attach output_schema if provided by compiler (avoids runtime lookup)
      if (step.output_schema) {
        Object.defineProperty(outputData, '_outputSchema', {
          value: step.output_schema,
          enumerable: false,
          writable: false
        });
      }
    }

    return {
      data: outputData,
      pluginTokens: pluginTokens
    };
  }

  /**
   * Transform parameters to match plugin schema expectations (GENERIC)
   *
   * Intelligently transforms parameters based on plugin schema:
   * - Detects 2D array parameters (array of arrays) and converts objects to row format
   * - Provides sensible defaults for missing required parameters
   * - Works for ALL plugins, not hardcoded to specific ones
   */
  private async transformParametersForPlugin(
    pluginName: string,
    actionName: string,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    logger.debug({ pluginName, actionName }, 'Transforming parameters for plugin action');

    try {
      // Fetch plugin definition from PluginManager
      const PluginManager = (await import('../server/plugin-manager-v2')).PluginManagerV2;
      const pluginManager = await PluginManager.getInstance();
      const pluginDef = pluginManager.getPluginDefinition(pluginName);

      if (!pluginDef || !pluginDef.actions || !pluginDef.actions[actionName]) {
        logger.warn({ pluginName, actionName }, 'No definition found - skipping transformation');
        return params;
      }

      const actionDef = pluginDef.actions[actionName];
      const paramSchema = actionDef.parameters;

      if (!paramSchema || !paramSchema.properties) {
        logger.debug({ pluginName, actionName }, 'No parameter schema found - skipping transformation');
        return params;
      }

      const transformed = { ...params };

      // Iterate through each parameter in the schema
      for (const [paramName, paramDef] of Object.entries(paramSchema.properties)) {
        const def = paramDef as any;

        // ===================================================================
        // DETECT 2D ARRAY PARAMETERS
        // Schema: { type: "array", items: { type: "array", items: {...} } }
        // ===================================================================
        const is2DArray = def.type === 'array' &&
                         def.items &&
                         def.items.type === 'array';

        if (is2DArray && transformed[paramName]) {
          const value = transformed[paramName];

          // If value is an object (not already an array), convert to 2D array
          if (typeof value === 'object' && !Array.isArray(value)) {
            logger.debug({ paramName, pluginName, actionName }, 'Converting object to 2D array for parameter');

            // Extract values from object in consistent order
            // Convert nested arrays to strings (Google Sheets doesn't accept nested arrays)
            const row = Object.values(value).map(v => {
              if (Array.isArray(v)) {
                return JSON.stringify(v);  // Convert arrays to JSON strings
              }
              if (typeof v === 'object' && v !== null) {
                return JSON.stringify(v);  // Convert objects to JSON strings
              }
              return v;  // Primitives stay as-is
            });
            transformed[paramName] = [row];  // Wrap in array to make it 2D

            logger.debug({ paramName, fieldCount: row.length }, 'Converted object to 2D array');
          }
          // If value is a 1D array, wrap it to make it 2D
          else if (Array.isArray(value) && value.length > 0 && !Array.isArray(value[0])) {
            logger.debug({ paramName }, 'Wrapping 1D array to 2D for parameter');
            transformed[paramName] = [value];
          }
        }

        // ===================================================================
        // STRING PARAMETER TYPE COERCION
        // If schema expects a string but got object/array, convert to JSON
        // ===================================================================
        if (def.type === 'string' && transformed[paramName] !== undefined) {
          const value = transformed[paramName];

          // Convert objects to JSON strings
          if (typeof value === 'object' && value !== null) {
            logger.debug({ paramName, valueType: Array.isArray(value) ? 'array' : 'object' }, 'Converting to string for parameter');

            // Check if parameter has a format hint in schema
            const formatHint = def.format || def['x-format'];

            if (formatHint === 'structured-message' || paramName.toLowerCase().includes('message')) {
              // Format as a structured, readable message
              transformed[paramName] = this.formatObjectAsMessage(value);
            } else {
              // Default: JSON with indentation
              transformed[paramName] = JSON.stringify(value, null, 2);
            }
          }
          // Convert numbers/booleans to strings
          else if (typeof value !== 'string') {
            transformed[paramName] = String(value);
          }
        }

        // ===================================================================
        // ✅ FIX: NUMBER PARAMETER TYPE COERCION
        // If schema expects number but got string, convert if valid numeric string
        // Handles cases like Google Drive returning file size as "245821" (string)
        // ===================================================================
        if ((def.type === 'number' || def.type === 'integer') && transformed[paramName] !== undefined) {
          const value = transformed[paramName];

          // Convert numeric strings to numbers
          if (typeof value === 'string') {
            // Check if it's a valid numeric string
            if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
              const numValue = def.type === 'integer' ? parseInt(value, 10) : parseFloat(value);
              if (!isNaN(numValue)) {
                transformed[paramName] = numValue;
                logger.debug({ paramName, original: value, converted: numValue }, 'Converted string to number for parameter');
              }
            }
          }
        }

        // ===================================================================
        // ✅ FIX: BOOLEAN PARAMETER TYPE COERCION
        // If schema expects boolean but got string, convert common patterns
        // ===================================================================
        if (def.type === 'boolean' && transformed[paramName] !== undefined) {
          const value = transformed[paramName];

          if (typeof value === 'string') {
            const lowerValue = value.toLowerCase().trim();
            if (lowerValue === 'true' || lowerValue === '1' || lowerValue === 'yes') {
              transformed[paramName] = true;
              logger.debug({ paramName, original: value, converted: true }, 'Converted string to boolean');
            } else if (lowerValue === 'false' || lowerValue === '0' || lowerValue === 'no') {
              transformed[paramName] = false;
              logger.debug({ paramName, original: value, converted: false }, 'Converted string to boolean');
            }
          } else if (typeof value === 'number') {
            transformed[paramName] = value !== 0;
          }
        }

        // ===================================================================
        // PROVIDE DEFAULTS FOR REQUIRED PARAMETERS
        // ===================================================================
        if (paramSchema.required &&
            paramSchema.required.includes(paramName) &&
            transformed[paramName] === undefined) {

          // Provide sensible defaults based on parameter name and type
          const defaultValue = this.getDefaultValueForParameter(paramName, def);
          if (defaultValue !== undefined) {
            transformed[paramName] = defaultValue;
            logger.debug({ paramName, defaultValue }, 'Added default value for parameter');
          }
        }
      }

      logger.debug({ pluginName, actionName, transformed }, 'Parameter transformation complete');
      return transformed;
    } catch (error) {
      logger.warn({ err: error, pluginName, actionName }, 'Parameter transformation failed (non-critical)');
      return params;  // Return original params if transformation fails
    }
  }

  /**
   * Format an object as a readable message (for messaging platforms)
   * Converts objects to nicely formatted, human-readable text
   */
  private formatObjectAsMessage(obj: any): string {
    if (Array.isArray(obj)) {
      return obj.map((item, idx) => `${idx + 1}. ${this.formatObjectAsMessage(item)}`).join('\n');
    }

    if (typeof obj !== 'object' || obj === null) {
      return String(obj);
    }

    // Format object as key-value pairs
    const lines: string[] = [];
    for (const [key, value] of Object.entries(obj)) {
      // Skip empty values
      if (value === null || value === undefined || value === '') continue;

      // Format key: make it readable
      const formattedKey = key
        .replace(/_/g, ' ')
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      // Format value based on type
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        if (value.length <= 3) {
          lines.push(`*${formattedKey}:* ${value.join(', ')}`);
        } else {
          lines.push(`*${formattedKey}:* ${value.slice(0, 3).join(', ')} (+${value.length - 3} more)`);
        }
      } else if (typeof value === 'object') {
        lines.push(`*${formattedKey}:*\n${this.formatObjectAsMessage(value).split('\n').map(l => '  ' + l).join('\n')}`);
      } else {
        lines.push(`*${formattedKey}:* ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get sensible default value for a parameter based on name and type
   */
  private getDefaultValueForParameter(paramName: string, paramDef: any): any {
    // Range parameters default to sheet name
    if (paramName.toLowerCase().includes('range')) {
      return 'Sheet1';
    }

    // If parameter has a default in schema, use it
    if (paramDef.default !== undefined) {
      return paramDef.default;
    }

    // Type-based defaults
    if (paramDef.type === 'string') return '';
    if (paramDef.type === 'number') return 0;
    if (paramDef.type === 'boolean') return false;
    if (paramDef.type === 'array') return [];
    if (paramDef.type === 'object') return {};

    return undefined;
  }

  /**
   * Determine if a step should use orchestration
   * Only AI tasks (summarize, analyze, decide) need orchestration
   * Deterministic plugin actions should execute directly
   */
  private shouldUseOrchestration(step: WorkflowStep): boolean {
    // LLM-based steps that need intelligent routing through orchestration
    // These steps require:
    // - Token budgeting per intent
    // - Model routing based on AIS + complexity scores
    // - Per-step execution tracking
    // - Compression policies
    const llmStepTypes = [
      'ai_processing',   // AI processing tasks
      'llm_decision',    // LLM-based decisions
      'summarize',       // Content summarization
      'extract',         // Information extraction
      'generate'         // Content generation
      // NOTE: 'transform' removed - most transforms are deterministic (map, filter, group, etc.)
      // Only complex transforms with AI analysis should use ai_processing type
    ];

    if (llmStepTypes.includes(step.type)) {
      return true;
    }

    // Plugin action steps should NOT use orchestration
    // These are direct API calls to external services - no LLM needed
    if (step.type === 'action') {
      return false;
    }

    // Enrich, validation, comparison - default to false for efficiency
    // These are typically deterministic operations
    return false;
  }

  /**
   * Execute LLM decision step (uses AgentKit)
   * Also handles ai_processing steps from Smart Agent Builder
   */
  private async executeLLMDecision(
    step: LLMDecisionStep | AIProcessingStep,
    params: any,
    context: ExecutionContext
  ): Promise<{ data: any; tokensUsed: { total: number; prompt: number; completion: number } }> {
    logger.info({ stepId: step.id, stepName: step.name }, 'Executing LLM decision');

    const stepStartTime = Date.now();
    let selectedModel: string | undefined;
    let routingDecision: any;

    // === PER-STEP INTELLIGENT ROUTING ===
    // TODO: Re-enable once TaskComplexityAnalyzer and PerStepModelRouter are implemented
    // Analyze step complexity and route to optimal model
    try {
      // Check if per-step routing is enabled in orchestrator config (admin UI)
      const isRoutingEnabled = context.orchestrator?.config?.aisRoutingEnabled || false;

      if (isRoutingEnabled) {
        logger.debug({ stepId: step.id }, 'Per-step routing enabled - analyzing complexity');

        // // Analyze step complexity
        // const complexityAnalysis = await this.complexityAnalyzer.analyzeStep(step, context);
        // console.log(`📊 [StepExecutor] Complexity: ${complexityAnalysis.complexityScore.toFixed(1)}/10`);

        // // Get agent AIS (Agent Intensity Score)
        // const agentAIS = (context.agent as any).agent_intensity_score || 5.0;

        // // Route to optimal model (with memory-based learning)
        // routingDecision = await this.modelRouter.routeStep(
        //   complexityAnalysis,
        //   agentAIS,
        //   (context.agent as any).model_preference,
        //   context.agentId  // Pass agentId for memory lookup
        // );

        // // Format model for AgentKit (provider:model)
        // selectedModel = `${routingDecision.selectedModel.provider}:${routingDecision.selectedModel.model}`;

        // console.log(`✅ [StepExecutor] Selected model: ${selectedModel}`);
        // console.log(`   ${routingDecision.explanation}`);

        // // Record routing decision to audit trail
        // const stepIndex = context.completedSteps.length;
        // await this.modelRouter.recordRoutingDecision(
        //   context.agentId,
        //   context.userId,
        //   context.executionId,
        //   stepIndex,
        //   step.name,
        //   step.type,
        //   complexityAnalysis,
        //   routingDecision
        // );
      } else {
        logger.debug({ stepId: step.id }, 'Per-step routing disabled - using agent default model');
      }
    } catch (routingError) {
      logger.error({ err: routingError, stepId: step.id }, 'Routing failed - falling back to agent default');
      // Continue with agent default model
    }

    // Build prompt with context
    const prompt = step.prompt || step.description || step.name;

    // FIX: Extract variable references from prompt and resolve them into params
    // This handles cases where Smart Agent Builder creates prompts like:
    // "Analyze the following emails: {{step1.data}}"
    // We need to extract step1.data and add it to params
    logger.debug({ stepId: step.id, params, prompt }, 'LLM decision original params and prompt');

    const enrichedParams = { ...params };

    // Extract all {{variable}} references from the prompt
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = prompt.match(variablePattern);

    if (matches && matches.length > 0) {
      logger.debug({ stepId: step.id, matches }, 'Found variable references in prompt');

      for (const match of matches) {
        try {
          const resolved = context.resolveVariable(match);

          // Extract the variable name for use as a key
          // e.g., "{{step1.data}}" -> "step1_data"
          const varName = match.replace(/\{\{|\}\}/g, '').replace(/\./g, '_');

          // Only add to params if it's not already there
          if (!enrichedParams[varName]) {
            enrichedParams[varName] = resolved;
            logger.debug({ stepId: step.id, varName, match }, 'Added variable to params from prompt');
          }
        } catch (error: any) {
          logger.warn({ err: error, stepId: step.id, match }, 'Could not resolve variable from prompt');
        }
      }
    }

    // If params are still empty after enrichment, try to get data from previous step
    if (Object.keys(enrichedParams).length === 0) {
      logger.debug({ stepId: step.id }, 'Params still empty - checking for previous step outputs');

      const allOutputs = context.getAllStepOutputs();
      if (allOutputs.size > 0) {
        // Get the last step's output
        const outputsArray = Array.from(allOutputs.entries());
        const [lastStepId, lastOutput] = outputsArray[outputsArray.length - 1];

        logger.debug({ stepId: step.id, lastStepId }, 'Using output from previous step as default params');
        enrichedParams.data = lastOutput.data;
      }
    }

    logger.debug({ stepId: step.id, enrichedParams }, 'LLM decision enriched params');

    const contextSummary = this.buildContextSummary(context);

    // Build prompt with vision support if images are present
    // Async to support PDF-to-image conversion
    const { fullPrompt, isVisionMode } = await this.buildLLMPrompt(
      prompt,
      contextSummary,
      enrichedParams
    );

    // Vision mode warning: runAgentKit doesn't support multimodal content
    // Vision extraction should go through orchestration (ExtractHandler)
    if (isVisionMode) {
      logger.warn({ stepId: step.id }, 'Vision mode detected but runAgentKit fallback path. Vision requires orchestration to be enabled.');
    }

    // Convert to string for runAgentKit (vision is handled by orchestration)
    const promptString = typeof fullPrompt === 'string'
      ? fullPrompt
      : fullPrompt.find((p: any) => p.type === 'text')?.text || JSON.stringify(fullPrompt);

    // Use AgentKit for intelligent decision (with optional model override)
    // If a model was selected by routing, temporarily override the agent's model preference

    // IMPORTANT: For ai_processing steps, don't pass plugins
    // ai_processing = text analysis/summarization (no tool use)
    // llm_decision = intelligent decision-making with tools (has plugin access)
    const isAIProcessing = step.type === 'ai_processing';

    const agentForExecution: any = {
      ...context.agent,
      // Filter out plugins for ai_processing to prevent LLM from calling tools
      plugins_required: isAIProcessing ? [] : context.agent.plugins_required
    };

    // Override model if selected by routing
    if (selectedModel) {
      agentForExecution.model_preference = selectedModel;
    }

    const result = await runAgentKit(
      context.userId,
      agentForExecution,
      promptString,  // Use string version (vision handled by orchestration)
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
    // TODO: Re-enable once PerStepModelRouter and RoutingMemoryService are implemented
    if (routingDecision) {
      const executionTimeMs = Date.now() - stepStartTime;
      const stepIndex = context.completedSteps.length;

      // await this.modelRouter.updateRoutingMetrics(
      //   context.executionId,
      //   stepIndex,
      //   result.tokensUsed.total,
      //   executionTimeMs,
      //   true,
      //   undefined  // Cost calculation can be added later
      // );

      // // === LEARN FROM THIS EXECUTION ===
      // // Feed the outcome back into routing memory for future optimization
      // const RoutingMemoryService = (await import('./RoutingMemoryService')).RoutingMemoryService;
      // const routingMemory = RoutingMemoryService.getInstance();

      // await routingMemory.learnFromExecution(
      //   context.agentId,
      //   context.userId,
      //   context.executionId,
      //   stepIndex,
      //   step.type,
      //   routingDecision.selectedModel.tier,
      //   true, // success (since we got here without error)
      //   result.tokensUsed.total,
      //   executionTimeMs,
      //   undefined // cost will be calculated in future
      // );
    }

    // Return AI processing result with multiple field aliases for flexibility
    // This allows users to reference the output semantically based on their use case:
    // - {{stepX.data.result}} - generic, always works
    // - {{stepX.data.summary}} - for summarization tasks
    // - {{stepX.data.analysis}} - for analysis tasks
    // - {{stepX.data.decision}} - for decision-making tasks
    // - {{stepX.data.response}} - raw response
    const aiResponse = result.response;

    // ✅ FIX: Clean summarization output to remove meta-commentary and narrative
    // Apply cleaning for summarization steps to prevent duplicate content in emails
    const shouldClean = step.name?.toLowerCase().includes('summarize') ||
                       step.prompt?.toLowerCase().includes('summarize') ||
                       step.description?.toLowerCase().includes('summarize');

    const cleanedResponse = shouldClean ? this.cleanSummaryOutput(aiResponse) : aiResponse;

    return {
      data: {
        // Generic aliases (always available)
        result: cleanedResponse,
        response: cleanedResponse,
        output: cleanedResponse,

        // Semantic aliases for common use cases
        summary: cleanedResponse,
        analysis: cleanedResponse,
        decision: cleanedResponse,
        reasoning: cleanedResponse,
        classification: cleanedResponse,

        // Additional metadata
        toolCalls: result.toolCalls,
      },
      tokensUsed: result.tokensUsed, // Return full breakdown {total, prompt, completion}
    };
  }

  /**
   * Execute conditional step
   * Supports two modes:
   * 1. Legacy: Only evaluates condition (routing handled by orchestrator)
   * 2. V4: Evaluates condition AND executes nested then_steps/else_steps
   */
  private async executeConditional(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<any> {
    const conditionalStep = step as any;
    const stepCondition = conditionalStep.condition;

    if (!stepCondition) {
      throw new ExecutionError(
        `Conditional step ${step.id} missing condition`,
        'MISSING_CONDITION',
        step.id
      );
    }

    logger.debug({ stepId: step.id, condition: stepCondition }, 'Evaluating condition');

    const conditionResult = this.conditionalEvaluator.evaluate(stepCondition, context);

    logger.info({ stepId: step.id, conditionResult }, 'Condition evaluated');

    // V4 Format: Execute nested steps based on condition
    const hasV4Format = conditionalStep.then_steps || conditionalStep.else_steps;

    if (hasV4Format) {
      logger.debug({ stepId: step.id }, 'V4 conditional detected - executing nested steps');

      const branchToExecute = conditionResult ? conditionalStep.then_steps : conditionalStep.else_steps;
      const branchName = conditionResult ? 'then_steps' : 'else_steps';

      if (branchToExecute && Array.isArray(branchToExecute) && branchToExecute.length > 0) {
        logger.info({ stepId: step.id, branchName, stepCount: branchToExecute.length }, 'Executing conditional branch');

        const branchResults: any[] = [];

        // Execute each step in the branch sequentially
        for (let i = 0; i < branchToExecute.length; i++) {
          const branchStep = branchToExecute[i];
          logger.debug({ stepId: step.id, branchName, index: i, branchStepId: branchStep.id, branchStepType: branchStep.type }, 'Executing branch step');

          try {
            const branchStepResult = await this.execute(branchStep, context);
            branchResults.push(branchStepResult);

            // Store the result in context so subsequent steps can reference it
            context.setStepOutput(branchStep.id, branchStepResult);
          } catch (error: any) {
            logger.error({ err: error, stepId: step.id, branchName, branchStepId: branchStep.id }, 'Error executing branch step');

            // If continueOnError is set, log and continue
            if (branchStep.continueOnError) {
              logger.warn({ stepId: step.id, branchStepId: branchStep.id }, 'continueOnError=true - continuing despite error');
              branchResults.push({ error: error.message, stepId: branchStep.id });
            } else {
              throw error;
            }
          }
        }

        return {
          result: conditionResult,
          condition: stepCondition,
          branch: branchName,
          branchResults,
          executedSteps: branchToExecute.length,
        };
      } else {
        logger.debug({ stepId: step.id, branchName }, 'No steps to execute in branch');
        return {
          result: conditionResult,
          condition: stepCondition,
          branch: branchName,
          branchResults: [],
          executedSteps: 0,
        };
      }
    }

    // Legacy Format: Only evaluate condition (orchestrator handles routing)
    logger.debug({ stepId: step.id }, 'Legacy conditional - returning evaluation only');
    return {
      result: conditionResult,
      condition: stepCondition,
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
    logger.info({ stepId: step.id }, 'Executing switch step');

    // Evaluate the switch expression
    const evaluatedValue = context.resolveVariable?.(step.evaluate) ?? step.evaluate;
    const valueStr = String(evaluatedValue);

    logger.debug({ stepId: step.id, expression: step.evaluate, evaluatedValue: valueStr }, 'Switch expression evaluated');

    // Find matching case
    let matchedSteps: string[] | undefined;

    if (step.cases[valueStr]) {
      matchedSteps = step.cases[valueStr];
      logger.info({ stepId: step.id, matchedCase: valueStr, matchedSteps }, 'Matched switch case');
    } else if (step.default) {
      matchedSteps = step.default;
      logger.warn({ stepId: step.id, defaultSteps: matchedSteps }, 'No match - using default case');
    } else {
      logger.warn({ stepId: step.id }, 'No match and no default case');
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
    logger.info({ stepId: step.id }, 'Executing enrichment step');

    // Resolve all sources
    const sources: Record<string, any> = {};
    for (const source of step.sources) {
      const value = context.resolveVariable?.(source.from) ?? null;
      sources[source.key] = value;
      logger.debug({ stepId: step.id, sourceKey: source.key, sourceFrom: source.from }, 'Source resolved');
    }

    // Enrich data using DataOperations
    const result = DataOperations.enrich(sources, step.strategy, {
      joinOn: step.joinOn,
      mergeArrays: step.mergeArrays,
    });

    logger.info({ stepId: step.id, strategy: step.strategy }, 'Enrichment complete');

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
    logger.info({ stepId: step.id }, 'Executing validation step');

    // Resolve input data
    const data = context.resolveVariable?.(step.input);

    // Validate using DataOperations
    const validationResult = DataOperations.validate(data, step.schema, step.rules);

    logger.info({ stepId: step.id, valid: validationResult.valid, errorCount: validationResult.errors.length }, 'Validation complete');

    // Handle validation failure
    if (!validationResult.valid) {
      const onFail = step.onValidationFail || 'throw';

      if (onFail === 'throw') {
        throw new ExecutionError(
          `Validation failed: ${validationResult.errors.join(', ')}`,
          step.id,
          { errors: validationResult.errors }
        );
      } else if (onFail === 'skip') {
        logger.warn({ stepId: step.id, errors: validationResult.errors }, 'Validation failed - skipping step');
        context.markStepSkipped(step.id);
      }
      // If 'continue', just log and return result (don't mark as failed or skipped)
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
    logger.info({ stepId: step.id }, 'Executing comparison step');

    // Resolve left and right values
    const leftValue = context.resolveVariable?.(step.left);
    const rightValue = context.resolveVariable?.(step.right);

    logger.debug({ stepId: step.id, left: step.left, right: step.right, operation: step.operation }, 'Comparing values');

    // Compare using DataOperations
    const result = DataOperations.compare(
      leftValue,
      rightValue,
      step.operation,
      step.outputFormat || 'boolean'
    );

    logger.info({ stepId: step.id, operation: step.operation }, 'Comparison complete');

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

    logger.info({ stepId: step.id, operation }, 'Executing transform');
    logger.debug({ stepId: step.id, params }, 'Transform params');

    // ✅ FIX: Input has already been resolved by resolveAllVariables (line 175-188)
    // Don't try to resolve again, just use it directly
    let data = input !== undefined ? input : params.data;

    // 🔍 DEBUG: Log what we're actually receiving
    // Note: JSON.stringify(undefined) returns undefined (not a string), so we need to handle this
    const inputValueForLog = input === undefined
      ? 'undefined'
      : Array.isArray(input)
        ? `array[${input.length}]`
        : (JSON.stringify(input) || 'null').slice(0, 200);
    logger.debug({
      stepId: step.id,
      operation,
      inputType: typeof input,
      inputIsArray: Array.isArray(input),
      inputValue: inputValueForLog,
      dataType: typeof data,
      dataIsArray: Array.isArray(data)
    }, '🔍 Transform input received');

    if (!data) {
      logger.error({
        stepId: step.id,
        availableVariables: Object.keys(context.variables),
        params
      }, 'Transform step has no input data');
      throw new ExecutionError(
        `Transform step ${step.id} has no input data. Available variables: ${Object.keys(context.variables).join(', ')}`,
        'MISSING_INPUT_DATA',
        step.id
      );
    }

    // Handle case where input resolves to a StepOutput object instead of direct data
    // This happens when using {{stepX}} instead of {{stepX.data}} or {{stepX.data.field}}
    // Similar to ParallelExecutor.executeScatterGather() auto-extraction logic
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Check if it's a StepOutput structure: {stepId, plugin, action, data, metadata}
      if (data.stepId && data.data !== undefined) {
        logger.debug({ stepId: step.id }, 'Detected StepOutput object, extracting data field');
        const extractedData = data.data;

        // Case 1: data is already an array (common for collect/reduce operations or previous transforms)
        if (Array.isArray(extractedData)) {
          logger.debug({ stepId: step.id, length: extractedData.length }, 'StepOutput.data is an array - using directly');
          data = extractedData;
        }
        // Case 2: data is an object - try to find the most appropriate field
        else if (extractedData && typeof extractedData === 'object') {
          // Use SchemaAwareDataExtractor for consistent array extraction
          // This replaces hardcoded field name lists with schema-driven detection
          const sourcePlugin = (extractedData as any)._sourcePlugin;
          const sourceAction = (extractedData as any)._sourceAction;

          const extractedArray = await schemaExtractor.extractArray(
            extractedData,
            sourcePlugin,
            sourceAction
          );

          if (extractedArray.length > 0 || Array.isArray(extractedArray)) {
            logger.debug({ stepId: step.id, length: extractedArray.length, sourcePlugin, sourceAction },
              'Schema-aware array extraction from StepOutput.data');
            data = extractedArray;
          } else {
            // No array fields found - for some operations (like 'set'), we might want the object itself
            // Only throw error for operations that explicitly require arrays
            if (['filter', 'map', 'reduce', 'sort', 'deduplicate', 'flatten', 'group', 'aggregate'].includes(operation)) {
              logger.error({ stepId: step.id, availableFields: Object.keys(extractedData) },
                'StepOutput.data has no array fields for array-requiring operation');
              throw new ExecutionError(
                `Transform step ${step.id} (operation: ${operation}): input resolved to StepOutput but data has no array fields. Available fields: ${Object.keys(extractedData).join(', ')}. Consider using {{input.data.FIELD}} to specify which field to use.`,
                step.id,
                { errorCode: 'INVALID_TRANSFORM_INPUT', availableFields: Object.keys(extractedData), operation }
              );
            }
            // For other operations, use the object as-is
            logger.debug({ stepId: step.id }, 'Using StepOutput.data object for non-array operation');
            data = extractedData;
          }
        }
        // Case 3: data is a primitive or null
        else {
          // For operations like 'set', primitives might be acceptable
          if (['filter', 'map', 'reduce', 'sort', 'deduplicate', 'flatten', 'group', 'aggregate'].includes(operation)) {
            throw new ExecutionError(
              `Transform step ${step.id} (operation: ${operation}): input resolved to StepOutput with non-object data (type: ${typeof extractedData}). This operation requires array input.`,
              step.id,
              { errorCode: 'INVALID_TRANSFORM_INPUT', dataType: typeof extractedData, operation }
            );
          }
          logger.debug({ stepId: step.id, dataType: typeof extractedData }, 'Using primitive from StepOutput.data');
          data = extractedData;
        }
      }
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

      case 'deduplicate':
        return this.transformDeduplicate(data, config);

      case 'flatten':
        return this.transformFlatten(data, config);

      case 'join':
        return this.transformJoin(data, config);

      case 'pivot':
        return this.transformPivot(data, config);

      case 'split':
        return this.transformSplit(data, config);

      case 'expand':
        return this.transformExpand(data, config);

      case 'rows_to_objects':
        return this.transformRowsToObjects(data, config);

      case 'map_headers':
        return this.transformMapHeaders(data, config);

      case 'partition':
        return this.transformPartition(data, config);

      case 'group_by':
        // Alias for 'group' operation
        return this.transformGroup(data, config);

      case 'render_table':
        return this.transformRenderTable(data, config);

      case 'fetch_content':
        return await this.transformFetchContent(data, config, context);

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
   * Supports converting array of objects to 2D array for Google Sheets
   */
  private transformMap(data: any[], config: any, context: ExecutionContext): any[] | any[][] {
    // 🔍 DEBUG: Log what transformMap received
    console.log('🔍 [transformMap] Received data:', {
      type: typeof data,
      isArray: Array.isArray(data),
      value: Array.isArray(data) ? `array[${data.length}]` : JSON.stringify(data).slice(0, 300)
    });

    if (!Array.isArray(data)) {
      throw new ExecutionError('Map operation requires array input', 'INVALID_INPUT_TYPE');
    }

    // Check if config has an expression field (JavaScript expression to evaluate)
    if (config && config.expression && typeof config.expression === 'string') {
      // Evaluate JavaScript expression for the entire array
      // Expression should reference 'item' variable (e.g., "item.map(row => [row.a, row.b])")
      try {
        // ✅ CRITICAL FIX: Resolve all {{...}} variables in the expression before evaluation
        // The expression may reference other steps like {{step6.data}} which need to be resolved
        let resolvedExpression = config.expression;

        // Find all {{...}} patterns and resolve them
        const variablePattern = /\{\{([^}]+)\}\}/g;
        const matches = [...config.expression.matchAll(variablePattern)];

        for (const match of matches) {
          const fullMatch = match[0]; // e.g., "{{step6.data}}"
          const varPath = match[1];   // e.g., "step6.data"

          try {
            const resolvedValue = context.resolveVariable(fullMatch);

            // 🔍 DEBUG: Log what we resolved
            console.log(`🔍 [transformMap] Resolved ${fullMatch}:`, {
              type: typeof resolvedValue,
              isArray: Array.isArray(resolvedValue),
              value: Array.isArray(resolvedValue)
                ? `array[${resolvedValue.length}]`
                : JSON.stringify(resolvedValue).slice(0, 200)
            });

            // Replace the {{...}} with the resolved value
            // For arrays and objects, we need to inject them as JSON that will be parsed
            // ✅ CRITICAL: Check for array FIRST, before other type checks
            // Empty arrays [] would pass the truthiness check but String([]) returns "" - FIXED
            if (Array.isArray(resolvedValue)) {
              // Always use JSON.stringify for arrays (including empty arrays)
              resolvedExpression = resolvedExpression.replace(fullMatch, JSON.stringify(resolvedValue));
            } else if (typeof resolvedValue === 'object' && resolvedValue !== null) {
              // Non-array objects - serialize as JSON
              resolvedExpression = resolvedExpression.replace(fullMatch, JSON.stringify(resolvedValue));
            } else if (typeof resolvedValue === 'string') {
              // Strings need to be JSON-escaped to preserve quotes
              resolvedExpression = resolvedExpression.replace(fullMatch, JSON.stringify(resolvedValue));
            } else if (typeof resolvedValue === 'number' || typeof resolvedValue === 'boolean') {
              // Numbers and booleans can be inserted directly
              resolvedExpression = resolvedExpression.replace(fullMatch, String(resolvedValue));
            } else if (resolvedValue === undefined || resolvedValue === null) {
              // ✅ CRITICAL FIX: Handle null/undefined from empty lookup data sources
              // When a lookup sheet is empty, step6.data is null
              // For expressions using .includes(), treat null as empty array []
              // This prevents "Cannot read properties of null (reading 'includes')" errors

              logger.warn({
                variable: fullMatch,
                resolvedValue,
                expression: config.expression
              }, 'Variable resolved to null/undefined - checking for array operations');

              // Check if the expression is using array methods on this variable
              const afterVariable = config.expression.split(fullMatch)[1] || '';
              const usesArrayMethods = /^\s*\.(includes|indexOf|find|filter|map|some|every)\(/.test(afterVariable);

              // ✅ FIX: Also check for common null-safety patterns
              // Patterns like: ({{var}} || []).includes() or ({{var}}) || []
              const expressionStr = config.expression;
              const hasNullSafetyPattern =
                // Pattern: ({{var}} || []) - user already handles null
                expressionStr.includes(`(${fullMatch} || [])`) ||
                expressionStr.includes(`(${fullMatch}||[])`) ||
                // Pattern: {{var}} || [] - direct fallback
                new RegExp(`${fullMatch.replace(/[{}]/g, '\\$&')}\\s*\\|\\|\\s*\\[\\]`).test(expressionStr);

              if (usesArrayMethods) {
                // Replace with empty array for array method operations
                resolvedExpression = resolvedExpression.replace(fullMatch, '[]');
                logger.info({
                  variable: fullMatch,
                  replacedWith: '[]'
                }, 'Replaced null with [] for array operation');
              } else if (hasNullSafetyPattern) {
                // User already has null safety pattern - use null and let || [] handle it
                resolvedExpression = resolvedExpression.replace(fullMatch, 'null');
                logger.info({
                  variable: fullMatch,
                  replacedWith: 'null',
                  reason: 'null-safety pattern detected'
                }, 'Replaced with null - user has fallback pattern');
              } else {
                // Check context: is this variable likely to be used as array?
                // If entire expression structure suggests array usage, use []
                const looksLikeArrayUsage = expressionStr.includes('.map(') ||
                  expressionStr.includes('.filter(') ||
                  expressionStr.includes('.some(') ||
                  expressionStr.includes('.every(') ||
                  expressionStr.includes('.includes(') ||
                  expressionStr.includes('.indexOf(') ||
                  expressionStr.includes('.find(') ||
                  expressionStr.includes('.forEach(');

                if (looksLikeArrayUsage) {
                  resolvedExpression = resolvedExpression.replace(fullMatch, '[]');
                  logger.info({
                    variable: fullMatch,
                    replacedWith: '[]',
                    reason: 'expression uses array methods'
                  }, 'Replaced null with [] - expression uses array methods');
                } else {
                  // For non-array operations, use the literal null
                  resolvedExpression = resolvedExpression.replace(fullMatch, 'null');
                }
              }
            } else {
              resolvedExpression = resolvedExpression.replace(fullMatch, String(resolvedValue));
            }
          } catch (error: any) {
            console.error(`❌ [transformMap] Failed to resolve ${fullMatch}:`, error.message);
            logger.warn({
              variable: fullMatch,
              error: error.message
            }, 'Failed to resolve variable in map expression');
            // ✅ FIX: Replace failed variable with [] for array contexts
            if (config.expression.includes('.includes(') || config.expression.includes('.map(')) {
              resolvedExpression = resolvedExpression.replace(fullMatch, '[]');
              console.log(`✅ [transformMap] Replaced failed ${fullMatch} with []`);
            }
          }
        }

        // 🔍 DEBUG: Log the resolved expression before evaluation
        console.log(`🔍 [transformMap] Final expression:`, resolvedExpression.slice(0, 200));

        // ✅ SMART TUPLE EXTRACTION DETECTION
        // If the expression is trying to extract `row[0]` from each item (tuple unwrap pattern),
        // but the data is already unwrapped (items are objects, not arrays), skip the expression
        // and return the data as-is. This handles cases where auto-unwrap already happened upstream.
        const isTupleUnwrapExpression = /item\.map\s*\(\s*\w+\s*=>\s*\w+\[0\]\s*\)/.test(resolvedExpression);
        if (isTupleUnwrapExpression && Array.isArray(data) && data.length > 0) {
          const firstItem = data[0];
          // Check if data is NOT tuples (i.e., items are objects, not arrays)
          const isAlreadyUnwrapped = firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem);
          if (isAlreadyUnwrapped) {
            console.log(`✅ [transformMap] Detected tuple unwrap expression but data is already unwrapped objects - returning data as-is`);
            logger.info({
              expression: resolvedExpression.slice(0, 100),
              firstItemType: typeof firstItem,
              itemCount: data.length
            }, 'Skipping tuple unwrap - data already contains objects');
            return data;
          }
        }

        // The expression operates on the whole array, so we evaluate it once
        const evalFn = new Function('item', `return ${resolvedExpression}`);
        const result = evalFn(data);

        return result;
      } catch (error: any) {
        throw new ExecutionError(
          `Map expression evaluation failed: ${error.message}. Expression: ${config.expression}`,
          'EXPRESSION_EVAL_ERROR'
        );
      }
    }

    // Check if this is a Google Sheets format conversion (columns + add_headers)
    if (config && config.columns && Array.isArray(config.columns)) {
      const columns = config.columns;  // Data field names for extraction
      const headerNames = config.header_names || columns;  // Semantic names for display headers
      const result: any[][] = [];

      // ✅ CRITICAL FIX: Only add headers when there's actual data to append
      // This prevents adding empty header rows on every execution when no new items exist
      const hasData = data && data.length > 0;

      // Determine if we should add headers
      let shouldAddHeaders = false;
      if (config.add_headers && hasData) {
        // Check if add_headers_source is specified - only add if that source is empty
        // This allows: "add_headers": true, "add_headers_source": "{{step2.data.values}}"
        if (config.add_headers_source) {
          const sourceData = context.resolveVariable(config.add_headers_source);
          // Only add headers if the source sheet was empty
          shouldAddHeaders = !sourceData || (Array.isArray(sourceData) && sourceData.length === 0);
        } else {
          // No source specified - always add headers (legacy behavior, not recommended)
          shouldAddHeaders = true;
        }
      }

      // Add header row if conditions are met
      // Use semantic header_names for display if provided, otherwise use data field names
      if (shouldAddHeaders) {
        result.push(headerNames.map((col: string) => col));
      }

      // Convert each object to array row based on column order
      // Use findFieldValue for fuzzy matching of semantic column names to data fields
      data.forEach(item => {
        const row = columns.map((col: string, index: number) => {
          // Try the data column name first, then the semantic header name for fuzzy matching
          let value = this.findFieldValue(item, col, {});

          // If not found with data column, try semantic header name
          if (value === undefined && headerNames[index] && headerNames[index] !== col) {
            value = this.findFieldValue(item, headerNames[index], {});
          }

          return value !== undefined && value !== null ? String(value) : '';
        });
        result.push(row);
      });

      return result;
    }

    // Standard map operation with mapping configuration
    const mapping = config || {};
    return data.map(item => {
      const mapped: any = {};

      // Create temporary context with current item
      const tempContext = context.clone();
      tempContext.setVariable('item', item);

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
   *
   * Returns a structured object with backward compatibility:
   * - New workflows: use {{stepX.data.items}} or {{stepX.data.filtered}}
   * - Legacy workflows: array-like object with [index] access
   */
  private transformFilter(data: any[], config: any, context: ExecutionContext): any {
    if (!Array.isArray(data)) {
      const dataType = data === null ? 'null' : data === undefined ? 'undefined' : typeof data;
      const dataPreview = data && typeof data === 'object'
        ? `object with keys: ${Object.keys(data).join(', ')}`
        : String(data).substring(0, 100);
      throw new ExecutionError(
        `Filter operation requires array input, but received ${dataType}. Data: ${dataPreview}`,
        'INVALID_INPUT_TYPE'
      );
    }

    const originalCount = data.length;
    const conditionStr = typeof config.condition === 'string' ? config.condition : '';

    // ✅ Detect pre-computed boolean tuple pattern: item[1] == true/false
    // This pattern is used when complex filters can't be evaluated directly
    // The data contains [originalItem, booleanResult] tuples
    const isTupleFilterPattern = conditionStr.includes('item[1]') &&
      (conditionStr.includes('== true') || conditionStr.includes('== false') ||
       conditionStr.includes('=== true') || conditionStr.includes('=== false'));

    if (isTupleFilterPattern) {
      logger.debug({ condition: conditionStr }, 'Detected tuple filter pattern - will auto-unwrap results');
    }

    console.log(`🔍 [transformFilter] Filtering ${data.length} items with condition:`, JSON.stringify(config.condition).slice(0, 200));
    if (data.length > 0) {
      const sample = data[0];
      console.log(`🔍 [transformFilter] First item type:`, Array.isArray(sample) ? `array[${sample.length}]` : (sample && typeof sample === 'object' ? `object{${Object.keys(sample).slice(0, 5).join(',')}}` : typeof sample));
    }

    const filtered = data.filter(item => {
      // Create temporary context with current item
      const tempContext = context.clone();
      tempContext.setVariable('item', item);

      return this.conditionalEvaluator.evaluate(config.condition, tempContext);
    });

    // ✅ AUTO-UNWRAP: If this was a tuple filter pattern, extract the original items
    // This saves an extra map step and prevents [item, boolean] tuples from leaking
    let finalFiltered = filtered;
    if (isTupleFilterPattern && filtered.length > 0) {
      // Check if first item is actually a tuple (array with 2 elements)
      const firstItem = filtered[0];
      if (Array.isArray(firstItem) && firstItem.length === 2) {
        logger.info({
          originalCount: filtered.length
        }, 'Auto-unwrapping tuple filter results - extracting item[0] from each tuple');

        // Extract original items from tuples
        finalFiltered = filtered.map(tuple => tuple[0]);
      }
    }

    // ✅ CRITICAL FIX: Return actual array for proper array operations
    // The filtered array is the primary data - downstream steps expect Array.isArray() to be true
    // We add metadata properties directly to the array object for backward compatibility
    const result: any = finalFiltered;

    // Add metadata properties for backward compatibility with FilterHandler output
    result.items = finalFiltered;
    result.filtered = finalFiltered;
    result.removed = originalCount - finalFiltered.length;
    result.originalCount = originalCount;
    result.count = finalFiltered.length;

    return result;
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
   * Supports both single-field and multi-level sorting:
   * - Single: { sort_by: 'field', order: 'asc' }
   * - Multi: { sort_by: [{ field: 'Priority', direction: 'desc' }, { field: 'date', direction: 'asc' }] }
   *
   * Also supports legacy format:
   * - { field: 'fieldName', order: 'asc' }
   */
  private transformSort(data: any[], config: any): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Sort operation requires array input', 'INVALID_INPUT_TYPE');
    }

    // Normalize config to multi-level sort format
    let sortCriteria: Array<{ field: string; direction: string; type?: string }> = [];

    if (Array.isArray(config.sort_by)) {
      // Multi-level sort: sort_by is array of { field, direction }
      sortCriteria = config.sort_by.map((s: any) => ({
        field: s.field,
        direction: s.direction || s.order || 'asc',
        type: s.type
      }));
    } else if (config.sort_by) {
      // Single sort with sort_by string
      sortCriteria = [{
        field: config.sort_by,
        direction: config.order || 'asc',
        type: config.type
      }];
    } else if (config.field) {
      // Legacy format: { field, order }
      sortCriteria = [{
        field: config.field,
        direction: config.order || 'asc',
        type: config.type
      }];
    }

    if (sortCriteria.length === 0) {
      return data; // No sort criteria, return as-is
    }

    return [...data].sort((a, b) => {
      // Apply each sort criterion in order until we find a difference
      for (const criterion of sortCriteria) {
        const result = this.compareByCriterion(a, b, criterion);
        if (result !== 0) {
          return result;
        }
      }
      return 0; // All criteria are equal
    });
  }

  /**
   * Compare two items by a single sort criterion
   */
  private compareByCriterion(
    a: any,
    b: any,
    criterion: { field: string; direction: string; type?: string }
  ): number {
    const { field, direction, type } = criterion;
    let aVal = field ? a[field] : a;
    let bVal = field ? b[field] : b;

    // Auto-detect and handle date values
    const isDateField = type === 'date' || type === 'datetime' ||
      (typeof aVal === 'string' && this.looksLikeDate(aVal)) ||
      (typeof bVal === 'string' && this.looksLikeDate(bVal));

    if (isDateField) {
      const aTime = this.parseToTimestamp(aVal);
      const bTime = this.parseToTimestamp(bVal);

      if (aTime !== null && bTime !== null) {
        aVal = aTime;
        bVal = bTime;
      }
    }

    // Handle numeric strings for proper numeric sorting
    const isNumericField = type === 'number' ||
      (typeof aVal === 'string' && /^-?\d+(\.\d+)?$/.test(aVal.trim())) ||
      (typeof bVal === 'string' && /^-?\d+(\.\d+)?$/.test(bVal?.trim() || ''));

    if (isNumericField && typeof aVal === 'string') {
      aVal = parseFloat(aVal);
      bVal = parseFloat(bVal);
    }

    // Handle null/undefined - sort them to end
    if (aVal === null || aVal === undefined) return direction === 'desc' ? -1 : 1;
    if (bVal === null || bVal === undefined) return direction === 'desc' ? 1 : -1;

    // Compare values
    if (direction === 'desc') {
      return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
    } else {
      return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
    }
  }

  /**
   * Helper: Check if a string looks like a date
   */
  private looksLikeDate(value: string): boolean {
    if (!value || typeof value !== 'string') return false;

    // ISO 8601: 2024-01-15T10:30:00Z or 2024-01-15
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value)) return true;

    // Common date formats: 01/15/2024, 15/01/2024, Jan 15, 2024
    if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(value)) return true;
    if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}$/.test(value)) return true;

    return false;
  }

  /**
   * Helper: Parse various date formats to Unix timestamp
   */
  private parseToTimestamp(value: any): number | null {
    if (value === null || value === undefined) return null;

    // Already a number (Unix timestamp)
    if (typeof value === 'number') return value;

    // Date object
    if (value instanceof Date) return value.getTime();

    // String - try parsing
    if (typeof value === 'string') {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return date.getTime();
      }
    }

    return null;
  }

  /**
   * Group transformation
   *
   * Returns a structured object with backward compatibility:
   * - New workflows: use {{stepX.data.groups}}, {{stepX.data.keys}}, or {{stepX.data.grouped}}
   * - Legacy workflows: direct key access via {{stepX.data['key']}} still works
   */
  /**
   * Group transformation - GENERIC for ALL data structure patterns
   *
   * Supports:
   * - 2D arrays: group by column name
   * - Arrays of objects: group by field name (including nested like "fields.Status")
   * - Arrays of primitives: group by value
   */
  private transformGroup(data: any[], config: any): any {
    // CRITICAL: Unwrap structured output from previous steps
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError(
        `Group operation requires array input. Received: ${typeof unwrappedData}. ` +
        `If this is from a previous step, make sure to reference the array field (e.g., step1.values, step1.items, step1.records)`,
        'INVALID_INPUT_TYPE'
      );
    }

    const { field, groupBy, column } = config;
    const groupKey = column || field || groupBy; // Support 'column', 'field', and 'groupBy'

    // Detect if 2D array pattern
    const is2DArray = Array.isArray(unwrappedData[0]);

    // Build grouped object using generic extractValueByKey
    const grouped = unwrappedData.reduce((acc, item, index) => {
      // Skip header row for 2D arrays
      if (is2DArray && index === 0) {
        return acc;
      }

      const key = groupKey
        ? String(this.extractValueByKey(item, groupKey, unwrappedData))
        : String(item);

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {} as Record<string, any[]>);

    logger.debug({ groupKey: groupKey || 'value', groupCount: Object.keys(grouped).length, is2DArray }, 'Grouped data');

    // Return both grouped object and array of groups for iteration
    const groups = Object.entries(grouped).map(([key, items]) => ({
      key,
      items: items as any[],
      count: (items as any[]).length
    }));

    const result: any = {
      grouped,        // Original grouped object: { "Offir Omer": [...], "David Mor": [...] }
      groups,         // Array of groups for iteration: [{key: "Offir Omer", items: [...], count: 3}, ...]
      keys: Object.keys(grouped),  // Array of unique keys: ["Offir Omer", "David Mor"]
      count: groups.length         // Number of unique groups
    };

    // ✅ BACKWARD COMPATIBILITY: Add grouped keys directly to result
    // Allows {{stepX.data['key']}} to work like before
    Object.keys(grouped).forEach(key => {
      result[key] = grouped[key];
    });

    return result;
  }

  /**
   * Aggregate transformation
   * Supports two formats:
   * 1. New format: { aggregations: [{ field, operation, alias }] }
   * 2. Legacy format: { aggregation_type: 'sum', field: 'amount' }
   */
  private transformAggregate(data: any[], config: any): any {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Aggregate operation requires array input', 'INVALID_INPUT_TYPE');
    }

    let { aggregations } = config;

    // Handle legacy format: { aggregation_type, field }
    if (!aggregations && config.aggregation_type) {
      aggregations = [{
        operation: config.aggregation_type,
        field: config.field || null,
        alias: config.alias || config.field || config.aggregation_type
      }];
    }

    if (!aggregations || !Array.isArray(aggregations)) {
      throw new ExecutionError('Aggregate operation requires aggregations config', 'MISSING_AGGREGATIONS');
    }

    const result: any = {};

    aggregations.forEach((agg: any) => {
      const { field, operation, alias } = agg;
      const key = alias || (field ? `${field}_${operation}` : operation);

      // For count without field, count all items; otherwise filter by field
      const values = field
        ? data.map(item => item[field]).filter(v => v !== undefined && v !== null)
        : data;

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
   * Rows-to-Objects transformation
   * Converts a 2D array (like Google Sheets data) to an array of objects
   * Uses the first row as headers/field names
   *
   * Input: [["id", "name", "email"], ["1", "John", "john@example.com"], ["2", "Jane", "jane@example.com"]]
   * Output: [{id: "1", name: "John", email: "john@example.com"}, {id: "2", name: "Jane", email: "jane@example.com"}]
   */
  private transformRowsToObjects(data: any[], config: any): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('rows_to_objects operation requires array input', 'INVALID_INPUT_TYPE');
    }

    if (data.length === 0) {
      logger.debug({}, 'rows_to_objects: Empty input array, returning empty array');
      return [];
    }

    // Check if this is a 2D array (array of arrays)
    if (!Array.isArray(data[0])) {
      // Already an array of objects or primitives - return as-is
      logger.debug({}, 'rows_to_objects: Input is not a 2D array, returning as-is');
      return data;
    }

    // Get headers from first row (or use config.headers if provided)
    const headers: string[] = config?.headers || data[0];

    // Skip first row if it was used as headers
    const dataRows = config?.headers ? data : data.slice(1);

    if (dataRows.length === 0) {
      logger.debug({}, 'rows_to_objects: No data rows after header, returning empty array');
      return [];
    }

    // Convert each row to an object using headers as keys
    const result = dataRows.map((row: any[]) => {
      const obj: Record<string, any> = {};
      headers.forEach((header: string, index: number) => {
        // Normalize header names: trim whitespace, handle empty headers
        // ✅ CRITICAL FIX: Convert to lowercase for consistent key matching
        // Sheet headers may be "Id" or "ID" but code expects "id"
        const key = (header || `column_${index}`).toString().trim().toLowerCase();
        obj[key] = row[index] !== undefined ? row[index] : null;
      });
      return obj;
    });

    logger.debug({
      inputRows: data.length,
      outputObjects: result.length,
      headers: headers.slice(0, 5)
    }, 'rows_to_objects: Converted 2D array to objects');

    return result;
  }

  /**
   * Map headers transformation
   * Normalizes or renames headers in a 2D array based on required_headers config
   */
  private transformMapHeaders(data: any[], config: any): any[] {
    if (!Array.isArray(data) || data.length === 0) {
      return data;
    }

    // If not a 2D array, return as-is
    if (!Array.isArray(data[0])) {
      logger.debug({}, 'map_headers: Input is not a 2D array, returning as-is');
      return data;
    }

    const { required_headers, header_mapping } = config || {};
    const headerRow = [...data[0]];
    const dataRows = data.slice(1);

    // If header_mapping provided, rename headers
    if (header_mapping && typeof header_mapping === 'object') {
      for (let i = 0; i < headerRow.length; i++) {
        const oldHeader = String(headerRow[i]).trim();
        if (header_mapping[oldHeader]) {
          headerRow[i] = header_mapping[oldHeader];
        }
      }
    }

    // Normalize headers (trim whitespace, lowercase)
    const normalizedHeaders = headerRow.map((h: any) =>
      String(h || '').trim()
    );

    logger.debug({
      originalHeaders: data[0].slice(0, 5),
      normalizedHeaders: normalizedHeaders.slice(0, 5),
      requiredHeaders: required_headers
    }, 'map_headers: Normalized headers');

    return [normalizedHeaders, ...dataRows];
  }

  /**
   * Partition transformation
   * Splits data into partitions based on a field value
   */
  private transformPartition(data: any[], config: any): any {
    if (!Array.isArray(data)) {
      return { assigned: [], unassigned: [] };
    }

    const { field, handle_empty = 'separate' } = config || {};

    if (!field) {
      logger.warn({}, 'partition: No field specified, returning all as assigned');
      return { assigned: data, unassigned: [] };
    }

    const partitions: Record<string, any[]> = {};
    const unassigned: any[] = [];

    for (const item of data) {
      const value = this.extractValueByKey(item, field, data);

      if (value === null || value === undefined || value === '') {
        if (handle_empty === 'separate') {
          unassigned.push(item);
        } else if (handle_empty === 'skip') {
          // Skip items with empty values
          continue;
        } else {
          // Default: treat as 'empty' partition
          const key = '__empty__';
          if (!partitions[key]) partitions[key] = [];
          partitions[key].push(item);
        }
      } else {
        const key = String(value);
        if (!partitions[key]) partitions[key] = [];
        partitions[key].push(item);
      }
    }

    logger.debug({
      field,
      partitionCount: Object.keys(partitions).length,
      unassignedCount: unassigned.length
    }, 'partition: Partitioned data');

    return {
      partitions,
      assigned: Object.values(partitions).flat(),
      unassigned
    };
  }

  /**
   * Render table transformation
   * Converts data to an HTML table or formatted string representation
   */
  private transformRenderTable(data: any, config: any): string {
    // ✅ SMART PASSTHROUGH: If input is already a formatted string, convert markdown to HTML
    // This handles cases where AI processing outputs pre-formatted content
    if (typeof data === 'string' && data.trim().length > 0) {
      logger.debug({ inputType: 'string', length: data.length }, 'render_table: Converting markdown to HTML');
      return this.markdownToHtml(data);
    }

    // ✅ SMART PASSTHROUGH: If input is an AI output object with result/output/response, extract it
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const content = data.result || data.output || data.response || data.generated;
      if (typeof content === 'string' && content.trim().length > 0) {
        logger.debug({ inputType: 'ai_output', length: content.length }, 'render_table: Extracting and converting AI result');
        return this.markdownToHtml(content);
      }
    }

    // Use empty_message from config if provided
    const emptyMessage = config?.empty_message || 'No data';

    if (!Array.isArray(data) || data.length === 0) {
      return `<table><tbody><tr><td>${emptyMessage}</td></tr></tbody></table>`;
    }

    const { format = 'html', columns, max_rows = 100 } = config || {};
    const limitedData = data.slice(0, max_rows);

    // Detect if 2D array or object array
    const is2DArray = Array.isArray(data[0]);

    if (format === 'html') {
      // Modern, professional table styling for email clients
      const tableStyle = `
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        border-collapse: collapse;
        width: 100%;
        max-width: 900px;
        margin: 20px 0;
        font-size: 14px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      `.replace(/\s+/g, ' ').trim();

      const headerCellStyle = `
        background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
        background-color: #f97316;
        color: white;
        padding: 12px 16px;
        text-align: left;
        font-weight: 600;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border: none;
      `.replace(/\s+/g, ' ').trim();

      const cellStyle = `
        padding: 12px 16px;
        border-bottom: 1px solid #e8e8e8;
        color: #333;
        vertical-align: top;
      `.replace(/\s+/g, ' ').trim();

      const rowEvenStyle = 'background-color: #f8f9fa;';
      const rowOddStyle = 'background-color: #ffffff;';
      const rowHoverNote = '/* Hover styles not supported in email */';

      let html = `<table style="${tableStyle}">`;

      if (is2DArray) {
        // 2D array: first row is headers
        const headers = data[0];
        const rows = limitedData.slice(1);

        html += '<thead><tr>';
        for (const header of headers) {
          const displayHeader = this.formatColumnHeader(String(header || ''));
          html += `<th style="${headerCellStyle}">${this.escapeHtml(displayHeader)}</th>`;
        }
        html += '</tr></thead>';

        html += '<tbody>';
        rows.forEach((row, rowIndex) => {
          const rowStyle = rowIndex % 2 === 0 ? rowOddStyle : rowEvenStyle;
          html += `<tr style="${rowStyle}">`;
          for (const cell of row) {
            const cellValue = this.formatCellValue(cell);
            html += `<td style="${cellStyle}">${cellValue}</td>`;
          }
          html += '</tr>';
        });
        html += '</tbody>';
      } else {
        // Object array: extract keys as headers
        // Use columns for data extraction, header_names for display (if provided)
        const dataKeys = columns || [...new Set(limitedData.flatMap(item => Object.keys(item || {})))];
        const displayHeaders = config?.header_names || dataKeys;
        const columnMapping = config?.column_mapping || {};

        html += '<thead><tr>';
        for (let i = 0; i < dataKeys.length; i++) {
          // Use semantic header name if provided, otherwise format the data key
          const displayHeader = displayHeaders[i] || this.formatColumnHeader(String(dataKeys[i]));
          html += `<th style="${headerCellStyle}">${this.escapeHtml(displayHeader)}</th>`;
        }
        html += '</tr></thead>';

        html += '<tbody>';
        limitedData.forEach((item, rowIndex) => {
          const rowStyle = rowIndex % 2 === 0 ? rowOddStyle : rowEvenStyle;
          html += `<tr style="${rowStyle}">`;
          for (const key of dataKeys) {
            // Try to find the value using multiple strategies
            let value = this.findFieldValue(item, key, columnMapping);

            const cellValue = this.formatCellValue(value);
            html += `<td style="${cellStyle}">${cellValue}</td>`;
          }
          html += '</tr>';
        });
        html += '</tbody>';
      }

      html += '</table>';

      logger.debug({ rowCount: limitedData.length, format }, 'render_table: Generated styled HTML table');
      return html;
    }

    // Default: return JSON string
    return JSON.stringify(limitedData, null, 2);
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Format column header for display
   * Converts snake_case and camelCase to Title Case
   */
  private formatColumnHeader(header: string): string {
    return header
      // Handle snake_case: replace underscores with spaces
      .replace(/_/g, ' ')
      // Handle camelCase: add space before capitals
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      // Capitalize first letter of each word
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();
  }

  /**
   * Find field value in an item using multiple matching strategies
   * Handles semantic column names that may not match actual data field names
   * e.g., "CTA (what to do)" should match "cta", "Priority" should match "priority"
   */
  private findFieldValue(item: any, key: string, columnMapping: Record<string, string> = {}): any {
    if (!item || typeof item !== 'object') return undefined;

    // 1. Direct match (exact key)
    if (key in item) {
      return item[key];
    }

    // 2. Case-insensitive match
    const lowerKey = key.toLowerCase();
    for (const [field, value] of Object.entries(item)) {
      if (field.toLowerCase() === lowerKey) {
        return value;
      }
    }

    // 3. Check column_mapping (semantic → data field)
    const mappedField = columnMapping[key];
    if (mappedField && mappedField in item) {
      return item[mappedField];
    }

    // 4. Reverse lookup in columnMapping
    for (const [semanticName, dataField] of Object.entries(columnMapping)) {
      if (dataField === key && semanticName in item) {
        return item[semanticName];
      }
    }

    // 5. Normalize and fuzzy match
    // "CTA (what to do)" → "cta", "Due date (if mentioned)" → "due_date"
    const normalized = key
      .toLowerCase()
      .replace(/\s*\([^)]*\)\s*/g, '')  // Remove parenthetical text
      .replace(/[^a-z0-9]+/g, '_')       // Replace non-alphanumeric with underscore
      .replace(/^_+|_+$/g, '');          // Trim leading/trailing underscores

    for (const [field, value] of Object.entries(item)) {
      const normalizedField = field
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      if (normalizedField === normalized) {
        return value;
      }

      // Also check if one contains the other (e.g., "cta" in "cta_what_to_do")
      if (normalizedField.includes(normalized) || normalized.includes(normalizedField)) {
        return value;
      }
    }

    // 6. Word-based fuzzy match for semantic names
    // "Suggested reply text" should match "suggested_reply_text"
    const keyWords = key.toLowerCase().split(/[\s_-]+/).filter(w => w.length > 2);
    if (keyWords.length > 0) {
      for (const [field, value] of Object.entries(item)) {
        const fieldWords = field.toLowerCase().split(/[\s_-]+/).filter(w => w.length > 2);
        // Check if most key words appear in field name
        const matchCount = keyWords.filter(kw => fieldWords.some(fw => fw.includes(kw) || kw.includes(fw))).length;
        if (matchCount >= Math.ceil(keyWords.length * 0.6)) {
          return value;
        }
      }
    }

    return undefined;
  }

  /**
   * Format cell value for HTML display
   * Handles booleans, nulls, long text, etc.
   */
  private formatCellValue(value: any): string {
    if (value === null || value === undefined) {
      return '<span style="color: #999; font-style: italic;">—</span>';
    }

    if (typeof value === 'boolean') {
      return value
        ? '<span style="color: #22c55e; font-weight: 500;">✓ Yes</span>'
        : '<span style="color: #ef4444; font-weight: 500;">✗ No</span>';
    }

    const strValue = String(value);
    const escaped = this.escapeHtml(strValue);

    // Truncate long text and add tooltip-like behavior
    if (strValue.length > 150) {
      return `<span title="${escaped}">${escaped.substring(0, 147)}...</span>`;
    }

    return escaped;
  }

  /**
   * Convert markdown to HTML for email rendering
   * Handles common markdown patterns: headers, bold, horizontal rules, lists
   */
  private markdownToHtml(markdown: string): string {
    let html = markdown
      // Escape HTML first to prevent XSS
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Headers: ### Header -> <h3>Header</h3>
      .replace(/^### (.+)$/gm, '<h3 style="margin: 16px 0 8px 0; color: #333;">$1</h3>')
      .replace(/^## (.+)$/gm, '<h2 style="margin: 20px 0 10px 0; color: #333;">$1</h2>')
      .replace(/^# (.+)$/gm, '<h1 style="margin: 24px 0 12px 0; color: #333;">$1</h1>')
      // Bold: **text** -> <strong>text</strong>
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic: *text* -> <em>text</em> (but not if part of bold)
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      // Horizontal rules: --- or *** -> <hr>
      .replace(/^[-*]{3,}$/gm, '<hr style="margin: 16px 0; border: none; border-top: 1px solid #ddd;">')
      // Code blocks: `code` -> <code>code</code>
      .replace(/`([^`]+)`/g, '<code style="background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-family: monospace;">$1</code>')
      // Line breaks: preserve double newlines as paragraph breaks
      .replace(/\n\n/g, '</p><p style="margin: 12px 0;">')
      // Single newlines to <br>
      .replace(/\n/g, '<br>');

    // Wrap in paragraph and add container styling
    html = `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #333;"><p style="margin: 12px 0;">${html}</p></div>`;

    return html;
  }

  /**
   * Fetch Content transformation (Plugin-Agnostic, Schema-Driven)
   *
   * Takes file/attachment metadata and fetches the actual content by:
   * 1. Discovering the content fetch action from plugin schema (pattern matching)
   * 2. Auto-mapping metadata fields to action parameters using schema
   * 3. Executing the action and enriching items with content
   *
   * No hardcoded plugin mappings - works with any plugin that has a content fetch action.
   */
  private async transformFetchContent(
    data: any | any[],
    config: any,
    context: ExecutionContext
  ): Promise<any | any[]> {
    const items = Array.isArray(data) ? data : [data];
    const results: any[] = [];

    // Determine source plugin from config or item metadata
    const sourcePlugin = config?.source_plugin || items[0]?._sourcePlugin;

    if (!sourcePlugin) {
      logger.warn({}, 'fetch_content: No source plugin specified, returning items as-is');
      return data;
    }

    // Discover the content fetch action from plugin schema
    const fetchAction = await this.discoverContentFetchAction(sourcePlugin);

    if (!fetchAction) {
      logger.warn({ sourcePlugin }, 'fetch_content: No content fetch action found for plugin');
      return data;
    }

    logger.info({
      sourcePlugin,
      action: fetchAction.name,
      itemCount: items.length
    }, 'fetch_content: Fetching content using discovered action');

    // Get plugin executer instance
    const pluginExecuter = await PluginExecuterV2.getInstance();

    // Fetch content for each item
    for (const item of items) {
      try {
        // Auto-map item fields to action parameters using schema
        const params = this.mapMetadataToParams(item, fetchAction.parameters);

        // Execute the plugin action to get content
        const pluginResult = await pluginExecuter.execute(
          context.userId,
          sourcePlugin,
          fetchAction.name,
          params
        );

        // Merge original metadata with fetched content
        const contentData = pluginResult.data || pluginResult;
        const enrichedItem = {
          ...item,
          _content: contentData,
          _contentFetched: true,
          // Standard content fields for AI consumption
          content: contentData?.data || contentData,
          contentType: contentData?.mimeType || item.mimeType,
          extractedText: contentData?.extracted_text,
          isImage: contentData?.is_image || this.isImageMimeType(item.mimeType)
        };

        results.push(enrichedItem);
        logger.debug({ filename: item.filename, hasContent: !!enrichedItem.content }, 'fetch_content: Item enriched');

      } catch (error: any) {
        logger.error({ err: error, item }, 'fetch_content: Failed to fetch content for item');
        results.push({
          ...item,
          _contentFetched: false,
          _fetchError: error.message
        });
      }
    }

    return Array.isArray(data) ? results : results[0];
  }

  /**
   * Discover the content fetch action from plugin schema
   * Looks for actions matching patterns: get_*_attachment, get_*_content, download_*
   */
  private async discoverContentFetchAction(pluginName: string): Promise<{
    name: string;
    parameters: any;
  } | null> {
    try {
      const PluginManager = (await import('../server/plugin-manager-v2')).PluginManagerV2;
      const pluginManager = await PluginManager.getInstance();
      const plugin = pluginManager.getPluginDefinition(pluginName);

      if (!plugin?.actions) {
        logger.warn({ pluginName }, 'fetch_content: Plugin not found or has no actions');
        return null;
      }

      // Pattern matching for content fetch actions
      const contentFetchPatterns = [
        /^get_.*attachment$/i,
        /^get_.*content$/i,
        /^download_.*$/i,
        /^fetch_.*content$/i,
        /^get_file$/i
      ];

      for (const [actionName, actionDef] of Object.entries(plugin.actions as Record<string, any>)) {
        if (contentFetchPatterns.some(pattern => pattern.test(actionName))) {
          logger.info({ pluginName, actionName }, 'fetch_content: Discovered content fetch action');
          return {
            name: actionName,
            parameters: actionDef.parameters
          };
        }
      }

      logger.warn({ pluginName, availableActions: Object.keys(plugin.actions) }, 'fetch_content: No matching content fetch action found');
      return null;
    } catch (error) {
      logger.warn({ pluginName, error }, 'Failed to discover content fetch action');
      return null;
    }
  }

  /**
   * Auto-map item metadata fields to action parameters using schema
   * Uses field name similarity and type matching
   * Also checks _parentData for fields from parent items (e.g., email -> attachment)
   */
  private mapMetadataToParams(item: any, parameterSchema: any): Record<string, any> {
    const params: Record<string, any> = {};
    const properties = parameterSchema?.properties || {};

    for (const [paramName, paramDef] of Object.entries(properties as Record<string, any>)) {
      // Try exact match first
      if (item[paramName] !== undefined) {
        params[paramName] = item[paramName];
        continue;
      }

      // Try common field name mappings (camelCase <-> snake_case)
      const camelCase = paramName.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      const snakeCase = paramName.replace(/([A-Z])/g, '_$1').toLowerCase();

      if (item[camelCase] !== undefined) {
        params[paramName] = item[camelCase];
      } else if (item[snakeCase] !== undefined) {
        params[paramName] = item[snakeCase];
      }
      // Try partial matches for ID fields (e.g., 'id' matches 'message_id', 'attachment_id')
      else if (paramName.endsWith('_id') || paramName.endsWith('Id')) {
        const baseName = paramName.replace(/_id$/i, '').replace(/Id$/i, '');
        // Look for 'id' field or base + 'Id'
        if (item.id !== undefined && (paramName === 'id' || baseName === '')) {
          params[paramName] = item.id;
        } else if (item[baseName + 'Id'] !== undefined) {
          params[paramName] = item[baseName + 'Id'];
        } else if (item[baseName + '_id'] !== undefined) {
          params[paramName] = item[baseName + '_id'];
        }
        // Check _parentData for parent item fields (e.g., messageId from parent email)
        else if (item._parentData) {
          const parentData = item._parentData;
          if (parentData[paramName] !== undefined) {
            params[paramName] = parentData[paramName];
          } else if (parentData[camelCase] !== undefined) {
            params[paramName] = parentData[camelCase];
          } else if (parentData[baseName + 'Id'] !== undefined) {
            params[paramName] = parentData[baseName + 'Id'];
          }
        }
      }
    }

    logger.debug({ itemKeys: Object.keys(item), mappedParams: params }, 'mapMetadataToParams result');
    return params;
  }

  /**
   * Check if a MIME type is an image or visual document
   * Includes PDFs since they can be processed visually by vision models
   */
  private isImageMimeType(mimeType?: string): boolean {
    if (!mimeType) return false;
    return mimeType.startsWith('image/') ||
           mimeType === 'application/pdf';
  }

  /**
   * ===================================================================
   * PLUGIN OUTPUT SCHEMA REGISTRY
   * ===================================================================
   * Provides runtime access to plugin output schemas for schema-driven
   * data transformation. This enables the transform layer to intelligently
   * handle data from ANY plugin without hardcoding plugin-specific logic.
   *
   * Designed to support 100+ plugins without modification.
   */

  /**
   * Get the output schema for a plugin action
   * @param pluginName - Name of the plugin (e.g., 'google_sheets', 'hubspot')
   * @param actionName - Name of the action (e.g., 'read_sheet', 'get_contacts')
   * @returns The output schema definition or undefined if not found
   */
  private async getActionOutputSchema(pluginName: string, actionName: string): Promise<any | undefined> {
    try {
      const PluginManager = (await import('../server/plugin-manager-v2')).PluginManagerV2;
      const pluginManager = await PluginManager.getInstance();
      const actionDef = pluginManager.getActionDefinition(pluginName, actionName);
      return actionDef?.output_schema;
    } catch (error) {
      logger.warn({ pluginName, actionName, error }, 'Failed to get action output schema');
      return undefined;
    }
  }

  /**
   * Analyze output schema to determine data structure characteristics
   * Delegates to SchemaAwareDataExtractor for consistent schema analysis
   * across the entire pipeline (uses 53 metadata field patterns vs old 9).
   */
  private analyzeOutputSchemaStructure(outputSchema: any): {
    primaryArrayField: string | null;
    is2DArray: boolean;
    hasNestedWrapper: 'fields' | 'properties' | 'data' | null;
    itemType: 'object' | 'array' | 'primitive' | 'unknown';
  } {
    const analysis = analyzeOutputSchema(outputSchema);

    return {
      primaryArrayField: analysis.primaryArrayField,
      is2DArray: analysis.is2DArray,
      hasNestedWrapper: analysis.nestedWrapper as 'fields' | 'properties' | 'data' | null,
      itemType: analysis.itemType as 'object' | 'array' | 'primitive' | 'unknown'
    };
  }

  /**
   * Get schema-aware unwrapping hints for data from a specific step
   * This allows transforms to intelligently handle data based on its source
   */
  private async getSchemaHintsForStep(
    stepId: string,
    context: ExecutionContext
  ): Promise<{
    primaryArrayField: string | null;
    is2DArray: boolean;
    hasNestedWrapper: 'fields' | 'properties' | 'data' | null;
    itemType: 'object' | 'array' | 'primitive' | 'unknown';
  } | null> {
    // Try to find the step definition in context to get plugin/action info
    const stepOutput = context.getStepOutput(stepId);
    if (!stepOutput) {
      return null;
    }

    // Check if we stored source info in the step output data
    const outputData = stepOutput.data;
    const sourcePlugin = outputData && typeof outputData === 'object' ? (outputData as any)._sourcePlugin : undefined;
    const sourceAction = outputData && typeof outputData === 'object' ? (outputData as any)._sourceAction : undefined;

    if (sourcePlugin && sourceAction) {
      const outputSchema = await this.getActionOutputSchema(sourcePlugin, sourceAction);
      if (outputSchema) {
        return this.analyzeOutputSchemaStructure(outputSchema);
      }
    }

    return null;
  }

  /**
   * Helper: Unwrap structured output from previous steps
   * Many transform operations return {items: [...], count: N, ...} format
   * This helper extracts the actual data array for chaining
   *
   * ✅ SCHEMA-DRIVEN: No hardcoded plugin names - uses generic patterns for ANY plugin
   * Designed to support 100+ plugins without modification
   *
   * Algorithm:
   * 1. Check for nested 'data' wrapper (common REST API pattern)
   * 2. Find all array fields, excluding metadata fields
   * 3. Use pattern-based priority selection for multiple arrays
   * 4. Fall back to largest array or single nested object
   */
  private unwrapStructuredOutput(data: any): any {
    // If it's already an array, return as-is
    if (Array.isArray(data)) {
      return data;
    }

    // If it's an object, use generic discovery algorithm
    if (data && typeof data === 'object') {
      // Define metadata field names that should NOT be treated as primary data
      // These are common pagination/status fields across all APIs
      const metadataFields = new Set([
        // Pagination metadata
        'count', 'total', 'total_count', 'totalCount', 'page', 'pages', 'per_page', 'perPage',
        'offset', 'limit', 'start', 'size', 'has_more', 'hasMore', 'next_page', 'nextPage',
        'next_page_token', 'nextPageToken', 'cursor', 'next_cursor', 'nextCursor',
        'previous_page', 'previousPage', 'prev_cursor', 'prevCursor',
        // Status/meta fields
        'pagination', 'paging', 'meta', 'metadata', '_metadata', '_meta',
        'success', 'error', 'errors', 'status', 'message', 'code',
        // Transform output metadata
        'removed', 'originalCount', 'original_count', 'length',
        // Common non-data array fields
        'warnings', 'info', 'debug', 'links', '_links'
      ]);

      // Step 1: Check for nested 'data' wrapper first (common REST API pattern)
      if (data.data !== undefined) {
        if (Array.isArray(data.data)) {
          return data.data;
        }
        // Recursively unwrap nested data object
        if (typeof data.data === 'object' && data.data !== null) {
          const nestedResult = this.unwrapStructuredOutput(data.data);
          if (Array.isArray(nestedResult)) {
            return nestedResult;
          }
        }
      }

      // Step 2: Find all array fields in the object, excluding metadata
      const arrayFields: [string, any[]][] = [];
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value) && !metadataFields.has(key) && !metadataFields.has(key.toLowerCase())) {
          arrayFields.push([key, value]);
        }
      }

      // Step 3: If exactly one non-metadata array field, use it
      if (arrayFields.length === 1) {
        return arrayFields[0][1];
      }

      // Step 4: If multiple array fields, use priority-based selection
      if (arrayFields.length > 1) {
        // Priority 1: Generic primary data patterns (NOT plugin-specific)
        const primaryPatterns = [
          /^items$/i, /^results?$/i, /^records?$/i, /^entries$/i, /^list$/i,
          /^rows?$/i, /^values$/i, /^objects?$/i, /^entities$/i, /^resources?$/i,
          /^elements$/i, /^content$/i, /^response$/i
        ];

        for (const pattern of primaryPatterns) {
          const match = arrayFields.find(([key]) => pattern.test(key));
          if (match) return match[1];
        }

        // Priority 2: Pluralized noun patterns (entity collections like emails, files, users)
        const pluralFields = arrayFields.filter(([key]) =>
          /^[a-z_]+s$/i.test(key) && key.length > 3 && !key.startsWith('_')
        );
        if (pluralFields.length === 1) {
          return pluralFields[0][1];
        }
        if (pluralFields.length > 1) {
          pluralFields.sort((a, b) => b[0].length - a[0].length);
          return pluralFields[0][1];
        }

        // Priority 3: Largest non-empty array
        const nonEmptyArrays = arrayFields.filter(([_, arr]) => arr.length > 0);
        if (nonEmptyArrays.length > 0) {
          nonEmptyArrays.sort((a, b) => b[1].length - a[1].length);
          return nonEmptyArrays[0][1];
        }

        // Priority 4: First array field as fallback
        return arrayFields[0][1];
      }

      // Step 5: No arrays - check for single nested object wrapper
      const objectFields = Object.entries(data).filter(([key, value]) =>
        typeof value === 'object' && value !== null && !Array.isArray(value) &&
        !metadataFields.has(key) && !key.startsWith('_')
      );

      if (objectFields.length === 1) {
        const nestedResult = this.unwrapStructuredOutput(objectFields[0][1]);
        if (Array.isArray(nestedResult)) {
          return nestedResult;
        }
      }
    }

    // If we can't unwrap, return the data as-is
    return data;
  }

  /**
   * GENERIC Helper: Get value from item based on key, supporting multiple data structure patterns
   * Works with: 2D arrays, arrays of objects, nested objects, primitives
   *
   * @param item - The item to extract value from (can be array, object, or primitive)
   * @param key - The key to access (can be column name, field name, or index)
   * @param allData - Optional full dataset for header row detection (2D array pattern)
   * @returns The extracted value
   */
  private extractValueByKey(item: any, key: string | number, allData?: any[]): any {
    // Pattern 1: If item is an array (row in 2D array or tuple)
    if (Array.isArray(item)) {
      // Check if key is numeric (direct index access)
      if (typeof key === 'number') {
        return item[key];
      }

      // Check if key is string number (convert to index)
      const numericKey = parseInt(String(key), 10);
      if (!isNaN(numericKey)) {
        return item[numericKey];
      }

      // Key is a column name - need to find index from header row
      if (allData && Array.isArray(allData) && allData.length > 0) {
        const headerRow = allData[0];
        if (Array.isArray(headerRow)) {
          // Case-sensitive exact match
          const exactIndex = headerRow.indexOf(key);
          if (exactIndex !== -1) {
            return item[exactIndex];
          }

          // Case-insensitive match
          const lowerKey = String(key).toLowerCase();
          const caseInsensitiveIndex = headerRow.findIndex(
            (h: any) => String(h).toLowerCase() === lowerKey
          );
          if (caseInsensitiveIndex !== -1) {
            return item[caseInsensitiveIndex];
          }
        }
      }

      // If no header found or not 2D array, return undefined
      return undefined;
    }

    // Pattern 2: If item is an object (record from CRM, API, etc.)
    if (typeof item === 'object' && item !== null) {
      // Direct property access (case-sensitive first)
      if (key in item) {
        return item[key];
      }

      // ✅ FIX: Case-insensitive fallback for object keys
      // rows_to_objects lowercases headers (Sales Person → sales person)
      // but partition/group_by may use original case from IR
      const lowerKey = String(key).toLowerCase();
      const matchingKey = Object.keys(item).find(k => k.toLowerCase() === lowerKey);
      if (matchingKey) {
        return item[matchingKey];
      }

      // ✅ FIX: Auto-detect nested 'fields' wrapper for CRM records (Airtable, HubSpot, etc.)
      // Many CRMs wrap record data in a 'fields' property: {id: "rec123", fields: {Name: "John"}}
      // User writes item.Name but data is in item.fields.Name
      if ('fields' in item && typeof item.fields === 'object' && item.fields !== null) {
        if (key in item.fields) {
          return item.fields[key];
        }
        // Case-insensitive fallback for fields
        const fieldsMatchingKey = Object.keys(item.fields).find(k => k.toLowerCase() === lowerKey);
        if (fieldsMatchingKey) {
          return item.fields[fieldsMatchingKey];
        }
      }

      // ✅ FIX: Auto-detect nested 'properties' wrapper for HubSpot-style records
      // HubSpot uses {properties: {firstname: "John", lastname: "Doe"}}
      if ('properties' in item && typeof item.properties === 'object' && item.properties !== null) {
        if (key in item.properties) {
          return item.properties[key];
        }
        // Case-insensitive fallback for properties
        const propsMatchingKey = Object.keys(item.properties).find(k => k.toLowerCase() === lowerKey);
        if (propsMatchingKey) {
          return item.properties[propsMatchingKey];
        }
      }

      // ✅ FIX: Auto-detect nested 'data' wrapper for generic API responses
      if ('data' in item && typeof item.data === 'object' && item.data !== null) {
        if (key in item.data) {
          return item.data[key];
        }
        // Case-insensitive fallback for data
        const dataMatchingKey = Object.keys(item.data).find(k => k.toLowerCase() === lowerKey);
        if (dataMatchingKey) {
          return item.data[dataMatchingKey];
        }
      }

      // Nested property access (e.g., "fields.Name" for explicit Airtable access)
      // ✅ FIX: Added case-insensitive fallback for nested access
      const keyParts = String(key).split('.');
      let value = item;
      for (const part of keyParts) {
        if (value && typeof value === 'object') {
          if (part in value) {
            value = value[part];
          } else {
            // Case-insensitive fallback
            const partLower = part.toLowerCase();
            const nestedMatchingKey = Object.keys(value).find(k => k.toLowerCase() === partLower);
            if (nestedMatchingKey) {
              value = value[nestedMatchingKey];
            } else {
              return undefined;
            }
          }
        } else {
          return undefined;
        }
      }
      return value;
    }

    // Pattern 3: Primitive value (string, number, etc.)
    // Can't extract a field from a primitive, return the value itself
    return item;
  }

  /**
   * Deduplicate transformation - GENERIC for ALL data structure patterns
   *
   * Supports:
   * - 2D arrays (Google Sheets): column name → finds header, deduplicates by column
   * - Arrays of objects (Airtable, CRMs): field name → deduplicates by field
   * - Arrays of primitives: deduplicates entire values
   * - Nested objects: supports dot notation (e.g., "fields.Name")
   *
   * Returns structured output compatible with filter and other transforms
   */
  private transformDeduplicate(data: any[], config: any): any {
    // CRITICAL: Unwrap structured output from previous steps
    // Previous steps may return {items: [...], count: N} or {values: [...]} format
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError(
        `Deduplicate operation requires array input. Received: ${typeof unwrappedData}. ` +
        `If this is from a previous step, make sure to reference the array field (e.g., step1.values, step1.items, step1.records)`,
        'INVALID_INPUT_TYPE'
      );
    }

    const { field, key, column } = config || {};
    const deduplicateKey = column || field || key; // Support 'column', 'field', and 'key'
    const originalCount = unwrappedData.length;

    let deduplicated: any[];

    if (deduplicateKey) {
      // Deduplicate based on extracted value using generic helper
      const seen = new Set();

      // Detect if 2D array pattern (array of arrays)
      const is2DArray = Array.isArray(unwrappedData[0]);

      if (is2DArray) {
        // For 2D arrays, preserve header row and deduplicate data rows
        const headerRow = unwrappedData[0];
        const dataRows = unwrappedData.slice(1);

        const uniqueRows = dataRows.filter((row: any) => {
          const value = this.extractValueByKey(row, deduplicateKey, unwrappedData);
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });

        deduplicated = [headerRow, ...uniqueRows];
        logger.debug({ deduplicateKey, removedCount: dataRows.length - uniqueRows.length, pattern: '2D array' }, 'Deduplicated rows');
      } else {
        // For objects or other patterns, deduplicate all items
        deduplicated = unwrappedData.filter(item => {
          const value = this.extractValueByKey(item, deduplicateKey, unwrappedData);
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });
        logger.debug({ deduplicateKey, removedCount: unwrappedData.length - deduplicated.length, pattern: 'object/item' }, 'Deduplicated items');
      }
    } else {
      // Deduplicate based on entire object (using JSON stringification)
      const seen = new Set();
      deduplicated = unwrappedData.filter(item => {
        const serialized = JSON.stringify(item);
        if (seen.has(serialized)) {
          return false;
        }
        seen.add(serialized);
        return true;
      });
      logger.debug({ removedCount: unwrappedData.length - deduplicated.length, pattern: 'entire value' }, 'Deduplicated items');
    }

    // ✅ FIX: Return actual array with metadata properties attached
    // This ensures Array.isArray(result) === true for downstream operations
    // while still providing useful metadata
    const result: any[] = [...deduplicated];

    // Add metadata as non-enumerable properties so they don't affect array iteration
    Object.defineProperties(result, {
      items: { value: deduplicated, writable: false, enumerable: false },
      deduplicated: { value: deduplicated, writable: false, enumerable: false },
      removed: { value: originalCount - deduplicated.length, writable: false, enumerable: false },
      originalCount: { value: originalCount, writable: false, enumerable: false },
      count: { value: deduplicated.length, writable: false, enumerable: false },
    });

    return result;
  }

  /**
   * Flatten transformation - Flatten nested arrays
   * Config: {depth: number} (default: 1)
   */
  private transformFlatten(data: any, config: any): any {
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError('Flatten operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const depth = config?.depth || 1;
    const field = config?.field; // Optional: extract this field from each item before flattening

    // If field is specified, extract that field from each item first
    // This is used for patterns like: emails -> extract attachments -> flatten into single list
    let dataToFlatten = unwrappedData;
    if (field) {
      dataToFlatten = unwrappedData.reduce((acc: any[], item: any) => {
        const fieldValue = item?.[field];
        if (Array.isArray(fieldValue)) {
          // Preserve parent context on each extracted item for downstream operations
          // e.g., attachment needs parent email's messageId for content fetching
          const enrichedItems = fieldValue.map((child: any) => ({
            ...child,
            _parentId: item.id || item.messageId,
            _parentData: {
              id: item.id,
              messageId: item.messageId || item.message_id,
              subject: item.subject,
              from: item.from
            }
          }));
          acc.push(...enrichedItems);
        } else if (fieldValue !== undefined && fieldValue !== null) {
          acc.push({
            ...fieldValue,
            _parentId: item.id || item.messageId,
            _parentData: {
              id: item.id,
              messageId: item.messageId || item.message_id,
              subject: item.subject,
              from: item.from
            }
          });
        }
        return acc;
      }, []);
      logger.debug({ field, originalItems: unwrappedData.length, extractedItems: dataToFlatten.length }, 'Extracted field before flattening');
    }

    const flattenArray = (arr: any[], currentDepth: number): any[] => {
      if (currentDepth === 0) return arr;

      return arr.reduce((acc, val) => {
        if (Array.isArray(val)) {
          acc.push(...flattenArray(val, currentDepth - 1));
        } else {
          acc.push(val);
        }
        return acc;
      }, []);
    };

    const flattened = flattenArray(dataToFlatten, depth);

    logger.debug({ originalCount: unwrappedData.length, flattenedCount: flattened.length, depth, field }, 'Flattened array');

    // ✅ FIX: Return actual array with metadata as non-enumerable properties
    // This ensures Array.isArray(result) === true for downstream operations
    const result: any[] = [...flattened];

    Object.defineProperties(result, {
      items: { value: flattened, writable: false, enumerable: false },
      count: { value: flattened.length, writable: false, enumerable: false },
      originalCount: { value: unwrappedData.length, writable: false, enumerable: false },
    });

    return result;
  }

  /**
   * Join transformation - Join two arrays by common key
   * Config: {leftKey: string, rightKey: string, joinType: 'inner'|'left'|'right'}
   */
  private transformJoin(data: any, config: any): any {
    if (!config?.leftKey || !config?.rightKey) {
      throw new ExecutionError('Join operation requires leftKey and rightKey config', 'MISSING_CONFIG');
    }

    // For now, this is a placeholder - full implementation would require two input arrays
    // This can be enhanced when we have a way to reference multiple step outputs
    throw new ExecutionError('Join operation not yet fully implemented', 'NOT_IMPLEMENTED');
  }

  /**
   * Pivot transformation - Convert rows to columns
   * Config: {rowKey: string, columnKey: string, valueKey: string}
   */
  private transformPivot(data: any, config: any): any {
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError('Pivot operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { rowKey, columnKey, valueKey } = config || {};

    if (!rowKey || !columnKey || !valueKey) {
      throw new ExecutionError('Pivot requires rowKey, columnKey, and valueKey config', 'MISSING_CONFIG');
    }

    const pivotData: Record<string, Record<string, any>> = {};

    unwrappedData.forEach(item => {
      const row = this.extractValueByKey(item, rowKey, unwrappedData);
      const col = this.extractValueByKey(item, columnKey, unwrappedData);
      const val = this.extractValueByKey(item, valueKey, unwrappedData);

      if (!pivotData[row]) {
        pivotData[row] = {};
      }
      pivotData[row][col] = val;
    });

    // Convert to array format
    const items = Object.entries(pivotData).map(([row, cols]) => ({
      [rowKey]: row,
      ...cols
    }));

    logger.debug({ rowCount: items.length, rowKey, columnKey, valueKey }, 'Created pivot table');

    return {
      items,
      count: items.length,
      pivotData
    };
  }

  /**
   * Split transformation - Split array into chunks
   * Config: {size: number} or {count: number}
   */
  private transformSplit(data: any, config: any): any {
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError('Split operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { size, count } = config || {};

    if (!size && !count) {
      throw new ExecutionError('Split requires either size or count config', 'MISSING_CONFIG');
    }

    let chunkSize: number;
    if (size) {
      chunkSize = size;
    } else {
      chunkSize = Math.ceil(unwrappedData.length / count);
    }

    const chunks: any[][] = [];
    for (let i = 0; i < unwrappedData.length; i += chunkSize) {
      chunks.push(unwrappedData.slice(i, i + chunkSize));
    }

    logger.debug({ originalCount: unwrappedData.length, chunkCount: chunks.length, chunkSize }, 'Split array');

    return {
      items: chunks,
      chunks,
      count: chunks.length,
      chunkSize
    };
  }

  /**
   * Expand transformation - Flatten nested objects to flat structure
   * Config: {delimiter: string} (default: '.')
   */
  private transformExpand(data: any, config: any): any {
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError('Expand operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const delimiter = config?.delimiter || '.';

    const expandObject = (obj: any, prefix = ''): any => {
      const result: any = {};

      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}${delimiter}${key}` : key;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(result, expandObject(value, newKey));
        } else {
          result[newKey] = value;
        }
      }

      return result;
    };

    const expanded = unwrappedData.map(item => {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return expandObject(item);
      }
      return item;
    });

    logger.debug({ count: unwrappedData.length, delimiter }, 'Expanded objects to flat structure');

    return {
      items: expanded,
      count: expanded.length
    };
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

    logger.debug({ stepId: step.id, durationMs: duration }, 'Delaying execution');

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

  /**
   * Build LLM prompt with vision support if images are present
   *
   * This method is SAFE for non-image workflows:
   * - If no images found, returns standard text prompt
   * - Only switches to vision mode when data contains actual image content
   *   (items with isImage flag, image MIME types, and base64 content)
   *
   * @param prompt - The base prompt/instruction
   * @param contextSummary - Summary of execution context
   * @param params - Enriched parameters (may contain images)
   * @returns Object with fullPrompt (string or vision content) and isVisionMode flag
   */
  private async buildLLMPrompt(
    prompt: string,
    contextSummary: string,
    params: any
  ): Promise<{ fullPrompt: string | any[]; isVisionMode: boolean }> {
    // Check if data contains images for vision processing
    // This returns false for non-image workflows (safe fallback to text mode)
    const hasImages = VisionContentBuilder.hasImageContent(params);

    if (hasImages) {
      // Vision mode: Build multimodal content array for GPT-4o vision
      // Use async version to support PDF-to-image conversion
      const imageContent = await VisionContentBuilder.extractImageContentAsync(params);
      logger.info({ imageCount: imageContent.length }, 'Vision mode: Building multimodal prompt');

      // If no images after extraction (e.g., PDF conversion failed), fall back to text mode
      if (imageContent.length === 0) {
        logger.warn({}, 'Vision mode: No images extracted, falling back to text mode');
        const textPrompt = `
${prompt}

## Current Context:
${contextSummary}

## Data for Analysis:
${JSON.stringify(params, null, 2)}

Please analyze the above and provide your decision/response.
        `.trim();
        return { fullPrompt: textPrompt, isVisionMode: false };
      }

      // Extract non-image data for text context
      const textData = VisionContentBuilder.extractNonImageData(params);

      const textPrompt = `
${prompt}

## Current Context:
${contextSummary}

## Item Metadata:
${JSON.stringify(textData, null, 2)}

Please analyze the image(s) above and extract the requested information.
      `.trim();

      // Build multimodal content: images first, then text
      // Use 'low' detail to minimize token usage - 'low' uses 85 tokens per image
      // vs 'high' which can use thousands of tokens based on image resolution
      // For receipt/document extraction, 'low' is typically sufficient
      const visionContent = VisionContentBuilder.buildVisionContent(textPrompt, imageContent, 'low');

      return { fullPrompt: visionContent, isVisionMode: true };
    }

    // Standard text mode (default for non-image workflows)
    const textPrompt = `
${prompt}

## Current Context:
${contextSummary}

## Data for Analysis:
${JSON.stringify(params, null, 2)}

Please analyze the above and provide your decision/response.
    `.trim();

    return { fullPrompt: textPrompt, isVisionMode: false };
  }

  /**
   * Clean summary output by removing meta-commentary and narrative
   * Same logic as SummarizeHandler to ensure consistency across orchestrated and fallback paths
   * @private
   */
  private cleanSummaryOutput(output: string): string {
    let cleaned = output;

    // Remove leading meta-commentary patterns (from start of text)
    const leadingPatterns = [
      /^I will (now )?analyze[^\n]*(\n\n|\n)/i,
      /^I will (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Let me (now )?analyze[^\n]*(\n\n|\n)/i,
      /^Let me (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Now,? I will send[^\n]*(\n\n|\n)/i,
      /^I will (now )?send[^\n]*(\n\n|\n)/i,
      /^Executing[^\n]*(\n\n|\n)/i,
      /^Processing[^\n]*(\n\n|\n)/i,
    ];

    for (const pattern of leadingPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove trailing meta-commentary patterns (from end of text)
    const sections = cleaned.split(/\n\n+/);
    const cleanedSections = sections.filter(section => {
      const lower = section.toLowerCase().trim();
      // Remove sections that are purely narrative about sending
      if (lower.startsWith('now,') && lower.includes('send')) return false;
      if (lower.startsWith('i will') && lower.includes('send')) return false;
      if (lower.startsWith('let me send')) return false;
      if (lower.startsWith('### sending')) return false;
      if (lower.startsWith('---') && lower.includes('send')) return false;
      return true;
    });

    cleaned = cleanedSections.join('\n\n');
    cleaned = cleaned.trim();

    // If the cleaning removed too much (less than 50 chars), return original
    if (cleaned.length < 50) {
      logger.warn({ cleanedLength: cleaned.length, originalLength: output.length }, 'Cleaned summary too short - using original');
      return output;
    }

    logger.debug({ cleanedLength: cleaned.length, originalLength: output.length }, 'Cleaned summary output');
    return cleaned;
  }

  /**
   * Execute deterministic extraction step
   * Extracts text from document (FREE via OCR), then uses LLM to extract structured fields
   */
  private async executeDeterministicExtraction(
    step: DeterministicExtractionStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    logger.info({ stepId: step.id, documentType: step.document_type }, 'Executing deterministic extraction step');

    // Resolve input data - should contain document content
    const inputData = params.input || context.resolveVariable?.(step.input);

    if (!inputData) {
      throw new ExecutionError(
        `Deterministic extraction step ${step.id} has no input data`,
        'MISSING_INPUT',
        step.id
      );
    }

    // Extract document content, mime type, and context fields
    let content: string;
    let mimeType: string;
    let inputContext: Record<string, any> = {};

    // Log input data structure for debugging
    logger.info({
      stepId: step.id,
      inputDataKeys: typeof inputData === 'object' && inputData !== null ? Object.keys(inputData).slice(0, 20) : typeof inputData,
      hasParentData: typeof inputData === 'object' && inputData !== null && '_parentData' in inputData,
      hasContent: typeof inputData === 'object' && inputData !== null && 'content' in inputData,
      filename: typeof inputData === 'object' && inputData !== null ? inputData.filename : undefined,
    }, 'Deterministic extraction input data structure');

    if (typeof inputData === 'string') {
      // Assume base64 PDF content
      content = inputData;
      mimeType = 'application/pdf';
    } else if (inputData.content && inputData.mimeType) {
      // Structured input with content and mimeType
      content = inputData.content;
      mimeType = inputData.mimeType;

      // Extract context fields (e.g., email subject, attachment filename, parent data)
      // Spread _parentData first, then override with specific fields
      inputContext = {
        ...(inputData._parentData || {}),
        filename: inputData.filename,
        attachment_filename: inputData.filename,
        subject: inputData.subject || inputData._parentData?.subject,
        email_subject: inputData._parentData?.subject || inputData.subject,
      };
    } else if (inputData.base64 || inputData.data) {
      // Alternative field names for base64 content
      content = inputData.base64 || inputData.data;
      mimeType = inputData.mimeType || inputData.mime_type || 'application/pdf';

      // Extract context fields
      inputContext = {
        ...(inputData._parentData || {}),
        filename: inputData.filename,
        attachment_filename: inputData.filename,
        subject: inputData.subject || inputData._parentData?.subject,
        email_subject: inputData._parentData?.subject || inputData.subject,
      };
    } else if (Array.isArray(inputData) && inputData.length > 0) {
      // Array of items - process first item (or could be modified to process all)
      const firstItem = inputData[0];
      content = firstItem.content || firstItem.base64 || firstItem.data;
      mimeType = firstItem.mimeType || firstItem.mime_type || 'application/pdf';

      // Extract context fields
      inputContext = {
        ...(firstItem._parentData || {}),
        filename: firstItem.filename,
        attachment_filename: firstItem.filename,
        subject: firstItem.subject || firstItem._parentData?.subject,
        email_subject: firstItem._parentData?.subject || firstItem.subject,
      };
    } else {
      throw new ExecutionError(
        `Deterministic extraction step ${step.id}: Cannot extract document content from input`,
        'INVALID_INPUT_FORMAT',
        step.id
      );
    }

    // Filter out undefined/null values from context
    inputContext = Object.fromEntries(
      Object.entries(inputContext).filter(([_, value]) => value !== undefined && value !== null && value !== '')
    );

    logger.info({
      stepId: step.id,
      hasInputContext: Object.keys(inputContext).length > 0,
      contextKeys: Object.keys(inputContext),
      contextSample: Object.keys(inputContext).slice(0, 5).reduce((acc, key) => {
        acc[key] = typeof inputContext[key] === 'string' && inputContext[key].length > 50
          ? inputContext[key].substring(0, 50) + '...'
          : inputContext[key];
        return acc;
      }, {} as Record<string, any>),
    }, 'Extraction input context extracted');

    // Build output schema from step definition (preserving type for flexible output)
    const outputSchema = step.output_schema ? {
      type: step.output_schema.type || 'object',
      fields: step.output_schema.fields?.map(f => ({
        name: f.name,
        type: f.type,
        required: f.required,
        description: f.description,
      })),
      items: step.output_schema.items ? {
        fields: step.output_schema.items.fields.map(f => ({
          name: f.name,
          type: f.type,
          required: f.required,
          description: f.description,
        }))
      } : undefined,
      description: step.output_schema.description,
    } : undefined;

    // Create extractor and run text extraction (FREE - OCR only, no LLM)
    const ocrEnabled = step.ocr_fallback !== false;
    const extractor = new DeterministicExtractor(ocrEnabled);

    const result = await extractor.extract({
      content,
      mimeType,
      filename: inputContext.filename,
      inputContext, // Pass context fields (email subject, filename, etc.) for field extraction
      config: {
        documentType: step.document_type || 'auto',
        outputSchema: outputSchema ? { fields: outputSchema.fields || outputSchema.items?.fields || [] } : undefined,
        ocrFallback: ocrEnabled,
      }
    });

    logger.info({
      stepId: step.id,
      confidence: result.confidence,
      outputType: outputSchema?.type || 'object',
      hasRawText: !!result.rawText,
      extractionMethod: result.metadata?.extractionMethod,
    }, 'Deterministic extraction complete');

    // CRITICAL: Check if deterministic extraction was successful
    // Only use LLM fallback if confidence is low or extraction failed
    const CONFIDENCE_THRESHOLD = 0.7; // 70% confidence required to skip LLM

    if (result.success && result.confidence >= CONFIDENCE_THRESHOLD) {
      // Deterministic extraction succeeded with high confidence - use it directly (no LLM cost!)
      logger.info({
        stepId: step.id,
        confidence: result.confidence,
        fieldsExtracted: result.metadata?.fieldsExtracted,
        method: result.metadata?.extractionMethod,
      }, 'Using deterministic extraction result (high confidence, no LLM needed)');

      return {
        data: result.data,
        confidence: result.confidence,
        needsLlmFallback: false,
        metadata: {
          ...result.metadata,
          llmTokensUsed: 0, // No LLM used!
          outputType: outputSchema?.type || 'object',
          extractionMethod: result.metadata?.extractionMethod,
        },
      };
    }

    // Deterministic extraction failed or low confidence - fallback to LLM
    logger.info({
      stepId: step.id,
      confidence: result.confidence,
      threshold: CONFIDENCE_THRESHOLD,
      reason: !result.success ? 'extraction_failed' : 'low_confidence',
      hasInputContext: Object.keys(inputContext).length > 0,
    }, 'Falling back to LLM for field extraction');

    const llmResult = await this.extractFieldsWithLLM(
      step.id,
      outputSchema,
      result.rawText || '',
      step.instruction,
      context,
      inputContext // Pass context fields to LLM for fields like email_subject, attachment_filename
    );

    return {
      data: llmResult.data,
      confidence: llmResult.confidence,
      needsLlmFallback: false,
      metadata: {
        ...result.metadata,
        llmTokensUsed: llmResult.tokensUsed,
        outputType: outputSchema?.type || 'object',
        fallbackReason: !result.success ? 'extraction_failed' : 'low_confidence',
        deterministicConfidence: result.confidence,
      },
    };
  }

  /**
   * Extract structured data from document text using LLM
   * Supports flexible output formats based on user intent:
   * - object: Single record per document (default)
   * - array: Multiple items per document (e.g., line items from receipt)
   * - string: Summary or unstructured text output
   */
  private async extractFieldsWithLLM(
    stepId: string,
    outputSchema: {
      type?: 'object' | 'array' | 'string';
      fields?: Array<{ name: string; type: string; required?: boolean; description?: string }>;
      items?: { fields: Array<{ name: string; type: string; required?: boolean; description?: string }> };
      description?: string;
    } | undefined,
    rawText: string,
    instruction: string | undefined,
    context: ExecutionContext,
    inputContext?: Record<string, any>
  ): Promise<{ data: any; confidence: number; tokensUsed: number }> {
    const outputType = outputSchema?.type || 'object';
    const fields = outputType === 'array' ? outputSchema?.items?.fields : outputSchema?.fields;

    // Truncate raw text if too long
    const truncatedText = rawText.length > 8000
      ? rawText.substring(0, 8000) + '... [truncated]'
      : rawText;

    // Build prompt based on output type
    const prompt = this.buildExtractionPrompt(outputType, fields, outputSchema?.description, instruction, truncatedText, inputContext);

    try {
      const result = await runAgentKit(
        context.userId,
        {
          ...context.agent,
          plugins_required: [], // No tools needed for extraction
        },
        prompt,
        {},
        context.sessionId
      );

      if (result.success && result.response) {
        const parsed = this.parseLLMExtractionResponse(result.response, outputType, fields);
        const confidence = this.calculateExtractionConfidence(parsed, outputType, fields);

        logger.info({
          stepId,
          outputType,
          confidence,
          tokensUsed: result.tokensUsed?.total || 0,
        }, 'LLM field extraction complete');

        return {
          data: parsed,
          confidence,
          tokensUsed: result.tokensUsed?.total || 0,
        };
      }

      logger.warn({ stepId }, 'LLM extraction returned no response');
      return { data: outputType === 'array' ? [] : outputType === 'string' ? '' : {}, confidence: 0, tokensUsed: 0 };
    } catch (error: any) {
      logger.error({ err: error, stepId }, 'LLM field extraction failed');
      return { data: outputType === 'array' ? [] : outputType === 'string' ? '' : {}, confidence: 0, tokensUsed: 0 };
    }
  }

  /**
   * Build extraction prompt based on output type
   */
  private buildExtractionPrompt(
    outputType: 'object' | 'array' | 'string',
    fields: Array<{ name: string; type: string; required?: boolean; description?: string }> | undefined,
    schemaDescription: string | undefined,
    instruction: string | undefined,
    documentText: string,
    inputContext?: Record<string, any>
  ): string {
    const baseInstruction = instruction || schemaDescription || 'Extract the requested information from this document.';

    // Build context section if available
    let contextSection = '';
    if (inputContext && Object.keys(inputContext).length > 0) {
      const contextFields = Object.entries(inputContext)
        .filter(([_, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
        .join('\n');

      if (contextFields) {
        contextSection = `\nContext:\n${contextFields}\n`;
      }
    }

    if (outputType === 'string') {
      return `${baseInstruction}
${contextSection}
Document text:
${documentText}

Respond with your answer as plain text.`;
    }

    if (!fields || fields.length === 0) {
      return `${baseInstruction}
${contextSection}
Document text:
${documentText}

Respond with a JSON ${outputType === 'array' ? 'array' : 'object'} containing the extracted information.`;
    }

    const fieldDescriptions = fields.map(f =>
      `- ${f.name} (${f.type}${f.required ? ', required' : ''}): ${f.description || 'No description'}`
    ).join('\n');

    if (outputType === 'array') {
      // Build context instruction for array output
      let contextInstruction = '';
      if (inputContext && Object.keys(inputContext).length > 0) {
        const contextFieldNames = Object.keys(inputContext)
          .filter(key => fields.some(f => f.name === key))
          .join(', ');

        if (contextFieldNames) {
          contextInstruction = `\n\nIMPORTANT: For fields ${contextFieldNames}, use the SAME values from the context below for ALL items extracted from this document:`;
        }
      }

      return `${baseInstruction}

Fields to extract for EACH item:
${fieldDescriptions}${contextInstruction}
${contextSection}
Document text:
${documentText}

Respond with a JSON array where each element is an object with the fields above.${contextInstruction ? '\nRemember: Context fields should have the SAME value for ALL items in the array.' : ''}`;
    }

    // Default: object type
    return `${baseInstruction}

Fields to extract:
${fieldDescriptions}
${contextSection}
Document text:
${documentText}

Respond with a JSON object containing the extracted field values.`;
  }

  /**
   * Parse LLM extraction response based on expected output type
   */
  private parseLLMExtractionResponse(
    output: string,
    outputType: 'object' | 'array' | 'string',
    expectedFields?: Array<{ name: string; type: string }>
  ): any {
    // String type: return as-is (trimmed)
    if (outputType === 'string') {
      return output.trim();
    }

    try {
      if (outputType === 'array') {
        // Try to extract JSON array from the response
        const jsonMatch = output.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            // Apply type coercion to each item
            return parsed.map(item => this.coerceFieldTypes(item, expectedFields));
          }
        }
        return [];
      }

      // Object type (default)
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.coerceFieldTypes(parsed, expectedFields);
      }
    } catch (error: any) {
      logger.warn({ err: error, output, outputType }, 'Failed to parse LLM extraction response as JSON');

      // Fallback for object type: try to extract values from text response
      if (outputType === 'object' && expectedFields) {
        const result: Record<string, any> = {};
        for (const field of expectedFields) {
          const pattern = new RegExp(`${field.name}[:\\s]+["']?([^"',\\n]+)["']?`, 'i');
          const match = output.match(pattern);
          result[field.name] = match ? match[1].trim() : null;
        }
        return result;
      }
    }

    return outputType === 'array' ? [] : {};
  }

  /**
   * Apply type coercion to extracted fields
   */
  private coerceFieldTypes(
    data: Record<string, any>,
    expectedFields?: Array<{ name: string; type: string }>
  ): Record<string, any> {
    if (!expectedFields) return data;

    const result: Record<string, any> = {};
    for (const field of expectedFields) {
      if (field.name in data) {
        let value = data[field.name];

        // Type coercion based on field type
        if (field.type === 'number' && typeof value === 'string') {
          const parsed = parseFloat(value.replace(/[^0-9.-]/g, ''));
          value = isNaN(parsed) ? null : parsed;
        } else if (field.type === 'boolean' && typeof value === 'string') {
          value = ['true', 'yes', '1'].includes(value.toLowerCase());
        }

        result[field.name] = value;
      } else {
        result[field.name] = null;
      }
    }
    return result;
  }

  /**
   * Calculate confidence score based on extraction results
   */
  private calculateExtractionConfidence(
    data: any,
    outputType: 'object' | 'array' | 'string',
    expectedFields?: Array<{ name: string; type: string }>
  ): number {
    if (outputType === 'string') {
      return data && data.length > 0 ? 1.0 : 0;
    }

    if (outputType === 'array') {
      if (!Array.isArray(data) || data.length === 0) return 0;
      if (!expectedFields || expectedFields.length === 0) return 1.0;

      // Average confidence across all items
      const itemConfidences = data.map((item: Record<string, any>) => {
        const extractedCount = Object.values(item).filter(v => v !== null && v !== undefined).length;
        return expectedFields.length > 0 ? extractedCount / expectedFields.length : 1.0;
      });
      return itemConfidences.reduce((a: number, b: number) => a + b, 0) / itemConfidences.length;
    }

    // Object type
    if (!expectedFields || expectedFields.length === 0) return 1.0;
    const extractedCount = Object.values(data).filter(v => v !== null && v !== undefined).length;
    return expectedFields.length > 0 ? extractedCount / expectedFields.length : 1.0;
  }

  // ============================================================================
  // BATCH CALIBRATION HELPER METHODS
  // ============================================================================

  /**
   * Check if step should be skipped due to failed dependencies
   * Used in batch calibration mode to avoid cascading errors
   */
  private shouldSkipDueToDependencies(
    step: WorkflowStep,
    context: ExecutionContext
  ): boolean {
    const dependencies = step.dependencies || [];

    // Check if any dependency failed with non-recoverable error
    for (const depId of dependencies) {
      if (context.failedSteps.includes(depId)) {
        // Check if the failure was recoverable
        const failedOutput = context.getStepOutput(depId);
        if (!failedOutput || !(failedOutput.metadata as any).recoverable) {
          logger.debug({
            stepId: step.id,
            dependencyId: depId,
            reason: 'non_recoverable_dependency_failure'
          }, 'Step will be skipped due to failed dependency');
          return true; // Skip this step
        }
      }
    }

    return false;
  }

  /**
   * Determine if execution should continue after error (batch calibration mode)
   *
   * CONTINUE for:
   * - Parameter errors (e.g., "range not found") - other steps might have different errors
   * - Data shape mismatches - RepairEngine can fix these
   * - Data unavailable (empty results) - not a fatal error
   *
   * STOP for:
   * - Auth errors - no point continuing without API access
   * - Connection errors - API unavailable
   * - Logic errors with null data - downstream will cascade
   */
  private shouldContinueAfterError(
    classification: import('./shadow/types').FailureClassification
  ): boolean {
    const category = classification.category;
    const subType = classification.sub_type;

    // Diagnostic logging to help debug error classification
    console.log(`[BatchCalibration] Error classification: ${category}${subType ? ` (sub_type: ${subType})` : ''}`);

    // Always continue for parameter errors
    // (Other steps might have different parameter errors we want to catch)
    if (category === 'execution_error') {
      // Stop for auth errors specifically
      if (subType === 'auth') {
        console.log('[BatchCalibration] ❌ Stopping execution - auth error requires user intervention');
        return false;
      }
      // Continue for other execution errors (timeout, rate limit, parameter errors, etc.)
      console.log('[BatchCalibration] ✅ Continuing after execution error - collecting issues');
      return true;
    }

    // Continue for data shape mismatches (RepairEngine can help)
    if (category === 'data_shape_mismatch') {
      console.log('[BatchCalibration] ✅ Continuing after data shape mismatch - collecting issues');
      return true;
    }

    // Continue for data unavailable (empty results)
    if (category === 'data_unavailable') {
      console.log('[BatchCalibration] ✅ Continuing after data unavailable - collecting issues');
      return true;
    }

    // Stop for logic errors (null references, etc.)
    if (category === 'logic_error') {
      console.log('[BatchCalibration] ❌ Stopping execution - logic error may cause cascading failures');
      return false;
    }

    // Stop for capability mismatch (wrong plugin/action)
    if (category === 'capability_mismatch') {
      console.log('[BatchCalibration] ❌ Stopping execution - capability mismatch cannot be auto-fixed');
      return false;
    }

    // Stop for missing steps
    if (category === 'missing_step') {
      console.log('[BatchCalibration] ❌ Stopping execution - missing step breaks workflow');
      return false;
    }

    // Stop for invalid step order
    if (category === 'invalid_step_order') {
      console.log('[BatchCalibration] ❌ Stopping execution - invalid step order breaks dependencies');
      return false;
    }

    // Default: continue to be safe (collect as many issues as possible)
    // We can adjust this later based on real-world testing
    console.log('[BatchCalibration] ✅ Continuing after unknown error category - collecting issues (safe default)');
    return true;
  }

  /**
   * Calculate item count from step result for business intelligence
   *
   * Handles multiple output formats:
   * - Direct arrays: [item1, item2, ...] → count = length
   * - Nested arrays: {emails: [...], total: 20} → count = emails.length
   * - Count field: {count: 20, ...} → count = 20
   * - Single object: {id: 1, ...} → count = 1
   *
   * @private
   */
  private calculateItemCount(result: any): number | undefined {
    if (!result) {
      return undefined;
    }

    // Direct array
    if (Array.isArray(result)) {
      return result.length;
    }

    // Object with nested arrays or count fields
    if (typeof result === 'object') {
      // Look for nested array fields (e.g., {emails: [...], total_found: 20})
      const arrayFields = Object.entries(result).filter(
        ([key, value]) => Array.isArray(value) && (value as any[]).length > 0
      );

      if (arrayFields.length > 0) {
        // Use the first array field's length
        const [fieldName, arrayValue] = arrayFields[0];
        logger.debug({
          fieldName,
          count: (arrayValue as any[]).length,
        }, 'Calculated item count from nested array field');
        return (arrayValue as any[]).length;
      }

      // Look for explicit count/total fields
      const countFields = ['count', 'total', 'total_found', 'total_count', 'length'];
      for (const field of countFields) {
        if (typeof result[field] === 'number') {
          logger.debug({
            field,
            count: result[field],
          }, 'Calculated item count from count field');
          return result[field];
        }
      }

      // Single object result (not an array container)
      return 1;
    }

    // Primitive values
    return undefined;
  }
}
