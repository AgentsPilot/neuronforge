/**
 * Test Script: Approval Workflow
 *
 * This script creates and executes a simple workflow with a human approval step
 * to demonstrate Phase 6 Human-in-the-Loop functionality.
 *
 * Usage:
 *   npx ts-node scripts/test-approval-workflow.ts
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

// Example workflow with approval step
const approvalWorkflowDefinition = {
  agent_name: "Test Approval Workflow",
  description: "Simple workflow to test human approval functionality",
  user_prompt: "This is a test workflow that requires approval before proceeding",
  status: "draft",
  mode: "on_demand",

  // Workflow steps with approval
  workflow_steps: [
    // Step 1: Prepare data
    {
      id: "prepare_data",
      name: "Prepare Request Data",
      type: "transform",
      operation: "set",
      input: {
        requestType: "Test Request",
        amount: 1500,
        description: "This is a test approval request"
      },
      outputVariable: "request_data"
    },

    // Step 2: Request human approval
    {
      id: "request_approval",
      name: "Request Manager Approval",
      type: "human_approval",
      approvers: ["USER_ID_HERE"], // Replace with actual user ID
      approvalType: "any",
      title: "Test Approval Request",
      message: "This is a test approval request.\n\nPlease approve or reject to continue the workflow.",
      context: {
        requestType: "{{request_data.requestType}}",
        amount: "{{request_data.amount}}",
        description: "{{request_data.description}}"
      },
      timeout: 3600000, // 1 hour
      onTimeout: "reject",
      notificationChannels: [
        {
          type: "email",
          config: {
            subject: "Test: Approval Required"
          }
        }
      ],
      dependencies: ["prepare_data"]
    },

    // Step 3: Process approval result
    {
      id: "process_result",
      name: "Process Approval Result",
      type: "transform",
      operation: "set",
      input: {
        status: "completed",
        approvedBy: "{{request_approval.approver}}",
        approvedAt: "{{request_approval.approved_at}}",
        message: "Workflow completed successfully after approval"
      },
      outputVariable: "final_result",
      dependencies: ["request_approval"]
    }
  ]
}

async function createTestWorkflow() {
  console.log('🔧 Creating test approval workflow...\n')

  // Get current user
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    console.error('❌ Not authenticated. Please login first.')
    return
  }

  console.log(`✅ Authenticated as: ${user.email}`)
  console.log(`   User ID: ${user.id}\n`)

  // Update the approver ID in the workflow
  approvalWorkflowDefinition.workflow_steps[1].approvers = [user.id]

  // Create the agent
  const { data: agent, error: createError } = await supabase
    .from('agents')
    .insert({
      ...approvalWorkflowDefinition,
      user_id: user.id
    })
    .select()
    .single()

  if (createError) {
    console.error('❌ Failed to create workflow:', createError.message)
    return
  }

  console.log('✅ Test workflow created successfully!')
  console.log(`   Agent ID: ${agent.id}`)
  console.log(`   Name: ${agent.agent_name}\n`)

  return { agent, user }
}

async function executeTestWorkflow(agentId: string, userId: string) {
  console.log('🚀 Executing test workflow...\n')

  // Execute the workflow
  const response = await fetch('http://localhost:3000/api/run-agent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      agent_id: agentId,
      input_variables: {},
      execution_type: 'test'
    })
  })

  const result = await response.json()

  if (!response.ok) {
    console.error('❌ Workflow execution failed:', result.error)
    return
  }

  console.log('✅ Workflow execution started!')
  console.log(`   Execution ID: ${result.data?.execution_id}\n`)

  if (result.data?.execution_id) {
    console.log('⏸️  Workflow should now be PAUSED waiting for approval\n')
    console.log('📋 Next steps:')
    console.log('   1. Check your dashboard at http://localhost:3000/dashboard')
    console.log('   2. You should see a pending approval notification')
    console.log('   3. Click "Review & Approve" to approve the request')
    console.log('   4. The workflow will resume and complete\n')

    // Poll for approval request
    await pollForApproval(result.data.execution_id, userId)
  }

  return result
}

async function pollForApproval(executionId: string, userId: string) {
  console.log('🔍 Checking for approval request...\n')

  let attempts = 0
  const maxAttempts = 10

  while (attempts < maxAttempts) {
    const { data: approvals } = await supabase
      .from('workflow_approval_requests')
      .select('*')
      .eq('execution_id', executionId)
      .contains('approvers', [userId])

    if (approvals && approvals.length > 0) {
      const approval = approvals[0]
      console.log('✅ Approval request found!')
      console.log(`   Approval ID: ${approval.id}`)
      console.log(`   Status: ${approval.status}`)
      console.log(`   Title: ${approval.title}\n`)

      console.log('📱 Approval URL:')
      console.log(`   http://localhost:3000/approvals/${approval.id}\n`)

      if (approval.status === 'pending') {
        console.log('⏳ Waiting for your response...\n')
        console.log('   To approve via API:')
        console.log(`   curl -X POST http://localhost:3000/api/approvals/${approval.id}/respond \\`)
        console.log(`     -H "Content-Type: application/json" \\`)
        console.log(`     -d '{"userId": "${userId}", "decision": "approve", "comment": "Approved via script"}'\n`)
      } else {
        console.log(`✅ Approval ${approval.status}!`)
      }

      return approval
    }

    attempts++
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  console.log('⏰ Timeout waiting for approval request')
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║  Phase 6: Human-in-the-Loop Test Script                   ║')
  console.log('║  Testing approval workflow functionality                   ║')
  console.log('╚════════════════════════════════════════════════════════════╝\n')

  // Step 1: Create test workflow
  const result = await createTestWorkflow()
  if (!result) {
    process.exit(1)
  }

  const { agent, user } = result

  // Step 2: Execute workflow
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  await executeTestWorkflow(agent.id, user.id)

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
  console.log('✅ Test script completed!')
  console.log('\n📚 For more examples, see: docs/PHASE_6_APPROVAL_EXAMPLE.md\n')
}

// Run the script
main().catch(console.error)
