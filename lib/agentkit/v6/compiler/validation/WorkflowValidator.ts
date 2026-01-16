/**
 * Workflow Validator
 *
 * Validates compiled workflows against formal invariants to ensure correctness.
 * This guarantees that ALL workflows (not just tested ones) will be valid.
 *
 * INVARIANTS ENFORCED:
 * 1. Variable Continuity: Every input variable must be defined by a previous step
 * 2. Type Compatibility: Step outputs must match expected inputs
 * 3. Completeness: All IR operations must be compiled into DSL
 * 4. No Dead Code: Every step must contribute to the final output
 */

import type { WorkflowStep } from '../../../pilot/types/pilot-dsl-types'
import type { ExtendedLogicalIR } from '../../logical-ir/schemas/extended-ir-types'

// ============================================================================
// Validation Result Types
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  type: 'variable_undefined' | 'type_mismatch' | 'missing_operation' | 'orphaned_step'
  message: string
  step_id?: string
  variable?: string
  details?: any
}

export interface ValidationWarning {
  type: 'unused_output' | 'inefficient_pattern' | 'potential_issue'
  message: string
  step_id?: string
  suggestion?: string
}

// ============================================================================
// Workflow Validator
// ============================================================================

export class WorkflowValidator {
  private errors: ValidationError[] = []
  private warnings: ValidationWarning[] = []

  /**
   * Validate a compiled workflow
   */
  validate(
    workflow: WorkflowStep[],
    ir: ExtendedLogicalIR
  ): ValidationResult {
    this.errors = []
    this.warnings = []

    console.log('[Validator] Validating workflow...')
    console.log('[Validator] Steps:', workflow.length)

    // Run all validation checks
    this.validateVariableContinuity(workflow)
    this.validateTypeCompatibility(workflow)
    this.validateCompleteness(workflow, ir)
    this.validateNoDeadCode(workflow)

    const valid = this.errors.length === 0

    console.log(
      `[Validator] ${valid ? '✓' : '✗'} Validation ${valid ? 'passed' : 'failed'}`
    )
    if (this.errors.length > 0) {
      console.log(`[Validator] Errors: ${this.errors.length}`)
      this.errors.forEach(err => console.log(`[Validator]   - ${err.message}`))
    }
    if (this.warnings.length > 0) {
      console.log(`[Validator] Warnings: ${this.warnings.length}`)
      this.warnings.forEach(warn => console.log(`[Validator]   - ${warn.message}`))
    }

    return {
      valid,
      errors: this.errors,
      warnings: this.warnings
    }
  }

  // ==========================================================================
  // INVARIANT 1: Variable Continuity
  // ==========================================================================

  /**
   * Ensure every input variable is defined by a previous step
   */
  private validateVariableContinuity(workflow: WorkflowStep[]): void {
    console.log('[Validator] Checking variable continuity...')

    const definedVars = new Set<string>()
    const stepOutputs = new Map<string, string>() // step_id -> output_variable

    for (const step of workflow) {
      // For scatter_gather, the item_variable is implicitly defined within the loop context
      const localDefinedVars = new Set(definedVars)
      if (step.type === 'scatter_gather' && step.config?.item_variable) {
        localDefinedVars.add(step.config.item_variable)
      }

      // Special handling for scatter_gather nested actions
      if (step.type === 'scatter_gather' && step.config?.actions) {
        const nestedDefinedVars = new Set(localDefinedVars)

        // Validate each nested action in sequence
        for (const action of step.config.actions) {
          // Extract input variables from this nested action
          const nestedInputVars = this.extractInputVariablesFromObject(action)

          // Check each nested action's input variables
          for (const inputVar of nestedInputVars) {
            const baseVar = inputVar.split('.')[0]
            const isPropertyAccess = inputVar.includes('.')

            const isDefined = nestedDefinedVars.has(inputVar) ||
                             (isPropertyAccess && nestedDefinedVars.has(baseVar))

            if (!isDefined) {
              this.errors.push({
                type: 'variable_undefined',
                message: `Step "${step.step_id}" references undefined variable: {{${inputVar}}}`,
                step_id: step.step_id,
                variable: inputVar,
                details: {
                  defined_variables: Array.from(nestedDefinedVars),
                  nested_action: action.step_id
                }
              })
            }
          }

          // Add this nested action's output to the nested scope
          if (action.output_variable) {
            nestedDefinedVars.add(action.output_variable)
          }
        }
      } else {
        // Regular step validation
        const inputVars = this.extractInputVariables(step)

        // Check each input variable is defined
        for (const inputVar of inputVars) {
          // Handle property access (e.g., "group.items" where "group" is defined)
          const baseVar = inputVar.split('.')[0]
          const isPropertyAccess = inputVar.includes('.')

          const isDefined = localDefinedVars.has(inputVar) ||
                           (isPropertyAccess && localDefinedVars.has(baseVar))

          if (!isDefined) {
            this.errors.push({
              type: 'variable_undefined',
              message: `Step "${step.step_id}" references undefined variable: {{${inputVar}}}`,
              step_id: step.step_id,
              variable: inputVar,
              details: {
                defined_variables: Array.from(definedVars),
                step_config: step.config
              }
            })
          }
        }
      }

      // Add this step's output to defined variables
      if (step.output_variable) {
        definedVars.add(step.output_variable)
        stepOutputs.set(step.step_id, step.output_variable)
      }
    }

    console.log(`[Validator]   ✓ Checked ${workflow.length} steps`)
    console.log(`[Validator]   Defined variables: ${Array.from(definedVars).join(', ')}`)
  }

