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
import Handlebars from 'handlebars';
import {
  validateLLMOutput,
  buildSchemaPromptInstructions,
  getSchemaPattern,
  convertDslOutputsToSchema,
  type LLMOutputSchema,
  type SchemaPattern,
} from './llm-output-validator';
import {
  normalizeStepOutput,
  getTransformType,
  extractDeclaredOutputs,
} from './output-normalizer';

// Create module-level logger for structured logging to dev.log
const logger = createLogger({ module: 'StepExecutor', service: 'workflow-pilot' });
// TODO: Implement these classes for per-step routing
// import { TaskComplexityAnalyzer } from './TaskComplexityAnalyzer';
// import { PerStepModelRouter } from './PerStepModelRouter';

export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private conditionalEvaluator: ConditionalEvaluator;
  private stateManager: any; // StateManager (avoiding circular dependency)
  private stepCache: StepCache;
  private parallelExecutor?: any; // ParallelExecutor (injected to avoid circular dependency)
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
   * Inject ParallelExecutor to handle nested scatter-gather steps
   * Called after construction to avoid circular dependency
   */
  setParallelExecutor(parallelExecutor: any): void {
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

        // ✅ FIX: Convert DSL outputs to schema for orchestration
        // This ensures orchestrated ai_processing steps also enforce their declared output structure
        let orchestrationOutputSchema: LLMOutputSchema | undefined;
        if (stepAny.output_schema) {
          if (typeof stepAny.output_schema === 'string') {
            orchestrationOutputSchema = getSchemaPattern(stepAny.output_schema as SchemaPattern);
          } else {
            orchestrationOutputSchema = stepAny.output_schema;
          }
        } else if (stepAny.outputs) {
          orchestrationOutputSchema = convertDslOutputsToSchema(stepAny.outputs);
          if (orchestrationOutputSchema) {
            logger.debug({ stepId: step.id }, 'Converted DSL outputs to schema for orchestration');
          }
        }

        // Execute via orchestration handlers
        const orchestrationResult = await context.orchestrator.executeStep(
          step.id,
          {
            step,
            params: resolvedParams,  // ✅ Use resolved params instead of raw params
            context: context.variables,  // Keep for backward compatibility
            executionContext: context,  // ✅ Pass full ExecutionContext for variable resolution
            outputSchema: orchestrationOutputSchema,  // ✅ Pass schema for LLM prompt injection
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
        // ✅ FIX: Include params for ai_processing steps so {{email}} and other scatter variables resolve
        if ('params' in stepAny) fieldsToResolve.params = stepAny.params;

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
          // Normalization is applied after the switch block
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

        default:
          throw new ExecutionError(
            `Unknown step type: ${(step as any).type}`,
            'UNKNOWN_STEP_TYPE',
            step.id
          );
      }

      const executionTime = Date.now() - startTime;

      // ============================================================
      // PHASE 1 ARCHITECTURAL REDESIGN: Output Normalization
      // ============================================================
      // Normalize step output to match declared output schema.
      // This ensures downstream steps can access data via declared keys.
      const transformType = getTransformType(step);
      const declaredOutputs = extractDeclaredOutputs(step);
      const normalized = normalizeStepOutput(result, {
        stepId: step.id,
        transformType,
        declaredOutputs,
        preserveRaw: true,
      });

      // Log normalization if it occurred
      if (normalized._meta.normalized) {
        logger.info({
          stepId: step.id,
          keyMappings: normalized._meta.keyMappings,
          wrappedKeys: normalized._meta.wrappedKeys,
          parsedKeys: normalized._meta.parsedKeys,
        }, 'Output normalized to declared schema');
      }

      // Build step output with normalized data
      const output: StepOutput = {
        stepId: step.id,
        plugin: (step as any).plugin || 'system',
        action: (step as any).action || step.type,
        data: normalized.data,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime,
          itemCount: Array.isArray(result) ? result.length :
                     (normalized.data && typeof normalized.data === 'object'
                       ? Object.values(normalized.data).find(v => Array.isArray(v))?.length
                       : undefined),
          tokensUsed: tokensUsed || undefined,
        },
        _raw: normalized._raw,
        _meta: normalized._meta,
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

      // Build error output - data is empty object on failure
      return {
        stepId: step.id,
        plugin: (step as any).plugin || 'system',
        action: (step as any).action || step.type,
        data: {},
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
    return {
      data: result.data,
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

    // Build user context section if available (for personalization in ai_processing)
    const userContext = context.getUserContext();
    let userContextSection = '';
    if (userContext && (userContext.full_name || userContext.email || userContext.company)) {
      const userInfo: string[] = [];
      if (userContext.full_name) userInfo.push(`Name: ${userContext.full_name}`);
      if (userContext.email) userInfo.push(`Email: ${userContext.email}`);
      if (userContext.company) userInfo.push(`Company: ${userContext.company}`);
      if (userContext.role) userInfo.push(`Role: ${userContext.role}`);
      if (userContext.timezone) userInfo.push(`Timezone: ${userContext.timezone}`);
      userContextSection = `\n\n## User Context (for personalization):\n${userInfo.join('\n')}`;
      logger.debug({ stepId: step.id, hasUserContext: true }, 'User context added to prompt');
    }

    // ========================================================================
    // PHASE 4: Schema-aware prompt building
    // ========================================================================
    // Check if step has output_schema for structured output validation
    const stepAny = step as any;
    let outputSchema: LLMOutputSchema | undefined;

    // Support both direct schema and schema pattern reference
    if (stepAny.output_schema) {
      if (typeof stepAny.output_schema === 'string') {
        // Schema pattern reference like "extraction" or "classification"
        outputSchema = getSchemaPattern(stepAny.output_schema as SchemaPattern);
      } else {
        // Direct schema object
        outputSchema = stepAny.output_schema;
      }
    } else if (stepAny.outputs) {
      // ✅ FIX: Convert DSL outputs declaration to LLMOutputSchema
      // This ensures ai_processing steps enforce their declared output structure
      outputSchema = convertDslOutputsToSchema(stepAny.outputs);
      if (outputSchema) {
        logger.debug({ stepId: step.id, outputs: stepAny.outputs }, 'Converted DSL outputs to LLMOutputSchema');
      }
    }

    // Build schema instructions if schema is defined
    let schemaInstructions = '';
    if (outputSchema) {
      schemaInstructions = '\n\n' + buildSchemaPromptInstructions(outputSchema);
      logger.debug({ stepId: step.id, schemaType: outputSchema.type }, 'Adding schema instructions to LLM prompt');
    }

    const fullPrompt = `
${prompt}

## Current Context:
${contextSummary}${userContextSection}

## Data for Analysis:
${JSON.stringify(enrichedParams, null, 2)}
${schemaInstructions}
${outputSchema ? '' : 'Please analyze the above and provide your decision/response.'}
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

    // ========================================================================
    // PHASE 4: Execute with validation and retry
    // ========================================================================
    const MAX_RETRIES = 2;
    let lastError: string | undefined;
    let result: any;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Build retry prompt if this is a retry
      let attemptPrompt = fullPrompt;
      if (attempt > 0 && lastError) {
        attemptPrompt = `${fullPrompt}\n\n## RETRY NOTICE\nYour previous response failed validation: ${lastError}\nPlease fix the issues and try again with valid JSON.`;
        logger.info({ stepId: step.id, attempt, error: lastError }, 'Retrying LLM call due to validation failure');
      }

      result = await runAgentKit(
        context.userId,
        agentForExecution,
        attemptPrompt,
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

      // If we have a schema, validate the response
      if (outputSchema) {
        const validation = validateLLMOutput(result.response, outputSchema);

        if (validation.valid) {
          // Replace response with validated/parsed data
          result.response = validation.data;
          logger.debug({ stepId: step.id, attempt }, 'LLM response passed schema validation');
          break;
        } else {
          lastError = validation.errors?.join('; ') || 'Validation failed';
          logger.warn({
            stepId: step.id,
            attempt,
            errors: validation.errors,
            retryHint: validation.retryHint,
          }, 'LLM response failed schema validation');

          if (attempt === MAX_RETRIES) {
            // Final attempt failed - log warning but continue with raw response
            logger.error({
              stepId: step.id,
              errors: validation.errors,
            }, 'LLM response failed validation after all retries, using raw response');
          }
        }
      } else {
        // No schema - response is valid as-is
        break;
      }
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

    // ✅ FIX: Parse JSON response to enable {{stepX.data.items}} access
    // LLM often returns JSON strings like '{"items":[...]}' which need to be parsed
    // so that downstream steps can access {{stepX.data.items}} directly
    let parsedData: any = null;
    if (typeof cleanedResponse === 'string') {
      try {
        const trimmed = cleanedResponse.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          parsedData = JSON.parse(trimmed);
          logger.debug({ stepId: step.id, parsedKeys: Object.keys(parsedData) }, 'Parsed JSON response for direct property access');
        }
      } catch (e) {
        // Not valid JSON, keep as string - this is fine for non-JSON responses
        logger.debug({ stepId: step.id }, 'Response is not JSON, keeping as string');
      }
    }

    // Build the output data object
    const outputData: any = {
      // If we parsed JSON successfully, spread its properties for direct access
      // e.g., {{stepX.data.items}} will now work
      ...(parsedData && typeof parsedData === 'object' ? parsedData : {}),

      // Additional metadata
      toolCalls: result.toolCalls,
    };

    // Add generic aliases only if they don't overwrite parsed data
    // This preserves parsed JSON properties like parsedData.result
    if (!outputData.hasOwnProperty('result')) outputData.result = cleanedResponse;
    if (!outputData.hasOwnProperty('response')) outputData.response = cleanedResponse;
    if (!outputData.hasOwnProperty('output')) outputData.output = cleanedResponse;
    if (!outputData.hasOwnProperty('summary')) outputData.summary = cleanedResponse;
    if (!outputData.hasOwnProperty('analysis')) outputData.analysis = cleanedResponse;
    if (!outputData.hasOwnProperty('decision')) outputData.decision = cleanedResponse;
    if (!outputData.hasOwnProperty('reasoning')) outputData.reasoning = cleanedResponse;
    if (!outputData.hasOwnProperty('classification')) outputData.classification = cleanedResponse;

    // ✅ FIX: Map parsed result to declared output keys
    // If step declares outputs like { content: "object" }, map the parsed result to that key
    // This enables {{stepX.data.content}} to work when the DSL declares content as output
    const declaredOutputs = (step as any).outputs;
    if (declaredOutputs && typeof declaredOutputs === 'object' && parsedData) {
      for (const outputKey of Object.keys(declaredOutputs)) {
        if (outputKey !== 'next_step' && !outputData.hasOwnProperty(outputKey)) {
          // If parsedData has a 'result' wrapper (common LLM pattern), unwrap it
          if (parsedData.result && typeof parsedData.result === 'object') {
            outputData[outputKey] = parsedData.result;
            logger.debug({ stepId: step.id, outputKey, mapped: 'from parsedData.result' },
              'Mapped parsed result to declared output key');
          } else {
            outputData[outputKey] = parsedData;
            logger.debug({ stepId: step.id, outputKey, mapped: 'from parsedData' },
              'Mapped parsed data to declared output key');
          }
        }
      }
    }

    return {
      data: outputData,
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

        // Extract last branch step's output for easy downstream access
        const lastBranchResult = branchResults[branchResults.length - 1];
        const lastBranchOutput = lastBranchResult?.data ?? null;

        logger.debug({
          stepId: step.id,
          branchName,
          lastBranchStepId: branchToExecute[branchToExecute.length - 1]?.id,
          lastBranchOutputKeys: lastBranchOutput ? Object.keys(lastBranchOutput) : []
        }, 'Conditional branch completed - exposing lastBranchOutput');

        return {
          result: conditionResult,
          condition: stepCondition,
          branch: branchName,
          branchResults,
          executedSteps: branchToExecute.length,
          lastBranchOutput,  // Direct access to last executed step's output data
        };
      } else {
        logger.debug({ stepId: step.id, branchName }, 'No steps to execute in branch');
        return {
          result: conditionResult,
          condition: stepCondition,
          branch: branchName,
          branchResults: [],
          executedSteps: 0,
          lastBranchOutput: null,
        };
      }
    }

    // Legacy Format: Only evaluate condition (orchestrator handles routing)
    logger.debug({ stepId: step.id }, 'Legacy conditional - returning evaluation only');
    return {
      result: conditionResult,
      condition: stepCondition,
      lastBranchOutput: null,
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
    const data = input !== undefined ? input : params.data;

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

    let result: any;

    switch (operation) {
      case 'set':
        // Simple assignment - just return the input data as-is
        result = data;
        break;

      case 'map':
        result = this.transformMap(data, config, context);
        break;

      case 'filter':
        result = this.transformFilter(data, config, context, step.outputs);
        break;

      case 'reduce':
        result = this.transformReduce(data, config);
        break;

      case 'sort':
        result = this.transformSort(data, config);
        break;

      case 'group':
        result = this.transformGroup(data, config);
        break;

      case 'aggregate':
        result = this.transformAggregate(data, config);
        break;

      case 'format':
        result = this.transformFormat(data, config, context);
        break;

      case 'deduplicate':
        result = this.transformDeduplicate(data, config);
        break;

      case 'flatten':
        result = this.transformFlatten(data, config);
        break;

      case 'join':
        result = this.transformJoin(data, config);
        break;

      case 'pivot':
        result = this.transformPivot(data, config);
        break;

      case 'split':
        result = this.transformSplit(data, config);
        break;

      case 'expand':
        result = this.transformExpand(data, config);
        break;

      default:
        throw new ExecutionError(
          `Unknown transform operation: ${operation}`,
          'UNKNOWN_TRANSFORM_OPERATION',
          step.id
        );
    }

    // Wrap result under the declared output key
    return this.wrapTransformResult(result, step);
  }

  /**
   * Wrap transform result under the declared output key
   * This ensures transform outputs match the declared schema structure
   */
  private wrapTransformResult(result: any, step: TransformStep): any {
    // Get declared output keys from the step
    const outputs = (step as any).outputs;
    if (!outputs || typeof outputs !== 'object') {
      return result;
    }

    // Get output keys (excluding metadata like 'next_step')
    const outputKeys = Object.keys(outputs).filter(k => k !== 'next_step');

    // If there's exactly one declared output key, wrap the result under it
    // This handles cases like outputs: { content: { type: "object" } }
    if (outputKeys.length === 1) {
      const outputKey = outputKeys[0];

      // If result is already an object with the output key, return as-is
      if (result && typeof result === 'object' && !Array.isArray(result) && outputKey in result) {
        return result;
      }

      // Wrap the result under the output key
      return { [outputKey]: result };
    }

    // Multiple output keys or no output keys - return as-is
    return result;
  }

  /**
   * Map transformation
   * Supports converting array of objects to 2D array for Google Sheets
   */
  private transformMap(data: any[], config: any, context: ExecutionContext): any[] | any[][] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Map operation requires array input', 'INVALID_INPUT_TYPE');
    }

    // Check if this is a Google Sheets format conversion (columns + add_headers)
    // Config may have columns at top level or nested under mapping (from buildMappingConfig)
    const columns = config?.columns || config?.mapping?.columns;
    const staticValues = config?.static_values || config?.mapping?.static_values || {};
    const addHeaders = config?.add_headers || config?.mapping?.add_headers;

    if (columns && Array.isArray(columns)) {
      const result: any[][] = [];

      // Add header row if requested
      if (addHeaders) {
        result.push(columns.map((col: string) =>
          col.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())
        ));
      }

      // Convert each object to array row based on column order
      // With field name normalization to handle variations like "received time" → "received_time"
      data.forEach(item => {
        const row = columns.map((col: string) => {
          // First check if there's a static value for this column
          if (col in staticValues) {
            return String(staticValues[col]);
          }

          // Try to find the value using field name normalization
          const value = this.findFieldValue(item, col);
          return value !== undefined && value !== null ? String(value) : '';
        });
        result.push(row);
      });

      return result;
    }

    // Check for template-based map (config.mapping.template -> renders to string per item)
    // Template can contain multiple placeholders like: <tr><td>{{item.sender}}</td><td>{{item.subject}}</td></tr>
    if (config && config.mapping && typeof config.mapping.template === 'string') {
      const template = config.mapping.template;
      return data.map(item => {
        // Create temporary context with current item
        const tempContext = context.clone();
        tempContext.setVariable('item', item);
        // Use expandTemplate to handle templates with multiple {{item.field}} placeholders
        return this.expandTemplate(template, { item }, tempContext);
      });
    }

    // Standard map operation with mapping configuration (key -> value pairs)
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
   * Find field value from an object using various name normalizations
   * Handles column name variations like "received time" → "received_time", "CTA text" → "cta_text"
   *
   * @param item - The object to extract value from
   * @param columnName - The column name (may be human-readable like "received time")
   * @returns The field value or undefined if not found
   */
  private findFieldValue(item: any, columnName: string): any {
    if (!item || typeof item !== 'object') {
      return undefined;
    }

    // Direct match first
    if (columnName in item) {
      return item[columnName];
    }

    // Generate normalized variations of the column name
    const variations = this.generateFieldNameVariations(columnName);

    // Try each variation
    for (const variation of variations) {
      if (variation in item) {
        return item[variation];
      }
    }

    // Case-insensitive match as last resort
    const lowerColumnName = columnName.toLowerCase();
    for (const key of Object.keys(item)) {
      if (key.toLowerCase() === lowerColumnName) {
        return item[key];
      }
    }

    return undefined;
  }

  /**
   * Generate field name variations for matching
   * Examples:
   *   "received time" → ["received_time", "receivedTime", "ReceivedTime", "received-time"]
   *   "CTA text" → ["cta_text", "ctaText", "CTA_text", "cta-text"]
   *   "due date (if mentioned)" → ["due_date", "dueDate", "due_date_if_mentioned"]
   */
  private generateFieldNameVariations(columnName: string): string[] {
    const variations: string[] = [];

    // Clean the column name - remove parenthetical suffixes, trim
    let cleaned = columnName.trim();
    const parenMatch = cleaned.match(/^([^(]+)\s*\(/);
    if (parenMatch) {
      cleaned = parenMatch[1].trim();
    }

    // Lowercase version
    const lower = cleaned.toLowerCase();

    // snake_case: replace spaces with underscores
    const snakeCase = lower.replace(/\s+/g, '_');
    variations.push(snakeCase);

    // camelCase: remove spaces and capitalize first letter of each word (except first)
    const words = cleaned.toLowerCase().split(/\s+/);
    const camelCase = words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    variations.push(camelCase);

    // PascalCase
    const pascalCase = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    variations.push(pascalCase);

    // kebab-case
    const kebabCase = lower.replace(/\s+/g, '-');
    variations.push(kebabCase);

    // Also try with full original cleaned (spaces as underscores, preserving case)
    const preservedCase = cleaned.replace(/\s+/g, '_');
    variations.push(preservedCase);

    // For columns like "link to the email" → "link_to_email" or "link_to_the_email"
    // Try removing common articles
    const withoutArticles = lower.replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (withoutArticles !== snakeCase) {
      variations.push(withoutArticles);
    }

    return [...new Set(variations)]; // Remove duplicates
  }

  /**
   * Filter transformation
   *
   * Returns a structured object with backward compatibility:
   * - New workflows: use {{stepX.data.items}} or {{stepX.data.filtered}}
   * - Legacy workflows: array-like object with [index] access
   */
  private transformFilter(data: any[], config: any, context: ExecutionContext, stepOutputs?: any): any {
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
    const filtered = data.filter(item => {
      // Create temporary context with current item
      const tempContext = context.clone();

      // ✅ FIX: Normalize item keys to handle LLM case variations
      // LLMs may output camelCase (actionRequired) when DSL expects snake_case (action_required)
      // Add both variations so filter conditions work regardless of LLM output casing
      const normalizedItem = this.normalizeItemKeys(item);
      tempContext.setVariable('item', normalizedItem);

      // DSL builder ensures condition.field has 'item.' prefix (e.g., 'item.is_client_sender')
      return this.conditionalEvaluator.evaluate(config.condition, tempContext);
    });

    // Extract declared output key from step.outputs (e.g., "action_rows" from outputs: { action_rows: {...} })
    // This allows downstream steps to reference {{stepX.data.action_rows}} instead of {{stepX.data.items}}
    let declaredOutputKey: string | undefined;
    if (stepOutputs && typeof stepOutputs === 'object') {
      declaredOutputKey = Object.keys(stepOutputs)
        .find(k => k !== 'next_step' && k !== 'is_last_step');
    }

    // Return in format compatible with FilterHandler (orchestration)
    // This ensures consistent output whether using deterministic or AI-based filtering
    // PLUS backward compatibility for array-like access
    const result: any = {
      items: filtered,
      filtered: filtered,  // For compatibility with FilterHandler output
      removed: originalCount - filtered.length,
      originalCount: originalCount,
      count: filtered.length,

      // ✅ BACKWARD COMPATIBILITY: Make object behave like array
      // Allow {{stepX.data.length}}, {{stepX.data[0]}}, etc.
      length: filtered.length,

      // Array method proxies for backward compatibility
      map: filtered.map.bind(filtered),
      filter: filtered.filter.bind(filtered),
      reduce: filtered.reduce.bind(filtered),
      forEach: filtered.forEach.bind(filtered),
      find: filtered.find.bind(filtered),
      some: filtered.some.bind(filtered),
      every: filtered.every.bind(filtered),
      slice: filtered.slice.bind(filtered),
    };

    // ✅ Add declared output key as alias pointing to the filtered array
    // This allows {{stepX.data.action_rows}} to work alongside {{stepX.data.items}}
    if (declaredOutputKey && declaredOutputKey !== 'items' && declaredOutputKey !== 'filtered') {
      result[declaredOutputKey] = filtered;
      logger.debug({ declaredOutputKey, filteredCount: filtered.length }, 'Added declared output key alias for filter result');
    }

    // Add numeric index accessors for backward compatibility
    filtered.forEach((item, index) => {
      result[index] = item;
    });

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
   * Format transformation - convert object to formatted string using template
   *
   * Input: Single object (e.g., { to_log_count: 5 }) or array of objects
   * Config: { mapping: { template: "Logged {{to_log_count}} items" } }
   * Output: Formatted string (e.g., "Logged 5 items")
   *
   * Template variables are resolved from the input data fields directly,
   * not from global context. This allows templates like {{to_log_count}}
   * to reference fields in the input object.
   */
  private transformFormat(data: any, config: any, context: ExecutionContext): string | object {
    const mapping = config?.mapping || config || {};
    const template = mapping.template;
    const jsonEscape = mapping.json_escape === true;

    if (!template || typeof template !== 'string') {
      throw new ExecutionError(
        'Format operation requires a template string in config.mapping.template',
        'MISSING_TEMPLATE'
      );
    }

    // If JSON escaping is enabled, wrap the expand function to escape values
    const expandFn = jsonEscape
      ? (tpl: string, d: Record<string, any>, ctx: ExecutionContext) =>
          this.expandTemplateWithJsonEscape(tpl, d, ctx)
      : (tpl: string, d: Record<string, any>, ctx: ExecutionContext) =>
          this.expandTemplate(tpl, d, ctx);

    let result: string;

    // If data is an array, format each item and join (or take first)
    if (Array.isArray(data)) {
      if (data.length === 0) {
        // No items - resolve template with empty/zero values
        result = expandFn(template, {}, context);
      } else if (data.length === 1) {
        // For single-item array, use that item
        // Wrap so both {{field}} and {{item}} work
        const item = data[0];
        const dataForTemplate = typeof item === 'object' && item !== null
          ? { ...item, item }
          : { item };
        result = expandFn(template, dataForTemplate, context);
      } else {
        // For multiple items, format each and join with newlines
        // Wrap items so {{item}} resolves for primitives, and {{field}} still works for objects
        result = data.map(item => {
          const dataForTemplate = typeof item === 'object' && item !== null
            ? { ...item, item }
            : { item };
          return expandFn(template, dataForTemplate, context);
        }).join('\n');
      }
    } else if (data && typeof data === 'object') {
      // Single object input
      result = expandFn(template, data, context);
    } else {
      // Primitive input - use as-is in template context
      // Support both {{value}} and {{data}} for accessing the input
      result = expandFn(template, { value: data, data: data }, context);
    }

    // When json_escape is enabled and template looks like JSON, parse the result
    // This ensures downstream steps receive an object, not a JSON string
    if (jsonEscape) {
      const trimmed = result.trim();
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          return JSON.parse(result);
        } catch (e) {
          // If parsing fails, log warning and return as string
          logger.warn({
            error: e instanceof Error ? e.message : String(e),
            resultPreview: result.substring(0, 100)
          }, 'JSON parse failed for json_escape template output, returning as string');
        }
      }
    }

    return result;
  }

  /**
   * Expand template with JSON escaping for interpolated values
   * Used when template produces JSON and embedded values might contain quotes/newlines
   */
  private expandTemplateWithJsonEscape(
    template: string,
    data: Record<string, any>,
    context: ExecutionContext
  ): string {
    // Detect Handlebars block helpers (same check as expandTemplate)
    // If template contains {{#...}}, {{/...}}, {{else}}, {{@...}}, or {{this}}, use Handlebars engine
    const hasHandlebarsBlocks = /\{\{[#/]|else\}\}|\{\{@|\{\{this\}\}/.test(template);

    if (hasHandlebarsBlocks) {
      return this.expandHandlebarsTemplateWithJsonEscape(template, data, context);
    }

    // Fast path: Simple variable substitution with JSON escaping
    const result = template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();

      // Resolve the value
      let value: any;

      // Check if it's a step reference
      // Note: resolveVariable expects the full {{...}} syntax
      if (trimmedKey.startsWith('step')) {
        try {
          value = context.resolveVariable(match);
        } catch {
          value = match; // Keep original if can't resolve
        }
      } else if (trimmedKey.startsWith('input.') || trimmedKey.startsWith('var.')) {
        try {
          value = context.resolveVariable(match);
        } catch {
          value = match;
        }
      } else {
        // Try to get from data
        value = this.getNestedValue(data, trimmedKey);
        if (value === undefined) {
          value = match;
        }
      }

      // JSON-escape the value if it's a string
      if (typeof value === 'string') {
        // Escape special JSON characters
        return value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
      } else if (value !== null && value !== undefined && typeof value === 'object') {
        // For objects/arrays, stringify and remove outer quotes if embedding in a string context
        return JSON.stringify(value);
      }

      return String(value ?? '');
    });

    return result;
  }

  /**
   * Get nested value from object by dot-separated path
   * E.g., getNestedValue({a: {b: 1}}, 'a.b') returns 1
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj || typeof obj !== 'object') return undefined;

    const parts = path.split('.');
    let value: any = obj;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = value[part];
      } else {
        return undefined;
      }
    }

    return value;
  }

  /**
   * Expand template variables using input data fields
   *
   * Template: "Logged {{to_log_count}} items"
   * Data: { to_log_count: 5 }
   * Result: "Logged 5 items"
   *
   * Resolution priority:
   * 1. Input data object fields (e.g., {{to_log_count}} from data.to_log_count)
   * 2. Nested paths in data (e.g., {{user.name}} from data.user.name)
   * 3. Context variables for step references (e.g., {{step1.data.field}})
   */
  private expandTemplate(template: string, data: Record<string, any>, context: ExecutionContext): string {
    // ✅ Detect Handlebars block helpers in template
    // If template contains {{#...}}, {{/...}}, {{else}}, {{@...}}, or {{this}}, use Handlebars engine
    const hasHandlebarsBlocks = /\{\{[#/]|else\}\}|\{\{@|\{\{this\}\}/.test(template);

    if (hasHandlebarsBlocks) {
      return this.expandHandlebarsTemplate(template, data, context);
    }

    // Fast path: Simple variable substitution without Handlebars block helpers
    return this.expandSimpleTemplate(template, data, context);
  }

  /**
   * Expand template using Handlebars engine (for templates with block helpers)
   *
   * Handles: {{#each}}, {{#if}}, {{#unless}}, {{/each}}, {{@index}}, {{this}}, etc.
   */
  private expandHandlebarsTemplate(template: string, data: Record<string, any>, context: ExecutionContext): string {
    try {
      // Create a mutable copy of data to add resolved step references
      const handlebarsContext = { ...data };

      // First, resolve paths inside block helpers ({{#each step7.data.open_items}}, {{#if step1.data.count}})
      // These are NOT matched by the simple variable regex below
      let preResolvedTemplate = template.replace(/\{\{#(each|if|unless|with)\s+(step[^}]+)\}\}/g, (match, helper, path) => {
        const trimmedPath = path.trim();
        if (trimmedPath.startsWith('step') || trimmedPath.startsWith('input.') || trimmedPath.startsWith('var.')) {
          try {
            const resolved = context.resolveVariable(`{{${trimmedPath}}}`);
            if (resolved !== undefined && resolved !== null) {
              const safeKey = `__resolved_${trimmedPath.replace(/\./g, '_')}`;
              handlebarsContext[safeKey] = resolved;
              return `{{#${helper} ${safeKey}}}`;
            }
          } catch {
            logger.warn({ variable: trimmedPath }, 'Could not pre-resolve block helper path');
          }
        }
        return match;
      });

      // Then resolve simple runtime variables ({{step1.data.field}}, {{input.x}}, {{var.y}})
      preResolvedTemplate = preResolvedTemplate.replace(/\{\{([^#/@}][^}]*)\}\}/g, (match, key) => {
        const trimmedKey = key.trim();

        // Skip Handlebars special syntax
        if (trimmedKey === 'else' || trimmedKey === 'this') {
          return match;
        }

        // Check if it's a runtime variable reference that needs resolution
        if (trimmedKey.startsWith('step') || trimmedKey.startsWith('input.') || trimmedKey.startsWith('var.')) {
          try {
            const resolved = context.resolveVariable(match);
            // If resolved value is an object/array, keep it for Handlebars to process
            if (typeof resolved === 'object' && resolved !== null) {
              const safeKey = `__resolved_${trimmedKey.replace(/\./g, '_')}`;
              handlebarsContext[safeKey] = resolved;
              return `{{${safeKey}}}`;
            }
            return resolved !== undefined && resolved !== null ? String(resolved) : '';
          } catch {
            logger.warn({ variable: match }, 'Could not pre-resolve variable for Handlebars template');
            return match;
          }
        }

        // Leave other variables for Handlebars to handle from data context
        return match;
      });

      // Compile and execute Handlebars template
      const compiledTemplate = Handlebars.compile(preResolvedTemplate, { noEscape: true });
      const result = compiledTemplate(handlebarsContext);

      logger.debug({ templateLength: template.length, resultLength: result.length }, 'Handlebars template rendered');
      return result;
    } catch (error: any) {
      logger.error({ err: error, template: template.substring(0, 200) }, 'Handlebars template compilation failed');
      // Fall back to simple template expansion on error
      return this.expandSimpleTemplate(template, data, context);
    }
  }

  /**
   * Expand Handlebars template with JSON escaping for string values
   * Used for JSON templates that contain Handlebars block helpers ({{#each}}, {{#if}}, etc.)
   *
   * String values are pre-escaped so the resulting output is valid JSON.
   */
  private expandHandlebarsTemplateWithJsonEscape(
    template: string,
    data: Record<string, any>,
    context: ExecutionContext
  ): string {
    try {
      // Helper to JSON-escape a string value (escape quotes, backslashes, newlines, etc.)
      const jsonEscapeString = (val: string): string => {
        return val
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
          .replace(/\t/g, '\\t');
      };

      // Recursively JSON-escape all string values in an object/array
      const jsonEscapeData = (obj: any): any => {
        if (typeof obj === 'string') {
          return jsonEscapeString(obj);
        }
        if (Array.isArray(obj)) {
          return obj.map(item => jsonEscapeData(item));
        }
        if (obj && typeof obj === 'object') {
          const escaped: Record<string, any> = {};
          for (const key of Object.keys(obj)) {
            escaped[key] = jsonEscapeData(obj[key]);
          }
          return escaped;
        }
        return obj;
      };

      // Pre-escape all string values in data and create Handlebars context
      const handlebarsContext = jsonEscapeData(data);

      // First, resolve paths inside block helpers ({{#each step7.data.open_items}}, {{#if step1.data.count}})
      // These are NOT matched by the simple variable regex below
      let preResolvedTemplate = template.replace(/\{\{#(each|if|unless|with)\s+(step[^}]+)\}\}/g, (match, helper, path) => {
        const trimmedPath = path.trim();
        if (trimmedPath.startsWith('step') || trimmedPath.startsWith('input.') || trimmedPath.startsWith('var.')) {
          try {
            const resolved = context.resolveVariable(`{{${trimmedPath}}}`);
            if (resolved !== undefined && resolved !== null) {
              const safeKey = `__resolved_${trimmedPath.replace(/\./g, '_')}`;
              // JSON-escape the resolved data for block iteration
              handlebarsContext[safeKey] = jsonEscapeData(resolved);
              return `{{#${helper} ${safeKey}}}`;
            }
          } catch {
            logger.warn({ variable: trimmedPath }, 'Could not pre-resolve block helper path for JSON template');
          }
        }
        return match;
      });

      // Then resolve simple runtime variables ({{step1.data.field}}, {{input.x}}, {{var.y}})
      // and JSON-escape resolved values
      preResolvedTemplate = preResolvedTemplate.replace(/\{\{([^#/@}][^}]*)\}\}/g, (match, key) => {
        const trimmedKey = key.trim();

        if (trimmedKey === 'else' || trimmedKey === 'this') {
          return match;
        }

        // Check if it's a runtime variable reference that needs resolution
        if (trimmedKey.startsWith('step') || trimmedKey.startsWith('input.') || trimmedKey.startsWith('var.')) {
          try {
            const resolved = context.resolveVariable(match);
            if (typeof resolved === 'object' && resolved !== null) {
              // Store escaped version in data for Handlebars
              const safeKey = `__resolved_${trimmedKey.replace(/\./g, '_')}`;
              handlebarsContext[safeKey] = jsonEscapeData(resolved);
              return `{{${safeKey}}}`;
            }
            // JSON-escape the resolved string value
            return resolved !== undefined && resolved !== null
              ? jsonEscapeString(String(resolved))
              : '';
          } catch {
            logger.warn({ variable: match }, 'Could not pre-resolve variable for JSON Handlebars template');
            return match;
          }
        }

        return match;
      });

      // Compile and execute Handlebars template with noEscape (data is pre-escaped)
      const compiledTemplate = Handlebars.compile(preResolvedTemplate, { noEscape: true });
      const result = compiledTemplate(handlebarsContext);

      logger.debug({ templateLength: template.length, resultLength: result.length }, 'JSON Handlebars template rendered');
      return result;
    } catch (error: any) {
      logger.error({ err: error, template: template.substring(0, 200) }, 'JSON Handlebars template compilation failed');
      // Fall back to simple template expansion with JSON escaping on error
      return this.expandTemplateWithJsonEscape(template, data, context);
    }
  }

  /**
   * Expand template using simple regex substitution (fast path for non-Handlebars templates)
   *
   * Handles: {{field}}, {{nested.field}}, {{step1.data.field}}, {{input.x}}, {{var.y}}
   */
  private expandSimpleTemplate(template: string, data: Record<string, any>, context: ExecutionContext): string {
    // Detect if template is JSON-like (for proper escaping of inserted values)
    const isJsonTemplate = template.trim().startsWith('{') && template.trim().endsWith('}');

    // Helper to escape value for JSON string context
    const escapeForJson = (val: string): string => {
      // JSON.stringify adds quotes, so we slice them off and get the escaped content
      return JSON.stringify(val).slice(1, -1);
    };

    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();

      // First, try to resolve from the input data object directly
      if (data && trimmedKey in data) {
        const value = data[trimmedKey];
        const strValue = value !== undefined && value !== null ? String(value) : '';
        return isJsonTemplate ? escapeForJson(strValue) : strValue;
      }

      // Check for nested paths like "user.name" in the data object
      if (trimmedKey.includes('.') && !trimmedKey.startsWith('step') && !trimmedKey.startsWith('input.') && !trimmedKey.startsWith('var.')) {
        const parts = trimmedKey.split('.');
        let value: any = data;
        for (const part of parts) {
          if (value && typeof value === 'object' && part in value) {
            value = value[part];
          } else {
            value = undefined;
            break;
          }
        }
        if (value !== undefined) {
          const strValue = value !== null ? String(value) : '';
          return isJsonTemplate ? escapeForJson(strValue) : strValue;
        }
      }

      // Fall back to context resolution for step references like {{step1.data.field}}
      if (trimmedKey.startsWith('step') || trimmedKey.startsWith('input.') || trimmedKey.startsWith('var.')) {
        try {
          const resolved = context.resolveVariable(match);
          const strValue = resolved !== undefined && resolved !== null ? String(resolved) : '';
          return isJsonTemplate ? escapeForJson(strValue) : strValue;
        } catch {
          logger.warn({ template: match, key: trimmedKey }, 'Template variable not found in context');
          return '';
        }
      }

      // Unknown variable - log warning and return empty string
      logger.warn({ template: match, key: trimmedKey, availableKeys: Object.keys(data || {}) }, 'Template variable not found in data');
      return '';
    });
  }

  /**
   * Helper: Unwrap structured output from previous steps
   * Many transform operations return {items: [...], count: N, ...} format
   * This helper extracts the actual data array for chaining
   */
  private unwrapStructuredOutput(data: any): any {
    // If it's already an array, return as-is
    if (Array.isArray(data)) {
      return data;
    }

    // If it's an object with 'items', 'filtered', 'deduplicated', or 'groups' property
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) {
        return data.items;
      }
      if (Array.isArray(data.filtered)) {
        return data.filtered;
      }
      if (Array.isArray(data.deduplicated)) {
        return data.deduplicated;
      }
      if (Array.isArray(data.groups)) {
        return data.groups;
      }
      // For action step outputs, check common array field names
      if (Array.isArray(data.values)) {  // Google Sheets
        return data.values;
      }
      if (Array.isArray(data.records)) {  // Airtable
        return data.records;
      }
      if (Array.isArray(data.emails)) {  // Gmail
        return data.emails;
      }
      if (Array.isArray(data.files)) {  // Google Drive
        return data.files;
      }
      if (Array.isArray(data.rows)) {  // Database-like outputs
        return data.rows;
      }
    }

    // If we can't unwrap, return the data as-is (might be a single object)
    return data;
  }

  /**
   * Normalize item keys to handle LLM case variations
   * LLMs may output camelCase (actionRequired) when DSL expects snake_case (action_required)
   * This adds both variations so filter conditions work regardless of LLM output casing
   */
  private normalizeItemKeys(item: any): any {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item;
    }

    const normalized: any = { ...item };

    for (const key of Object.keys(item)) {
      const value = item[key];

      // Convert camelCase to snake_case and add if not present
      // actionRequired -> action_required
      const snakeCase = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (snakeCase !== key && !normalized.hasOwnProperty(snakeCase)) {
        normalized[snakeCase] = value;
      }

      // Convert snake_case to camelCase and add if not present
      // action_required -> actionRequired
      const camelCase = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      if (camelCase !== key && !normalized.hasOwnProperty(camelCase)) {
        normalized[camelCase] = value;
      }
    }

    return normalized;
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
      // Direct property access
      if (key in item) {
        return item[key];
      }

      // Nested property access (e.g., "fields.Name" for Airtable)
      const keyParts = String(key).split('.');
      let value = item;
      for (const part of keyParts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
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
   * Phase 5 Enhancement:
   * - sort_field: Optional field to sort by before deduplication (determines which duplicate to keep)
   * - keep: 'first' (default) or 'last' - which duplicate to keep after sorting
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

    const { field, key, column, sort_field, keep = 'first' } = config || {};
    const deduplicateKey = column || field || key; // Support 'column', 'field', and 'key'
    const originalCount = unwrappedData.length;

    // Phase 5: Pre-sort data if sort_field is specified
    // This ensures deterministic deduplication (e.g., keep most recent by date)
    let sortedData = [...unwrappedData];
    if (sort_field) {
      sortedData.sort((a, b) => {
        const aVal = this.extractValueByKey(a, sort_field, unwrappedData);
        const bVal = this.extractValueByKey(b, sort_field, unwrappedData);
        // Default ascending sort (for 'first' to get earliest, 'last' to get latest)
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
      });
      // If keep === 'last', reverse to process from end
      if (keep === 'last') {
        sortedData.reverse();
      }
      logger.debug({ sort_field, keep }, 'Pre-sorted data for deduplicate');
    }

    let deduplicated: any[];

    if (deduplicateKey) {
      // Deduplicate based on extracted value using generic helper
      const seen = new Set();

      // Detect if 2D array pattern (array of arrays)
      const is2DArray = Array.isArray(sortedData[0]);

      if (is2DArray) {
        // For 2D arrays, preserve header row and deduplicate data rows
        const headerRow = sortedData[0];
        const dataRows = sortedData.slice(1);

        const uniqueRows = dataRows.filter((row: any) => {
          const value = this.extractValueByKey(row, deduplicateKey, sortedData);
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });

        deduplicated = [headerRow, ...uniqueRows];
        logger.debug({ deduplicateKey, removedCount: dataRows.length - uniqueRows.length, pattern: '2D array', sort_field, keep }, 'Deduplicated rows');
      } else {
        // For objects or other patterns, deduplicate all items
        deduplicated = sortedData.filter(item => {
          const value = this.extractValueByKey(item, deduplicateKey, sortedData);
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });
        logger.debug({ deduplicateKey, removedCount: sortedData.length - deduplicated.length, pattern: 'object/item', sort_field, keep }, 'Deduplicated items');
      }
    } else {
      // Deduplicate based on entire object (using JSON stringification)
      const seen = new Set();
      deduplicated = sortedData.filter(item => {
        const serialized = JSON.stringify(item);
        if (seen.has(serialized)) {
          return false;
        }
        seen.add(serialized);
        return true;
      });
      logger.debug({ removedCount: sortedData.length - deduplicated.length, pattern: 'entire value', sort_field, keep }, 'Deduplicated items');
    }

    // Return in structured format compatible with filter and other transforms
    const result: any = {
      items: deduplicated,
      deduplicated: deduplicated,  // Alias for clarity
      removed: originalCount - deduplicated.length,
      originalCount: originalCount,
      count: deduplicated.length,
      length: deduplicated.length,

      // Array method proxies for backward compatibility
      map: deduplicated.map.bind(deduplicated),
      filter: deduplicated.filter.bind(deduplicated),
      reduce: deduplicated.reduce.bind(deduplicated),
      forEach: deduplicated.forEach.bind(deduplicated),
      find: deduplicated.find.bind(deduplicated),
      some: deduplicated.some.bind(deduplicated),
      every: deduplicated.every.bind(deduplicated),
      slice: deduplicated.slice.bind(deduplicated),
    };

    // Add numeric index accessors for array-like access
    deduplicated.forEach((item, index) => {
      result[index] = item;
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

    const flattened = flattenArray(unwrappedData, depth);

    logger.debug({ originalCount: unwrappedData.length, flattenedCount: flattened.length, depth }, 'Flattened array');

    return {
      items: flattened,
      count: flattened.length,
      originalCount: unwrappedData.length
    };
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
   * Split transformation - Split array by field grouping or size-based chunking
   *
   * Field-based grouping (preferred):
   *   Config: {field: string} - Groups items by field value into named buckets
   *   Example: field: "classification" → { action_required: [...], fyi: [...] }
   *
   * Size-based chunking (legacy):
   *   Config: {size: number} or {count: number}
   */
  private transformSplit(data: any, config: any): any {
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError('Split operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { size, count, field } = config || {};

    // Field-based grouping: group items by field value into named buckets
    if (field) {
      const buckets: Record<string, any[]> = {};

      for (const item of unwrappedData) {
        // Get the field value, handling nested paths like "metadata.category"
        let fieldValue = item;
        const fieldParts = field.split('.');
        for (const part of fieldParts) {
          fieldValue = fieldValue?.[part];
        }

        // Convert field value to a bucket key
        // Handle various types: string, boolean, number
        let bucketKey: string;
        if (fieldValue === null || fieldValue === undefined) {
          bucketKey = 'unknown';
        } else if (typeof fieldValue === 'string') {
          // Normalize the key: lowercase, replace spaces with underscores
          bucketKey = fieldValue.toLowerCase().replace(/\s+/g, '_');
        } else {
          bucketKey = String(fieldValue);
        }

        // Add item to bucket, creating bucket if needed
        if (!buckets[bucketKey]) {
          buckets[bucketKey] = [];
        }
        buckets[bucketKey].push(item);
      }

      const bucketNames = Object.keys(buckets);
      logger.debug({
        originalCount: unwrappedData.length,
        bucketCount: bucketNames.length,
        buckets: bucketNames.map(k => `${k}:${buckets[k].length}`)
      }, 'Split array by field');

      // Return buckets with metadata
      return {
        ...buckets,
        _meta: {
          buckets: bucketNames,
          counts: Object.fromEntries(bucketNames.map(k => [k, buckets[k].length])),
          total: unwrappedData.length
        }
      };
    }

    // Size-based chunking (legacy behavior)
    if (!size && !count) {
      throw new ExecutionError('Split requires either field (for grouping) or size/count (for chunking) config', 'MISSING_CONFIG');
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

    logger.debug({ originalCount: unwrappedData.length, chunkCount: chunks.length, chunkSize }, 'Split array by size');

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
}
