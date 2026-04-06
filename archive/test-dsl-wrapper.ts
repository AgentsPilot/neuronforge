#!/usr/bin/env npx tsx

/**
 * Test DSL Wrapper Integration
 *
 * Validates that:
 * 1. DeclarativeCompiler generates both workflow and dsl
 * 2. DSL structure is valid
 * 3. Deduplication steps are included (Fix 1)
 * 4. DSL wrapper works correctly (Fix 2)
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'

// ============================================================================
// Test IR - Gmail + Sheets Deduplication
// ============================================================================

const testIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Find urgent emails from Gmail and append to Google Sheet, skip duplicates',

  data_sources: [
    {
      type: 'api',
      source: 'google_mail',
      role: 'primary',
      plugin_key: 'google-mail',
      operation_type: 'search',
      location: 'Gmail inbox',
      config: {
        query: 'is:unread label:urgent',
        max_results: 100
      }
    },
    {
      type: 'tabular',
      source: 'google_sheets',
      role: 'lookup',  // ← This should trigger deduplication (Fix 1)
      plugin_key: 'google-sheets',
      operation_type: 'read_range',
      location: 'UrgentEmails sheet',
      tab: 'UrgentEmails',
      config: {
        spreadsheet_id: '1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc',
        range: 'UrgentEmails!A:Z'
      }
    }
  ],

  filters: {
    combineWith: 'AND',
    conditions: [
      {
        field: 'subject',
        operator: 'contains',
        value: 'urgent',
        description: 'Filter for urgent emails'
      }
    ]
  },

  rendering: {
    type: 'email_embedded_table',
    columns_in_order: ['from', 'subject', 'date', 'id'],
    empty_message: 'No new urgent emails'
  },

  delivery_rules: {
    summary_delivery: {
      recipient: 'user@example.com',
      subject: 'Urgent Emails Summary',
      plugin_key: 'google-mail',
      operation_type: 'send'
    },
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

async function runTest() {
  console.log('='=.repeat(80))
  console.log('Test: DSL Wrapper Integration')
  console.log('='=.repeat(80))
  console.log('')

  try {
    // Compile IR
    console.log('[Test] Compiling IR...')
    const compiler = new DeclarativeCompiler()
    const result = await compiler.compile(testIR)

    if (!result.success) {
      console.error('✗ Compilation failed:', result.errors)
      process.exit(1)
    }

    console.log('✓ Compilation succeeded')
    console.log('')

    // ========================================================================
    // Test 1: Workflow Steps (Fix 1 - Deduplication)
    // ========================================================================
    console.log('Test 1: Deduplication Steps (Fix 1)')
    console.log('-'.repeat(80))

    const workflow = result.workflow
    console.log('Total steps:', workflow.length)

    // Check for deduplication steps
    const dedupStepIds = workflow
      .filter(s => s.id.includes('reference') || s.id.includes('extract') || s.id.includes('dedup'))
      .map(s => s.id)

    if (dedupStepIds.length === 0) {
      console.error('✗ FAIL: No deduplication steps found!')
      console.error('  Expected: read_reference, extract_ids, filter_new_items')
      console.error('  Got:', workflow.map(s => s.id))
      process.exit(1)
    }

    console.log('✓ PASS: Found', dedupStepIds.length, 'deduplication steps')
    dedupStepIds.forEach(id => console.log('  -', id))

    if (workflow.length < 7) {
      console.warn('⚠ WARNING: Expected 7-9 steps, got', workflow.length)
    }

    console.log('')

    // ========================================================================
    // Test 2: DSL Structure (Fix 2 - DSL Wrapper)
    // ========================================================================
    console.log('Test 2: DSL Structure (Fix 2)')
    console.log('-'.repeat(80))

    if (!result.dsl) {
      console.error('✗ FAIL: No DSL structure in compilation result!')
      console.error('  DeclarativeCompiler should return both workflow and dsl')
      process.exit(1)
    }

    const dsl = result.dsl
    console.log('✓ PASS: DSL structure exists')
    console.log('')

    // Check DSL fields
    console.log('DSL Structure:')
    console.log('  agent_name:', dsl.agent_name)
    console.log('  description:', dsl.description.substring(0, 60) + '...')
    console.log('  workflow_type:', dsl.workflow_type)
    console.log('  suggested_plugins:', dsl.suggested_plugins.join(', '))
    console.log('  workflow_steps:', dsl.workflow_steps.length)
    console.log('  required_inputs:', dsl.required_inputs.length)
    console.log('  suggested_outputs:', dsl.suggested_outputs.length)
    console.log('')

    // Validate required fields
    const requiredFields = [
      'agent_name',
      'description',
      'workflow_type',
      'suggested_plugins',
      'required_inputs',
      'workflow_steps',
      'suggested_outputs'
    ]

    for (const field of requiredFields) {
      if (!(field in dsl)) {
        console.error(`✗ FAIL: Missing required field: ${field}`)
        process.exit(1)
      }
    }

    console.log('✓ PASS: All required DSL fields present')
    console.log('')

    // ========================================================================
    // Test 3: Required Inputs
    // ========================================================================
    console.log('Test 3: Required Inputs')
    console.log('-'.repeat(80))

    console.log('Generated', dsl.required_inputs.length, 'inputs:')
    dsl.required_inputs.forEach((input: any) => {
      console.log(`  - ${input.name} (${input.type}): ${input.description}`)
    })

    if (dsl.required_inputs.length === 0) {
      console.warn('⚠ WARNING: No required inputs generated')
    } else {
      console.log('✓ PASS: Required inputs generated')
    }

    console.log('')

    // ========================================================================
    // Test 4: Suggested Outputs
    // ========================================================================
    console.log('Test 4: Suggested Outputs')
    console.log('-'.repeat(80))

    console.log('Generated', dsl.suggested_outputs.length, 'outputs:')
    dsl.suggested_outputs.forEach((output: any) => {
      console.log(`  - ${output.name} (${output.type}): ${output.description}`)
    })

    if (dsl.suggested_outputs.length === 0) {
      console.error('✗ FAIL: No suggested outputs generated')
      process.exit(1)
    }

    console.log('✓ PASS: Suggested outputs generated')
    console.log('')

    // ========================================================================
    // Test 5: Workflow Steps Match
    // ========================================================================
    console.log('Test 5: Workflow Steps Consistency')
    console.log('-'.repeat(80))

    if (dsl.workflow_steps.length !== result.workflow.length) {
      console.error('✗ FAIL: Step count mismatch!')
      console.error('  result.workflow:', result.workflow.length)
      console.error('  dsl.workflow_steps:', dsl.workflow_steps.length)
      process.exit(1)
    }

    console.log('✓ PASS: Workflow steps match (', dsl.workflow_steps.length, 'steps )')
    console.log('')

    // ========================================================================
    // Summary
    // ========================================================================
    console.log('='=.repeat(80))
    console.log('✓ ALL TESTS PASSED')
    console.log('='=.repeat(80))
    console.log('')
    console.log('Summary:')
    console.log('  ✓ Fix 1: Deduplication steps included (', dedupStepIds.length, 'steps )')
    console.log('  ✓ Fix 2: DSL wrapper working correctly')
    console.log('  ✓ Total workflow steps:', workflow.length)
    console.log('  ✓ Required inputs:', dsl.required_inputs.length)
    console.log('  ✓ Suggested outputs:', dsl.suggested_outputs.length)
    console.log('  ✓ Plugins used:', dsl.suggested_plugins.join(', '))
    console.log('')
    console.log('Both fixes are working correctly! 🚀')
    console.log('')

  } catch (error) {
    console.error('✗ Test failed with error:', error)
    if (error instanceof Error) {
      console.error('  Message:', error.message)
      console.error('  Stack:', error.stack)
    }
    process.exit(1)
  }
}

runTest()
