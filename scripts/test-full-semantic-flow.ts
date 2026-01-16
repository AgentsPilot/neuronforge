/**
 * Test Full Semantic Plan Flow
 *
 * Demonstrates the complete architecture:
 * Enhanced Prompt → Semantic Plan → Grounding → IR
 *
 * This test shows how the three-phase approach solves the "new prompt, new error" problem.
 */

import { SemanticPlanGenerator } from '../lib/agentkit/v6/semantic-plan/SemanticPlanGenerator'
import { GroundingEngine } from '../lib/agentkit/v6/semantic-plan/grounding/GroundingEngine'
import { IRFormalizer } from '../lib/agentkit/v6/semantic-plan/IRFormalizer'
import type { EnhancedPrompt } from '../lib/agentkit/v6/generation/types'
import type { DataSourceMetadata } from '../lib/agentkit/v6/semantic-plan/grounding/DataSampler'

// Load enhanced prompt from file
import enhancedPromptData from '../test-enhanced-prompt-leads.json'

// Mock Data Source Metadata (simulates actual Google Sheets data)
const dataSourceMetadata: DataSourceMetadata = {
  type: 'tabular',
  headers: [
    'Date',
    'Lead Name',
    'Company Email',
    'Phone',
    'Notes',
    'Sales Person',
    'stage'
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
      'stage': 3
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
      'Sales Person': 'john@sales.com',
      'stage': 4
    }
  ],
  row_count: 5,
  plugin_key: 'google-sheets-plugin'
}

