/**
 * Conditional Resolver
 *
 * Maps IR conditionals to PILOT_DSL conditional steps.
 *
 * Responsibilities:
 * 1. Convert conditional logic to conditional workflow steps
 * 2. Handle simple and complex conditions (AND/OR/NOT)
 * 3. Resolve then/else branches
 */

import type { Conditional, Condition } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'
import { PluginResolver } from '../utils/PluginResolver'
import type { PluginManagerV2 } from '../../../../server/plugin-manager-v2'

// ============================================================================
// Conditional Resolver
// ============================================================================

export class ConditionalResolver {
  private pluginResolver: PluginResolver

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginResolver = new PluginResolver(pluginManager)
  }
  /**
   * Resolve conditionals to conditional steps
   */
  async resolve(
    conditionals: Conditional[],
    inputVariable: string,
    stepIdPrefix: string = 'conditional'
  ): Promise<WorkflowStep[]> {
    if (!conditionals || conditionals.length === 0) {
      return []
    }

    console.log('[ConditionalResolver] Resolving', conditionals.length, 'conditional(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < conditionals.length; i++) {
      const conditional = conditionals[i]
      console.log(`[ConditionalResolver] Processing conditional ${i + 1}`)

      const step = this.createConditionalStep(conditional, inputVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)
    }

    console.log('[ConditionalResolver] ✓ Resolved', steps.length, 'conditional step(s)')
    return steps
  }

  /**
   * Create a conditional step
   */
  private createConditionalStep(
    conditional: Conditional,
    inputVariable: string,
    stepId: string
  ): WorkflowStep {
    return {
      step_id: stepId,
      type: 'conditional',
      operation: 'if_then_else',
      config: {
        input: `{{${inputVariable}}}`,
        condition: this.mapCondition(conditional.when),
        then_steps: this.convertIntentActionsToSteps(conditional.then),
        else_steps: conditional.else ? this.convertIntentActionsToSteps(conditional.else) : []
      },
      output_variable: `${stepId}_output`,
      description: this.generateConditionDescription(conditional.when)
    }
  }

  /**
   * Map condition to workflow condition format
   */
  private mapCondition(condition: Condition): any {
    if (condition.type === 'simple') {
      return {
        type: 'simple',
        field: condition.field,
        operator: this.mapOperator(condition.operator || 'equals'),
        value: condition.value
      }
    }

    if (condition.type === 'complex_and') {
      return {
        type: 'and',
        conditions: condition.conditions?.map(c => this.mapCondition(c)) || []
      }
    }

    if (condition.type === 'complex_or') {
      return {
        type: 'or',
        conditions: condition.conditions?.map(c => this.mapCondition(c)) || []
      }
    }

    if (condition.type === 'complex_not') {
      return {
        type: 'not',
        condition: condition.conditions?.[0] ? this.mapCondition(condition.conditions[0]) : {}
      }
    }

    return condition
  }

  /**
   * Map condition operators
   */
  private mapOperator(operator: string): string {
    const operatorMap: Record<string, string> = {
      equals: '==',
      not_equals: '!=',
      contains: 'contains',
      greater_than: '>',
      less_than: '<',
      in: 'in',
      is_empty: 'is_empty',
      is_not_empty: 'is_not_empty'
    }

    return operatorMap[operator] || operator
  }

  /**
   * Generate human-readable condition description
   */
  private generateConditionDescription(condition: Condition): string {
    if (condition.type === 'simple') {
      return `If ${condition.field} ${condition.operator} ${condition.value}`
    }

    if (condition.type === 'complex_and') {
      const count = condition.conditions?.length || 0
      return `If all ${count} conditions are true`
    }

    if (condition.type === 'complex_or') {
      const count = condition.conditions?.length || 0
      return `If any of ${count} conditions are true`
    }

    if (condition.type === 'complex_not') {
      return `If condition is not true`
    }

    return 'Conditional logic'
  }

  /**
   * Convert intent actions to workflow steps
   * Simplified - actual implementation would use other resolvers
   */
  private convertIntentActionsToSteps(intentActions: any[]): any[] {
    return intentActions.map((action, i) => {
      if (action.type === 'delivery') {
        return {
          step_id: `nested_delivery_${i + 1}`,
          type: 'action',
          plugin: this.getDeliveryPlugin(action.config.method),
          action: 'send',  // Use 'action' for PILOT executor compatibility
          config: action.config.config
        }
      }

      if (action.type === 'ai_operation') {
        return {
          step_id: `nested_ai_${i + 1}`,
          type: 'ai_processing',
          operation: action.config.type,
          config: {
            instruction: action.config.instruction,
            input_source: action.config.input_source
          }
        }
      }

      if (action.type === 'transform') {
        return {
          step_id: `nested_transform_${i + 1}`,
          type: 'transform',
          operation: action.config.operation,
          config: action.config.config
        }
      }

      if (action.type === 'filter') {
        return {
          step_id: `nested_filter_${i + 1}`,
          type: 'transform',
          operation: 'filter',
          config: {
            condition: {
              field: action.config.field,
              operator: action.config.operator,
              value: action.config.value
            }
          }
        }
      }

      return action
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
   * Check if condition is simple or complex
   */
  isSimpleCondition(condition: Condition): boolean {
    return condition.type === 'simple'
  }

  /**
   * Check if conditional has else branch
   */
  hasElseBranch(conditional: Conditional): boolean {
    return conditional.else !== undefined && conditional.else.length > 0
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a conditional resolver
 */
export function createConditionalResolver(pluginManager?: PluginManagerV2): ConditionalResolver {
  return new ConditionalResolver(pluginManager)
}

/**
 * Quick resolve conditionals
 */
export async function resolveConditionals(
  conditionals: Conditional[],
  inputVariable: string,
  pluginManager?: PluginManagerV2
): Promise<WorkflowStep[]> {
  const resolver = new ConditionalResolver(pluginManager)
  return await resolver.resolve(conditionals, inputVariable)
}
