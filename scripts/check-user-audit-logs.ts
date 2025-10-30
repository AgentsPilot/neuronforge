/**
 * Check what audit logs exist for a specific user
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkUserAuditLogs() {
  console.log('\n🔍 Checking audit logs by user_id...\n');

  try {
    // Get all users
    const { data: users, error: userError } = await supabase.auth.admin.listUsers();

    if (userError) {
      console.error('❌ Error fetching users:', userError);
      return;
    }

    console.log(`📊 Found ${users.users.length} user(s)\n`);

    for (const user of users.users) {
      // Query audit logs for this user
      const { data: logs, error } = await supabase
        .from('audit_trail')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) {
        console.error(`❌ Error fetching logs for ${user.email}:`, error);
        continue;
      }

      console.log(`👤 User: ${user.email} (${user.id})`);
      console.log(`   Audit Logs: ${logs?.length || 0} events`);

      if (logs && logs.length > 0) {
        console.log('   Recent Actions:');
        for (const log of logs) {
          console.log(`     - ${log.action} (${log.created_at})`);
        }
      }
      console.log('');
    }

    // Also check system logs (user_id = null)
    const { data: systemLogs, error: systemError } = await supabase
      .from('audit_trail')
      .select('*')
      .is('user_id', null)
      .order('created_at', { ascending: false })
      .limit(10);

    if (systemError) {
      console.error('❌ Error fetching system logs:', systemError);
      return;
    }

    console.log(`🤖 System Logs (user_id = null): ${systemLogs?.length || 0} events`);
    if (systemLogs && systemLogs.length > 0) {
      console.log('   Recent Actions:');
      for (const log of systemLogs) {
        console.log(`     - ${log.action} (${log.created_at})`);
      }
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

// Run the check
checkUserAuditLogs().then(() => {
  console.log('\n✅ Check complete');
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
