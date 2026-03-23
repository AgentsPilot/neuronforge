/**
 * Phase D: Full WorkflowPilot Execution with Mocked Plugins
 *
 * Runs compiled DSL through the REAL WorkflowPilot with all 8 phases,
 * real WorkflowParser — but mocked plugins and mocked Supabase.
 * Zero external dependencies: no DB, no OAuth, no API calls.
 *
 * Usage: npx tsx --import ./scripts/env-preload.ts scripts/test-workflowpilot-execution.ts
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// === Step 1: Set up mocks BEFORE importing Pilot modules ===
console.log('╔══════════════════════════════════════════════════════════════════╗')
console.log('║       WorkflowPilot Execution — Phase D (Fully Mocked)         ║')
console.log('╚══════════════════════════════════════════════════════════════════╝')

console.log('\n⚙️  Setting up mocks...')

import { setupMockPluginExecuter, patchPluginExecuter } from './test-dsl-pilot-simulator/mocks/mock-plugin-executer'
import { disableAuditTrail, patchStepExecutorLLM } from './test-dsl-pilot-simulator/mocks/mock-services'
import { createMockSupabase } from './test-dsl-pilot-simulator/mocks/mock-supabase'
import { registerOutputSchemas, generateStubData } from './test-dsl-pilot-simulator/stub-data-provider'

async function main() {
  const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')

  // Capture all console output to file
  const logLines: string[] = []
  const originalLog = console.log
  const originalWarn = console.warn
  const originalError = console.error
  console.log = (...args: any[]) => {
    const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    logLines.push(line)
    originalLog(...args)
  }
  console.warn = (...args: any[]) => {
    const line = '[WARN] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    logLines.push(line)
    originalWarn(...args)
  }
  console.error = (...args: any[]) => {
    const line = '[ERROR] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')
    logLines.push(line)
    originalError(...args)
  }
  const userId = crypto.randomUUID() // Fake user — no DB needed

  // Step 1: Initialize mocks
  setupMockPluginExecuter((plugin, action, params) => {
    return generateStubData(plugin, action, params)
  })

  await disableAuditTrail()
  await patchPluginExecuter()
  await patchStepExecutorLLM()

  // Step 2: Load compiled DSL + config
  console.log('\n📁 Loading compiled DSL and config...')
  const dslPath = path.join(outputDir, 'phase4-pilot-dsl-steps.json')
  const configPath = path.join(outputDir, 'phase4-workflow-config.json')

  if (!fs.existsSync(dslPath) || !fs.existsSync(configPath)) {
    console.error('❌ Missing output files. Run the pipeline first:')
    console.error('   npx tsx --import ./scripts/env-preload.ts scripts/test-complete-pipeline-with-vocabulary.ts scripts/test-intent-contract-generation-enhanced-prompt.json')
    process.exit(1)
  }

  const dslSteps = JSON.parse(fs.readFileSync(dslPath, 'utf-8'))
  const workflowConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  console.log(`  Loaded ${dslSteps.length} DSL steps`)
  console.log(`  Loaded ${Object.keys(workflowConfig).length} config keys: ${Object.keys(workflowConfig).join(', ')}`)

  // Register output schemas for stub generation
  registerOutputSchemas(dslSteps)

  // Step 3: Import real Pilot modules (AFTER mocks)
  console.log('\n🏗️  Importing real Pilot components...')
  const { WorkflowPilot } = await import('../lib/pilot/WorkflowPilot')
  console.log('  ✅ WorkflowPilot loaded')

  // Step 4: Create mock Supabase client — all DB calls return empty/null
  const mockSupabase = createMockSupabase()
  console.log('  ✅ Mock Supabase created (no real DB connection)')

  // Step 5: Extract plugins from DSL
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

  // Step 6: Build in-memory agent object (no DB save needed)
  const agentId = crypto.randomUUID()
  const agent = {
    id: agentId,
    user_id: userId,
    agent_name: 'V6 DSL Test Agent — Phase D',
    user_prompt: 'Scan Gmail for invoice/expense PDF attachments, extract data, store in Drive, append to Sheets, send digest email',
    system_prompt: '',
    enhanced_prompt: '',
    pilot_steps: dslSteps,
    workflow_steps: dslSteps,
    plugins_required: Array.from(pluginsUsed),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  console.log(`\n📋 Agent (in-memory):`)
  console.log(`   ID: ${agentId}`)
  console.log(`   Plugins: ${Array.from(pluginsUsed).join(', ')}`)
  console.log(`   Steps: ${dslSteps.length}`)

  // Step 7: Create WorkflowPilot with mock Supabase and execute
  console.log('\n🚀 Starting WorkflowPilot execution...')
  console.log('─'.repeat(70))

  const pilot = new WorkflowPilot(mockSupabase as any, {
    maxParallelSteps: 3,
    enableCaching: false,
    continueOnError: false,
    enableProgressTracking: false, // No DB to track in
    enableRealTimeUpdates: false,
    enableOptimizations: true,
  })

  const stepEmitter = {
    onStepStarted: (stepId: string, stepName: string) => {
      console.log(`  ▶️  ${stepId}: ${stepName}`)
    },
    onStepCompleted: (stepId: string, stepName: string) => {
      console.log(`  ✅ ${stepId}: ${stepName}`)
    },
    onStepFailed: (stepId: string, stepName: string, error: string) => {
      console.log(`  ❌ ${stepId}: ${stepName} — ${error}`)
    },
  }

  const startTime = Date.now()

  let result: any
  try {
    result = await pilot.execute(
      agent as any,
      userId,
      'Process invoice/expense emails',
      workflowConfig,
      undefined, // sessionId — auto-generated
      stepEmitter,
      false, // debugMode
      undefined, // debugRunId
      undefined, // executionId
      'production' // runMode
    )
  } catch (err: any) {
    console.error(`\n❌ WorkflowPilot.execute() threw: ${err.message}`)
    console.error(err.stack?.slice(0, 500))
    result = { success: false, error: err.message, stepsCompleted: 0, stepsFailed: 0 }
  }

  const executionTime = Date.now() - startTime
  console.log('─'.repeat(70))

  // Step 8: Report results
  console.log('\n' + '='.repeat(70))
  console.log('PHASE D — WORKFLOWPILOT EXECUTION REPORT')
  console.log('='.repeat(70))

  console.log(`\n📊 Summary:`)
  console.log(`   Success: ${result.success ? '✅' : '❌'}`)
  console.log(`   Steps completed: ${result.stepsCompleted || 0}`)
  console.log(`   Steps failed: ${result.stepsFailed || 0}`)
  console.log(`   Steps skipped: ${result.stepsSkipped || 0}`)
  console.log(`   Execution time: ${executionTime}ms`)
  console.log(`   Total tokens: ${result.totalTokensUsed || 0}`)

  if (result.executionId) {
    console.log(`   Execution ID: ${result.executionId}`)
  }

  if (result.error) {
    console.log(`\n   ❌ Error: ${result.error}`)
  }

  if (result.failedStepIds?.length > 0) {
    console.log(`\n   ❌ Failed steps: ${result.failedStepIds.join(', ')}`)
  }

  if (result.completedStepIds?.length > 0) {
    console.log(`\n   ✅ Completed steps: ${result.completedStepIds.join(', ')}`)
  }

  // Step 9: Save report
  const reportPath = path.join(outputDir, 'workflowpilot-execution-report.json')
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    phase: 'D',
    agent_id: agentId,
    execution_id: result.executionId || null,
    summary: {
      success: result.success,
      steps_completed: result.stepsCompleted || 0,
      steps_failed: result.stepsFailed || 0,
      steps_skipped: result.stepsSkipped || 0,
      execution_time_ms: executionTime,
      total_tokens: result.totalTokensUsed || 0,
    },
    completed_steps: result.completedStepIds || [],
    failed_steps: result.failedStepIds || [],
    error: result.error || null,
  }, null, 2))
  console.log(`\nReport saved: ${reportPath}`)

  const allClear = result.success === true
  console.log(`\n${allClear ? '✅ PHASE D PASSED' : '❌ PHASE D HAS ISSUES'}`)
  console.log('='.repeat(70))

  // Save full console output to log file for review
  const logPath = path.join(outputDir, 'workflowpilot-execution-log.txt')
  fs.writeFileSync(logPath, logLines.join('\n'))
  originalLog(`\nFull log saved: ${logPath}`)

  process.exit(allClear ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
