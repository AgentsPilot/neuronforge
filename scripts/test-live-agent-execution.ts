/**
 * Phase E: Live Agent Execution with Real Plugins
 *
 * Executes a compiled DSL as a real agent with real plugin API calls,
 * real LLM calls, and real Supabase persistence. No mocks.
 *
 * Usage:
 *   npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts \
 *     --agent-id <UUID> \
 *     [--dsl <path>] \
 *     [--config <path>]
 *
 * Defaults:
 *   --dsl    output/vocabulary-pipeline/phase4-pilot-dsl-steps.json
 *   --config output/vocabulary-pipeline/phase4-workflow-config.json
 *
 * Requires: TEST_USER_ID in .env.local
 */

import fs from 'fs'
import path from 'path'

async function main() {
  const startTime = Date.now()

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

  console.log('╔══════════════════════════════════════════════════════════════════╗')
  console.log('║        Live Agent Execution — Phase E (Real Plugins)            ║')
  console.log('╚══════════════════════════════════════════════════════════════════╝')

  // ========================================
  // E1: Parse CLI arguments
  // ========================================
  console.log('\n📋 Parsing arguments...')

  const args = process.argv.slice(2)
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`)
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined
  }

  const agentId = getArg('agent-id')
  const dslPath = getArg('dsl') || path.join(process.cwd(), 'output', 'vocabulary-pipeline', 'phase4-pilot-dsl-steps.json')
  const configPath = getArg('config') || path.join(process.cwd(), 'output', 'vocabulary-pipeline', 'phase4-workflow-config.json')

  const userId = process.env.TEST_USER_ID
  if (!userId) {
    console.error('❌ TEST_USER_ID not found in environment. Add it to .env.local')
    process.exit(1)
  }

  if (!agentId) {
    console.error('❌ --agent-id is required')
    console.error('   Usage: npx tsx --import ./scripts/env-preload.ts scripts/test-live-agent-execution.ts --agent-id <UUID>')
    process.exit(1)
  }

  console.log(`   Agent ID:  ${agentId}`)
  console.log(`   User ID:   ${userId}`)
  console.log(`   DSL file:  ${dslPath}`)
  console.log(`   Config:    ${configPath}`)

  // ========================================
  // E2: Load and validate DSL
  // ========================================
  console.log('\n📁 Loading and validating DSL...')

  if (!fs.existsSync(dslPath)) {
    console.error(`❌ DSL file not found: ${dslPath}`)
    process.exit(1)
  }
  if (!fs.existsSync(configPath)) {
    console.error(`❌ Config file not found: ${configPath}`)
    process.exit(1)
  }

  const dslSteps = JSON.parse(fs.readFileSync(dslPath, 'utf-8'))
  const workflowConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

  if (!Array.isArray(dslSteps) || dslSteps.length === 0) {
    console.error('❌ DSL must be a non-empty array of steps')
    process.exit(1)
  }

  // Validate each step has required fields
  const validationErrors: string[] = []
  for (const step of dslSteps) {
    const stepId = step.id || step.step_id
    if (!stepId) validationErrors.push(`Step missing id/step_id`)
    if (!step.type) validationErrors.push(`${stepId}: missing type`)
    if (!step.name && !step.description) validationErrors.push(`${stepId}: missing name/description`)
    if (step.type === 'action') {
      if (!step.plugin) validationErrors.push(`${stepId}: action step missing plugin`)
      if (!step.action && !step.operation) validationErrors.push(`${stepId}: action step missing action/operation`)
    }
    // Validate nested steps in scatter-gather
    if (step.scatter?.steps) {
      for (const nested of step.scatter.steps) {
        const nId = nested.id || nested.step_id
        if (!nId) validationErrors.push(`Nested step missing id`)
        if (nested.type === 'action' && !nested.plugin) validationErrors.push(`${nId}: action step missing plugin`)
      }
    }
  }

  if (validationErrors.length > 0) {
    console.error(`❌ DSL validation failed:`)
    for (const err of validationErrors) {
      console.error(`   - ${err}`)
    }
    process.exit(1)
  }

  console.log(`  ✅ DSL valid: ${dslSteps.length} top-level steps`)
  console.log(`  ✅ Config: ${Object.keys(workflowConfig).length} keys (${Object.keys(workflowConfig).join(', ')})`)

  // ========================================
  // E3: Connect to Supabase and validate agent exists
  // ========================================
  console.log('\n🔍 Validating agent in database...')

  const { createServerSupabaseClient } = await import('../lib/supabaseServer')
  const supabase = createServerSupabaseClient()

  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('id, agent_name, status, plugins_required, user_id')
    .eq('id', agentId)
    .eq('user_id', userId)
    .neq('status', 'deleted')
    .single()

  if (agentError || !agent) {
    console.error(`❌ Agent not found: ${agentError?.message || 'no matching agent'}`)
    console.error(`   Searched: agents.id = '${agentId}' AND user_id = '${userId}' AND status != 'deleted'`)
    process.exit(1)
  }

  console.log(`  ✅ Agent found: "${agent.agent_name}" (status: ${agent.status})`)

  // ========================================
  // E4: Validate plugin connections + token refresh
  // ========================================
  console.log('\n🔌 Validating plugin connections...')

  // Extract required plugins from DSL
  const requiredPlugins = new Set<string>()
  const walkForPlugins = (steps: any[]) => {
    for (const step of steps) {
      if (step.plugin) requiredPlugins.add(step.plugin)
      if (step.scatter?.steps) walkForPlugins(step.scatter.steps)
      if (step.steps) walkForPlugins(step.steps)
      if (step.then_steps) walkForPlugins(step.then_steps)
      if (step.else_steps) walkForPlugins(step.else_steps)
    }
  }
  walkForPlugins(dslSteps)

  console.log(`   Required plugins: ${Array.from(requiredPlugins).join(', ')}`)

  // Get executable plugins (triggers token refresh for expired tokens)
  const { PluginManagerV2 } = await import('../lib/server/plugin-manager-v2')
  const pluginManager = await PluginManagerV2.getInstance()
  const executablePlugins = await pluginManager.getExecutablePlugins(userId, { forceRefresh: true })

  const missingPlugins: string[] = []
  for (const pluginKey of requiredPlugins) {
    // Check if it's a system plugin (no connection needed)
    const pluginDef = pluginManager.getPluginDefinition(pluginKey)
    if (pluginDef?.plugin?.isSystem) {
      console.log(`   ✅ ${pluginKey} — system plugin (no token needed)`)
      continue
    }

    if (executablePlugins[pluginKey]) {
      const conn = executablePlugins[pluginKey].connection
      const expiresAt = conn?.expires_at ? new Date(conn.expires_at) : null
      const minutesLeft = expiresAt ? Math.floor((expiresAt.getTime() - Date.now()) / 60000) : null
      console.log(`   ✅ ${pluginKey} — token valid${minutesLeft !== null ? ` (expires in ${minutesLeft} min)` : ''}`)
    } else {
      console.log(`   ❌ ${pluginKey} — NOT CONNECTED or token refresh failed`)
      missingPlugins.push(pluginKey)
    }
  }

  if (missingPlugins.length > 0) {
    console.error(`\n❌ Missing plugin connections: ${missingPlugins.join(', ')}`)
    console.error('   Connect these plugins in the app Settings before running.')
    process.exit(1)
  }

  console.log(`  ✅ All ${requiredPlugins.size} plugins ready`)

  // ========================================
  // E5: Update agent with pilot_steps
  // ========================================
  console.log('\n💾 Updating agent with compiled DSL...')

  const { error: updateError } = await supabase
    .from('agents')
    .update({
      pilot_steps: dslSteps,
      workflow_steps: dslSteps,
      plugins_required: Array.from(requiredPlugins),
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId)
    .eq('user_id', userId)

  if (updateError) {
    console.error(`❌ Failed to update agent: ${updateError.message}`)
    process.exit(1)
  }

  console.log(`  ✅ Agent updated: ${dslSteps.length} pilot_steps saved`)

  // ========================================
  // E6: Save input_values
  // ========================================
  console.log('\n💾 Saving input values...')

  // Upsert: delete old config, insert new
  await supabase
    .from('agent_configurations')
    .delete()
    .eq('agent_id', agentId)
    .eq('user_id', userId)

  const { error: configError } = await supabase
    .from('agent_configurations')
    .insert([{
      agent_id: agentId,
      user_id: userId,
      input_values: workflowConfig,
      status: 'completed',
      created_at: new Date().toISOString(),
    }])

  if (configError) {
    console.warn(`  ⚠️  Failed to save input values: ${configError.message}`)
    console.warn('     Continuing — will pass inputValues directly to execute()')
  } else {
    console.log(`  ✅ Input values saved (${Object.keys(workflowConfig).length} keys)`)
  }

  // ========================================
  // E7-E8: Execute with step detail capture
  // ========================================
  console.log('\n🚀 Starting LIVE execution...')
  console.log('─'.repeat(70))

  // Re-fetch the full agent record for WorkflowPilot
  const { data: fullAgent, error: fetchError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .eq('user_id', userId)
    .single()

  if (fetchError || !fullAgent) {
    console.error(`❌ Failed to fetch updated agent: ${fetchError?.message}`)
    process.exit(1)
  }

  const { WorkflowPilot } = await import('../lib/pilot/WorkflowPilot')
  const { StepExecutor } = await import('../lib/pilot/StepExecutor')

  // Patch StepExecutor to capture step inputs/outputs
  const stepIOCapture: Array<{
    step_id: string
    type: string
    plugin?: string
    action?: string
    description?: string
    resolved_input: any
    output: any
    status: 'ok' | 'error'
    error?: string
    duration_ms: number
  }> = []

  const originalExecute = StepExecutor.prototype.execute
  StepExecutor.prototype.execute = async function(step: any, context: any) {
    const stepStart = Date.now()
    const stepId = step.id || step.step_id

    // Capture resolved input
    let resolvedInput: any = null
    try {
      if (step.type === 'action') {
        resolvedInput = context.resolveAllVariables(step.params || {})
      } else if (step.input) {
        resolvedInput = context.resolveAllVariables(step.input)
      } else if (step.config) {
        resolvedInput = context.resolveAllVariables(step.config)
      }
    } catch (e) {
      resolvedInput = { _resolution_error: (e as any).message }
    }

    try {
      const result = await originalExecute.call(this, step, context)

      // Capture output (truncate large data for report readability)
      const outputData = result?.data !== undefined ? result.data : result
      const outputPreview = JSON.stringify(outputData)
      const truncatedOutput = outputPreview && outputPreview.length > 2000
        ? outputPreview.slice(0, 2000) + '...(truncated)'
        : outputData

      stepIOCapture.push({
        step_id: stepId,
        type: step.type,
        plugin: step.plugin,
        action: step.action || step.operation,
        description: step.description || step.name,
        resolved_input: resolvedInput,
        output: truncatedOutput,
        status: 'ok',
        duration_ms: Date.now() - stepStart,
      })

      // Print to console
      console.log(`     📥 Input: ${JSON.stringify(resolvedInput)?.slice(0, 200)}...`)
      console.log(`     📤 Output: ${JSON.stringify(outputData)?.slice(0, 200)}...`)

      return result
    } catch (err: any) {
      stepIOCapture.push({
        step_id: stepId,
        type: step.type,
        plugin: step.plugin,
        action: step.action || step.operation,
        description: step.description || step.name,
        resolved_input: resolvedInput,
        output: null,
        status: 'error',
        error: err.message,
        duration_ms: Date.now() - stepStart,
      })
      throw err
    }
  }

  const pilot = new WorkflowPilot(supabase, {
    maxParallelSteps: 3,
    enableCaching: false,
    continueOnError: false,
    enableProgressTracking: true,
    enableRealTimeUpdates: false,
    enableOptimizations: true,
  })

  // Step detail capture
  const stepDetails: any[] = []

  const stepEmitter = {
    onStepStarted: (stepId: string, stepName: string) => {
      console.log(`\n  ▶️  ${stepId}: ${stepName}`)
    },
    onStepCompleted: (stepId: string, stepName: string) => {
      console.log(`  ✅ ${stepId}: ${stepName}`)
    },
    onStepFailed: (stepId: string, stepName: string, error: string) => {
      console.log(`  ❌ ${stepId}: ${stepName}`)
      console.log(`     Error: ${error}`)
    },
  }

  let result: any
  try {
    result = await pilot.execute(
      fullAgent as any,
      userId,
      'Live execution from Phase E test script',
      workflowConfig,
      undefined, // sessionId
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
  console.log('\n' + '─'.repeat(70))

  // ========================================
  // E9: Report generation
  // ========================================
  console.log('\n' + '='.repeat(70))
  console.log('PHASE E — LIVE EXECUTION REPORT')
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

  // ========================================
  // E10: Verify execution record in DB
  // ========================================
  console.log('\n🔍 Checking execution record in database...')
  if (result.executionId) {
    const { data: execRecord, error: execError } = await supabase
      .from('agent_executions')
      .select('id, agent_id, status, created_at')
      .eq('id', result.executionId)
      .single()

    if (execRecord) {
      console.log(`  ✅ Execution record found: ${execRecord.id}`)
      console.log(`     Status: ${execRecord.status}`)
      console.log(`     Created: ${execRecord.created_at}`)
    } else {
      console.log(`  ⚠️  Execution record not found: ${execError?.message || 'unknown'}`)
    }
  }

  // Fetch step execution details from DB
  let stepExecutionDetails: any[] = []
  if (result.executionId) {
    console.log('\n📋 Fetching step execution details from database...')
    const { data: stepExecs, error: stepExecError } = await supabase
      .from('workflow_step_executions')
      .select('step_id, step_type, plugin, action, status, execution_metadata, tokens_used, execution_time_ms, error_message, item_count')
      .eq('workflow_execution_id', result.executionId)
      .order('started_at', { ascending: true })

    if (stepExecs && stepExecs.length > 0) {
      stepExecutionDetails = stepExecs
      console.log(`  ✅ Found ${stepExecs.length} step execution records`)

      // Print step details
      console.log('\n📊 Step Execution Details:')
      for (const step of stepExecs) {
        const icon = step.status === 'completed' ? '✅' : step.status === 'failed' ? '❌' : '⏭️'
        const plugin = step.plugin ? ` [${step.plugin}/${step.action}]` : ''
        const items = step.item_count ? ` (${step.item_count} items)` : ''
        const tokens = step.tokens_used ? ` | ${step.tokens_used} tokens` : ''
        const time = step.execution_time_ms ? ` | ${step.execution_time_ms}ms` : ''
        const fields = step.execution_metadata?.field_names ? ` | fields: [${step.execution_metadata.field_names.join(', ')}]` : ''

        console.log(`   ${icon} ${step.step_id} (${step.step_type})${plugin}${items}${tokens}${time}${fields}`)
        if (step.error_message) {
          console.log(`      Error: ${step.error_message}`)
        }
      }
    } else {
      console.log(`  ⚠️  No step execution records found: ${stepExecError?.message || 'empty result'}`)
    }
  }

  // Save JSON report
  const outputDir = path.join(process.cwd(), 'output', 'vocabulary-pipeline')
  const reportPath = path.join(outputDir, 'live-execution-report.json')
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    phase: 'E',
    agent_id: agentId,
    agent_name: agent.agent_name,
    user_id: userId,
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
    step_details: stepExecutionDetails,
    step_io: stepIOCapture,
    plugin_connections: Object.fromEntries(
      Array.from(requiredPlugins).map(p => [p, {
        connected: !!executablePlugins[p],
        is_system: pluginManager.getPluginDefinition(p)?.plugin?.isSystem || false,
      }])
    ),
    config_keys: Object.keys(workflowConfig),
  }, null, 2))

  console.log(`\nReport saved: ${reportPath}`)

  // Save full console log
  const logPath = path.join(outputDir, 'live-execution-log.txt')
  fs.writeFileSync(logPath, logLines.join('\n'))
  originalLog(`Log saved: ${logPath}`)

  const allClear = result.success === true
  console.log(`\n${allClear ? '✅ PHASE E PASSED — LIVE EXECUTION SUCCESSFUL' : '❌ PHASE E HAS ISSUES'}`)
  console.log('='.repeat(70))

  process.exit(allClear ? 0 : 1)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
