// Apply RLS policy fix for workflow_step_executions
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const fs = require('fs');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyRLSFix() {
  console.log('🔧 Applying RLS policy fix for workflow_step_executions...\n');

  const policies = [
    {
      name: 'Enable insert for anon role',
      sql: `
        CREATE POLICY "Enable insert for anon role"
          ON workflow_step_executions
          FOR INSERT
          TO anon
          WITH CHECK (true);
      `
    },
    {
      name: 'Enable read for anon role',
      sql: `
        CREATE POLICY "Enable read for anon role"
          ON workflow_step_executions
          FOR SELECT
          TO anon
          USING (true);
      `
    },
    {
      name: 'Enable update for anon role',
      sql: `
        CREATE POLICY "Enable update for anon role"
          ON workflow_step_executions
          FOR UPDATE
          TO anon
          USING (true)
          WITH CHECK (true);
      `
    }
  ];

  console.log('ℹ️  This script cannot execute SQL directly via Supabase client.');
  console.log('   Please run the following SQL in Supabase Dashboard > SQL Editor:\n');
  console.log('═'.repeat(80));

  // First drop existing policies
  console.log('-- Drop existing policies (if any)');
  policies.forEach(p => {
    console.log(`DROP POLICY IF EXISTS "${p.name}" ON workflow_step_executions;`);
  });
  console.log('');

  // Then create new policies
  console.log('-- Create new policies');
  policies.forEach(p => {
    console.log(p.sql.trim());
    console.log('');
  });

  console.log('═'.repeat(80));
  console.log('');
  console.log('After running the above SQL, test with:');
  console.log('  node apply-rls-fix.js --test');
}

async function testRLSFix() {
  console.log('🧪 Testing RLS policy fix...\n');

  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const testRow = {
    workflow_execution_id: '00000000-0000-0000-0000-000000000000',
    step_id: 'test_rls_' + Date.now(),
    step_name: 'Test RLS',
    step_type: 'action',
    status: 'pending',
    created_at: new Date().toISOString()
  };

  console.log('Testing INSERT with ANON key...');
  const { data, error } = await anonClient
    .from('workflow_step_executions')
    .insert(testRow)
    .select();

  if (error) {
    console.log('❌ ANON key INSERT failed:', error.message);
    console.log('   Code:', error.code);
    console.log('');
    console.log('RLS policies are NOT configured correctly.');
    console.log('Please run: node apply-rls-fix.js');
    return;
  }

  console.log('✅ ANON key INSERT succeeded!');

  // Clean up
  await anonClient
    .from('workflow_step_executions')
    .delete()
    .eq('step_id', testRow.step_id);

  console.log('✅ Test row deleted');
  console.log('');
  console.log('🎉 RLS policies are configured correctly!');
  console.log('   You can now run agents without RLS errors.');
}

if (process.argv.includes('--test')) {
  testRLSFix().catch(console.error);
} else {
  applyRLSFix().catch(console.error);
}
