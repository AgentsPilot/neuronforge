/**
 * DSL Pilot Simulator — Phase B Entry Point
 *
 * Runs compiled DSL through real Pilot components (StepExecutor, ExecutionContext,
 * ParallelExecutor) with mocked plugins. Validates the DSL is actually executable
 * in the real engine.
 *
 * Usage: npx tsx --import ./scripts/env-preload.ts scripts/test-dsl-pilot-simulator/index.ts
 */

import path from 'path'
import fs from 'fs'

// === Phase 1: Set up mocks BEFORE importing Pilot modules ===
console.log('╔══════════════════════════════════════════════════════════════════╗')
console.log('║          DSL Pilot Simulator — Phase B                          ║')
console.log('╚══════════════════════════════════════════════════════════════════╝')

console.log('\n⚙️  Setting up mocks...')

// Import mock setup functions
import { setupMockPluginExecuter, patchPluginExecuter } from './mocks/mock-plugin-executer'
import { disableAuditTrail, patchStepExecutorLLM } from './mocks/mock-services'
import { createMockSupabase } from './mocks/mock-supabase'
import { registerOutputSchemas, generateStubData } from './stub-data-provider'
import { loadInputFiles } from '../test-dsl-execution-simulator/file-loader'
import { runDSLWithPilot } from './pilot-runner'

async function main() {
  const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

  // Step 1: Initialize mocks
  setupMockPluginExecuter((plugin, action, params) => {
    return generateStubData(plugin, action, params)
  })

  await disableAuditTrail()
  await patchPluginExecuter()
  await patchStepExecutorLLM()

  // Step 2: Load input files (reuse Phase A loader)
  console.log('\n📁 Loading input files...')
  const { dslSteps, workflowConfig, dataSchema } = loadInputFiles(outputDir)

  // Register output schemas for stub generation
  registerOutputSchemas(dslSteps)

  // Step 3: Import real Pilot components (AFTER mocks are set up)
  console.log('\n🏗️  Importing real Pilot components...')
  const { ExecutionContext } = await import('../../lib/pilot/ExecutionContext')
  const { StepExecutor } = await import('../../lib/pilot/StepExecutor')
  const { ParallelExecutor } = await import('../../lib/pilot/ParallelExecutor')

  console.log('  ✅ ExecutionContext loaded')
  console.log('  ✅ StepExecutor loaded')
  console.log('  ✅ ParallelExecutor loaded')

  // Step 4: Create fake Agent object
  const pluginsUsed = new Set<string>()
  const walkForPlugins = (steps: any[]) => {
    for (const step of steps) {
      if (step.plugin) pluginsUsed.add(step.plugin)
      if (step.scatter?.steps) walkForPlugins(step.scatter.steps)
      if (step.steps) walkForPlugins(step.steps)
      if (step.then_steps) walkForPlugins(step.then_steps)
      if (step.else_steps) walkForPlugins(step.else_steps)
    }
  }
  walkForPlugins(dslSteps)

  const fakeAgent = {
    id: 'sim-agent-001',
    user_id: 'sim-user-001',
    agent_name: 'DSL Pilot Simulation Agent',
    user_prompt: 'Simulation run — validate compiled DSL execution',
    plugins_required: Array.from(pluginsUsed),
    status: 'active',
    pilot_steps: dslSteps,
    system_prompt: '',
    enhanced_prompt: '',
  }

  // Step 5: Create real ExecutionContext
  console.log('\n🔧 Creating execution context...')
  const context = new ExecutionContext(
    'sim-exec-001',
    fakeAgent as any,
    'sim-user-001',
    'sim-session-001',
    workflowConfig
  )
  console.log(`  Config keys injected: ${Object.keys(workflowConfig).join(', ')}`)

  // Step 6: Create real StepExecutor with mock supabase, no stateManager
  const mockSupabase = createMockSupabase()
  const stepExecutor = new StepExecutor(mockSupabase, undefined)

  // Step 7: Create real ParallelExecutor and wire it
  const parallelExecutor = new ParallelExecutor(stepExecutor as any, 3)
  stepExecutor.setParallelExecutor(parallelExecutor as any)

  console.log('  ✅ StepExecutor created (mock supabase, no stateManager)')
  console.log('  ✅ ParallelExecutor wired (maxConcurrency: 3)')

  // Step 8: Run!
  console.log('\n🚀 Running DSL through real Pilot engine...\n')
  const result = await runDSLWithPilot(dslSteps, context, stepExecutor, parallelExecutor)

  // Step 9: Report
  console.log('\n' + '='.repeat(70))
  console.log('PHASE B — PILOT EXECUTION REPORT')
  console.log('='.repeat(70))

  console.log(`\n📊 Summary:`)
  console.log(`   Steps executed: ${result.stepsExecuted}`)
  console.log(`   Steps failed: ${result.stepsFailed}`)
  console.log(`   Total tokens (mock): ${result.totalTokens}`)

  if (result.errors.length > 0) {
    console.log(`\n   ❌ Errors:`)
    for (const err of result.errors) {
      console.log(`      - ${err}`)
    }
  }

  const allClear = result.stepsFailed === 0
  console.log(`\n${allClear ? '✅ PILOT SIMULATION PASSED' : '❌ PILOT SIMULATION HAS FAILURES'}`)
  console.log('='.repeat(70))

  // Save report
  const reportPath = path.join(outputDir, 'pilot-simulation-report.json')
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    phase: 'B',
    summary: {
      steps_executed: result.stepsExecuted,
      steps_failed: result.stepsFailed,
      total_tokens: result.totalTokens,
    },
    step_log: result.stepLog,
    errors: result.errors,
  }, null, 2))
  console.log(`\nReport saved: ${reportPath}`)

  process.exit(allClear ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
