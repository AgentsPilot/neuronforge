/**
 * Wave 9 Deduplication Pattern Test
 *
 * Tests that the compiler correctly detects duplicate_records edge case
 * and adds deduplication logic using destination as reference source
 */

import { DeclarativeCompiler } from '../lib/agentkit/v6/compiler/DeclarativeCompiler'
import { validateDeclarativeIR } from '../lib/agentkit/v6/logical-ir/validation/DeclarativeIRValidator'
import type { DeclarativeLogicalIR } from '../lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

// Mock plugin definitions matching the real PluginDefinition structure
// PluginResolver expects: plugin.plugin (metadata), plugin.actions (object keyed by name)
const mockPlugins: Record<string, any> = {
  'google-mail': {
    plugin: {
      key: 'google-mail',
      name: 'Google Mail',
      version: '2.0',
      description: 'Google Mail (Gmail) integration'
    },
    actions: {
      search_emails: {
        name: 'search_emails',
        description: 'Search for emails in the user\'s Gmail account',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (supports Gmail search operators)' },
            max_results: { type: 'number', minimum: 1, maximum: 100, default: 10 },
            include_attachments: { type: 'boolean', default: false },
            folder: { type: 'string', enum: ['inbox', 'sent', 'drafts', 'spam', 'trash', 'all'], default: 'inbox' }
          },
          required: []
        }
      },
      list_messages: {
        name: 'list_messages',
        description: 'List messages',
        parameters: {
          type: 'object',
          properties: {
            folder: { type: 'string' },
            max_results: { type: 'number' }
          }
        }
      },
      send_email: {
        name: 'send_email',
        description: 'Compose and send an email message',
        parameters: {
          type: 'object',
          required: ['recipients', 'content'],
          properties: {
            recipients: { type: 'object', properties: { to: { type: 'array' }, cc: { type: 'array' }, bcc: { type: 'array' } } },
            content: { type: 'object', properties: { subject: { type: 'string' }, body: { type: 'string' } } }
          }
        }
      }
    }
  },
  'google-sheets': {
    plugin: {
      key: 'google-sheets',
      name: 'Google Sheets',
      version: '2.0',
      description: 'Google Sheets spreadsheet integration',
      category: 'tabular'
    },
    actions: {
      read_range: {
        name: 'read_range',
        description: 'Read from range',
        parameters: {
          type: 'object',
          properties: {
            spreadsheet_id: { type: 'string' },
            range: { type: 'string' }
          },
          required: ['spreadsheet_id', 'range']
        }
      },
      append_rows: {
        name: 'append_rows',
        description: 'Append rows',
        parameters: {
          type: 'object',
          properties: {
            spreadsheet_id: { type: 'string' },
            range: { type: 'string' },
            values: { type: 'array' }
          },
          required: ['spreadsheet_id', 'range', 'values']
        }
      }
    }
  }
}

// Mock plugin manager matching PluginManagerV2 interface
const mockPluginManager = {
  getPlugin: (key: string) => mockPlugins[key],
  getAvailablePlugins: () => mockPlugins,
  resolveOperation: (plugin: string, opType: string) => {
    const mapping: Record<string, Record<string, string>> = {
      'google-mail': { search: 'search', list: 'list_messages', read: 'list_messages' },
      'google-sheets': { read: 'read_range', write: 'append_rows', append: 'append_rows' }
    }
    return mapping[plugin]?.[opType] || opType
  }
}

// Test IR with duplicate_records edge case
// NOTE: Removed IR filters since data_source has config.query (avoids REDUNDANT_FILTER error)
const testIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Scan Gmail for complaint emails and log to Google Sheets, skipping duplicates',
  data_sources: [
    {
      type: 'api',
      source: 'Gmail',
      location: 'Inbox',
      role: 'primary',
      plugin_key: 'google-mail',
      operation_type: 'search',
      config: {
        query: 'subject:complaint OR subject:refund OR body:angry',
        max_results: 100
      }
    },
    {
      type: 'tabular',
      source: 'Google Sheets',
      location: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
      tab: 'UrgentEmails',
      role: 'destination',
      plugin_key: 'google-sheets',
      operation_type: 'append_rows',
      config: {
        spreadsheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
        range: 'UrgentEmails'
      }
    }
  ],
  // No IR filters - use plugin-native query filtering only
  filters: null,
  delivery_rules: {
    send_when_no_results: false,
    multiple_destinations: [
      {
        plugin_key: 'google-sheets',
        operation_type: 'append_rows',
        recipient: '{{inputs.spreadsheet_id}}'
      }
    ]
  },
  edge_cases: [
    {
      condition: 'duplicate_records',
      action: 'skip_execution',
      message: 'Skip emails already logged based on Gmail message ID'
    }
  ]
}

