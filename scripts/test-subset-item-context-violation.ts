/**
 * Test script for SubsetRefResolver - Item Context Violation
 *
 * Tests that the validator catches violations of the item context convention
 */

import { SubsetRefResolver } from '../lib/agentkit/v6/capability-binding/SubsetRefResolver'
import type { IntentContract } from '../lib/agentkit/v6/semantic-plan/types/intent-schema-types'

async function main() {
  console.log('🧪 Testing SubsetRefResolver - Item Context Violation\n')
  console.log('=' .repeat(80))

  // Create a contract that violates the item context convention
  const badContract: IntentContract = {
    version: 'intent.v1',
    goal: 'Test item context violation',
    steps: [
      {
        id: 'fetch_items',
        kind: 'data_source',
        output: 'items',
        source: { domain: 'test', intent: 'fetch' }
      },
      {
        id: 'split_items',
        kind: 'aggregate',
        summary: 'Split items by condition',
        inputs: ['items'],
        output: 'groups',
        aggregate: {
          input: 'items',
          outputs: [
            {
              name: 'subset_a',
              type: 'subset',
              where: {
                op: 'test',
                left: {
                  kind: 'ref',
                  ref: 'wrong_collection',  // ❌ Violation: doesn't match aggregate.input
                  field: 'value'
                },
                comparator: 'gt',
                right: { kind: 'literal', value: 100 }
              }
            }
          ]
        }
      }
    ]
  }

  // Initialize resolver
  const resolver = new SubsetRefResolver()

  // Resolve subsets
  console.log('\n🔍 Resolving subset references...\n')
  const result = resolver.resolve(badContract)

  // Display results
  console.log('=' .repeat(80))
  console.log('\n📊 Subset Resolution Results:\n')

  if (result.success) {
    console.log('✅ Resolution succeeded (errors not enforced, only warnings)\n')
  } else {
    console.log('❌ Resolution failed\n')
  }

  // Show subsets
  console.log(`📦 Subsets discovered: ${result.subsets.size}`)
  if (result.subsets.size > 0) {
    for (const [name, def] of result.subsets.entries()) {
      console.log(`  • ${name} (defined by: ${def.definedBy})`)
    }
  }

  // Show errors
  if (result.errors.length > 0) {
    console.log(`\n❌ Errors (${result.errors.length}):`)
    for (const error of result.errors) {
      console.log(`  • ${error}`)
    }
  }

  // Show warnings
  console.log(`\n⚠️  Warnings (${result.warnings.length}):`)
  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.log(`  • ${warning}`)
    }
  } else {
    console.log('  (none)')
  }

  // Validate that we caught the violation
  console.log('\n' + '=' .repeat(80))
  console.log('\n🎯 Validation:\n')

  if (result.warnings.length > 0 && result.warnings[0].includes('wrong_collection')) {
    console.log('✅ PASS: Validator correctly detected item context violation')
    console.log('\nExpected behavior:')
    console.log('  • Subset condition uses ref: "wrong_collection"')
    console.log('  • But aggregate input is "items"')
    console.log('  • Validator warns about convention violation')
  } else {
    console.log('❌ FAIL: Validator did not detect the violation')
    process.exit(1)
  }

  console.log('\n' + '=' .repeat(80))
}

main().catch(err => {
  console.error('\n❌ Test failed with error:', err)
  process.exit(1)
})
