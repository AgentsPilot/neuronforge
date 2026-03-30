/**
 * Validate PILOT DSL Against Execution Layer
 *
 * This validates the generated PILOT DSL against the ACTUAL execution layer requirements
 * by checking what StepExecutor, ParallelExecutor, and ConditionalEvaluator expect.
 *
 * Tests logical accuracy WITHOUT executing (no real data needed).
 */

import fs from 'fs'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

interface PilotStep {
  step_id: string
  type: string
  plugin?: string
  operation?: string
  config?: any
  input?: string
  output_variable?: string
  condition?: any
  steps?: PilotStep[]
  else_steps?: PilotStep[]
  prompt?: string
  description?: string
}

interface ValidationIssue {
  severity: 'CRITICAL' | 'ERROR' | 'WARNING' | 'INFO'
  step_id: string
  issue: string
  details: string
  will_fail_at_runtime: boolean
  execution_layer_requirement: string
}

class ExecutionLayerValidator {
  private issues: ValidationIssue[] = []
  private variables = new Set<string>()
  private pluginManager?: PluginManagerV2

  constructor(pluginManager?: PluginManagerV2) {
    this.pluginManager = pluginManager
  }

  async validate(steps: PilotStep[], workflowName: string): Promise<ValidationIssue[]> {
    this.issues = []
    this.variables = new Set<string>()

    console.log(`\n${'='.repeat(80)}`)
    console.log(`🔍 Validating: ${workflowName}`)
    console.log(`   Against: StepExecutor, ParallelExecutor, ConditionalEvaluator`)
    console.log('='.repeat(80))

    await this.validateSteps(steps, [])

    return this.issues
  }

  private async validateSteps(steps: PilotStep[], scope: string[]) {
    for (const step of steps) {
      console.log(`\nStep ${step.step_id} (${step.type}):`)

      // Track output variables
      if (step.output_variable) {
        this.variables.add(step.output_variable)
        console.log(`  ✅ Declares output: ${step.output_variable}`)
      }

      // Validate based on step type (what StepExecutor expects)
      switch (step.type) {
        case 'action':
          await this.validateActionStep(step, scope)
          break
        case 'ai_processing':
        case 'llm_decision':
          this.validateAIStep(step, scope)
          break
        case 'transform':
          this.validateTransformStep(step, scope)
          break
        case 'conditional':
          await this.validateConditionalStep(step, scope)
          break
        case 'loop':
          this.validateLoopStep(step, scope)
          break
        case 'parallel':
        case 'scatter_gather':
          this.validateParallelStep(step, scope)
          break
        default:
          this.issues.push({
            severity: 'WARNING',
            step_id: step.step_id,
            issue: `Unknown step type: ${step.type}`,
            details: `StepExecutor may not know how to handle this type`,
            will_fail_at_runtime: false,
            execution_layer_requirement: 'StepExecutor.execute() switch statement'
          })
      }
    }
  }

