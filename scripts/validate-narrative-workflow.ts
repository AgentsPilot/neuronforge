/**
 * Comprehensive Validation of Narrative Prompt Generated Workflow
 *
 * Validates:
 * 1. Data Flow - Variables declared before use
 * 2. Loop Structure - Scatter-gather correctness
 * 3. Conditional Logic - Nested conditionals, variable scoping
 * 4. Parameters - All required params present, config references valid
 * 5. Plugin Schema Compliance - Action parameters match schemas
 * 6. Execution Layer Compatibility - StepExecutor expectations
 */

import fs from 'fs'
import path from 'path'
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2'

interface ValidationIssue {
  severity: 'error' | 'warning' | 'info'
  category: string
  step_id: string
  message: string
  details?: any
}

interface PilotStep {
  step_id: string
  type: string
  plugin?: string
  operation?: string
  config?: any
  input?: string | any
  output_variable?: string
  scatter?: {
    input: string
    steps: PilotStep[]
    itemVariable: string
  }
  gather?: any
  condition?: any
  steps?: PilotStep[]
  else_steps?: PilotStep[]
  description?: string
}

class NarrativeWorkflowValidator {
  private issues: ValidationIssue[] = []
  private declaredVariables = new Set<string>()
  private configKeys = new Set<string>()
  private pluginManager: any

  constructor(pluginManager: any) {
    this.pluginManager = pluginManager
  }

  async validate(workflow: PilotStep[], workflowConfig: Record<string, any>): Promise<ValidationIssue[]> {
    this.issues = []
    this.declaredVariables = new Set<string>()
    this.configKeys = new Set(Object.keys(workflowConfig))

    console.log('\n🔍 COMPREHENSIVE WORKFLOW VALIDATION')
    console.log('=' .repeat(80))

    // Phase 1: Data Flow Analysis
    console.log('\n📊 Phase 1: Data Flow Analysis')
    console.log('-'.repeat(80))
    this.validateDataFlow(workflow)

    // Phase 2: Loop Structure Validation
    console.log('\n🔄 Phase 2: Loop Structure Validation')
    console.log('-'.repeat(80))
    this.validateLoops(workflow)

    // Phase 3: Conditional Logic Validation
    console.log('\n🔀 Phase 3: Conditional Logic Validation')
    console.log('-'.repeat(80))
    this.validateConditionals(workflow)

    // Phase 4: Parameter Validation
    console.log('\n⚙️  Phase 4: Parameter Validation')
    console.log('-'.repeat(80))
    await this.validateParameters(workflow)

    // Phase 5: Config Reference Validation
    console.log('\n🔧 Phase 5: Config Reference Validation')
    console.log('-'.repeat(80))
    this.validateConfigReferences(workflow)

    // Phase 6: Variable Reference Validation
    console.log('\n🔗 Phase 6: Variable Reference Validation')
    console.log('-'.repeat(80))
    this.validateVariableReferences(workflow)

    // Summary
    this.printSummary()

    return this.issues
  }

  private validateDataFlow(steps: PilotStep[], scopeVars = new Set<string>()) {
    const localVars = new Set([...this.declaredVariables, ...scopeVars])

    for (const step of steps) {
      // Check input references
      if (step.input) {
        const inputVars = this.extractVariableReferences(step.input)
        for (const varName of inputVars) {
          if (!localVars.has(varName)) {
            this.issues.push({
              severity: 'error',
              category: 'data_flow',
              step_id: step.step_id,
              message: `Variable '${varName}' used before declaration`,
              details: { input: step.input }
            })
          }
        }
      }

      // Check config references in step
      if (step.config) {
        const configRefs = this.extractVariableReferences(JSON.stringify(step.config))
        for (const varName of configRefs) {
          if (!localVars.has(varName)) {
            this.issues.push({
              severity: 'error',
              category: 'data_flow',
              step_id: step.step_id,
              message: `Variable '${varName}' used in config before declaration`,
              details: { config: step.config }
            })
          }
        }
      }

      // Declare output variable
      if (step.output_variable) {
        localVars.add(step.output_variable)
        this.declaredVariables.add(step.output_variable)
        console.log(`   ✅ ${step.step_id}: Declares '${step.output_variable}'`)
      }

      // Recurse into scatter-gather
      if (step.scatter) {
        const itemVar = step.scatter.itemVariable
        const scatterScope = new Set([...localVars, itemVar])
        console.log(`   🔄 ${step.step_id}: Loop scope adds '${itemVar}'`)
        this.validateDataFlow(step.scatter.steps, scatterScope)
      }

      // Recurse into conditionals
      if (step.steps || step.else_steps) {
        if (step.steps) this.validateDataFlow(step.steps, localVars)
        if (step.else_steps) this.validateDataFlow(step.else_steps, localVars)
      }
    }
  }

