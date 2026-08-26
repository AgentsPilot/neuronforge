/**
 * Apply Service Revenue Migration
 *
 * This script applies the migration to add service_id to payment tables
 * and total_amount to scheduling_bookings.
 *
 * Run with: npx tsx scripts/apply-service-revenue-migration.ts
 */

import { supabaseServer } from '../lib/supabaseServer';
import { readFileSync } from 'fs';
import { join } from 'path';

async function applyMigration() {
  console.log('🚀 Applying service revenue migration...\n');

  try {
    // Read the migration file
    const migrationPath = join(
      process.cwd(),
      'supabase/migrations/20260809_add_service_id_to_payments.sql'
    );
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration file loaded');
    console.log('Running SQL statements...\n');

    // Split by semicolons and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement) {
        console.log(`Executing statement ${i + 1}/${statements.length}...`);
        const { error } = await supabaseServer.rpc('exec_sql', {
          sql: statement + ';'
        });

        if (error) {
          // Try direct execution if RPC doesn't exist
          const { error: directError } = await (supabaseServer as any).sql(statement + ';');
          if (directError) {
            console.error(`❌ Error executing statement ${i + 1}:`, directError);
            throw directError;
          }
        }
        console.log(`✅ Statement ${i + 1} completed`);
      }
    }

    console.log('\n✨ Migration applied successfully!\n');
    console.log('Next steps:');
    console.log('1. Re-run the seed data: npx tsx scripts/run-seed-data.ts');
    console.log('2. Or apply seed data via Supabase dashboard SQL editor');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\n⚠️  Please apply the migration manually via Supabase dashboard:');
    console.error('   1. Go to SQL Editor in Supabase dashboard');
    console.error('   2. Copy contents of: supabase/migrations/20260809_add_service_id_to_payments.sql');
    console.error('   3. Run the SQL');
    process.exit(1);
  }
}

applyMigration();
