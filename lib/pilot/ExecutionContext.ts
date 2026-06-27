/**
 * ExecutionContext - Manages in-memory state during workflow execution
 *
 * Responsibilities:
 * - Store step outputs
 * - Resolve variable references (e.g., {{step1.data.email}})
 * - Track execution progress
 * - Provide context to ConditionalEvaluator
 *
 * @module lib/orchestrator/ExecutionContext
 */

import type {
  Agent,
  ExecutionStatus,
  StepOutput,
  ExecutionSummary,
  MemoryContext,
  VariableReference,
  IOrchestrator,
  IExecutionContext,
  CollectedIssue,
  ExecutionScope,
} from './types';
import type { WorkflowDataSchema, SchemaField } from '@/lib/agentkit/v6/logical-ir/schemas/workflow-data-schema';
import { VariableResolutionError, getTokenTotal, makeEmptyExecutionScope } from './types';
import { createLogger } from '@/lib/logger';

// Create module-level logger for structured logging
const logger = createLogger({ module: 'ExecutionContext', service: 'workflow-pilot' });

export class ExecutionContext implements IExecutionContext {
  // Execution metadata
  public executionId: string;
  public agentId: string;
  public userId: string;
  public sessionId: string;

  // Agent configuration
  public agent: Agent;
  public inputValues: Record<string, any>;

  // Execution state
  public status: ExecutionStatus;
  public currentStep: string | null = null;
  public completedSteps: string[] = [];
  public failedSteps: string[] = [];
  public skippedSteps: string[] = [];

  // Step outputs (in-memory during execution)
  public stepOutputs: Map<string, StepOutput>;

  // Runtime variables
  public variables: Record<string, any>;

  // Memory context (from MemoryInjector)
  public memoryContext?: MemoryContext;

  // Orchestration (from WorkflowOrchestrator - Phase 4)
  // Wave 8: Changed from `any` to `IOrchestrator` for type safety
  public orchestrator?: IOrchestrator;

  // Timing
  public startedAt: Date;
  public completedAt?: Date;

  // Token tracking
  public totalTokensUsed: number = 0;
  public totalExecutionTime: number = 0;

  // Batch calibration mode
  public batchCalibrationMode: boolean = false;
  public collectedIssues: CollectedIssue[] = [];

  // Execution mode (Phase 6 — Tier 2 Fix #4).
  // Drives runMode-aware behaviors throughout the runtime — currently:
  //   • Scatter-gather: 'production' re-throws on first item failure;
  //     'calibration' / 'batch_calibration' keep today's swallow-and-tag behavior.
  // Stored here so any nested executor (ParallelExecutor, StepExecutor) can
  // read it without threading it through every method signature.
  // See workplan: docs/workplans/runmode-into-scatter-failure-handling.md
  public runMode: 'production' | 'calibration' | 'batch_calibration' = 'production';

  // Calibration round (Phase 4 — calibration outbound-message marking).
  // Monotonic per workflow execution, set by the calibration orchestrator
  // (each Layer-3 dry-run / batch-loop iteration / post-fix re-run gets its own
  // number). Read by StepExecutor to tag outbound actions (e.g. emails) sent
  // during calibration so the recipient can tell it was a test run and which
  // round produced it. Undefined outside calibration.
  // See workplan: docs/workplans/v2-post-creation-calibration-prompt-workplan.md (Phase 4)
  public calibrationRound?: number;

  // Calibration recipient redirect (Phase 4). During calibration, outbound
  // messages are redirected to the agent owner so a test run never reaches a
  // real third party. Set by the calibration orchestrator (the owner's email),
  // read by StepExecutor → injected into the `_calibration` marker → messaging
  // executors swap recipients. Undefined outside calibration.
  public calibrationOwnerEmail?: string;

  // Workflow data schema for runtime validation (Phase 5)
  private dataSchema: WorkflowDataSchema | null = null;

  // Strict variable resolution mode (Phase 6 — Tier 1 Fix #2)
  // When true, the forgiving resolution paths are disabled:
  //   • Auto-`.data` navigation on step outputs is off
  //   • Fuzzy snake↔camel key matching is off
  //   • Missing keys throw VariableResolutionError instead of returning undefined
  //   • Inline `{{...}}` substitution errors throw instead of being swallowed
  // See workplan: docs/workplans/strict-variable-resolution.md
  private strict: boolean = false;

  // Loop inner-step output overwrite disabled (Phase 6 — Tier 2 Fix #1).
  // When true, ParallelExecutor.executeLoopIteration does NOT pollute
  // parentContext.stepOutputs with the inner step's id (which would
  // silently resolve to only the last iteration's output). The namespaced
  // `${innerStepId}_iteration${i}` outputs are still written. Use
  // `{{loopId.data}}` for the aggregated array or
  // `{{innerStepId_iteration<N>.data}}` for a specific iteration.
  // See workplan: docs/workplans/loop-inner-step-output-namespacing.md
  private loopInnerOverwriteDisabled: boolean = false;

  // Conditional type coercion for ordering operators (Phase 6 — Tier 2 Fix #2).
  // When true, ConditionalEvaluator coerces numeric-looking strings to numbers
  // and date-like strings to Date timestamps before applying `>`, `>=`, `<`, `<=`.
  // Fixes the silent bug where `"100" > 90` evaluates as `false` via lexical
  // string comparison. Equality operators (`==`, `!=`) and other operators are
  // unaffected. See workplan: docs/workplans/conditional-type-coercion.md
  private conditionalCoercionEnabled: boolean = false;

