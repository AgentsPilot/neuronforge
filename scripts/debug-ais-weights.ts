import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkWeights() {
  console.log('🔍 Checking AIS weight values in database...\n');

  const { data, error } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', [
      'ais_weight_tokens',
      'ais_weight_execution',
      'ais_weight_plugins',
      'ais_weight_workflow',
      'ais_weight_memory'
    ])
    .order('config_key');

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📊 Current dimension weights in database:');
  data?.forEach(row => {
    console.log(`  ${row.config_key}: ${row.config_value} (type: ${typeof row.config_value})`);
  });

  // Try updating one value
  console.log('\n🔄 Testing update of ais_weight_tokens to 0.35...');
  const { data: updateData, error: updateError } = await supabase
    .from('ais_system_config')
    .update({ config_value: 0.35 })
    .eq('config_key', 'ais_weight_tokens')
    .select();

  if (updateError) {
    console.error('❌ Update error:', updateError);
  } else {
    console.log('✅ Update result:', updateData);
  }

  // Read back the value
  console.log('\n🔍 Reading back ais_weight_tokens...');
  const { data: readData, error: readError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .eq('config_key', 'ais_weight_tokens')
    .single();

  if (readError) {
    console.error('❌ Read error:', readError);
  } else {
    console.log('📖 Read result:', readData);
    console.log(`   Value: ${readData.config_value} (type: ${typeof readData.config_value})`);
  }
}

checkWeights().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
