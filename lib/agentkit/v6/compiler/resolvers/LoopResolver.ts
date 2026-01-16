/**
 * Loop Resolver
 *
 * Maps IR loops to PILOT_DSL scatter_gather steps.
 *
 * Responsibilities:
 * 1. Convert loop definitions to scatter_gather steps
 * 2. Handle partitioning and grouping for batch processing
 * 3. Manage concurrency and iteration limits
 */

import type { Loop, Partition, Grouping } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import { PluginResolver } from '../utils/PluginResolver'
import type { PluginManagerV2 } from '../../../../server/plugin-manager-v2'

// ============================================================================
// Loop Resolver
// ============================================================================

export class LoopResolver {
  private pluginResolver: PluginResolver

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginResolver = new PluginResolver(pluginManager)
  }
  /**
   * Resolve loops to scatter_gather steps
   */
  async resolveLoops(
    loops: Loop[],
    inputVariable: string,
    stepIdPrefix: string = 'loop'
  ): Promise<WorkflowStep[]> {
    if (!loops || loops.length === 0) {
      return []
    }

    console.log('[LoopResolver] Resolving', loops.length, 'loop(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < loops.length; i++) {
      const loop = loops[i]
      console.log(`[LoopResolver] Processing loop ${i + 1}: iterate over ${loop.for_each}`)

      const step = this.createScatterGatherStep(loop, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)
    }

    console.log('[LoopResolver] ✓ Resolved', steps.length, 'scatter_gather step(s)')
    return steps
  }

  /**
   * Resolve partitions to partition steps
   */
  async resolvePartitions(
    partitions: Partition[],
    inputVariable: string,
    stepIdPrefix: string = 'partition'
  ): Promise<WorkflowStep[]> {
    if (!partitions || partitions.length === 0) {
      return []
    }

    console.log('[LoopResolver] Resolving', partitions.length, 'partition(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < partitions.length; i++) {
      const partition = partitions[i]
      console.log(`[LoopResolver] Processing partition ${i + 1}: split by ${partition.field}`)

      const step = this.createPartitionStep(partition, inputVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)

      // Update input for next partition
      inputVariable = step.output_variable!
    }

    console.log('[LoopResolver] ✓ Resolved', steps.length, 'partition step(s)')
    return steps
  }

  /**
   * Resolve grouping to transform step
   */
  async resolveGrouping(
    grouping: Grouping | undefined,
    inputVariable: string,
    stepId: string = 'group'
  ): Promise<WorkflowStep | null> {
    if (!grouping) {
      return null
    }

    console.log('[LoopResolver] Resolving grouping by', grouping.group_by)

    return {
      step_id: stepId,
      type: 'transform',
      operation: 'group',
      config: {
        input: `{{${inputVariable}}}`,
        group_by: grouping.group_by,
        emit_per_group: grouping.emit_per_group
      },
      output_variable: `${stepId}_output`,
      description: `Group by ${grouping.group_by}${grouping.emit_per_group ? ' (emit per group)' : ''}`
    }
  }

  /**
   * Create scatter_gather step from loop
   */
  private createScatterGatherStep(loop: Loop, stepId: string): WorkflowStep {
    const forEachSource = this.extractVariableName(loop.for_each)

    return {
      id: stepId,
      step_id: stepId,
      name: `Loop over ${loop.item_variable}`,
      type: 'scatter_gather',
      operation: 'parallel_process',
      config: {
        input: `{{${forEachSource}}}`,
        item_variable: loop.item_variable,
        actions: this.convertIntentActionsToSteps(loop.do),
        max_iterations: loop.max_iterations || 1000,
        max_concurrency: loop.max_concurrency || 10
      },
      output_variable: `${stepId}_output`,
      description: `Process each ${loop.item_variable} in parallel`
    }
  }

  /**
   * Create partition step
   */
  private createPartitionStep(
    partition: Partition,
    inputVariable: string,
    stepId: string
  ): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'partition',
      config: {
        input: `{{${inputVariable}}}`,
        partition_by: partition.field,
        split_strategy: partition.split_by,
        condition: partition.condition,
        handle_empty: partition.handle_empty
      },
      output_variable: `${stepId}_output`,
      description: `Partition by ${partition.field}`
    }
  }

  /**
   * Convert intent action IDs to placeholder workflow steps
   * These are references to AI operations or other actions that will be resolved by the compiler
   */
  private convertIntentActionsToSteps(intentActions: any[]): any[] {
    // These are typically just ID references (e.g., ['ai_extract', 'ai_classify'])
    // The actual AI operation definitions will be passed to scatter_gather config
    // For now, we return placeholders that indicate which operations to perform
    return intentActions.map((actionId, i) => {
      // If it's a string, it's likely an ID reference
      if (typeof actionId === 'string') {
        return {
          step_id: `nested_${actionId}`,
          type: 'action',
          plugin: 'workflow',  // Generic placeholder for action reference resolution
          action: 'process_item',  // Use 'action' for PILOT executor compatibility
          config: {
            action_ref: actionId
          }
        }
      }

      // If it's already an object, handle different types
      if (actionId.type === 'delivery') {
        return {
          step_id: `nested_delivery_${i + 1}`,
          type: 'action',
          plugin: this.getDeliveryPlugin(actionId.config?.method || actionId.method),
          action: 'send',  // Use 'action' for PILOT executor compatibility
          config: actionId.config?.config || actionId.config
        }
      }

      if (actionId.type === 'ai_operation') {
        return {
          step_id: `nested_ai_${i + 1}`,
          type: 'ai_processing',
          operation: actionId.config?.type || actionId.type,
          config: {
            instruction: actionId.config?.instruction || actionId.instruction,
            input_source: actionId.config?.input_source || actionId.input_source,
            output_schema: actionId.config?.output_schema || actionId.output_schema
          }
        }
      }

      if (actionId.type === 'transform') {
        return {
          step_id: `nested_transform_${i + 1}`,
          type: 'transform',
          operation: actionId.config?.operation || actionId.operation,
          config: actionId.config?.config || actionId.config
        }
      }

      if (actionId.type === 'filter') {
        return {
          step_id: `nested_filter_${i + 1}`,
          type: 'transform',
          operation: 'filter',
          config: {
            condition: {
              field: actionId.config?.field || actionId.field,
              operator: actionId.config?.operator || actionId.operator,
              value: actionId.config?.value || actionId.value
            }
          }
        }
      }

      return actionId
    })
  }

  /**
   * Get plugin for delivery method (schema-driven)
   * Uses PluginResolver to find plugins by capability instead of hardcoded mapping
   */
  private getDeliveryPlugin(method: string): string {
    return this.pluginResolver.resolveDeliveryMethodToPlugin(method)
  }

  /**
   * Extract variable name from {{variable}} syntax
   */
  private extractVariableName(source: string): string {
    const match = source.match(/\{\{([^}]+)\}\}/)
    return match ? match[1] : source
  }

  /**
   * Combine partition + grouping + scatter_gather for batch processing
   */
  async resolveBatchProcessing(
    partition: Partition | undefined,
    grouping: Grouping | undefined,
    loop: Loop | undefined,
    inputVariable: string,
    stepIdPrefix: string = 'batch'
  ): Promise<WorkflowStep[]> {
    console.log('[LoopResolver] Resolving batch processing pattern...')

    const steps: WorkflowStep[] = []
    let currentVariable = inputVariable

    // Step 1: Partition
    if (partition) {
      const partitionSteps = await this.resolvePartitions([partition], currentVariable, `${stepIdPrefix}_partition`)
      steps.push(...partitionSteps)
      currentVariable = partitionSteps[partitionSteps.length - 1]?.output_variable || currentVariable
    }

    // Step 2: Grouping
    if (grouping) {
      const groupStep = await this.resolveGrouping(grouping, currentVariable, `${stepIdPrefix}_group`)
      if (groupStep) {
        steps.push(groupStep)
        currentVariable = groupStep.output_variable!
      }
    }

    // Step 3: Loop/Scatter-Gather
    if (loop) {
      const loopSteps = await this.resolveLoops([loop], currentVariable, `${stepIdPrefix}_scatter`)
      steps.push(...loopSteps)
    }

    console.log('[LoopResolver] ✓ Batch processing resolved:', steps.length, 'steps')
    return steps
  }

  /**
   * Get final output variable after all loop operations
   */
  getFinalOutputVariable(
    initialVariable: string,
    partitions: Partition[] = [],
    grouping: Grouping | undefined,
    loops: Loop[] = [],
    stepIdPrefix: string = 'loop'
  ): string {
    let currentVariable = initialVariable

    // After partitions
    if (partitions && partitions.length > 0) {
      currentVariable = `${stepIdPrefix}_partition_${partitions.length}_output`
    }

    // After grouping
    if (grouping) {
      currentVariable = `${stepIdPrefix}_group_output`
    }

    // After loops
    if (loops && loops.length > 0) {
      currentVariable = `${stepIdPrefix}_scatter_${loops.length}_output`
    }

    return currentVariable
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a loop resolver
 */
export function createLoopResolver(pluginManager?: PluginManagerV2): LoopResolver {
  return new LoopResolver(pluginManager)
}

/**
 * Quick resolve loops
 */
export async function resolveLoops(loops: Loop[], inputVariable: string, pluginManager?: PluginManagerV2): Promise<WorkflowStep[]> {
  const resolver = new LoopResolver(pluginManager)
  return await resolver.resolveLoops(loops, inputVariable)
}

/**
 * Quick resolve partitions
 */
export async function resolvePartitions(partitions: Partition[], inputVariable: string, pluginManager?: PluginManagerV2): Promise<WorkflowStep[]> {
  const resolver = new LoopResolver(pluginManager)
  return await resolver.resolvePartitions(partitions, inputVariable)
}
