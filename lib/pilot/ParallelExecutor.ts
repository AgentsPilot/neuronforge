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
import { schemaExtractor } from './utils/SchemaAwareDataExtractor';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ParallelExecutor', service: 'workflow-pilot' });

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
    logger.info({ stepCount: steps.length, maxConcurrency: this.maxConcurrency }, 'Executing steps in parallel');

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

    logger.info({ stepCount: steps.length }, 'Completed parallel execution');

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

    logger.info({ stepName: step.name, parallel }, 'Executing loop');

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

    logger.debug({ stepId: step.id, iterateOver, resolvedType: typeof items, isArray: Array.isArray(items) }, 'Loop variable resolved');

    if (items !== undefined && items !== null) {
      const itemsStr = JSON.stringify(items);
      logger.debug({ preview: itemsStr.substring(0, 200) }, 'Resolved items');
    } else {
      logger.warn({ stepId: step.id, iterateOver, value: items === null ? 'null' : 'undefined' }, 'iterateOver resolved to empty');
    }

    if (!Array.isArray(items)) {
      // Try to show the structure of what was resolved
      if (items && typeof items === 'object') {
        const itemsStr = JSON.stringify(items, null, 2);
        logger.error({ keys: Object.keys(items), structure: itemsStr.substring(0, 500) }, 'iterateOver resolved to object instead of array');
      }

      throw new ExecutionError(
        `Loop step ${step.id}: iterateOver must resolve to an array, got ${typeof items}`,
        'INVALID_ITERATE_OVER',
        step.id
      );
    }

    const limitedItems = items.slice(0, maxIterations);

    logger.info({ loopCount: limitedItems.length, originalCount: items.length, maxIterations }, 'Looping over items');

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
    logger.info({ stepName: step.name }, 'Executing scatter-gather');

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
    let items = context.resolveVariable?.(scatter.input) ?? [];

    const itemsStr = JSON.stringify(items || []);
    logger.debug({ input: scatter.input, preview: itemsStr.substring(0, 200), availableVars: Object.keys(context.variables) }, 'Scatter input resolved');

    // Handle case where variable resolves to a StepOutput object instead of direct array
    // This happens when using {{stepX}} instead of {{stepX.data.field}}
    if (items && typeof items === 'object' && !Array.isArray(items)) {
      // Check if it's a StepOutput structure: {stepId, plugin, action, data, metadata}
      if (items.stepId && items.data !== undefined) {
        logger.debug('Detected StepOutput object, extracting data field');
        const data = items.data;

        // Case 1: data is already an array (common for collect/reduce operations)
        if (Array.isArray(data)) {
          logger.debug({ itemCount: data.length }, 'StepOutput.data is an array - using directly');
          items = data;
        }
        // Case 2: data is an object - use SchemaAwareDataExtractor
        else if (data && typeof data === 'object') {
          // Use schema-driven extraction instead of hardcoded field name lists
          const sourcePlugin = (data as any)._sourcePlugin;
          const sourceAction = (data as any)._sourceAction;

          const extractedArray = await schemaExtractor.extractArray(data, sourcePlugin, sourceAction);

          if (extractedArray.length > 0 || Array.isArray(extractedArray)) {
            logger.debug({ itemCount: extractedArray.length, sourcePlugin: sourcePlugin || 'unknown' }, 'Schema-aware extraction complete');
            items = extractedArray;
          } else {
            // No array fields found
            logger.error({ availableFields: Object.keys(data) }, 'StepOutput.data has no array fields');
            throw new ExecutionError(
              `Scatter-gather step ${step.id}: input resolved to StepOutput with non-array data. Data is an object with fields: ${Object.keys(data).join(', ')}. Consider using {{${scatter.input.replace(/[{}]/g, '')}.data.FIELD}} to select a specific array field.`,
              step.id,
              { errorCode: 'INVALID_SCATTER_INPUT', availableFields: Object.keys(data), dataType: Array.isArray(data) ? 'array' : typeof data }
            );
          }
        }
        // Case 3: data is a primitive or null
        else {
          throw new ExecutionError(
            `Scatter-gather step ${step.id}: input resolved to StepOutput with non-object data (type: ${typeof data}). Expected an array or object with array fields.`,
            step.id,
            { errorCode: 'INVALID_SCATTER_INPUT', dataType: typeof data }
          );
        }
      }
    }

    if (!Array.isArray(items)) {
      throw new ExecutionError(
        `Scatter-gather step ${step.id}: input must resolve to an array, got ${typeof items}. Input: ${scatter.input}, Available variables: ${Object.keys(context.variables).join(', ')}`,
        step.id,
        { errorCode: 'INVALID_SCATTER_INPUT', input: scatter.input, availableVariables: Object.keys(context.variables) }
      );
    }

    logger.info({ itemCount: items.length, maxConcurrency: scatter.maxConcurrency || this.maxConcurrency }, 'Scattering over items');

    // Scatter: Execute steps for each item in parallel
    const scatterResults = await this.executeScatter(
      items,
      scatter.steps,
      scatter.maxConcurrency || this.maxConcurrency,
      scatter.itemVariable || 'item',
      step,
      context
    );

    logger.info({ resultCount: scatterResults.length }, 'Scatter complete, gathering results');
    if (scatterResults.length > 0) {
      const sample = JSON.stringify(scatterResults[0] || {});
      logger.debug({ sampleResult: sample.substring(0, 300) }, 'Scatter results sample');
    }

    // Gather: Aggregate results based on operation
    const gatheredResult = this.gatherResults(scatterResults, gather.operation, gather.reduceExpression);

    const resultStr = JSON.stringify(gatheredResult || {});
    logger.info({ stepId: step.id, resultPreview: resultStr.substring(0, 300) }, 'Scatter-gather complete');

    return gatheredResult;
  }

  /**
   * Execute scatter phase: run steps for each item in parallel
   *
   * Returns results and aggregates token/time metrics back to parent context
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
    let totalTokensFromScatter = 0;
    let totalTimeFromScatter = 0;

    // Execute items in chunks (respect concurrency limit)
    const chunks = this.chunkArray(items, maxConcurrency);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map((item, localIndex) => {
        const globalIndex = results.length + localIndex;
        return this.executeScatterItem(item, globalIndex, steps, itemVariable, scatterStep, parentContext);
      });

      const chunkResults = await Promise.all(chunkPromises);

      // Extract results and accumulate metrics
      for (const { result, tokensUsed, executionTime } of chunkResults) {
        results.push(result);
        totalTokensFromScatter += tokensUsed;
        totalTimeFromScatter += executionTime;
      }
    }

    // Merge accumulated metrics back to parent context
    // This ensures tokens from parallel execution are not lost
    if (parentContext.totalTokensUsed !== undefined) {
      parentContext.totalTokensUsed += totalTokensFromScatter;
    }
    if (parentContext.totalExecutionTime !== undefined) {
      parentContext.totalExecutionTime += totalTimeFromScatter;
    }

    logger.debug({ totalTokens: totalTokensFromScatter, totalTimeMs: totalTimeFromScatter, itemCount: items.length }, 'Scatter metrics');

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
  ): Promise<{ result: any; tokensUsed: number; executionTime: number }> {
    logger.debug({ itemIndex: index + 1 }, 'Processing scatter item');

    // Create temporary context for this item with reset metrics
    // This ensures each cloned context starts with 0 tokens/time
    // so we can accurately track and merge back to parent
    const itemContext = parentContext.clone?.(true) ?? parentContext;
    itemContext.setVariable?.(itemVariable, item);
    itemContext.setVariable?.('index', index);

    const itemResults: any = {};

    try {
      // Execute steps for this item
      for (const step of steps) {
        const output = await this.stepExecutor.execute(step, itemContext);

        // Store output in item context
        itemContext.setStepOutput?.(step.id, output);

        // Register output_variable if specified (allows referencing by name instead of step ID)
        // This mirrors the behavior in WorkflowPilot for consistency within scatter loops
        const outputVariable = (step as any).output_variable;
        if (outputVariable && itemContext.setVariable) {
          itemContext.setVariable(outputVariable, output.data);
          logger.debug({ stepId: step.id, outputVariable }, 'Registered output variable in scatter context');
        }

        // Collect result
        itemResults[step.id] = output.data;

        // If step failed, propagate error
        if (!output.metadata.success) {
          throw new ExecutionError(
            `Scatter item ${index} failed at step ${step.id}: ${output.metadata.error}`,
            scatterStep.id,
            { item: index, failedStep: step.id, error: output.metadata.error, errorCode: 'SCATTER_ITEM_FAILED' }
          );
        }
      }

      // ✅ FIX: Merge original item fields with step results (flattened)
      // The V6 compiler assumes scatter-gather produces merged objects:
      // original item fields (from, subject, body, etc.) + AI output fields (is_action_required, cta, etc.)
      // Without this merge, transform steps can't access both original and AI-extracted fields
      let mergedResult: any;

      // Check if we have step results to merge
      const stepResultKeys = Object.keys(itemResults);
      if (stepResultKeys.length === 1) {
        // Single step: Merge original item with step output data
        // e.g., item = { from, subject, body }, stepResults = { step2: { is_action_required, cta } }
        // Merged = { from, subject, body, is_action_required, cta }
        const stepKey = stepResultKeys[0];
        const stepData = itemResults[stepKey];

        if (typeof item === 'object' && item !== null && typeof stepData === 'object' && stepData !== null && !Array.isArray(stepData)) {
          mergedResult = { ...item, ...stepData };
          logger.debug({
            originalFields: Object.keys(item).slice(0, 5),
            stepFields: Object.keys(stepData).slice(0, 5),
            mergedFields: Object.keys(mergedResult).slice(0, 10)
          }, 'Merged original item with step result');
        } else {
          // Step data is not an object, keep structure as-is
          mergedResult = itemResults;
        }
      } else if (stepResultKeys.length > 1) {
        // Multiple steps: Flatten all step results into original item
        mergedResult = { ...item };
        for (const stepKey of stepResultKeys) {
          const stepData = itemResults[stepKey];
          if (typeof stepData === 'object' && stepData !== null && !Array.isArray(stepData)) {
            mergedResult = { ...mergedResult, ...stepData };
          }
        }
        logger.debug({ stepCount: stepResultKeys.length, mergedFields: Object.keys(mergedResult).slice(0, 10) }, 'Merged original item with multiple step results');
      } else {
        // No step results, return original item
        mergedResult = item;
      }

      return {
        result: mergedResult,
        tokensUsed: itemContext.totalTokensUsed ?? 0,
        executionTime: itemContext.totalExecutionTime ?? 0,
      };
    } catch (error: any) {
      logger.warn({ itemIndex: index, error: error.message }, 'Scatter item failed');
      return {
        result: {
          error: error.message,
          item: index,
        },
        tokensUsed: itemContext.totalTokensUsed ?? 0,
        executionTime: itemContext.totalExecutionTime ?? 0,
      };
    }
  }

  /**
   * Gather results based on operation
   * Phase 3: Aggregation logic
   */
  private gatherResults(
    results: any[],
    operation: 'collect' | 'merge' | 'reduce' | 'flatten',
    reduceExpression?: string
  ): any {
    logger.debug({ operation }, 'Gathering with operation');

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

      case 'flatten':
        // Flatten nested arrays into a single array
        // Similar to Array.flat() but handles arbitrary nesting
        const flatten = (arr: any[]): any[] => {
          return arr.reduce((acc, val) => {
            if (Array.isArray(val)) {
              return acc.concat(flatten(val));
            }
            return acc.concat(val);
          }, []);
        };
        return flatten(results);

      default:
        throw new ExecutionError(
          `Unknown gather operation: ${operation}`,
          'UNKNOWN_GATHER_OPERATION'
        );
    }
  }

  /**
   * Execute loop iterations in parallel
   *
   * Wave 8 Fix: Track and merge tokens from loop iterations
   */
  private async executeLoopParallel(
    items: any[],
    loopSteps: WorkflowStep[],
    loopStep: LoopStep,
    context: ExecutionContext
  ): Promise<any[]> {
    const results: any[] = [];
    let totalTokensFromLoop = 0;
    let totalTimeFromLoop = 0;

    // Execute iterations in chunks (respect concurrency limit)
    const chunks = this.chunkArray(items, this.maxConcurrency);

    for (const chunk of chunks) {
      const chunkPromises = chunk.map((item, localIndex) => {
        const globalIndex = results.length + localIndex;
        return this.executeLoopIteration(item, globalIndex, loopSteps, loopStep, context);
      });

      const chunkResults = await Promise.all(chunkPromises);

      // Extract results and accumulate metrics
      for (const { result, tokensUsed, executionTime } of chunkResults) {
        results.push(result);
        totalTokensFromLoop += tokensUsed;
        totalTimeFromLoop += executionTime;
      }
    }

    // Merge accumulated metrics back to parent context
    if (context.totalTokensUsed !== undefined) {
      context.totalTokensUsed += totalTokensFromLoop;
    }
    if (context.totalExecutionTime !== undefined) {
      context.totalExecutionTime += totalTimeFromLoop;
    }

    logger.debug({ totalTokens: totalTokensFromLoop, totalTimeMs: totalTimeFromLoop, itemCount: items.length }, 'Loop parallel metrics');

    return results;
  }

  /**
   * Execute loop iterations sequentially
   *
   * Wave 8 Fix: Track and merge tokens from loop iterations
   */
  private async executeLoopSequential(
    items: any[],
    loopSteps: WorkflowStep[],
    loopStep: LoopStep,
    context: ExecutionContext
  ): Promise<any[]> {
    const results: any[] = [];
    let totalTokensFromLoop = 0;
    let totalTimeFromLoop = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const { result, tokensUsed, executionTime } = await this.executeLoopIteration(item, i, loopSteps, loopStep, context);
      results.push(result);
      totalTokensFromLoop += tokensUsed;
      totalTimeFromLoop += executionTime;
    }

    // Merge accumulated metrics back to parent context
    if (context.totalTokensUsed !== undefined) {
      context.totalTokensUsed += totalTokensFromLoop;
    }
    if (context.totalExecutionTime !== undefined) {
      context.totalExecutionTime += totalTimeFromLoop;
    }

    logger.debug({ totalTokens: totalTokensFromLoop, totalTimeMs: totalTimeFromLoop, itemCount: items.length }, 'Loop sequential metrics');

    return results;
  }

  /**
   * Execute single loop iteration
   *
   * Wave 8 Fix: Returns token metrics for proper tracking
   */
  private async executeLoopIteration(
    item: any,
    index: number,
    loopSteps: WorkflowStep[],
    loopStep: LoopStep,
    parentContext: ExecutionContext
  ): Promise<{ result: any; tokensUsed: number; executionTime: number }> {
    logger.debug({ iteration: index + 1 }, 'Processing loop iteration');

    // Create temporary context for this iteration with reset metrics
    // This ensures each cloned context starts with 0 tokens/time
    // so we can accurately track and merge back to parent
    const loopContext = parentContext.clone?.(true) ?? parentContext;

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
            loopStep.id,
            { iteration: index, failedStep: step.id, error: output.metadata.error, errorCode: 'LOOP_ITERATION_FAILED' }
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

      return {
        result: iterationResults,
        tokensUsed: loopContext.totalTokensUsed ?? 0,
        executionTime: loopContext.totalExecutionTime ?? 0,
      };
    } catch (error: any) {
      if (loopStep.continueOnError) {
        logger.warn({ iteration: index, error: error.message }, 'Loop iteration failed, continuing');
        return {
          result: {
            error: error.message,
            iteration: index,
          },
          tokensUsed: loopContext.totalTokensUsed ?? 0,
          executionTime: loopContext.totalExecutionTime ?? 0,
        };
      } else {
        throw error;
      }
    }
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
}
