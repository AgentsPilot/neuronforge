// scripts/test-agent-execution.ts
// Manually trigger an agent execution to test if the queue worker is working

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { addManualExecution } from '../lib/queues/qstashQueue';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testAgentExecution(agentId: string) {
  console.log(`\n🧪 Testing execution for agent ${agentId}...\n`);

  // 1. Get agent details
  const { data: agent, error: agentError } = await supabase
    .from('agents')
    .select('*')
    .eq('id', agentId)
    .single();

  if (agentError || !agent) {
    console.error('❌ Agent not found:', agentError);
    return;
  }

  console.log('✅ Found agent:', agent.agent_name);
  console.log('   Mode:', agent.mode);
  console.log('   Status:', agent.status);
  console.log('   User ID:', agent.user_id);

  // 2. Create execution record
  console.log('\n📝 Creating execution record...');

  const { data: execution, error: executionError } = await supabase
    .from('agent_executions')
    .insert({
      agent_id: agent.id,
      user_id: agent.user_id,
      execution_type: 'manual',
      scheduled_at: new Date().toISOString(),
      status: 'pending',
      progress: 0,
    })
    .select('id')
    .single();

  if (executionError || !execution) {
    console.error('❌ Failed to create execution record:', executionError);
    return;
  }

  console.log('✅ Created execution record:', execution.id);

  // 3. Add job to queue
  console.log('\n📥 Adding job to queue...');

  try {
    const { jobId } = await addManualExecution(
      agent.id,           // agentId
      agent.user_id,      // userId
      execution.id,       // executionId
      {},                 // inputVariables
      undefined           // overrideUserPrompt
    );

    console.log('✅ Successfully added job to queue!');
    console.log('   Job ID:', jobId);
    console.log('   Execution ID:', execution.id);

    console.log('\n⏳ Waiting for worker to pick up the job...');
    console.log('   Check the worker logs for progress\n');

    // 4. Monitor execution status
    console.log('📊 Monitoring execution status (will check for 60 seconds)...\n');

    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const { data: status } = await supabase
        .from('agent_executions')
        .select('status, progress, error_message, started_at, completed_at')
        .eq('id', execution.id)
        .single();

      if (status) {
        const elapsed = i * 5;
        console.log(`[${elapsed}s] Status: ${status.status}, Progress: ${status.progress}%`);

        if (status.status === 'completed') {
          console.log('\n✅ Execution completed successfully!');
          console.log('   Started at:', status.started_at);
          console.log('   Completed at:', status.completed_at);
          break;
        } else if (status.status === 'failed') {
          console.log('\n❌ Execution failed!');
          console.log('   Error:', status.error_message);
          break;
        }
      }
    }

  } catch (error) {
    console.error('❌ Failed to add job to queue:', error);
  }
}

async function main() {
  const agentId = process.argv[2];

  if (!agentId) {
    console.error('❌ Usage: tsx scripts/test-agent-execution.ts <agent-id>');
    process.exit(1);
  }

  console.log('🚀 Test Agent Execution Script');
  console.log('===============================');

  await testAgentExecution(agentId);

  console.log('\n✅ Test complete!\n');
}

main().catch(console.error);
