/**
 * Check ALL recent audit logs to verify audit trail is working
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkAllRecentAuditLogs() {
  console.log('\n🔍 Checking ALL recent audit logs...\n');

  try {
    // Query all recent audit logs
    const { data: logs, error } = await supabase
      .from('audit_trail')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('❌ Error fetching audit logs:', error);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log('⚠️  No audit logs found in the database at all.');
      console.log('   This means the audit trail has not been capturing ANY events.');
      return;
    }

    console.log(`✅ Found ${logs.length} recent audit log(s):\n`);

    // Group by action
    const actionCounts: Record<string, number> = {};
    for (const log of logs) {
      actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
    }

    console.log('📊 Audit Log Summary by Action:');
    console.log('─'.repeat(80));
    for (const [action, count] of Object.entries(actionCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${action.padEnd(40)} ${count} event(s)`);
    }
    console.log('─'.repeat(80));

    console.log('\n📝 Most Recent 10 Logs:\n');

    for (const log of logs.slice(0, 10)) {
      console.log('─'.repeat(80));
      console.log(`🎯 Action: ${log.action}`);
      console.log(`📅 Timestamp: ${log.created_at}`);
      console.log(`👤 User ID: ${log.user_id || 'N/A'}`);
      console.log(`🔖 Entity: ${log.entity_type} (${log.entity_id || 'N/A'})`);
      console.log(`📝 Resource: ${log.resource_name || 'N/A'}`);
      console.log(`⚠️  Severity: ${log.severity}`);

      if (log.details) {
        console.log(`📊 Details: ${JSON.stringify(log.details, null, 2)}`);
      }
    }

    console.log('─'.repeat(80));
    console.log(`\n✅ Audit trail is capturing events!`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the check
checkAllRecentAuditLogs().then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
