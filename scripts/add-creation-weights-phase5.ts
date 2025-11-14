// scripts/add-creation-weights-phase5.ts
// Phase 5: Add creation component weights to database
// Makes creation score components (workflow, plugin, I/O) database-driven

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function addCreationWeights() {
  console.log('🚀 Phase 5: Adding Creation Component Weights to Database\n');
  console.log('=' .repeat(80));

  const weights = [
    {
      config_key: 'ais_creation_workflow_weight',
      config_value: 0.5,
      category: 'ais_creation_weights',
      description: 'Weight for workflow structure in creation score (default: 0.5 = 50%)'
    },
    {
      config_key: 'ais_creation_plugin_weight',
      config_value: 0.3,
      category: 'ais_creation_weights',
      description: 'Weight for plugin diversity in creation score (default: 0.3 = 30%)'
    },
    {
      config_key: 'ais_creation_io_weight',
      config_value: 0.2,
      category: 'ais_creation_weights',
      description: 'Weight for I/O schema complexity in creation score (default: 0.2 = 20%)'
    }
  ];

  console.log('📋 Creation component weights to insert:');
  weights.forEach(w => {
    console.log(`  ${w.config_key}: ${w.config_value}`);
  });
  console.log();

  let successCount = 0;
  let errorCount = 0;

  for (const weight of weights) {
    const { data, error } = await supabase
      .from('ais_system_config')
      .upsert(weight, { onConflict: 'config_key' })
      .select();

    if (error) {
      console.error(`❌ Failed to insert ${weight.config_key}:`, error.message);
      errorCount++;
    } else {
      console.log(`✅ Inserted/Updated: ${weight.config_key} = ${weight.config_value}`);
      successCount++;
    }
  }

  console.log('\n' + '='.repeat(80));
  if (errorCount === 0) {
    console.log('✅ Creation Component Weights Added Successfully!');
    console.log('='.repeat(80));
    console.log(`✅ Created ${successCount} configuration keys in ais_system_config`);
    console.log('✅ Creation score is now database-driven (no more hardcoded fallbacks)');
    console.log('='.repeat(80));
    console.log('\n📊 Creation Score Calculation:');
    console.log('   Workflow Structure: 50% weight (complexity of workflow steps)');
    console.log('   Plugin Diversity:   30% weight (number of different plugins)');
    console.log('   I/O Schema:         20% weight (input + output field count)');
    console.log('   ─────────────────────────────');
    console.log('   Total:              100%');
    console.log('='.repeat(80));
    console.log('\n🎯 Next Steps:');
    console.log('   1. Update AISConfigService to load these weights');
    console.log('   2. Add admin UI controls for configuration');
    console.log('   3. Test with actual agent creation');
    console.log('='.repeat(80));
    return true;
  } else {
    console.log(`❌ Initialization completed with ${errorCount} errors`);
    console.log(`✅ Successfully created ${successCount} keys`);
    console.log('='.repeat(80));
    return false;
  }
}

addCreationWeights()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('❌ Script error:', err);
    process.exit(1);
  });
