/**
 * Test Declarative Compiler
 *
 * Tests the smart compiler with declarative IR examples
 */

import { compileDeclarativeIR } from './lib/agentkit/v6/compiler/DeclarativeCompiler.js'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types.js'

// ============================================================================
// Test 1: Leads Workflow (Per-Group Delivery)
// ============================================================================

const leadsWorkflowIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Send stage 4 leads to each salesperson with table of their leads',

  data_sources: [{
    type: 'tabular',
    source: 'google_sheets',
    location: 'MyLeads',
    tab: 'Leads',
    role: 'Lead data from sales team'
  }],

  normalization: {
    required_headers: ['stage', 'Sales Person', 'Date', 'Lead Name', 'Company Email', 'Phone', 'Notes'],
    case_sensitive: false,
    missing_header_action: 'error'
  },

  filters: [{
    field: 'stage',
    operator: 'equals',
    value: 4,
    description: 'Only qualified leads'
  }],

  partitions: [{
    field: 'Sales Person',
    split_by: 'value',
    handle_empty: {
      partition_name: 'unassigned',
      description: 'Leads without assigned salesperson'
    }
  }],

  grouping: {
    group_by: 'Sales Person',
    emit_per_group: true
  },

  rendering: {
    type: 'email_embedded_table',
    columns_in_order: ['Date', 'Lead Name', 'Company Email', 'Phone', 'Notes', 'Sales Person'],
    empty_message: 'No qualified leads found'
  },

  delivery_rules: {
    per_group_delivery: {
      recipient_source: 'Sales Person',
      cc: ['meiribarak@gmail.com'],
      subject: 'Your Qualified Leads'
    },
    send_when_no_results: true
  },

  edge_cases: [{
    condition: 'no_rows_after_filter',
    action: 'send_empty_result_message',
    message: 'No stage 4 leads found today',
    recipient: 'meiribarak@gmail.com'
  }]
}

// ============================================================================
// Test 2: Gmail Expense Workflow (Summary Delivery with AI)
// ============================================================================

const expenseWorkflowIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Extract expense data from email PDF attachments and send summary',

  data_sources: [{
    type: 'api',
    source: 'gmail',
    location: 'emails',
    role: 'Expense emails with PDF receipts'
  }],

  filters: [
    {
      field: 'subject',
      operator: 'contains',
      value: 'expense',
      description: 'Emails about expenses'
    },
    {
      field: 'subject',
      operator: 'contains',
      value: 'receipt',
      description: 'Emails with receipts'
    }
  ],

  ai_operations: [{
    type: 'extract',
    instruction: 'Extract expense line items from PDF receipts including vendor, amount, date, and expense type. Mark fields as "need review" if uncertain.',
    context: 'PDF attachments from filtered emails',
    output_schema: {
      type: 'object',
      fields: [
        { name: 'vendor', type: 'string', required: true, description: 'Vendor name' },
        { name: 'amount', type: 'string', required: true, description: 'Total amount' },
        { name: 'date', type: 'string', required: true, description: 'Expense date' },
        { name: 'expense_type', type: 'string', required: true, description: 'Type of expense' }
      ]
    },
    constraints: {
      max_tokens: 500,
      temperature: 0.3,
      model_preference: 'balanced'
    }
  }],

  rendering: {
    type: 'email_embedded_table',
    columns_in_order: ['date', 'vendor', 'amount', 'expense_type'],
    empty_message: 'No expenses found'
  },

  delivery_rules: {
    summary_delivery: {
      recipient: 'finance@company.com',
      subject: 'Expense Report Summary'
    },
    send_when_no_results: true
  },

  edge_cases: [{
    condition: 'no_rows_after_filter',
    action: 'send_empty_result_message',
    message: 'No expense emails found'
  }]
}

// ============================================================================
// Run Tests
// ============================================================================

async function testLeadsWorkflow() {
  console.log('='.repeat(80))
  console.log('TEST 1: LEADS WORKFLOW (Per-Group Delivery)')
  console.log('='.repeat(80))
  console.log()

  const result = await compileDeclarativeIR(leadsWorkflowIR)

  console.log()
  console.log('COMPILATION RESULT:')
  console.log('Success:', result.success)
  console.log('Steps generated:', result.workflow?.length || 0)

  if (result.success && result.workflow) {
    console.log()
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
  }

  if (result.errors) {
    console.log()
    console.log('ERRORS:')
    result.errors.forEach((err: string) => console.log(`  ✗ ${err}`))
  }

  console.log()
}

async function testExpenseWorkflow() {
  console.log('='.repeat(80))
  console.log('TEST 2: EXPENSE WORKFLOW (Summary Delivery with AI)')
  console.log('='.repeat(80))
  console.log()

  const result = await compileDeclarativeIR(expenseWorkflowIR)

  console.log()
  console.log('COMPILATION RESULT:')
  console.log('Success:', result.success)
  console.log('Steps generated:', result.workflow?.length || 0)

  if (result.success && result.workflow) {
    console.log()
    console.log('WORKFLOW STEPS:')
    result.workflow.forEach((step: any, idx: number) => {
      console.log(`\n${idx + 1}. ${step.step_id}`)
      console.log(`   Type: ${step.type}`)
      if (step.plugin) console.log(`   Plugin: ${step.plugin}`)
      if (step.operation) console.log(`   Operation: ${step.operation}`)
      if (step.output_variable) console.log(`   Output: ${step.output_variable}`)
      if (step.type === 'scatter_gather') {
        console.log(`   Loop over: ${step.config?.data}`)
        console.log(`   Item variable: ${step.config?.item_variable}`)
        console.log(`   Actions in loop: ${step.config?.actions?.length || 0}`)
      }
    })

    console.log()
    console.log('LOGS:')
    result.logs?.forEach((log: string) => console.log(`  ${log}`))
  }

  if (result.errors) {
    console.log()
    console.log('ERRORS:')
    result.errors.forEach((err: string) => console.log(`  ✗ ${err}`))
  }

  console.log()
}

async function runAllTests() {
  await testLeadsWorkflow()
  await testExpenseWorkflow()

  console.log('='.repeat(80))
  console.log('EXPECTED BEHAVIOR:')
  console.log('='.repeat(80))
  console.log()
  console.log('Leads Workflow should generate:')
  console.log('  1. read_sheet step')
  console.log('  2. normalize_headers step')
  console.log('  3. filter_stage step')
  console.log('  4. partition step')
  console.log('  5. group_by step')
  console.log('  6. scatter_gather loop with:')
  console.log('     - render_group action')
  console.log('     - send_group_email action')
  console.log()
  console.log('Expense Workflow should generate:')
  console.log('  1. fetch_emails step')
  console.log('  2. filter_subject steps (x2)')
  console.log('  3. extract_pdfs step (AUTO-INJECTED!)')
  console.log('  4. scatter_gather loop with:')
  console.log('     - ai_extract action')
  console.log('  5. render_summary step')
  console.log('  6. send_summary step')
  console.log()
  console.log('Key Intelligence Demonstrated:')
  console.log('  ✓ Loop inference from delivery_rules')
  console.log('  ✓ Auto-ID generation (no IDs in IR!)')
  console.log('  ✓ Auto-injection of PDF extraction')
  console.log('  ✓ Plugin binding (google-sheets, google-mail)')
  console.log('  ✓ Variable flow management')
  console.log('='.repeat(80))
}

runAllTests().catch(console.error)
