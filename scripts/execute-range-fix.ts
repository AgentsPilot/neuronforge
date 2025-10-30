import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function executeFix() {
  console.log('\n🔧 Fixing Creation Score Ranges via SQL\n');

  const sql = `
UPDATE ais_normalization_ranges
SET min_value = 0, best_practice_min = 0
WHERE range_key IN ('creation_plugins', 'creation_workflow_steps', 'creation_io_fields');
  `.trim();

  console.log('Executing SQL:', sql);

  // Try using the SQL endpoint directly
  const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

  if (error) {
    console.error('\n❌ RPC method failed:', error.message);
    console.log('\n💡 Manual fix required:');
    console.log('\n1. Go to Supabase Dashboard → SQL Editor');
    console.log('2. Run this SQL:\n');
    console.log(sql);
    console.log('\n3. Then run the backfill script');
  } else {
    console.log('\n✅ Ranges updated successfully!');
    console.log(data);
  }
}

executeFix();
