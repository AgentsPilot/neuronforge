// Quick script to check and fix main dimension weights sum
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkWeights() {
  const { data } = await supabase
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

  console.log('Current main dimension weights:');
  let sum = 0;
  data?.forEach(row => {
    const val = parseFloat(row.config_value);
    sum += val;
    console.log(`  ${row.config_key}: ${val}`);
  });
  console.log(`  TOTAL: ${sum.toFixed(3)}`);
  console.log();

  if (Math.abs(sum - 1.0) > 0.001) {
    console.log('⚠️  Weights do not sum to 1.0! Fixing...');
    console.log();
    console.log('Setting to standard distribution:');
    console.log('  tokens: 0.25 (25%)');
    console.log('  execution: 0.30 (30%)');
    console.log('  plugins: 0.20 (20%)');
    console.log('  workflow: 0.15 (15%)');
    console.log('  memory: 0.10 (10%)');

    await supabase.from('ais_system_config').update({ config_value: 0.25 }).eq('config_key', 'ais_weight_tokens');
    await supabase.from('ais_system_config').update({ config_value: 0.30 }).eq('config_key', 'ais_weight_execution');
    await supabase.from('ais_system_config').update({ config_value: 0.20 }).eq('config_key', 'ais_weight_plugins');
    await supabase.from('ais_system_config').update({ config_value: 0.15 }).eq('config_key', 'ais_weight_workflow');
    await supabase.from('ais_system_config').update({ config_value: 0.10 }).eq('config_key', 'ais_weight_memory');

    console.log('✅ Weights fixed!');
  } else {
    console.log('✅ Weights sum to 1.0 correctly');
  }
}

checkWeights();
