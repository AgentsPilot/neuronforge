/**
 * Validator — Post-execution validation checks (A9 + A+ extensions)
 *
 * Phase A checks (1-6): unresolved refs, config coverage, data flow, field consistency,
 *   scatter-gather integrity, conditional reachability
 * Phase A+ checks (7-13): cross-step field tracing, scatter item field validation,
 *   conditional field validation, config type checking, schema completeness,
 *   duplicate output vars, DAG visualization
 */

import { VariableStore } from './variable-store'
import { StepLogEntry } from './dsl-simulator'

export interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  check: string
  step_id?: string
  message: string
}

export interface ValidationReport {
  issues: ValidationIssue[]
  checks_passed: number
  checks_failed: number
  total_checks: number
  summary: {
    unresolved_refs: string[]
    missing_config_keys: string[]
    data_flow_breaks: string[]
    field_mismatches: string[]
    cross_step_field_errors: string[]
    scatter_item_errors: string[]
    conditional_field_errors: string[]
  }
  dag: string
}

export class Validator {
  /**
   * Run all validation checks (A + A+).
   */
  validate(
    dslSteps: any[],
    store: VariableStore,
    stepLog: StepLogEntry[],
    workflowConfig: Record<string, any>
  ): ValidationReport {
    const issues: ValidationIssue[] = []

    // === Phase A checks ===
    // Check 1: Unresolved references from step log
    const unresolvedRefs = this.checkUnresolvedRefs(stepLog, issues)

    // Check 2: Config key coverage
    const missingConfigKeys = this.checkConfigCoverage(dslSteps, workflowConfig, issues)

    // Check 3: Data flow chain
    const dataFlowBreaks = this.checkDataFlowChain(dslSteps, issues)

    // Check 4: Field name consistency (basic — upgraded by A+1)
    const fieldMismatches = this.checkFieldConsistency(dslSteps, issues)

    // Check 5: Scatter-gather integrity (basic — upgraded by A+2)
    this.checkScatterGatherIntegrity(dslSteps, issues)

    // Check 6: Conditional reachability (basic — upgraded by A+3)
    this.checkConditionalReachability(dslSteps, issues)

    // === Phase A+ checks ===
    // A+1: Cross-step field reference tracing
    const crossStepFieldErrors = this.checkCrossStepFieldRefs(dslSteps, issues)

    // A+2: Scatter-gather item field validation
    const scatterItemErrors = this.checkScatterItemFields(dslSteps, issues)

    // A+3: Conditional condition field validation
    const conditionalFieldErrors = this.checkConditionalFields(dslSteps, issues)

    // A+4: Config value type checking
    this.checkConfigValueTypes(dslSteps, workflowConfig, issues)

    // A+5: Output schema completeness
    this.checkOutputSchemaCompleteness(dslSteps, issues)

    // A+6: Duplicate output variable detection
    this.checkDuplicateOutputVars(dslSteps, issues)

    // A+7: Build DAG
    const dag = this.buildDAG(dslSteps)

    const totalChecks = 13
    const errorChecks = new Set(issues.filter(i => i.severity === 'error').map(i => i.check))
    const checksFailed = errorChecks.size
    const checksPassed = totalChecks - checksFailed

    return {
      issues,
      checks_passed: checksPassed,
      checks_failed: checksFailed,
      total_checks: totalChecks,
      summary: {
        unresolved_refs: unresolvedRefs,
        missing_config_keys: missingConfigKeys,
        data_flow_breaks: dataFlowBreaks,
        field_mismatches: fieldMismatches,
        cross_step_field_errors: crossStepFieldErrors,
        scatter_item_errors: scatterItemErrors,
        conditional_field_errors: conditionalFieldErrors,
      },
      dag,
    }
  }

  // ===========================
  // Phase A checks (1-6)
  // ===========================

  private checkUnresolvedRefs(stepLog: StepLogEntry[], issues: ValidationIssue[]): string[] {
    const allUnresolved: string[] = []
    for (const entry of stepLog) {
      for (const ref of entry.unresolved_refs) {
        allUnresolved.push(ref)
        issues.push({
          severity: 'error',
          check: 'unresolved_ref',
          step_id: entry.step_id,
          message: `Unresolved variable reference: ${ref}`,
        })
      }
    }
    return [...new Set(allUnresolved)]
  }

