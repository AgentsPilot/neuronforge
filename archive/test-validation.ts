/**
 * Test script to verify workflow validation catches the Gmail PDF extraction gap
 */

import { compileIR } from './lib/agentkit/v6/compiler/LogicalIRCompiler'
import type { ExtendedLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/extended-ir-types'

// Gmail expense extraction workflow
const gmailExpenseIR: ExtendedLogicalIR = {
  ir_version: '2.0',
  goal: 'Extract and consolidate expense data from recent emails into a structured table and send a summary email.',
  data_sources: [
    {
      id: 'gmail_search',
      type: 'api',
      source: 'gmail',
      location: 'emails',
      tab: '',
      endpoint: '',
      trigger: '',
      role: 'email data'
    }
  ],
  normalization: {
    required_headers: [
      'date&time',
      'vendor',
      'amount',
      'expense type'
    ],
    case_sensitive: false,
    missing_header_action: 'warn'
  },
  filters: [
    {
      id: 'filter_subject',
      field: 'subject',
      operator: 'contains',
      value: 'expenses',
      description: 'Filter emails with subject containing \'expenses\''
    },
    {
      id: 'filter_subject_receipt',
      field: 'subject',
      operator: 'contains',
      value: 'receipt',
      description: 'Filter emails with subject containing \'receipt\''
    }
  ],
  transforms: [],
  ai_operations: [
    {
      id: 'extract_expense_items',
      type: 'extract',
      instruction: 'Extract expense line items from PDF attachments, including date&time, vendor, amount, and expense type. Mark fields as \'need review\' if uncertain.',
      input_source: '{{pdf_attachment}}',
      output_schema: {
        type: 'object',
        fields: [
          {
            name: 'date&time',
            type: 'string',
            required: true,
            description: 'Date and time of the expense'
          },
          {
            name: 'vendor',
            type: 'string',
            required: true,
            description: 'Vendor or merchant name'
          },
          {
            name: 'amount',
            type: 'string',
            required: true,
            description: 'Total amount for the line item'
          },
          {
            name: 'expense type',
            type: 'string',
            required: true,
            description: 'Type of expense inferred from receipt text'
          }
        ],
        enum: []
      },
      constraints: {
        max_tokens: 500,
        temperature: 0.5,
        model_preference: 'balanced'
      }
    }
  ],
  conditionals: [],
  loops: [
    {
      id: 'loop_pdfs',
      for_each: '{{pdf_attachments}}',
      item_variable: 'pdf_attachment',
      do: [
        'extract_expense_items'
      ],
      max_iterations: 100,
      max_concurrency: 5
    }
  ],
  partitions: [],
  grouping: undefined,
  rendering: {
    type: 'email_embedded_table',
    template: '',
    engine: 'jinja',
    columns_in_order: [
      'date&time',
      'vendor',
      'amount',
      'expense type'
    ],
    empty_message: 'No expenses found.'
  },
  delivery: [
    {
      id: 'email_delivery',
      method: 'email',
      config: {
        recipient: 'offir.omer@gmail.com',
        subject: 'Expense Report Summary',
        body: 'Summary of expenses extracted from emails.'
      }
    }
  ],
  edge_cases: [],
  clarifications_required: []
}

async function test() {
  console.log('=====================================')
  console.log('Testing Gmail Expense Workflow Validation')
  console.log('=====================================\n')

  const result = await compileIR(gmailExpenseIR)

  console.log('\n=====================================')
  console.log('COMPILATION RESULT')
  console.log('=====================================')
  console.log('Success:', result.success)

  if (result.validation) {
    console.log('\nVALIDATION RESULT:')
    console.log('Valid:', result.validation.valid)
    console.log('\nErrors:', result.validation.errors.length)
    result.validation.errors.forEach((err, i) => {
      console.log(`\n${i + 1}. ${err.type}:`)
      console.log(`   ${err.message}`)
      if (err.details) {
        console.log(`   Details:`, err.details)
      }
    })

    console.log('\nWarnings:', result.validation.warnings.length)
    result.validation.warnings.forEach((warn, i) => {
      console.log(`\n${i + 1}. ${warn.type}:`)
      console.log(`   ${warn.message}`)
      if (warn.suggestion) {
        console.log(`   Suggestion:`, warn.suggestion)
      }
    })
  }

  if (result.errors) {
    console.log('\nCOMPILATION ERRORS:')
    result.errors.forEach(err => console.log(`  - ${err}`))
  }

  console.log('\n=====================================')
  console.log('EXPECTED VALIDATION ERRORS:')
  console.log('=====================================')
  console.log('1. Variable "pdf_attachments" undefined')
  console.log('   - Loop references {{pdf_attachments}} but no step creates it')
  console.log('   - Should suggest adding extract_attachments transform')
  console.log('\n2. Type mismatch for scatter_gather input')
  console.log('   - Input is array<EmailMessage> but loop expects array<PDF>')
  console.log('=====================================\n')
}

test().catch(console.error)
