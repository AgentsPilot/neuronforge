#!/usr/bin/env tsx
/**
 * Verify that memory system database functions exist
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function verify() {
  console.log('🔍 Verifying memory system functions...\n');

  // Test get_next_run_number function
  console.log('1️⃣ Testing get_next_run_number()...');
  const testAgentId = '00000000-0000-0000-0000-000000000000';

  const { data: runNumber, error: runNumberError } = await supabase
    .rpc('get_next_run_number', { p_agent_id: testAgentId });

  if (runNumberError) {
    console.error('❌ get_next_run_number() FAILED:', runNumberError.message);
    console.error('   The function does not exist or has errors\n');
  } else {
    console.log(`✅ get_next_run_number() works! Returned: ${runNumber}\n`);
  }

  // Test increment_memory_usage function
  console.log('2️⃣ Testing increment_memory_usage()...');
  const testMemoryId = '00000000-0000-0000-0000-000000000000';

  const { error: usageError } = await supabase
    .rpc('increment_memory_usage', { p_memory_id: testMemoryId });

  if (usageError) {
    console.error('❌ increment_memory_usage() FAILED:', usageError.message);
    console.error('   The function does not exist or has errors\n');
  } else {
    console.log(`✅ increment_memory_usage() works!\n`);
  }

  // Summary
  console.log('═'.repeat(60));
  if (!runNumberError && !usageError) {
    console.log('✅ All functions are working correctly!');
  } else {
    console.log('⚠️  Some functions are missing or broken');
    console.log('\nYou need to apply the SQL migration again:');
    console.log('supabase/SQL Scripts/20260205_fix_run_number_race_condition.sql');
  }
  console.log('═'.repeat(60));
}

verify().catch(console.error);
