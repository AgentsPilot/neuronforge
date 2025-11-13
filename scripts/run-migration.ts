#!/usr/bin/env npx ts-node
/**
 * Run database migration for execution_id column
 * This script applies the migration to add execution_id to token_usage table
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  console.log('🔄 Running migration: add execution_id to token_usage');

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20250113_add_execution_id_to_token_usage.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration SQL:');
    console.log(migrationSQL);
    console.log('');

    // Execute the migration
    const { data, error } = await supabase.rpc('exec_sql', { sql: migrationSQL });

    if (error) {
      // Try direct execution if RPC doesn't exist
      console.log('⚠️  RPC method not available, trying direct execution...');

      // Split by semicolon and execute each statement
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (const statement of statements) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        const result = await supabase.from('_sql').select('*').limit(0);
        // Note: Supabase client doesn't expose raw SQL execution
        // This needs to be run manually or via Supabase dashboard
      }

      console.log('\n❌ Cannot execute SQL directly via Supabase client.');
      console.log('📋 Please run this migration manually via:');
      console.log('   1. Supabase Dashboard → SQL Editor');
      console.log('   2. Or use: psql -h <host> -U postgres -d postgres -f supabase/migrations/20250113_add_execution_id_to_token_usage.sql');
      console.log('');
      console.log('Migration file location:');
      console.log(`   ${migrationPath}`);

      return false;
    }

    console.log('✅ Migration completed successfully!');
    return true;

  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    return false;
  }
}

runMigration().then(success => {
  process.exit(success ? 0 : 1);
});
