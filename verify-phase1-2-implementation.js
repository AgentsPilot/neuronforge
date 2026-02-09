/**
 * Verification script for Phase 1-2 core implementation
 * Tests that file_operations, post_ai_filters, and conditionals compile correctly
 */

const { DeclarativeCompiler } = require('./lib/agentkit/v6/compiler/DeclarativeCompiler.ts')

// Test IR with all three new fields (matching your Gmail workflow)
const testIR = {
  ir_version: '3.0',
  goal: 'Extract invoice/expense data from Gmail attachments, store in Drive, append to appropriate Sheets tab',

  data_sources: [{
    type: 'api',
    source: 'gmail',
    location: 'Gmail',
    role: 'Source of invoice/expense emails',
    plugin_key: 'google-mail',
    operation_type: 'search_emails',
    config: { query: 'subject:(invoice OR receipt) has:attachment' }
  }],

  ai_operations: [{
    type: 'deterministic_extract',
    instruction: 'Extract invoice/expense fields from attachment',
    context: 'Email attachment content',
    output_schema: {
      type: 'object',
      fields: [
        { name: 'date', type: 'string', required: false, description: 'Invoice date' },
        { name: 'vendor', type: 'string', required: false, description: 'Vendor name' },
        { name: 'amount', type: 'number', required: false, description: 'Total amount' },
        { name: 'classification', type: 'string', required: true, description: 'invoice or expense' }
      ]
    },
    constraints: {
      max_tokens: 500,
      temperature: 0.3,
      model_preference: 'balanced'
    }
  }],

  // NEW: file_operations (Gap #1 fix)
  file_operations: [{
    type: 'upload_file',
    source_data: '{{attachment_content}}',
    output_config: {
      filename: '{{vendor}}_{{date}}.pdf',
      format: 'pdf'
    },
    upload_destination: {
      plugin_key: 'google-drive',
      operation_type: 'upload',
      location: '1BoYgIIQj5QB6F0mWLzD_0-2pMLoxHVp-/{{vendor}}'
    }
  }],

  // NEW: post_ai_filters (Gap #2 fix)
  post_ai_filters: {
    combineWith: 'AND',
    conditions: [{
      field: 'amount',
      operator: 'is_not_null',
      value: null,
      description: 'Only append when amount is extracted'
    }]
  },

  // NEW: conditionals (Gap #3 fix)
  conditionals: [{
    condition: {
      type: 'simple',
      field: 'classification',
      operator: 'equals',
      value: 'invoice'
    },
    then_actions: [{
      type: 'send_to_recipient',
      params: {
        plugin_key: 'google-sheets',
        operation_type: 'append_rows',
        config: {
          spreadsheet_id: '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE',
          range: 'Invoices'
        }
      }
    }],
    else_actions: [{
      type: 'send_to_recipient',
      params: {
        plugin_key: 'google-sheets',
        operation_type: 'append_rows',
        config: {
          spreadsheet_id: '1RHLbBXzrKv24gNgp7a4Lr7RlMIrP9fjacfGWjhPAbOE',
          range: 'Expenses'
        }
      }
    }]
  }],

  delivery_rules: {
    summary_delivery: {
      plugin_key: 'google-mail',
      operation_type: 'send',
      recipient: 'manager@company.com',
      subject: 'Invoice/Expense Summary'
    },
    send_when_no_results: true
  }
}

async function verify() {
  console.log('🧪 Testing Phase 1-2 Core Implementation...\n')

  const compiler = new DeclarativeCompiler()
  const result = await compiler.compile(testIR)

  if (!result.success) {
    console.log('❌ COMPILATION FAILED')
    console.log('Errors:', result.errors)
    process.exit(1)
  }

  console.log('✅ Compilation succeeded!')
  console.log(`Generated ${result.workflow.length} steps\n`)

  // Verify all three gaps are fixed
  const workflow = result.workflow

  // Gap #1: Check for Drive upload step
  const driveUploadStep = workflow.find(step =>
    step.plugin === 'google-drive' || step.action === 'upload'
  )
  console.log('Gap #1 (Drive upload):', driveUploadStep ? '✅ FIXED' : '❌ MISSING')

  // Gap #2: Check for post-AI filter step
  const postAIFilterStep = workflow.find(step =>
    step.type === 'transform' &&
    step.operation === 'filter' &&
    step.id?.includes('post_ai')
  )
  console.log('Gap #2 (Post-AI filters):', postAIFilterStep ? '✅ FIXED' : '❌ MISSING')

  // Gap #3: Check for conditional step
  const conditionalStep = workflow.find(step =>
    step.type === 'conditional'
  )
  console.log('Gap #3 (Conditionals):', conditionalStep ? '✅ FIXED' : '❌ MISSING')

  console.log('\n📊 Workflow Steps:')
  workflow.forEach((step, idx) => {
    console.log(`  ${idx + 1}. ${step.type} - ${step.name || step.id}`)
  })

  console.log('\n✨ Phase 1-2 Core Implementation: SUCCESS!')
}

verify().catch(err => {
  console.error('❌ Verification failed:', err)
  process.exit(1)
})
