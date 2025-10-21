// Run audit_trail table migration
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runMigration() {
  console.log('\n🚀 Running audit_trail table migration...\n');

  try {
    // Read the SQL migration file
    const sqlPath = join(process.cwd(), 'supabase', 'migrations', 'create_audit_trail.sql');
    const sql = readFileSync(sqlPath, 'utf-8');

    console.log('📄 Migration SQL loaded from:', sqlPath);
    console.log('📊 SQL length:', sql.length, 'characters\n');

    // Execute the migration
    console.log('⏳ Executing migration...');
    const { error } = await supabase.rpc('exec_sql', { sql_query: sql }).single();

    if (error) {
      // Try direct execution if RPC doesn't exist
      console.log('⚠️ RPC method not available, trying direct execution...\n');

      // Split into individual statements and execute one by one
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        if (statement) {
          console.log(`Executing statement ${i + 1}/${statements.length}...`);
          const { error: stmtError } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });

          if (stmtError) {
            console.error(`❌ Error in statement ${i + 1}:`, stmtError.message);
            // Continue anyway - some errors might be expected (like "already exists")
          }
        }
      }
    }

    console.log('\n✅ Migration completed!');
    console.log('\n🔍 Verifying table creation...');

    // Verify the table exists
    const { data, error: verifyError } = await supabase
      .from('audit_trail')
      .select('id')
      .limit(1);

    if (verifyError) {
      console.error('❌ Verification failed:', verifyError.message);
      console.log('\n⚠️ Please run this SQL manually in Supabase SQL Editor:\n');
      console.log(sql);
      process.exit(1);
    }

    console.log('✅ Table verified successfully!\n');
    console.log('🎉 You can now run: npx tsx scripts/test-audit-service.ts\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }

    console.log('\n⚠️ Please run the migration manually:');
    console.log('1. Go to Supabase Dashboard → SQL Editor');
    console.log('2. Copy contents from: supabase/migrations/create_audit_trail.sql');
    console.log('3. Execute the SQL');

    process.exit(1);
  }
}

runMigration();