// Test IR WITHOUT duplicate_records (control test)
const testIRNoDuplicates: DeclarativeLogicalIR = {
  ...testIR,
  edge_cases: []
}

async function runTest() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║           Wave 9 Deduplication Pattern Test                ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // Pre-validate IR to see what's wrong
  console.log('PRE-CHECK: Validating IR')
  console.log('=' .repeat(60))
  const preValidation = validateDeclarativeIR(testIR)
  console.log(`Valid: ${preValidation.valid}`)
  if (!preValidation.valid) {
    console.log('Validation errors:')
    preValidation.errors.forEach((err, i) => {
      console.log(`  ${i + 1}. [${err.error_code}] ${err.message}`)
      if (err.ir_path) console.log(`     Path: ${err.ir_path}`)
      if (err.suggestion) console.log(`     Suggestion: ${err.suggestion}`)
    })
  }
  console.log('\n')

  // Test 1: With duplicate_records edge case
  console.log('TEST 1: IR WITH duplicate_records edge case')
  console.log('=' .repeat(60))

  try {
    const compiler = new DeclarativeCompiler(mockPluginManager as any)
    const result = await compiler.compile(testIR)

    console.log(`\nCompilation success: ${result.success}`)
    console.log(`Steps generated: ${result.workflow?.length || 0}`)

    if (result.workflow) {
      console.log('\nWorkflow steps:')
      result.workflow.forEach((step, i) => {
        const id = (step as any).id || (step as any).step_id || 'unknown'
        const type = step.type
        const plugin = (step as any).plugin || ''
        const operation = (step as any).operation || ''
        console.log(`  ${i + 1}. [${type}] ${id}: ${plugin ? plugin + '.' + operation : step.description || ''}`)
      })

      // Check for deduplication step (should have a read step for destination)
      const hasReadDestination = result.workflow.some(
        (step: any) => step.plugin === 'google-sheets' && step.operation === 'read_range'
      )
      console.log(`\n✓ Has read destination step (dedup): ${hasReadDestination}`)

      if (!hasReadDestination) {
        console.log('⚠️  WARNING: Expected a read step for destination (deduplication pattern)')
      }
    }

    if (result.warnings && result.warnings.length > 0) {
      console.log('\nWarnings:', result.warnings)
    }

  } catch (error: any) {
    console.error('❌ Test 1 FAILED:', error.message)
    console.error(error.stack?.split('\n').slice(0, 5).join('\n'))
  }

  console.log('\n')

  // Test 2: Without duplicate_records edge case
  console.log('TEST 2: IR WITHOUT duplicate_records edge case (control)')
  console.log('=' .repeat(60))

  try {
    const compiler = new DeclarativeCompiler(mockPluginManager as any)
    const result = await compiler.compile(testIRNoDuplicates)

    console.log(`\nCompilation success: ${result.success}`)
    console.log(`Steps generated: ${result.workflow?.length || 0}`)

    if (result.workflow) {
      console.log('\nWorkflow steps:')
      result.workflow.forEach((step, i) => {
        const id = (step as any).id || (step as any).step_id || 'unknown'
        const type = step.type
        const plugin = (step as any).plugin || ''
        const operation = (step as any).operation || ''
        console.log(`  ${i + 1}. [${type}] ${id}: ${plugin ? plugin + '.' + operation : step.description || ''}`)
      })

      // Check for deduplication step (should NOT have a read step for destination)
      const hasReadDestination = result.workflow.some(
        (step: any) => step.plugin === 'google-sheets' && step.operation === 'read_range'
      )
      console.log(`\n✓ Has read destination step (dedup): ${hasReadDestination}`)

      if (hasReadDestination) {
        console.log('⚠️  WARNING: Should NOT have read step without duplicate_records edge case')
      }
    }

  } catch (error: any) {
    console.error('❌ Test 2 FAILED:', error.message)
    console.error(error.stack?.split('\n').slice(0, 5).join('\n'))
  }

  console.log('\n')
  console.log('═'.repeat(60))
  console.log('Test completed')
}

runTest().catch(console.error)
