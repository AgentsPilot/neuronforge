/**
 * Semantic Skeleton Validator
 *
 * Validates semantic skeleton structure before IR generation.
 * Catches structural errors early (before spending tokens on IR generation).
 */

import type {
  SemanticSkeleton,
  SkeletonAction,
  LoopAction,
  DecideAction,
} from '../semantic-plan/types/semantic-skeleton-types'

export interface ValidationError {
  category: 'schema' | 'structure' | 'requirement' | 'logic'
  message: string
  suggestion?: string
  severity: 'error' | 'warning'
  actionIndex?: number
}

export class SkeletonValidator {
  /**
   * Validate semantic skeleton structure
   *
   * Performs comprehensive validation to catch structural errors
   * before IR generation. Returns array of validation errors.
   *
   * @param skeleton - Semantic skeleton to validate
   * @returns Array of validation errors (empty if valid)
   */
  validate(skeleton: SemanticSkeleton): ValidationError[] {
    const errors: ValidationError[] = []

    // 1. Required fields validation
    errors.push(...this.validateRequiredFields(skeleton))

    // 2. Unit of work enforcement validation
    errors.push(...this.validateUnitOfWorkEnforcement(skeleton))

    // 3. Loop nesting validation
    errors.push(...this.validateLoopNesting(skeleton.flow))

    // 4. Conditional structure validation
    errors.push(...this.validateConditionals(skeleton.flow))

    // 5. Flow completeness validation
    errors.push(...this.validateFlowCompleteness(skeleton.flow))

    return errors
  }

  /**
   * Validate that all required fields are present
   */
  private validateRequiredFields(skeleton: SemanticSkeleton): ValidationError[] {
    const errors: ValidationError[] = []

    if (!skeleton.goal || skeleton.goal.trim() === '') {
      errors.push({
        category: 'schema',
        message: 'Missing required field: goal',
        suggestion: 'Add a concise description of what this workflow achieves',
        severity: 'error',
      })
    }

    if (!skeleton.unit_of_work || skeleton.unit_of_work.trim() === '') {
      errors.push({
        category: 'schema',
        message: 'Missing required field: unit_of_work',
        suggestion: 'Specify the entity that defines one output record (e.g., "email", "attachment", "row")',
        severity: 'error',
      })
    }

    if (!skeleton.flow || skeleton.flow.length === 0) {
      errors.push({
        category: 'schema',
        message: 'Missing or empty required field: flow',
        suggestion: 'Add at least one action to the flow array',
        severity: 'error',
      })
    }

    return errors
  }

  /**
   * Validate unit of work enforcement
   *
   * Checks that at least one loop has collect_results=true,
   * which is required to enforce the specified unit_of_work.
   */
  private validateUnitOfWorkEnforcement(skeleton: SemanticSkeleton): ValidationError[] {
    const errors: ValidationError[] = []

    if (!skeleton.flow || skeleton.flow.length === 0) {
      return errors // Already caught by required fields validation
    }

    const collectionPoints = this.findCollectResultsTrue(skeleton.flow)

    if (collectionPoints.length === 0) {
      errors.push({
        category: 'requirement',
        message: `Unit of work '${skeleton.unit_of_work}' specified but no loops have collect_results=true`,
        suggestion: `Set collect_results=true on the loop that iterates over ${skeleton.unit_of_work}`,
        severity: 'error',
      })
    }

    // Warn if multiple collection points (unusual but not necessarily wrong)
    if (collectionPoints.length > 1) {
      errors.push({
        category: 'requirement',
        message: `Multiple loops have collect_results=true (${collectionPoints.length} found)`,
        suggestion: 'Verify that multiple collection points are intentional for this workflow',
        severity: 'warning',
      })
    }

    return errors
  }

  /**
   * Find all loops with collect_results=true
   */
  private findCollectResultsTrue(flow: SkeletonAction[]): number[] {
    const indices: number[] = []

    for (let i = 0; i < flow.length; i++) {
      const action = flow[i]

      if (action.action === 'loop') {
        if (action.collect_results) {
          indices.push(i)
        }
        // Recursively check nested loops
        indices.push(...this.findCollectResultsTrue(action.do))
      } else if (action.action === 'decide') {
        // Check then and else branches
        indices.push(...this.findCollectResultsTrue(action.then))
        if (action.else) {
          indices.push(...this.findCollectResultsTrue(action.else))
        }
      }
    }

    return indices
  }

  /**
   * Validate loop nesting structure
   *
   * Checks that:
   * - Nested loops are inside parent loop's "do" array
   * - No orphaned loops
   * - Loop bodies are not empty
   */
  private validateLoopNesting(
    flow: SkeletonAction[],
    parentPath: string = 'root',
    level: number = 0
  ): ValidationError[] {
    const errors: ValidationError[] = []

    for (let i = 0; i < flow.length; i++) {
      const action = flow[i]
      const actionPath = `${parentPath}[${i}]`

      if (action.action === 'loop') {
        // Validate loop has non-empty body
        if (!action.do || action.do.length === 0) {
          errors.push({
            category: 'structure',
            message: `Loop at ${actionPath} has empty body`,
            suggestion: 'Add at least one action to the loop body',
            severity: 'error',
            actionIndex: i,
          })
        }

        // Validate loop has description
        if (!action.over || action.over.trim() === '') {
          errors.push({
            category: 'structure',
            message: `Loop at ${actionPath} missing 'over' description`,
            suggestion: 'Specify what to iterate over (e.g., "emails", "attachments")',
            severity: 'error',
            actionIndex: i,
          })
        }

        // Validate collect_results is boolean
        if (typeof action.collect_results !== 'boolean') {
          errors.push({
            category: 'structure',
            message: `Loop at ${actionPath} has invalid collect_results value`,
            suggestion: 'Set collect_results to true or false',
            severity: 'error',
            actionIndex: i,
          })
        }

        // Recursively validate nested loops
        errors.push(...this.validateLoopNesting(action.do, `${actionPath}.do`, level + 1))
      } else if (action.action === 'decide') {
        // Recursively validate loops in branches
        errors.push(...this.validateLoopNesting(action.then, `${actionPath}.then`, level))
        if (action.else) {
          errors.push(...this.validateLoopNesting(action.else, `${actionPath}.else`, level))
        }
      }
    }

    return errors
  }

