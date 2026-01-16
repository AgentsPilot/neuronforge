/**
 * Transform Resolver
 *
 * Maps IR filters and transforms to PILOT_DSL transform steps.
 *
 * Responsibilities:
 * 1. Convert filters to transform steps with filter operations
 * 2. Convert transforms to transform steps with appropriate operations
 * 3. Generate deterministic, testable transform logic
 */

import type { Filter, Transform, TransformOperation } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'

// ============================================================================
// Transform Resolver
// ============================================================================

export class TransformResolver {
  /**
   * Resolve filters to transform steps
   */
  async resolveFilters(filters: Filter[], inputVariable: string, stepIdPrefix: string = 'filter'): Promise<WorkflowStep[]> {
    if (!filters || filters.length === 0) {
      return []
    }

    console.log('[TransformResolver] Resolving', filters.length, 'filter(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i]
      console.log(`[TransformResolver] Processing filter ${i + 1}:`, filter.field, filter.operator)

      const step = this.createFilterStep(filter, inputVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)

      // Update input variable for next filter
      inputVariable = step.output_variable!
    }

    console.log('[TransformResolver] ✓ Resolved', steps.length, 'filter step(s)')
    return steps
  }

  /**
   * Resolve transforms to transform steps
   */
  async resolveTransforms(transforms: Transform[], inputVariable: string, stepIdPrefix: string = 'transform'): Promise<WorkflowStep[]> {
    if (!transforms || transforms.length === 0) {
      return []
    }

    console.log('[TransformResolver] Resolving', transforms.length, 'transform(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < transforms.length; i++) {
      const transform = transforms[i]
      console.log(`[TransformResolver] Processing transform ${i + 1}:`, transform.operation)

      const step = this.createTransformStep(transform, inputVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)

      // Update input variable for next transform
      inputVariable = step.output_variable!
    }

    console.log('[TransformResolver] ✓ Resolved', steps.length, 'transform step(s)')
    return steps
  }

