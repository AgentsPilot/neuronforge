import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getSchema() {
  console.log('\n🔍 Getting table schema via RPC\n');

  // Try to query the table structure via a simple select with limit 0
  const { data, error } = await supabase
    .from('ais_normalization_ranges')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error.message);
    console.log('\n💡 Try this SQL in Supabase Dashboard:\n');
    console.log(`SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ais_normalization_ranges'
ORDER BY ordinal_position;`);
    return;
  }

  if (data && data.length > 0) {
    console.log('✅ Table columns:', Object.keys(data[0]));
    console.log('\n📋 Sample row:');
    console.log(JSON.stringify(data[0], null, 2));

    console.log('\n💡 Based on the columns, the UPDATE statement should use:');
    const cols = Object.keys(data[0]);
    if (cols.includes('min_value')) {
      console.log('  min_value ✅');
    } else if (cols.includes('min')) {
      console.log('  min (not min_value)');
    } else {
      console.log('  Unknown min column - check the data above');
    }
  }
}

getSchema();
