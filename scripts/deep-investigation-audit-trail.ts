/**
 * Deep investigation: What changed between yesterday and today?
 * Find the ROOT CAUSE of the audit trail failure
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const YOUR_USER_ID = '08456106-aa50-4810-b12c-7ca84102da31';

async function deepInvestigation() {
  console.log('\n🔬 DEEP INVESTIGATION: Audit Trail Root Cause Analysis\n');
  console.log('='.repeat(80));

  console.log('\n📅 TIMELINE:\n');
  console.log('   Yesterday 7:04 PM: ✅ Audit logs with user_id worked');
  console.log('   Yesterday 11:28 PM: ✅ System logs (user_id=NULL) worked');
  console.log('   Today: ❌ Audit logs with user_id fail');
  console.log('   Today: ✅ System logs (user_id=NULL) still work');
  console.log('   Today: ✅ Raw SQL with user_id works');
  console.log('   Today: ❌ Supabase client with user_id fails');

  console.log('\n🔍 HYPOTHESIS 1: RLS Policy Issue\n');
  console.log('   Testing if RLS is the problem...');

  // Check RLS status
  const { data: tableInfo } = await supabase
    .from('audit_trail')
    .select('*')
    .limit(0);

  console.log('   Can query table:', tableInfo !== undefined ? '✅' : '❌');

  console.log('\n🔍 HYPOTHESIS 2: PostgREST Schema Cache Issue\n');
  console.log('   PostgREST caches table schemas. If the cache is stale, it might cause issues.');
  console.log('   Check your Supabase dashboard: Settings → Database → Connection pooling');
  console.log('   Look for "PostgREST" and see if there\'s a way to clear cache.');

  console.log('\n🔍 HYPOTHESIS 3: Column-Level Security\n');
  console.log('   Testing if specific columns trigger the error...');

  // Test insert without user_id column at all
  const { error: test1 } = await supabase
    .from('audit_trail')
    .insert({
      action: 'TEST_NO_USER_ID_COLUMN',
      entity_type: 'test',
      severity: 'info'
      // Omit user_id entirely
    });

  console.log('   Insert WITHOUT user_id column:', test1 ? '❌' : '✅');
  if (!test1) {
    await supabase.from('audit_trail').delete().eq('action', 'TEST_NO_USER_ID_COLUMN');
  }

  // Test insert with user_id = NULL explicitly
  const { error: test2 } = await supabase
    .from('audit_trail')
    .insert({
      action: 'TEST_EXPLICIT_NULL',
      entity_type: 'test',
      severity: 'info',
      user_id: null
    });

  console.log('   Insert with user_id = NULL:', test2 ? '❌' : '✅');
  if (!test2) {
    await supabase.from('audit_trail').delete().eq('action', 'TEST_EXPLICIT_NULL');
  }

  // Test insert with user_id = valid UUID
  const { error: test3 } = await supabase
    .from('audit_trail')
    .insert({
      action: 'TEST_WITH_USER_ID',
      entity_type: 'test',
      severity: 'info',
      user_id: YOUR_USER_ID
    });

  console.log('   Insert with user_id = UUID:', test3 ? `❌ ${test3.message}` : '✅');

  console.log('\n🔍 HYPOTHESIS 4: Supabase Project Settings Changed\n');
  console.log('   Questions to check in Supabase Dashboard:');
  console.log('   1. Database → Settings → Did "Enable read replicas" get turned on?');
  console.log('   2. Authentication → Providers → Any changes to auth providers?');
  console.log('   3. Authentication → Policies → Any new auth policies?');
  console.log('   4. Project Settings → General → Any project updates/migrations?');

  console.log('\n🔍 HYPOTHESIS 5: Database Schema Changed\n');
  console.log('   Checking audit_trail table structure...');

  // Get column info
  const { data: columns } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT
        column_name,
        data_type,
        is_nullable,
        column_default
      FROM information_schema.columns
      WHERE table_name = 'audit_trail'
      AND column_name = 'user_id'
    `
  });

  if (columns) {
    console.log('   user_id column info:', JSON.stringify(columns, null, 2));
  } else {
    console.log('   ⚠️  Could not fetch column info via RPC');
  }

  console.log('\n🔍 HYPOTHESIS 6: PostgREST Configuration Changed\n');
  console.log('   The error "permission denied for table users" suggests PostgREST');
  console.log('   is trying to access auth.users during validation.');
  console.log('   This could be a new PostgREST behavior or setting.');

  console.log('\n🔍 HYPOTHESIS 7: Auth Schema RLS Changed\n');
  console.log('   Checking if auth.users RLS was recently enabled...');

  const { data: authUsers } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'auth'
      AND tablename = 'users'
    `
  });

  if (authUsers) {
    console.log('   auth.users RLS status:', JSON.stringify(authUsers, null, 2));
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💡 NEXT INVESTIGATION STEPS:\n');
  console.log('1. Check Supabase Status Page: https://status.supabase.com');
  console.log('   Look for any incidents or maintenance around yesterday evening');
  console.log('');
  console.log('2. Check Supabase Changelog: https://supabase.com/changelog');
  console.log('   Look for PostgREST updates or auth changes');
  console.log('');
  console.log('3. Check your Supabase project logs:');
  console.log('   Dashboard → Logs → Select "postgres-logs" timeframe yesterday 7PM-midnight');
  console.log('');
  console.log('4. Compare your local .env.local with production:');
  console.log('   Did SUPABASE_SERVICE_ROLE_KEY change?');
  console.log('   Did NEXT_PUBLIC_SUPABASE_URL change?');

  console.log('\n');
}

deepInvestigation().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
