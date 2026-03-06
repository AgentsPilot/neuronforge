#!/usr/bin/env npx tsx
// Quick database check script

import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

config({ path: path.join(__dirname, '../.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // Use service role to bypass RLS
);

async function checkDB() {
  console.log('Checking plugin_semantic_ops table...\n');

  // Get all plugin keys
  const { data, error } = await supabase
    .from('plugin_semantic_ops')
    .select('plugin_key')
    .limit(30);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📋 Sample plugin keys in database:');
  const uniqueKeys = Array.from(new Set(data.map((r: any) => r.plugin_key)));
  console.log(uniqueKeys);
  console.log('');

  // Count total rows
  const { count } = await supabase
    .from('plugin_semantic_ops')
    .select('*', { count: 'exact', head: true });

  console.log('📊 Total rows in table:', count);
  console.log('');

  // Try to fetch with exact keys we're looking for
  const targetKeys = ['google-mail', 'google-drive', 'google-sheets', 'chatgpt-research'];
  console.log('🔍 Searching for:', targetKeys.join(', '));

  const { data: data2, error: error2 } = await supabase
    .from('plugin_semantic_ops')
    .select('*')
    .in('plugin_key', targetKeys);

  console.log('');

  // Also try with a single key to debug
  console.log('🔍 Testing single key query for "google-mail":');
  const { data: data3, error: error3 } = await supabase
    .from('plugin_semantic_ops')
    .select('*')
    .eq('plugin_key', 'google-mail');

  console.log('Result:', data3?.length || 0, 'rows');

  if (error2) {
    console.error('❌ Query error:', error2);
    return;
  }

  console.log('✅ Found rows:', data2?.length || 0);

  if (data2 && data2.length > 0) {
    console.log('\n📦 Sample row:');
    console.log(JSON.stringify(data2[0], null, 2));
  }
}

checkDB().catch(console.error);