  private checkConfigCoverage(dslSteps: any[], workflowConfig: Record<string, any>, issues: ValidationIssue[]): string[] {
    const configRefs = VariableStore.collectConfigRefs(dslSteps)
    const configKeys = new Set(Object.keys(workflowConfig))
    const missing: string[] = []

    for (const ref of configRefs) {
      if (!configKeys.has(ref)) {
        missing.push(ref)
        issues.push({
          severity: 'warning',
          check: 'missing_config_key',
          message: `Config key "${ref}" referenced in DSL but not found in workflowConfig`,
        })
      }
    }

    const refsSet = new Set(configRefs)
    for (const key of configKeys) {
      if (!refsSet.has(key)) {
        issues.push({
          severity: 'info',
          check: 'unused_config_key',
          message: `Config key "${key}" exists in workflowConfig but is not referenced in any DSL step`,
        })
      }
    }

    return missing
  }

  private checkDataFlowChain(dslSteps: any[], issues: ValidationIssue[]): string[] {
    const breaks: string[] = []
    const producedVariables = new Set<string>()

    const walkSteps = (steps: any[], scatterItemVars: Set<string> = new Set()) => {
      for (const step of steps) {
        const inputRefs = collectInputVariables(step)
        for (const ref of inputRefs) {
          const baseName = ref.split('.')[0]
          if (baseName !== 'config' && !scatterItemVars.has(baseName) && !producedVariables.has(baseName)) {
            breaks.push(`${step.step_id}: references "${baseName}" not yet produced`)
            issues.push({
              severity: 'error',
              check: 'data_flow_break',
              step_id: step.step_id,
              message: `References variable "${baseName}" which has not been produced by any earlier step`,
            })
          }
        }

        if (step.output_variable) {
          producedVariables.add(step.output_variable)
        }

        if (step.scatter?.steps) {
          const itemVar = step.scatter.itemVariable || 'item'
          const nestedItemVars = new Set(scatterItemVars)
          nestedItemVars.add(itemVar)
          walkSteps(step.scatter.steps, nestedItemVars)
        }
        if (step.steps) walkSteps(step.steps, scatterItemVars)
        if (step.then_steps) walkSteps(step.then_steps, scatterItemVars)
        if (step.else_steps) walkSteps(step.else_steps, scatterItemVars)
      }
    }

    walkSteps(dslSteps)
    return breaks
  }

  private checkFieldConsistency(dslSteps: any[], issues: ValidationIssue[]): string[] {
    const mismatches: string[] = []
    const outputSchemas = new Map<string, any>()

    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.output_variable && step.output_schema) {
          outputSchemas.set(step.output_variable, step.output_schema)
        }

        const refs = VariableStore.collectAllRefs(step.config || step.params || {})
        for (const ref of refs) {
          const parts = ref.split('.')
          if (parts.length >= 2 && parts[0] !== 'config') {
            const varName = parts[0]
            const fieldName = parts[1]
            const schema = outputSchemas.get(varName)
            if (schema) {
              const knownFields = extractFieldNames(schema)
              if (knownFields.length > 0 && !knownFields.includes(fieldName)) {
                mismatches.push(`${step.step_id}: {{${ref}}} — field "${fieldName}" not in ${varName} schema (known: ${knownFields.join(', ')})`)
                issues.push({
                  severity: 'warning',
                  check: 'field_mismatch',
                  step_id: step.step_id,
                  message: `Field "${fieldName}" not found in "${varName}" output schema. Known fields: ${knownFields.join(', ')}`,
                })
              }
            }
          }
        }

