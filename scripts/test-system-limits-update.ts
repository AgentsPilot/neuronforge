// Test script to verify system limits update functionality
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function testSystemLimitsUpdate() {
  console.log('🧪 [Test] Starting system limits update test...\n');

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const configKeys = ['min_agent_intensity', 'max_agent_intensity', 'min_executions_for_score'];

  // Step 1: Check if rows exist
  console.log('📋 Step 1: Checking if system limit rows exist...');
  for (const key of configKeys) {
    const { data, error } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value, description')
      .eq('config_key', key)
      .single();

    if (error) {
      console.error(`❌ Error checking ${key}:`, error);
    } else if (data) {
      console.log(`✅ Found ${key}:`, data);
    } else {
      console.log(`⚠️ Row for ${key} not found`);
    }
  }

  console.log('\n📋 Step 2: Attempting to update min_agent_intensity...');
  const testValue = '0.5';
  const { data: updateData, error: updateError } = await supabase
    .from('ais_system_config')
    .update({ config_value: testValue })
    .eq('config_key', 'min_agent_intensity')
    .select();

  if (updateError) {
    console.error('❌ Update failed:', updateError);
  } else {
    console.log('✅ Update successful. Returned data:', updateData);
  }

  console.log('\n📋 Step 3: Verifying the update...');
  const { data: verifyData, error: verifyError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .eq('config_key', 'min_agent_intensity')
    .single();

  if (verifyError) {
    console.error('❌ Verification failed:', verifyError);
  } else {
    console.log('✅ Current value after update:', verifyData);
  }

  console.log('\n📋 Step 4: Checking table schema...');
  const { data: schemaData, error: schemaError } = await supabase
    .from('ais_system_config')
    .select('*')
    .limit(1);

  if (schemaError) {
    console.log('⚠️ Could not check schema:', schemaError.message);
  } else {
    console.log('✅ Table accessible, sample row columns:', schemaData?.[0] ? Object.keys(schemaData[0]) : 'No data');
  }

  console.log('\n📋 Step 5: Testing batch update like the API does...');
  const testLimits = {
    minAgentIntensity: 0.0,
    maxAgentIntensity: 10.0,
    minExecutionsForScore: 5
  };

  const configMap: Record<string, string> = {
    minAgentIntensity: 'min_agent_intensity',
    maxAgentIntensity: 'max_agent_intensity',
    minExecutionsForScore: 'min_executions_for_score'
  };

  for (const [key, value] of Object.entries(testLimits)) {
    const dbKey = configMap[key];
    console.log(`\n  🔄 Updating ${dbKey} = ${value}`);

    const { data, error } = await supabase
      .from('ais_system_config')
      .update({ config_value: String(value) })
      .eq('config_key', dbKey)
      .select();

    if (error) {
      console.error(`  ❌ Failed to update ${dbKey}:`, error);
    } else {
      console.log(`  ✅ Successfully updated ${dbKey}:`, data);
    }
  }

  console.log('\n✅ Test completed!');
}

testSystemLimitsUpdate().catch(console.error);
