import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkRPC() {
  console.log('\n🔍 Checking get_active_ais_ranges RPC output\n');

  const { data, error } = await supabase.rpc('get_active_ais_ranges');

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Number of ranges:', data.length);
  console.log('\nSample range (creation_plugins):');
  const pluginRange = data.find((r: any) => r.range_key === 'creation_plugins');
  if (pluginRange) {
    console.log(JSON.stringify(pluginRange, null, 2));
    console.log('\nAll columns:', Object.keys(pluginRange));
  }

  console.log('\n All creation ranges:');
  const creationRanges = data.filter((r: any) => r.range_key.startsWith('creation_'));
  creationRanges.forEach((r: any) => {
    console.log(`  ${r.range_key}: min=${r.min_value}, max=${r.max_value}`);
  });
}

checkRPC();