        if (step.scatter?.steps) walkSteps(step.scatter.steps)
        if (step.steps) walkSteps(step.steps)
        if (step.then_steps) walkSteps(step.then_steps)
        if (step.else_steps) walkSteps(step.else_steps)
      }
    }

    walkSteps(dslSteps)
    return mismatches
  }

  private checkScatterGatherIntegrity(dslSteps: any[], issues: ValidationIssue[]): void {
    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.type === 'scatter_gather' && step.scatter) {
          const itemVar = step.scatter.itemVariable || 'item'
          const nestedSteps = step.scatter.steps || []
          const allRefs = VariableStore.collectAllRefs(nestedSteps)
          const usesItemVar = allRefs.some(ref => ref.startsWith(itemVar + '.') || ref === itemVar)

          if (!usesItemVar) {
            issues.push({
              severity: 'warning',
              check: 'scatter_gather_item_unused',
              step_id: step.step_id,
              message: `Scatter-gather itemVariable "${itemVar}" is not referenced in any nested step`,
            })
          }
          walkSteps(nestedSteps)
        }
        if (step.steps) walkSteps(step.steps)
        if (step.then_steps) walkSteps(step.then_steps)
        if (step.else_steps) walkSteps(step.else_steps)
      }
    }
    walkSteps(dslSteps)
  }

  private checkConditionalReachability(dslSteps: any[], issues: ValidationIssue[]): void {
    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.type === 'conditional') {
          if (!step.condition) {
            issues.push({ severity: 'error', check: 'conditional_no_condition', step_id: step.step_id, message: 'Conditional step has no condition defined' })
          }
          const thenSteps = step.steps || step.then_steps || []
          if (thenSteps.length === 0) {
            issues.push({ severity: 'warning', check: 'conditional_empty_then', step_id: step.step_id, message: 'Conditional step has no steps in "then" branch' })
          }
          walkSteps(thenSteps)
          walkSteps(step.else_steps || [])
        }
        if (step.scatter?.steps) walkSteps(step.scatter.steps)
      }
    }
    walkSteps(dslSteps)
  }

  // ===========================
  // Phase A+ checks (7-13)
  // ===========================

  /**
   * A+1: Cross-step field reference tracing.
   * For every {{variable.field}} in step configs, verify field exists in the
   * producing step's output_schema.properties.
   */
  private checkCrossStepFieldRefs(dslSteps: any[], issues: ValidationIssue[]): string[] {
    const errors: string[] = []
    const outputSchemas = new Map<string, any>()

    const walkSteps = (steps: any[], scatterItemVars: Map<string, any> = new Map()) => {
      for (const step of steps) {
        // Register output schema
        if (step.output_variable && step.output_schema) {
          outputSchemas.set(step.output_variable, step.output_schema)
        }

        // Collect ALL references from config, input, prompt
        const allRefs = collectAllStepRefs(step)

        for (const ref of allRefs) {
          const parts = ref.split('.')
          if (parts.length < 2) continue // bare variable, no field to check
          if (parts[0] === 'config') continue // config refs checked separately

          const varName = parts[0]
          const fieldName = parts[1]

          // Check scatter item variables
          if (scatterItemVars.has(varName)) {
            const itemSchema = scatterItemVars.get(varName)
            if (itemSchema) {
              const knownFields = extractFieldNames(itemSchema)
              if (knownFields.length > 0 && !knownFields.includes(fieldName)) {
                // This is handled by A+2, skip here to avoid duplicates
                continue
              }
            }
            continue
          }

          // Check step output schemas
          const schema = outputSchemas.get(varName)
          if (!schema) continue // variable exists but no schema — can't validate

          const knownFields = extractFieldNames(schema)
          if (knownFields.length > 0 && !knownFields.includes(fieldName)) {
            const msg = `${step.step_id}: {{${ref}}} — field "${fieldName}" not in "${varName}" output_schema (known: ${knownFields.join(', ')})`
            errors.push(msg)
            issues.push({
              severity: 'error',
              check: 'cross_step_field_ref',
              step_id: step.step_id,
              message: `Field "${fieldName}" does not exist in "${varName}" output_schema. Known fields: [${knownFields.join(', ')}]`,
            })
          }
        }

        // Walk nested with scatter item context
        if (step.scatter?.steps) {
          const itemVar = step.scatter.itemVariable || 'item'
          // Resolve scatter input's item schema
          const scatterInputRef = step.scatter.input?.match(/\{\{(.+?)\}\}/)?.[1]?.trim()
          let itemSchema: any = null
          if (scatterInputRef) {
            const sourceSchema = outputSchemas.get(scatterInputRef)
            if (sourceSchema?.type === 'array' && sourceSchema.items) {
              itemSchema = sourceSchema.items
            }
          }
          const nestedItemVars = new Map(scatterItemVars)
          nestedItemVars.set(itemVar, itemSchema)
          walkSteps(step.scatter.steps, nestedItemVars)
        }
        if (step.steps) walkSteps(step.steps, scatterItemVars)
        if (step.then_steps) walkSteps(step.then_steps, scatterItemVars)
        if (step.else_steps) walkSteps(step.else_steps, scatterItemVars)
      }
    }

    walkSteps(dslSteps)
    return errors
  }

  /**
   * A+2: Scatter-gather item field validation.
   * Verify {{itemVariable.field}} references exist in the scatter input's item schema.
   */
  private checkScatterItemFields(dslSteps: any[], issues: ValidationIssue[]): string[] {
    const errors: string[] = []
    const outputSchemas = new Map<string, any>()

    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.output_variable && step.output_schema) {
          outputSchemas.set(step.output_variable, step.output_schema)
        }

        if (step.type === 'scatter_gather' && step.scatter) {
          const itemVar = step.scatter.itemVariable || 'item'
          const nestedSteps = step.scatter.steps || []

          // Resolve scatter input's item schema
          const scatterInputRef = step.scatter.input?.match(/\{\{(.+?)\}\}/)?.[1]?.trim()
          let itemSchema: any = null
          if (scatterInputRef) {
            const sourceSchema = outputSchemas.get(scatterInputRef)
            if (sourceSchema?.type === 'array' && sourceSchema.items) {
              itemSchema = sourceSchema.items
            }
          }

          if (!itemSchema) {
            issues.push({
              severity: 'warning',
              check: 'scatter_item_no_schema',
              step_id: step.step_id,
              message: `Cannot validate scatter item fields — no item schema found for "${scatterInputRef}"`,
            })
          } else {
            // Check all {{itemVar.field}} references in nested steps
            const knownFields = extractFieldNames(itemSchema)
            const allRefs = VariableStore.collectAllRefs(nestedSteps)

            for (const ref of allRefs) {
              const parts = ref.split('.')
              if (parts[0] === itemVar && parts.length >= 2) {
                const fieldName = parts[1]
                if (knownFields.length > 0 && !knownFields.includes(fieldName)) {
                  const msg = `${step.step_id}: {{${ref}}} — item field "${fieldName}" not in scatter input schema (known: ${knownFields.join(', ')})`
                  errors.push(msg)
                  issues.push({
                    severity: 'error',
                    check: 'scatter_item_field_missing',
                    step_id: step.step_id,
                    message: `Scatter item field "${fieldName}" does not exist in input array item schema. Known fields: [${knownFields.join(', ')}]`,
                  })
                }
              }
            }
          }

          walkSteps(nestedSteps)
        }

        if (step.steps) walkSteps(step.steps)
        if (step.then_steps) walkSteps(step.then_steps)
        if (step.else_steps) walkSteps(step.else_steps)
      }
    }

    walkSteps(dslSteps)
    return errors
  }

  /**
   * A+3: Conditional condition field validation.
   * Verify condition field refs exist and types are compatible with operators.
   */
  private checkConditionalFields(dslSteps: any[], issues: ValidationIssue[]): string[] {
    const errors: string[] = []
    const producedVariables = new Map<string, any>() // varName -> output_schema

    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.output_variable) {
          producedVariables.set(step.output_variable, step.output_schema || null)
        }

        if (step.type === 'conditional' && step.condition) {
          this.validateConditionFields(step.step_id, step.condition, producedVariables, issues, errors)
        }

        if (step.scatter?.steps) walkSteps(step.scatter.steps)
        if (step.steps) walkSteps(step.steps)
        if (step.then_steps) walkSteps(step.then_steps)
        if (step.else_steps) walkSteps(step.else_steps)
      }
    }

    walkSteps(dslSteps)
    return errors
  }

  private validateConditionFields(
    stepId: string,
    condition: any,
    producedVariables: Map<string, any>,
    issues: ValidationIssue[],
    errors: string[]
  ): void {
    // Recurse into complex conditions
    if (condition.conditionType === 'complex_and' || condition.conditionType === 'complex_or') {
      for (const sub of condition.conditions || []) {
        this.validateConditionFields(stepId, sub, producedVariables, issues, errors)
      }
      return
    }

    const field = condition.field
    if (!field || field.startsWith('item.')) return // item refs handled by scatter checks

    const parts = field.split('.')
    const varName = parts[0]

    // Check variable exists
    if (!producedVariables.has(varName)) {
      const msg = `${stepId}: condition field "${field}" — variable "${varName}" not produced before this conditional`
      errors.push(msg)
      issues.push({
        severity: 'error',
        check: 'conditional_field_missing_var',
        step_id: stepId,
        message: `Condition references variable "${varName}" which has not been produced before this step`,
      })
      return
    }

    // Check field exists in schema (if schema available and field is nested)
    if (parts.length >= 2) {
      const schema = producedVariables.get(varName)
      if (schema) {
        const knownFields = extractFieldNames(schema)
        if (knownFields.length > 0 && !knownFields.includes(parts[1])) {
          const msg = `${stepId}: condition field "${field}" — "${parts[1]}" not in "${varName}" schema`
          errors.push(msg)
          issues.push({
            severity: 'error',
            check: 'conditional_field_not_in_schema',
            step_id: stepId,
            message: `Condition field "${parts[1]}" not found in "${varName}" output_schema. Known: [${knownFields.join(', ')}]`,
          })
        }
      }
    }

    // Type compatibility check
    const operator = condition.operator
    const numericOps = ['gt', 'gte', 'lt', 'lte', 'greater_than', 'less_than']
    if (numericOps.includes(operator) && parts.length >= 2) {
      const schema = producedVariables.get(varName)
      if (schema) {
        const fieldType = getFieldType(schema, parts[1])
        if (fieldType && fieldType !== 'number' && fieldType !== 'integer') {
          issues.push({
            severity: 'warning',
            check: 'conditional_type_mismatch',
            step_id: stepId,
            message: `Condition uses numeric operator "${operator}" on field "${field}" which has type "${fieldType}" (expected number)`,
          })
        }
      }
    }
  }

  /**
   * A+4: Config value type checking.
   * Verify config value types match consuming plugin parameter types.
   */
  private checkConfigValueTypes(dslSteps: any[], workflowConfig: Record<string, any>, issues: ValidationIssue[]): void {
    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.type === 'action' && step.output_schema) {
          // Check config values used in this step
          const config = step.config || step.params || {}
          for (const [paramName, paramValue] of Object.entries(config)) {
            if (typeof paramValue === 'string' && paramValue.match(/^\{\{config\.(.+?)\}\}$/)) {
              const configKey = paramValue.match(/^\{\{config\.(.+?)\}\}$/)?.[1]
              if (configKey && configKey in workflowConfig) {
                const actualValue = workflowConfig[configKey]
                const actualType = typeof actualValue

                // Check if value type is compatible with typical expectations
                if (paramName.includes('max_results') || paramName.includes('count') || paramName.includes('threshold')) {
                  if (actualType !== 'number') {
                    issues.push({
                      severity: 'warning',
                      check: 'config_type_mismatch',
                      step_id: step.step_id,
                      message: `Config "${configKey}" has type "${actualType}" but parameter "${paramName}" expects a number`,
                    })
                  }
                }
              }
            }
          }
        }

        if (step.scatter?.steps) walkSteps(step.scatter.steps)
        if (step.steps) walkSteps(step.steps)
        if (step.then_steps) walkSteps(step.then_steps)
        if (step.else_steps) walkSteps(step.else_steps)
      }
    }
    walkSteps(dslSteps)
  }

  /**
   * A+5: Output schema completeness.
   * Flag action steps with output_variable but no output_schema.
   */
  private checkOutputSchemaCompleteness(dslSteps: any[], issues: ValidationIssue[]): void {
    const walkSteps = (steps: any[]) => {
      for (const step of steps) {
        if (step.type === 'action' && step.output_variable && !step.output_schema) {
          issues.push({
            severity: 'warning',
            check: 'missing_output_schema',
            step_id: step.step_id,
            message: `Action step has output_variable "${step.output_variable}" but no output_schema — downstream validation and stub generation not possible`,
          })
        }

        if (step.scatter?.steps) walkSteps(step.scatter.steps)
        if (step.steps) walkSteps(step.steps)
        if (step.then_steps) walkSteps(step.then_steps)
        if (step.else_steps) walkSteps(step.else_steps)
      }
    }
    walkSteps(dslSteps)
  }

  /**
   * A+6: Duplicate output variable detection.
   * Flag if two steps at the same scope write to the same output_variable.
   */
  private checkDuplicateOutputVars(dslSteps: any[], issues: ValidationIssue[]): void {
    const checkScope = (steps: any[], scopeLabel: string) => {
      const seen = new Map<string, string>() // varName -> first step_id

      for (const step of steps) {
        if (step.output_variable) {
          const varName = step.output_variable
          if (seen.has(varName)) {
            issues.push({
              severity: 'error',
              check: 'duplicate_output_var',
              step_id: step.step_id,
              message: `Output variable "${varName}" already produced by ${seen.get(varName)} in ${scopeLabel} scope — one will silently overwrite the other`,
            })
          } else {
            seen.set(varName, step.step_id)
          }
        }

        // Check nested scopes independently
        if (step.scatter?.steps) checkScope(step.scatter.steps, `scatter(${step.step_id})`)
        if (step.steps) checkScope(step.steps, `conditional-then(${step.step_id})`)
        if (step.then_steps) checkScope(step.then_steps, `conditional-then(${step.step_id})`)
        if (step.else_steps) checkScope(step.else_steps, `conditional-else(${step.step_id})`)
      }
    }

    checkScope(dslSteps, 'top-level')
  }

  /**
   * A+7: Build execution DAG string.
   */
  buildDAG(dslSteps: any[]): string {
    const parts: string[] = []

    const formatSteps = (steps: any[], indent: number = 0): void => {
      const pad = '  '.repeat(indent)
      for (const step of steps) {
        const id = step.step_id || step.id
        const type = step.type
        const plugin = step.plugin ? `${step.plugin}/${step.operation || step.action}` : ''
        const output = step.output_variable ? ` → ${step.output_variable}` : ''

        if (type === 'scatter_gather') {
          const itemVar = step.scatter?.itemVariable || 'item'
          const inputRef = step.scatter?.input?.match(/\{\{(.+?)\}\}/)?.[1] || '?'
          parts.push(`${pad}${id} [scatter_gather] foreach ${itemVar} in ${inputRef}${output}`)
          if (step.scatter?.steps) {
            formatSteps(step.scatter.steps, indent + 1)
          }
          const gatherOp = step.gather?.operation || 'collect'
          parts.push(`${pad}  └─ gather: ${gatherOp}`)
        } else if (type === 'conditional') {
          const condField = step.condition?.field || '?'
          const condOp = step.condition?.operator || '?'
          parts.push(`${pad}${id} [conditional] if ${condField} ${condOp}`)
          const thenSteps = step.steps || step.then_steps || []
          const elseSteps = step.else_steps || []
          if (thenSteps.length > 0) {
            parts.push(`${pad}  then:`)
            formatSteps(thenSteps, indent + 2)
          }
          if (elseSteps.length > 0) {
            parts.push(`${pad}  else:`)
            formatSteps(elseSteps, indent + 2)
          }
        } else {
          const typeLabel = plugin ? `${type}: ${plugin}` : type
          parts.push(`${pad}${id} [${typeLabel}]${output}`)
        }
      }
    }

    formatSteps(dslSteps)
    return parts.join('\n')
  }
}

