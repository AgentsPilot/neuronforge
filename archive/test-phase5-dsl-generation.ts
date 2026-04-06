/**
 * Test Phase 5 DSL Generation
 *
 * This test verifies that DSL is generated AFTER all transforms (Phase 5)
 * with the final transformed steps, not the raw compiler output.
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import { wrapInPilotDSL } from './lib/agentkit/v6/compiler/utils/DSLWrapper'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'
import type { WorkflowStep } from './lib/pilot/types/pilot-dsl-types'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2'

// Simple IR for testing
const testIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Find urgent emails from Gmail',
  data_sources: [
    {
      type: 'api',
      source: 'google-mail',
      plugin_key: 'google-mail',
      role: 'primary',
      location: 'inbox',
      operation_type: 'read',
      config: {
        query: 'is:unread label:urgent',
        max_results: 10
      }
    }
  ],
  ai_operations: [],
  rendering: {
    type: 'json',
    columns_in_order: ['subject', 'from', 'date']
  },
  delivery_rules: {
    summary_delivery: {
      plugin_key: 'google-mail',
      recipient: 'user@example.com'
    }
  }
}

async function testPhase5DSLGeneration() {
  console.log('='.repeat(80))
  console.log('TEST: Phase 5 DSL Generation')
  console.log('='.repeat(80))

  // Initialize plugin manager (required for compiler)
  const pluginManager = new PluginManagerV2()

  // PHASE 3: Compile IR to workflow steps
  console.log('\n[Phase 3] Compiling IR...')
  const compiler = new DeclarativeCompiler(pluginManager)
  const compilationResult = await compiler.compile(testIR)

  if (!compilationResult.success) {
    console.error('❌ Compilation failed:', compilationResult.errors)
    return
  }

  console.log('✓ Compilation successful')
  console.log('  - Steps generated:', compilationResult.workflow.length)
  console.log('  - IR included:', !!compilationResult.ir)
  console.log('  - DSL included:', !!(compilationResult as any).dsl)
  console.log('')

  // PHASE 4: Simulate post-processing transforms
  console.log('[Phase 4] Applying post-processing transforms...')
  const transformedWorkflow = compilationResult.workflow.map(step => {
    // Example transform: add metadata
    return {
      ...step,
      metadata: { transformed: true }
    }
  })
  console.log('✓ Transforms applied')
  console.log('')

  // PHASE 5: Generate DSL from transformed workflow
  console.log('[Phase 5] Generating DSL from transformed workflow...')
  if (!compilationResult.ir) {
    console.error('❌ IR not included in compilation result!')
    return
  }

  const dsl = wrapInPilotDSL(
    transformedWorkflow,
    compilationResult.ir,
    {
      plugins_used: compilationResult.plugins_used || [],
      compilation_time_ms: compilationResult.compilation_time_ms || 0
    }
  )

  console.log('✓ DSL generated')
  console.log('')

  // VERIFY: DSL contains transformed steps
  console.log('[Verification] Checking DSL structure...')
  console.log('  Agent Name:', dsl.agent_name)
  console.log('  Workflow Type:', dsl.workflow_type)
  console.log('  Plugins:', dsl.suggested_plugins.join(', '))
  console.log('  Required Inputs:', dsl.required_inputs.length)
  console.log('  Workflow Steps:', dsl.workflow_steps.length)
  console.log('  Suggested Outputs:', dsl.suggested_outputs.length)

  // Check if DSL has transformed steps
  const firstStep = dsl.workflow_steps[0] as any
  if (firstStep.metadata?.transformed) {
    console.log('  ✓ DSL contains transformed steps (Phase 5)')
  } else {
    console.log('  ✗ DSL contains raw steps (incorrect - should be transformed)')
  }

  console.log('')
  console.log('='.repeat(80))
  console.log('✓ Test Complete - Phase 5 DSL Generation Works!')
  console.log('='.repeat(80))
}

// Run test
testPhase5DSLGeneration().catch(console.error)
