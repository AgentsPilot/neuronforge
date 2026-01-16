/**
 * Workflow Pre-Flight Validator
 *
 * Validates workflow structure before execution to catch malformed workflows early.
 * This is Phase 5 of the V6 Architecture Improvements.
 *
 * Validates:
 * 1. Step IDs are sequential (step1, step2, step3, ...)
 * 2. All dependencies reference existing steps
 * 3. No circular dependencies (DAG validation)
 * 4. Step dependencies only reference earlier steps
 *
 * @module lib/pilot/WorkflowValidator
 */

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}

export class WorkflowValidator {
  /**
   * Validate workflow structure before execution
   *
   * @param workflow - Array of workflow steps (PILOT DSL format)
   * @returns Validation result with errors if invalid
   */
  validatePreFlight(workflow: any[]): ValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    if (!workflow || !Array.isArray(workflow)) {
      return {
        valid: false,
        errors: ['Workflow must be an array']
      }
    }

    if (workflow.length === 0) {
      return {
        valid: false,
        errors: ['Workflow cannot be empty']
      }
    }

    // 1. Check step IDs exist and are unique (sequential numbering not enforced due to nested steps)
    const stepIds = workflow.map(s => s.step_id || s.id)
    const stepIdSet = new Set<string>()

    stepIds.forEach((stepId, index) => {
      if (!stepId) {
        errors.push(`Step at index ${index} is missing an ID`)
      } else if (stepIdSet.has(stepId)) {
        errors.push(`Duplicate step ID found: '${stepId}'`)
      } else {
        stepIdSet.add(stepId)
      }
    })

    // 2. Check all dependencies reference existing steps (stepIdSet already populated above)
    workflow.forEach((step, index) => {
      const stepId = step.step_id || step.id
      const dependencies = step.dependencies || []

      dependencies.forEach((depId: string) => {
        if (!stepIdSet.has(depId)) {
          errors.push(`Step '${stepId}' depends on non-existent step '${depId}'`)
        }
      })
    })

    // 3. Check dependencies only reference earlier steps (forward dependencies are invalid)
    workflow.forEach((step, index) => {
      const stepId = step.step_id || step.id
      const dependencies = step.dependencies || []

      dependencies.forEach((depId: string) => {
        const depIndex = stepIds.indexOf(depId)
        if (depIndex >= index) {
          errors.push(
            `Step '${stepId}' (index ${index}) depends on later step '${depId}' (index ${depIndex}). ` +
            `Dependencies must reference earlier steps only.`
          )
        }
      })
    })

    // 4. Detect circular dependencies using DFS
    const visited = new Set<string>()
    const recStack = new Set<string>()
    const stepMap = new Map(workflow.map(s => [s.step_id || s.id, s]))

    const hasCycle = (stepId: string, path: string[] = []): boolean => {
      if (recStack.has(stepId)) {
        const cyclePath = [...path, stepId].join(' → ')
        errors.push(`Circular dependency detected: ${cyclePath}`)
        return true
      }

      if (visited.has(stepId)) {
        return false
      }

      visited.add(stepId)
      recStack.add(stepId)

      const step = stepMap.get(stepId)
      const deps = step?.dependencies || []

      for (const depId of deps) {
        if (hasCycle(depId, [...path, stepId])) {
          return true
        }
      }

      recStack.delete(stepId)
      return false
    }

    // Check each step for cycles
    stepIds.forEach(stepId => {
      if (!visited.has(stepId)) {
        hasCycle(stepId)
      }
    })

    // 5. Validate step types are known
    const validStepTypes = [
      'action',
      'transform',
      'filter',
      'scatter_gather',
      'conditional',
      'ai_router',
      'sub_workflow',
      'loop',
      'parallel',
      'aggregate',
      'decision',
      'human_in_loop',
      'delay',
      'webhook',
      'custom'
    ]

    workflow.forEach(step => {
      const stepId = step.step_id || step.id
      const stepType = step.type

      if (!stepType) {
        errors.push(`Step '${stepId}' is missing 'type' field`)
      } else if (!validStepTypes.includes(stepType)) {
        warnings.push(`Step '${stepId}' has unknown type '${stepType}'`)
      }
    })

    // 6. Validate action steps have required fields
    workflow.forEach(step => {
      const stepId = step.step_id || step.id

      if (step.type === 'action') {
        if (!step.plugin) {
          errors.push(`Action step '${stepId}' is missing 'plugin' field`)
        }
        if (!step.action) {
          errors.push(`Action step '${stepId}' is missing 'action' field`)
        }
      }
    })

    return {
      valid: errors.length === 0,
      errors,
      warnings: warnings.length > 0 ? warnings : undefined
    }
  }
}
