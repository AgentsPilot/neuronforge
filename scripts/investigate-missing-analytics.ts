// scripts/investigate-missing-analytics.ts
// Investigate why gpt-4o-mini execution isn't showing in analytics

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function investigate() {
  console.log('🔍 Investigating missing analytics record...\n');

  // Step 1: Find the audit trail record with gpt-4o-mini
  console.log('📋 Step 1: Finding audit trail record with gpt-4o-mini...\n');
  const { data: audit } = await supabase
    .from('audit_trail')
    .select('*')
    .eq('action', 'AGENTKIT_EXECUTION_COMPLETED')
    .or('details->>model_used.eq.gpt-4o-mini,details->>model.eq.gpt-4o-mini')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!audit) {
    console.log('❌ No audit record found');
    return;
  }

  console.log('✅ Found audit record:');
  console.log('ID:', audit.id);
  console.log('Action:', audit.action);
  console.log('Entity ID (agent):', audit.entity_id);
  console.log('User ID:', audit.user_id);
  console.log('Created at:', audit.created_at);
  console.log('Model used:', audit.details?.model_used || audit.details?.model);
  console.log('Total tokens:', audit.details?.total_tokens);
  console.log('Provider:', audit.details?.provider_used);
  console.log('');

  // Step 2: Check if there's a matching token_usage record
  console.log('📋 Step 2: Looking for matching token_usage record...\n');
  const auditTime = new Date(audit.created_at);
  const timeStart = new Date(auditTime.getTime() - 120000).toISOString(); // 2 min before
  const timeEnd = new Date(auditTime.getTime() + 120000).toISOString(); // 2 min after

  const { data: tokenRecords } = await supabase
    .from('token_usage')
    .select('*')
    .eq('user_id', audit.user_id)
    .gte('created_at', timeStart)
    .lte('created_at', timeEnd);

  console.log(`Found ${tokenRecords?.length || 0} token_usage records in 4-minute window:`);
  if (tokenRecords && tokenRecords.length > 0) {
    tokenRecords.forEach((r: any, i: number) => {
      console.log(`\n  ${i + 1}. ID: ${r.id}`);
      console.log(`     Model: ${r.model_name}`);
      console.log(`     Tokens: ${r.total_tokens}`);
      console.log(`     Cost: $${r.cost_usd}`);
      console.log(`     Category: ${r.category || 'N/A'}`);
      console.log(`     Activity Name: ${r.activity_name || 'N/A'}`);
      console.log(`     Activity Type: ${r.activity_type || 'N/A'}`);
      console.log(`     Request Type: ${r.request_type || 'N/A'}`);
      console.log(`     Created: ${r.created_at}`);
      console.log(`     Agent ID: ${r.agent_id || 'N/A'}`);
    });
  } else {
    console.log('❌ No token_usage records found!');
    console.log('   This means the execution was NOT tracked in token_usage table.');
    console.log('   Possible reasons:');
    console.log('   1. AIAnalyticsService.track() was not called');
    console.log('   2. BaseProvider tracking failed');
    console.log('   3. Database insert failed silently');
  }

  // Step 3: Check what analytics would show
  console.log(`\n📋 Step 3: Checking what analytics query would return...\n`);

  const { data: analyticsData } = await supabase
    .from('token_usage')
    .select('*')
    .eq('user_id', audit.user_id)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log(`Analytics would show ${analyticsData?.length || 0} recent records for this user:`);
  if (analyticsData && analyticsData.length > 0) {
    analyticsData.forEach((r: any, i: number) => {
      console.log(`\n  ${i + 1}. ${r.activity_name || r.request_type || 'Unknown'}`);
      console.log(`     Model: ${r.model_name}`);
      console.log(`     Tokens: ${r.total_tokens}`);
      console.log(`     Time: ${new Date(r.created_at).toLocaleString()}`);
    });
  }

  // Step 4: Check agent_logs table
  console.log(`\n📋 Step 4: Checking agent_logs table...\n`);

  const { data: agentLogs } = await supabase
    .from('agent_logs')
    .select('*')
    .eq('agent_id', audit.entity_id)
    .order('created_at', { ascending: false })
    .limit(3);

  console.log(`Found ${agentLogs?.length || 0} agent_logs records:`);
  if (agentLogs && agentLogs.length > 0) {
    agentLogs.forEach((log: any, i: number) => {
      const runOutput = typeof log.run_output === 'string' ? JSON.parse(log.run_output) : log.run_output;
      console.log(`\n  ${i + 1}. Log ID: ${log.id}`);
      console.log(`     Model: ${runOutput?.model || log.full_output?.agentkit_metadata?.model || 'Unknown'}`);
      console.log(`     Created: ${new Date(log.created_at).toLocaleString()}`);
    });
  }
}

investigate()
  .then(() => {
    console.log('\n✅ Investigation complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
