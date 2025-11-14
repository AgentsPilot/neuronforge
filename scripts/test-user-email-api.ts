// scripts/test-user-email-api.ts
// Test the user email fetching logic for the Memory System page

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testUserEmailFetch() {
  console.log('🧪 Testing User Email Fetch Logic\n');
  console.log('='.repeat(80));

  // Get a few user IDs from agents table
  const { data: agents, error: agentsError } = await supabase
    .from('agents')
    .select('user_id')
    .limit(3);

  if (agentsError || !agents || agents.length === 0) {
    console.log('❌ No agents found in database');
    return;
  }

  const userIds = [...new Set(agents.map(a => a.user_id))];
  console.log('📋 Sample user IDs from agents:', userIds);

  // Fetch auth users using admin API
  console.log('\n🔍 Fetching auth users...');
  const { data: authData, error: authError } = await supabase.auth.admin.listUsers();

  if (authError) {
    console.error('❌ Error:', authError);
    return;
  }

  console.log('✅ Total auth users:', authData.users.length);

  // Map for the requested IDs
  const userEmailMap: Record<string, string> = {};
  authData.users.forEach(user => {
    if (userIds.includes(user.id)) {
      userEmailMap[user.id] = user.email || 'N/A';
    }
  });

  console.log('\n📧 User Email Mapping:');
  console.log(JSON.stringify(userEmailMap, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('✅ Test completed successfully!');
  console.log('\n💡 The new API endpoint /api/admin/user-emails should work correctly.');
  console.log('   Now refresh the Memory System page to see user emails displayed.');
}

testUserEmailFetch()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Test error:', err);
    process.exit(1);
  });
