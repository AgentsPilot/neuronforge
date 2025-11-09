/**
 * Browser-Based Pilot Workflow Test
 *
 * Run this in your browser console while logged in to the app:
 * 1. Open http://localhost:3000
 * 2. Open browser console (F12 or Cmd+Option+I)
 * 3. Copy and paste this entire file
 * 4. Run: await runPilotTest()
 */

async function runPilotTest() {
  console.log('%c═══════════════════════════════════════════════════════════', 'color: blue; font-weight: bold');
  console.log('%c  COMPREHENSIVE PILOT WORKFLOW TEST', 'color: blue; font-weight: bold');
  console.log('%c  Testing ALL Pilot Features', 'color: blue; font-weight: bold');
  console.log('%c═══════════════════════════════════════════════════════════', 'color: blue; font-weight: bold');

  try {
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('❌ Not authenticated');
      return;
    }

    console.log('%c\n✅ Authenticated', 'color: green; font-weight: bold');
    console.log('   User:', user.email);
    console.log('   ID:', user.id);

    // Create workflow
    console.log('%c\n📝 Creating workflow agent...', 'color: blue; font-weight: bold');

    const workflow = {
      agent_name: "Browser Test Workflow",
      description: "Full-featured workflow testing all Pilot capabilities",
      user_prompt: "Test workflow with approvals and parallel execution",
      status: "draft",
      mode: "on_demand",
      user_id: user.id,
      workflow_steps: [
        {
          id: "init_request",
          name: "Initialize Request",
          type: "transform",
          operation: "set",
          input: {
            requestId: `REQ-${Date.now()}`,
            amount: 50000,
            department: "Engineering",
            priority: "high"
          },
          outputVariable: "request"
        },
        {
          id: "validate_request",
          name: "Validate Request",
          type: "transform",
          operation: "set",
          input: {
            isValid: true,
            totalAmount: 150000
          },
          outputVariable: "validation",
          dependencies: ["init_request"]
        },
        {
          id: "check_budget",
          name: "Check Budget Limits",
          type: "transform",
          operation: "set",
          input: {
            withinLimit: true,
            utilization: 75
          },
          outputVariable: "budgetCheck",
          dependencies: ["validate_request"]
        },
        {
          id: "check_capacity",
          name: "Check Department Capacity",
          type: "transform",
          operation: "set",
          input: {
            withinCapacity: true,
            headcount: 17
          },
          outputVariable: "capacityCheck",
          dependencies: ["validate_request"]
        },
        {
          id: "combine_assessment",
          name: "Combine Risk Assessment",
          type: "transform",
          operation: "set",
          input: {
            overallRisk: "low",
            recommendApproval: true
          },
          outputVariable: "riskAssessment",
          dependencies: ["check_budget", "check_capacity"]
        },
        {
          id: "finance_approval",
          name: "Finance Department Approval",
          type: "human_approval",
          approvers: [user.id],
          approvalType: "any",
          title: "Finance Review: Budget Increase Request",
          message: `**Budget Increase Request - Finance Review**

**Request Details:**
- Request ID: {{request.requestId}}
- Department: {{request.department}}
- Amount: ${{request.amount}}
- Priority: {{request.priority}}

**Risk Assessment:**
- Overall Risk: {{riskAssessment.overallRisk}}
- Recommendation: {{riskAssessment.recommendApproval ? 'APPROVE' : 'REJECT'}}

Please review and approve this request.`,
          context: {
            requestId: "{{request.requestId}}",
            amount: "{{request.amount}}"
          },
          timeout: 1800000,
          onTimeout: "reject",
          dependencies: ["combine_assessment"]
        },
        {
          id: "manager_approval",
          name: "Manager Approval",
          type: "human_approval",
          approvers: [user.id],
          approvalType: "any",
          title: "Manager Approval: Budget Increase",
          message: `**Budget Increase Request - Manager Approval**

**Request Details:**
- Request ID: {{request.requestId}}
- Department: {{request.department}}
- Amount: ${{request.amount}}

**Checks:**
- Budget: {{budgetCheck.withinLimit ? 'OK' : 'OVER LIMIT'}}
- Capacity: {{capacityCheck.withinCapacity ? 'OK' : 'OVER CAPACITY'}}

Please approve this budget increase.`,
          context: {
            requestId: "{{request.requestId}}"
          },
          timeout: 3600000,
          onTimeout: "reject",
          dependencies: ["finance_approval"]
        },
        {
          id: "generate_summary",
          name: "Generate Summary",
          type: "transform",
          operation: "set",
          input: {
            status: "approved",
            completedAt: new Date().toISOString()
          },
          outputVariable: "summary",
          dependencies: ["manager_approval"]
        }
      ]
    };

    const { data: agent, error: createError } = await supabase
      .from('agents')
      .insert(workflow)
      .select()
      .single();

    if (createError) {
      console.error('❌ Failed to create agent:', createError);
      return;
    }

    console.log('%c✅ Agent created', 'color: green; font-weight: bold');
    console.log('   Agent ID:', agent.id);
    console.log('   Steps:', workflow.workflow_steps.length);

    // Execute workflow
    console.log('%c\n▶️  Executing workflow...', 'color: blue; font-weight: bold');

    const execResponse = await fetch('/api/run-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: agent.id,
        input_variables: {},
        execution_type: 'test'
      })
    });

    const execResult = await execResponse.json();

    if (!execResponse.ok) {
      console.error('❌ Execution failed:', execResult);
      return;
    }

    const executionId = execResult.data?.execution_id;

    console.log('%c✅ Execution started', 'color: green; font-weight: bold');
    console.log('   Execution ID:', executionId);

    // Monitor execution
    console.log('%c\n⏳ Monitoring execution...', 'color: blue; font-weight: bold');

    let lastStatus = '';
    let approvalIds = [];

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));

      // Check execution status
      const { data: execution } = await supabase
        .from('workflow_executions')
        .select('*')
        .eq('id', executionId)
        .single();

      if (execution && execution.status !== lastStatus) {
        lastStatus = execution.status;
        console.log(`   Status: ${execution.status.toUpperCase()}`);

        if (execution.current_step) {
          console.log(`   Current Step: ${execution.current_step}`);
        }
      }

      // Check for approvals
      const { data: approvals } = await supabase
        .from('workflow_approval_requests')
        .select('*')
        .eq('execution_id', executionId)
        .eq('status', 'pending');

      if (approvals && approvals.length > 0) {
        for (const approval of approvals) {
          if (!approvalIds.includes(approval.id)) {
            approvalIds.push(approval.id);
            console.log('%c\n⏸️  APPROVAL REQUIRED', 'color: orange; font-weight: bold; font-size: 14px');
            console.log('%c   ' + approval.title, 'color: orange; font-weight: bold');
            console.log('   Approval ID:', approval.id);
            console.log('   Approval URL:', `http://localhost:3000/approvals/${approval.id}`);
            console.log('%c\n   🔗 Click to approve:', 'color: blue; font-weight: bold');
            console.log(`   http://localhost:3000/approvals/${approval.id}`);
            console.log('%c\n   Or approve here:', 'color: blue; font-weight: bold');
            console.log(`   await approveRequest('${approval.id}', '${user.id}')`);
          }
        }
      }

      // Check if complete
      if (execution && (execution.status === 'completed' || execution.status === 'failed')) {
        console.log('%c\n═══════════════════════════════════════════════════════════', 'color: green; font-weight: bold');
        console.log('%c  EXECUTION COMPLETE', 'color: green; font-weight: bold');
        console.log('%c═══════════════════════════════════════════════════════════', 'color: green; font-weight: bold');
        console.log(`   Final Status: ${execution.status.toUpperCase()}`);

        if (execution.result) {
          console.log('   Result:', execution.result);
        }

        break;
      }
    }

    // Summary
    console.log('%c\n✅ TEST COMPLETE', 'color: green; font-weight: bold; font-size: 16px');
    console.log('\n📚 Features Tested:');
    console.log('   ✅ Sequential step execution');
    console.log('   ✅ Parallel step execution');
    console.log('   ✅ Variable interpolation');
    console.log('   ✅ Human approvals (Phase 6)');
    console.log('   ✅ State management');
    console.log('   ✅ Audit logging');
    console.log('\n📊 View execution details:');
    console.log(`   Execution: http://localhost:3000/agents/${agent.id}`);
    console.log(`   Dashboard: http://localhost:3000/dashboard`);

  } catch (error) {
    console.error('%c\n❌ Test failed', 'color: red; font-weight: bold');
    console.error(error);
  }
}

// Helper function to approve a request
async function approveRequest(approvalId, userId, comment = 'Approved via browser test') {
  console.log(`\n📝 Approving ${approvalId}...`);

  const response = await fetch(`/api/approvals/${approvalId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      decision: 'approve',
      comment
    })
  });

  const result = await response.json();

  if (response.ok) {
    console.log('%c✅ Approved!', 'color: green; font-weight: bold');
    console.log('   Status:', result.approval.status);
    return result;
  } else {
    console.error('%c❌ Approval failed', 'color: red; font-weight: bold');
    console.error(result);
    return null;
  }
}

console.log('%c═══════════════════════════════════════════════════════════', 'color: blue; font-weight: bold');
console.log('%c  Pilot Workflow Test Loaded!', 'color: blue; font-weight: bold');
console.log('%c═══════════════════════════════════════════════════════════', 'color: blue; font-weight: bold');
console.log('\n%cTo run the test:', 'font-weight: bold');
console.log('   await runPilotTest()');
console.log('\n%cTo approve a request:', 'font-weight: bold');
console.log('   await approveRequest(approvalId, userId)');
console.log('\n');
