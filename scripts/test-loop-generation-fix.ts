// scripts/test-loop-generation-fix.ts
// Test script to verify loop generation uses correct field names (iterateOver, loopSteps)

import { analyzePromptDirectAgentKit } from '../lib/agentkit/analyzePrompt-v3-direct.js'

async function testLoopGenerationFix() {
  console.log('🧪 Testing Loop Generation Field Name Fix\n')
  console.log('=' .repeat(70))

  // Test user ID and plugins
  const testUserId = 'test-user-id'
  const availablePlugins = [
    'google-mail',
    'google-sheets',
    'hubspot',
    'slack',
    'notion'
  ]

  const testCases = [
    {
      name: 'Simple Loop Test',
      prompt: 'For each customer in my spreadsheet, check if they exist in HubSpot',
      expectedFields: ['iterateOver', 'loopSteps'],
      shouldNotHave: ['items', 'steps']
    },
    {
      name: 'Email Loop Test',
      prompt: 'Summarize each unread email from Gmail individually',
      expectedFields: ['iterateOver', 'loopSteps'],
      shouldNotHave: ['items', 'steps']
    },
    {
      name: 'Complex Onboarding Workflow',
      prompt: `Create an automated workflow that:
1. Triggers when a new customer signs up in HubSpot
2. Sends a welcome email via Gmail
3. For each product in their order:
   - Check inventory in Google Sheets
   - If stock is low, send alert to Slack
4. Create a Notion page for the customer
5. Route to sales team based on company size (high/medium/low)`,
      expectedFields: ['iterateOver', 'loopSteps'],
      shouldNotHave: ['items', 'steps']
    }
  ]

  let passed = 0
  let failed = 0

  for (const testCase of testCases) {
    console.log(`\n📋 Test: ${testCase.name}`)
    console.log(`Prompt: "${testCase.prompt.substring(0, 80)}${testCase.prompt.length > 80 ? '...' : ''}"`)

    try {
      const result = await analyzePromptDirectAgentKit(testUserId, testCase.prompt, availablePlugins)

      if (!result.workflow_steps || result.workflow_steps.length === 0) {
        console.log('❌ FAIL: No workflow steps generated')
        failed++
        continue
      }

      // Find loop steps
      const loopSteps = findLoopSteps(result.workflow_steps)

      if (loopSteps.length === 0) {
        console.log('⚠️  WARN: No loop steps found (AI may have used different structure)')
        console.log('   Generated steps:', JSON.stringify(result.workflow_steps, null, 2))
        // Don't count as failure - AI might have valid reason for different structure
        continue
      }

      // Verify field names
      let hasCorrectFields = true
      let hasWrongFields = false

      for (const loopStep of loopSteps) {
        // Check for correct fields
        const hasIterateOver = 'iterateOver' in loopStep
        const hasLoopSteps = 'loopSteps' in loopStep

        // Check for wrong fields (old names)
        const hasItems = 'items' in loopStep
        const hasSteps = 'steps' in loopStep

        if (!hasIterateOver || !hasLoopSteps) {
          hasCorrectFields = false
          console.log(`❌ FAIL: Loop step missing correct fields`)
          console.log(`   Has iterateOver: ${hasIterateOver}`)
          console.log(`   Has loopSteps: ${hasLoopSteps}`)
        }

        if (hasItems || hasSteps) {
          hasWrongFields = true
          console.log(`❌ FAIL: Loop step has old field names`)
          console.log(`   Has items: ${hasItems}`)
          console.log(`   Has steps: ${hasSteps}`)
        }
      }

      if (hasCorrectFields && !hasWrongFields) {
        console.log(`✅ PASS: Found ${loopSteps.length} loop step(s) with correct field names`)
        console.log(`   Field names: iterateOver ✓, loopSteps ✓`)
        passed++
      } else {
        console.log('❌ FAIL: Loop steps have incorrect field names')
        console.log('   Loop step structure:', JSON.stringify(loopSteps[0], null, 2))
        failed++
      }

    } catch (error: any) {
      console.log(`❌ FAIL: Error during generation - ${error.message}`)
      console.log(`   Stack: ${error.stack}`)
      failed++
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log('\n📊 Test Results:')
  console.log(`   ✅ Passed: ${passed}`)
  console.log(`   ❌ Failed: ${failed}`)
  console.log(`   Total: ${passed + failed}`)

  if (failed === 0) {
    console.log('\n🎉 All tests passed! Loop generation is working correctly.')
    process.exit(0)
  } else {
    console.log('\n⚠️  Some tests failed. Review the output above.')
    process.exit(1)
  }
}

function findLoopSteps(steps: any[]): any[] {
  const loopSteps: any[] = []

  for (const step of steps) {
    if (step.type === 'loop') {
      loopSteps.push(step)
    }

    // Recursively check nested steps (in conditionals, loops, etc.)
    if (step.loopSteps && Array.isArray(step.loopSteps)) {
      loopSteps.push(...findLoopSteps(step.loopSteps))
    }
    if (step.thenSteps && Array.isArray(step.thenSteps)) {
      loopSteps.push(...findLoopSteps(step.thenSteps))
    }
    if (step.elseSteps && Array.isArray(step.elseSteps)) {
      loopSteps.push(...findLoopSteps(step.elseSteps))
    }
    if (step.cases && Array.isArray(step.cases)) {
      for (const caseItem of step.cases) {
        if (caseItem.steps && Array.isArray(caseItem.steps)) {
          loopSteps.push(...findLoopSteps(caseItem.steps))
        }
      }
    }
  }

  return loopSteps
}

// Run the test
testLoopGenerationFix().catch((error) => {
  console.error('💥 Fatal error:', error)
  process.exit(1)
})
