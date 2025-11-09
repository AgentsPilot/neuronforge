// scripts/add-tokens-per-credit-config.ts
// Add tokens_per_pilot_credit configuration to ais_system_config table

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function addTokensPerCreditConfig() {
  console.log('🔧 Adding tokens_per_pilot_credit configuration...\n');

  // Check if it already exists
  const { data: existing } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .eq('config_key', 'tokens_per_pilot_credit')
    .maybeSingle();

  if (existing) {
    console.log('✅ Configuration already exists:');
    console.log(`   tokens_per_pilot_credit = ${existing.config_value}`);
    return;
  }

  // Insert the configuration
  const { error } = await supabase
    .from('ais_system_config')
    .insert({
      config_key: 'tokens_per_pilot_credit',
      config_value: '10',
      category: 'pricing',
      description: 'Number of LLM tokens that 1 Pilot Credit represents. Used for token-to-credit conversion in CreditService.chargeForExecution() and chargeForCreation().',
      unit: 'tokens',
      min_value: '1',
      max_value: '100'
    });

  if (error) {
    console.error('❌ Error adding configuration:', error);
    process.exit(1);
  }

  console.log('✅ Successfully added tokens_per_pilot_credit configuration');
  console.log('   config_key: tokens_per_pilot_credit');
  console.log('   config_value: 10');
  console.log('   category: pricing');
  console.log('\n📊 Current pricing configuration:');

  // Show all pricing configs
  const { data: pricingConfigs } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, description')
    .eq('category', 'pricing')
    .order('config_key');

  pricingConfigs?.forEach((config: any) => {
    console.log(`\n   ${config.config_key}: ${config.config_value}`);
    console.log(`   └─ ${config.description}`);
  });
}

addTokensPerCreditConfig();
