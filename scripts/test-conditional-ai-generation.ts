/**
 * Test Script: Verify AI generates conditional workflows
 *
 * Purpose:
 * - Test that the updated AI prompt correctly generates conditional workflows
 * - Verify executeIf clauses are properly added
 * - Ensure dependencies are correctly structured
 */

import { analyzePromptDirectAgentKit } from '../lib/agentkit/analyzePrompt-v3-direct.js'

async function testConditionalGeneration() {
  console.log('\n╔════════════════════════════════════════════════════════════╗')
  console.log('║  TEST: AI Conditional Workflow Generation                ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // Test prompts that should trigger conditional logic
  const testCases = [
    {
      name: 'VIP Customer Routing',
      prompt: 'Process customer orders: if customer is VIP, create high-priority task in Google Drive; if new customer, add to onboarding sheet; otherwise create standard task',
      availablePlugins: ['google-drive', 'google-sheets']
    },
    {
      name: 'Email Priority Routing',
      prompt: 'Read emails and if from important sender, send immediate notification via email, otherwise just summarize',
      availablePlugins: ['google-mail']
    },
    {
      name: 'Sequential (No Conditionals)',
      prompt: 'Read last 10 emails and send summary to my email',
      availablePlugins: ['google-mail']
    }
  ]

  for (const testCase of testCases) {
    console.log(`\n${'='.repeat(80)}`)
    console.log(`TEST CASE: ${testCase.name}`)
    console.log(`${'='.repeat(80)}`)
    console.log(`\nPrompt: "${testCase.prompt}"`)
    console.log(`Available Plugins: ${testCase.availablePlugins.join(', ')}`)

    try {
      const result = await analyzePromptDirectAgentKit(
        'test-user-id',
        testCase.prompt,
        testCase.availablePlugins
      )

      console.log(`\n✅ AI Analysis Complete`)
      console.log(`   Agent Name: ${result.agent_name}`)
      console.log(`   Workflow Type: ${result.workflow_type}`)
      console.log(`   Suggested Plugins: ${result.suggested_plugins.join(', ')}`)
      console.log(`   Required Inputs: ${result.required_inputs.length}`)
      console.log(`   Workflow Steps: ${result.workflow_steps.length}`)

      console.log(`\n📋 Generated Workflow Steps:\n`)
      result.workflow_steps.forEach((step, idx) => {
        console.log(`${idx + 1}. [${step.type}] ${step.operation}`)
        console.log(`   ID: ${step.id}`)
        console.log(`   Dependencies: ${step.dependencies?.join(', ') || 'none'}`)

        if (step.type === 'plugin_action') {
          console.log(`   Plugin: ${step.plugin} → ${step.plugin_action}`)
        }

        if (step.type === 'conditional') {
          console.log(`   Condition:`, JSON.stringify(step.condition, null, 2))
        }

        if (step.executeIf) {
          console.log(`   ExecuteIf:`, JSON.stringify(step.executeIf, null, 2))
        }

        console.log('')
      })

      // Validate conditional structure
      const hasConditionals = result.workflow_steps.some((s: any) => s.type === 'conditional')
      const hasExecuteIf = result.workflow_steps.some((s: any) => s.executeIf)
      const allHaveIds = result.workflow_steps.every((s: any) => s.id)
      const allHaveDependencies = result.workflow_steps.every((s: any) =>
        Array.isArray(s.dependencies)
      )

      console.log(`\n📊 Validation:`)
      console.log(`   ${hasConditionals ? '✅' : '⚠️ '} Has conditional steps: ${hasConditionals}`)
      console.log(`   ${hasExecuteIf ? '✅' : '⚠️ '} Has executeIf clauses: ${hasExecuteIf}`)
      console.log(`   ${allHaveIds ? '✅' : '❌'} All steps have IDs: ${allHaveIds}`)
      console.log(`   ${allHaveDependencies ? '✅' : '❌'} All steps have dependencies: ${allHaveDependencies}`)

      // Specific expectations per test case
      if (testCase.name === 'VIP Customer Routing') {
        if (!hasConditionals) {
          console.log(`\n❌ FAILED: Expected conditional steps for VIP routing`)
        } else {
          console.log(`\n✅ PASSED: Conditional workflow generated correctly`)
        }
      }

      if (testCase.name === 'Sequential (No Conditionals)') {
        if (hasConditionals) {
          console.log(`\n⚠️  WARNING: Unexpected conditionals in sequential workflow`)
        } else {
          console.log(`\n✅ PASSED: Sequential workflow generated correctly`)
        }
      }

    } catch (error: any) {
      console.error(`\n❌ TEST FAILED:`, error.message)
      console.error(error.stack)
    }
  }

  console.log(`\n\n╔════════════════════════════════════════════════════════════╗`)
  console.log(`║  TEST COMPLETE                                            ║`)
  console.log(`╚════════════════════════════════════════════════════════════╝\n`)
}

testConditionalGeneration().catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})
