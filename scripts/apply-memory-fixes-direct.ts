#!/usr/bin/env tsx
/**
 * CRITICAL: Apply memory system race condition fix
 *
 * This creates the get_next_run_number() PostgreSQL function to prevent
 * duplicate run_number errors that are currently happening in production.
 *
 * Usage: tsx scripts/apply-memory-fixes-direct.ts
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

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function applyFix() {
  console.log('🚀 Applying CRITICAL memory system race condition fix...\n');

  const migrationPath = resolve(process.cwd(), 'supabase/SQL Scripts/20260205_fix_run_number_race_condition.sql');

  try {
    const sql = readFileSync(migrationPath, 'utf-8');
    console.log('📝 Loaded SQL migration file\n');

    // Split into separate function definitions
    const functions = sql.split(/(?=CREATE OR REPLACE FUNCTION)/g)
      .filter(s => s.trim().length > 0);

    console.log(`Found ${functions.length} functions to create:\n`);

    for (const func of functions) {
      if (!func.includes('CREATE OR REPLACE FUNCTION')) continue;

      const match = func.match(/CREATE OR REPLACE FUNCTION (\w+)/);
      const funcName = match ? match[1] : 'unknown';

      console.log(`📦 Creating function: ${funcName}`);

      // Execute via Supabase REST API (direct SQL execution)
      const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${funcName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseServiceKey,
          'Authorization': `Bearer ${supabaseServiceKey}`
        }
      });

      // Actually, we need to use the SQL endpoint directly
      // Since we can't execute DDL via RPC, we'll provide manual instructions

      console.log(`⚠️  Cannot execute DDL via Supabase client`);
      console.log(`   You must apply this manually via Supabase Dashboard\n`);
      break;
    }

    console.log('═'.repeat(70));
    console.log('⚠️  MANUAL ACTION REQUIRED');
    console.log('═'.repeat(70));
    console.log('\nThe SQL migration cannot be applied programmatically.');
    console.log('You MUST apply it manually via Supabase Dashboard:\n');
    console.log('1. Go to: https://app.supabase.com');
    console.log('2. Select your project');
    console.log('3. Navigate to: SQL Editor');
    console.log('4. Click "New Query"');
    console.log('5. Copy and paste the ENTIRE contents of:');
    console.log(`   ${migrationPath}`);
    console.log('6. Click "Run" (or press Cmd+Enter)\n');
    console.log('This will create two PostgreSQL functions:');
    console.log('  • get_next_run_number() - Fixes race condition');
    console.log('  • increment_memory_usage() - Fixes usage tracking\n');
    console.log('═'.repeat(70));
    console.log('\n🔥 CRITICAL: You are currently getting duplicate run_number errors!');
    console.log('   Apply this migration NOW to fix the issue.\n');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

applyFix();