  private validateLoops(steps: PilotStep[], depth = 0) {
    for (const step of steps) {
      if (step.type === 'scatter_gather') {
        console.log(`   ${'  '.repeat(depth)}🔄 ${step.step_id}: Loop over ${step.scatter?.input}`)

        // Validate scatter structure
        if (!step.scatter) {
          this.issues.push({
            severity: 'error',
            category: 'loop_structure',
            step_id: step.step_id,
            message: 'scatter_gather step missing scatter property'
          })
          continue
        }

        if (!step.scatter.input) {
          this.issues.push({
            severity: 'error',
            category: 'loop_structure',
            step_id: step.step_id,
            message: 'scatter.input is required'
          })
        }

        if (!step.scatter.itemVariable) {
          this.issues.push({
            severity: 'error',
            category: 'loop_structure',
            step_id: step.step_id,
            message: 'scatter.itemVariable is required'
          })
        }

        if (!step.scatter.steps || step.scatter.steps.length === 0) {
          this.issues.push({
            severity: 'warning',
            category: 'loop_structure',
            step_id: step.step_id,
            message: 'scatter.steps is empty'
          })
        }

        if (!step.gather) {
          this.issues.push({
            severity: 'error',
            category: 'loop_structure',
            step_id: step.step_id,
            message: 'scatter_gather step missing gather property'
          })
        }

        if (!step.output_variable) {
          this.issues.push({
            severity: 'error',
            category: 'loop_structure',
            step_id: step.step_id,
            message: 'scatter_gather step missing output_variable'
          })
        }

        console.log(`   ${'  '.repeat(depth)}   Item variable: ${step.scatter.itemVariable}`)
        console.log(`   ${'  '.repeat(depth)}   Output: ${step.output_variable}`)
        console.log(`   ${'  '.repeat(depth)}   Inner steps: ${step.scatter.steps.length}`)

        // Recurse into loop body
        this.validateLoops(step.scatter.steps, depth + 1)
      }

      // Recurse into conditionals
      if (step.steps) this.validateLoops(step.steps, depth)
      if (step.else_steps) this.validateLoops(step.else_steps, depth)
    }
  }

  private validateConditionals(steps: PilotStep[], depth = 0) {
    for (const step of steps) {
      if (step.type === 'conditional') {
        console.log(`   ${'  '.repeat(depth)}🔀 ${step.step_id}: Conditional`)

        // Validate condition structure
        if (!step.condition) {
          this.issues.push({
            severity: 'error',
            category: 'conditional_logic',
            step_id: step.step_id,
            message: 'conditional step missing condition property'
          })
          continue
        }

        const condition = step.condition
        console.log(`   ${'  '.repeat(depth)}   Field: ${condition.field}`)
        console.log(`   ${'  '.repeat(depth)}   Operator: ${condition.operator}`)
        console.log(`   ${'  '.repeat(depth)}   Value: ${condition.value || '(none)'}`)

        // Check condition field exists
        if (!condition.field) {
          this.issues.push({
            severity: 'error',
            category: 'conditional_logic',
            step_id: step.step_id,
            message: 'condition.field is required'
          })
        }

        if (!condition.operator) {
          this.issues.push({
            severity: 'error',
            category: 'conditional_logic',
            step_id: step.step_id,
            message: 'condition.operator is required'
          })
        }

        // Validate both branches exist
        if (!step.steps || step.steps.length === 0) {
          this.issues.push({
            severity: 'warning',
            category: 'conditional_logic',
            step_id: step.step_id,
            message: 'conditional missing true branch (steps)'
          })
        } else {
          console.log(`   ${'  '.repeat(depth)}   True branch: ${step.steps.length} steps`)
        }

        if (!step.else_steps || step.else_steps.length === 0) {
          this.issues.push({
            severity: 'info',
            category: 'conditional_logic',
            step_id: step.step_id,
            message: 'conditional missing false branch (else_steps)'
          })
        } else {
          console.log(`   ${'  '.repeat(depth)}   False branch: ${step.else_steps.length} steps`)
        }

        // Recurse into branches
        if (step.steps) this.validateConditionals(step.steps, depth + 1)
        if (step.else_steps) this.validateConditionals(step.else_steps, depth + 1)
      }

      // Recurse into loops
      if (step.scatter) {
        this.validateConditionals(step.scatter.steps, depth)
      }
    }
  }