  private async validateActionStep(step: PilotStep, scope: string[]) {
    const { step_id, plugin, operation, config } = step

    // REQUIREMENT 1: Plugin and operation must be specified
    if (!plugin) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Missing plugin field',
        details: 'Action step must have "plugin" field',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'StepExecutor.executeAction() requires step.plugin'
      })
      console.log(`  ❌ CRITICAL: Missing plugin field`)
      return
    }

    if (!operation) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Missing operation field',
        details: 'Action step must have "operation" field',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'StepExecutor.executeAction() requires step.operation'
      })
      console.log(`  ❌ CRITICAL: Missing operation field`)
      return
    }

    console.log(`  ✅ Plugin: ${plugin}, Operation: ${operation}`)

    // REQUIREMENT 2: Plugin must exist in PluginExecuterV2 registry
    if (this.pluginManager) {
      const allPlugins = this.pluginManager.getAvailablePlugins()
      const pluginDef = allPlugins[plugin]

      if (!pluginDef) {
        this.issues.push({
          severity: 'CRITICAL',
          step_id,
          issue: `Plugin '${plugin}' not found in registry`,
          details: `PluginExecuterV2 won't be able to execute this plugin`,
          will_fail_at_runtime: true,
          execution_layer_requirement: 'PluginExecuterV2.execute() requires registered plugin'
        })
        console.log(`  ❌ CRITICAL: Plugin '${plugin}' not in registry`)
        return
      }

      // REQUIREMENT 3: Action must exist in plugin definition
      const action = pluginDef.actions?.[operation]
      if (!action) {
        this.issues.push({
          severity: 'CRITICAL',
          step_id,
          issue: `Action '${operation}' not found in plugin '${plugin}'`,
          details: `Plugin executor will throw error: action not found`,
          will_fail_at_runtime: true,
          execution_layer_requirement: 'PluginExecuterV2 requires action to exist in plugin schema'
        })
        console.log(`  ❌ CRITICAL: Action '${operation}' not in plugin '${plugin}'`)
        return
      }

      console.log(`  ✅ Action exists in plugin schema`)

      // REQUIREMENT 4: Required parameters must be present
      const requiredParams = action.parameters?.required || []
      const providedParams = Object.keys(config || {})

      for (const requiredParam of requiredParams) {
        if (!providedParams.includes(requiredParam)) {
          this.issues.push({
            severity: 'CRITICAL',
            step_id,
            issue: `Missing required parameter: ${requiredParam}`,
            details: `Plugin will reject execution: missing ${requiredParam}`,
            will_fail_at_runtime: true,
            execution_layer_requirement: `${plugin}.${operation} requires parameter '${requiredParam}'`
          })
          console.log(`  ❌ CRITICAL: Missing required param '${requiredParam}'`)
        } else {
          console.log(`  ✅ Required param '${requiredParam}' present`)
        }
      }

      // REQUIREMENT 5: Variable references must be resolvable
      this.validateVariableReferences(step_id, config, scope)
    }
  }

  private validateAIStep(step: PilotStep, scope: string[]) {
    const { step_id, prompt, config } = step

    // REQUIREMENT 1: Must have prompt or instruction
    if (!prompt && !config?.instruction) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Missing prompt/instruction',
        details: 'AI step must have "prompt" or config.instruction',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'StepExecutor.executeLLMDecision() requires prompt'
      })
      console.log(`  ❌ CRITICAL: Missing prompt`)
      return
    }

    console.log(`  ✅ Has prompt/instruction`)

    // REQUIREMENT 2: Output schema should be defined for structured outputs
    if (!config?.output_schema) {
      this.issues.push({
        severity: 'WARNING',
        step_id,
        issue: 'Missing output_schema',
        details: 'AI output will be unstructured text. Downstream steps expecting fields may fail.',
        will_fail_at_runtime: false,
        execution_layer_requirement: 'runAgentKit uses output_schema for structured extraction'
      })
      console.log(`  ⚠️  WARNING: No output_schema (unstructured output)`)
    } else {
      console.log(`  ✅ Has output_schema`)

      // REQUIREMENT 3: Output schema should define expected fields
      const properties = config.output_schema.properties
      if (properties) {
        const fields = Object.keys(properties)
        console.log(`  ✅ Output fields: ${fields.join(', ')}`)

        // Check if downstream steps reference these fields
        if (step.output_variable) {
          // This is informational - we'd need to scan all subsequent steps
          console.log(`  ℹ️  Output stored in: ${step.output_variable}`)
        }
      }
    }

    // REQUIREMENT 4: Input variable references must exist
    if (config?.input || step.input) {
      const inputRef = config?.input || step.input
      this.validateVariableReference(step_id, inputRef, scope, 'AI input')
    }
  }

  private validateTransformStep(step: PilotStep, scope: string[]) {
    const { step_id, operation, input, config } = step

    // REQUIREMENT 1: Must have operation type
    if (!operation) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Missing transform operation',
        details: 'Transform step must specify operation (filter, map, reduce, etc.)',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'StepExecutor.executeTransform() requires step.operation'
      })
      console.log(`  ❌ CRITICAL: Missing operation`)
      return
    }

    console.log(`  ✅ Operation: ${operation}`)

    // REQUIREMENT 2: Supported transform types
    const supportedOps = [
      'filter', 'map', 'reduce', 'sort', 'group', 'aggregate',
      'flatten', 'select', 'merge', 'rows_to_objects'
    ]

    if (!supportedOps.includes(operation)) {
      this.issues.push({
        severity: 'ERROR',
        step_id,
        issue: `Unknown transform operation: ${operation}`,
        details: `StepExecutor.executeTransform() may not support this operation`,
        will_fail_at_runtime: true,
        execution_layer_requirement: 'DataOperations must support this transform type'
      })
      console.log(`  ❌ ERROR: Unsupported operation '${operation}'`)
    } else {
      console.log(`  ✅ Supported operation`)
    }

    // REQUIREMENT 3: Input must reference existing variable
    if (input) {
      this.validateVariableReference(step_id, input, scope, 'transform input')
    } else if (config?.input) {
      this.validateVariableReference(step_id, config.input, scope, 'transform input')
    } else {
      this.issues.push({
        severity: 'ERROR',
        step_id,
        issue: 'Transform has no input',
        details: 'Transform operations require input data',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'StepExecutor.executeTransform() needs input array'
      })
      console.log(`  ❌ ERROR: Missing input`)
    }

    // REQUIREMENT 4: Operation-specific validations
    if (operation === 'filter' && config?.condition) {
      this.validateCondition(step_id, config.condition, scope, 'filter condition')
    }

    if (operation === 'reduce' && !config?.reducer && !config?.reduce_operation) {
      this.issues.push({
        severity: 'ERROR',
        step_id,
        issue: 'Reduce operation missing reducer',
        details: 'Must specify reducer (count, sum, avg, etc.)',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'DataOperations.reduce() requires reducer function'
      })
      console.log(`  ❌ ERROR: Reduce missing reducer`)
    }
  }

  private async validateConditionalStep(step: PilotStep, scope: string[]) {
    const { step_id, condition, steps, else_steps } = step

    // REQUIREMENT 1: Must have condition
    if (!condition) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Conditional step missing condition',
        details: 'Cannot evaluate which branch to take',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'ConditionalEvaluator.evaluate() requires condition'
      })
      console.log(`  ❌ CRITICAL: Missing condition`)
      return
    }

    console.log(`  ✅ Has condition`)

    // REQUIREMENT 2: Condition must be valid format
    this.validateCondition(step_id, condition, scope, 'conditional')

    // REQUIREMENT 3: Must have at least then or else branch
    if (!steps && !else_steps) {
      this.issues.push({
        severity: 'WARNING',
        step_id,
        issue: 'Conditional has no branches',
        details: 'No steps or else_steps defined - conditional does nothing',
        will_fail_at_runtime: false,
        execution_layer_requirement: 'StepExecutor expects steps or else_steps array'
      })
      console.log(`  ⚠️  WARNING: No branches defined`)
    } else {
      if (steps) {
        console.log(`  ✅ Then branch: ${steps.length} steps`)
        // Validate then branch steps
        await this.validateSteps(steps, [...scope, `${step_id}:then`])
      }

      if (else_steps) {
        console.log(`  ✅ Else branch: ${else_steps.length} steps`)
        // Validate else branch steps
        await this.validateSteps(else_steps, [...scope, `${step_id}:else`])
      }
    }
  }

  private validateLoopStep(step: PilotStep, scope: string[]) {
    const { step_id, config } = step

    // REQUIREMENT 1: Must have items to iterate over
    const itemsRef = config?.items || config?.iterate_over
    if (!itemsRef) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Loop missing items/iterate_over',
        details: 'No array to iterate over',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'ParallelExecutor.executeLoop() requires items array'
      })
      console.log(`  ❌ CRITICAL: Missing items to iterate`)
      return
    }

    console.log(`  ✅ Iterates over: ${itemsRef}`)
    this.validateVariableReference(step_id, itemsRef, scope, 'loop items')

    // REQUIREMENT 2: Must have steps to execute per item
    if (!step.steps || step.steps.length === 0) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Loop has no steps',
        details: 'Nothing to execute per iteration',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'ParallelExecutor requires steps array in loop body'
      })
      console.log(`  ❌ CRITICAL: No loop body steps`)
    } else {
      console.log(`  ✅ Loop body: ${step.steps.length} steps`)
    }

    // REQUIREMENT 3: Concurrency mode should be valid
    const mode = config?.mode || config?.concurrency_mode
    if (mode && !['sequential', 'parallel'].includes(mode)) {
      this.issues.push({
        severity: 'WARNING',
        step_id,
        issue: `Unknown concurrency mode: ${mode}`,
        details: 'Should be "sequential" or "parallel"',
        will_fail_at_runtime: false,
        execution_layer_requirement: 'ParallelExecutor defaults to sequential if unknown'
      })
      console.log(`  ⚠️  WARNING: Unknown mode '${mode}'`)
    }
  }

  private validateParallelStep(step: PilotStep, scope: string[]) {
    const { step_id } = step

    // REQUIREMENT: Must have steps to execute in parallel
    if (!step.steps || step.steps.length === 0) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: 'Parallel step has no steps',
        details: 'Nothing to execute in parallel',
        will_fail_at_runtime: true,
        execution_layer_requirement: 'ParallelExecutor.executeParallel() requires steps array'
      })
      console.log(`  ❌ CRITICAL: No parallel steps`)
    } else {
      console.log(`  ✅ Parallel steps: ${step.steps.length}`)
    }
  }

  private validateCondition(
    step_id: string,
    condition: any,
    scope: string[],
    context: string
  ) {
    if (!condition) return

    const conditionType = condition.conditionType || 'simple'

    console.log(`  ✅ Condition type: ${conditionType}`)

    if (conditionType === 'simple') {
      // REQUIREMENT: Simple condition needs field, operator, value
      if (!condition.field) {
        this.issues.push({
          severity: 'ERROR',
          step_id,
          issue: `${context}: missing field`,
          details: 'Simple condition requires field to check',
          will_fail_at_runtime: true,
          execution_layer_requirement: 'ConditionalEvaluator.evaluateSimple() requires field'
        })
        console.log(`  ❌ ERROR: Condition missing field`)
      } else {
        // Check if field references existing variable
        this.validateVariableReference(step_id, condition.field, scope, `${context} field`)
      }

      if (!condition.operator) {
        this.issues.push({
          severity: 'ERROR',
          step_id,
          issue: `${context}: missing operator`,
          details: 'Condition requires comparison operator',
          will_fail_at_runtime: true,
          execution_layer_requirement: 'ConditionalEvaluator requires operator'
        })
        console.log(`  ❌ ERROR: Condition missing operator`)
      } else {
        // Validate operator
        const validOperators = [
          'equals', 'not_equals', 'greater_than', 'less_than',
          'greater_than_or_equal', 'less_than_or_equal',
          'contains', 'not_contains', 'starts_with', 'ends_with',
          'is_empty', 'is_not_empty', 'in', 'not_in'
        ]

        if (!validOperators.includes(condition.operator)) {
          this.issues.push({
            severity: 'WARNING',
            step_id,
            issue: `${context}: unknown operator '${condition.operator}'`,
            details: `Supported: ${validOperators.join(', ')}`,
            will_fail_at_runtime: false,
            execution_layer_requirement: 'ConditionalEvaluator may not recognize operator'
          })
          console.log(`  ⚠️  WARNING: Unknown operator '${condition.operator}'`)
        } else {
          console.log(`  ✅ Valid operator: ${condition.operator}`)
        }
      }
    } else if (conditionType === 'complex_and' || conditionType === 'complex_or') {
      // Recursive validation of sub-conditions
      if (condition.conditions && Array.isArray(condition.conditions)) {
        console.log(`  ✅ Complex condition with ${condition.conditions.length} sub-conditions`)
        condition.conditions.forEach((subCond: any) => {
          this.validateCondition(step_id, subCond, scope, `${context} sub-condition`)
        })
      }
    }
  }

  private validateVariableReferences(step_id: string, config: any, scope: string[]) {
    if (!config) return

    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
        this.validateVariableReference(step_id, value, scope, `config.${key}`)
      } else if (typeof value === 'object' && value !== null) {
        this.validateVariableReferences(step_id, value, scope)
      }
    }
  }

  private validateVariableReference(
    step_id: string,
    ref: string,
    scope: string[],
    context: string
  ) {
    // Extract variable name from {{variable}} or {{variable.field}}
    const match = ref.match(/\{\{([^}]+)\}\}/)
    if (!match) {
      // Check if it's a plain variable reference (no {{}})
      if (ref.includes('.') && !ref.startsWith('item.') && !ref.startsWith('config.')) {
        // Could be missing {{}} wrapper
        const varName = ref.split('.')[0]
        if (this.variables.has(varName)) {
          this.issues.push({
            severity: 'ERROR',
            step_id,
            issue: `${context}: variable reference missing {{}} wrapper`,
            details: `Reference "${ref}" should be "{{${ref}}}"`,
            will_fail_at_runtime: true,
            execution_layer_requirement: 'ExecutionContext.resolveVariable() requires {{}} format'
          })
          console.log(`  ❌ ERROR: ${context} missing {{}} wrapper`)
        }
      }
      return
    }

    const fullRef = match[1]
    const parts = fullRef.split('.')
    const varName = parts[0]

    // Skip special references
    if (varName === 'config' || varName === 'item') {
      console.log(`  ✅ ${context}: uses ${varName} (special ref)`)
      return
    }

    // Check if variable exists
    if (!this.variables.has(varName)) {
      this.issues.push({
        severity: 'CRITICAL',
        step_id,
        issue: `${context}: undefined variable '${varName}'`,
        details: `Variable ${varName} not found in execution context`,
        will_fail_at_runtime: true,
        execution_layer_requirement: 'ExecutionContext.resolveVariable() will throw error'
      })
      console.log(`  ❌ CRITICAL: ${context} references undefined '${varName}'`)
    } else {
      console.log(`  ✅ ${context}: variable '${varName}' exists`)
    }
  }
}