  // Scatter-gather explicit shape required (Phase 6 — Tier 2 Fix #3).
  // When true, ParallelExecutor.executeScatterItem throws if a scatter step
  // does not declare `gather.shape`. When false (default), missing `shape`
  // falls back to today's isStepExtractLike heuristic. Either way, when a
  // `gather.shape` IS declared, it is honored deterministically and the
  // heuristic is skipped. See workplan:
  // docs/workplans/explicit-scatter-gather-output-shape.md
  private scatterExplicitShapeRequired: boolean = false;

  // Per-execution resource bundle (Phase 6 — Tier 1 Fix #3).
  // Holds stepEmitter, debugRunId, shadowAgent, checkpointManager, resumeOrchestrator,
  // executionProtection, executionSummaryCollector. Previously stuffed onto
  // WorkflowPilot via `(this as any).X`. Now request-scoped — concurrent
  // executions cannot corrupt each other's resources.
  // See workplan: docs/workplans/move-per-execution-state-off-pilot-instance.md
  public scope: ExecutionScope;

  constructor(
    executionId: string,
    agent: Agent,
    userId: string,
    sessionId: string,
    inputValues: Record<string, any> = {},
    batchCalibrationMode: boolean = false,
    strict: boolean = false,
    loopInnerOverwriteDisabled: boolean = false,
    conditionalCoercionEnabled: boolean = false,
    scatterExplicitShapeRequired: boolean = false,
    runMode: 'production' | 'calibration' | 'batch_calibration' = 'production'
  ) {
    this.executionId = executionId;
    this.agent = agent;
    this.agentId = agent.id;
    this.userId = userId;
    this.sessionId = sessionId;
    this.inputValues = inputValues;
    this.stepOutputs = new Map();
    this.variables = {};
    this.status = 'running';
    this.startedAt = new Date();
    this.batchCalibrationMode = batchCalibrationMode;
    this.collectedIssues = [];
    this.strict = strict;
    this.loopInnerOverwriteDisabled = loopInnerOverwriteDisabled;
    this.conditionalCoercionEnabled = conditionalCoercionEnabled;
    this.scatterExplicitShapeRequired = scatterExplicitShapeRequired;
    this.runMode = runMode;
    this.scope = makeEmptyExecutionScope();

    logger.info({
      executionId,
      agentId: agent.id,
      userId,
      sessionId,
      inputKeys: Object.keys(inputValues),
      batchCalibrationMode,
      strict,
      loopInnerOverwriteDisabled,
      conditionalCoercionEnabled,
      scatterExplicitShapeRequired,
      runMode
    }, 'ExecutionContext created');
  }

  /**
   * Whether strict variable resolution is enabled on this context.
   * Exposed primarily for tests and child contexts (clone preserves it).
   */
  isStrict(): boolean {
    return this.strict;
  }

  /**
   * Whether the loop-inner-step overwrite is disabled on this context
   * (Phase 6 — Tier 2 Fix #1). When true, ParallelExecutor will skip writing
   * an inner step's output to the parent stepOutputs under its bare id and
   * only write the per-iteration namespaced key.
   */
  isLoopInnerOverwriteDisabled(): boolean {
    return this.loopInnerOverwriteDisabled;
  }

  /**
   * Whether conditional ordering comparisons should coerce numeric/date-like
   * strings before applying `>`, `>=`, `<`, `<=` (Phase 6 — Tier 2 Fix #2).
   */
  isConditionalCoercionEnabled(): boolean {
    return this.conditionalCoercionEnabled;
  }

  /**
   * Whether scatter-gather steps must declare an explicit `gather.shape`
   * (Phase 6 — Tier 2 Fix #3). When true, ParallelExecutor throws on
   * scatter steps that don't declare a shape; when false, missing `shape`
   * falls back to the legacy heuristic.
   */
  isScatterExplicitShapeRequired(): boolean {
    return this.scatterExplicitShapeRequired;
  }

  /**
   * Mark a step as completed (or failed) in the tracking arrays WITHOUT
   * writing an output into `stepOutputs`. Used by ParallelExecutor when the
   * loop-inner-overwrite flag is disabled — UI status tracking needs the
   * step id in `completedSteps`/`failedSteps`, but we deliberately omit it
   * from `stepOutputs` to prevent `{{innerStepId.data}}` from silently
   * resolving to only the last iteration.
   *
   * Idempotent: re-marking the same id is a no-op if it's already tracked
   * with the requested status.
   */
  markStepCompletion(stepId: string, success: boolean): void {
    if (success) {
      if (!this.completedSteps.includes(stepId)) {
        this.completedSteps.push(stepId);
      }
      // If a prior failure-mark exists, drop it (latest call wins)
      const failedIdx = this.failedSteps.indexOf(stepId);
      if (failedIdx > -1) {
        this.failedSteps.splice(failedIdx, 1);
      }
    } else {
      if (!this.failedSteps.includes(stepId)) {
        this.failedSteps.push(stepId);
      }
      const completedIdx = this.completedSteps.indexOf(stepId);
      if (completedIdx > -1) {
        this.completedSteps.splice(completedIdx, 1);
      }
    }
  }

