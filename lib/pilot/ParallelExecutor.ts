/**
 * ParallelExecutor - Execute multiple steps concurrently
 *
 * Responsibilities:
 * - Execute parallel groups of independent steps
 * - Execute loop iterations (sequential or parallel)
 * - Respect concurrency limits
 * - Aggregate results
 *
 * @module lib/orchestrator/ParallelExecutor
 */

import type {
  WorkflowStep,
  StepOutput,
  LoopStep,
  ScatterGatherStep,
} from './types';
import { ExecutionError } from './types';
import { ExecutionContext } from './ExecutionContext';
import { StepExecutor } from './StepExecutor';

export class ParallelExecutor {
  private stepExecutor: StepExecutor;
  private maxConcurrency: number;

  constructor(stepExecutor: StepExecutor, maxConcurrency: number = 3) {
    this.stepExecutor = stepExecutor;
    this.maxConcurrency = maxConcurrency;
  }

  /**
   * Execute parallel group of steps
   */
  async executeParallel(
    steps: WorkflowStep[],
    context: ExecutionContext
  ): Promise<Map<string, StepOutput>> {
    console.log(`[ParallelExecutor] Executing ${steps.length} steps in parallel (max concurrency: ${this.maxConcurrency})`);

    const results = new Map<string, StepOutput>();

    // Execute with concurrency limit
    const chunks = this.chunkArray(steps, this.maxConcurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(step =>
        this.stepExecutor.execute(step, context)
      );

      const chunkResults = await Promise.all(promises);

      chunkResults.forEach((result, index) => {
        results.set(chunk[index].id, result);
      });
    }

    console.log(`[ParallelExecutor] Completed parallel execution of ${steps.length} steps`);

    return results;
  }

  /**
   * Execute loop over array of items
   */
  async executeLoop(
    step: LoopStep,
    context: ExecutionContext
  ): Promise<any[]> {
    const { iterateOver, maxIterations = 100, loopSteps, parallel = false } = step;

    console.log(`[ParallelExecutor] Executing loop: ${step.name} (parallel: ${parallel})`);

    if (!iterateOver) {
      throw new ExecutionError(
        `Loop step ${step.id} missing iterateOver`,
        'MISSING_ITERATE_OVER',
        step.id
      );
    }

    if (!loopSteps || loopSteps.length === 0) {
      throw new ExecutionError(
        `Loop step ${step.id} missing loopSteps`,
        'MISSING_LOOP_STEPS',
        step.id
      );
    }

    // Resolve array to iterate over
    const items = context.resolveVariable(iterateOver);

    console.log(`[ParallelExecutor] Loop ${step.id}: iterateOver="${iterateOver}"`);
    console.log(`[ParallelExecutor] Resolved type: ${typeof items}, isArray: ${Array.isArray(items)}`);

    if (items !== undefined && items !== null) {
      const itemsStr = JSON.stringify(items);
      console.log(`[ParallelExecutor] Resolved to:`, itemsStr.substring(0, 200));
    } else {
      console.error(`[ParallelExecutor] ⚠️  iterateOver resolved to ${items === null ? 'null' : 'undefined'}`);
    }

    if (!Array.isArray(items)) {
      // Try to show the structure of what was resolved
      if (items && typeof items === 'object') {
        console.error(`[ParallelExecutor] Resolved object keys:`, Object.keys(items));
        const itemsStr = JSON.stringify(items, null, 2);
        console.error(`[ParallelExecutor] Resolved object structure:`, itemsStr.substring(0, 500));
      }

      throw new ExecutionError(
        `Loop step ${step.id}: iterateOver must resolve to an array, got ${typeof items}`,
        'INVALID_ITERATE_OVER',
        step.id
      );
    }

    const limitedItems = items.slice(0, maxIterations);

    console.log(`[ParallelExecutor] Looping over ${limitedItems.length} items (limited from ${items.length})`);

    if (parallel) {
      // Parallel execution with concurrency limit
      return await this.executeLoopParallel(limitedItems, loopSteps, step, context);
    } else {
      // Sequential execution
      return await this.executeLoopSequential(limitedItems, loopSteps, step, context);
    }
  }

  /**
   * Execute scatter-gather pattern
   * Phase 3: Advanced Parallel Patterns
   */
  async executeScatterGather(
    step: ScatterGatherStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`🎯 [ParallelExecutor] Executing scatter-gather: ${step.name}`);

