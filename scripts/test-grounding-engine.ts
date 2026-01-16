/**
 * Test Grounding Engine
 *
 * Demonstrates the full grounding flow:
 * 1. Create a Semantic Plan with assumptions
 * 2. Provide real data source metadata (headers + sample data)
 * 3. Ground the plan (validate assumptions, resolve field names)
 * 4. Show grounding results
 */

import { GroundingEngine } from '../lib/agentkit/v6/semantic-plan/grounding/GroundingEngine'
import type { SemanticPlan } from '../lib/agentkit/v6/semantic-plan/schemas/semantic-plan-types'
import type { DataSourceMetadata } from '../lib/agentkit/v6/semantic-plan/grounding/DataSampler'

// Mock Semantic Plan for the leads workflow
const semanticPlan: SemanticPlan = {
  plan_version: '1.0',
  goal: 'Filter high-qualified leads (stage=4) and send personalized emails to each salesperson',

  understanding: {
    data_source: {
      type: 'tabular',
      source: 'google_sheets',
      location: 'MyLeads spreadsheet, Leads tab',
      description: 'Read lead rows from Google Sheets'
    },

    filtering: {
      description: 'Filter leads where stage qualification equals 4',
      conditions: [
        {
          field: 'stage',
          operation: 'equals',
          value: 4,
          confidence: 'high'
        }
      ]
    },

    grouping: {
      needs_grouping: true,
      group_by_field: 'salesperson_email_field',
      strategy_description: 'Group leads by salesperson, one email per salesperson'
    },

    rendering: {
      format: 'email_body_table',
      description: 'Email-body embedded table with specific columns',
      columns: ['Date', 'Lead Name', 'Company Email', 'Phone', 'Notes', 'Sales Person']
    },

    delivery: {
      pattern: 'per_group',
      recipients_description: 'Each salesperson gets one email with their assigned leads',
      recipient_resolution_strategy: 'Find field containing salesperson emails, group leads by that field'
    },

    edge_cases: [
      {
        condition: 'zero_high_qualified_leads',
        handling: 'Send email stating "0 high qualified leads found"'
      },
      {
        condition: 'missing_salesperson_value',
        handling: 'Include in separate section sent to Barak'
      }
    ]
  },

  assumptions: [
    {
      id: 'stage_field',
      category: 'field_name',
      description: 'Spreadsheet has a column named "stage" containing numeric qualification levels',
      confidence: 'high',
      validation_strategy: {
        method: 'fuzzy_match',
        parameters: {
          candidates: ['stage', 'Stage', 'qualification_stage', 'lead_stage']
        }
      },
      impact_if_wrong: 'critical',
      fallback: 'Ask user to specify which column contains stage information'
    },
    {
      id: 'salesperson_field',
      category: 'field_name',
      description: 'There is a column containing salesperson email addresses or identifiers',
      confidence: 'medium',
      validation_strategy: {
        method: 'fuzzy_match',
        parameters: {
          candidates: ['Sales Person', 'Salesperson', 'sales_person', 'Owner', 'Assigned To'],
          require_email_format: true
        }
      },
      impact_if_wrong: 'critical',
      fallback: 'Ask user to specify salesperson field name'
    },
    {
      id: 'date_field',
      category: 'field_name',
      description: 'There is a column named "Date" for the lead date',
      confidence: 'high',
      validation_strategy: {
        method: 'exact_match',
        parameters: {
          candidates: ['Date', 'date', 'Lead Date', 'Created Date']
        }
      },
      impact_if_wrong: 'minor',
      fallback: 'Omit date from table'
    },
    {
      id: 'lead_name_field',
      category: 'field_name',
      description: 'There is a column named "Lead Name" for the lead name',
      confidence: 'high',
      validation_strategy: {
        method: 'fuzzy_match',
        parameters: {
          candidates: ['Lead Name', 'Name', 'Contact Name', 'lead_name']
        }
      },
      impact_if_wrong: 'major',
      fallback: 'Use first available name field'
    },
    {
      id: 'stage_is_numeric',
      category: 'data_type',
      description: 'The stage field contains numeric values',
      confidence: 'high',
      validation_strategy: {
        method: 'data_sample',
        parameters: {
          field_name: 'stage',
          expected_type: 'number'
        }
      },
      impact_if_wrong: 'critical',
      fallback: 'Try string comparison if numeric fails'
    }
  ],

  inferences: [
    {
      field: 'email_subject',
      value: 'Your High-Qualified Leads for {today}',
      reasoning: 'User didn\'t specify subject. Inferred from context: leads report with date',
      confidence: 'medium',
      user_overridable: true
    }
  ],

  ambiguities: [
    {
      field: 'salesperson_column_name',
      question: 'Which column contains the salesperson identifier?',
      possible_resolutions: [
        'Column named "Sales Person" (most likely based on user\'s words)',
        'Column named "Salesperson" (variant without space)',
        'Column named "Owner" (common CRM field)'
      ],
      recommended_resolution: 'Use fuzzy matching to find column containing "sales" and "person"',
      resolution_strategy: 'Check actual sheet headers, validate it contains email addresses',
      requires_user_input: false
    }
  ],

  reasoning_trace: [
    {
      step: 1,
      decision: 'How to filter',
      choice_made: 'Filter by stage field equaling 4',
      reasoning: 'User explicitly said "stage equals 4". Stage is likely a column name. Value 4 represents high-qualified.'
    },
    {
      step: 2,
      decision: 'How to group',
      choice_made: 'Group by salesperson email field',
      reasoning: 'User said "send one email per salesperson", implies grouping by salesperson identifier'
    },
    {
      step: 3,
      decision: 'Recipient resolution',
      choice_made: 'Use salesperson field value as recipient',
      reasoning: 'Each group represents one salesperson, use their email as recipient'
    }
  ]
}

