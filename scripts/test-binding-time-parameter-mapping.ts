/**
 * Test binding-time parameter mapping implementation
 *
 * Tests the new CapabilityBinderV2 parameter mapping that happens during Phase 2 (binding)
 * instead of Phase 3 (IR conversion) or Phase 4 (compilation).
 */

import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'
import { CapabilityBinderV2 } from '../lib/agentkit/v6/capability-binding/CapabilityBinderV2'
import { IntentToIRConverter } from '../lib/agentkit/v6/compiler/IntentToIRConverter'
import { ExecutionGraphCompiler } from '../lib/agentkit/v6/compiler/ExecutionGraphCompiler'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import { readFileSync } from 'fs'
import { join } from 'path'

async function testBindingTimeParameterMapping() {
  console.log('\n🧪 Testing Binding-Time Parameter Mapping\n')
  console.log('=' .repeat(80))

  // Load enhanced prompt (Complaint Logger)
  const promptPath = join(process.cwd(), 'enhanced-prompt-complaint-logger.json')
  const enhancedPrompt = JSON.parse(readFileSync(promptPath, 'utf-8'))

  console.log(`\n📄 Loaded: ${enhancedPrompt.plan_title}`)
  console.log(`   Services: ${enhancedPrompt.specifics.services_involved.join(', ')}`)

  // Initialize plugin manager
  const pluginManager = new PluginManagerV2()

  console.log('\n✅ Plugin manager loaded')

  // Phase 1: Generate IntentContract (using LLM)
  console.log('\n⏳ Phase 1: Generating IntentContract (LLM)...')
  const formalizer = new IRFormalizer(pluginManager)

  const startLLM = Date.now()
  const intentResult = await formalizer.formalize(enhancedPrompt, 'test-user')
  const llmTime = Date.now() - startLLM

  if (!intentResult.success || !intentResult.contract) {
    console.error('❌ Failed to generate IntentContract')
    console.error(intentResult.errors)
    process.exit(1)
  }

  console.log(`✅ Phase 1 complete (${llmTime}ms)`)
  console.log(`   Steps generated: ${intentResult.contract.steps.length}`)

  // Phase 2: Capability Binding + Parameter Mapping (NEW!)
  console.log('\n⏳ Phase 2: Binding capabilities + mapping parameters...')
  const binder = new CapabilityBinderV2(pluginManager)

  const startBinding = Date.now()
  const boundContract = await binder.bind(intentResult.contract, 'test-user')
  const bindingTime = Date.now() - startBinding

  console.log(`✅ Phase 2 complete (${bindingTime}ms)`)
  console.log(`   Bound steps: ${boundContract.steps.length}`)

  // Check how many steps have mapped_params
  let stepsWithMappedParams = 0
  let totalMappedParams = 0

  for (const step of boundContract.steps) {
    const boundStep = step as any
    if (boundStep.mapped_params) {
      stepsWithMappedParams++
      totalMappedParams += Object.keys(boundStep.mapped_params).length
    }
  }

  console.log(`   Steps with mapped_params: ${stepsWithMappedParams}/${boundContract.steps.length}`)
  console.log(`   Total parameters mapped: ${totalMappedParams}`)

  // Phase 3: Convert to IR
  console.log('\n⏳ Phase 3: Converting to ExecutionGraphIR...')
  const converter = new IntentToIRConverter(pluginManager)

  const startIR = Date.now()
  const irResult = converter.convert(boundContract)
  const irTime = Date.now() - startIR

  if (!irResult.success || !irResult.ir) {
    console.error('❌ Failed to convert to IR')
    console.error(irResult.errors)
    process.exit(1)
  }

  console.log(`✅ Phase 3 complete (${irTime}ms)`)
  console.log(`   IR nodes: ${irResult.ir.nodes.length}`)

  // Phase 4: Compile to PILOT DSL
  console.log('\n⏳ Phase 4: Compiling to PILOT DSL...')
  const compiler = new ExecutionGraphCompiler(pluginManager)

  const startCompile = Date.now()
  const pilotResult = await compiler.compile(irResult.ir, 'test-user')
  const compileTime = Date.now() - startCompile

  if (!pilotResult.success || !pilotResult.workflow) {
    console.error('❌ Failed to compile to PILOT DSL')
    console.error(pilotResult.errors)
    process.exit(1)
  }

  console.log(`✅ Phase 4 complete (${compileTime}ms)`)
  console.log(`   PILOT steps: ${pilotResult.workflow.length}`)

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('\n📊 Performance Summary')
  console.log(`   Phase 1 (LLM):            ${llmTime.toLocaleString()}ms`)
  console.log(`   Phase 2 (Binding+Params): ${bindingTime.toLocaleString()}ms`)
  console.log(`   Phase 3 (IR):             ${irTime.toLocaleString()}ms`)
  console.log(`   Phase 4 (Compile):        ${compileTime.toLocaleString()}ms`)
  console.log(`   ----------------------------------------`)
  console.log(`   Total Deterministic:      ${(bindingTime + irTime + compileTime).toLocaleString()}ms`)
  console.log(`   Total Pipeline:           ${(llmTime + bindingTime + irTime + compileTime).toLocaleString()}ms`)

  // Analyze step2 (read_range) - the one that was failing
  console.log('\n🔍 Analyzing Step 2 (read_range) - Previously failing step')
  const step2 = pilotResult.workflow.find((s: any) => s.step_id === 'step2')

  if (step2) {
    console.log(`   Plugin: ${step2.plugin}`)
    console.log(`   Operation: ${step2.operation}`)
    console.log(`   Config:`)
    for (const [key, value] of Object.entries(step2.config || {})) {
      console.log(`     - ${key}: ${value}`)
    }

    // Check if range parameter is present
    if ('range' in (step2.config || {})) {
      console.log(`   ✅ 'range' parameter present!`)
    } else {
      console.log(`   ❌ 'range' parameter MISSING`)
    }
  }

  console.log('\n✅ Test complete!\n')
}

// Run test
testBindingTimeParameterMapping().catch((error) => {
  console.error('\n❌ Test failed:')
  console.error(error)
  process.exit(1)
})