    const { scatter, gather } = step;

    // Validate configuration
    if (!scatter || !scatter.input || !scatter.steps) {
      throw new ExecutionError(
        `Scatter-gather step ${step.id} missing scatter configuration`,
        'MISSING_SCATTER_CONFIG',
        step.id
      );
    }

    if (!gather || !gather.operation) {
      throw new ExecutionError(
        `Scatter-gather step ${step.id} missing gather configuration`,
        'MISSING_GATHER_CONFIG',
        step.id
      );
    }

    // Resolve input array
    const items = context.resolveVariable?.(scatter.input) ?? [];

    console.log(`🔍 [ParallelExecutor] Scatter input: ${scatter.input}`);
    const itemsStr = JSON.stringify(items || []);
    console.log(`🔍 [ParallelExecutor] Resolved to:`, itemsStr.substring(0, Math.min(200, itemsStr.length)));
    console.log(`🔍 [ParallelExecutor] Available variables:`, Object.keys(context.variables));

    if (!Array.isArray(items)) {
      throw new ExecutionError(
        `Scatter-gather step ${step.id}: input must resolve to an array, got ${typeof items}. Input: ${scatter.input}, Available variables: ${Object.keys(context.variables).join(', ')}`,
        'INVALID_SCATTER_INPUT',
        step.id
      );
    }

    console.log(`🎯 [ParallelExecutor] Scattering over ${items.length} items (max concurrency: ${scatter.maxConcurrency || this.maxConcurrency})`);

    // Scatter: Execute steps for each item in parallel
    const scatterResults = await this.executeScatter(
      items,
      scatter.steps,
      scatter.maxConcurrency || this.maxConcurrency,
      scatter.itemVariable || 'item',
      step,
      context
    );

    console.log(`🎯 [ParallelExecutor] Scatter complete, gathering ${scatterResults.length} results`);
    if (scatterResults.length > 0) {
      const sample = JSON.stringify(scatterResults[0] || {});
      console.log(`🔍 [ParallelExecutor] Scatter results sample:`, sample.substring(0, Math.min(300, sample.length)));
    }

    // Gather: Aggregate results based on operation
    const gatheredResult = this.gatherResults(scatterResults, gather.operation, gather.reduceExpression);

    console.log(`✅ [ParallelExecutor] Scatter-gather complete for ${step.id}`);
    const resultStr = JSON.stringify(gatheredResult || {});
    console.log(`🔍 [ParallelExecutor] Gathered result:`, resultStr.substring(0, Math.min(300, resultStr.length)));

