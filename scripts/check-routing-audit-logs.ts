/**
 * Check if MODEL_ROUTING_DECISION audit logs are being captured
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRoutingAuditLogs() {
  console.log('\n🔍 Checking MODEL_ROUTING_DECISION audit logs...\n');

  try {
    // Query recent MODEL_ROUTING_DECISION events
    const { data: logs, error } = await supabase
      .from('audit_trail')
      .select('*')
      .eq('action', 'MODEL_ROUTING_DECISION')
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('❌ Error fetching audit logs:', error);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log('⚠️  No MODEL_ROUTING_DECISION audit logs found yet.');
      console.log('   Run an agent with intelligent routing enabled to generate logs.');
      return;
    }

    console.log(`✅ Found ${logs.length} MODEL_ROUTING_DECISION audit log(s):\n`);

    for (const log of logs) {
      console.log('─'.repeat(80));
      console.log(`📅 Timestamp: ${log.created_at}`);
      console.log(`👤 User ID: ${log.user_id || 'N/A'}`);
      console.log(`🎯 Entity: ${log.entity_type} (${log.entity_id})`);
      console.log(`📝 Resource: ${log.resource_name}`);
      console.log(`⚠️  Severity: ${log.severity}`);

      if (log.details) {
        console.log(`\n📊 Details:`);
        console.log(`   Selected Model: ${log.details.selected_model}`);
        console.log(`   Provider: ${log.details.selected_provider}`);
        console.log(`   AIS Score: ${log.details.ais_score}`);
        console.log(`   Reasoning: ${log.details.reasoning}`);

        if (log.details.cost_savings_vs_default) {
          console.log(`   💰 Cost Savings: ${log.details.cost_savings_vs_default}`);
        }
      }

      console.log('');
    }

    console.log('─'.repeat(80));
    console.log(`\n✅ Audit trail is working correctly!`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the check
checkRoutingAuditLogs().then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
