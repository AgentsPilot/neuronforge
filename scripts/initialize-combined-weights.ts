// scripts/initialize-combined-weights.ts
// Initialize combined score weights in database (Phase 1 Refactoring)

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function initializeCombinedWeights() {
  console.log('🔧 Initializing combined score weights in database...\n');

  const weights = [
    {
      key: 'ais_weight_creation',
      value: 0.3,
      description: 'Weight for creation score in combined score calculation (30%)',
      category: 'ais_combined_weights'
    },
    {
      key: 'ais_weight_execution_blend',
      value: 0.7,
      description: 'Weight for execution score in combined score calculation (70%)',
      category: 'ais_combined_weights'
    }
  ];

  for (const { key, value, description, category } of weights) {
    console.log(`🔄 Upserting ${key} = ${value}...`);

    const { data, error } = await supabase
      .from('ais_system_config')
      .upsert({
        config_key: key,
        config_value: value,
        description,
        category
      }, { onConflict: 'config_key' })
      .select();

    if (error) {
      console.error(`  ❌ Failed: ${error.message}`);
    } else {
      console.log(`  ✅ Success: ${key} = ${data?.[0]?.config_value}`);
    }
  }

  // Verify all keys now exist
  console.log('\n🔍 Verifying combined weight keys...');
  const { data: allKeys, error: readError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, description')
    .eq('category', 'ais_combined_weights')
    .order('config_key');

  if (readError) {
    console.error('❌ Read error:', readError);
  } else {
    console.log('📊 Combined weight keys in database:');
    allKeys?.forEach(row => {
      console.log(`  ${row.config_key}: ${row.config_value}`);
      console.log(`    → ${row.description}`);
    });
    console.log(`\n✅ All ${allKeys?.length || 0} combined weight keys verified!`);
  }

  // Show how these work with existing dimension weights
  console.log('\n📚 How the Three-Score System Works:');
  console.log('  1. EXECUTION SCORE = weighted average of 5 dimensions:');
  console.log('     - tokens (30%), execution (25%), plugins (20%), workflow (15%), memory (10%)');
  console.log('  2. CREATION SCORE = calculated during agent design');
  console.log('  3. COMBINED SCORE = creation (30%) + execution (70%)');
  console.log('     - Uses creation score only until 5+ executions');
  console.log('     - Then blends using these combined weights ☝️');
}

initializeCombinedWeights().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
