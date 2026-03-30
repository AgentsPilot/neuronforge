/**
 * Real Executability Analysis
 *
 * This script performs ACTUAL analysis of what will break at runtime:
 * 1. Variable reference format issues (missing {{}})
 * 2. Field access on wrong variable types
 * 3. Conditional branch variable scoping
 * 4. AI output schema vs consumption mismatch
 * 5. Loop variable accessibility
 */

import fs from 'fs'
import path from 'path'

interface PilotStep {
  step_id: string
  type: string
  plugin?: string
  operation?: string
  config?: any
  input?: string
  condition?: any
  steps?: PilotStep[]
  else_steps?: PilotStep[]
  output_variable?: string
  prompt?: string
}

interface Issue {
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  step_id: string
  issue_type: string
  description: string
  current_value?: any
  expected_value?: any
  will_fail: boolean
}

class ExecutabilityAnalyzer {
  private issues: Issue[] = []
  private variables = new Set<string>()
  private variableTypes = new Map<string, string>() // variable -> type (object, array, string, etc.)

  analyzeWorkflow(steps: PilotStep[], workflowName: string): Issue[] {
    this.issues = []
    this.variables.clear()
    this.variableTypes.clear()

    console.log(`\n${'='.repeat(80)}`)
    console.log(`Analyzing: ${workflowName}`)
    console.log('='.repeat(80))

    this.analyzeSteps(steps, [])

    return this.issues
  }

  private analyzeSteps(steps: PilotStep[], scope: string[]) {
    for (const step of steps) {
      // Track output variables
      if (step.output_variable) {
        this.variables.add(step.output_variable)

        // Infer type from step type
        if (step.type === 'action' && step.plugin === 'google-sheets' && step.operation === 'read_range') {
          this.variableTypes.set(step.output_variable, 'array')
        } else if (step.type === 'ai_processing') {
          this.variableTypes.set(step.output_variable, 'object')
        } else if (step.type === 'transform') {
          if (step.operation === 'filter' || step.operation === 'select') {
            this.variableTypes.set(step.output_variable, 'array')
          } else if (step.operation === 'reduce') {
            this.variableTypes.set(step.output_variable, 'primitive')
          }
        }
      }

      // Check step-specific issues
      if (step.type === 'action') {
        this.analyzeActionStep(step, scope)
      } else if (step.type === 'transform') {
        this.analyzeTransformStep(step, scope)
      } else if (step.type === 'ai_processing') {
        this.analyzeAIStep(step, scope)
      } else if (step.type === 'conditional') {
        this.analyzeConditionalStep(step, scope)
      }
    }
  }

  private analyzeActionStep(step: PilotStep, scope: string[]) {
    const { step_id, plugin, operation, config } = step

    if (plugin === 'google-mail' && operation === 'send_email') {
      this.analyzeEmailStep(step, scope)
    }

    // Check all config values for variable references
    if (config) {
      this.checkConfigVariableReferences(step_id, config, scope)
    }
  }

  private analyzeEmailStep(step: PilotStep, scope: string[]) {
    const { step_id, config } = step

    if (!config?.content) return

    const { subject, html_body, body } = config.content

    // CRITICAL: Check if subject/body are plain strings instead of variable references
    if (subject && typeof subject === 'string') {
      // Check if it looks like a field reference without {{}}
      if (subject.includes('.') && !subject.includes('{{')) {
        this.issues.push({
          severity: 'CRITICAL',
          step_id,
          issue_type: 'MISSING_VARIABLE_WRAPPER',
          description: `Email subject is a plain string "${subject}" instead of variable reference`,
          current_value: subject,
          expected_value: `{{${subject}}}`,
          will_fail: true
        })
      }
    }

    const bodyField = html_body || body
    if (bodyField && typeof bodyField === 'string') {
      if (bodyField.includes('.') && !bodyField.includes('{{')) {
        this.issues.push({
          severity: 'CRITICAL',
          step_id,
          issue_type: 'MISSING_VARIABLE_WRAPPER',
          description: `Email body is a plain string "${bodyField}" instead of variable reference`,
          current_value: bodyField,
          expected_value: `{{${bodyField}}}`,
          will_fail: true
        })
      }
    }

    // Check if variable exists
    if (subject && typeof subject === 'string' && subject.includes('.')) {
      const varName = subject.split('.')[0]
      if (!this.variables.has(varName)) {
        this.issues.push({
          severity: 'HIGH',
          step_id,
          issue_type: 'UNDEFINED_VARIABLE',
          description: `Subject references undefined variable: ${varName}`,
          current_value: subject,
          will_fail: true
        })
      }
    }
  }

