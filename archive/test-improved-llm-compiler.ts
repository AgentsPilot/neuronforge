/**
 * Test Improved IRToDSLCompiler with Gmail Complaints Workflow
 *
 * This tests the LLM compiler with improved prompt to verify:
 * 1. Uses 'snippet' instead of 'body' for Gmail filters
 * 2. Generates simple deduplication (no scatter_gather)
 * 3. Keeps ID column position consistent
 */

import { IRToDSLCompiler } from './lib/agentkit/v6/compiler/IRToDSLCompiler'
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

async function testImprovedCompiler() {
  console.log('='.repeat(80))
  console.log('Testing Improved IRToDSLCompiler with Gmail Complaints Workflow')
  console.log('='.repeat(80))

  try {
    // Initialize PluginManager
    console.log('\n1. Initializing PluginManager...')
    const pluginManager = await PluginManagerV2.getInstance()
    console.log('   ✓ PluginManager initialized')

    // Create LLM compiler
    console.log('\n2. Creating IRToDSLCompiler with improved prompt...')
    const compiler = new IRToDSLCompiler({
      temperature: 0,
      maxTokens: 8000,
      pluginManager
    })
    console.log('   ✓ Compiler created')

    // Compile IR
    console.log('\n3. Compiling IR with LLM...')
    const startTime = Date.now()
    const result = await compiler.compile(testIR)
    const duration = Date.now() - startTime

    console.log(`   ✓ Compilation completed in ${duration}ms`)

    // Check result
    if (result.success) {
      console.log('\n✅ SUCCESS!')
      console.log('   Steps generated:', result.workflow.length)
      console.log('   Plugins used:', result.plugins_used.join(', '))
      console.log('   Token usage:', result.token_usage)

      console.log('\n📋 Generated Workflow:')
      console.log(JSON.stringify(result.workflow, null, 2))

      // Validation checks
      console.log('\n🔍 Validation Checks:')

      // Check 1: Uses 'snippet' instead of 'body' in filter
      const filterStep = result.workflow.find(s => s.type === 'transform' && s.operation === 'filter')
      if (filterStep) {
        const usesSnippet = filterStep.config?.condition?.includes('snippet')
        const usesBody = filterStep.config?.condition?.includes('body')
        console.log(`   ${usesSnippet ? '✅' : '❌'} Filter uses 'snippet' field: ${usesSnippet}`)
        console.log(`   ${!usesBody ? '✅' : '❌'} Filter does NOT use 'body' field: ${!usesBody}`)
      }

      // Check 2: No scatter_gather for deduplication
      const scatterSteps = result.workflow.filter(s => s.type === 'scatter_gather')
      console.log(`   ${scatterSteps.length === 0 ? '✅' : '❌'} No scatter_gather steps: ${scatterSteps.length === 0}`)

      // Check 3: Column position consistency
      const extractIdStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'map' &&
        s.config?.expression?.includes('[')
      )
      const renderStep = result.workflow.find(s =>
        s.type === 'transform' &&
        s.operation === 'map' &&
        s.config?.expression?.includes('item.from') || s.config?.expression?.includes('item.email')
      )

      if (extractIdStep && renderStep) {
        const extractMatch = extractIdStep.config?.expression?.match(/item\[(\d+)\]/)
        const extractIndex = extractMatch ? parseInt(extractMatch[1]) : -1

        // Count commas in render expression to find ID position
        const renderExpr = renderStep.config?.expression || ''
        const idPosition = (renderExpr.match(/,/g) || []).length

        const consistent = extractIndex === idPosition
        console.log(`   ${consistent ? '✅' : '❌'} Column position consistent:`)
        console.log(`      - Extract ID from index: ${extractIndex}`)
        console.log(`      - Write ID to position: ${idPosition}`)
        console.log(`      - Consistent: ${consistent}`)
      }

      // Check 4: No invalid syntax
      const invalidSyntax = result.workflow.some(s =>
        s.config?.condition?.includes('!({{') // Extra parens
      )
      console.log(`   ${!invalidSyntax ? '✅' : '❌'} No invalid syntax (extra parens): ${!invalidSyntax}`)

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
testImprovedCompiler().then(() => {
  process.exit(0)
}).catch(error => {
  console.error('Unhandled error:', error)
  process.exit(1)
})
