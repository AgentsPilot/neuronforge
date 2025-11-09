// scripts/check-creation-weights-db.ts
// Check if creation component weights exist in database

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkCreationWeightsInDB() {
  console.log('🔍 Checking for Creation Component Weights in Database\n');
  console.log('='.repeat(80));

  // Check ais_system_config table for creation weights
  const { data: configData, error: configError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, description, category')
    .or('config_key.ilike.%creation%weight%,config_key.ilike.%workflow%,config_key.ilike.%plugin%,config_key.ilike.%io_schema%')
    .order('config_key');

  console.log('\n📊 Search Results in ais_system_config table:');
  console.log('-'.repeat(80));

  if (configError) {
    console.error('❌ Error querying database:', configError.message);
  } else if (!configData || configData.length === 0) {
    console.log('❌ NO creation component weights found in ais_system_config');
    console.log('   These weights are currently HARDCODED in the code.');
  } else {
    console.log(`✅ Found ${configData.length} matching records:\n`);
    configData.forEach(row => {
      console.log(`  Key: ${row.config_key}`);
      console.log(`  Value: ${row.config_value}`);
      console.log(`  Category: ${row.category || 'N/A'}`);
      console.log(`  Description: ${row.description || 'N/A'}`);
      console.log('-'.repeat(80));
    });
  }

  // Specifically check for the keys we expect
  console.log('\n🎯 Checking for Specific Expected Keys:');
  console.log('-'.repeat(80));

  const expectedKeys = [
    'ais_creation_workflow_weight',
    'ais_creation_plugin_weight',
    'ais_creation_io_weight',
    'ais_combined_creation_weight',
    'ais_combined_execution_weight'
  ];

  for (const key of expectedKeys) {
    const { data: keyData } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .eq('config_key', key)
      .single();

    if (keyData) {
      console.log(`  ✅ ${key}: ${keyData.config_value}`);
    } else {
      console.log(`  ❌ ${key}: NOT FOUND`);
    }
  }

  // Also check what creation-related keys DO exist
  console.log('\n📋 All Creation-Related Keys in Database:');
  console.log('-'.repeat(80));

  const { data: allCreationKeys } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, category')
    .ilike('config_key', '%creation%')
    .order('config_key');

  if (allCreationKeys && allCreationKeys.length > 0) {
    allCreationKeys.forEach(row => {
      console.log(`  ${row.config_key}: ${row.config_value} (category: ${row.category || 'N/A'})`);
    });
  } else {
    console.log('  ❌ No creation-related keys found');
  }

  console.log('\n' + '='.repeat(80));
  console.log('Summary:');
  console.log('='.repeat(80));
  console.log('Expected creation component weights: 3');
  console.log('  - ais_creation_workflow_weight (should be 0.5)');
  console.log('  - ais_creation_plugin_weight (should be 0.3)');
  console.log('  - ais_creation_io_weight (should be 0.2)');
  console.log('\nThese control how creation score is calculated from:');
  console.log('  - Workflow Structure (50% weight)');
  console.log('  - Plugin Diversity (30% weight)');
  console.log('  - I/O Schema Complexity (20% weight)');
  console.log('='.repeat(80));
}

checkCreationWeightsInDB()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Script error:', err);
    process.exit(1);
  });
