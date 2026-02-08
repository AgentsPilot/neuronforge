#!/usr/bin/env tsx
/**
 * Test if get_next_run_number() is truly atomic
 * Run multiple concurrent calls to verify no duplicates
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

async function testConcurrentCalls() {
  console.log('🧪 Testing get_next_run_number() for race conditions...\n');

  const testAgentId = '43ffbc8a-406d-4a43-9f3f-4e7554160eda'; // Your actual agent

  console.log(`Testing with agent: ${testAgentId}\n`);

  // Call the function 10 times concurrently
  console.log('📡 Making 10 concurrent calls to get_next_run_number()...');

  const promises = Array.from({ length: 10 }, async (_, i) => {
    const { data, error } = await supabase.rpc('get_next_run_number', {
      p_agent_id: testAgentId
    });

    return { callNum: i + 1, data, error };
  });

  const results = await Promise.all(promises);

  console.log('\n📊 Results:');
  results.forEach(r => {
    console.log(`  Call ${r.callNum}: ${r.error ? `ERROR: ${r.error.message}` : `run_number = ${r.data}`}`);
  });

  // Check for duplicates
  const runNumbers = results
    .filter(r => !r.error)
    .map(r => r.data);

  const uniqueNumbers = new Set(runNumbers);

  console.log('\n═'.repeat(60));
  if (uniqueNumbers.size === runNumbers.length) {
    console.log('✅ SUCCESS: All run_numbers are unique!');
    console.log(`   Got ${runNumbers.length} unique numbers from ${runNumbers.length} calls`);
  } else {
    console.log('❌ FAILURE: Duplicate run_numbers detected!');
    console.log(`   Got ${uniqueNumbers.size} unique numbers from ${runNumbers.length} calls`);
    console.log(`   Duplicates: ${runNumbers.filter((n, i) => runNumbers.indexOf(n) !== i)}`);
  }
  console.log('═'.repeat(60));

  // Check current max run_number
  console.log('\n🔍 Checking current max run_number in database...');
  const { data: maxData, error: maxError } = await supabase
    .from('run_memories')
    .select('run_number')
    .eq('agent_id', testAgentId)
    .order('run_number', { ascending: false })
    .limit(1)
    .single();

  if (!maxError && maxData) {
    console.log(`   Current max: ${maxData.run_number}`);
    console.log(`   Function returned: ${Math.max(...runNumbers)}`);
    console.log(`   Expected next: ${maxData.run_number + 1}`);
  }
}

testConcurrentCalls().catch(console.error);
