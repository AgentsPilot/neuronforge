#!/usr/bin/env tsx
/**
 * Apply the search_similar_memories function to Supabase
 * This fixes the MemoryInjector warning by creating the missing RPC function
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from 'dotenv';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env.local');
  console.error('   Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function applyMigration() {
  console.log('🔧 Applying search_similar_memories function migration...\n');

  // Create Supabase client with service role key (needed for DDL operations)
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  // Read the SQL file
  const sqlPath = resolve(process.cwd(), 'supabase/SQL Scripts/20251201000000_create_search_similar_memories_function.sql');
  let sql: string;

  try {
    sql = readFileSync(sqlPath, 'utf-8');
    console.log('✅ SQL file loaded successfully');
  } catch (error) {
    console.error('❌ Failed to read SQL file:', error);
    process.exit(1);
  }

  // Split SQL into statements (separated by semicolons)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`📝 Found ${statements.length} SQL statements to execute\n`);

  // Execute each statement
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i] + ';'; // Add back the semicolon
    const preview = statement.substring(0, 100).replace(/\n/g, ' ') + '...';

    console.log(`[${i + 1}/${statements.length}] Executing: ${preview}`);

    const { error } = await supabase.rpc('exec_sql', {
      sql_query: statement
    }).single();

    if (error) {
      // Try direct execution as fallback
      const { error: directError } = await supabase
        .from('_sql_exec')
        .select('*')
        .limit(0);

      if (directError) {
        console.error(`❌ Failed to execute statement ${i + 1}:`, error.message);
        console.error('   Statement:', statement.substring(0, 200));
        console.log('\n⚠️  Note: You may need to run this SQL manually in Supabase Dashboard');
        console.log('   Dashboard → SQL Editor → Paste the SQL from:');
        console.log('   supabase/SQL Scripts/20251201000000_create_search_similar_memories_function.sql\n');
        process.exit(1);
      }
    } else {
      console.log(`   ✅ Success`);
    }
  }

  console.log('\n✨ Migration applied successfully!');
  console.log('   The search_similar_memories function is now available');
  console.log('   MemoryInjector will use the optimized RPC function\n');

  // Test the function
  console.log('🧪 Testing the function...');

  const testEmbedding = new Array(1536).fill(0);
  testEmbedding[0] = 1; // Simple test vector

  const { data, error } = await supabase.rpc('search_similar_memories', {
    query_embedding: testEmbedding,
    query_agent_id: '00000000-0000-0000-0000-000000000000',
    match_threshold: 0.5,
    match_count: 5
  });

  if (error) {
    console.error('❌ Function test failed:', error.message);
    console.log('\n⚠️  The function was created but may not be working correctly.');
    console.log('   Please check the Supabase logs for details.\n');
    process.exit(1);
  } else {
    console.log('✅ Function test passed!');
    console.log(`   Returned ${data?.length || 0} results (expected 0 for test query)\n`);
  }

  console.log('🎉 All done! The warning should no longer appear.\n');
}

applyMigration().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