  /**
   * Validate conditional (decide) structure
   *
   * Checks that:
   * - Conditionals have condition specified
   * - Conditionals have then branch
   * - Branches are not empty
   */
  private validateConditionals(
    flow: SkeletonAction[],
    parentPath: string = 'root'
  ): ValidationError[] {
    const errors: ValidationError[] = []

    for (let i = 0; i < flow.length; i++) {
      const action = flow[i]
      const actionPath = `${parentPath}[${i}]`

      if (action.action === 'decide') {
        // Validate condition is specified
        if (!action.if || action.if.trim() === '') {
          errors.push({
            category: 'structure',
            message: `Decide action at ${actionPath} missing condition`,
            suggestion: 'Specify the condition to evaluate (e.g., "amount > $50")',
            severity: 'error',
            actionIndex: i,
          })
        }

        // Validate then branch exists and is not empty
        if (!action.then || action.then.length === 0) {
          errors.push({
            category: 'structure',
            message: `Decide action at ${actionPath} has empty 'then' branch`,
            suggestion: 'Add at least one action to the then branch',
            severity: 'error',
            actionIndex: i,
          })
        }

        // Warn if else branch is missing (not an error, but might be intentional)
        if (!action.else || action.else.length === 0) {
          errors.push({
            category: 'logic',
            message: `Decide action at ${actionPath} has no 'else' branch`,
            suggestion: 'Consider adding an else branch or use skip action',
            severity: 'warning',
            actionIndex: i,
          })
        }

        // Recursively validate nested conditionals in branches
        errors.push(...this.validateConditionals(action.then, `${actionPath}.then`))
        if (action.else) {
          errors.push(...this.validateConditionals(action.else, `${actionPath}.else`))
        }
      } else if (action.action === 'loop') {
        // Recursively validate conditionals in loop body
        errors.push(...this.validateConditionals(action.do, `${actionPath}.do`))
      }
    }

    return errors
  }

  /**
   * Validate flow completeness
   *
   * Checks that:
   * - Flow has at least one fetch or data source action
   * - Flow has at least one delivery action (upload, send, etc.)
   */
  private validateFlowCompleteness(flow: SkeletonAction[]): ValidationError[] {
    const errors: ValidationError[] = []

    const hasFetch = this.hasActionType(flow, 'fetch')
    const hasDelivery = this.hasActionTypes(flow, ['upload', 'send', 'update'])

    if (!hasFetch) {
      errors.push({
        category: 'logic',
        message: 'Flow does not contain any fetch action',
        suggestion: 'Add a fetch action to retrieve data from a source',
        severity: 'warning',
      })
    }

    if (!hasDelivery) {
      errors.push({
        category: 'logic',
        message: 'Flow does not contain any delivery action (upload, send, update)',
        suggestion: 'Add an action to deliver or store results',
        severity: 'warning',
      })
    }

    return errors
  }

  /**
   * Check if flow contains an action of specific type
   */
  private hasActionType(flow: SkeletonAction[], actionType: string): boolean {
    for (const action of flow) {
      if (action.action === actionType) {
        return true
      }

      if (action.action === 'loop') {
        if (this.hasActionType(action.do, actionType)) {
          return true
        }
      } else if (action.action === 'decide') {
        if (this.hasActionType(action.then, actionType)) {
          return true
        }
        if (action.else && this.hasActionType(action.else, actionType)) {
          return true
        }
      }
    }

    return false
  }

  /**
   * Check if flow contains any action from a list of types
   */
  private hasActionTypes(flow: SkeletonAction[], actionTypes: string[]): boolean {
    return actionTypes.some(type => this.hasActionType(flow, type))
  }

  /**
   * Get validation summary
   *
   * Returns a human-readable summary of validation results.
   *
   * @param errors - Validation errors from validate()
   * @returns Summary object with counts and messages
   */
  getValidationSummary(errors: ValidationError[]): {
    isValid: boolean
    errorCount: number
    warningCount: number
    summary: string
  } {
    const errorCount = errors.filter(e => e.severity === 'error').length
    const warningCount = errors.filter(e => e.severity === 'warning').length

    let summary = ''
    if (errorCount === 0 && warningCount === 0) {
      summary = '✅ Skeleton is valid'
    } else if (errorCount > 0) {
      summary = `❌ Skeleton has ${errorCount} error(s) and ${warningCount} warning(s)`
    } else {
      summary = `⚠️ Skeleton has ${warningCount} warning(s)`
    }

    return {
      isValid: errorCount === 0,
      errorCount,
      warningCount,
      summary,
    }
  }
}
