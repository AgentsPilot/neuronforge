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
} from './types';
import { VariableResolutionError, getTokenTotal } from './types';
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
  private stepOutputs: Map<string, StepOutput>;

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

  constructor(
    executionId: string,
    agent: Agent,
    userId: string,
    sessionId: string,
    inputValues: Record<string, any> = {}
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

    logger.info({
      executionId,
      agentId: agent.id,
      userId,
      sessionId,
      inputKeys: Object.keys(inputValues)
    }, 'ExecutionContext created');
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
      if (remainingPath.length > 0) {
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

    // Check if root is a custom scatter/loop variable (e.g., 'email', 'customer', etc.)
    if (this.variables.hasOwnProperty(root)) {
      const itemValue = this.variables[root];
      return parts.length > 1 ? this.getNestedValue(itemValue, parts.slice(1)) : itemValue;
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
   * Get nested value from object using parsed path
   */
  private getNestedValue(obj: any, path: string[]): any {
    let current = obj;

    for (const part of path) {
      // ✅ FIX: Distinguish between null and undefined
      // undefined = key doesn't exist (resolution error)
      // null = key exists but value is explicitly null (preserve it)
      if (current === undefined) {
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
          // Return all items
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
        // ✅ CRITICAL FIX: Case-insensitive fallback
        // rows_to_objects lowercases headers (Stage → stage)
        // but filter conditions may use original case (Stage)
        else if (typeof current === 'object' && current !== null) {
          const lowerPart = part.toLowerCase();
          const matchingKey = Object.keys(current).find(k => k.toLowerCase() === lowerPart);
          if (matchingKey) {
            current = current[matchingKey];
          } else {
            current = undefined;  // Key not found
          }
        } else {
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
      { ...this.inputValues }
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
}