  private async validateParameters(steps: PilotStep[]) {
    for (const step of steps) {
      if (step.type === 'action') {
        const plugin = this.pluginManager.getPlugin(step.plugin)
        if (!plugin) {
          this.issues.push({
            severity: 'error',
            category: 'plugin_schema',
            step_id: step.step_id,
            message: `Plugin '${step.plugin}' not found`
          })
          continue
        }

        const action = plugin.actions?.[step.operation!]
        if (!action) {
          this.issues.push({
            severity: 'error',
            category: 'plugin_schema',
            step_id: step.step_id,
            message: `Action '${step.operation}' not found in plugin '${step.plugin}'`
          })
          continue
        }

        // Check required parameters
        const required = action.parameters?.required || []
        const provided = Object.keys(step.config || {})

        console.log(`   ⚙️  ${step.step_id}: ${step.plugin}.${step.operation}`)
        console.log(`      Required: ${required.join(', ') || '(none)'}`)
        console.log(`      Provided: ${provided.join(', ') || '(none)'}`)

        for (const paramName of required) {
          if (!provided.includes(paramName)) {
            this.issues.push({
              severity: 'error',
              category: 'parameters',
              step_id: step.step_id,
              message: `Missing required parameter '${paramName}' for ${step.plugin}.${step.operation}`,
              details: { required, provided }
            })
          }
        }

        // Check for unknown parameters
        const schemaParams = Object.keys(action.parameters?.properties || {})
        for (const paramName of provided) {
          if (!schemaParams.includes(paramName)) {
            this.issues.push({
              severity: 'warning',
              category: 'parameters',
              step_id: step.step_id,
              message: `Unknown parameter '${paramName}' for ${step.plugin}.${step.operation}`,
              details: { expected: schemaParams, provided: paramName }
            })
          }
        }
      }

      // Recurse
      if (step.scatter) await this.validateParameters(step.scatter.steps)
      if (step.steps) await this.validateParameters(step.steps)
      if (step.else_steps) await this.validateParameters(step.else_steps)
    }
  }

  private validateConfigReferences(steps: PilotStep[]) {
    const configPattern = /\{\{config\.(\w+)\}\}/g

    for (const step of steps) {
      const stepJson = JSON.stringify(step.config || {})
      const matches = [...stepJson.matchAll(configPattern)]

      for (const match of matches) {
        const configKey = match[1]
        if (!this.configKeys.has(configKey)) {
          this.issues.push({
            severity: 'error',
            category: 'config_references',
            step_id: step.step_id,
            message: `Config key '${configKey}' not found in workflow config`,
            details: { available: Array.from(this.configKeys) }
          })
        } else {
          console.log(`   ✅ ${step.step_id}: Uses {{config.${configKey}}}`)
        }
      }

      // Recurse
      if (step.scatter) this.validateConfigReferences(step.scatter.steps)
      if (step.steps) this.validateConfigReferences(step.steps)
      if (step.else_steps) this.validateConfigReferences(step.else_steps)
    }
  }

  private validateVariableReferences(steps: PilotStep[], loopVars = new Set<string>()) {
    const varPattern = /\{\{(\w+)(?:\.[\w.]+)?\}\}/g

    for (const step of steps) {
      // Create step copy without itemVariable field to avoid false positives
      const stepForValidation = { ...step }
      if (stepForValidation.scatter) {
        stepForValidation.scatter = { ...stepForValidation.scatter }
        delete (stepForValidation.scatter as any).itemVariable
      }

      const stepJson = JSON.stringify(stepForValidation)
      const matches = [...stepJson.matchAll(varPattern)]

      const validVars = new Set([...this.declaredVariables, ...loopVars])

      for (const match of matches) {
        const fullRef = match[0]
        const varName = match[1]

        // Skip config references
        if (varName === 'config') continue

        if (!validVars.has(varName)) {
          this.issues.push({
            severity: 'error',
            category: 'variable_references',
            step_id: step.step_id,
            message: `Variable reference '${fullRef}' points to undeclared variable '${varName}'`,
            details: { declared: Array.from(this.declaredVariables), loopVars: Array.from(loopVars) }
          })
        }
      }

      // Recurse with loop scope
      if (step.scatter) {
        const itemVar = step.scatter.itemVariable
        const scatterScope = new Set([...loopVars, itemVar])
        this.validateVariableReferences(step.scatter.steps, scatterScope)
      }
      if (step.steps) this.validateVariableReferences(step.steps, loopVars)
      if (step.else_steps) this.validateVariableReferences(step.else_steps, loopVars)
    }
  }

  private extractVariableReferences(text: string | any): string[] {
    if (typeof text !== 'string') {
      text = JSON.stringify(text)
    }

    const varPattern = /\{\{(\w+)(?:\.[\w.]+)?\}\}/g
    const matches = [...text.matchAll(varPattern)]
    return matches
      .map(m => m[1])
      .filter(v => v !== 'config') // Exclude config references
  }