  /**
   * Store step output
   *
   * ✅ P0 FIX: Token de-duplication for retries
   * When a step is retried, we REPLACE the previous token count instead of adding
   * This prevents over-charging users for failed attempts
   */
  setStepOutput(stepId: string, output: StepOutput): void {
    logger.debug({
      stepId,
      plugin: output.plugin,
      action: output.action,
      success: output.metadata.success,
      executionId: this.executionId
    }, 'Storing step output');

    // ✅ P0 FIX: Check if this is a retry (step already executed)
    const previousOutput = this.stepOutputs.get(stepId);
    const isRetry = previousOutput !== undefined;

    if (isRetry) {
      // ✅ P1: Use standardized getTokenTotal utility for consistent handling
      const previousTokenTotal = getTokenTotal(previousOutput.metadata.tokensUsed);
      this.totalTokensUsed -= previousTokenTotal;
      logger.info({
        stepId,
        previousTokens: previousTokenTotal,
        executionId: this.executionId
      }, 'Retry detected - de-duplicating tokens');

      // SUBTRACT previous execution time
      this.totalExecutionTime -= previousOutput.metadata.executionTime;
    }

    // Store the new output (overwrites previous if retry)
    this.stepOutputs.set(stepId, output);

    // Update tracking arrays
    if (output.metadata.success) {
      if (!this.completedSteps.includes(stepId)) {
        this.completedSteps.push(stepId);
      }
      // Remove from failed steps if this was a successful retry
      const failedIndex = this.failedSteps.indexOf(stepId);
      if (failedIndex > -1) {
        this.failedSteps.splice(failedIndex, 1);
      }
    } else {
      if (!this.failedSteps.includes(stepId)) {
        this.failedSteps.push(stepId);
      }
      // Remove from completed steps if this retry failed
      const completedIndex = this.completedSteps.indexOf(stepId);
      if (completedIndex > -1) {
        this.completedSteps.splice(completedIndex, 1);
      }
    }

    // ✅ P1: Use standardized getTokenTotal utility for consistent handling
    const newTokenTotal = getTokenTotal(output.metadata.tokensUsed);
    this.totalTokensUsed += newTokenTotal;

    if (isRetry) {
      logger.debug({
        stepId,
        newTokens: newTokenTotal,
        totalTokens: this.totalTokensUsed,
        executionId: this.executionId
      }, 'Tokens updated after retry de-duplication');
    }

    // Add NEW execution time
    this.totalExecutionTime += output.metadata.executionTime;
  }

  /**
   * Get step output
   */
  getStepOutput(stepId: string): StepOutput | undefined {
    return this.stepOutputs.get(stepId);
  }

  /**
   * Get all step outputs
   */
  getAllStepOutputs(): Map<string, StepOutput> {
    return this.stepOutputs;
  }

  /**
   * Check if step has been executed
   */
  hasStepExecuted(stepId: string): boolean {
    return this.stepOutputs.has(stepId);
  }

  /**
   * Mark step as skipped
   */
  markStepSkipped(stepId: string): void {
    if (!this.skippedSteps.includes(stepId)) {
      this.skippedSteps.push(stepId);
      logger.info({ stepId, executionId: this.executionId }, 'Step marked as skipped');
    }
  }

  /**
   * Set runtime variable
   */
  setVariable(name: string, value: any): void {
    this.variables[name] = value;
    logger.debug({
      variableName: name,
      valueType: Array.isArray(value) ? 'array' : typeof value,
      valueLength: Array.isArray(value) ? value.length : undefined,
      executionId: this.executionId
    }, 'Variable set');
  }

  /**
   * Get runtime variable
   */
  getVariable(name: string): any {
    return this.variables[name];
  }

  /**
   * WP-29: user timezone hint for locale-sensitive operations (e.g.,
   * disambiguating DD/MM/YYYY vs MM/DD/YYYY in `parseDate`).
   *
   * Sources, in priority order:
   *   1. `variables._user_timezone`  (runtime override — wired by WorkflowPilot
   *      from the user-context system or workflow_config)
   *   2. `inputValues._user_timezone` (workflow_config-injected, set by the
   *      caller before execution starts)
   *   3. `inputValues.user_timezone` (alternative naming for backward compat)
   *
   * Returns undefined when no signal is available. `parseDate` then falls
   * back to DD/MM/YYYY (covers ~85% of world population).
   */
  getUserTimezone(): string | undefined {
    const fromVars = this.variables?._user_timezone;
    if (typeof fromVars === 'string' && fromVars.length > 0) return fromVars;
    const fromInputs = this.inputValues?._user_timezone ?? this.inputValues?.user_timezone;
    if (typeof fromInputs === 'string' && fromInputs.length > 0) return fromInputs;
    return undefined;
  }

  /**
   * Resolve variable reference like {{step1.data.email}}
   *
   * Supports:
   * - {{step1.data.email}} - Step output field
   * - {{step1.data[0].email}} - Array access
   * - {{input.recipient}} - User input value
   * - {{var.counter}} - Runtime variable
   * - {{current.item}} - Loop current item
   * - ["{{email.id}}"] - Literal expressions with embedded variables
   */
  resolveVariable(reference: VariableReference): any {
    // If it's not a string, return as-is (already resolved)
    if (typeof reference !== 'string') {
      return reference;
    }

    // Check if it's a variable reference
    if (!reference.includes('{{')) {
      return reference;
    }

    // ✅ FIX #11: Handle literal expressions with embedded variables
    // Example: "[\"{{email.gmail_message_link_id}}\"]" → ["actual_id_value"]
    // This handles cases where LLM outputs JSON literals containing template variables
    if (!reference.match(/^\{\{[^}]+\}\}$/)) {
      // This is not a simple {{var}} reference, but contains {{var}} inside a literal
      return this.resolveLiteralWithVariables(reference);
    }