  /**
   * Create a filter step
   */
  private createFilterStep(filter: Filter, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'filter',
      config: {
        input: `{{${inputVariable}}}`,
        condition: {
          field: filter.field,
          operator: this.mapFilterOperator(filter.operator),
          value: filter.value
        }
      },
      output_variable: `${stepId}_output`,
      description: filter.description || `Filter: ${filter.field} ${filter.operator} ${filter.value}`
    }
  }

  /**
   * Create a transform step
   */
  private createTransformStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    const operation = transform.operation

    switch (operation) {
      case 'sort':
        return this.createSortStep(transform, inputVariable, stepId)
      case 'group':
        return this.createGroupStep(transform, inputVariable, stepId)
      case 'aggregate':
        return this.createAggregateStep(transform, inputVariable, stepId)
      case 'map':
        return this.createMapStep(transform, inputVariable, stepId)
      case 'reduce':
        return this.createReduceStep(transform, inputVariable, stepId)
      case 'join':
        return this.createJoinStep(transform, inputVariable, stepId)
      case 'deduplicate':
        return this.createDeduplicateStep(transform, inputVariable, stepId)
      case 'flatten':
        return this.createFlattenStep(transform, inputVariable, stepId)
      case 'filter':
        return this.createFilterTransformStep(transform, inputVariable, stepId)
      default:
        throw new Error(`Unsupported transform operation: ${operation}`)
    }
  }

  /**
   * Map filter operators to PILOT_DSL operators
   */
  private mapFilterOperator(operator: string): string {
    const operatorMap: Record<string, string> = {
      equals: '==',
      not_equals: '!=',
      contains: 'contains',
      not_contains: 'not_contains',
      greater_than: '>',
      less_than: '<',
      greater_than_or_equal: '>=',
      less_than_or_equal: '<=',
      in: 'in',
      not_in: 'not_in',
      is_empty: 'is_empty',
      is_not_empty: 'is_not_empty'
    }

    return operatorMap[operator] || operator
  }

  /**
   * Create sort step
   */
  private createSortStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'sort',
      config: {
        input: `{{${inputVariable}}}`,
        sort_by: transform.config.sort_by || transform.config.field,
        order: transform.config.order || 'asc'
      },
      output_variable: `${stepId}_output`,
      description: `Sort by ${transform.config.sort_by || transform.config.field} ${transform.config.order || 'asc'}`
    }
  }

  /**
   * Create group step
   */
  private createGroupStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'group',
      config: {
        input: `{{${inputVariable}}}`,
        group_by: transform.config.group_by || transform.config.field
      },
      output_variable: `${stepId}_output`,
      description: `Group by ${transform.config.group_by || transform.config.field}`
    }
  }

  /**
   * Create aggregate step
   */
  private createAggregateStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'aggregate',
      config: {
        input: `{{${inputVariable}}}`,
        aggregation: transform.config.aggregation || 'count',
        field: transform.config.field,
        group_by: transform.config.group_by
      },
      output_variable: `${stepId}_output`,
      description: `Aggregate: ${transform.config.aggregation || 'count'} of ${transform.config.field || 'all'}`
    }
  }

  /**
   * Create map step
   */
  private createMapStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'map',
      config: {
        input: `{{${inputVariable}}}`,
        mapping: transform.config.mapping,
        field: transform.config.field
      },
      output_variable: `${stepId}_output`,
      description: `Transform each item`
    }
  }

  /**
   * Create reduce step
   */
  private createReduceStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'reduce',
      config: {
        input: `{{${inputVariable}}}`,
        aggregation: transform.config.aggregation || 'sum',
        field: transform.config.field
      },
      output_variable: `${stepId}_output`,
      description: `Reduce to single value: ${transform.config.aggregation || 'sum'}`
    }
  }

  /**
   * Create join step
   */
  private createJoinStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'join',
      config: {
        input: `{{${inputVariable}}}`,
        join_source: transform.config.source,
        join_key: transform.config.join_key
      },
      output_variable: `${stepId}_output`,
      description: `Join with ${transform.config.source} on ${transform.config.join_key}`
    }
  }

  /**
   * Create deduplicate step
   */
  private createDeduplicateStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'deduplicate',
      config: {
        input: `{{${inputVariable}}}`,
        field: transform.config.field
      },
      output_variable: `${stepId}_output`,
      description: `Remove duplicates${transform.config.field ? ` by ${transform.config.field}` : ''}`
    }
  }

  /**
   * Create flatten step
   */
  private createFlattenStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'flatten',
      config: {
        input: `{{${inputVariable}}}`,
        field: transform.config.field
      },
      output_variable: `${stepId}_output`,
      description: `Flatten nested arrays`
    }
  }

  /**
   * Create filter transform step (different from filter via resolveFilters)
   */
  private createFilterTransformStep(transform: Transform, inputVariable: string, stepId: string): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'filter',
      config: {
        input: `{{${inputVariable}}}`,
        condition: transform.config.condition
      },
      output_variable: `${stepId}_output`,
      description: `Filter data`
    }
  }

  /**
   * Get the final output variable after all transforms
   */
  getFinalOutputVariable(
    initialVariable: string,
    filters: Filter[] = [],
    transforms: Transform[] = [],
    filterPrefix: string = 'filter',
    transformPrefix: string = 'transform'
  ): string {
    let currentVariable = initialVariable

    // After filters
    if (filters && filters.length > 0) {
      currentVariable = `${filterPrefix}_${filters.length}_output`
    }

    // After transforms
    if (transforms && transforms.length > 0) {
      currentVariable = `${transformPrefix}_${transforms.length}_output`
    }

    return currentVariable
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a transform resolver
 */
export function createTransformResolver(): TransformResolver {
  return new TransformResolver()
}

/**
 * Quick resolve filters
 */
export async function resolveFilters(filters: Filter[], inputVariable: string): Promise<WorkflowStep[]> {
  const resolver = new TransformResolver()
  return await resolver.resolveFilters(filters, inputVariable)
}

/**
 * Quick resolve transforms
 */
export async function resolveTransforms(transforms: Transform[], inputVariable: string): Promise<WorkflowStep[]> {
  const resolver = new TransformResolver()
  return await resolver.resolveTransforms(transforms, inputVariable)
}
