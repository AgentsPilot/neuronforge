/**
 * ExecutionTracer - Runtime execution tracing for post-mortem analysis
 *
 * Captures detailed execution traces including:
 * - Step input/output snapshots
 * - Scatter-gather variable flow
 * - Variable context at each step
 * - Execution metrics (tokens, time)
 *
 * Purpose:
 * - Enable 100% post-execution debugging
 * - Identify where data transformations break
 * - Trace variable flow through complex workflows
 * - Analyze schema mismatches between steps
 *
 * @module lib/pilot/ExecutionTracer
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ExecutionTracer', service: 'pilot' });

export interface ExecutionTrace {
  timestamp: number;
  stepId: string;
  stepType: string;
  inputSnapshot?: SerializedSnapshot;
  outputSnapshot?: SerializedSnapshot;
  variableContext?: Record<string, any>;
  scatterItemCount?: number;
  itemSnapshots?: SerializedSnapshot[];
  gatheredResultSnapshot?: SerializedSnapshot;
  variableFlow?: VariableFlowTrace;
  metrics?: {
    tokensUsed?: number;
    executionTimeMs?: number;
    totalTokens?: number;
    totalTimeMs?: number;
  };
  error?: {
    message: string;
    code?: string;
    stack?: string;
  };
}

export interface SerializedSnapshot {
  type: string;
  preview: string;
  fullData?: any;
  schema?: {
    type: string;
    fields?: string[];
    isArray?: boolean;
    itemCount?: number;
  };
}

export interface VariableFlowTrace {
  createdVariables: Array<{
    name: string;
    stepId: string;
    type: string;
    isArray: boolean;
  }>;
  gatherFrom?: string;
  gatherFromType?: string;
  gatheredType?: string;
  mergeDecision?: string;
}

export interface TraceAnalysis {
  totalSteps: number;
  failedSteps: number;
  schemaMismatches: Array<{
    fromStep: string;
    toStep: string;
    expectedType: string;
    actualType: string;
    missingFields: string[];
  }>;
  unusedVariables: Array<{
    variableName: string;
    createdAt: string;
  }>;
  typeConversionIssues: Array<{
    stepId: string;
    inputType: string;
    expectedType: string;
  }>;
  scatterGatherIssues: Array<{
    stepId: string;
    issue: string;
    details: any;
  }>;
}

/**
 * ExecutionTracer singleton
 *
 * Usage:
 *   const tracer = ExecutionTracer.getInstance();
 *   tracer.recordStepExecution(step, input, output);
 *   const trace = tracer.exportTrace();
 */
export class ExecutionTracer {
  private static instance: ExecutionTracer | null = null;
  private traces: ExecutionTrace[] = [];
  private sessionId: string | null = null;
  private enabled: boolean = true;

  private constructor() {}

  static getInstance(): ExecutionTracer {
    if (!ExecutionTracer.instance) {
      ExecutionTracer.instance = new ExecutionTracer();
    }
    return ExecutionTracer.instance;
  }

  /**
   * Start a new trace session
   */
  startSession(sessionId: string): void {
    this.sessionId = sessionId;
    this.traces = [];
    this.enabled = true;
    logger.info({ sessionId }, 'ExecutionTracer session started');
  }

  /**
   * Stop tracing
   */
  stopSession(): void {
    logger.info({ sessionId: this.sessionId, traceCount: this.traces.length }, 'ExecutionTracer session stopped');
    this.enabled = false;
  }

  /**
   * Check if tracer is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Record step execution
   */
  recordStepExecution(step: any, input: any, output: any): void {
    if (!this.enabled) return;

    const trace: ExecutionTrace = {
      timestamp: Date.now(),
      stepId: step.step_id || step.id,
      stepType: step.type,
      inputSnapshot: this.serializeForTrace(input),
      outputSnapshot: this.serializeForTrace(output),
      variableContext: this.captureVariableContext(),
      metrics: {
        tokensUsed: output?.metrics?.tokensUsed,
        executionTimeMs: output?.metrics?.executionTimeMs
      }
    };

    // Capture error if present
    if (output?.error) {
      trace.error = {
        message: output.error.message || String(output.error),
        code: output.error.code,
        stack: output.error.stack
      };
    }

    this.traces.push(trace);

    logger.debug({
      stepId: trace.stepId,
      stepType: trace.stepType,
      hasInput: !!input,
      hasOutput: !!output,
      hasError: !!trace.error
    }, 'Recorded step execution');
  }

