/**
 * Check audit logs for a specific agent execution
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AGENT_ID = 'a27cf5db-915c-41dc-90d1-930a58b3f16c';

async function checkSpecificAgentLogs() {
  console.log(`\n🔍 Checking audit logs for agent: ${AGENT_ID}\n`);

  try {
    // Query all audit logs for this agent
    const { data: logs, error } = await supabase
      .from('audit_trail')
      .select('*')
      .eq('entity_id', AGENT_ID)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error fetching logs:', error);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log(`⚠️  No audit logs found for agent ${AGENT_ID}`);
      console.log('   This means the agent execution did NOT log any events.');
      console.log('   Reason: The audit trail was broken during that execution.\n');

      // Check if there are ANY recent agent execution logs
      const { data: recentAgentLogs, error: recentError } = await supabase
        .from('audit_trail')
        .select('*')
        .like('action', 'AGENTKIT_%')
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentError) {
        console.error('❌ Error fetching recent agent logs:', recentError);
        return;
      }

      console.log('📊 Most recent AGENTKIT_* audit logs (any agent):');
      console.log('─'.repeat(80));

      if (recentAgentLogs && recentAgentLogs.length > 0) {
        for (const log of recentAgentLogs) {
          console.log(`   ${log.action.padEnd(35)} | ${log.created_at} | Agent: ${log.entity_id?.substring(0, 8)}...`);
        }
      } else {
        console.log('   No AGENTKIT logs found at all!');
      }

      return;
    }

    console.log(`✅ Found ${logs.length} audit log(s) for agent ${AGENT_ID}:\n`);

    for (const log of logs) {
      console.log('─'.repeat(80));
      console.log(`🎯 Action: ${log.action}`);
      console.log(`📅 Timestamp: ${log.created_at}`);
      console.log(`👤 User ID: ${log.user_id || 'N/A'}`);
      console.log(`📝 Resource: ${log.resource_name || 'N/A'}`);
      console.log(`⚠️  Severity: ${log.severity}`);

      if (log.details) {
        console.log(`\n📊 Details:`);
        const detailsStr = JSON.stringify(log.details, null, 2);
        console.log(detailsStr.split('\n').map(line => `   ${line}`).join('\n'));
      }
      console.log('');
    }

    console.log('─'.repeat(80));

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the check
checkSpecificAgentLogs().then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
