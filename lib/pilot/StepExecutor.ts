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
import { StepCache } from './StepCache';
import { AISConfigService } from '@/lib/services/AISConfigService';
// TODO: Implement these classes for per-step routing
// import { TaskComplexityAnalyzer } from './TaskComplexityAnalyzer';
// import { PerStepModelRouter } from './PerStepModelRouter';

export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private conditionalEvaluator: ConditionalEvaluator;
  private stateManager: any; // StateManager (avoiding circular dependency)
  private stepCache: StepCache;
  // private complexityAnalyzer: TaskComplexityAnalyzer;
  // private modelRouter: PerStepModelRouter;

  constructor(supabase: SupabaseClient, stateManager?: any, stepCache?: StepCache) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.stateManager = stateManager;
    this.stepCache = stepCache || new StepCache(false);
    // this.complexityAnalyzer = new TaskComplexityAnalyzer();
    // this.modelRouter = new PerStepModelRouter();
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

    // === CACHING CHECK ===
    // Check cache before execution (for deterministic steps only)
    const cacheableTypes = ['action', 'transform', 'validation', 'comparison'];
    if (cacheableTypes.includes(step.type)) {
      const cachedOutput = this.stepCache.get(step.id, step.type, step.params || {});
      if (cachedOutput) {
        console.log(`💾 [StepExecutor] Cache hit for step ${step.id}, skipping execution`);
        return cachedOutput;
      }
    }

    // === ORCHESTRATION INTEGRATION (Phase 4) ===
    // Check if step should use orchestration (only AI tasks, not deterministic plugin actions)
    const shouldUseOrchestration = this.shouldUseOrchestration(step);

    if (shouldUseOrchestration && context.orchestrator && context.orchestrator.isActive()) {
      console.log(`🎯 [StepExecutor] Using orchestration for AI task: ${step.id} (type: ${step.type})`);

      try {
        // ✅ CRITICAL: Resolve variables BEFORE passing to orchestration
        // This ensures {{step1.data.emails}} is resolved to actual data for Step 2
        const resolvedParams = context.resolveAllVariables(step.params || {});

        console.log(`🔍 [StepExecutor] Orchestration step ${step.id} params BEFORE resolution:`, JSON.stringify(step.params, null, 2));
        console.log(`🔍 [StepExecutor] Orchestration step ${step.id} params AFTER resolution:`, JSON.stringify(resolvedParams, null, 2));

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
          console.log(`✅ [StepExecutor] Orchestration executed step ${step.id} successfully`);
          console.log(`   Tokens: ${orchestrationResult.tokensUsed.total}, Saved: ${orchestrationResult.tokensSaved}`);

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
        console.warn(`⚠️  [StepExecutor] Orchestration failed for step ${step.id}, falling back to normal execution:`, orchestrationError.message);
        // Fall through to normal execution
      }
    } else if (!shouldUseOrchestration && context.orchestrator?.isActive()) {
      console.log(`⚡ [StepExecutor] Skipping orchestration for deterministic step: ${step.id} (type: ${step.type}) - executing plugin directly`);
    }

    // === NORMAL EXECUTION (Fallback or when orchestration is disabled) ===

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

<<<<<<< Updated upstream
      // 🔍 DEBUG: Log variable resolution
      console.log(`🔍 [StepExecutor] Step ${step.id} params BEFORE resolution:`, JSON.stringify(step.params, null, 2));
      console.log(`🔍 [StepExecutor] Step ${step.id} params AFTER resolution:`, JSON.stringify(resolvedParams, null, 2));
