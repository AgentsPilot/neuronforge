// scripts/initialize-model-routing-config.ts
// Initialize model routing configuration in database (Phase 3 Refactoring)
// Makes model selection database-driven instead of hardcoded

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function initializeModelRoutingConfig() {
  console.log('🚀 Initializing Model Routing Configuration (Phase 3)...\n');

  // Store model routing as a single JSON config (like pilot_routing_complexity_thresholds)
  const modelRoutingConfig = {
    low: {
      model: 'gpt-4o-mini',
      provider: 'openai'
    },
    medium: {
      model: 'claude-3-5-haiku-20241022',
      provider: 'anthropic'
    },
    high: {
      model: 'gpt-4o',
      provider: 'openai'
    }
  };

  console.log('📋 Model routing configuration to insert:');
  console.log(JSON.stringify(modelRoutingConfig, null, 2));
  console.log();

  let successCount = 0;
  let errorCount = 0;

  const { data, error } = await supabase
    .from('ais_system_config')
    .upsert({
      config_key: 'ais_model_routing_config',
      config_value: JSON.stringify(modelRoutingConfig),
      description: 'Model routing configuration for low/medium/high complexity agents'
    }, { onConflict: 'config_key' })
    .select();

  if (error) {
    console.error(`❌ Failed to insert ais_model_routing_config:`, error.message);
    errorCount++;
  } else {
    console.log(`✅ Inserted/Updated: ais_model_routing_config`);
    successCount++;
  }

  console.log('\n' + '='.repeat(80));
  if (errorCount === 0) {
    console.log('✅ Model Routing Configuration Initialized Successfully!');
    console.log('='.repeat(80));
    console.log(`✅ Created ${successCount} configuration keys in ais_system_config`);
    console.log('✅ Models are now database-driven (no more hardcoded DEFAULT_CONFIG)');
    console.log('✅ Admin UI can now update model routing configuration');
    console.log('='.repeat(80));
    console.log('\n📊 Current Model Routing Setup:');
    console.log('   Low Complexity (0-4):   gpt-4o-mini (OpenAI)');
    console.log('   Medium Complexity (4-7): claude-3-5-haiku-20241022 (Anthropic)');
    console.log('   High Complexity (7-10):  gpt-4o (OpenAI)');
    console.log('='.repeat(80));
    return true;
  } else {
    console.log(`❌ Initialization completed with ${errorCount} errors`);
    console.log(`✅ Successfully created ${successCount} keys`);
    console.log('='.repeat(80));
    return false;
  }
}

initializeModelRoutingConfig()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('❌ Script error:', err);
    process.exit(1);
  });
