// Check quota tier configuration in database
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkQuotaConfig() {
  console.log('🔍 Checking Storage Tier Configuration...\n');

  const { data: storageTiers, error: storageError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, description')
    .like('config_key', 'storage_tokens_%')
    .order('config_key', { ascending: true });

  if (storageError) {
    console.error('❌ Error fetching storage tiers:', storageError);
  } else {
    console.log('📦 Storage Tiers:');
    console.table(storageTiers);
  }

  console.log('\n🔍 Checking Execution Tier Configuration...\n');

  const { data: executionTiers, error: executionError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value, description')
    .like('config_key', 'executions_tokens_%')
    .order('config_key', { ascending: true });

  if (executionError) {
    console.error('❌ Error fetching execution tiers:', executionError);
  } else {
    console.log('⚡ Execution Tiers:');
    console.table(executionTiers);
  }

  console.log('\n🔍 Checking User Subscription Data...\n');

  const { data: userSub, error: userError } = await supabase
    .from('user_subscriptions')
    .select('user_id, balance, total_earned, total_spent, storage_quota_mb, executions_quota, monthly_credits')
    .limit(5);

  if (userError) {
    console.error('❌ Error fetching user subscriptions:', userError);
  } else {
    console.log('👥 User Subscriptions (first 5):');
    console.table(userSub);
  }

  console.log('\n🔍 Checking tokens_per_pilot_credit configuration...\n');

  const { data: pricingConfig, error: pricingError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .eq('config_key', 'tokens_per_pilot_credit')
    .single();

  if (pricingError) {
    console.error('❌ Error fetching pricing config:', pricingError);
  } else {
    console.log('💰 Pricing Config:');
    console.log(`  tokens_per_pilot_credit = ${pricingConfig.config_value}`);
  }

  process.exit(0);
}

checkQuotaConfig();
