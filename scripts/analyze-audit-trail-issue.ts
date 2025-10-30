/**
 * Deep analysis of audit trail issue
 * Compare what worked yesterday vs today
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YOUR_USER_ID = '08456106-aa50-4810-b12c-7ca84102da31'; // offir.omer@gmail.com
const OTHER_USER_ID = '39c134b8-fab3-49eb-b05f-c174ce4a8229'; // eomer3@gmail.com

async function analyzeAuditTrailIssue() {
  console.log('\n🔍 DEEP ANALYSIS: Audit Trail Issue\n');
  console.log('=' .repeat(80));

  // 1. Check last successful audit logs
  console.log('\n1️⃣  LAST SUCCESSFUL AUDIT LOGS:\n');

  const { data: lastLogs } = await supabase
    .from('audit_trail')
    .select('action, created_at, user_id')
    .order('created_at', { ascending: false })
    .limit(10);

  if (lastLogs) {
    console.log('Most recent audit logs:');
    for (const log of lastLogs) {
      const userId = log.user_id ? log.user_id.substring(0, 8) + '...' : 'NULL (system)';
      console.log(`   ${log.created_at} | ${log.action.padEnd(35)} | User: ${userId}`);
    }

    const lastLogTime = new Date(lastLogs[0].created_at);
    const now = new Date();
    const hoursSince = Math.floor((now.getTime() - lastLogTime.getTime()) / (1000 * 60 * 60));

    console.log(`\n   ⚠️  Last audit log was ${hoursSince} hours ago`);
    console.log(`   ⏰ Stopped logging at: ${lastLogs[0].created_at}`);
  }

  // 2. Test INSERT with YOUR user_id (the one that ran the agent)
  console.log('\n2️⃣  TEST INSERT WITH YOUR USER_ID (08456106...):\n');

  const { data: test1, error: error1 } = await supabase
    .from('audit_trail')
    .insert({
      action: 'TEST_YOUR_USER_ID',
      entity_type: 'test',
      severity: 'info',
      user_id: YOUR_USER_ID
    })
    .select();

  if (error1) {
    console.log(`   ❌ FAILED: ${error1.message} (Code: ${error1.code})`);
  } else {
    console.log(`   ✅ SUCCESS!`);
    await supabase.from('audit_trail').delete().eq('action', 'TEST_YOUR_USER_ID');
  }

  // 3. Test INSERT with NULL user_id
  console.log('\n3️⃣  TEST INSERT WITH NULL USER_ID (system event):\n');

  const { data: test2, error: error2 } = await supabase
    .from('audit_trail')
    .insert({
      action: 'TEST_NULL_USER_ID',
      entity_type: 'test',
      severity: 'info',
      user_id: null
    })
    .select();

  if (error2) {
    console.log(`   ❌ FAILED: ${error2.message} (Code: ${error2.code})`);
  } else {
    console.log(`   ✅ SUCCESS!`);
    await supabase.from('audit_trail').delete().eq('action', 'TEST_NULL_USER_ID');
  }

  // 4. Check RLS policies
  console.log('\n4️⃣  CURRENT RLS POLICIES:\n');

  const { data: policies, error: policyError } = await supabase
    .rpc('exec_sql', {
      sql: `
        SELECT
          policyname,
          roles,
          cmd,
          qual,
          with_check
        FROM pg_policies
        WHERE tablename = 'audit_trail'
      `
    });

  if (!policyError && policies) {
    console.log('   Policies found:', JSON.stringify(policies, null, 2));
  } else {
    console.log('   Could not fetch policies via RPC');
  }

  // 5. Check if RLS is enabled
  console.log('\n5️⃣  RLS STATUS:\n');

  const { data: rlsStatus } = await supabase
    .rpc('exec_sql', {
      sql: `
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE tablename = 'audit_trail'
      `
    });

  if (rlsStatus) {
    console.log('   RLS Status:', JSON.stringify(rlsStatus, null, 2));
  }

  // 6. Check foreign keys
  console.log('\n6️⃣  FOREIGN KEY CONSTRAINTS:\n');

  const { data: fks } = await supabase
    .rpc('exec_sql', {
      sql: `
        SELECT
          conname AS constraint_name,
          confrelid::regclass AS references_table
        FROM pg_constraint
        WHERE conrelid = 'public.audit_trail'::regclass
        AND contype = 'f'
      `
    });

  if (fks) {
    if (Array.isArray(fks) && fks.length === 0) {
      console.log('   ✅ No foreign key constraints found');
    } else {
      console.log('   Foreign keys:', JSON.stringify(fks, null, 2));
    }
  }

  // 7. Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 SUMMARY:\n');
  console.log(`   • Audit trail stopped working ${hoursSince} hours ago`);
  console.log(`   • INSERT with user_id: ${error1 ? '❌ FAILS' : '✅ WORKS'}`);
  console.log(`   • INSERT with NULL user_id: ${error2 ? '❌ FAILS' : '✅ WORKS'}`);
  console.log(`   • Error when user_id is set: "${error1?.message}"`);

  console.log('\n💡 HYPOTHESIS:');
  console.log('   The issue happens ONLY when user_id is not NULL.');
  console.log('   Raw SQL works, but Supabase client fails.');
  console.log('   This suggests PostgREST is validating user_id against auth.users.');

  console.log('\n🔧 NEXT STEPS:');
  console.log('   1. Check what changed in Supabase platform between yesterday and today');
  console.log('   2. Check if there was a migration or config change');
  console.log('   3. Consider temporary workaround: log with user_id=null and store user in details JSONB');

  console.log('\n');
}

analyzeAuditTrailIssue().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