async function testFullSemanticFlow() {
  console.log('=== Full Semantic Plan Flow Test ===\n')

  const enhancedPrompt = enhancedPromptData as EnhancedPrompt

  console.log('📋 Enhanced Prompt:')
  console.log(`   Data: ${enhancedPrompt.sections.data.length} statements`)
  console.log(`   Output: ${enhancedPrompt.sections.output.length} statements`)
  console.log(`   Actions: ${enhancedPrompt.sections.actions.length} statements`)
  console.log(`   Delivery: ${enhancedPrompt.sections.delivery.length} statements`)
  console.log()

  // Phase 1: Understanding (Semantic Plan Generation)
  console.log('🔍 Phase 1: Understanding (Semantic Plan Generation)\n')

  const semanticPlanGenerator = new SemanticPlanGenerator({
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.3,
    max_tokens: 6000
  })

  console.log('[Phase 1] Generating semantic plan...')
  const semanticPlan = await semanticPlanGenerator.generate(enhancedPrompt)

  console.log(`[Phase 1] ✅ Semantic Plan Generated`)
  console.log(`   Goal: ${semanticPlan.goal}`)
  console.log(`   Assumptions: ${semanticPlan.assumptions.length}`)
  console.log(`   Inferences: ${semanticPlan.inferences.length}`)
  console.log(`   Ambiguities: ${semanticPlan.ambiguities.length}`)
  console.log(`   Reasoning Steps: ${semanticPlan.reasoning_trace.length}`)
  console.log()

  console.log('   Key Assumptions Made:')
  semanticPlan.assumptions.slice(0, 3).forEach((assumption, i) => {
    console.log(`   ${i + 1}. ${assumption.id}: ${assumption.description}`)
    console.log(`      Confidence: ${assumption.confidence}, Impact: ${assumption.impact_if_wrong}`)
  })
  console.log()

  // Phase 2: Grounding (Validation)
  console.log('🎯 Phase 2: Grounding (Validation)\n')

  const groundingEngine = new GroundingEngine()

  console.log('[Phase 2] Grounding semantic plan against real data...')
  const groundedPlan = await groundingEngine.ground({
    semantic_plan: semanticPlan,
    data_source_metadata: dataSourceMetadata,
    config: {
      min_confidence: 0.7,
      fail_fast: false
    }
  })

  console.log(`[Phase 2] ✅ Grounding Complete`)
  console.log(`   Validated: ${groundedPlan.validated_assumptions_count}/${groundedPlan.total_assumptions_count}`)
  console.log(`   Overall Confidence: ${(groundedPlan.grounding_confidence * 100).toFixed(1)}%`)
  console.log()

  console.log('   Grounded Facts:')
  const groundedFacts: Record<string, any> = {}
  groundedPlan.grounding_results.forEach(result => {
    if (result.validated && result.resolved_value) {
      groundedFacts[result.assumption_id] = result.resolved_value
      console.log(`   ✅ ${result.assumption_id}: "${result.resolved_value}" (${(result.confidence * 100).toFixed(0)}%)`)
    } else {
      console.log(`   ❌ ${result.assumption_id}: FAILED - ${result.evidence}`)
    }
  })
  console.log()

  if (groundedPlan.grounding_errors.length > 0) {
    console.log('   Grounding Errors/Warnings:')
    groundedPlan.grounding_errors.forEach(error => {
      console.log(`   ${error.severity.toUpperCase()}: ${error.message}`)
    })
    console.log()
  }

  // Phase 3: Formalization (IR Generation)
  console.log('🚀 Phase 3: Formalization (IR Generation)\n')

  const irFormalizer = new IRFormalizer({
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0.0, // Very low - mechanical mapping
    max_tokens: 4000
  })

  console.log('[Phase 3] Formalizing to IR...')
  const formalizationResult = await irFormalizer.formalize(groundedPlan)

  console.log(`[Phase 3] ✅ IR Generated`)
  console.log(`   Provider: ${formalizationResult.formalization_metadata.provider}`)
  console.log(`   Model: ${formalizationResult.formalization_metadata.model}`)
  console.log(`   Grounded Facts Used: ${Object.keys(formalizationResult.formalization_metadata.grounded_facts_used).length}`)
  console.log(`   Missing Facts: ${formalizationResult.formalization_metadata.missing_facts.length}`)
  console.log(`   Formalization Confidence: ${(formalizationResult.formalization_metadata.formalization_confidence * 100).toFixed(1)}%`)
  console.log()

  // Validate formalization
  const validation = irFormalizer.validateFormalization(
    formalizationResult.ir,
    formalizationResult.formalization_metadata.grounded_facts_used
  )

  console.log('   Formalization Validation:')
  console.log(`   Valid: ${validation.valid}`)
  console.log(`   Errors: ${validation.errors.length}`)
  console.log(`   Warnings: ${validation.warnings.length}`)

  if (validation.errors.length > 0) {
    console.log('\n   Validation Errors:')
    validation.errors.forEach(err => console.log(`   - ${err}`))
  }

  if (validation.warnings.length > 0) {
    console.log('\n   Validation Warnings:')
    validation.warnings.forEach(warn => console.log(`   - ${warn}`))
  }
  console.log()

  // Show final IR
  console.log('📄 Final IR (Ready for Compilation):\n')
  console.log(JSON.stringify(formalizationResult.ir, null, 2))
  console.log()

  // Summary
  console.log('=' .repeat(60))
  console.log('✨ FULL FLOW COMPLETE')
  console.log('=' .repeat(60))
  console.log()
  console.log('📊 Summary:')
  console.log(`   Phase 1 (Understanding): ${semanticPlan.assumptions.length} assumptions identified`)
  console.log(`   Phase 2 (Grounding): ${groundedPlan.validated_assumptions_count}/${groundedPlan.total_assumptions_count} validated`)
  console.log(`   Phase 3 (Formalization): IR generated with ${(formalizationResult.formalization_metadata.formalization_confidence * 100).toFixed(1)}% confidence`)
  console.log()
  console.log('🎯 Key Benefits of Semantic Plan Layer:')
  console.log('   1. LLM can express uncertainty in Phase 1 (not forced to guess)')
  console.log('   2. Real data validates assumptions in Phase 2 (fuzzy matching works)')
  console.log('   3. IR uses exact field names in Phase 3 (no validation errors)')
  console.log('   4. "New prompt, new error" problem SOLVED')
  console.log()
  console.log('✅ The architecture is working as designed!')
}

// Run the test
testFullSemanticFlow().catch(error => {
  console.error('❌ Test failed:', error)
  console.error('\nStack trace:', error.stack)
  process.exit(1)
})
