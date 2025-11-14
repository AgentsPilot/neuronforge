import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testUpsert() {
  console.log('🔧 Testing upsert for missing memory weight keys...\n');

  const testKeys = [
    { key: 'ais_weight_memory', value: 0.10 },
    { key: 'ais_memory_ratio_weight', value: 0.5 },
    { key: 'ais_memory_diversity_weight', value: 0.3 },
    { key: 'ais_memory_volume_weight', value: 0.2 }
  ];

  for (const { key, value } of testKeys) {
    console.log(`🔄 Upserting ${key} = ${value}...`);

    const { data, error } = await supabase
      .from('ais_system_config')
      .upsert({
        config_key: key,
        config_value: value,
        description: `AIS weight configuration for ${key.replace('ais_', '').replace('_weight', '')}`,
        category: 'ais_dimension_weights'
      }, { onConflict: 'config_key' })
      .select();

    if (error) {
      console.error(`  ❌ Failed: ${error.message}`);
    } else {
      console.log(`  ✅ Success: ${JSON.stringify(data[0])}`);
    }
  }

  // Verify all keys now exist
  console.log('\n🔍 Verifying all keys now exist...');
  const { data: allKeys, error: readError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', testKeys.map(t => t.key))
    .order('config_key');

  if (readError) {
    console.error('❌ Read error:', readError);
  } else {
    console.log('📊 Memory weight keys in database:');
    allKeys?.forEach(row => {
      console.log(`  ${row.config_key}: ${row.config_value}`);
    });
    console.log(`\n✅ All ${allKeys?.length || 0} memory keys verified!`);
  }
}

testUpsert().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
