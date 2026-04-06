/**
 * Test DSL Format - Check if generated DSL matches execution layer
 */

import { compileDeclarativeIR } from './lib/agentkit/v6/compiler/DeclarativeCompiler.js'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.js'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2.js'

const testIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Test DSL format',
  data_sources: [{
    type: 'api',
    source: 'gmail',
    location: 'emails',
    role: 'primary',
    tab: null,
    endpoint: '/messages',
    trigger: null,
    plugin_key: 'google-mail',
    operation_type: 'search'
  }],
  normalization: null,
  filters: {
    combineWith: 'AND',
    conditions: [{
      field: 'subject',
      operator: 'contains',
      value: 'test',
      description: 'Test emails'
    }],
    groups: null
  },
  ai_operations: null,
  partitions: null,
  grouping: { group_by: null, emit_per_group: null },
  rendering: null,
  delivery_rules: {
    per_item_delivery: null,
    per_group_delivery: null,
    summary_delivery: {
      recipient: 'test@test.com',
      cc: null,
      subject: 'Test Summary',
      include_missing_section: null,
      plugin_key: 'google-mail',
      operation_type: 'send'
    },
    send_when_no_results: false
  },
  edge_cases: null,
  clarifications_required: null
}

async function testDSLFormat() {
  console.log('Testing DSL Format Compliance...\n')

  // Initialize PluginManagerV2 to get real plugin capabilities
  console.log('Initializing PluginManagerV2...')
  const pluginManager = await PluginManagerV2.getInstance()
  console.log('PluginManager initialized with', Object.keys(pluginManager.getAvailablePlugins()).length, 'plugins\n')

  const result = await compileDeclarativeIR(testIR, pluginManager)

  if (!result.success || !result.workflow) {
    console.error('✗ Compilation failed:', result.errors)
    process.exit(1)
  }

  console.log('Generated', result.workflow.length, 'steps\n')

  // Check each step
  result.workflow.forEach((step, idx) => {
    console.log(`Step ${idx + 1}: ${step.step_id}`)
    console.log(`  Type: ${step.type}`)

    // Check required fields
    const hasId = 'id' in step
    const hasName = 'name' in step
    const hasStepId = 'step_id' in step

    console.log(`  ✓ Has id: ${hasId ? '✓' : '✗'}`)
    console.log(`  ✓ Has name: ${hasName ? '✓' : '✗'}`)
    console.log(`  ✓ Has step_id: ${hasStepId ? '✓' : '✗'}`)

    if (step.type === 'action') {
      const hasAction = 'action' in step
      const hasParams = 'params' in step
      const hasOperation = 'operation' in step
      const hasConfig = 'config' in step

      console.log(`  ✓ Has action (not operation): ${hasAction ? '✓' : '✗'}`)
      console.log(`  ✓ Has params (not config): ${hasParams ? '✓' : '✗'}`)

      if (hasOperation) {
        console.log(`  ✗ ERROR: Still using 'operation' instead of 'action'`)
      }
      if (hasConfig) {
        console.log(`  ✗ ERROR: Still using 'config' instead of 'params'`)
      }
    }

    if (step.type === 'transform') {
      const hasInput = 'input' in step
      const hasDataInConfig = step.config && 'data' in step.config

      console.log(`  ✓ Has input field: ${hasInput ? '✓' : '✗'}`)

      if (hasDataInConfig) {
        console.log(`  ✗ ERROR: Still has 'data' in config (should be in 'input')`)
      }
    }

    console.log()
  })

  // Summary
  const allStepsHaveId = result.workflow.every((s: any) => 'id' in s)
  const allStepsHaveName = result.workflow.every((s: any) => 'name' in s)
  const allActionsUseAction = result.workflow.filter((s: any) => s.type === 'action').every((s: any) => 'action' in s)
  const allActionsUseParams = result.workflow.filter((s: any) => s.type === 'action').every((s: any) => 'params' in s)
  const allTransformsHaveInput = result.workflow.filter((s: any) => s.type === 'transform').every((s: any) => 'input' in s)

  // Check plugin validity
  const availablePlugins = pluginManager.getAvailablePlugins()
  const actionSteps = result.workflow.filter((s: any) => s.type === 'action')
  const allPluginsValid = actionSteps.every((s: any) => {
    const plugin = availablePlugins[s.plugin]
    if (!plugin) {
      console.log(`  ✗ Invalid plugin: ${s.plugin}`)
      return false
    }

    const actionExists = plugin.actions[s.action]
    if (!actionExists) {
      console.log(`  ✗ Invalid action: ${s.plugin}.${s.action}`)
      console.log(`    Available actions: ${Object.keys(plugin.actions).join(', ')}`)
      return false
    }

    return true
  })

  console.log('='.repeat(40))
  console.log('SUMMARY:')
  console.log(`  All steps have id: ${allStepsHaveId ? '✓' : '✗'}`)
  console.log(`  All steps have name: ${allStepsHaveName ? '✓' : '✗'}`)
  console.log(`  All actions use 'action': ${allActionsUseAction ? '✓' : '✗'}`)
  console.log(`  All actions use 'params': ${allActionsUseParams ? '✓' : '✗'}`)
  console.log(`  All transforms have 'input': ${allTransformsHaveInput ? '✓' : '✗'}`)
  console.log(`  All plugins and actions valid: ${allPluginsValid ? '✓' : '✗'}`)
  console.log('='.repeat(40))

  if (allStepsHaveId && allStepsHaveName && allActionsUseAction && allActionsUseParams && allTransformsHaveInput && allPluginsValid) {
    console.log('\n🎉 DSL FORMAT IS CORRECT!')
  } else {
    console.log('\n❌ DSL FORMAT HAS ISSUES')
    process.exit(1)
  }
}

testDSLFormat().catch(console.error)
