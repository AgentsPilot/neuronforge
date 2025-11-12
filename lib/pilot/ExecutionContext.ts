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
import { VariableResolutionError } from './types';

export class ExecutionContext {
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
  }

  /**
   * Store step output
   */
  setStepOutput(stepId: string, output: StepOutput): void {
    this.stepOutputs.set(stepId, output);

    // Update tracking arrays
    if (output.metadata.success) {
      if (!this.completedSteps.includes(stepId)) {
        this.completedSteps.push(stepId);
      }
    } else {
      if (!this.failedSteps.includes(stepId)) {
        this.failedSteps.push(stepId);
      }
    }

    // Update token count (handle both number and object formats)
    if (output.metadata.tokensUsed) {
      const tokens = output.metadata.tokensUsed;
      if (typeof tokens === 'number') {
        this.totalTokensUsed += tokens;
      } else if (typeof tokens === 'object' && 'total' in tokens) {
        this.totalTokensUsed += tokens.total;
      }
    }

    // Update execution time
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
   * - {{var.counter}} - Runtime variable
   * - {{current.item}} - Loop current item
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