// --- Helper functions ---

/**
 * Collect ALL variable references from a step (config, input, prompt, condition).
 */
function collectAllStepRefs(step: any): string[] {
  const refs: string[] = []
  const seen = new Set<string>()

  function addRefs(obj: any) {
    const found = VariableStore.collectAllRefs(obj)
    for (const ref of found) {
      if (!seen.has(ref)) {
        seen.add(ref)
        refs.push(ref)
      }
    }
  }

  addRefs(step.config || step.params || {})
  if (step.input) addRefs({ input: step.input })
  if (step.prompt) addRefs({ prompt: step.prompt })

  return refs
}

function collectInputVariables(step: any): string[] {
  const refs: string[] = []

  if (step.input && typeof step.input === 'string') {
    const match = step.input.match(/\{\{(.+?)\}\}/)
    if (match) refs.push(match[1].trim())
  }

  const configRefs = VariableStore.collectAllRefs(step.config || step.params || {})
  refs.push(...configRefs)

  if (step.scatter?.input) {
    const match = step.scatter.input.match(/\{\{(.+?)\}\}/)
    if (match) refs.push(match[1].trim())
  }

  if (step.prompt) {
    const promptRefs = VariableStore.collectAllRefs({ prompt: step.prompt })
    refs.push(...promptRefs)
  }

  return refs
}

function extractFieldNames(schema: any): string[] {
  if (!schema) return []
  if (schema.properties) return Object.keys(schema.properties)
  if (schema.type === 'array' && schema.items?.properties) return Object.keys(schema.items.properties)
  return []
}

function getFieldType(schema: any, fieldName: string): string | null {
  const props = schema?.properties || schema?.items?.properties
  if (!props || !props[fieldName]) return null
  return props[fieldName].type || null
}
