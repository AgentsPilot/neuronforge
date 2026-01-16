/**
 * Test Declarative Compiler - Write Operations Fix
 *
 * Tests that the compiler correctly handles write operations (append/update/etc.)
 * when data sources use operation_type field (schema-constrained)
 */

import { compileDeclarativeIR } from './lib/agentkit/v6/compiler/DeclarativeCompiler.js'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.js'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2.js'

// ============================================================================
// Test: Gmail Urgent Email Workflow with Google Sheets Logging
// ============================================================================

const urgentEmailWorkflowIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Find urgent Gmail emails and log them to Google Sheets',

  data_sources: [
    {
      type: 'api',
      source: 'gmail',
      location: 'emails',
      role: 'primary',
      tab: null,
      endpoint: '/messages',
      trigger: null,
      plugin_key: 'google-mail',
      operation_type: 'search'
    },
    {
      type: 'tabular',
      source: 'google_sheets',
      location: 'AgentsPilot',
      role: 'log_store',  // This can be any semantic name now!
      tab: 'UrgentEmails',
      endpoint: null,
      trigger: null,
      plugin_key: 'google-sheets',
      operation_type: 'append'  // Schema-constrained - compiler uses this!
    }
  ],

  normalization: null,

  filters: {
    combineWith: 'AND',
    conditions: [
      {
        field: 'subject',
        operator: 'contains',
        value: 'urgent',
        description: 'Urgent emails only'
      }
    ],
    groups: null
  },

  ai_operations: null,

  partitions: null,

  grouping: {
    group_by: null,
    emit_per_group: null
  },

  rendering: {
    type: 'email_embedded_table',
    template: null,
    engine: null,
    columns_in_order: ['subject', 'from', 'date'],
    empty_message: 'No urgent emails found'
  },

  delivery_rules: {
    per_item_delivery: null,
    per_group_delivery: null,
    summary_delivery: {
      recipient: 'admin@company.com',
      cc: null,
      subject: 'Urgent Emails Summary',
      include_missing_section: null,
      plugin_key: 'google-mail',
      operation_type: 'send'
    },
    send_when_no_results: true
  },

  edge_cases: null,

  clarifications_required: null
}

// ============================================================================
// Run Test
// ============================================================================

async function testWriteOperations() {
  console.log('='.repeat(80))
  console.log('TEST: WRITE OPERATIONS FIX')
  console.log('Testing operation_type-based detection (not role-based)')
  console.log('='.repeat(80))
  console.log()

  console.log('IR Data Sources:')
  urgentEmailWorkflowIR.data_sources.forEach((ds, idx) => {
    console.log(`  ${idx + 1}. ${ds.source}`)
    console.log(`     Type: ${ds.type}`)
    console.log(`     Role: ${ds.role} (semantic - can be any value)`)
    console.log(`     Operation Type: ${ds.operation_type} (schema-constrained)`)
    console.log()
  })

  console.log('Initializing PluginManagerV2...')
  const pluginManager = await PluginManagerV2.getInstance()
  console.log('PluginManager initialized\n')

  console.log('Compiling IR...')
  console.log()

  const result = await compileDeclarativeIR(urgentEmailWorkflowIR, pluginManager)

  console.log('COMPILATION RESULT:')
  console.log('Success:', result.success)
  console.log('Steps generated:', result.workflow?.length || 0)
  console.log()

  if (result.success && result.workflow) {
    console.log('WORKFLOW STEPS:')
    result.workflow.forEach((step: any, idx: number) => {
      console.log(`\n${idx + 1}. ${step.step_id}`)
      console.log(`   Type: ${step.type}`)
      if (step.plugin) console.log(`   Plugin: ${step.plugin}`)
      if (step.operation) console.log(`   Operation: ${step.operation}`)
      if (step.output_variable) console.log(`   Output: ${step.output_variable}`)
    })

    console.log()
    console.log('LOGS:')
    result.logs?.forEach((log: string) => console.log(`  ${log}`))

    console.log()
    console.log('='.repeat(80))
    console.log('VERIFICATION:')
    console.log('='.repeat(80))

    const hasReadStep = result.workflow.some(s => s.step_id.includes('fetch'))
    const hasWriteStep = result.workflow.some(s =>
      s.step_id.includes('write') &&
      s.plugin === 'google-sheets'
    )
    const hasSendStep = result.workflow.some(s =>
      s.step_id.includes('send') &&
      s.plugin === 'google-mail'
    )

    console.log(`✓ Gmail read step present: ${hasReadStep ? 'YES' : 'NO'}`)
    console.log(`✓ Google Sheets write step present: ${hasWriteStep ? 'YES' : 'NO'}`)
    console.log(`✓ Gmail send step present: ${hasSendStep ? 'YES' : 'NO'}`)

    if (hasReadStep && hasWriteStep && hasSendStep) {
      console.log()
      console.log('🎉 SUCCESS! All expected steps are present.')
      console.log('   The compiler correctly detected write operations using operation_type.')
    } else {
      console.log()
      console.log('❌ FAILURE! Missing expected steps.')
      console.log('   The compiler did not generate all required steps.')
    }
  }

  if (result.errors) {
    console.log()
    console.log('ERRORS:')
    result.errors.forEach((err: string) => console.log(`  ✗ ${err}`))
  }

  console.log()
}

testWriteOperations().catch(console.error)
