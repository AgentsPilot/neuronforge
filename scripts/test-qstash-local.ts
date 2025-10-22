// Local testing script for QStash queue without requiring public URL
// This directly calls the worker endpoint locally
// Run: npx tsx scripts/test-qstash-local.ts <agent_id>

import { config } from 'dotenv';
import { createServerClient } from '@supabase/ssr';
import { AgentJobData } from '../lib/queues/qstashQueue';

// Load environment variables
config({ path: '.env.local' });

async function testLocalExecution() {
  const agentId = process.argv[2];

  if (!agentId) {
    console.error('❌ Please provide an agent ID');
    console.log('Usage: npx tsx scripts/test-qstash-local.ts <agent_id>');
    process.exit(1);
  }

  console.log('🚀 Local QStash Worker Test');
  console.log('============================\n');
  console.log('⚠️  This test simulates QStash by calling the worker endpoint directly\n');

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

    // 3. Create job data (same as QStash would send)
    const jobData: AgentJobData = {
      agent_id: agent.id,
      user_id: agent.user_id,
      execution_id: execution.id,
      execution_type: 'manual',
      input_variables: {},
      override_user_prompt: undefined,
    };

    console.log('🔄 Calling worker endpoint locally...\n');

    // 4. Call the worker endpoint directly
    const response = await fetch('http://localhost:3000/api/cron/process-queue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jobData),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Worker returned error:', result);
      throw new Error(`Worker failed: ${result.error}`);
    }

    console.log('✅ Worker executed successfully!\n');
    console.log('📊 Result:', JSON.stringify(result, null, 2));

    // 5. Fetch final execution status
    const { data: finalExecution } = await supabase
      .from('agent_executions')
      .select('*')
      .eq('id', execution.id)
      .single();

    console.log('\n📈 Final Execution Status:');
    console.log(`   Status: ${finalExecution?.status}`);
    console.log(`   Progress: ${finalExecution?.progress}%`);
    console.log(`   Duration: ${finalExecution?.execution_duration_ms}ms`);

    if (finalExecution?.error_message) {
      console.log(`   Error: ${finalExecution.error_message}`);
    }

    console.log('\n✅ Local test complete!\n');

    console.log('📝 Note: In production, QStash will call this endpoint automatically.');
    console.log('   No need to call it manually - jobs are queued via addManualExecution().\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

testLocalExecution();