// Mock Data Source Metadata (simulates actual Google Sheets data)
const dataSourceMetadata: DataSourceMetadata = {
  type: 'tabular',
  headers: [
    'Date',
    'Lead Name',
    'Company Email',
    'Phone',
    'Notes',
    'Sales Person', // ← Exact match for "Sales Person"
    'stage'         // ← Lowercase, but should still match
  ],
  sample_rows: [
    {
      'Date': '2024-01-15',
      'Lead Name': 'Alice Johnson',
      'Company Email': 'alice@company.com',
      'Phone': '555-0100',
      'Notes': 'Interested in enterprise plan',
      'Sales Person': 'john@sales.com',
      'stage': 4
    },
    {
      'Date': '2024-01-16',
      'Lead Name': 'Bob Smith',
      'Company Email': 'bob@startup.io',
      'Phone': '555-0101',
      'Notes': 'Needs demo',
      'Sales Person': 'sarah@sales.com',
      'stage': 4
    },
    {
      'Date': '2024-01-17',
      'Lead Name': 'Charlie Brown',
      'Company Email': 'charlie@corp.com',
      'Phone': '555-0102',
      'Notes': 'Hot lead',
      'Sales Person': 'john@sales.com',
      'stage': 3 // ← Not stage 4
    },
    {
      'Date': '2024-01-18',
      'Lead Name': 'Diana Prince',
      'Company Email': 'diana@business.com',
      'Phone': '555-0103',
      'Notes': 'Follow up next week',
      'Sales Person': 'sarah@sales.com',
      'stage': 4
    },
    {
      'Date': '2024-01-19',
      'Lead Name': 'Eve Adams',
      'Company Email': 'eve@example.com',
      'Phone': '555-0104',
      'Notes': 'Urgent',
      'Sales Person': '', // ← Missing salesperson
      'stage': 4
    }
  ],
  row_count: 5,
  plugin_key: 'google-sheets-plugin'
}

