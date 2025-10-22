// Test script for QStash-based agent execution
// Run: npx tsx scripts/test-qstash-execution.ts <agent_id>

import { config } from 'dotenv';
import { createServerClient } from '@supabase/ssr';
import { addManualExecution } from '../lib/queues/qstashQueue';

// Load environment variables
config({ path: '.env.local' });

async function testQStashExecution() {
  const agentId = process.argv[2];

  if (!agentId) {
    console.error('❌ Please provide an agent ID');
    console.log('Usage: npx tsx scripts/test-qstash-execution.ts <agent_id>');
    process.exit(1);
  }

  console.log('🚀 QStash Agent Execution Test');
  console.log('===============================\n');

  // Create Supabase client
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        get: () => undefined,
        set: () => {},
        remove: () => {},
      },
    }
  );

  try {
    // 1. Fetch agent
    console.log(`🔍 Fetching agent ${agentId}...`);
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('id', agentId)
      .single();

    if (agentError || !agent) {
      throw new Error(`Agent not found: ${agentError?.message}`);
    }

    console.log(`✅ Found agent: ${agent.agent_name}`);
    console.log(`   Mode: ${agent.mode}`);
    console.log(`   Status: ${agent.status}`);
    console.log(`   User ID: ${agent.user_id}\n`);

    // 2. Create execution record
    console.log('📝 Creating execution record...');
    const { data: execution, error: execError } = await supabase
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

    if (execError || !execution) {
      throw new Error(`Failed to create execution: ${execError?.message}`);
    }

    console.log(`✅ Created execution record: ${execution.id}\n`);

    // 3. Add to QStash queue
    console.log('📥 Adding job to QStash queue...');

    const { jobId, executionId } = await addManualExecution(
      agent.id,
      agent.user_id,
      execution.id,
      {},
      undefined
    );

    console.log(`✅ Successfully queued job via QStash!`);
    console.log(`   QStash Message ID: ${jobId}`);
    console.log(`   Execution ID: ${executionId}\n`);

    console.log('⏳ Job queued! QStash will call your worker endpoint.');
    console.log('📊 Monitor progress:');
    console.log(`   1. Upstash Console: https://console.upstash.com/qstash`);
    console.log(`   2. Database: SELECT * FROM agent_executions WHERE id = '${executionId}';`);
    console.log(`   3. App Dashboard: Check execution logs\n`);

    // 4. Monitor execution (poll database)
    console.log('📊 Monitoring execution status (checking for 60 seconds)...\n');

    let attempts = 0;
    const maxAttempts = 12; // 60 seconds / 5 seconds

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      const { data: currentExec } = await supabase
        .from('agent_executions')
        .select('status, progress, error_message')
        .eq('id', executionId)
        .single();

      attempts++;
      const elapsed = attempts * 5;

      if (currentExec) {
        console.log(`[${elapsed}s] Status: ${currentExec.status}, Progress: ${currentExec.progress || 0}%`);

        if (currentExec.status === 'completed') {
          console.log('\n✅ Execution completed successfully!');
          break;
        }

        if (currentExec.status === 'failed') {
          console.log(`\n❌ Execution failed: ${currentExec.error_message}`);
          break;
        }
      }
    }

    if (attempts >= maxAttempts) {
      console.log('\n⏱️ Monitoring timeout. Check Upstash Console for job status.');
    }

    console.log('\n✅ Test complete!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testQStashExecution();
