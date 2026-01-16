/**
 * Filter Resolver
 *
 * Maps IR filters to PILOT_DSL transform steps with filter operations.
 *
 * Responsibilities:
 * 1. Convert filter definitions to transform steps
 * 2. Handle different filter operators (equals, contains, gt, lt, etc.)
 * 3. Support complex filter conditions (and/or/not)
 */

import type { Filter } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'

// ============================================================================
// Filter Resolver
// ============================================================================

export class FilterResolver {
  /**
   * Resolve filters to transform steps
   */
  async resolve(
    filters: Filter[],
    inputVariable: string,
    stepIdPrefix: string = 'filter'
  ): Promise<WorkflowStep[]> {
    if (!filters || filters.length === 0) {
      return []
    }

    console.log('[FilterResolver] Resolving', filters.length, 'filter(s)...')

    const steps: WorkflowStep[] = []
    let currentVariable = inputVariable

    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i]
      console.log(`[FilterResolver] Processing filter ${i + 1}: ${filter.field} ${filter.operator} ${filter.value}`)

      const step = this.createFilterStep(filter, currentVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)
      currentVariable = step.output_variable!
    }

    console.log('[FilterResolver] ✓ Resolved', steps.length, 'filter step(s)')
    return steps
  }

  /**
   * Create a filter step
   */
  private createFilterStep(
    filter: Filter,
    inputVariable: string,
    stepId: string
  ): WorkflowStep {
    return {
      step_id: stepId,
      type: 'transform',
      operation: 'filter',
      config: {
        input: `{{${inputVariable}}}`,
        condition: this.buildCondition(filter)
      },
      output_variable: `${stepId}_output`,
      description: filter.description || `Filter: ${filter.field} ${filter.operator} ${filter.value}`
    }
  }

  /**
   * Build condition object from filter
   */
  private buildCondition(filter: Filter): any {
    // Simple condition
    if (filter.field && filter.operator && filter.value !== undefined) {
      return {
        field: filter.field,
        operator: this.normalizeOperator(filter.operator),
        value: filter.value
      }
    }

    // If filter has complex structure, return as-is
    return filter
  }

  /**
   * Normalize filter operators to standard format
   */
  private normalizeOperator(operator: string): string {
    const operatorMap: Record<string, string> = {
      // Equality
      'equals': '==',
      'eq': '==',
      '=': '==',
      'is': '==',

      // Inequality
      'not_equals': '!=',
      'neq': '!=',
      'ne': '!=',
      'is_not': '!=',

      // Comparison
      'greater_than': '>',
      'gt': '>',
      'less_than': '<',
      'lt': '<',
      'greater_than_or_equal': '>=',
      'gte': '>=',
      'ge': '>=',
      'less_than_or_equal': '<=',
      'lte': '<=',
      'le': '<=',

      // String operations
      'contains': 'contains',
      'starts_with': 'starts_with',
      'ends_with': 'ends_with',
      'matches': 'matches',
      'regex': 'regex',

      // List operations
      'in': 'in',
      'not_in': 'not_in',

      // Null checks
      'is_null': 'is_null',
      'is_not_null': 'is_not_null',
      'exists': 'is_not_null',
      'not_exists': 'is_null'
    }

    const normalized = operatorMap[operator.toLowerCase()]
    return normalized || operator
  }

  /**
   * Combine multiple filters into single condition
   */
  combineFilters(
    filters: Filter[],
    combineWith: 'and' | 'or' = 'and'
  ): any {
    if (filters.length === 0) {
      return null
    }

    if (filters.length === 1) {
      return this.buildCondition(filters[0])
    }

    const conditions = filters.map(f => this.buildCondition(f))

    return {
      [combineWith]: conditions
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a filter resolver
 */
export function createFilterResolver(): FilterResolver {
  return new FilterResolver()
}

/**
 * Quick resolve function
 */
export async function resolveFilters(
  filters: Filter[],
  inputVariable: string
): Promise<WorkflowStep[]> {
  const resolver = new FilterResolver()
  return await resolver.resolve(filters, inputVariable)
}
