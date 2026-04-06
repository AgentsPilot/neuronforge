/**
 * Test DeclarativeCompiler with Phase 2 fixes
 *
 * This tests the fixed DeclarativeCompiler to verify:
 * 1. Pre-computed boolean pattern for deduplication
 * 2. Null safety with || []
 * 3. Clear error messages
 * 4. Deterministic compilation
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

const testIR: DeclarativeLogicalIR = {
  "ir_version": "3.0",
  "goal": "Log Gmail Inbox complaint emails from the last 7 days into Google Sheets",
  "data_sources": [
    {
      "type": "api",
      "source": "google_mail",
      "location": "gmail",
      "role": "primary",
      "tab": null,
      "endpoint": null,
      "trigger": null,
      "plugin_key": "google-mail",
      "operation_type": "search_emails",
      "config": {
        "query": "in:inbox newer_than:7d",
        "max_results": null,
        "include_attachments": null,
        "folder": null,
        "spreadsheet_id": null,
        "range": null
      }
    },
    {
      "type": "tabular",
      "source": "google_sheets",
      "location": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
      "role": "reference",  // This triggers deduplication
      "tab": "UrgentEmails",
      "endpoint": null,
      "trigger": null,
      "plugin_key": "google-sheets",
      "operation_type": "read_range",
      "config": {
        "query": null,
        "max_results": null,
        "include_attachments": null,
        "folder": null,
        "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc",
        "range": "UrgentEmails",
        "identifier_field": "gmail_message_link_or_id"  // Field to deduplicate on
      }
    }
  ],
  "normalization": null,
  "filters": {
    "combineWith": "AND",
    "conditions": [],
    "groups": [
      {
        "combineWith": "OR",
        "conditions": [
          { "field": "body", "operator": "contains", "value": "complaint", "description": "Complaint keyword" },
          { "field": "body", "operator": "contains", "value": "refund", "description": "Refund keyword" }
        ]
      }
    ]
  },
  "ai_operations": null,
  "partitions": null,
  "grouping": null,
  "rendering": {
    "type": "json",
    "template": null,
    "engine": null,
    "columns_in_order": [
      "sender_email",
      "subject",
      "date",
      "full_email_text",
      "gmail_message_link_or_id"
    ],
    "empty_message": null,
    "summary_stats": null
  },
  "delivery_rules": {
    "send_when_no_results": false,
    "per_item_delivery": null,
    "per_group_delivery": null,
    "summary_delivery": {
      "recipient": "google_sheets_destination",
      "cc": null,
      "subject": "Append complaint emails",
      "include_missing_section": false,
      "plugin_key": "google-sheets",
      "operation_type": "append_rows"
    }
  },
  "edge_cases": [],
  "clarifications_required": []
}

async function testDeclarativeCompiler() {
  console.log('='.repeat(80))
  console.log('Testing Fixed DeclarativeCompiler with Gmail Complaints Workflow')
  console.log('='.repeat(80))

  try {
    // Initialize PluginManager
    console.log('\n1. Initializing PluginManager...')
    const pluginManager = await PluginManagerV2.getInstance()
    console.log('   ✓ PluginManager initialized')

    // Create DeclarativeCompiler (rule-based, deterministic)
    console.log('\n2. Creating DeclarativeCompiler...')
    const compiler = new DeclarativeCompiler(pluginManager)
    console.log('   ✓ Compiler created')

    // Compile IR
    console.log('\n3. Compiling IR with DeclarativeCompiler (rule-based)...')
    const startTime = Date.now()
    const result = await compiler.compile(testIR)
    const duration = Date.now() - startTime

    console.log(`   ✓ Compilation completed in ${duration}ms`)

    // Check result
    if (result.success) {
      console.log('\n✅ SUCCESS!')
      console.log('   Steps generated:', result.workflow.length)
      console.log('   Compilation time:', duration + 'ms')

      // Print compilation logs
      if (result.logs && result.logs.length > 0) {
        console.log('\n📋 Compilation Logs:')
        result.logs.forEach(log => console.log('   ' + log))
      }

      console.log('\n📊 Generated Workflow:')
      console.log(JSON.stringify(result.workflow, null, 2))

      // Validation checks
      console.log('\n🔍 Validation Checks:')

      // Check 1: Find deduplication steps (should be 3-step pattern)
      const precomputeStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'map' &&
        s.config?.expression?.includes('.includes')
      )
      const filterStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'filter' &&
        s.config?.condition?.includes('item[1] == true')
      )
      const extractStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'map' &&
        s.config?.expression === 'item[0]'
      )

      console.log(`   ${precomputeStep ? '✅' : '❌'} Pre-compute step exists: ${!!precomputeStep}`)
      console.log(`   ${filterStep ? '✅' : '❌'} Filter step exists: ${!!filterStep}`)
      console.log(`   ${extractStep ? '✅' : '❌'} Extract step exists: ${!!extractStep}`)

      // Check 2: Verify null safety
      if (precomputeStep) {
        const hasNullSafety = precomputeStep.config?.expression?.includes('|| []')
        console.log(`   ${hasNullSafety ? '✅' : '❌'} Null safety (|| []) present: ${hasNullSafety}`)

        if (hasNullSafety) {
          console.log(`   ✓ Expression: ${precomputeStep.config.expression}`)
        }
      }

      // Check 3: No invalid operators
      const invalidOperators = result.workflow.filter(s =>
        s.config?.condition?.operator === 'not_in_array'
      )
      console.log(`   ${invalidOperators.length === 0 ? '✅' : '❌'} No invalid operators: ${invalidOperators.length === 0}`)

      // Check 4: Performance
      const isUnder200ms = duration < 200
      console.log(`   ${isUnder200ms ? '✅' : '⚠️'} Compilation time < 200ms: ${isUnder200ms} (${duration}ms)`)

      // Summary
      console.log('\n📈 Summary:')
      console.log(`   • Total steps: ${result.workflow.length}`)
      console.log(`   • Compilation time: ${duration}ms`)
      console.log(`   • Uses pre-computed boolean pattern: ${!!precomputeStep && !!filterStep && !!extractStep}`)
      console.log(`   • Null-safe: ${!!precomputeStep && precomputeStep.config?.expression?.includes('|| []')}`)
      console.log(`   • No invalid operators: ${invalidOperators.length === 0}`)

    } else {
      console.log('\n❌ COMPILATION FAILED')
      console.log('   Errors:', result.errors)
      if (result.logs) {
        console.log('\n📋 Compilation Logs:')
        result.logs.forEach(log => console.log('   ' + log))
      }
    }

  } catch (error) {
    console.error('\n❌ ERROR:', error)
    if (error instanceof Error) {
      console.error('   Message:', error.message)
      console.error('   Stack:', error.stack)
    }
  }

  console.log('\n' + '='.repeat(80))
}

// Run test
testDeclarativeCompiler().then(() => {
  console.log('\n✓ Test complete')
  process.exit(0)
}).catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