    return gatheredResult;
  }

  /**
   * Execute scatter phase: run steps for each item in parallel
   */
  private async executeScatter(
    items: any[],
    steps: WorkflowStep[],
    maxConcurrency: number,
    itemVariable: string,
    scatterStep: ScatterGatherStep,
    parentContext: ExecutionContext
  ): Promise<any[]> {
    const results: any[] = [];

    // Execute items in chunks (respect concurrency limit)
    const chunks = this.chunkArray(items, maxConcurrency);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map((item, localIndex) => {
        const globalIndex = results.length + localIndex;
        return this.executeScatterItem(item, globalIndex, steps, itemVariable, scatterStep, parentContext);
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Execute steps for a single scatter item
   */
  private async executeScatterItem(
    item: any,
    index: number,
    steps: WorkflowStep[],
    itemVariable: string,
    scatterStep: ScatterGatherStep,
    parentContext: ExecutionContext
  ): Promise<any> {
    console.log(`🎯 [ParallelExecutor] Scatter item ${index + 1}`);

    // Create temporary context for this item
    const itemContext = parentContext.clone?.() ?? parentContext;
    itemContext.setVariable?.(itemVariable, item);
    itemContext.setVariable?.('index', index);

    const itemResults: any = {};

    try {
      // Execute steps for this item
      for (const step of steps) {
        const output = await this.stepExecutor.execute(step, itemContext);

        // Store output in item context
        itemContext.setStepOutput?.(step.id, output);

        // Collect result
        itemResults[step.id] = output.data;

        // If step failed, propagate error
        if (!output.metadata.success) {
          throw new ExecutionError(
            `Scatter item ${index} failed at step ${step.id}: ${output.metadata.error}`,
            'SCATTER_ITEM_FAILED',
            scatterStep.id,
            { item: index, failedStep: step.id, error: output.metadata.error }
          );
        }
      }

      return itemResults;
    } catch (error: any) {
      console.warn(`[ParallelExecutor] Scatter item ${index} failed: ${error.message}`);
      return {
        error: error.message,
        item: index,
      };
    }
  }

  /**
   * Gather results based on operation
   * Phase 3: Aggregation logic
   */
  private gatherResults(
    results: any[],
    operation: 'collect' | 'merge' | 'reduce',
    reduceExpression?: string
  ): any {
    console.log(`🎯 [ParallelExecutor] Gathering with operation: ${operation}`);

    switch (operation) {
      case 'collect':
        // Simply collect all results into an array
        return results;

      case 'merge':
        // Merge all objects into a single object
        return results.reduce((acc, result) => {
          if (typeof result === 'object' && !Array.isArray(result)) {
            return { ...acc, ...result };
          }
          return acc;
        }, {});

      case 'reduce':
        // Custom reduce operation (simplified for now)
        // In a full implementation, this would evaluate reduceExpression
        if (!reduceExpression) {
          // Default: sum if numbers, concatenate if arrays, merge if objects
          return results.reduce((acc, result) => {
            if (typeof result === 'number') {
              return (acc || 0) + result;
            } else if (Array.isArray(result)) {
              return (acc || []).concat(result);
            } else if (typeof result === 'object') {
              return { ...(acc || {}), ...result };
            }
            return result;
          }, undefined);
        }
        // TODO: Implement custom reduce expression evaluation
        return results;

      default:
        throw new ExecutionError(
          `Unknown gather operation: ${operation}`,
          'UNKNOWN_GATHER_OPERATION'
        );
    }
  }

  /**
   * Execute loop iterations in parallel
   */
  private async executeLoopParallel(
    items: any[],
    loopSteps: WorkflowStep[],
    loopStep: LoopStep,
    context: ExecutionContext
  ): Promise<any[]> {
    const results: any[] = [];

    // Execute iterations in chunks (respect concurrency limit)
    const chunks = this.chunkArray(items, this.maxConcurrency);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map((item, localIndex) => {
        const globalIndex = results.length + localIndex;
        return this.executeLoopIteration(item, globalIndex, loopSteps, loopStep, context);
      });

      const chunkResults = await Promise.all(chunkPromises);
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Execute loop iterations sequentially
   */
  private async executeLoopSequential(
    items: any[],
    loopSteps: WorkflowStep[],
    loopStep: LoopStep,
    context: ExecutionContext
  ): Promise<any[]> {
    const results: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = await this.executeLoopIteration(item, i, loopSteps, loopStep, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute single loop iteration
   */
  private async executeLoopIteration(
    item: any,
    index: number,
    loopSteps: WorkflowStep[],
    loopStep: LoopStep,
    parentContext: ExecutionContext
  ): Promise<any> {
    console.log(`[ParallelExecutor] Loop iteration ${index + 1}`);

    // Create temporary context for this iteration
    const loopContext = parentContext.clone();

    // Set loop variables with proper nested structure for {{loop.item.X}} and {{loop.index}} syntax
    loopContext.setVariable('loop', {
      item: item,
      index: index,
      iteration: index + 1  // 1-based for user display
    });

    // Backward compatibility: Also set 'current' and 'index' for old workflows
    loopContext.setVariable('current', item);
    loopContext.setVariable('index', index);

    const iterationResults: any = {};

    try {
      // Execute loop body steps
      for (const step of loopSteps) {
        const output = await this.stepExecutor.execute(step, loopContext);

        // Store output in iteration context
        loopContext.setStepOutput(step.id, output);

        // Collect result
        iterationResults[step.id] = output.data;

        // Propagate step output to parent context so subsequent steps can reference it
        // Store both the namespaced version (stepId_iterationN) and the latest version (stepId)
        const namespacedStepId = `${step.id}_iteration${index}`;
        parentContext.setStepOutput(namespacedStepId, output);
        parentContext.setStepOutput(step.id, output); // Latest iteration overwrites previous

        // If step failed and continueOnError is false, break
        if (!output.metadata.success && !loopStep.continueOnError) {
          throw new ExecutionError(
            `Loop iteration ${index} failed at step ${step.id}: ${output.metadata.error}`,
            'LOOP_ITERATION_FAILED',
            loopStep.id,
            { iteration: index, failedStep: step.id, error: output.metadata.error }
          );
        }
      }

      // Merge loop context back to parent (only variables, not step outputs)
      // This allows loop iterations to affect global variables if needed
      Object.entries(loopContext.variables).forEach(([key, value]) => {
        // Don't override parent variables with loop-specific ones
        if (key !== 'loop' && key !== 'current' && key !== 'index') {
          parentContext.setVariable(key, value);
        }
      });

      return iterationResults;
    } catch (error: any) {
      if (loopStep.continueOnError) {
        console.warn(`[ParallelExecutor] Loop iteration ${index} failed, continuing: ${error.message}`);
        return {
          error: error.message,
          iteration: index,
        };
      } else {
        throw error;
      }
    }
  }

  /**
   * Execute steps with Promise.allSettled (continues even if some fail)
   */
  async executeParallelSettled(
    steps: WorkflowStep[],
    context: ExecutionContext
  ): Promise<Map<string, StepOutput>> {
    console.log(`[ParallelExecutor] Executing ${steps.length} steps in parallel (allSettled mode)`);

    const results = new Map<string, StepOutput>();

    // Execute with concurrency limit
    const chunks = this.chunkArray(steps, this.maxConcurrency);

    for (const chunk of chunks) {
      const promises = chunk.map(step =>
        this.stepExecutor.execute(step, context)
      );

      const chunkResults = await Promise.allSettled(promises);

      chunkResults.forEach((result, index) => {
        const step = chunk[index];

        if (result.status === 'fulfilled') {
          results.set(step.id, result.value);
        } else {
          // Create error output
          results.set(step.id, {
            stepId: step.id,
            plugin: (step as any).plugin || 'system',
            action: (step as any).action || step.type,
            data: null,
            metadata: {
              success: false,
              executedAt: new Date().toISOString(),
              executionTime: 0,
              error: result.reason?.message || 'Unknown error',
            },
          });
        }
      });
    }

    return results;
  }

  /**
   * Chunk array for parallel execution with concurrency limit
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Set max concurrency
   */
  setMaxConcurrency(max: number): void {
    this.maxConcurrency = max;
  }

  /**
   * Get max concurrency
   */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * Execute steps in batches (for very large parallel groups)
   */
  async executeBatched(
    steps: WorkflowStep[],
    context: ExecutionContext,
    batchSize: number = 10
  ): Promise<Map<string, StepOutput>> {
    console.log(`[ParallelExecutor] Executing ${steps.length} steps in batches of ${batchSize}`);

    const results = new Map<string, StepOutput>();
    const batches = this.chunkArray(steps, batchSize);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`[ParallelExecutor] Processing batch ${i + 1}/${batches.length} (${batch.length} steps)`);

      const batchResults = await this.executeParallel(batch, context);

      batchResults.forEach((output, stepId) => {
        results.set(stepId, output);
      });

      // Optional: Add delay between batches to avoid overwhelming APIs
      if (i < batches.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Race execution (return as soon as one completes)
   */
  async executeRace(
    steps: WorkflowStep[],
    context: ExecutionContext
  ): Promise<{ stepId: string; output: StepOutput }> {
    console.log(`[ParallelExecutor] Racing ${steps.length} steps`);

    const promises = steps.map(async (step) => {
      const output = await this.stepExecutor.execute(step, context);
      return { stepId: step.id, output };
    });

    const result = await Promise.race(promises);

    console.log(`[ParallelExecutor] Race won by step ${result.stepId}`);

    return result;
  }

  /**
   * Execute with timeout
   */
  async executeWithTimeout(
    steps: WorkflowStep[],
    context: ExecutionContext,
    timeoutMs: number
  ): Promise<Map<string, StepOutput>> {
    console.log(`[ParallelExecutor] Executing ${steps.length} steps with ${timeoutMs}ms timeout`);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new ExecutionError(
          `Parallel execution timed out after ${timeoutMs}ms`,
          'PARALLEL_EXECUTION_TIMEOUT'
        ));
      }, timeoutMs);
    });

    const executionPromise = this.executeParallel(steps, context);

    return await Promise.race([executionPromise, timeoutPromise]);
  }
}