  /**
   * Record scatter-gather execution
   */
  recordScatterGather(
    scatterStep: any,
    items: any[],
    gatheredResult: any,
    variableFlow?: VariableFlowTrace
  ): void {
    if (!this.enabled) return;

    const trace: ExecutionTrace = {
      timestamp: Date.now(),
      stepId: scatterStep.step_id || scatterStep.id,
      stepType: 'scatter_gather',
      scatterItemCount: items.length,
      itemSnapshots: items.slice(0, 3).map(item => this.serializeForTrace(item)), // First 3 items only
      gatheredResultSnapshot: this.serializeForTrace(gatheredResult),
      variableFlow,
      metrics: {
        totalTokens: this.aggregateTokens(items),
        totalTimeMs: this.aggregateTime(items)
      }
    };

    this.traces.push(trace);

    logger.debug({
      stepId: trace.stepId,
      itemCount: items.length,
      variableFlow: variableFlow?.gatherFrom,
      gatheredType: trace.gatheredResultSnapshot?.type
    }, 'Recorded scatter-gather execution');
  }

  /**
   * Serialize data for trace with size limits
   */
  private serializeForTrace(data: any): SerializedSnapshot {
    if (data === null || data === undefined) {
      return {
        type: 'null',
        preview: 'null'
      };
    }

    const type = Array.isArray(data) ? 'array' : typeof data;
    let preview = '';
    let schema: SerializedSnapshot['schema'] = { type };

    if (type === 'array') {
      schema.isArray = true;
      schema.itemCount = data.length;

      // Get fields from first item if it's an object
      if (data.length > 0 && typeof data[0] === 'object') {
        schema.fields = Object.keys(data[0]);
        preview = `Array[${data.length}] with fields: ${schema.fields.slice(0, 5).join(', ')}${schema.fields.length > 5 ? '...' : ''}`;
      } else {
        preview = `Array[${data.length}] of ${typeof data[0]}`;
      }
    } else if (type === 'object') {
      const fields = Object.keys(data);
      schema.fields = fields;
      preview = `Object with fields: ${fields.slice(0, 5).join(', ')}${fields.length > 5 ? '...' : ''}`;
    } else if (type === 'string') {
      preview = data.length > 100 ? `"${data.substring(0, 100)}..."` : `"${data}"`;
    } else {
      preview = String(data).substring(0, 100);
    }

    // Include full data for small objects (< 1KB)
    const serialized = JSON.stringify(data);
    const fullData = serialized.length < 1024 ? data : undefined;

    return {
      type,
      preview,
      fullData,
      schema
    };
  }

  /**
   * Capture current variable context
   * Note: This requires access to ExecutionContext, which we'll integrate later
   */
  private captureVariableContext(): Record<string, any> {
    // TODO: Integrate with ExecutionContext to capture actual variable state
    // For now, return empty object
    return {};
  }

  /**
   * Capture scatter-gather variable flow
   */
  captureScatterVariableFlow(scatterStep: any): VariableFlowTrace {
    const createdVariables: VariableFlowTrace['createdVariables'] = [];
    const scatterSteps = scatterStep.scatter?.steps || [];

    for (const step of scatterSteps) {
      if (step.output_variable && step.output_schema) {
        createdVariables.push({
          name: step.output_variable,
          stepId: step.step_id || step.id,
          type: step.output_schema.type,
          isArray: step.output_schema.type === 'array'
        });
      }
    }

    const gatherFrom = scatterStep.gather?.from?.replace(/\{\{|\}\}/g, '');
    const gatherFromVar = createdVariables.find(v => v.name === gatherFrom);

    return {
      createdVariables,
      gatherFrom,
      gatherFromType: gatherFromVar?.type,
      gatheredType: undefined, // Will be set when result is available
      mergeDecision: undefined  // Will be set by ParallelExecutor
    };
  }