=======
      if (step.type === 'action') {
        // PILOT DSL uses 'config' field, not 'params'
        const stepAny = step as any;
        const actionConfig = step.params || stepAny.config || {};
        console.log('[StepExecutor] Action step BEFORE resolution:', step.id, JSON.stringify({
          params: step.params,
          config: stepAny.config,
          hasParams: 'params' in step,
          hasConfig: 'config' in stepAny
        }));
        resolvedParams = context.resolveAllVariables(actionConfig);
        console.log('[StepExecutor] Action step AFTER resolution:', step.id, JSON.stringify(resolvedParams));
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
        if ('scatter' in stepAny) {
          // Only resolve scatter config, NOT the nested steps
          // Nested steps will be resolved during each scatter iteration
          fieldsToResolve.scatter = {
            input: stepAny.scatter.input,
            itemVariable: stepAny.scatter.itemVariable,
            maxConcurrency: stepAny.scatter.maxConcurrency
            // Deliberately exclude 'steps' - they contain loop variables not yet defined
          };
        }
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
>>>>>>> Stashed changes

      let result: any;
      let tokensUsed: number | { total: number; prompt: number; completion: number } = 0;

      // Route to appropriate executor based on step type
      switch (step.type) {
        case 'action':
          // ✅ P0 FIX: Capture plugin tokens from executeAction return value
          const actionResult = await this.executeAction(step as ActionStep, resolvedParams, context);
          result = actionResult.data;
          tokensUsed = actionResult.pluginTokens || 0;
          console.log(`📊 [StepExecutor] Plugin action returned ${tokensUsed} tokens`);
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

      // === CACHE STORAGE ===
      // Store in cache if step type is cacheable
      if (cacheableTypes.includes(step.type)) {
        this.stepCache.set(step.id, step.type, step.params || {}, output);
        console.log(`💾 [StepExecutor] Cached result for step ${step.id}`);
      }

      return output;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      console.error(`[StepExecutor] Step ${step.id} failed:`, error);

<<<<<<< Updated upstream
=======
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
          shouldContinue,
          willStopExecution: true // Always stop in batch calibration to prevent cascade failures
        }, 'Batch calibration: error classified - stopping execution to fix and re-run');

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

        // CRITICAL FIX: In batch calibration, ALWAYS stop execution on ANY failure
        // This prevents cascade failures where downstream steps execute with null/empty data
        // The calibration loop will fix the issue and re-run the entire workflow from the beginning
        logger.warn({
          stepId: step.id,
          category: classification.category,
          recoverable: shouldContinue,
          message: 'Stopping execution to prevent cascade failures - calibration will fix and re-run'
        }, 'Batch calibration: step failed, stopping workflow execution');

        throw new ExecutionError(
          `Calibration stopped at ${step.name}: ${error.message}. ` +
          `Workflow execution halted to prevent downstream steps from running with invalid data. ` +
          `The calibration system will fix this issue and re-run the workflow.`,
          error.code || 'CALIBRATION_STOP',
          step.id,
          // @ts-ignore - adding custom flags
          {
            cause: error,
            stopCalibration: true,
            recoverable: shouldContinue,
            issueCollected: issue.id
          }
        );
      }

      // === NORMAL MODE: Original error handling ===
>>>>>>> Stashed changes
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
    // Support both 'action' and 'operation' fields for backward compatibility
    const action = step.action || step.operation;

    if (!step.plugin || !action) {
      throw new ExecutionError(
        `Action step ${step.id} missing plugin or action`,
        'MISSING_PLUGIN_ACTION',
        step.id
      );
    }

<<<<<<< Updated upstream
    console.log(`[StepExecutor] Executing plugin: ${step.plugin}.${step.action}`);

    const actionStartTime = Date.now();

=======
    logger.info({ stepId: step.id, plugin: step.plugin, action }, 'Executing plugin action');

    const actionStartTime = Date.now();

    // ✅ SCHEMA-AWARE PARAMETER RESOLUTION + TRANSFORMATION
    // First resolve parameters with schema awareness, then transform for plugin expectations
    const transformedParams = await this.transformParametersForPlugin(
      step.plugin,
      action,
      step.params, // Pass original params (with {{variables}}) not resolved params
      context
    );

    // Log transformed params for debugging plugin execution
    logger.debug({
      stepId: step.id,
      plugin: step.plugin,
      action,
      transformedParams,
    }, 'Plugin action transformed params');

