import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const expectedKeys = [
  // Dimension weights
  'ais_weight_tokens',
  'ais_weight_execution',
  'ais_weight_plugins',
  'ais_weight_workflow',
  'ais_weight_memory',
  // Token subdimensions
  'ais_token_volume_weight',
  'ais_token_peak_weight',
  'ais_token_io_weight',
  // Execution subdimensions
  'ais_execution_iterations_weight',
  'ais_execution_duration_weight',
  'ais_execution_failure_weight',
  'ais_execution_retry_weight',
  // Plugin subdimensions
  'ais_plugin_count_weight',
  'ais_plugin_usage_weight',
  'ais_plugin_overhead_weight',
  // Workflow subdimensions
  'ais_workflow_steps_weight',
  'ais_workflow_branches_weight',
  'ais_workflow_loops_weight',
  'ais_workflow_parallel_weight',
  // Memory subdimensions
  'ais_memory_ratio_weight',
  'ais_memory_diversity_weight',
  'ais_memory_volume_weight'
];

async function checkKeys() {
  console.log('🔍 Checking which AIS keys exist in the database...\n');

  const { data, error } = await supabase
    .from('ais_system_config')
    .select('config_key')
    .in('config_key', expectedKeys);

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  const existingKeys = new Set(data?.map(row => row.config_key) || []);

  console.log(`✅ Found ${existingKeys.size} out of ${expectedKeys.length} expected keys\n`);

  console.log('📊 Keys that EXIST:');
  expectedKeys.forEach(key => {
    if (existingKeys.has(key)) {
      console.log(`  ✓ ${key}`);
    }
  });

  console.log('\n❌ Keys that are MISSING:');
  const missingKeys = expectedKeys.filter(key => !existingKeys.has(key));
  missingKeys.forEach(key => {
    console.log(`  ✗ ${key}`);
  });

  console.log(`\n🔧 Total missing: ${missingKeys.length} keys`);
}

checkKeys().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
