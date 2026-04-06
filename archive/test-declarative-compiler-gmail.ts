/**
 * Test DeclarativeCompiler with Gmail Complaints IR
 *
 * This tests if the DeclarativeCompiler (deterministic rule-based) can compile
 * the Gmail complaints workflow correctly.
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

const testIR: DeclarativeLogicalIR = {
  "ir_version": "3.0",
  "goal": "Log Gmail Inbox complaint emails from the last 7 days into Google Sheets, appending one row per matching message and avoiding duplicates using the Gmail message link/id",
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
      "role": "lookup",
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
        "range": "UrgentEmails"
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
          {
            "field": "body",
            "operator": "contains",
            "value": "complaint",
            "description": "Complaint keyword match: complaint"
          },
          {
            "field": "body",
            "operator": "contains",
            "value": "refund",
            "description": "Complaint keyword match: refund"
          },
          {
            "field": "body",
            "operator": "contains",
            "value": "angry",
            "description": "Complaint keyword match: angry"
          },
          {
            "field": "body",
            "operator": "contains",
            "value": "not working",
            "description": "Complaint keyword match: not working"
          }
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
      "subject": "Append complaint emails to UrgentEmails",
      "include_missing_section": false,
      "plugin_key": "google-sheets",
      "operation_type": "append_rows"
    }
  },
  "edge_cases": [
    {
      "condition": "no_rows_after_filter",
      "action": "skip_execution",
      "message": "No complaint emails found in the last 7 days after keyword filtering.",
      "recipient": "google_sheets_destination"
    }
  ],
  "clarifications_required": []
}

async function testDeclarativeCompiler() {
  console.log('='.repeat(80))
  console.log('Testing DeclarativeCompiler with Gmail Complaints IR')
  console.log('='.repeat(80))

  try {
    // Initialize PluginManager
    console.log('\n1. Initializing PluginManager...')
    const pluginManager = await PluginManagerV2.getInstance()
    console.log('   ✓ PluginManager initialized')

    // Create compiler
    console.log('\n2. Creating DeclarativeCompiler...')
    const compiler = new DeclarativeCompiler(pluginManager)
    console.log('   ✓ Compiler created')

    // Compile IR
    console.log('\n3. Compiling IR...')
    const startTime = Date.now()
    const result = await compiler.compile(testIR)
    const duration = Date.now() - startTime

    console.log(`   ✓ Compilation completed in ${duration}ms`)

    // Check result
    if (result.success) {
      console.log('\n✅ SUCCESS!')
      console.log('   Steps generated:', result.workflow.length)
      console.log('   Warnings:', result.warnings?.length || 0)

      console.log('\n📋 Generated Workflow:')
      console.log(JSON.stringify(result.workflow, null, 2))

      if (result.warnings && result.warnings.length > 0) {
        console.log('\n⚠️  Warnings:')
        result.warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`))
      }

      if (result.logs && result.logs.length > 0) {
        console.log('\n📝 Compilation Logs:')
        result.logs.forEach(log => console.log(`   ${log}`))
      }
    } else {
      console.log('\n❌ COMPILATION FAILED')
      console.log('   Errors:', result.errors)
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
  process.exit(0)
}).catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
