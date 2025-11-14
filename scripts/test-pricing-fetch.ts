// scripts/test-pricing-fetch.ts
// Test fetching pricing configuration exactly as BillingSettings does

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testPricingFetch() {
  console.log('🔍 Testing pricing config fetch (same as BillingSettings.tsx)...\n');

  // Fetch pricing config exactly as BillingSettings does
  const { data: configData, error: configError } = await supabase
    .from('ais_system_config')
    .select('config_key, config_value')
    .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

  if (configError) {
    console.error('❌ Error fetching pricing config:', configError);
    return;
  }

  console.log('📊 Fetched pricing config:', configData);
  console.log('');

  if (!configData || configData.length === 0) {
    console.log('⚠️  No data returned!');
    console.log('   This means the anon key does not have SELECT permission on ais_system_config table.');
    console.log('   Need to add RLS policy or use service role key.');
    return;
  }

  const configMap = new Map(configData.map((c: any) => [c.config_key, c.config_value]));

  console.log('🗺️  Config Map:');
  configMap.forEach((value, key) => {
    console.log(`   ${key}: ${value} (type: ${typeof value})`);
  });
  console.log('');

  const pilotCreditCost = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');
  const tokensPerCredit = parseInt(configMap.get('tokens_per_pilot_credit') || '10');

  console.log('💰 Parsed pricing:');
  console.log(`   pilot_credit_cost_usd: $${pilotCreditCost.toFixed(5)}`);
  console.log(`   tokens_per_pilot_credit: ${tokensPerCredit}`);
  console.log('');

  if (pilotCreditCost === 0) {
    console.log('❌ PROBLEM: Price is $0.00!');
    console.log('   This will show as $0.00 in the UI.');
    console.log('');
    console.log('   Possible causes:');
    console.log('   1. config_value in database is not "0.00048"');
    console.log('   2. parseFloat() is failing to parse the value');
    console.log('   3. configMap.get() is returning undefined');
  } else {
    console.log('✅ Price fetched correctly!');
    console.log(`   100,000 Pilot Credits = $${(100000 * pilotCreditCost).toFixed(2)}`);
  }
}

testPricingFetch();