  /**
   * Aggregate tokens used across scatter items
   */
  private aggregateTokens(items: any[]): number {
    return items.reduce((total, item) => {
      return total + (item?.metrics?.tokensUsed || 0);
    }, 0);
  }

  /**
   * Aggregate execution time across scatter items
   */
  private aggregateTime(items: any[]): number {
    return items.reduce((total, item) => {
      return total + (item?.metrics?.executionTimeMs || 0);
    }, 0);
  }

  /**
   * Export all traces
   */
  exportTrace(): ExecutionTrace[] {
    return [...this.traces];
  }

  /**
   * Analyze trace for issues
   */
  analyzeTrace(): TraceAnalysis {
    const analysis: TraceAnalysis = {
      totalSteps: this.traces.length,
      failedSteps: this.traces.filter(t => t.error).length,
      schemaMismatches: [],
      unusedVariables: [],
      typeConversionIssues: [],
      scatterGatherIssues: []
    };

    // Analyze schema mismatches between consecutive steps
    for (let i = 0; i < this.traces.length - 1; i++) {
      const current = this.traces[i];
      const next = this.traces[i + 1];

      if (current.outputSnapshot && next.inputSnapshot) {
        const outputType = current.outputSnapshot.type;
        const inputType = next.inputSnapshot.type;

        if (outputType !== inputType) {
          analysis.typeConversionIssues.push({
            stepId: next.stepId,
            inputType: outputType,
            expectedType: inputType
          });
        }

        // Check for missing fields
        const outputFields = current.outputSnapshot.schema?.fields || [];
        const inputFields = next.inputSnapshot.schema?.fields || [];
        const missingFields = inputFields.filter(f => !outputFields.includes(f));

        if (missingFields.length > 0) {
          analysis.schemaMismatches.push({
            fromStep: current.stepId,
            toStep: next.stepId,
            expectedType: inputType,
            actualType: outputType,
            missingFields
          });
        }
      }
    }

    // Analyze scatter-gather issues
    const scatterTraces = this.traces.filter(t => t.stepType === 'scatter_gather');
    for (const trace of scatterTraces) {
      if (trace.variableFlow) {
        const { gatherFrom, gatherFromType, gatheredType } = trace.variableFlow;

        if (gatherFrom && !trace.variableFlow.createdVariables.some(v => v.name === gatherFrom)) {
          analysis.scatterGatherIssues.push({
            stepId: trace.stepId,
            issue: 'gather.from references non-existent variable',
            details: { gatherFrom, availableVars: trace.variableFlow.createdVariables.map(v => v.name) }
          });
        }

        if (gatherFromType && gatherFromType !== 'array') {
          analysis.scatterGatherIssues.push({
            stepId: trace.stepId,
            issue: 'gather.from is not array type',
            details: { gatherFrom, type: gatherFromType }
          });
        }
      }
    }

    return analysis;
  }

  /**
   * Get trace summary
   */
  getSummary(): {
    sessionId: string | null;
    totalSteps: number;
    failedSteps: number;
    totalTokens: number;
    totalTimeMs: number;
    traceSize: number;
  } {
    const totalTokens = this.traces.reduce((sum, t) => sum + (t.metrics?.tokensUsed || t.metrics?.totalTokens || 0), 0);
    const totalTimeMs = this.traces.reduce((sum, t) => sum + (t.metrics?.executionTimeMs || t.metrics?.totalTimeMs || 0), 0);

    return {
      sessionId: this.sessionId,
      totalSteps: this.traces.length,
      failedSteps: this.traces.filter(t => t.error).length,
      totalTokens,
      totalTimeMs,
      traceSize: JSON.stringify(this.traces).length
    };
  }

  /**
   * Clear all traces
   */
  clear(): void {
    this.traces = [];
    this.sessionId = null;
    logger.debug('ExecutionTracer cleared');
  }
}
