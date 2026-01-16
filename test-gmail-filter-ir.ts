import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/types/declarative-ir-types'

const ir: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Find emails containing "urgent" keyword',
  data_sources: [
    {
      type: 'api',
      source: 'google_mail',
      location: 'gmail',
      role: 'primary',
      tab: null,
      endpoint: null,
      trigger: null,
      plugin_key: 'google-mail',
      operation_type: 'search_emails',
      config: {
        query: 'in:inbox newer_than:7d'
      }
    }
  ],
  normalization: null,
  filters: {
    combineWith: 'AND',
    conditions: [
      { field: 'subject', operator: 'contains', value: 'urgent' }
    ]
  },
  ai_operations: null,
  partitions: null,
  grouping: null,
  rendering: {
    type: 'json',
    columns_in_order: ['subject', 'from', 'date']
  },
  delivery_rules: {
    send_when_no_results: false,
    summary_delivery: {
      recipient: 'admin@company.com',
      plugin_key: 'google-mail',
      operation_type: 'send'
    }
  },
  edge_cases: [],
  clarifications_required: []
}

async function test() {
  const compiler = new DeclarativeCompiler()
  const result = await compiler.compile(ir)

  console.log('\n=== RESULT ===')
  console.log('Success:', result.success)
  if (!result.success) {
    console.log('Errors:', result.errors)
  }
}

test().catch(console.error)
