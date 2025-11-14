// scripts/reset-dimension-weights.ts
// Reset main dimension weights to sum to 1.0

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resetWeights() {
  console.log('🔧 Resetting main dimension weights to default values (sum = 1.0)...\n');

  const weights = [
    { key: 'ais_weight_tokens', value: 0.30, description: 'Token dimension weight (30%)' },
    { key: 'ais_weight_execution', value: 0.25, description: 'Execution dimension weight (25%)' },
    { key: 'ais_weight_plugins', value: 0.20, description: 'Plugin dimension weight (20%)' },
    { key: 'ais_weight_workflow', value: 0.15, description: 'Workflow dimension weight (15%)' },
    { key: 'ais_weight_memory', value: 0.10, description: 'Memory dimension weight (10%)' }
  ];

  for (const { key, value, description } of weights) {
    console.log(`🔄 Setting ${key} = ${value}...`);

    const { data, error } = await supabase
      .from('ais_system_config')
      .update({
        config_value: value,
        description
      })
      .eq('config_key', key)
      .select();

    if (error) {
      console.error(`  ❌ Failed: ${error.message}`);
    } else {
      console.log(`  ✅ Success: ${key} = ${data?.[0]?.config_value}`);
    }
  }

  // Verify sum
  console.log('\n🔍 Verifying sum...');
  const { data } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', weights.map(w => w.key));

  const sum = data?.reduce((acc, row) => acc + Number(row.config_value), 0) || 0;
  console.log(`   Sum: ${sum.toFixed(3)} (must be 1.0)`);

  if (Math.abs(sum - 1.0) < 0.001) {
    console.log('   ✅ Weights now sum to 1.0!');
  } else {
    console.error('   ❌ Weights do not sum to 1.0!');
  }
}

resetWeights().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