async function testGroundingEngine() {
  console.log('=== Grounding Engine Test ===\n')

  const groundingEngine = new GroundingEngine()

  console.log('📋 Semantic Plan:')
  console.log(`   Goal: ${semanticPlan.goal}`)
  console.log(`   Assumptions: ${semanticPlan.assumptions.length}`)
  console.log(`   Ambiguities: ${semanticPlan.ambiguities.length}`)
  console.log()

  console.log('📊 Data Source Metadata:')
  console.log(`   Type: ${dataSourceMetadata.type}`)
  console.log(`   Headers: ${dataSourceMetadata.headers?.join(', ')}`)
  console.log(`   Sample Rows: ${dataSourceMetadata.sample_rows?.length}`)
  console.log()

  console.log('🔍 Starting Grounding Process...\n')

  const grounded = await groundingEngine.ground({
    semantic_plan: semanticPlan,
    data_source_metadata: dataSourceMetadata,
    config: {
      min_confidence: 0.7,
      fail_fast: false,
      require_confirmation_threshold: 0.85,
      max_candidates: 3
    }
  })

  console.log('\n✅ Grounding Complete!\n')

  console.log('📈 Results Summary:')
  console.log(`   Validated: ${grounded.validated_assumptions_count}/${grounded.total_assumptions_count}`)
  console.log(`   Overall Confidence: ${(grounded.grounding_confidence * 100).toFixed(1)}%`)
  console.log(`   Timestamp: ${grounded.grounding_timestamp}`)
  console.log()

  console.log('🎯 Grounding Results by Assumption:\n')

  for (const result of grounded.grounding_results) {
    const assumption = semanticPlan.assumptions.find(a => a.id === result.assumption_id)
    const status = result.validated ? '✅' : '❌'
    const confidence = (result.confidence * 100).toFixed(1)

    console.log(`${status} ${result.assumption_id}`)
    console.log(`   Description: ${assumption?.description}`)
    console.log(`   Validated: ${result.validated}`)
    console.log(`   Confidence: ${confidence}%`)
    console.log(`   Resolved Value: ${result.resolved_value}`)
    console.log(`   Method: ${result.validation_method}`)
    console.log(`   Evidence: ${result.evidence}`)

    if (result.alternatives && result.alternatives.length > 0) {
      console.log(`   Alternatives:`)
      result.alternatives.forEach(alt => {
        console.log(`      - ${alt.value} (confidence: ${(alt.confidence * 100).toFixed(1)}%)`)
      })
    }

    console.log()
  }

  if (grounded.grounding_errors.length > 0) {
    console.log('⚠️  Grounding Errors:\n')

    for (const error of grounded.grounding_errors) {
      console.log(`   ${error.severity.toUpperCase()}: ${error.assumption_id}`)
      console.log(`   Type: ${error.error_type}`)
      console.log(`   Message: ${error.message}`)
      console.log(`   Suggested Fix: ${error.suggested_fix}`)
      console.log()
    }
  }

  // Show what we learned
  console.log('💡 Grounded Facts (Ready for IR Generation):\n')

  const groundedFacts: Record<string, any> = {}

  for (const result of grounded.grounding_results) {
    if (result.validated && result.resolved_value) {
      groundedFacts[result.assumption_id] = result.resolved_value
    }
  }

  console.log(JSON.stringify(groundedFacts, null, 2))
  console.log()

  // Example: How these facts would be used in IR generation
  console.log('🚀 Example IR Generation (using grounded facts):\n')
  console.log('```json')
  console.log(JSON.stringify({
    filtering: {
      conditions: [
        {
          field: groundedFacts['stage_field'], // ← Exact field name from grounding
          operator: 'equals',
          value: 4
        }
      ]
    },
    grouping: {
      group_by: groundedFacts['salesperson_field'] // ← Exact field name from grounding
    },
    rendering: {
      columns: [
        groundedFacts['date_field'],
        groundedFacts['lead_name_field'],
        'Company Email',
        'Phone',
        'Notes',
        groundedFacts['salesperson_field']
      ]
    },
    delivery_rules: {
      per_group_delivery: {
        recipient_source: groundedFacts['salesperson_field'] // ← Guaranteed correct
      }
    }
  }, null, 2))
  console.log('```')
  console.log()

  console.log('✨ Success! The Semantic Plan has been grounded with real data.')
  console.log('   Next step: Use grounded facts to generate precise IR.')
}

// Run the test
testGroundingEngine().catch(error => {
  console.error('❌ Test failed:', error)
  process.exit(1)
})
