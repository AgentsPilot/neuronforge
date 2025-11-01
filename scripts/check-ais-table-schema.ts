// Check what columns exist in ais_normalization_ranges
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSchema() {
  console.log('🔍 Checking ais_normalization_ranges schema...\n');

  const { data, error } = await supabase
    .from('ais_normalization_ranges')
    .select('*')
    .limit(1);

  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }

  if (data && data.length > 0) {
    console.log('✅ Columns in table:');
    console.log(Object.keys(data[0]).join(', '));
    console.log('\n📄 Sample row:');
    console.log(JSON.stringify(data[0], null, 2));
  } else {
    console.log('⚠️ No rows found in table');
  }

  process.exit(0);
}

checkSchema();
