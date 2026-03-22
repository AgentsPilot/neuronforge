/**
 * DSL Execution Simulator — Entry Point
 *
 * Loads compiled DSL output files, simulates step-by-step execution
 * with stub data, and validates the data flow chain.
 *
 * Usage: npx tsx scripts/test-dsl-execution-simulator/index.ts
 */

import path from 'path'
import { loadInputFiles } from './file-loader'
import { VariableStore } from './variable-store'
import { DSLSimulator } from './dsl-simulator'
import { Validator } from './validator'
import { writeReport } from './report-generator'

async function main() {
  const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║           DSL Execution Simulator — Phase A                     ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')

  // Step 1: Load input files
  console.log('\n📁 Loading input files...')
  const { dslSteps, workflowConfig, dataSchema } = loadInputFiles(outputDir)

  // Step 2: Initialize variable store with workflow config
  console.log('\n⚙️  Initializing variable store...')
  const store = new VariableStore(workflowConfig)
  console.log(`   Config keys: ${store.getConfigKeys().join(', ')}`)

  // Step 3: Run simulation
  console.log('\n🚀 Simulating DSL execution...\n')
  const simulator = new DSLSimulator(store)
  const simulationResult = await simulator.run(dslSteps)

  // Step 4: Validate
  console.log('\n🔍 Running validation checks...')
  const validator = new Validator()
  const validationReport = validator.validate(dslSteps, store, simulationResult.stepLog, workflowConfig)

  // Step 5: Write report
  const reportPath = writeReport(simulationResult, validationReport, outputDir)

  // Exit with error code if issues found
  const hasErrors = validationReport.issues.filter(i => i.severity === 'error').length > 0
    || simulationResult.errors > 0
  process.exit(hasErrors ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