>>>>>>> Stashed changes
    // Execute via PluginExecuterV2 (use getInstance for singleton)
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(
      context.userId,
      step.plugin,
<<<<<<< Updated upstream
      step.action,
      params
=======
      action,
      transformedParams
>>>>>>> Stashed changes
    );

    const actionDuration = Date.now() - actionStartTime;

    if (!result.success) {
<<<<<<< Updated upstream
      throw new ExecutionError(
        result.error || `Plugin execution failed: ${step.plugin}.${step.action}`,
        'PLUGIN_EXECUTION_FAILED',
        step.id,
        { plugin: step.plugin, action: step.action, error: result.error }
=======
      logger.error({
        stepId: step.id,
        plugin: step.plugin,
        action,
        error: result.error,
        message: result.message
      }, 'Plugin execution failed');
      throw new ExecutionError(
        result.message || result.error || `Plugin execution failed: ${step.plugin}.${action}`,
        step.id,
        { plugin: step.plugin, action, error: result.error, message: result.message }
>>>>>>> Stashed changes
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
        model_name: `${step.plugin}.${action}`,
        provider: 'plugin_registry_v2',
        metadata: {
          plugin: step.plugin,
          action,
          execution_time_ms: actionDuration,
          step_id: step.id,
          step_name: step.name,
          success: true,
          plugin_tokens: pluginTokens,
        }
      });

<<<<<<< Updated upstream
      console.log(`✅ [StepExecutor] Tracked plugin action: ${step.plugin}.${step.action} (${actionDuration}ms, ${pluginTokens} tokens)`);
=======
      logger.debug({
        stepId: step.id,
        plugin: step.plugin,
        action,
        durationMs: actionDuration,
        pluginTokens
      }, 'Tracked plugin action execution');
>>>>>>> Stashed changes
    } catch (trackingError) {
      // Token tracking failures should NOT fail plugin execution
      console.warn(`⚠️  [StepExecutor] Failed to track plugin action (non-critical):`, trackingError);
    }

    // ✅ P0 FIX: Return plugin tokens so they flow through StepOutput → ExecutionContext
    // This ensures tokens are properly tracked via setStepOutput() which handles retries correctly
<<<<<<< Updated upstream
=======
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
        value: action,
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

