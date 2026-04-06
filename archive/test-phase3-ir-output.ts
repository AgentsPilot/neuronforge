/**
 * Test Phase 3 IR Output
 *
 * Run just the formalization phase to see what IR is generated
 * from the semantic plan (without grounding for now)
 */

import { IRFormalizer } from './lib/agentkit/v6/semantic-plan/IRFormalizer.js'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2.js'
import type { GroundedSemanticPlan } from './lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types.js'

// Simplified semantic plan from the user's test (the correct understanding)
const semanticPlan: GroundedSemanticPlan = {
  goal: 'Search Gmail for expense-related emails from last 7 days, extract PDF receipt data using AI, create combined table, and email summary',

  understanding: {
    data_sources: [
      {
        type: 'api',
        source: 'gmail',
        source_description: 'Gmail emails',
        location: 'user\'s inbox',
        time_window: 'last 7 days',
        search_criteria: {
          subject_filter: {
            logic: 'OR',
            keywords: ['expenses', 'receipt']
          },
          time_filter: 'newer_than:7d'
        }
      }
    ],

    filtering: {
      description: 'Filter emails by subject containing "expenses" OR "receipt" and from last 7 days',
      conditions: [
        {
          field: 'subject',
          operation: 'contains',
          value: 'expenses'
        }
      ],
      complex_logic: {
        type: 'OR',
        conditions: [
          { field: 'subject', operation: 'contains', value: 'expenses' },
          { field: 'subject', operation: 'contains', value: 'receipt' }
        ]
      }
    },

    ai_processing: [
      {
        type: 'extract',
        instruction: 'Extract expense data from PDF attachments',
        input_description: 'PDF files attached to filtered emails',
        output_description: 'Structured expense table with fields: date, vendor, amount, category, description',
        field_mappings: []
      }
    ],

    rendering: {
      format: 'email_body_table',
      columns: ['date', 'vendor', 'amount', 'category', 'description'],
      summary_stats: ['total_amount', 'count']
    },

    delivery: {
      pattern: 'summary',
      recipient: 'admin@company.com',
      subject: 'Weekly Expense Report',
      include_summary: true
    }
  },

  assumptions: [],
  ambiguities: [],
  reasoning_trace: [
    {
      step: 1,
      question: 'What is the data source?',
      choice_made: 'Gmail emails',
      reasoning: 'User wants to search Gmail'
    }
  ],

  // Mock grounded plan structure (no actual grounding)
  grounded: false,
  grounding_results: [],
  grounding_errors: [],
  validated_assumptions_count: 0,
  total_assumptions_count: 0,
  grounding_confidence: 0,
  timestamp: new Date().toISOString()
}

async function testPhase3IROutput() {
  console.log('='.repeat(80))
  console.log('TEST: PHASE 3 IR OUTPUT')
  console.log('Testing what IR is generated from semantic plan')
  console.log('='.repeat(80))
  console.log()

  // Initialize PluginManager
  const pluginManager = await PluginManagerV2.getInstance()
  console.log(`PluginManager initialized with ${Object.keys(pluginManager.getAvailablePlugins()).length} plugins\n`)

  // Initialize IRFormalizer
  const irFormalizer = new IRFormalizer({
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.0,
    max_tokens: 4000,
    openai_api_key: process.env.OPENAI_API_KEY,
    pluginManager
  })

  console.log('Calling IRFormalizer.formalize()...\n')

  const result = await irFormalizer.formalize(semanticPlan)

  console.log('='.repeat(80))
  console.log('GENERATED IR:')
  console.log('='.repeat(80))
  console.log(JSON.stringify(result.ir, null, 2))
  console.log()

  console.log('='.repeat(80))
  console.log('CRITICAL INSPECTION:')
  console.log('='.repeat(80))

  const primarySource = result.ir.data_sources.find(ds => ds.role === 'primary')

  console.log('Primary Data Source:')
  console.log(`  Plugin: ${primarySource?.plugin_key}`)
  console.log(`  Operation: ${primarySource?.operation_type}`)
  console.log(`  Location: ${primarySource?.location}`)
  console.log()

  // Check if Gmail query is populated
  if (primarySource?.plugin_key === 'google-mail') {
    const config = (primarySource as any).config || {}
    const query = config.query || ''

    console.log('Gmail Query Parameter:')
    console.log(`  Value: "${query}"`)
    console.log(`  Status: ${query === '' ? '❌ EMPTY (BUG!)' : '✓ Populated'}`)
    console.log()

    if (query === '') {
      console.log('❌ BUG CONFIRMED!')
      console.log('   IRFormalizer generated empty Gmail query')
      console.log('   Expected: "subject:(expenses OR receipt) newer_than:7d"')
      console.log()
    }
  }

  // Check if filters are used instead of query
  if (result.ir.filters && result.ir.filters.conditions && result.ir.filters.conditions.length > 0) {
    console.log('IR Filters (generic conditions):')
    result.ir.filters.conditions.forEach((cond, idx) => {
      console.log(`  ${idx + 1}. field="${cond.field}" operator="${cond.operator}" value="${cond.value}"`)
    })
    console.log()
    console.log('⚠️  IRFormalizer used generic filters instead of Gmail query')
    console.log('   This is the root cause - compiler will have empty query!')
    console.log()
  }

  console.log('='.repeat(80))
  console.log('FORMALIZATION METADATA:')
  console.log('='.repeat(80))
  console.log(`Provider: ${result.formalization_metadata.provider}`)
  console.log(`Model: ${result.formalization_metadata.model}`)
  console.log(`Confidence: ${(result.formalization_metadata.formalization_confidence * 100).toFixed(1)}%`)
  console.log(`Grounded facts used: ${Object.keys(result.formalization_metadata.grounded_facts_used).length}`)
  console.log(`Missing facts: ${result.formalization_metadata.missing_facts.length}`)
  console.log()
}

testPhase3IROutput().catch(console.error)
