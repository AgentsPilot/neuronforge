/**
 * End-to-End Test: Complete Deterministic Pipeline
 *
 * Flow:
 * 1. Load Generic Intent V1 Contract (from file)
 * 2. Run CapabilityBinderV2 → BoundIntentContract
 * 3. Run IntentToIRConverter → ExecutionGraph (IR v4)
 * 4. Run ExecutionGraphCompiler → PILOT DSL Steps
 * 5. Validate complete flow
 */

import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Load environment variables from .env.local
dotenv.config({ path: path.join(process.cwd(), '.env.local') })
import { CapabilityBinderV2 } from '../lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '../lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import type { IntentContract } from '../lib/agentkit/v6/semantic-plan/types/intent-schema-types'

async function main() {
  console.log('🚀 Testing Complete Deterministic Pipeline (End-to-End)')
  console.log('=' .repeat(80))

  // =======================
  // PHASE 0: Setup
  // =======================
  console.log('\n📦 Phase 0: Setup')
  console.log('-'.repeat(80))

  const userId = '08456106-aa50-4810-b12c-7ca84102da31'

  // Initialize PluginManagerV2 with proper singleton instance
  const pluginManager = await PluginManagerV2.getInstance()

  // Load Generic Intent V1 contract
  const contractPath = path.join(process.cwd(), 'output', 'generic-intent-v1-contract.json')

  if (!fs.existsSync(contractPath)) {
    console.error('❌ Contract file not found:', contractPath)
    process.exit(1)
  }

  const intentContract: IntentContract = JSON.parse(fs.readFileSync(contractPath, 'utf-8'))

  console.log(`✅ Loaded Intent Contract: ${intentContract.version}`)
  console.log(`   Goal: ${intentContract.goal}`)
  console.log(`   Steps: ${intentContract.steps.length}`)

  // =======================
  // PHASE 1: Capability Binding
  // =======================
  console.log('\n🔗 Phase 1: Capability Binding (CapabilityBinderV2)')
  console.log('-'.repeat(80))

  const binder = new CapabilityBinderV2(pluginManager)

  console.log('Running deterministic binding...')
  const boundIntent = await binder.bind(intentContract, userId)

  console.log(`✅ Binding complete`)
  console.log(`   Bound steps: ${boundIntent.steps.length}`)

  // Count successfully bound steps
  let successfulBindings = 0
  let failedBindings = 0

  for (const step of boundIntent.steps) {
    if ('plugin_key' in step && step.plugin_key) {
      successfulBindings++
      console.log(`   ✅ ${step.id}: ${step.plugin_key}.${(step as any).action}`)
    } else {
      failedBindings++
      console.log(`   ⚠️  ${step.id}: No binding (${step.kind})`)
    }
  }

  console.log(`\n   Summary: ${successfulBindings} bound, ${failedBindings} unbound`)

  // =======================
  // PHASE 2: Intent → IR Conversion
  // =======================
  console.log('\n🔄 Phase 2: Intent → IR Conversion (IntentToIRConverter)')
  console.log('-'.repeat(80))

  const converter = new IntentToIRConverter()

  console.log('Converting BoundIntentContract → ExecutionGraph (IR v4)...')
  const conversionResult = converter.convert(boundIntent)

  if (!conversionResult.success || !conversionResult.ir) {
    console.error('❌ Conversion failed!')
    console.error('Errors:', conversionResult.errors)
    process.exit(1)
  }

  const ir = conversionResult.ir

  console.log(`✅ Conversion complete`)
  console.log(`   IR Version: ${ir.version}`)
  console.log(`   Start Node: ${ir.execution_graph.start_node}`)
  console.log(`   Total Nodes: ${Object.keys(ir.execution_graph.nodes).length}`)

  if (conversionResult.warnings.length > 0) {
    console.log(`\n   ⚠️  Warnings:`)
    conversionResult.warnings.forEach(w => console.log(`      - ${w}`))
  }

  // Node type breakdown
  const nodeTypes: Record<string, number> = {}
  for (const node of Object.values(ir.execution_graph.nodes)) {
    nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1
  }

  console.log(`\n   Node Type Breakdown:`)
  for (const [type, count] of Object.entries(nodeTypes)) {
    console.log(`      - ${type}: ${count}`)
  }

  // =======================
  // PHASE 3: IR Compilation
  // =======================
  console.log('\n⚙️  Phase 3: IR Compilation (ExecutionGraphCompiler)')
  console.log('-'.repeat(80))

  const compiler = new ExecutionGraphCompiler(pluginManager)

  console.log('Compiling ExecutionGraph → PILOT DSL Steps...')

  // Note: ExecutionGraphCompiler.compile() takes hardReqs as second param
  // For this test, we'll use empty hard requirements
  const hardReqs = {
    global_rules: {},
    thresholds: {},
    invariants: {}
  }

  const compilationResult = await compiler.compile(ir, hardReqs)

  if (!compilationResult.success || !compilationResult.workflow) {
    console.error('❌ Compilation failed!')
    console.error('Errors:', compilationResult.errors)
    process.exit(1)
  }

  const pilotSteps = compilationResult.workflow

  console.log(`✅ Compilation complete`)
  console.log(`   PILOT Steps: ${pilotSteps.length}`)

  if (compilationResult.warnings && compilationResult.warnings.length > 0) {
    console.log(`\n   ⚠️  Warnings:`)
    compilationResult.warnings.forEach(w => console.log(`      - ${w}`))
  }

  // Step type breakdown
  const stepTypes: Record<string, number> = {}
  for (const step of pilotSteps) {
    stepTypes[step.type] = (stepTypes[step.type] || 0) + 1
  }

  console.log(`\n   PILOT Step Type Breakdown:`)
  for (const [type, count] of Object.entries(stepTypes)) {
    console.log(`      - ${type}: ${count}`)
  }

  // =======================
  // PHASE 4: Save Results
  // =======================
  console.log('\n💾 Phase 4: Save Results')
  console.log('-'.repeat(80))

  const outputDir = path.join(process.cwd(), 'output')

  // Save BoundIntentContract
  const boundIntentPath = path.join(outputDir, 'bound-intent-contract.json')
  fs.writeFileSync(boundIntentPath, JSON.stringify(boundIntent, null, 2))
  console.log(`✅ Saved: ${boundIntentPath}`)

  // Save ExecutionGraph (IR v4)
  const irPath = path.join(outputDir, 'execution-graph-ir-v4.json')
  fs.writeFileSync(irPath, JSON.stringify(ir, null, 2))
  console.log(`✅ Saved: ${irPath}`)

  // Save PILOT DSL Steps
  const pilotPath = path.join(outputDir, 'pilot-dsl-steps.json')
  fs.writeFileSync(pilotPath, JSON.stringify(pilotSteps, null, 2))
  console.log(`✅ Saved: ${pilotPath}`)

  // =======================
  // PHASE 5: Validation Summary
  // =======================
  console.log('\n✅ Phase 5: Validation Summary')
  console.log('=' .repeat(80))

  console.log('\n🎉 Complete Deterministic Pipeline Test SUCCESSFUL!\n')

  console.log('Pipeline Flow Validated:')
  console.log('  1. ✅ Generic Intent V1 Contract (loaded from file)')
  console.log(`  2. ✅ CapabilityBinderV2 → BoundIntentContract (${successfulBindings} bindings)`)
  console.log(`  3. ✅ IntentToIRConverter → ExecutionGraph (${Object.keys(ir.execution_graph.nodes).length} nodes)`)
  console.log(`  4. ✅ ExecutionGraphCompiler → PILOT DSL (${pilotSteps.length} steps)`)

  console.log('\n📊 Pipeline Stats:')
  console.log(`   Intent Steps:        ${intentContract.steps.length}`)
  console.log(`   Successful Bindings: ${successfulBindings}`)
  console.log(`   Failed Bindings:     ${failedBindings}`)
  console.log(`   IR Nodes:            ${Object.keys(ir.execution_graph.nodes).length}`)
  console.log(`   PILOT Steps:         ${pilotSteps.length}`)
  console.log(`   Conversion Warnings: ${conversionResult.warnings.length}`)
  console.log(`   Compilation Warnings: ${compilationResult.warnings?.length || 0}`)

  console.log('\n📁 Output Files:')
  console.log(`   - ${boundIntentPath}`)
  console.log(`   - ${irPath}`)
  console.log(`   - ${pilotPath}`)

  console.log('\n' + '=' .repeat(80))
  console.log('✅ DETERMINISTIC PIPELINE COMPLETE')
  console.log('=' .repeat(80))
  console.log('\n📝 Next Steps:')
  console.log('   1. Review output files for correctness')
  console.log('   2. Address any warnings or failed bindings')
  console.log('   3. Test with additional Intent contracts')
  console.log('   4. Integrate into V6PipelineOrchestrator\n')
}

main().catch((err) => {
  console.error('\n❌ Pipeline test failed:', err)
  console.error('\nStack trace:', err.stack)
  process.exit(1)
})
