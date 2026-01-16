#!/usr/bin/env npx tsx

/**
 * Simple DSL Wrapper Test
 * Tests wrapping the 4-step workflow (before deduplication fix)
 */

import { wrapInPilotDSL } from './lib/agentkit/v6/compiler/utils/DSLWrapper'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

// ============================================================================
// Test Data
// ============================================================================

const testWorkflowSteps = [
  {
    "id": "fetch_google_mail_1",
    "name": "Fetch google_mail Data",
    "type": "action",
    "plugin": "google-mail",
    "action": "search_emails",
    "params": {
      "query": "in:inbox newer_than:7d",
      "max_results": 10,
      "include_attachments": false,
      "folder": "inbox"
    }
  },
  {
    "id": "filter_group_1_2",
    "name": "Filter Group 1",
    "type": "transform",
    "operation": "filter",
    "input": "{{fetch_google_mail_1.data}}",
    "config": {
      "combineWith": "OR",
      "conditions": [
        {
          "field": "email_content",
          "operator": "contains",
          "value": "complaint"
        },
        {
          "field": "email_content",
          "operator": "contains",
          "value": "refund"
        },
        {
          "field": "email_content",
          "operator": "contains",
          "value": "angry"
        },
        {
          "field": "email_content",
          "operator": "contains",
          "value": "not working"
        }
      ]
    }
  },
  {
    "id": "render_table_3",
    "name": "Render Table",
    "type": "transform",
    "operation": "render_table",
    "input": "{{filter_group_1_2.filtered}}",
    "config": {
      "rendering_type": "json",
      "columns": [
        "sender_email",
        "subject",
        "date",
        "full_email_text",
        "gmail_message_link_or_id"
      ],
      "empty_message": "If no complaint emails are found, append nothing."
    }
  },
  {
    "id": "send_summary_4",
    "name": "Send Summary via google-sheets",
    "type": "action",
    "plugin": "google-sheets",
    "action": "append_rows",
    "params": {
      "spreadsheet_id": "{{inputs.spreadsheet_id}}",
      "range": "A:Z",
      "values": "{{render_table_3}}",
      "input_option": "USER_ENTERED",
      "insert_data_option": "INSERT_ROWS"
    }
  }
]

const testIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Find complaint emails from Gmail and append to Google Sheet',

  data_sources: [
    {
      type: 'api',
      source: 'google_mail',
      role: 'primary',
      plugin_key: 'google-mail',
      operation_type: 'search',
      location: 'Gmail inbox'
    },
    {
      type: 'tabular',
      source: 'google_sheets',
      role: 'write_target',
      plugin_key: 'google-sheets',
      operation_type: 'read' as any, // Write operations handled in delivery_rules
      location: 'ComplaintLog sheet'
    }
  ],

  filters: {
    combineWith: 'OR',
    conditions: [
      { field: 'email_content', operator: 'contains', value: 'complaint' },
      { field: 'email_content', operator: 'contains', value: 'refund' },
      { field: 'email_content', operator: 'contains', value: 'angry' },
      { field: 'email_content', operator: 'contains', value: 'not working' }
    ]
  },

  rendering: {
    type: 'json',
    columns_in_order: ['sender_email', 'subject', 'date', 'full_email_text', 'gmail_message_link_or_id'],
    empty_message: 'No complaint emails found'
  },

  delivery_rules: {
    multiple_destinations: [
      {
        name: 'Append to sheet',
        recipient: '',
        plugin_key: 'google-sheets',
        operation_type: 'append_rows'
      }
    ]
  }
}

// ============================================================================
// Run Test
// ============================================================================

console.log('='.repeat(80))
console.log('DSL Wrapper Test - Gmail Complaints Workflow')
console.log('='.repeat(80))
console.log('')

console.log('Input:')
console.log('  Workflow steps:', testWorkflowSteps.length)
console.log('  IR goal:', testIR.goal)
console.log('')

const dsl = wrapInPilotDSL(
  testWorkflowSteps as any,
  testIR,
  {
    plugins_used: ['google-mail', 'google-sheets'],
    compilation_time_ms: 42
  }
)

console.log('='.repeat(80))
console.log('DSL OUTPUT:')
console.log('='.repeat(80))
console.log(JSON.stringify(dsl, null, 2))
console.log('')

console.log('='.repeat(80))
console.log('DSL SUMMARY:')
console.log('='.repeat(80))
console.log('')
console.log('Agent Name:', dsl.agent_name)
console.log('Description:', dsl.description)
console.log('Workflow Type:', dsl.workflow_type)
console.log('Suggested Plugins:', dsl.suggested_plugins.join(', '))
console.log('')
console.log('Required Inputs:', dsl.required_inputs.length)
dsl.required_inputs.forEach((input: any) => {
  console.log(`  - ${input.name} (${input.type}): ${input.description}`)
})
console.log('')
console.log('Suggested Outputs:', dsl.suggested_outputs.length)
dsl.suggested_outputs.forEach((output: any) => {
  console.log(`  - ${output.name} (${output.type}): ${output.description}`)
})
console.log('')
console.log('Workflow Steps:', dsl.workflow_steps.length)
dsl.workflow_steps.forEach((step: any) => {
  console.log(`  - ${step.id}: ${step.name} (${step.type})`)
})
console.log('')
console.log('Reasoning:', dsl.reasoning)
console.log('')

console.log('='.repeat(80))
console.log('✓ DSL Wrapper Test Complete')
console.log('='.repeat(80))
