/**
 * Debug step6 in generated workflow
 */

import { IRToDSLCompiler } from './lib/agentkit/v6/compiler/IRToDSLCompiler'
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

async function debugStep6() {
  console.log('Compiling workflow...')

  const pluginManager = await PluginManagerV2.getInstance()
  const compiler = new IRToDSLCompiler({
    temperature: 0,
    maxTokens: 8000,
    pluginManager
  })

  const result = await compiler.compile(testIR)

  if (!result.success) {
    console.error('Compilation failed:', result.errors)
    process.exit(1)
  }

  console.log('\n=== STEP 6 DETAILS ===')
  const step6 = result.workflow.find(s => s.id === 'step6')

  if (!step6) {
    console.log('❌ Step6 not found in workflow!')
    console.log('Available steps:', result.workflow.map(s => s.id))
  } else {
    console.log('✓ Found step6:')
    console.log(JSON.stringify(step6, null, 2))
  }

  // Find step5 (should be reading sheet)
  console.log('\n=== STEP 5 DETAILS (Read Sheet) ===')
  const step5 = result.workflow.find(s => s.id === 'step5')
  if (step5) {
    console.log(JSON.stringify(step5, null, 2))
  }

  // Find step7 and step8
  console.log('\n=== STEP 7 DETAILS ===')
  const step7 = result.workflow.find(s => s.id === 'step7')
  if (step7) {
    console.log(JSON.stringify(step7, null, 2))
  }

  console.log('\n=== STEP 8 DETAILS ===')
  const step8 = result.workflow.find(s => s.id === 'step8')
  if (step8) {
    console.log(JSON.stringify(step8, null, 2))
  }

  // Find all steps
  console.log('\n=== ALL STEPS ===')
  result.workflow.forEach((step, i) => {
    console.log(`${i + 1}. ${step.id} (${step.type})${step.operation ? ' - ' + step.operation : ''}`)
    if (step.input) console.log(`   Input: ${step.input}`)
    if (step.dependencies) console.log(`   Dependencies: ${step.dependencies.join(', ')}`)
  })
}

debugStep6().then(() => process.exit(0)).catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
