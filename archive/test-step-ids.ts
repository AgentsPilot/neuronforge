/**
 * Quick test to verify step IDs are step1, step2, etc.
 */

import { DeclarativeCompiler } from './lib/agentkit/v6/compiler/DeclarativeCompiler'
import type { DeclarativeLogicalIR } from './lib/agentkit/v6/logical-ir/schemas/declarative-ir-types'
import { PluginManagerV2 } from './lib/server/plugin-manager-v2'

const testIR: DeclarativeLogicalIR = {
  ir_version: '3.0',
  goal: 'Test step IDs',
  data_sources: [
    {
      type: 'api',
      source: 'google-mail',
      plugin_key: 'google-mail',
      role: 'primary',
      location: 'inbox',
      operation_type: 'read',
      config: { query: 'test', max_results: 10 }
    }
  ],
  ai_operations: [],
  rendering: { type: 'json', columns_in_order: ['subject'] },
  delivery_rules: {
    summary_delivery: {
      plugin_key: 'google-mail',
      recipient: 'test@example.com'
    }
  }
}

async function test() {
  const pluginManager = new PluginManagerV2()
  const compiler = new DeclarativeCompiler(pluginManager)
  const result = await compiler.compile(testIR)

  if (result.success) {
    console.log('Step IDs:')
    result.workflow.forEach((step: any, i: number) => {
      console.log(`  ${i + 1}. ${step.id || step.step_id} - ${step.name}`)
    })
  } else {
    console.error('Compilation failed:', result.errors)
  }
}

test().catch(console.error)
