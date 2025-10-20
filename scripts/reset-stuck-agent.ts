// scripts/reset-stuck-agent.ts
// Resets agents that are stuck in "claimed" state but never executed

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import parser from 'cron-parser';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resetStuckAgent(agentId: string) {
  console.log(`\n🔍 Checking agent ${agentId}...`);

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

  console.log('\n📋 Agent Details:');
  console.log('  Name:', agent.agent_name);
  console.log('  Schedule:', agent.schedule_cron);
  console.log('  Timezone:', agent.timezone || 'UTC');
  console.log('  Last Run:', agent.last_run);
  console.log('  Next Run:', agent.next_run);
  console.log('  Status:', agent.status);
  console.log('  Mode:', agent.mode);

  // 2. Check for pending/stuck executions
  const { data: executions } = await supabase
    .from('agent_executions')
    .select('*')
    .eq('agent_id', agentId)
    .in('status', ['pending', 'queued', 'running'])
    .order('created_at', { ascending: false });

  if (executions && executions.length > 0) {
    console.log(`\n⚠️  Found ${executions.length} stuck execution(s):`);
    executions.forEach((exec, i) => {
      console.log(`\n  Execution ${i + 1}:`);
      console.log('    ID:', exec.id);
      console.log('    Status:', exec.status);
      console.log('    Created:', exec.created_at);
      console.log('    Started:', exec.started_at);
      console.log('    Type:', exec.execution_type);
    });

    // Mark old pending executions as failed
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const stuckExecutions = executions.filter(e => e.created_at < oneHourAgo);

    if (stuckExecutions.length > 0) {
      console.log(`\n🔧 Marking ${stuckExecutions.length} old execution(s) as failed...`);

      for (const exec of stuckExecutions) {
        await supabase
          .from('agent_executions')
          .update({
            status: 'failed',
            error_message: 'Execution stuck - marked as failed by reset script',
            completed_at: new Date().toISOString(),
          })
          .eq('id', exec.id);

        console.log(`   ✅ Marked execution ${exec.id} as failed`);
      }
    }
  } else {
    console.log('\n✅ No stuck executions found');
  }

  // 3. Calculate correct next_run based on cron expression
  const now = new Date();
  let nextRun: Date;

  try {
    const interval = parser.parseExpression(agent.schedule_cron, {
      tz: agent.timezone || 'UTC',
      currentDate: now,
    });
    nextRun = interval.next().toDate();
    console.log('\n📅 Calculated next run from cron expression:', nextRun.toISOString());
  } catch (error) {
    console.error('❌ Error parsing cron expression:', error);
    nextRun = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
    console.log('⚠️  Using fallback next run:', nextRun.toISOString());
  }

  // 4. Check if next_run is in the past (agent is stuck)
  const currentNextRun = agent.next_run ? new Date(agent.next_run) : null;

  if (!currentNextRun) {
    console.log('\n⚠️  Agent has no next_run set!');
  } else if (currentNextRun < now) {
    console.log(`\n⚠️  Agent next_run is in the PAST (${currentNextRun.toISOString()})`);
    console.log('   This means the agent should have run already but didn\'t execute.');
  } else {
    console.log(`\n✅ Agent next_run is in the future (${currentNextRun.toISOString()})`);
    const minutesUntil = Math.round((currentNextRun.getTime() - now.getTime()) / 60000);
    console.log(`   Will run in ${minutesUntil} minutes`);
  }

  // 5. Update agent to correct next_run
  console.log('\n🔧 Resetting agent next_run to:', nextRun.toISOString());

  const { error: updateError } = await supabase
    .from('agents')
    .update({
      next_run: nextRun.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', agentId);

  if (updateError) {
    console.error('❌ Failed to update agent:', updateError);
  } else {
    console.log('✅ Successfully reset agent next_run');
  }

  console.log('\n✅ Agent reset complete!\n');
}

async function main() {
  const agentId = process.argv[2];

  if (!agentId) {
    console.error('❌ Usage: tsx scripts/reset-stuck-agent.ts <agent-id>');
    process.exit(1);
  }

  console.log('🚀 Reset Stuck Agent Script');
  console.log('============================');

  await resetStuckAgent(agentId);
}

main().catch(console.error);
