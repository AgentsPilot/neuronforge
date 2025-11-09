/**
 * Simple Pilot Workflow Test (No Authentication Required)
 *
 * This test creates and executes a workflow via API calls
 * Usage:
 *   npm run dev (in another terminal)
 *   npx ts-node scripts/test-pilot-simple.ts YOUR_USER_ID
 */

const userId = process.argv[2]

if (!userId) {
  console.error('❌ Please provide your user ID as an argument')
  console.error('Usage: npx ts-node scripts/test-pilot-simple.ts YOUR_USER_ID')
  console.error('\nTo get your user ID:')
  console.error('1. Open http://localhost:3000')
  console.error('2. Open browser console')
  console.error('3. Run: await supabase.auth.getUser()')
  console.error('4. Copy the user.id value')
  process.exit(1)
}

console.log('🚀 Starting Pilot Workflow Test...')
console.log(`   User ID: ${userId}\n`)

async function runTest() {
  try {
    // Create simple test workflow
    const workflow = {
      agent_name: "Simple Test Workflow",
      description: "Testing Pilot with approvals",
      user_prompt: "Test workflow",
      status: "draft",
      mode: "on_demand",
      user_id: userId,
      workflow_steps: [
        {
          id: "step1",
          name: "Create Request",
          type: "transform",
          operation: "set",
          input: {
            requestId: `REQ-${Date.now()}`,
            amount: 50000,
            department: "Engineering"
          },
          outputVariable: "request"
        },
        {
          id: "approval1",
          name: "Manager Approval",
          type: "human_approval",
          approvers: [userId],
          approvalType: "any",
          title: "Test Approval Required",
          message: "Please approve this test request for $50,000",
          timeout: 3600000,
          onTimeout: "reject",
          dependencies: ["step1"]
        },
        {
          id: "step3",
          name: "Complete",
          type: "transform",
          operation: "set",
          input: {
            status: "approved",
            message: "Request approved!"
          },
          outputVariable: "result",
          dependencies: ["approval1"]
        }
      ]
    }

    console.log('📝 Creating workflow agent...')
    const createResponse = await fetch('http://localhost:3000/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(workflow)
    })

    if (!createResponse.ok) {
      const error = await createResponse.json()
      throw new Error(`Failed to create agent: ${JSON.stringify(error)}`)
    }

    const agent = await createResponse.json()
    console.log(`✅ Agent created: ${agent.id}\n`)

    console.log('▶️  Executing workflow...')
    const execResponse = await fetch('http://localhost:3000/api/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agent.id,
        input_variables: {},
        execution_type: 'test'
      })
    })

    if (!execResponse.ok) {
      const error = await execResponse.json()
      throw new Error(`Failed to execute: ${JSON.stringify(error)}`)
    }

    const execResult = await execResponse.json()
    const executionId = execResult.data?.execution_id

    console.log(`✅ Execution started: ${executionId}\n`)

    // Poll for approval
    console.log('⏳ Waiting for approval request to be created...')
    let approvalId = null
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 1000))

      const approvalsResponse = await fetch(`http://localhost:3000/api/approvals?userId=${userId}`)
      if (approvalsResponse.ok) {
        const approvals = await approvalsResponse.json()
        const pending = approvals.filter((a: any) => a.status === 'pending')
        if (pending.length > 0) {
          approvalId = pending[0].id
          break
        }
      }
    }

    if (!approvalId) {
      console.log('⚠️  No approval request found')
      console.log('   Check http://localhost:3000/dashboard for approvals')
      return
    }

    console.log(`\n📋 Approval Request Created: ${approvalId}`)
    console.log(`   View at: http://localhost:3000/approvals/${approvalId}`)
    console.log('\n✋ WORKFLOW PAUSED - Approval Required\n')
    console.log('To approve, run:')
    console.log(`curl -X POST http://localhost:3000/api/approvals/${approvalId}/respond \\`)
    console.log(`  -H "Content-Type: application/json" \\`)
    console.log(`  -d '{"userId": "${userId}", "decision": "approve", "comment": "Test approved"}'\n`)

    console.log('Or visit the dashboard: http://localhost:3000/dashboard\n')
    console.log('Waiting for approval... (Press Ctrl+C to exit)')

    // Monitor for approval
    while (true) {
      await new Promise(r => setTimeout(r, 3000))

      const approvalResponse = await fetch(`http://localhost:3000/api/approvals/${approvalId}`)
      if (approvalResponse.ok) {
        const approval = await approvalResponse.json()
        if (approval.approval.status !== 'pending') {
          console.log(`\n✅ Approval ${approval.approval.status}!`)
          break
        }
      }
    }

    // Wait for workflow to complete
    console.log('\n⏳ Waiting for workflow to complete...')
    await new Promise(r => setTimeout(r, 5000))

    console.log('\n✅ TEST COMPLETE!')
    console.log(`   Execution ID: ${executionId}`)
    console.log(`   Approval ID: ${approvalId}`)

  } catch (error: any) {
    console.error('\n❌ Test failed:', error.message)
    process.exit(1)
  }
}

runTest()