    // Extract variable path from {{...}}
    const match = reference.match(/\{\{([^}]+)\}\}/);
    if (!match) {
      return reference;
    }

    const path = match[1].trim();
    logger.debug({ reference, path, executionId: this.executionId }, 'Resolving variable');

    // Use the refactored resolveSimpleVariable method
    const resolved = this.resolveSimpleVariable(path);

    logger.debug({
      reference,
      resolvedType: Array.isArray(resolved) ? 'array' : typeof resolved,
      resolvedLength: Array.isArray(resolved) ? resolved.length : undefined,
      executionId: this.executionId
    }, 'Variable resolved');

    return resolved;
  }

  /**
   * Resolve all variables in an object (recursive)
   */
  resolveAllVariables(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // Check if entire string is a variable reference
      if (obj.match(/^\{\{.*\}\}$/)) {
        return this.resolveVariable(obj);
      }

      // Replace inline variables: "Email from {{step1.data.sender}}"
      return obj.replace(/\{\{([^}]+)\}\}/g, (match) => {
        try {
          const value = this.resolveVariable(match);
          // ✅ CRITICAL FIX: Use JSON.stringify for arrays and objects
          // String([]) returns "" (empty string) which breaks expressions
          // JSON.stringify([]) returns "[]" which is correct JavaScript
          if (Array.isArray(value)) {
            return JSON.stringify(value);
          } else if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
          }
          return String(value);
        } catch (error) {
          // STRICT MODE (Phase 6 — Tier 1 Fix #2): re-throw instead of silently
          // leaving the unresolved `{{...}}` token in the output string.
          if (this.strict) {
            throw error;
          }
          logger.warn({ err: error, variable: match, executionId: this.executionId }, 'Failed to resolve variable');
          return match;
        }
      });
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveAllVariables(item));
    }

    if (typeof obj === 'object') {
      const resolved: any = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveAllVariables(value);
      }
      return resolved;
    }

    return obj;
  }

  /**
   * Resolve literal expressions containing embedded variables
   *
   * Handles cases where LLM outputs JSON literals with template variables:
   * - "[\"{{email.id}}\"]" → ["resolved_id_value"]
   * - "{\"key\": \"{{step1.value}}\"}" → {key: "resolved_value"}
   *
   * This is needed because the LLM doesn't distinguish between:
   * - JSON structure (what it's outputting)
   * - Variable resolution syntax (what gets evaluated at runtime)
   */
  private resolveLiteralWithVariables(expression: string): any {
    logger.debug({ expression, executionId: this.executionId }, 'Resolving literal with embedded variables');

    // Replace all {{var}} references with their actual values
    let resolvedExpression = expression;
    const variableMatches = expression.matchAll(/\{\{([^}]+)\}\}/g);

    for (const match of variableMatches) {
      const fullMatch = match[0]; // "{{email.id}}"
      const varPath = match[1].trim(); // "email.id"

      try {
        // Resolve the variable using existing logic
        const resolvedValue = this.resolveSimpleVariable(varPath);

        // Check if the variable is inside quotes: "{{var}}" or '{{var}}'
        // This handles patterns like: ["{{email.id}}"] where the quotes are part of JSON structure
        const quotedPattern1 = `"${fullMatch}"`;  // "{{var}}"
        const quotedPattern2 = `'${fullMatch}'`;  // '{{var}}'
        const escapedQuotedPattern1 = `\\"${fullMatch}\\"`; // \"{{var}}\"
        const escapedQuotedPattern2 = `\\'${fullMatch}\\'`; // \'{{var}}\'

        if (resolvedExpression.includes(quotedPattern1)) {
          // Replace "{{var}}" with JSON value (which adds its own quotes if string)
          resolvedExpression = resolvedExpression.replace(quotedPattern1, JSON.stringify(resolvedValue));
        } else if (resolvedExpression.includes(quotedPattern2)) {
          // Replace '{{var}}' with JSON value
          resolvedExpression = resolvedExpression.replace(quotedPattern2, JSON.stringify(resolvedValue));
        } else if (resolvedExpression.includes(escapedQuotedPattern1)) {
          // Replace \"{{var}}\" with JSON value
          resolvedExpression = resolvedExpression.replace(escapedQuotedPattern1, JSON.stringify(resolvedValue));
        } else if (resolvedExpression.includes(escapedQuotedPattern2)) {
          // Replace \'{{var}}\' with JSON value
          resolvedExpression = resolvedExpression.replace(escapedQuotedPattern2, JSON.stringify(resolvedValue));
        } else {
          // Variable is not quoted, replace as-is
          const jsonValue = JSON.stringify(resolvedValue);
          resolvedExpression = resolvedExpression.replace(fullMatch, jsonValue);
        }

        logger.debug({
          variable: fullMatch,
          resolvedValue,
          executionId: this.executionId
        }, 'Variable resolved in literal expression');
      } catch (error: any) {
        logger.warn({
          err: error,
          variable: fullMatch,
          executionId: this.executionId
        }, 'Failed to resolve variable in literal expression');
        throw new VariableResolutionError(
          `Cannot resolve variable ${fullMatch} in literal expression: ${error.message}`,
          expression
        );
      }
    }

    // Now evaluate the resolved expression
    try {
      // Try parsing as JSON first (most common case)
      const result = JSON.parse(resolvedExpression);
      logger.debug({
        originalExpression: expression,
        resolvedExpression,
        resultType: Array.isArray(result) ? 'array' : typeof result,
        executionId: this.executionId
      }, 'Literal expression resolved as JSON');
      return result;
    } catch (jsonError) {
      // If not valid JSON, try evaluating as JavaScript expression
      //
      // Phase 6 — Eval Audit Phase A: log this fallback eval site so production
      // telemetry can count how often we fall through to `new Function()`.
      // See: docs/workplans/audit-new-function-eval-usage.md
      logger.info({
        mode: 'literal_with_vars_eval',
        eval_path: true,
        expression: expression.slice(0, 200),
        resolvedExpressionPreview: resolvedExpression.slice(0, 200),
        executionId: this.executionId
      }, 'Falling back to new Function() eval (literal-with-vars after JSON.parse failed)');

      try {
        const result = new Function(`return ${resolvedExpression}`)();
        logger.debug({
          originalExpression: expression,
          resolvedExpression,
          resultType: Array.isArray(result) ? 'array' : typeof result,
          executionId: this.executionId
        }, 'Literal expression evaluated as JavaScript');
        return result;
      } catch (evalError: any) {
        throw new VariableResolutionError(
          `Failed to parse literal expression after variable resolution: ${evalError.message}`,
          expression
        );
      }
    }
  }

  /**
   * Resolve a simple variable path without the surrounding {{}}
   * Used internally for variable resolution
   */
  private resolveSimpleVariable(path: string): any {
    const parts = this.parsePath(path);

    if (parts.length === 0) {
      throw new VariableResolutionError(
        `Invalid variable path: ${path}`,
        path
      );
    }

    const root = parts[0];

    // CRITICAL FIX: Check variables FIRST before step outputs
    // This fixes the bug where variables like "step14_transformed_data" are treated as step IDs
    // because they start with "step". Variables registered via output_variable take precedence.
    if (this.variables.hasOwnProperty(root)) {
      const itemValue = this.variables[root];
      return parts.length > 1 ? this.getNestedValue(itemValue, parts.slice(1)) : itemValue;
    }

    // Check if it's a step output reference
    if (root.startsWith('step')) {
      const stepId = root;
      const stepOutput = this.stepOutputs.get(stepId);

      if (!stepOutput) {
        throw new VariableResolutionError(
          `Step ${stepId} has not been executed yet or does not exist`,
          path,
          stepId
        );
      }

      const remainingPath = parts.slice(1);

      // ✅ USABILITY FIX: Auto-navigate into .data for step outputs
      // StepOutput structure is: { stepId, plugin, action, data, metadata }
      // If user writes {{step4.assigned}}, they likely mean {{step4.data.assigned}}
      // Only auto-navigate if the first property isn't 'data' or 'metadata'
      //
      // STRICT MODE (Phase 6 — Tier 1 Fix #2): auto-navigation is disabled.
      // References must explicitly say `{{stepN.data.field}}`. This surfaces
      // workflows that depend on the implicit fallback so the compiler can
      // be fixed at source instead of being papered over at runtime.
      if (remainingPath.length > 0 && !this.strict) {
        const firstProp = remainingPath[0];
        const isDirectProperty = ['data', 'metadata', 'stepId', 'plugin', 'action'].includes(firstProp);

        if (!isDirectProperty) {
          // Auto-navigate into .data
          logger.debug({
            stepId,
            originalPath: path,
            autoNavigatedPath: `${stepId}.data.${remainingPath.join('.')}`
          }, 'Auto-navigating into step.data for convenience');
          return this.getNestedValue(stepOutput.data, remainingPath);
        }
      }

      return this.getNestedValue(stepOutput, remainingPath);
    }

    // Check if it's an input value reference
    // Wave 9: Support both 'input' and 'inputs' (plural) for flexibility
    // DSLWrapper generates {{inputs.xyz}} while legacy uses {{input.xyz}}
    if (root === 'input' || root === 'inputs') {
      return this.getNestedValue(this.inputValues, parts.slice(1));
    }

    // Check if it's a variable reference
    if (root === 'var') {
      return this.getNestedValue(this.variables, parts.slice(1));
    }

    // Check if it's a current item reference (for loops/filters)
    if (root === 'current' || root === 'item') {
      const itemValue = this.variables[root];

      if (itemValue === undefined) {
        // Provide helpful error message explaining when 'item' is available
        throw new VariableResolutionError(
          `Variable '${root}' is not defined in current context. ` +
          `'${root}' is only available inside: (1) transform filter/map operations, ` +
          `(2) loop iterations, or (3) scatter-gather steps. ` +
          `If you need to filter an array, use a transform step with operation='filter' instead of a conditional step.`,
          path,
          root
        );
      }

      return parts.length > 1 ? this.getNestedValue(itemValue, parts.slice(1)) : itemValue;
    }

    // Check if it's a loop variable reference
    if (root === 'loop') {
      return this.getNestedValue(this.variables, parts);
    }

    throw new VariableResolutionError(
      `Unknown variable reference root: ${root}`,
      path
    );
  }

  /**
   * Parse variable path into parts
   * Example: "step1.data[0].email" → ["step1", "data", "[0]", "email"]
   * Example: "loop.item['Sales Person']" → ["loop", "item", "['Sales Person']"]
   */
  private parsePath(path: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inBracket = false;
    let inQuote = false;
    let quoteChar = '';

    for (let i = 0; i < path.length; i++) {
      const char = path[i];

      if ((char === '"' || char === "'") && inBracket) {
        // Toggle quote state when inside brackets
        if (!inQuote) {
          inQuote = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuote = false;
          quoteChar = '';
        }
        current += char;
      } else if (char === '[') {
        if (current) {
          parts.push(current);
          current = '';
        }
        inBracket = true;
        current = '[';
      } else if (char === ']') {
        current += ']';
        parts.push(current);
        current = '';
        inBracket = false;
      } else if (char === '.' && !inBracket && !inQuote) {
        if (current) {
          parts.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Find matching key with smart field name resolution
   * Tries multiple naming conventions: snake_case, camelCase, PascalCase, lowercase, space-separated
   */
  private findMatchingKey(obj: Record<string, any>, requestedKey: string): string | null {
    const keys = Object.keys(obj);

    // Try exact match first (case-sensitive)
    if (keys.includes(requestedKey)) {
      return requestedKey;
    }

    // Try case-insensitive match
    const lowerRequested = requestedKey.toLowerCase();
    const caseInsensitiveMatch = keys.find(k => k.toLowerCase() === lowerRequested);
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }

    // Convert snake_case to camelCase and vice versa
    const snakeToCamel = (str: string) =>
      str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

    const camelToSnake = (str: string) =>
      str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);

    // Convert snake_case to "Title Case" (space-separated)
    const snakeToSpaced = (str: string) =>
      str.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');

    // Convert space-separated to snake_case
    const spacedToSnake = (str: string) =>
      str.toLowerCase().replace(/\s+/g, '_');

    // If requested key is snake_case, try various conversions
    if (requestedKey.includes('_')) {
      const camelVersion = snakeToCamel(requestedKey);
      if (keys.includes(camelVersion)) {
        return camelVersion;
      }
      // Also try PascalCase (first letter uppercase)
      const pascalVersion = camelVersion.charAt(0).toUpperCase() + camelVersion.slice(1);
      if (keys.includes(pascalVersion)) {
        return pascalVersion;
      }
      // Also try space-separated "Title Case" (e.g., "days_ahead" → "Days Ahead")
      const spacedVersion = snakeToSpaced(requestedKey);
      if (keys.includes(spacedVersion)) {
        return spacedVersion;
      }
      // Try case-insensitive match on spaced version
      const spacedMatch = keys.find(k => k.toLowerCase() === spacedVersion.toLowerCase());
      if (spacedMatch) {
        return spacedMatch;
      }
    }

    // If requested key is camelCase, try snake_case version
    if (/[A-Z]/.test(requestedKey)) {
      const snakeVersion = camelToSnake(requestedKey);
      if (keys.includes(snakeVersion)) {
        return snakeVersion;
      }
      // Also try lowercase version
      const lowerVersion = requestedKey.toLowerCase();
      if (keys.includes(lowerVersion)) {
        return lowerVersion;
      }
    }

    // If key contains spaces, try snake_case conversion (e.g., "Days Ahead" → "days_ahead")
    if (requestedKey.includes(' ')) {
      const snakeVersion = spacedToSnake(requestedKey);
      if (keys.includes(snakeVersion)) {
        return snakeVersion;
      }
    }

    // No match found
    return null;
  }

  /**
   * Get nested value from object using parsed path
   *
   * Strict mode (Phase 6 — Tier 1 Fix #2):
   *   • Throws VariableResolutionError when a path segment is missing rather
   *     than returning undefined silently.
   *   • Skips the snake↔camel fuzzy fallback.
   *   • Still honors explicit `null` values (legitimate API responses).
   *   • Still honors explicit `undefined` values on declared keys
   *     (distinguished via `part in current`).
   */
  private getNestedValue(obj: any, path: string[]): any {
    let current = obj;

    for (let i = 0; i < path.length; i++) {
      const part = path[i];

      // ✅ FIX: Distinguish between null and undefined
      // undefined = key doesn't exist (resolution error)
      // null = key exists but value is explicitly null (preserve it)
      if (current === undefined) {
        if (this.strict) {
          throw new VariableResolutionError(
            `Variable path '${path.join('.')}' could not be resolved: ` +
            `segment '${path.slice(0, i).join('.') || '(root)'}' is undefined ` +
            `before reaching '${part}'.`,
            path.join('.')
          );
        }
        return undefined;  // Path doesn't exist
      }

      // ✅ FIX: If current is null and we're trying to access a property, return null
      // This preserves explicit null values from API responses
      if (current === null) {
        // If there are more path parts, we can't traverse into null
        // Return null to indicate "value exists but is null" rather than undefined
        return null;
      }

      // Handle bracket notation: [0], [1], ['key'], ["key"], etc.
      if (part.startsWith('[') && part.endsWith(']')) {
        const innerContent = part.slice(1, -1);

        // Handle quoted string property access: ['Sales Person'] or ["Sales Person"]
        if ((innerContent.startsWith("'") && innerContent.endsWith("'")) ||
            (innerContent.startsWith('"') && innerContent.endsWith('"'))) {
          const propertyName = innerContent.slice(1, -1);
          current = current[propertyName];
        }
        // Handle wildcard array access: [*]
        else if (innerContent === '*') {
          if (!Array.isArray(current)) {
            throw new VariableResolutionError(
              `Trying to access array wildcard on non-array value`,
              part
            );
          }
          // ✅ CRITICAL FIX: If there are remaining path parts after [*],
          // map over the array and extract that path from each element
          const remainingPath = path.slice(i + 1);
          if (remainingPath.length > 0) {
            // Extract nested value from each array element
            // Example: values[*][4] → map each row to row[4]
            return current.map(item => this.getNestedValue(item, remainingPath));
          }
          // No remaining path - return the array as-is
          return current;
        }
        // Handle numeric array index: [0], [1], etc.
        else {
          const index = parseInt(innerContent, 10);

          if (isNaN(index)) {
            throw new VariableResolutionError(
              `Invalid array index: ${part}`,
              part
            );
          }

          if (!Array.isArray(current)) {
            throw new VariableResolutionError(
              `Trying to access array index on non-array value: ${part}`,
              part
            );
          }

          current = current[index];
        }
      }
      // Handle object property access
      else {
        // Direct property access first (case-sensitive)
        if (part in current) {
          current = current[part];
        }
        // ✅ FIX: Handle numeric index access on objects (for rows_to_objects compatibility)
        // After rows_to_objects converts 2D arrays to objects, filter conditions may still
        // reference fields by numeric index (e.g., "0" for first column).
        // Convert to positional access: item["0"] → Object.values(item)[0]
        else if (/^\d+$/.test(part) && typeof current === 'object' && current !== null && !Array.isArray(current)) {
          const numericIndex = parseInt(part, 10);
          const values = Object.values(current);
          if (numericIndex < values.length) {
            logger.debug({
              numericIndex,
              availableKeys: Object.keys(current).slice(0, 5)
            }, 'Converting numeric index access to positional access on object');
            current = values[numericIndex];
          } else {
            current = undefined;
          }
        }
        // ✅ CRITICAL FIX: Smart field name resolution (snake_case ↔ camelCase)
        // Handles naming convention mismatches between schemas and plugin implementations
        // Example: attachment_id (schema) → attachmentId (runtime data)
        //
        // STRICT MODE (Phase 6 — Tier 1 Fix #2): fuzzy matching is bypassed.
        // A missing key produces a VariableResolutionError with the available
        // keys at this level, so the offending workflow can be fixed at source.
        else if (typeof current === 'object' && current !== null) {
          if (this.strict) {
            const available = Array.isArray(current)
              ? `array[${current.length}]`
              : Object.keys(current).slice(0, 8).join(', ');
            throw new VariableResolutionError(
              `Variable path '${path.join('.')}' could not be resolved: ` +
              `key '${part}' not found at '${path.slice(0, i).join('.') || '(root)'}'. ` +
              `Available keys: ${available || '(none)'}.`,
              path.join('.')
            );
          }
          const matchingKey = this.findMatchingKey(current, part);
          if (matchingKey) {
            current = current[matchingKey];
          } else {
            current = undefined;  // Key not found
          }
        } else {
          if (this.strict) {
            throw new VariableResolutionError(
              `Variable path '${path.join('.')}' could not be resolved: ` +
              `cannot access property '${part}' on ${typeof current}.`,
              path.join('.')
            );
          }
          current = undefined;
        }
      }
    }

    return current;
  }

  /**
   * Get execution summary for checkpointing
   */
  getSummary(): ExecutionSummary {
    return {
      executionId: this.executionId,
      agentId: this.agentId,
      userId: this.userId,
      status: this.status,
      currentStep: this.currentStep,
      completedSteps: [...this.completedSteps],
      failedSteps: [...this.failedSteps],
      skippedSteps: [...this.skippedSteps],
      totalTokensUsed: this.totalTokensUsed,
      totalExecutionTime: this.totalExecutionTime,
      stepCount: {
        total: this.completedSteps.length + this.failedSteps.length + this.skippedSteps.length,
        completed: this.completedSteps.length,
        failed: this.failedSteps.length,
        skipped: this.skippedSteps.length,
      },
    };
  }

  /**
   * Get sanitized execution trace for database storage
   */
  getExecutionTrace(): any {
    const stepExecutions: any[] = [];

    this.stepOutputs.forEach((output, stepId) => {
      stepExecutions.push({
        stepId,
        plugin: output.plugin,
        action: output.action,
        metadata: output.metadata,  // Only metadata, not actual data
      });
    });

    return {
      completedSteps: [...this.completedSteps],
      failedSteps: [...this.failedSteps],
      skippedSteps: [...this.skippedSteps],
      stepExecutions,
    };
  }

  /**
   * Clone context (useful for parallel execution)
   *
   * @param resetMetrics - If true, resets token/time tracking to 0 (for parallel scatter execution)
   *                       This prevents double-counting when cloned contexts are merged back
   */
  clone(resetMetrics: boolean = false): ExecutionContext {
    const cloned = new ExecutionContext(
      this.executionId,
      this.agent,
      this.userId,
      this.sessionId,
      { ...this.inputValues },
      this.batchCalibrationMode,
      this.strict, // Phase 6 — Tier 1 Fix #2: preserve strict mode across loop/scatter iterations
      this.loopInnerOverwriteDisabled, // Phase 6 — Tier 2 Fix #1: preserve loop overwrite policy
      this.conditionalCoercionEnabled, // Phase 6 — Tier 2 Fix #2: preserve coercion policy
      this.scatterExplicitShapeRequired, // Phase 6 — Tier 2 Fix #3: preserve scatter shape policy
      this.runMode // Phase 6 — Tier 2 Fix #4: preserve runMode for failure-handling semantics
    );

    cloned.status = this.status;
    cloned.currentStep = this.currentStep;
    cloned.completedSteps = [...this.completedSteps];
    cloned.failedSteps = [...this.failedSteps];
    cloned.skippedSteps = [...this.skippedSteps];
    cloned.stepOutputs = new Map(this.stepOutputs);
    cloned.variables = { ...this.variables };
    cloned.memoryContext = this.memoryContext;
    cloned.orchestrator = this.orchestrator; // Copy orchestrator reference for consistent routing
    cloned.startedAt = this.startedAt;
    cloned.collectedIssues = [...this.collectedIssues];

    // Phase 6 — Tier 1 Fix #3: share the per-execution resource bundle by
    // REFERENCE (shallow copy). Loop / scatter iterations use the same
    // shadowAgent, checkpointManager, summaryCollector etc. as the parent.
    cloned.scope = this.scope;

    // For parallel execution, reset metrics to 0 so only NEW tokens/time are tracked
    // This prevents double-counting when merging back to parent
    if (resetMetrics) {
      cloned.totalTokensUsed = 0;
      cloned.totalExecutionTime = 0;
    } else {
      cloned.totalTokensUsed = this.totalTokensUsed;
      cloned.totalExecutionTime = this.totalExecutionTime;
    }

    return cloned;
  }

  /**
   * Merge another context into this one (for parallel execution results)
   */
  merge(other: ExecutionContext): void {
    // Merge step outputs
    other.stepOutputs.forEach((output, stepId) => {
      this.stepOutputs.set(stepId, output);
    });

    // Merge tracking arrays (deduplicate)
    this.completedSteps = [...new Set([...this.completedSteps, ...other.completedSteps])];
    this.failedSteps = [...new Set([...this.failedSteps, ...other.failedSteps])];
    this.skippedSteps = [...new Set([...this.skippedSteps, ...other.skippedSteps])];

    // Merge variables
    this.variables = { ...this.variables, ...other.variables };

    // Merge collected issues (batch calibration)
    this.collectedIssues = [...this.collectedIssues, ...other.collectedIssues];

    // Sum metrics
    this.totalTokensUsed += other.totalTokensUsed;
    this.totalExecutionTime += other.totalExecutionTime;
  }

  /**
   * Reset context (for retries)
   */
  reset(): void {
    this.currentStep = null;
    this.completedSteps = [];
    this.failedSteps = [];
    this.skippedSteps = [];
    this.stepOutputs = new Map();
    this.variables = {};
    this.totalTokensUsed = 0;
    this.totalExecutionTime = 0;
    this.status = 'running';
    this.startedAt = new Date();
  }

  /**
   * Get progress percentage
   */
  getProgress(totalSteps: number): number {
    if (totalSteps === 0) return 0;

    const completed = this.completedSteps.length + this.failedSteps.length + this.skippedSteps.length;
    return Math.round((completed / totalSteps) * 100);
  }

  /**
   * Check if execution is complete
   */
  isComplete(): boolean {
    return this.status === 'completed' || this.status === 'failed' || this.status === 'cancelled';
  }

  /**
   * Mark as completed
   */
  markCompleted(): void {
    this.status = 'completed';
    this.completedAt = new Date();
    logger.info({
      executionId: this.executionId,
      completedSteps: this.completedSteps.length,
      failedSteps: this.failedSteps.length,
      skippedSteps: this.skippedSteps.length,
      totalTokensUsed: this.totalTokensUsed,
      totalExecutionTimeMs: this.totalExecutionTime
    }, 'Execution completed');
  }

  /**
   * Mark as failed
   */
  markFailed(): void {
    this.status = 'failed';
    this.completedAt = new Date();
    logger.error({
      executionId: this.executionId,
      completedSteps: this.completedSteps.length,
      failedSteps: this.failedSteps,
      totalTokensUsed: this.totalTokensUsed
    }, 'Execution failed');
  }

  /**
   * Mark as paused
   */
  markPaused(): void {
    this.status = 'paused';
    logger.info({ executionId: this.executionId, currentStep: this.currentStep }, 'Execution paused');
  }

  /**
   * Mark as cancelled
   */
  markCancelled(): void {
    this.status = 'cancelled';
    this.completedAt = new Date();
    logger.warn({ executionId: this.executionId, currentStep: this.currentStep }, 'Execution cancelled');
  }

  /**
   * Resume from paused
   */
  resume(): void {
    this.status = 'running';
    logger.info({ executionId: this.executionId, currentStep: this.currentStep }, 'Execution resumed');
  }

  // ============================================================================
  // Workflow Data Schema — Runtime Validation (Phase 5)
  // ============================================================================

  /**
   * Register the workflow data schema for runtime validation.
   * Called once at execution start by WorkflowPilot.
   */
  registerDataSchema(schema: WorkflowDataSchema): void {
    this.dataSchema = schema;
    logger.info({
      slotCount: Object.keys(schema.slots).length,
      slotNames: Object.keys(schema.slots),
      executionId: this.executionId
    }, 'Workflow data schema registered');
  }

  /**
   * Get the registered data schema (if any).
   */
  getDataSchema(): WorkflowDataSchema | null {
    return this.dataSchema;
  }

  /**
   * Validate data against a named slot's schema.
   * Returns an array of error strings (empty = valid).
   * If no schema is registered or the slot doesn't exist, returns empty (skip validation).
   */
  validateAgainstSchema(slotName: string, data: any): string[] {
    if (!this.dataSchema) return [];

    const slot = this.dataSchema.slots[slotName];
    if (!slot) return [];

    return this.validateValue(data, slot.schema, slotName);
  }

  /**
   * Recursive type/field validation against a SchemaField.
   * Returns an array of error strings (empty = valid).
   */
  private validateValue(value: any, schema: SchemaField, path: string): string[] {
    const errors: string[] = [];

    // 1. Null/undefined check against required
    if (value === null || value === undefined) {
      if (schema.required) {
        errors.push(`${path}: required field missing`);
      }
      return errors;
    }

    // 2. oneOf validation — at least one branch must match
    if (schema.oneOf && schema.oneOf.length > 0) {
      const branchResults = schema.oneOf.map(branch => this.validateValue(value, branch, path));
      const anyBranchValid = branchResults.some(errs => errs.length === 0);
      if (!anyBranchValid) {
        errors.push(`${path}: value does not match any oneOf branch`);
      }
      return errors;
    }

    // 3. Type check
    const actualType = Array.isArray(value) ? 'array' : typeof value;

    if (schema.type !== 'any' && schema.type !== actualType) {
      errors.push(
        `${path}: expected type "${schema.type}" but got "${actualType}". Value: ${JSON.stringify(value).slice(0, 100)}`
      );
      return errors;
    }

    // 4. Object property validation (recurse into properties)
    if (schema.type === 'object' && schema.properties) {
      for (const [key, fieldSchema] of Object.entries(schema.properties)) {
        const fieldValue = value[key];
        const fieldErrors = this.validateValue(fieldValue, fieldSchema, `${path}.${key}`);
        errors.push(...fieldErrors);
      }
    }

    // 5. Array item validation (validate first item as representative)
    if (schema.type === 'array' && schema.items && Array.isArray(value) && value.length > 0) {
      const itemErrors = this.validateValue(value[0], schema.items, `${path}[0]`);
      errors.push(...itemErrors);
    }

    return errors;
  }
}