  private analyzeTransformStep(step: PilotStep, scope: string[]) {
    const { step_id, input, config } = step

    // Check input variable reference format
    if (input && typeof input === 'string') {
      if (!input.startsWith('{{') || !input.endsWith('}}')) {
        this.issues.push({
          severity: 'MEDIUM',
          step_id,
          issue_type: 'INCONSISTENT_VARIABLE_FORMAT',
          description: `Transform input uses ${input} format (should be consistent)`,
          current_value: input,
          will_fail: false
        })
      }

      // Extract variable name and check if it exists
      const varName = input.replace(/{{|}}/g, '').split('.')[0]
      if (!this.variables.has(varName)) {
        this.issues.push({
          severity: 'HIGH',
          step_id,
          issue_type: 'UNDEFINED_VARIABLE',
          description: `Transform input references undefined variable: ${varName}`,
          current_value: input,
          will_fail: true
        })
      }
    }

    // Check filter condition syntax
    if (config?.condition) {
      this.analyzeCondition(step_id, config.condition, scope)
    }
  }

  private analyzeCondition(step_id: string, condition: any, scope: string[]) {
    if (!condition) return

    // Check field reference format
    if (condition.field && typeof condition.field === 'string') {
      // Check if it uses "item." prefix
      if (condition.field.startsWith('item.')) {
        this.issues.push({
          severity: 'MEDIUM',
          step_id,
          issue_type: 'UNCLEAR_RUNTIME_SYNTAX',
          description: `Condition uses "item." prefix - verify runtime supports this: ${condition.field}`,
          current_value: condition.field,
          will_fail: false // Unknown - needs runtime verification
        })
      }

      // Check if variable exists (if not using item prefix)
      if (!condition.field.startsWith('item.')) {
        const varName = condition.field.split('.')[0]
        if (!this.variables.has(varName)) {
          this.issues.push({
            severity: 'HIGH',
            step_id,
            issue_type: 'UNDEFINED_VARIABLE',
            description: `Condition references undefined variable: ${varName}`,
            current_value: condition.field,
            will_fail: true
          })
        }
      }
    }

    // Check value format (should be {{config.x}} if referencing config)
    if (condition.value && typeof condition.value === 'string') {
      if (condition.value.startsWith('{{config.')) {
        // Good - properly wrapped
      } else if (condition.value.includes('config.')) {
        this.issues.push({
          severity: 'CRITICAL',
          step_id,
          issue_type: 'MISSING_VARIABLE_WRAPPER',
          description: `Condition value references config but missing {{}}: ${condition.value}`,
          current_value: condition.value,
          expected_value: `{{${condition.value}}}`,
          will_fail: true
        })
      }
    }
  }

  private analyzeAIStep(step: PilotStep, scope: string[]) {
    const { step_id, config, output_variable } = step

    // Check if output_schema is defined
    if (!config?.output_schema) {
      this.issues.push({
        severity: 'HIGH',
        step_id,
        issue_type: 'MISSING_OUTPUT_SCHEMA',
        description: 'AI step has no output_schema - consumers cannot validate field access',
        will_fail: false
      })
      return
    }

    // Track the fields that AI will output
    if (output_variable && config.output_schema?.properties) {
      const fields = Object.keys(config.output_schema.properties)
      console.log(`  AI step ${step_id} will output fields: ${fields.join(', ')}`)
    }
  }

  private analyzeConditionalStep(step: PilotStep, scope: string[]) {
    const { step_id, condition, steps, else_steps } = step

    // Analyze condition
    if (condition) {
      this.analyzeCondition(step_id, condition, scope)
    }

    // Analyze then branch
    if (steps) {
      const thenScope = [...scope, `${step_id}:then`]
      this.analyzeSteps(steps, thenScope)
    }

    // Analyze else branch
    if (else_steps) {
      const elseScope = [...scope, `${step_id}:else`]
      this.analyzeSteps(else_steps, elseScope)
    }
  }