  private printSummary() {
    console.log('\n📋 VALIDATION SUMMARY')
    console.log('=' .repeat(80))

    const byCategory = this.issues.reduce((acc, issue) => {
      if (!acc[issue.category]) acc[issue.category] = []
      acc[issue.category].push(issue)
      return acc
    }, {} as Record<string, ValidationIssue[]>)

    const errors = this.issues.filter(i => i.severity === 'error')
    const warnings = this.issues.filter(i => i.severity === 'warning')
    const info = this.issues.filter(i => i.severity === 'info')

    console.log(`\n🔴 Errors: ${errors.length}`)
    console.log(`🟡 Warnings: ${warnings.length}`)
    console.log(`🔵 Info: ${info.length}`)

    if (errors.length > 0) {
      console.log('\n❌ ERRORS:')
      for (const issue of errors) {
        console.log(`   [${issue.category}] ${issue.step_id}: ${issue.message}`)
      }
    }

    if (warnings.length > 0) {
      console.log('\n⚠️  WARNINGS:')
      for (const issue of warnings) {
        console.log(`   [${issue.category}] ${issue.step_id}: ${issue.message}`)
      }
    }

    console.log('\n📊 Issues by Category:')
    for (const [category, issues] of Object.entries(byCategory)) {
      const errorCount = issues.filter(i => i.severity === 'error').length
      const warningCount = issues.filter(i => i.severity === 'warning').length
      const infoCount = issues.filter(i => i.severity === 'info').length
      console.log(`   ${category}: ${errorCount} errors, ${warningCount} warnings, ${infoCount} info`)
    }

    console.log('\n' + '=' .repeat(80))
    if (errors.length === 0) {
      console.log('✅ WORKFLOW IS EXECUTABLE - No blocking errors found!')
    } else {
      console.log(`❌ WORKFLOW HAS ${errors.length} BLOCKING ERROR(S) - Not executable`)
    }
    console.log('=' .repeat(80))
  }
}

async function main() {
  console.log('🚀 Narrative Prompt Workflow Validation')
  console.log('=' .repeat(80))

  // Load workflow
  const workflowPath = path.join(process.cwd(), 'output/vocabulary-pipeline/pilot-dsl-steps.json')
  const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf-8'))

  // Load workflow config - try to load from most recently generated narrative prompt file
  let workflowConfig: Record<string, any> = {}

  // Try to load from the GPT-4 generated narrative file (most recent)
  const gpt4NarrativePath = path.join(process.cwd(), 'enhanced-prompt-gpt4-generated.json')
  const leadSalesNarrativePath = path.join(process.cwd(), 'enhanced-prompt-lead-sales-followup-narrative.json')

  let narrativePromptPath = ''
  if (fs.existsSync(gpt4NarrativePath)) {
    narrativePromptPath = gpt4NarrativePath
  } else if (fs.existsSync(leadSalesNarrativePath)) {
    narrativePromptPath = leadSalesNarrativePath
  }

  if (narrativePromptPath) {
    const narrativePrompt = JSON.parse(fs.readFileSync(narrativePromptPath, 'utf-8'))
    workflowConfig = narrativePrompt.config || {}
    console.log(`📋 Loaded config from: ${path.basename(narrativePromptPath)}`)
    console.log(`📋 Config parameters: ${Object.keys(workflowConfig).length}`)
  } else {
    // Fallback to invoice extraction config
    workflowConfig = {
      google_drive_folder_name: 'Invoices 2024',
      google_sheet_id: '1ABC123XYZ',
      expenses_tab_name: 'Expenses',
      summary_email_recipient: 'finance@company.com',
      amount_threshold: 50
    }
    console.log(`📋 Using default invoice extraction config`)
  }

  console.log(`\n📁 Workflow: ${workflowPath}`)
  console.log(`📊 Total top-level steps: ${workflow.length}`)
  console.log(`🔧 Config parameters: ${Object.keys(workflowConfig).length}`)

  // Initialize validator
  // Create minimal plugin manager for validation (no DB needed)
  const { PluginManagerV2 } = await import('@/lib/server/plugin-manager-v2')
  const pluginManager = {
    getPlugin: (key: string) => {
      // Load plugin definition directly from file
      const fs = require('fs')
      const path = require('path')
      try {
        const pluginPath = path.join(process.cwd(), 'lib/plugins/definitions', `${key}-plugin-v2.json`)
        return JSON.parse(fs.readFileSync(pluginPath, 'utf-8'))
      } catch (e) {
        return null
      }
    }
  }
  const validator = new NarrativeWorkflowValidator(pluginManager)

  // Run validation
  const issues = await validator.validate(workflow, workflowConfig)

  // Save results
  const resultsPath = path.join(process.cwd(), 'output/vocabulary-pipeline/validation-results.json')
  fs.writeFileSync(resultsPath, JSON.stringify(issues, null, 2))
  console.log(`\n💾 Validation results saved: ${resultsPath}`)

  // Exit with error code if there are errors
  const errors = issues.filter(i => i.severity === 'error')
  process.exit(errors.length > 0 ? 1 : 0)
}

main().catch(console.error)
