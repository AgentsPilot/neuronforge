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
} from './types';
import { VariableResolutionError, getTokenTotal } from './types';

export class ExecutionContext {
  // Execution metadata
  public executionId: string;
  public agentId: string;
  public userId: string;
  public sessionId: string;

  // Agent configuration
  public agent: Agent;
  public inputValues: Record<string, any>;
  public workflowConfig: Record<string, any>; // Workflow configuration parameters (accessible via {{config.key}})

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
  public orchestrator?: any; // WorkflowOrchestrator instance (avoiding circular dependency)

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
<<<<<<< Updated upstream
    inputValues: Record<string, any> = {}
=======
    inputValues: Record<string, any> = {},
    batchCalibrationMode: boolean = false,
    workflowConfig: Record<string, any> = {}
>>>>>>> Stashed changes
  ) {
    this.executionId = executionId;
    this.agent = agent;
    this.agentId = agent.id;
    this.userId = userId;
    this.sessionId = sessionId;
    this.inputValues = inputValues;
    this.workflowConfig = workflowConfig;
    this.stepOutputs = new Map();
    this.variables = {};
    this.status = 'running';
    this.startedAt = new Date();
<<<<<<< Updated upstream
=======
    this.batchCalibrationMode = batchCalibrationMode;
    this.collectedIssues = [];

    logger.info({
      executionId,
      agentId: agent.id,
      userId,
      sessionId,
      inputKeys: Object.keys(inputValues),
      configKeys: Object.keys(workflowConfig),
      batchCalibrationMode
    }, 'ExecutionContext created');
>>>>>>> Stashed changes
  }

  /**
   * Store step output
   *
   * ✅ P0 FIX: Token de-duplication for retries
   * When a step is retried, we REPLACE the previous token count instead of adding
   * This prevents over-charging users for failed attempts
   */
  setStepOutput(stepId: string, output: StepOutput): void {
    // 🔍 DEBUG: Log what's being stored
    console.log(`🔍 [ExecutionContext] Storing output for ${stepId}:`, JSON.stringify({
      data: output.data,
      plugin: output.plugin,
      action: output.action
    }, null, 2));

    // ✅ P0 FIX: Check if this is a retry (step already executed)
    const previousOutput = this.stepOutputs.get(stepId);
    const isRetry = previousOutput !== undefined;

    if (isRetry) {
      console.log(`🔄 [ExecutionContext] Retry detected for ${stepId} - de-duplicating tokens`);

      // ✅ P1: Use standardized getTokenTotal utility for consistent handling
      const previousTokenTotal = getTokenTotal(previousOutput.metadata.tokensUsed);
      this.totalTokensUsed -= previousTokenTotal;
      console.log(`   Removed ${previousTokenTotal} tokens from previous attempt`);

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
      console.log(`   Added ${newTokenTotal} tokens from new attempt`);
      console.log(`   Total tokens after de-duplication: ${this.totalTokensUsed}`);
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
    }
  }

  /**
   * Set runtime variable
   */
  setVariable(name: string, value: any): void {
    this.variables[name] = value;
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
   * - {{config.amount_threshold_usd}} - Workflow configuration parameter
   * - {{var.counter}} - Runtime variable
   * - {{current.item}} - Loop current item
<<<<<<< Updated upstream
=======
   * - ["{{email.id}}"] - Literal expressions with embedded variables
   *
   * @param reference - Variable reference string like "{{step1.data.email}}"
   * @param expectedSchema - Optional JSON Schema defining expected type (for schema-aware extraction)
   * @param parameterName - Optional parameter name (used for schema-aware field extraction)
>>>>>>> Stashed changes
   */
  resolveVariable(reference: VariableReference, expectedSchema?: any, parameterName?: string): any {
    // If it's not a string, return as-is (already resolved)
    if (typeof reference !== 'string') {
      return reference;
    }

    // Check if it's a variable reference
    if (!reference.includes('{{')) {
      return reference;
    }

    // Extract variable path from {{...}}
    const match = reference.match(/\{\{([^}]+)\}\}/);
    if (!match) {
      return reference;
    }

    const path = match[1].trim();

    // Parse path: "step1.data[0].email"
    const parts = this.parsePath(path);

    if (parts.length === 0) {
      throw new VariableResolutionError(
        `Invalid variable reference: ${reference}`,
        reference
      );
    }

<<<<<<< Updated upstream
    const root = parts[0];

    // Check if it's a step output reference
    if (root.startsWith('step')) {
      const stepId = root;
      const stepOutput = this.stepOutputs.get(stepId);

      if (!stepOutput) {
        throw new VariableResolutionError(
          `Step ${stepId} has not been executed yet or does not exist`,
          reference,
          stepId
        );
      }

      // Navigate nested path: data.email
      return this.getNestedValue(stepOutput, parts.slice(1));
    }

    // Check if it's an input value reference
    if (root === 'input') {
      return this.getNestedValue(this.inputValues, parts.slice(1));
    }

    // Check if it's a variable reference
    if (root === 'var') {
      return this.getNestedValue(this.variables, parts.slice(1));
    }

    // Check if it's a current item reference (for loops)
    if (root === 'current') {
      return this.getNestedValue(this.variables, parts);
    }

    throw new VariableResolutionError(
      `Unknown variable reference root: ${root}`,
      reference
    );
=======
    // ✅ SCHEMA-AWARE AUTO-EXTRACTION
    // If expectedSchema is provided and there's a type mismatch, attempt intelligent extraction
    if (expectedSchema && resolved && typeof resolved === 'object' && !Array.isArray(resolved)) {
      const extractedValue = this.attemptSchemaAwareExtraction(resolved, expectedSchema, parameterName, path);
      if (extractedValue !== resolved) {
        logger.info({
          reference,
          parameterName,
          expectedType: expectedSchema.type,
          resolvedType: typeof resolved,
          extractedField: parameterName,
          extractedValue: typeof extractedValue === 'string' ? extractedValue : typeof extractedValue
        }, 'Schema-aware extraction: auto-extracted field from object');
        return extractedValue;
      }
    }

    return resolved;
>>>>>>> Stashed changes
  }

  /**
   * Attempt to intelligently extract a scalar value from an object when there's a type mismatch
   *
   * This is the core of schema-aware variable resolution:
   * - If parameter expects string but variable is object, try to extract matching field
   * - Check if object has field matching parameter name (e.g., file_id from {file_id, file_name, ...})
   * - Check output_schema for primary field hints
   *
   * @param value - The resolved object value
   * @param expectedSchema - Expected parameter schema {type: 'string', ...}
   * @param parameterName - Parameter name (e.g., "file_id")
   * @param variablePath - Original variable path for error messages
   */
  private attemptSchemaAwareExtraction(value: any, expectedSchema: any, parameterName: string | undefined, variablePath: string): any {
    // Only extract if expected type is scalar (string, number, boolean)
    const expectedType = expectedSchema?.type;
    if (!expectedType || expectedType === 'object' || expectedType === 'array') {
      return value; // No extraction needed
    }

    // Strategy 1: If parameter name matches a field in the object, extract it
    if (parameterName && parameterName in value) {
      const extracted = value[parameterName];
      const extractedType = typeof extracted;

      // Verify the extracted value matches expected type
      if (this.typesMatch(extracted, expectedSchema)) {
        return extracted;
      }
    }

    // Strategy 2: Check if object has _outputSchema hint for primary field
    const outputSchema = (value as any)._outputSchema;
    if (outputSchema && outputSchema.properties) {
      // Look for primary field hint (x-primary-field or x-use-for-reference)
      for (const [fieldName, fieldSchema] of Object.entries(outputSchema.properties)) {
        const fs = fieldSchema as any;
        if (fs['x-primary-field'] || fs['x-use-for-reference']) {
          const extracted = value[fieldName];
          if (extracted !== undefined && this.typesMatch(extracted, expectedSchema)) {
            logger.debug({
              fieldName,
              primaryFieldHint: fs['x-primary-field'] ? 'x-primary-field' : 'x-use-for-reference'
            }, 'Using primary field hint from output_schema');
            return extracted;
          }
        }
      }

      // Look for field matching expected type
      for (const [fieldName, fieldSchema] of Object.entries(outputSchema.properties)) {
        const fs = fieldSchema as any;
        if (fs.type === expectedType && value[fieldName] !== undefined) {
          logger.debug({
            fieldName,
            matchedType: expectedType
          }, 'Using type-matched field from output_schema');
          return value[fieldName];
        }
      }
    }

    // Strategy 3: Look for common ID patterns (id, _id, <type>_id)
    if (expectedType === 'string' && parameterName) {
      const commonIdFields = ['id', '_id', `${parameterName}_id`];
      for (const idField of commonIdFields) {
        if (idField in value && typeof value[idField] === 'string') {
          logger.debug({
            idField,
            parameterName
          }, 'Using common ID pattern for extraction');
          return value[idField];
        }
      }
    }

    // Could not extract - return original value
    // Downstream code will handle the type mismatch (may fail or apply fallback unwrapping)
    return value;
  }

  /**
   * Check if a value matches expected schema type
   */
  private typesMatch(value: any, expectedSchema: any): boolean {
    if (!expectedSchema || !expectedSchema.type) return true;

    const actualType = Array.isArray(value) ? 'array' : typeof value;
    const expectedType = expectedSchema.type;

    if (expectedType === 'integer' || expectedType === 'number') {
      return typeof value === 'number';
    }

    return actualType === expectedType;
  }

  /**
   * Resolve all variables in an object (recursive)
   */
  resolveAllVariables(obj: any): any {
    // 🔍 DEBUG: Log available step outputs
    console.log(`🔍 [ExecutionContext] Available step outputs:`, Array.from(this.stepOutputs.keys()));

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      // Check if entire string is a variable reference
      if (obj.match(/^\{\{.*\}\}$/)) {
        console.log('[ExecutionContext] Resolving full variable:', obj);
        const resolved = this.resolveVariable(obj);
        console.log('[ExecutionContext] Resolved to:', resolved);
        return resolved;
      }

      // Replace inline variables: "Email from {{step1.data.sender}}"
      return obj.replace(/\{\{([^}]+)\}\}/g, (match) => {
        try {
          console.log('[ExecutionContext] Resolving inline variable:', match);
          const value = this.resolveVariable(match);
<<<<<<< Updated upstream
=======
          console.log('[ExecutionContext] Resolved to:', value);
          // ✅ CRITICAL FIX: Use JSON.stringify for arrays and objects
          // String([]) returns "" (empty string) which breaks expressions
          // JSON.stringify([]) returns "[]" which is correct JavaScript
          if (Array.isArray(value)) {
            return JSON.stringify(value);
          } else if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
          }
>>>>>>> Stashed changes
          return String(value);
        } catch (error) {
          console.warn(`Failed to resolve variable ${match}:`, error);
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
<<<<<<< Updated upstream
=======
   * Resolve parameters with schema-aware type extraction
   *
   * This method is like resolveAllVariables but uses parameter schemas
   * to intelligently extract fields when there's a type mismatch.
   *
   * @param params - Object containing parameter values (may have {{variable}} references)
   * @param parameterSchema - JSON Schema defining expected parameter types
   * @returns Resolved parameters with schema-aware field extraction applied
   */
  resolveParametersWithSchema(params: any, parameterSchema: any): any {
    if (!params || !parameterSchema || !parameterSchema.properties) {
      // Fallback to normal resolution if no schema available
      return this.resolveAllVariables(params);
    }

    const resolved: any = {};

    for (const [paramName, paramValue] of Object.entries(params)) {
      const paramDef = parameterSchema.properties[paramName];

      if (typeof paramValue === 'string' && paramValue.match(/^\{\{.*\}\}$/)) {
        // Full variable reference - use schema-aware resolution
        resolved[paramName] = this.resolveVariable(paramValue, paramDef, paramName);
      } else {
        // Regular value or complex expression - use normal resolution
        resolved[paramName] = this.resolveAllVariables(paramValue);
      }
    }

    return resolved;
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

    // Check if it's a workflow config reference (e.g., {{config.amount_threshold_usd}})
    if (root === 'config') {
      return this.getNestedValue(this.workflowConfig, parts.slice(1));
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
      logger.info({
        root,
        path,
        hasValue: itemValue !== undefined,
        valueType: typeof itemValue,
        valueKeys: itemValue && typeof itemValue === 'object' ? Object.keys(itemValue) : null
      }, 'Resolved custom variable from context.variables');
      return parts.length > 1 ? this.getNestedValue(itemValue, parts.slice(1)) : itemValue;
    }

    logger.warn({
      root,
      path,
      availableVariables: Object.keys(this.variables),
      executionId: this.executionId
    }, 'Variable reference root not found');

    throw new VariableResolutionError(
      `Unknown variable reference root: ${root}`,
      path
    );
  }

  /**
>>>>>>> Stashed changes
   * Parse variable path into parts
   * Example: "step1.data[0].email" → ["step1", "data", "[0]", "email"]
   */
  private parsePath(path: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inBracket = false;

    for (let i = 0; i < path.length; i++) {
      const char = path[i];

      if (char === '[') {
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
      } else if (char === '.' && !inBracket) {
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
      if (current === undefined || current === null) {
        return undefined;
      }

      // Handle array access: [0], [1], etc.
      if (part.startsWith('[') && part.endsWith(']')) {
        const index = parseInt(part.slice(1, -1), 10);

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
      // Handle wildcard array access: [*]
      else if (part === '[*]') {
        if (!Array.isArray(current)) {
          throw new VariableResolutionError(
            `Trying to access array wildcard on non-array value`,
            part
          );
        }
        // Return all items
        return current;
      }
      // Handle object property access
      else {
        current = current[part];
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
   */
  clone(): ExecutionContext {
    const cloned = new ExecutionContext(
      this.executionId,
      this.agent,
      this.userId,
      this.sessionId,
<<<<<<< Updated upstream
      { ...this.inputValues }
=======
      { ...this.inputValues },
      this.batchCalibrationMode,
      { ...this.workflowConfig }
>>>>>>> Stashed changes
    );

    cloned.status = this.status;
    cloned.currentStep = this.currentStep;
    cloned.completedSteps = [...this.completedSteps];
    cloned.failedSteps = [...this.failedSteps];
    cloned.skippedSteps = [...this.skippedSteps];
    cloned.stepOutputs = new Map(this.stepOutputs);
    cloned.variables = { ...this.variables };
    cloned.memoryContext = this.memoryContext;
    cloned.startedAt = this.startedAt;
    cloned.totalTokensUsed = this.totalTokensUsed;
    cloned.totalExecutionTime = this.totalExecutionTime;

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
  }

  /**
   * Mark as failed
   */
  markFailed(): void {
    this.status = 'failed';
    this.completedAt = new Date();
  }

  /**
   * Mark as paused
   */
  markPaused(): void {
    this.status = 'paused';
  }

  /**
   * Mark as cancelled
   */
  markCancelled(): void {
    this.status = 'cancelled';
    this.completedAt = new Date();
  }

  /**
   * Resume from paused
   */
  resume(): void {
    this.status = 'running';
  }
}