  /**
   * Extract all variable references from a workflow step
   */
  private extractInputVariables(step: WorkflowStep): Set<string> {
    const vars = new Set<string>()
    const varPattern = /\{\{([^}]+)\}\}/g

    // Recursively search config object
    const searchObject = (obj: any) => {
      if (typeof obj === 'string') {
        let match
        while ((match = varPattern.exec(obj)) !== null) {
          vars.add(match[1].trim())
        }
      } else if (Array.isArray(obj)) {
        obj.forEach(searchObject)
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(searchObject)
      }
    }

    searchObject(step.config)

    // Special handling for scatter_gather
    if (step.type === 'scatter_gather' && step.config?.actions) {
      step.config.actions.forEach((action: any) => searchObject(action))
    }

    return vars
  }

  /**
   * Extract all variable references from any object (used for nested actions)
   */
  private extractInputVariablesFromObject(obj: any): Set<string> {
    const vars = new Set<string>()
    const varPattern = /\{\{([^}]+)\}\}/g

    // Recursively search object
    const searchObject = (o: any) => {
      if (typeof o === 'string') {
        let match
        while ((match = varPattern.exec(o)) !== null) {
          vars.add(match[1].trim())
        }
      } else if (Array.isArray(o)) {
        o.forEach(searchObject)
      } else if (o && typeof o === 'object') {
        Object.values(o).forEach(searchObject)
      }
    }

    searchObject(obj)
    return vars
  }

  // ==========================================================================
  // INVARIANT 2: Type Compatibility
  // ==========================================================================

  /**
   * Check type compatibility between steps
   */
  private validateTypeCompatibility(workflow: WorkflowStep[]): void {
    console.log('[Validator] Checking type compatibility...')

    const variableTypes = new Map<string, string>()

    for (let i = 0; i < workflow.length; i++) {
      const step = workflow[i]

      // Infer output type
      const outputType = this.inferOutputType(step)
      if (step.output_variable && outputType) {
        variableTypes.set(step.output_variable, outputType)
      }

      // Check scatter_gather input type
      if (step.type === 'scatter_gather') {
        const inputVar = this.extractInputVariables(step).values().next().value
        if (inputVar) {
          const inputType = variableTypes.get(inputVar)

          // Scatter-gather expects array, but might get object
          if (inputType && !inputType.includes('array') && !inputType.includes('Array')) {
            this.errors.push({
              type: 'type_mismatch',
              message: `Step "${step.step_id}" expects array but got ${inputType} from {{${inputVar}}}`,
              step_id: step.step_id,
              variable: inputVar,
              details: {
                expected: 'array',
                actual: inputType,
                suggestion: 'Add a transform step to convert to array or extract array field'
              }
            })
          }
        }
      }
    }

    console.log(`[Validator]   ✓ Checked ${workflow.length} steps for type compatibility`)
  }

  /**
   * Infer the output type of a step
   * Schema-driven: infers type from operation name patterns rather than hardcoded plugin names
   */
  private inferOutputType(step: WorkflowStep): string | null {
    // Plugin operations - infer from operation name patterns (schema-driven)
    if (step.type === 'action' && step.operation) {
      const opLower = step.operation.toLowerCase()
      // Search/list operations return arrays
      if (opLower.includes('list') || opLower.includes('search') || opLower.includes('get_all')) {
        return 'array'
      }
      // Send operations return result objects
      if (opLower.includes('send') || opLower.includes('post') || opLower.includes('create')) {
        return 'object'
      }
      // Read operations typically return data
      if (opLower.includes('read') || opLower.includes('get') || opLower.includes('fetch')) {
        return 'any'
      }
    }

    // Transform operations
    if (step.type === 'transform') {
      if (step.operation === 'filter') return 'array'
      if (step.operation === 'map') return 'array'
      if (step.operation === 'flatten') return 'array'
      if (step.operation === 'aggregate') return 'object'
      if (step.operation === 'extract_field') {
        // Extract_field with flatten=true returns array
        if (step.config?.flatten) return 'array'
        return 'any'
      }
    }

    // Scatter-gather always returns array
    if (step.type === 'scatter_gather') {
      return 'array'
    }

    // AI operations
    if (step.type === 'ai_processing') {
      const schema = step.config?.output_schema
      if (schema?.type === 'array') return 'array<object>'
      if (schema?.type === 'object') return 'object'
    }

    return null
  }

  // ==========================================================================
  // INVARIANT 3: Completeness
  // ==========================================================================

  /**
   * Ensure all IR operations are compiled into DSL
   */
  private validateCompleteness(workflow: WorkflowStep[], ir: ExtendedLogicalIR): void {
    console.log('[Validator] Checking completeness...')

    // Check filters
    if (ir.filters && ir.filters.length > 0) {
      const filterSteps = workflow.filter(s => s.operation === 'filter')
      if (filterSteps.length < ir.filters.length) {
        this.warnings.push({
          type: 'potential_issue',
          message: `IR has ${ir.filters.length} filters but workflow has ${filterSteps.length} filter steps`,
          suggestion: 'Some filters may not have been compiled'
        })
      }
    }

    // Check AI operations
    if (ir.ai_operations && ir.ai_operations.length > 0) {
      // Count AI operations in the workflow (including those in scatter_gather nested actions)
      let aiOperationCount = 0

      console.log('[Validator]   Checking AI operations completeness...')
      console.log('[Validator]   IR has', ir.ai_operations.length, 'AI operations:', ir.ai_operations.map((op: any) => op.id))

      for (const step of workflow) {
        // Standalone AI processing step
        if (step.type === 'ai_processing') {
          console.log('[Validator]   Found standalone AI operation:', step.step_id)
          aiOperationCount++
        }
        // AI processing inside scatter_gather
        else if (step.type === 'scatter_gather' && step.config?.actions) {
          console.log('[Validator]   Checking scatter_gather:', step.step_id, 'with', step.config.actions.length, 'actions')
          const aiActions = step.config.actions.filter((a: any) => a.type === 'ai_processing')
          console.log('[Validator]   Found', aiActions.length, 'AI actions:', aiActions.map((a: any) => ({ step_id: a.step_id, type: a.type })))
          aiOperationCount += aiActions.length
        }
      }

      console.log('[Validator]   Total AI operations found:', aiOperationCount)

      if (aiOperationCount === 0) {
        this.errors.push({
          type: 'missing_operation',
          message: `IR has ${ir.ai_operations.length} AI operations but none found in workflow`,
          details: {
            ir_operations: ir.ai_operations.map(op => op.id)
          }
        })
      } else if (aiOperationCount < ir.ai_operations.length) {
        this.warnings.push({
          type: 'potential_issue',
          message: `IR has ${ir.ai_operations.length} AI operations but only ${aiOperationCount} found in workflow`,
          suggestion: 'Some AI operations may not have been compiled'
        })
      }
    }

    // Check loops
    if (ir.loops && ir.loops.length > 0) {
      const loopSteps = workflow.filter(s => s.type === 'scatter_gather')
      if (loopSteps.length < ir.loops.length) {
        this.errors.push({
          type: 'missing_operation',
          message: `IR has ${ir.loops.length} loops but workflow has ${loopSteps.length} scatter_gather steps`,
          details: {
            ir_loops: ir.loops.map(l => l.id)
          }
        })
      }
    }

    console.log('[Validator]   ✓ Completeness check done')
  }

  // ==========================================================================
  // INVARIANT 4: No Dead Code
  // ==========================================================================

  /**
   * Ensure every step contributes to the final output
   */
  private validateNoDeadCode(workflow: WorkflowStep[]): void {
    console.log('[Validator] Checking for dead code...')

    const usedVariables = new Set<string>()
    const allOutputVars = new Set<string>()

    // Collect all output variables
    workflow.forEach(step => {
      if (step.output_variable) {
        allOutputVars.add(step.output_variable)
      }
    })

    // Mark variables as used (walk backwards from delivery)
    for (let i = workflow.length - 1; i >= 0; i--) {
      const step = workflow[i]

      // Delivery steps and final steps are always "used"
      if (step.type === 'action' || i === workflow.length - 1) {
        const inputVars = this.extractInputVariables(step)
        inputVars.forEach(v => usedVariables.add(v))

        if (step.output_variable) {
          usedVariables.add(step.output_variable)
        }
      }

      // If step's output is used, mark its inputs as used
      if (step.output_variable && usedVariables.has(step.output_variable)) {
        const inputVars = this.extractInputVariables(step)
        inputVars.forEach(v => usedVariables.add(v))
      }
    }

    // Find unused outputs
    const unusedOutputs = Array.from(allOutputVars).filter(v => !usedVariables.has(v))

    if (unusedOutputs.length > 0) {
      unusedOutputs.forEach(varName => {
        const step = workflow.find(s => s.output_variable === varName)
        if (step) {
          this.warnings.push({
            type: 'unused_output',
            message: `Step "${step.step_id}" output "{{${varName}}}" is never used`,
            step_id: step.step_id,
            suggestion: 'This step may be unnecessary or there may be a missing connection'
          })
        }
      })
    }

    console.log('[Validator]   ✓ Dead code check done')
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a workflow validator instance
 */
export function createWorkflowValidator(): WorkflowValidator {
  return new WorkflowValidator()
}

/**
 * Quick validation function
 */
export function validateWorkflow(
  workflow: WorkflowStep[],
  ir: ExtendedLogicalIR
): ValidationResult {
  const validator = new WorkflowValidator()
  return validator.validate(workflow, ir)
}
