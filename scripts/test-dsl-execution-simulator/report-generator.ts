/**
 * A10: ReportGenerator — JSON report + console output
 *
 * Writes a structured execution simulation report to disk
 * and prints a summary to the console. Includes A+ validation results and DAG.
 */

import fs from 'fs'
import path from 'path'
import { SimulationResult } from './dsl-simulator'
import { ValidationReport } from './validator'

export interface ExecutionReport {
  timestamp: string
  input_files: {
    dsl: string
    config: string
    schema: string
  }
  summary: {
    total_steps: number
    executed: number
    skipped: number
    warnings: number
    errors: number
  }
  step_log: SimulationResult['stepLog']
  validation: ValidationReport
}

const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

export function writeReport(
  simulationResult: SimulationResult,
  validationReport: ValidationReport,
  outputDir: string = DEFAULT_OUTPUT_DIR
): string {
  const report: ExecutionReport = {
    timestamp: new Date().toISOString(),
    input_files: {
      dsl: 'phase4-pilot-dsl-steps.json',
      config: 'phase4-workflow-config.json',
      schema: 'phase2-data-schema.json',
    },
    summary: {
      total_steps: simulationResult.totalSteps,
      executed: simulationResult.executed,
      skipped: simulationResult.skipped,
      warnings: simulationResult.warnings,
      errors: simulationResult.errors,
    },
    step_log: simulationResult.stepLog,
    validation: validationReport,
  }

  const outputPath = path.join(outputDir, 'execution-simulation-report.json')
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2))

  // Console summary
  console.log('\n' + '='.repeat(70))
  console.log('EXECUTION SIMULATION REPORT')
  console.log('='.repeat(70))

  // DAG visualization (A+7)
  if (validationReport.dag) {
    console.log('\n📐 Execution DAG:')
    for (const line of validationReport.dag.split('\n')) {
      console.log(`   ${line}`)
    }
  }

  console.log(`\n📊 Simulation Summary:`)
  console.log(`   Steps: ${report.summary.total_steps} total, ${report.summary.executed} executed, ${report.summary.skipped} skipped`)
  console.log(`   Warnings: ${report.summary.warnings}`)
  console.log(`   Errors: ${report.summary.errors}`)

  console.log(`\n🔍 Validation (${validationReport.total_checks} checks):`)
  console.log(`   Passed: ${validationReport.checks_passed}/${validationReport.total_checks}`)
  console.log(`   Failed: ${validationReport.checks_failed}/${validationReport.total_checks}`)

  // Phase A issues
  printIssueSection('❌ Unresolved references', validationReport.summary.unresolved_refs)
  printIssueSection('⚠️  Missing config keys', validationReport.summary.missing_config_keys)
  printIssueSection('❌ Data flow breaks', validationReport.summary.data_flow_breaks)
  printIssueSection('⚠️  Field mismatches (basic)', validationReport.summary.field_mismatches)

  // Phase A+ issues
  printIssueSection('❌ Cross-step field errors (A+1)', validationReport.summary.cross_step_field_errors)
  printIssueSection('❌ Scatter item field errors (A+2)', validationReport.summary.scatter_item_errors)
  printIssueSection('❌ Conditional field errors (A+3)', validationReport.summary.conditional_field_errors)

  // Warning-level A+ issues
  const warningIssues = validationReport.issues.filter(i =>
    i.severity === 'warning' && ['config_type_mismatch', 'missing_output_schema', 'conditional_type_mismatch', 'scatter_item_no_schema'].includes(i.check)
  )
  if (warningIssues.length > 0) {
    console.log(`\n   ⚠️  A+ Warnings:`)
    for (const issue of warningIssues) {
      const stepLabel = issue.step_id ? `[${issue.step_id}] ` : ''
      console.log(`      - ${stepLabel}${issue.message}`)
    }
  }

  // Duplicate output var errors (A+6)
  const dupErrors = validationReport.issues.filter(i => i.check === 'duplicate_output_var')
  if (dupErrors.length > 0) {
    console.log(`\n   ❌ Duplicate output variables (A+6):`)
    for (const issue of dupErrors) {
      console.log(`      - [${issue.step_id}] ${issue.message}`)
    }
  }

  // Info-level issues
  const infoIssues = validationReport.issues.filter(i => i.severity === 'info')
  if (infoIssues.length > 0) {
    console.log(`\n   ℹ️  Info:`)
    for (const issue of infoIssues) {
      console.log(`      - ${issue.message}`)
    }
  }

  const allClear = validationReport.checks_failed === 0 && report.summary.errors === 0
  console.log(`\n${allClear ? '✅ SIMULATION PASSED' : '❌ SIMULATION HAS ISSUES'} — see ${outputPath}`)
  console.log('='.repeat(70))

  return outputPath
}

function printIssueSection(label: string, items: string[]): void {
  if (items.length > 0) {
    console.log(`\n   ${label}:`)
    for (const item of items) {
      console.log(`      - ${item}`)
    }
  }
}