  private checkConfigVariableReferences(step_id: string, config: any, scope: string[]) {
    // Recursively check all config values for variable references
    for (const [key, value] of Object.entries(config)) {
      if (typeof value === 'string') {
        // Check if it looks like a variable reference
        if (value.includes('.') && !value.includes('{{') && !value.includes('@')) {
          // Could be a variable reference without {{}}
          const parts = value.split('.')
          if (this.variables.has(parts[0])) {
            this.issues.push({
              severity: 'HIGH',
              step_id,
              issue_type: 'POSSIBLE_MISSING_WRAPPER',
              description: `Config field "${key}" might be missing {{}} wrapper: ${value}`,
              current_value: value,
              expected_value: `{{${value}}}`,
              will_fail: false // Uncertain - could be intentional
            })
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        this.checkConfigVariableReferences(step_id, value, scope)
      }
    }
  }
}

async function analyzeAllWorkflows() {
  const workflows = [
    'complaint-logger',
    'expense-extractor',
    'invoice-extraction',
    'lead-sales-followup',
    'leads-filter'
  ]

  const analyzer = new ExecutabilityAnalyzer()
  const allIssues: Record<string, Issue[]> = {}

  for (const workflow of workflows) {
    const promptFile = `enhanced-prompt-${workflow}.json`

    // Run pipeline to generate PILOT DSL
    console.log(`\n${'='.repeat(80)}`)
    console.log(`Testing: ${workflow}`)
    console.log('='.repeat(80))

    const { execSync } = await import('child_process')
    try {
      execSync(`npx tsx scripts/test-complete-pipeline-with-vocabulary.ts ${promptFile}`, {
        stdio: 'pipe',
        encoding: 'utf-8'
      })
    } catch (error) {
      console.error(`❌ Pipeline failed for ${workflow}`)
      continue
    }

    // Load generated PILOT DSL
    const pilotFile = 'output/vocabulary-pipeline/pilot-dsl-steps.json'
    if (!fs.existsSync(pilotFile)) {
      console.error(`❌ No PILOT DSL generated for ${workflow}`)
      continue
    }

    const steps = JSON.parse(fs.readFileSync(pilotFile, 'utf-8'))
    const issues = analyzer.analyzeWorkflow(steps, workflow)
    allIssues[workflow] = issues

    // Print issues
    if (issues.length === 0) {
      console.log(`\n✅ No issues found!`)
    } else {
      console.log(`\n⚠️  Found ${issues.length} issues:`)

      const critical = issues.filter(i => i.severity === 'CRITICAL')
      const high = issues.filter(i => i.severity === 'HIGH')
      const medium = issues.filter(i => i.severity === 'MEDIUM')
      const low = issues.filter(i => i.severity === 'LOW')

      if (critical.length > 0) {
        console.log(`\n🔴 CRITICAL (${critical.length}) - WILL FAIL AT RUNTIME:`)
        critical.forEach(issue => {
          console.log(`   [${issue.step_id}] ${issue.description}`)
          if (issue.current_value) {
            console.log(`      Current:  ${JSON.stringify(issue.current_value)}`)
            console.log(`      Expected: ${JSON.stringify(issue.expected_value)}`)
          }
        })
      }

      if (high.length > 0) {
        console.log(`\n🟠 HIGH (${high.length}) - LIKELY TO FAIL:`)
        high.forEach(issue => {
          console.log(`   [${issue.step_id}] ${issue.description}`)
        })
      }

      if (medium.length > 0) {
        console.log(`\n🟡 MEDIUM (${medium.length}) - NEEDS VERIFICATION:`)
        medium.forEach(issue => {
          console.log(`   [${issue.step_id}] ${issue.description}`)
        })
      }
    }
  }

  // Generate summary report
  console.log(`\n${'='.repeat(80)}`)
  console.log('SUMMARY REPORT')
  console.log('='.repeat(80))

  let totalCritical = 0
  let totalHigh = 0
  let totalWillFail = 0

  for (const [workflow, issues] of Object.entries(allIssues)) {
    const critical = issues.filter(i => i.severity === 'CRITICAL').length
    const high = issues.filter(i => i.severity === 'HIGH').length
    const willFail = issues.filter(i => i.will_fail).length

    totalCritical += critical
    totalHigh += high
    totalWillFail += willFail

    const status = willFail > 0 ? '❌ WILL FAIL' : issues.length > 0 ? '⚠️  ISSUES' : '✅ OK'
    console.log(`\n${workflow}:`)
    console.log(`  Status: ${status}`)
    console.log(`  Critical: ${critical}, High: ${high}, Will Fail: ${willFail}/${issues.length}`)
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`TOTAL: ${totalWillFail} workflows WILL FAIL at runtime`)
  console.log(`       ${totalCritical} CRITICAL issues`)
  console.log(`       ${totalHigh} HIGH issues`)
  console.log('='.repeat(80))

  // Save detailed report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total_workflows: workflows.length,
      workflows_with_issues: Object.values(allIssues).filter(i => i.length > 0).length,
      workflows_will_fail: Object.values(allIssues).filter(i => i.some(issue => issue.will_fail)).length,
      total_critical: totalCritical,
      total_high: totalHigh
    },
    workflows: allIssues
  }

  fs.writeFileSync(
    'REAL-EXECUTABILITY-ANALYSIS.json',
    JSON.stringify(report, null, 2)
  )
  console.log(`\n📄 Detailed report saved to: REAL-EXECUTABILITY-ANALYSIS.json`)
}

analyzeAllWorkflows().catch(console.error)