>>>>>>> Stashed changes
    return {
      data: result.data,
      pluginTokens: pluginTokens
    };
  }

  /**
<<<<<<< Updated upstream
=======
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
        logger.warn({ pluginName, actionName }, 'No definition found - using normal resolution');
        return context.resolveAllVariables(params);
      }

      const actionDef = pluginDef.actions[actionName];
      const paramSchema = actionDef.parameters;

      if (!paramSchema || !paramSchema.properties) {
        logger.debug({ pluginName, actionName }, 'No parameter schema found - using normal resolution');
        return context.resolveAllVariables(params);
      }

      // ✅ SCHEMA-AWARE RESOLUTION: Resolve parameters with type-aware field extraction
      const resolved = context.resolveParametersWithSchema(params, paramSchema);
      const transformed = { ...resolved };

      // Iterate through each parameter in the schema
      for (const [paramName, paramDef] of Object.entries(paramSchema.properties)) {
        const def = paramDef as any;

        // ===================================================================
        // HANDLE x-input-mapping FOR FILE OBJECTS
        // Some parameters accept file objects and extract specific fields
        // Example: file_url accepts file object and extracts web_view_link
        // ===================================================================
        if (def['x-input-mapping'] && transformed[paramName]) {
          const mapping = def['x-input-mapping'];
          const value = transformed[paramName];

          // If accepts includes "file_object" and value is an object
          if (mapping.accepts?.includes('file_object') &&
              typeof value === 'object' &&
              value !== null &&
              !Array.isArray(value) &&
              mapping.from_file_object) {

            const fieldToExtract = mapping.from_file_object;

            // Extract the specified field from the file object
            if (value[fieldToExtract]) {
              logger.debug({
                paramName,
                pluginName,
                actionName,
                extractedField: fieldToExtract
              }, 'Extracting field from file object via x-input-mapping');

              transformed[paramName] = value[fieldToExtract];
            } else {
              logger.warn({
                paramName,
                pluginName,
                actionName,
                expectedField: fieldToExtract,
                availableFields: Object.keys(value)
              }, 'x-input-mapping: expected field not found in file object');
            }
          }
        }

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
>>>>>>> Stashed changes
   * Determine if a step should use orchestration
   * Only AI tasks (summarize, analyze, decide) need orchestration
   * Deterministic plugin actions should execute directly
   */
  private shouldUseOrchestration(step: WorkflowStep): boolean {
    // AI processing steps NEED orchestration for LLM-based handling
    if (step.type === 'ai_processing' || step.type === 'llm_decision') {
      return true;
    }

    // Plugin action steps should NOT use orchestration
    // These are direct API calls to external services - no LLM needed
    if (step.type === 'action') {
      return false;
    }

    // Transform, enrich, validation steps may benefit from orchestration
    // but typically don't need it - default to false for efficiency
    if (step.type === 'transform' || step.type === 'enrich' || step.type === 'validation') {
      return false;
    }

    // Other types (switch, delay, comparison) don't need orchestration
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
    console.log(`[StepExecutor] Executing LLM decision: ${step.name}`);

    const stepStartTime = Date.now();
    let selectedModel: string | undefined;
    let routingDecision: any;

    // === PER-STEP INTELLIGENT ROUTING ===
    // TODO: Re-enable once TaskComplexityAnalyzer and PerStepModelRouter are implemented
    // Analyze step complexity and route to optimal model
    try {
      // const isRoutingEnabled = await this.modelRouter.isEnabled();
      const isRoutingEnabled = false; // Disabled until classes are implemented

      if (isRoutingEnabled) {
        console.log(`🎯 [StepExecutor] Per-step routing enabled - analyzing complexity...`);

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
        console.log(`ℹ️ [StepExecutor] Per-step routing disabled - using agent default model`);
      }
    } catch (routingError) {
      console.error('❌ [StepExecutor] Routing failed, falling back to agent default:', routingError);
      // Continue with agent default model
    }

    // Build prompt with context
    const prompt = step.prompt || step.description || step.name;

<<<<<<< Updated upstream
    // FIX: Extract variable references from prompt and resolve them into params
    // This handles cases where Smart Agent Builder creates prompts like:
    // "Analyze the following emails: {{step1.data}}"
    // We need to extract step1.data and add it to params
    console.log('🔍 [StepExecutor] Original params:', JSON.stringify(params, null, 2));
    console.log('🔍 [StepExecutor] Prompt:', prompt);
=======
    // ✅ CRITICAL FIX: AI steps should ONLY receive the data specified in their params
    // NOT the entire execution context which can be 65K+ tokens
    //
    // The step's params already contain ONLY what the workflow generator specified
    // (e.g., step15.params = {processed_items: "{{processed_items}}"}
    // After resolution, params = {processed_items: [...actual data...]}
    //
    // We should NOT add more data from prompt references or previous steps
    // This prevents token bloat and ensures AI steps get exactly what they need
>>>>>>> Stashed changes

    logger.debug({
      stepId: step.id,
      params,
      paramKeys: Object.keys(params || {}),
      prompt
    }, 'LLM decision with scoped params (only what step specified)');

<<<<<<< Updated upstream
    // Extract all {{variable}} references from the prompt
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = prompt.match(variablePattern);

    if (matches && matches.length > 0) {
      console.log('🔍 [StepExecutor] Found variable references in prompt:', matches);

      for (const match of matches) {
        try {
          const resolved = context.resolveVariable(match);

          // Extract the variable name for use as a key
          // e.g., "{{step1.data}}" -> "step1_data"
          const varName = match.replace(/\{\{|\}\}/g, '').replace(/\./g, '_');

          // Only add to params if it's not already there
          if (!enrichedParams[varName]) {
            enrichedParams[varName] = resolved;
            console.log(`🔍 [StepExecutor] Added "${varName}" to params from prompt variable "${match}"`);
          }
        } catch (error: any) {
          console.warn(`🔍 [StepExecutor] Could not resolve variable "${match}" from prompt:`, error.message);
        }
      }
    }

    // If params are still empty after enrichment, try to get data from previous step
    if (Object.keys(enrichedParams).length === 0) {
      console.log('🔍 [StepExecutor] Params still empty, checking for previous step outputs...');

      const allOutputs = context.getAllStepOutputs();
      if (allOutputs.size > 0) {
        // Get the last step's output
        const outputsArray = Array.from(allOutputs.entries());
        const [lastStepId, lastOutput] = outputsArray[outputsArray.length - 1];

        console.log(`🔍 [StepExecutor] Using output from previous step "${lastStepId}" as default params`);
        enrichedParams.data = lastOutput.data;
      }
    }

    console.log('🔍 [StepExecutor] Enriched params:', JSON.stringify(enrichedParams, null, 2));

    const contextSummary = this.buildContextSummary(context);

    const fullPrompt = `
${prompt}
=======
    // Use params as-is - they're already resolved and scoped to this step's needs
    const scopedParams = params || {};

    const contextSummary = this.buildContextSummary(context);

    // Build prompt with vision support if images are present
    // Async to support PDF-to-image conversion
    const { fullPrompt, isVisionMode } = await this.buildLLMPrompt(
      prompt,
      contextSummary,
      scopedParams  // ✅ Only pass what this step needs, not entire execution context
    );
>>>>>>> Stashed changes

## Current Context:
${contextSummary}

## Data for Analysis:
${JSON.stringify(enrichedParams, null, 2)}

Please analyze the above and provide your decision/response.
    `.trim();

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

<<<<<<< Updated upstream
=======
      case 'deduplicate':
        return this.transformDeduplicate(data, config);

      case 'flatten':
        return this.transformFlatten(data, config, context);

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

>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
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
   * Config: {depth: number} (default: 1), {field: string} (optional - extract field before flattening)
   */
  private transformFlatten(data: any, config: any, context?: ExecutionContext): any {
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError('Flatten operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const depth = config?.depth || 1;
    let field = config?.field; // Optional: extract this field from each item before flattening

    // DETECT DOT NOTATION (invalid - likely a bug in workflow generation/calibration)
    if (field && field.includes('.')) {
      logger.warn({
        field,
        suggestedFix: field.split('.').pop()
      }, 'Flatten field contains dots - this is likely a bug. Flatten expects immediate child field name. Attempting to use last segment.');
      // Use last segment as fallback
      field = field.split('.').pop() || field;
    }

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

      // CRITICAL: In batch calibration mode, if field extraction resulted in empty array,
      // this likely means the field doesn't exist - throw error to stop workflow
      if (context?.batchCalibrationMode && dataToFlatten.length === 0 && unwrappedData.length > 0) {
        throw new ExecutionError(
          `Flatten operation extracted 0 items from ${unwrappedData.length} input items using field "${field}". ` +
          `This suggests the field "${field}" may not exist or is not an array in the input data. ` +
          `Cannot continue workflow with empty data. Check that the field name is correct.`,
          undefined,
          {
            field,
            inputItemCount: unwrappedData.length,
            extractedItemCount: 0,
            availableFields: Object.keys(unwrappedData[0] || {}),
            sampleInput: unwrappedData[0]
          }
        );
      }
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
>>>>>>> Stashed changes
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
      console.warn('[StepExecutor] Clean summary too short, using original output');
      return output;
    }

    console.log(`[StepExecutor] Cleaned summary: ${cleaned.length} chars (was ${output.length} chars)`);
    return cleaned;
  }
<<<<<<< Updated upstream
=======

  /**
   * Runtime safety check: Detect if ai_processing step input contains file data
   * If so, it should use deterministic extraction instead of sending binary data to LLM
   */
  private shouldUseDeterministicExtraction(
    step: WorkflowStep,
    params: any,
    context: ExecutionContext
  ): boolean {
    // Only check ai_processing steps
    if (step.type !== 'ai_processing') {
      return false;
    }

    // Check if step has an input field (like deterministic_extraction would)
    const inputField = (step as any).input || (step as any).config?.input;
    if (!inputField) {
      return false;
    }

    // Try to resolve the input variable
    let inputData: any;
    try {
      if (typeof inputField === 'string' && inputField.includes('{{')) {
        // Variable reference like "{{attachment_data}}"
        inputData = context.resolveVariable(inputField);
      } else {
        // Direct value or from params
        inputData = params.input || params[inputField];
      }
    } catch (err) {
      logger.debug({ stepId: step.id, inputField, err }, 'Could not resolve input for file detection');
      return false;
    }

    if (!inputData) {
      return false;
    }

    // Check if input looks like file data (has data + mimeType fields)
    const isFileData =
      typeof inputData === 'object' &&
      inputData !== null &&
      (inputData.data || inputData.content) &&  // Has binary/base64 data
      (inputData.mimeType || inputData.mime_type || inputData.contentType); // Has MIME type

    if (isFileData) {
      logger.info({
        stepId: step.id,
        mimeType: inputData.mimeType || inputData.mime_type || inputData.contentType,
        hasFilename: !!(inputData.filename || inputData.fileName)
      }, '🔒 RUNTIME SAFETY: Detected file input in ai_processing step - will use deterministic extraction');
      return true;
    }

    return false;
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

    // CRITICAL: NEVER use LLM for file extraction
    // Always use deterministic extraction results (PDF parser + AWS Textract)
    // Even if confidence is low, return what was found - NO LLM FALLBACK
    logger.info({
      stepId: step.id,
      confidence: result.confidence,
      fieldsExtracted: result.metadata?.fieldsExtracted,
      method: result.metadata?.extractionMethod,
      success: result.success,
    }, 'Using deterministic extraction result (NO LLM fallback for file data)');

    return {
      data: result.data,
      confidence: result.confidence,
      needsLlmFallback: false,
      metadata: {
        ...result.metadata,
        llmTokensUsed: 0, // No LLM ever used for file extraction!
        outputType: outputSchema?.type || 'object',
        extractionMethod: result.metadata?.extractionMethod,
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
    // Get explicit dependencies (if any)
    const explicitDeps = step.dependencies || [];

    // Get all workflow steps to analyze variable dependencies
    const allSteps = context.agent.pilot_steps || context.agent.workflow_steps || [];

    // Extract variable-based dependencies
    const variableDeps = this.getVariableDependencies(step, allSteps);

    // Combine both types of dependencies (remove duplicates)
    const allDependencies = [...new Set([...explicitDeps, ...variableDeps])];

    if (allDependencies.length > 0) {
      logger.debug({
        stepId: step.id,
        explicitDeps,
        variableDeps,
        allDependencies
      }, 'Checking dependencies for step');
    }

    // Check if any dependency failed with non-recoverable error
    for (const depId of allDependencies) {
      if (context.failedSteps.includes(depId)) {
        // Check if the failure was recoverable
        const failedOutput = context.getStepOutput(depId);
        if (!failedOutput || !(failedOutput.metadata as any).recoverable) {
          logger.info({
            stepId: step.id,
            stepName: step.name,
            dependencyId: depId,
            reason: 'non_recoverable_dependency_failure',
            wasExplicit: explicitDeps.includes(depId),
            wasImplicit: variableDeps.includes(depId)
          }, 'Skipping step due to failed dependency');
          return true; // Skip this step
        }
      }
    }

    return false;
  }

  /**
   * Get all upstream step IDs that this step depends on
   * Analyzes variable references in step config to determine dependencies
   */
  private getVariableDependencies(
    step: WorkflowStep,
    allSteps: WorkflowStep[]
  ): string[] {
    const config = (step as any).config || (step as any).params || {};
    const input = (step as any).input;

    // Extract variable references from config
    const configRefs = this.extractVariableReferences(config);

    // Extract variable references from input field
    const inputRefs = input && typeof input === 'string'
      ? this.extractVariableReferences({ input })
      : [];

    // Combine all references
    const allRefs = [...configRefs, ...inputRefs];

    const dependencyIds = new Set<string>();

    for (const ref of allRefs) {
      const stepId = this.findStepByOutputVariable(ref.variable, allSteps);
      if (stepId && stepId !== step.id) {
        dependencyIds.add(stepId);
      }
    }

    return Array.from(dependencyIds);
  }

  /**
   * Find the step ID that outputs a given variable
   * @param variableName - Variable name (e.g., "processed_items")
   * @param allSteps - All workflow steps
   * @returns Step ID or null if not found
   */
  private findStepByOutputVariable(
    variableName: string,
    allSteps: WorkflowStep[]
  ): string | null {
    // Check if it's a direct step reference (e.g., "step1")
    if (variableName.startsWith('step')) {
      return variableName;
    }

    // Find step with matching output_variable
    const step = allSteps.find(s => {
      const outputVar = (s as any).output_variable || (s as any).outputVariable;
      return outputVar === variableName;
    });

    return step ? (step.id || (step as any).step_id) : null;
  }

  /**
   * Extract all variable references from step config
   * Recursively traverses objects/arrays to find {{variable}} patterns
   * Adapted from WorkflowValidator.extractVariableReferences()
   */
  private extractVariableReferences(obj: any): Array<{
    full: string;
    variable: string;
    field: string | null;
    parameter: string;
  }> {
    const refs: Array<{
      full: string;
      variable: string;
      field: string | null;
      parameter: string;
    }> = [];

    const traverse = (value: any, path: string = '') => {
      if (typeof value === 'string') {
        // Match {{variable}} or {{variable.field}}
        const regex = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)(?:\.([a-zA-Z_][a-zA-Z0-9_.]*))?\}\}/g;
        let match;
        while ((match = regex.exec(value)) !== null) {
          refs.push({
            full: match[0],
            variable: match[1],
            field: match[2] || null,
            parameter: path
          });
        }
      } else if (Array.isArray(value)) {
        value.forEach((item, index) => traverse(item, `${path}[${index}]`));
      } else if (typeof value === 'object' && value !== null) {
        Object.entries(value).forEach(([key, val]) => {
          traverse(val, path ? `${path}.${key}` : key);
        });
      }
    };

    traverse(obj);
    return refs;
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

  /**
   * Collect execution metadata for calibration summaries from nested steps
   * (steps inside conditionals, loops, etc.)
   */
  private async collectExecutionMetadata(
    step: WorkflowStep,
    output: StepOutput,
    context: ExecutionContext
  ): Promise<void> {
    console.log(`📊 [StepExecutor] collectExecutionMetadata called for step ${step.id}, type: ${step.type}, success: ${output.metadata.success}`);

    // Only collect if we're in batch calibration mode
    if (!context.batchCalibrationMode) {
      console.log(`📊 [StepExecutor] Skipping - not in batch calibration mode (flag: ${context.batchCalibrationMode})`);
      return;
    }

    // Only collect from successful action steps
    if (step.type !== 'action' || !output.metadata.success) {
      console.log(`📊 [StepExecutor] Skipping - step type: ${step.type}, success: ${output.metadata.success}`);
      return;
    }

    // Get the execution summary collector from the pilot instance (if available)
    const collector = (context as any).executionSummaryCollector as ExecutionSummaryCollector | null;
    console.log(`📊 [StepExecutor] Collector available: ${!!collector}`);
    if (!collector) {
      console.log(`📊 [StepExecutor] No collector found on context`);
      return;
    }

    const actionStep = step as ActionStep;
    const pluginName = actionStep.plugin;
    const actionName = actionStep.action;

    try {
      // Load plugin definition to get metadata
      const fs = await import('fs');
      const path = await import('path');
      const definitionsDir = path.join(process.cwd(), 'lib', 'plugins', 'definitions');
      const fileName = `${pluginName}-plugin-v2.json`;
      const filePath = path.join(definitionsDir, fileName);
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');
      const pluginDef = JSON.parse(fileContent);
      const actionDef = pluginDef?.actions?.[actionName];

      if (!actionDef) {
        return;
      }

      // Extract count from output schema
      const itemCount = this.extractItemCount(output.data, actionDef.output_schema);

      // Determine operation type from usage_context
      const usageContext = actionDef.usage_context || '';
      const isWriteOperation = usageContext.toLowerCase().includes('add') ||
                               usageContext.toLowerCase().includes('create') ||
                               usageContext.toLowerCase().includes('send');

      // Record the data access
      if (isWriteOperation) {
        console.log(`📊 [StepExecutor] Recording data write: ${pluginName}.${actionName} (count: ${itemCount})`);
        await collector.recordDataWrite(pluginName, actionName, itemCount);
      } else {
        console.log(`📊 [StepExecutor] Recording data read: ${pluginName}.${actionName} (count: ${itemCount})`);
        await collector.recordDataRead(pluginName, actionName, itemCount);
        collector.recordItemsProcessed(itemCount);
      }
    } catch (error) {
      console.warn(`[StepExecutor] Could not collect metadata for ${pluginName}.${actionName}:`, error);
    }
  }

  /**
   * Extract item count from output data using schema as a guide
   */
  private extractItemCount(data: any, schema: any): number {
    if (!data || !schema) return 0;
    if (Array.isArray(data)) return data.length;

    // Walk the schema to find count fields
    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const field = fieldSchema as any;

        // Array field
        if (field.type === 'array' && data[fieldName]) {
          if (Array.isArray(data[fieldName])) {
            return data[fieldName].length;
          }
        }

        // Count field
        if (field.type === 'integer' && data[fieldName] !== undefined) {
          const desc = field.description?.toLowerCase() || '';
          if (desc.includes('count') || desc.includes('number of') || fieldName.includes('count')) {
            return data[fieldName];
          }
        }
      }
    }

    return typeof data === 'object' ? 1 : 0;
  }
>>>>>>> Stashed changes
}
