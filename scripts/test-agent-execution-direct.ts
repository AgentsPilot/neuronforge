/**
 * Direct Agent Execution Test
 *
 * This script:
 * 1. Fetches the agent from the database
 * 2. Executes the workflow directly using WorkflowPilot
 * 3. Captures logs to show gather collection behavior
 * 4. Demonstrates the missing "from" field issue
 */

// CRITICAL: Load env BEFORE any imports that use Supabase
import { config } from 'dotenv'
config({ path: '.env.local' })

// Now import after env is loaded
import { createClient } from '@supabase/supabase-js'
import { WorkflowPilot } from '@/lib/pilot/WorkflowPilot'
import type { WorkflowStep } from '@/lib/pilot/types/pilot-dsl-types'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

async function testAgentExecution() {
  const agentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'

  console.log('=== Direct Agent Execution Test ===\n')
  console.log(`Agent ID: ${agentId}\n`)

  try {
    // 1. Fetch agent from database
    console.log('Step 1: Fetching agent from database...')

    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single()

    if (agentError || !agent) {
      console.error('❌ Failed to fetch agent:', agentError)
      return
    }

    console.log(`✅ Agent found: "${agent.name}"`)
    console.log(`   Status: ${agent.status}`)
    console.log(`   Workflow steps: ${agent.workflow_steps?.length || 0}\n`)

    if (!agent.workflow_steps || agent.workflow_steps.length === 0) {
      console.error('❌ Agent has no workflow steps!')
      return
    }

    // 2. Analyze workflow for gather configurations
    console.log('Step 2: Analyzing workflow structure...\n')

    const workflowSteps = agent.workflow_steps as WorkflowStep[]

    // Find scatter_gather steps
    const scatterGatherSteps = workflowSteps.filter(step => step.type === 'scatter_gather')

    console.log(`Found ${scatterGatherSteps.length} scatter_gather steps:\n`)

    scatterGatherSteps.forEach((step, index) => {
      console.log(`${index + 1}. Step ID: ${step.step_id}`)
      console.log(`   Output Variable: ${step.output_variable}`)

      const gatherConfig = step.gather as any
      if (gatherConfig) {
        console.log(`   Gather operation: ${gatherConfig.operation}`)
        console.log(`   Gather outputKey: ${gatherConfig.outputKey}`)

        if (gatherConfig.from) {
          console.log(`   ✅ Gather has "from": "${gatherConfig.from}"`)
        } else {
          console.log(`   ❌ Gather MISSING "from" field! (BUG)`)
        }
      } else {
        console.log(`   ⚠️ No gather configuration`)
      }

      // Check for nested scatter_gather
      if (step.scatter?.steps) {
        const nestedScatterGather = step.scatter.steps.filter((s: any) => s.type === 'scatter_gather')
        if (nestedScatterGather.length > 0) {
          console.log(`   └─ Contains ${nestedScatterGather.length} nested scatter_gather step(s)`)

          nestedScatterGather.forEach((nested: any, nIndex: number) => {
            console.log(`      ${nIndex + 1}. Nested Step ID: ${nested.step_id}`)
            const nestedGather = nested.gather as any
            if (nestedGather) {
              console.log(`         Gather outputKey: ${nestedGather.outputKey}`)
              if (nestedGather.from) {
                console.log(`         ✅ Gather has "from": "${nestedGather.from}"`)
              } else {
                console.log(`         ❌ Gather MISSING "from" field! (BUG)`)
              }
            }
          })
        }
      }

      console.log('')
    })

    // 3. Execute workflow
    console.log('Step 3: Executing workflow with WorkflowPilot...\n')
    console.log('⏳ Starting execution (this may take a while with real API calls)...\n')

    const pilot = new WorkflowPilot(supabase)

    const startTime = Date.now()
    const result = await pilot.execute(
      agent,
      '08456106-aa50-4810-b12c-7ca84102da31', // userId
      'Test execution',  // userInput
      {},  // inputValues
      undefined, // sessionId
      undefined, // stepEmitter
      true, // debugMode
      undefined, // providedDebugRunId
      undefined, // providedExecutionId
      'calibration' // runMode
    )
    const duration = Date.now() - startTime

    console.log(`\n✅ Execution completed in ${(duration / 1000).toFixed(2)}s\n`)

    // 4. Analyze results
    console.log('=== Execution Results ===\n')
    console.log(`Success: ${result.success}`)

    if (result.error) {
      console.error(`Error: ${result.error}`)
    }

    console.log('\n=== Final Variables ===\n')

    const finalVars = result.context?.variables || {}
    const varNames = Object.keys(finalVars)

    console.log(`Total variables: ${varNames.length}\n`)

    // Focus on collection variables
    const collectionVars = ['all_transactions', 'email_transactions', 'high_value_transactions']

    collectionVars.forEach(varName => {
      if (finalVars[varName] !== undefined) {
        const value = finalVars[varName]
        if (Array.isArray(value)) {
          console.log(`${varName}: array with ${value.length} items`)
          if (value.length > 0) {
            console.log(`  First item keys: ${Object.keys(value[0]).join(', ')}`)
          } else {
            console.log(`  ❌ EMPTY ARRAY (BUG: gather.from missing!)`)
          }
        } else {
          console.log(`${varName}: ${typeof value}`)
        }
      } else {
        console.log(`${varName}: undefined`)
      }
    })

    console.log('\n=== Output Preview ===\n')
    if (result.output) {
      const preview = JSON.stringify(result.output, null, 2).substring(0, 300)
      console.log(preview + '...')
    }

    console.log('\n=== Analysis ===\n')

    const allTransactions = finalVars['all_transactions']
    if (Array.isArray(allTransactions) && allTransactions.length === 0) {
      console.log('🔴 BUG CONFIRMED: all_transactions is empty')
      console.log('   Root cause: gather.from field missing in loop configurations')
      console.log('   Fix: Compiler has been updated to add "from" field')
      console.log('   Action needed: Recompile the workflow IR to get updated DSL')
    } else if (Array.isArray(allTransactions) && allTransactions.length > 0) {
      console.log('✅ SUCCESS: all_transactions has data')
      console.log('   The gather.from field is working correctly!')
    }

  } catch (error) {
    console.error('\n=== Execution Failed ===')
    console.error(error)
    if (error instanceof Error) {
      console.error('\nStack trace:', error.stack)
    }
  }
}

// Run the test
testAgentExecution()
  .then(() => {
    console.log('\n=== Test Complete ===')
    process.exit(0)
  })
  .catch(error => {
    console.error('\nTest error:', error)
    process.exit(1)
  })