async function main() {
  const workflows = [
    { file: 'enhanced-prompt-complaint-logger.json', name: 'complaint-logger' },
    { file: 'enhanced-prompt-expense-extractor.json', name: 'expense-extractor' },
    { file: 'enhanced-prompt-invoice-extraction.json', name: 'invoice-extraction' },
    { file: 'enhanced-prompt-lead-sales-followup.json', name: 'lead-sales-followup' },
    { file: 'enhanced-prompt-leads-filter.json', name: 'leads-filter' }
  ]

  // Initialize plugin manager for schema validation
  const pluginManager = await PluginManagerV2.getInstance()
  const validator = new ExecutionLayerValidator(pluginManager)

  const allResults: Record<string, ValidationIssue[]> = {}

  for (const workflow of workflows) {
    // Run pipeline to generate PILOT DSL
    const { execSync } = await import('child_process')
    try {
      execSync(`npx tsx scripts/test-complete-pipeline-with-vocabulary.ts ${workflow.file}`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      })
    } catch (error) {
      console.error(`❌ Pipeline failed for ${workflow.name}`)
      continue
    }

    // Load generated PILOT DSL
    const pilotFile = 'output/vocabulary-pipeline/pilot-dsl-steps.json'
    if (!fs.existsSync(pilotFile)) {
      console.error(`❌ No PILOT DSL generated for ${workflow.name}`)
      continue
    }

    const steps = JSON.parse(fs.readFileSync(pilotFile, 'utf-8'))
    const issues = await validator.validate(steps, workflow.name)
    allResults[workflow.name] = issues
  }

  // Generate summary report
  console.log(`\n${'='.repeat(80)}`)
  console.log('EXECUTION LAYER VALIDATION SUMMARY')
  console.log('='.repeat(80))

  let totalCritical = 0
  let totalError = 0
  let totalWillFail = 0

  for (const [workflow, issues] of Object.entries(allResults)) {
    const critical = issues.filter(i => i.severity === 'CRITICAL').length
    const error = issues.filter(i => i.severity === 'ERROR').length
    const willFail = issues.filter(i => i.will_fail_at_runtime).length

    totalCritical += critical
    totalError += error
    totalWillFail += willFail

    const status = critical > 0 ? '🔴 CRITICAL' : error > 0 ? '🟠 ERRORS' : willFail > 0 ? '⚠️  WARNINGS' : '✅ PASSED'
    console.log(`\n${workflow}:`)
    console.log(`  Status: ${status}`)
    console.log(`  Critical: ${critical}, Errors: ${error}, Will Fail: ${willFail}/${issues.length}`)

    if (willFail > 0) {
      console.log(`  Issues that will fail at runtime:`)
      issues.filter(i => i.will_fail_at_runtime).forEach(issue => {
        console.log(`    - [${issue.step_id}] ${issue.issue}`)
      })
    }
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`TOTAL:`)
  console.log(`  ${totalWillFail} issues will cause runtime failures`)
  console.log(`  ${totalCritical} CRITICAL issues`)
  console.log(`  ${totalError} ERROR issues`)
  console.log('='.repeat(80))

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    validation_layer: 'Execution Layer (StepExecutor, ParallelExecutor, ConditionalEvaluator)',
    summary: {
      total_workflows: workflows.length,
      workflows_with_issues: Object.values(allResults).filter(i => i.length > 0).length,
      workflows_will_fail: Object.values(allResults).filter(i => i.some(issue => issue.will_fail_at_runtime)).length,
      total_critical: totalCritical,
      total_error: totalError,
      total_will_fail: totalWillFail
    },
    workflows: allResults
  }

  fs.writeFileSync(
    'EXECUTION-LAYER-VALIDATION-REPORT.json',
    JSON.stringify(report, null, 2)
  )
  console.log(`\n📄 Detailed report saved to: EXECUTION-LAYER-VALIDATION-REPORT.json`)

  process.exit(totalWillFail > 0 ? 1 : 0)
}

main().catch(console.error)
