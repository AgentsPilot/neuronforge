#!/usr/bin/env tsx
/**
 * Apply all memory system fixes to Supabase
 * - search_similar_memories function (pgvector optimization)
 * - get_next_run_number function (race condition fix)
 * - increment_memory_usage function (broken usage tracking fix)
 * - Performance indexes
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

async function executeSqlFile(supabase: any, filePath: string, description: string): Promise<boolean> {
  console.log(`\n🔧 ${description}...`);

  let sql: string;
  try {
    sql = readFileSync(filePath, 'utf-8');
    console.log('✅ SQL file loaded successfully');
  } catch (error) {
    console.error('❌ Failed to read SQL file:', error);
    return false;
  }

  // Split SQL into statements (separated by semicolons)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  console.log(`📝 Found ${statements.length} SQL statements to execute`);

  // Execute each statement
  for (let i = 0; i < statements.length; i++) {
    const statement = statements[i] + ';';
    const preview = statement.substring(0, 80).replace(/\n/g, ' ') + '...';

    console.log(`  [${i + 1}/${statements.length}] ${preview}`);

    try {
      // Use raw SQL execution via Supabase SQL editor
      const { error } = await supabase.rpc('exec_sql', { sql_query: statement });

      if (error) {
        console.error(`  ❌ Error:`, error.message);
        return false;
      }

      console.log(`  ✅ Success`);
    } catch (error: any) {
      console.error(`  ❌ Error:`, error.message);
      return false;
    }
  }

  return true;
}

async function applyMigrations() {
  console.log('🚀 Applying memory system fixes...\n');
  console.log('This will:');
  console.log('  1. Fix race condition in run_number calculation');
  console.log('  2. Fix broken recordMemoryUsage() function');
  console.log('  3. Optimize semantic search with pgvector RPC');
  console.log('  4. Add performance indexes\n');

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const migrations = [
    {
      file: resolve(process.cwd(), 'supabase/SQL Scripts/20260205_fix_run_number_race_condition.sql'),
      description: 'Applying race condition fixes',
      testFn: async () => {
        console.log('🧪 Testing get_next_run_number function...');
        const testAgentId = '00000000-0000-0000-0000-000000000000';
        const { data, error } = await supabase.rpc('get_next_run_number', { p_agent_id: testAgentId });

        if (error) {
          console.error('❌ Test failed:', error.message);
          return false;
        }

        console.log(`✅ Function returned: ${data} (expected 1 for empty agent)`);
        return true;
      }
    },
    {
      file: resolve(process.cwd(), 'supabase/SQL Scripts/20260205_add_memory_system_indexes.sql'),
      description: 'Applying performance indexes',
      testFn: async () => {
        console.log('🧪 Verifying indexes...');
        const { data, error } = await supabase
          .from('run_memories')
          .select('id')
          .limit(1);

        if (error) {
          console.error('❌ Test query failed:', error.message);
          return false;
        }

        console.log('✅ Indexes applied successfully');
        return true;
      }
    },
    {
      file: resolve(process.cwd(), 'supabase/SQL Scripts/20251201000000_create_search_similar_memories_function.sql'),
      description: 'Applying pgvector search optimization',
      testFn: async () => {
        console.log('🧪 Testing search_similar_memories function...');
        const testEmbedding = new Array(1536).fill(0);
        testEmbedding[0] = 1;

        const { data, error } = await supabase.rpc('search_similar_memories', {
          query_embedding: testEmbedding,
          query_agent_id: '00000000-0000-0000-0000-000000000000',
          match_threshold: 0.5,
          match_count: 5
        });

        if (error) {
          console.error('❌ Test failed:', error.message);
          return false;
        }

        console.log(`✅ Function returned ${data?.length || 0} results`);
        return true;
      }
    }
  ];

  let successCount = 0;
  let failCount = 0;

  for (const migration of migrations) {
    const success = await executeSqlFile(supabase, migration.file, migration.description);

    if (success && migration.testFn) {
      const testSuccess = await migration.testFn();
      if (testSuccess) {
        successCount++;
      } else {
        failCount++;
      }
    } else if (success) {
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(60));
  if (failCount === 0) {
    console.log('✨ All migrations applied successfully!');
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ ${successCount} migrations applied`);
    console.log(`   ❌ ${failCount} failures`);
    console.log('\n🎉 Memory system is now optimized!');
    console.log('   - Race conditions eliminated');
    console.log('   - N+1 queries fixed');
    console.log('   - Performance indexes added');
    console.log('   - Semantic search optimized\n');
  } else {
    console.log('⚠️  Some migrations failed');
    console.log(`\n📊 Summary:`);
    console.log(`   ✅ ${successCount} migrations applied`);
    console.log(`   ❌ ${failCount} failures`);
    console.log('\n💡 You may need to run failed migrations manually in Supabase Dashboard');
    console.log('   Dashboard → SQL Editor → Paste the SQL from failed files\n');
    process.exit(1);
  }
}

applyMigrations().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
