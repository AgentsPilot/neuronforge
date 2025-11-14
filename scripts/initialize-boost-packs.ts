// scripts/initialize-boost-packs.ts
// Initialize boost packs in database based on minimum subscription amount

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function initializeBoostPacks() {
  console.log('🚀 Initializing boost packs...\n');

  try {
    // Get pricing config
    const { data: configData } = await supabase
      .from('ais_system_config')
      .select('config_key, config_value')
      .in('config_key', ['pilot_credit_cost_usd', 'min_subscription_usd'])
      .limit(2);

    const configMap = new Map(configData?.map(c => [c.config_key, c.config_value]) || []);
    const pricePerCredit = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');
    const minSubscriptionUsd = parseFloat(configMap.get('min_subscription_usd') || '10.00');

    console.log('📊 Pricing Configuration:');
    console.log('   Price per credit:', pricePerCredit);
    console.log('   Min subscription:', `$${minSubscriptionUsd}`);

    // Calculate minimum credits
    const minCredits = Math.ceil(minSubscriptionUsd / pricePerCredit);
    console.log('   Min credits:', minCredits.toLocaleString());

    // Define boost packs with fixed prices and bonus percentages
    // Credits are calculated from price_usd / pilot_credit_cost_usd
    // Bonus is calculated from bonus_percentage
    const boostPacks = [
      {
        pack_key: 'boost_quick',
        pack_name: 'Quick Boost',
        display_name: 'Quick Boost',
        description: 'Perfect for a quick credit refill',
        price_usd: 5.00, // Fixed price
        bonus_percentage: 0, // No bonus
        badge_text: null,
        is_active: true
      },
      {
        pack_key: 'boost_power',
        pack_name: 'Power Boost',
        display_name: 'Power Boost',
        description: 'Great value with bonus credits',
        price_usd: 10.00, // Fixed price
        bonus_percentage: 10, // 10% bonus
        badge_text: 'POPULAR',
        is_active: true
      },
      {
        pack_key: 'boost_mega',
        pack_name: 'Mega Boost',
        display_name: 'Mega Boost',
        description: 'Maximum credits with best bonus',
        price_usd: 20.00, // Fixed price
        bonus_percentage: 15, // 15% bonus
        badge_text: 'BEST VALUE',
        is_active: true
      }
    ];

    console.log('\n📦 Boost Packs to Create:\n');

    // Calculate credits_amount and bonus_credits for each pack
    const packsWithCalculatedCredits = boostPacks.map(pack => {
      const baseCredits = Math.round(pack.price_usd / pricePerCredit);
      const bonusCredits = Math.round(baseCredits * (pack.bonus_percentage / 100));
      const totalCredits = baseCredits + bonusCredits;

      console.log(`${pack.pack_name}:`);
      console.log(`   Key: ${pack.pack_key}`);
      console.log(`   Price: $${pack.price_usd.toFixed(2)}`);
      console.log(`   Bonus %: ${pack.bonus_percentage}%`);
      console.log(`   Base Credits: ${baseCredits.toLocaleString()}`);
      console.log(`   Bonus Credits: ${bonusCredits.toLocaleString()}`);
      console.log(`   Total Credits: ${totalCredits.toLocaleString()}`);
      console.log(`   Badge: ${pack.badge_text || 'None'}`);
      console.log('');

      return {
        ...pack,
        credits_amount: baseCredits,
        bonus_credits: bonusCredits
      };
    });

    // Upsert boost packs with calculated credits
    const { data, error } = await supabase
      .from('boost_packs')
      .upsert(packsWithCalculatedCredits, {
        onConflict: 'pack_key'
      })
      .select();

    if (error) {
      console.error('❌ Error upserting boost packs:', error);
      return;
    }

    console.log('✅ Successfully initialized boost packs!');
    console.log(`   Created/updated ${data.length} boost packs\n`);

    // Display created packs with IDs
    console.log('📋 Boost Pack IDs:');
    data.forEach(pack => {
      console.log(`   ${pack.pack_name}: ${pack.id}`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

initializeBoostPacks().then(() => process.exit(0));
