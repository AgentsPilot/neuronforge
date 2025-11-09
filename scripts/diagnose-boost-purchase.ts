// Script to diagnose boost pack purchase issues
// Run with: npx tsx scripts/diagnose-boost-purchase.ts <user-email>

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnoseBoostPurchase(userEmail: string) {
  console.log('\n🔍 BOOST PACK PURCHASE DIAGNOSTIC\n');
  console.log('='.repeat(60));

  try {
    // 1. Get user ID from email
    console.log('\n1️⃣ Looking up user...');
    const { data: { users }, error: userError } = await supabase.auth.admin.listUsers();

    const userData = users?.find(u => u.email === userEmail);

    if (userError || !userData) {
      console.log('❌ User not found:', userEmail);
      return;
    }

    const userId = userData.id;
    console.log(`✅ Found user: ${userData.email}`);
    console.log(`   User ID: ${userId}`);

    // 2. Check user subscription status
    console.log('\n2️⃣ Checking subscription status...');
    const { data: subData } = await supabase
      .from('user_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (subData) {
      console.log(`✅ Subscription found`);
      console.log(`   Status: ${subData.status}`);
      console.log(`   Balance: ${subData.balance.toLocaleString()} tokens`);
      console.log(`   Total Earned: ${subData.total_earned.toLocaleString()} tokens`);
      console.log(`   Monthly Credits: ${subData.monthly_credits} Pilot Credits`);
    } else {
      console.log('⚠️  No subscription found');
    }

    // 3. Check boost packs configuration
    console.log('\n3️⃣ Checking boost packs configuration...');
    const { data: boostPacks } = await supabase
      .from('boost_packs')
      .select('*')
      .eq('is_active', true)
      .order('price_usd', { ascending: true });

    if (boostPacks && boostPacks.length > 0) {
      console.log(`✅ Found ${boostPacks.length} active boost pack(s):`);
      boostPacks.forEach(pack => {
        const totalCredits = pack.credits_amount + pack.bonus_credits;
        console.log(`   • ${pack.pack_name} ($${pack.price_usd})`);
        console.log(`     - Base: ${pack.credits_amount.toLocaleString()} credits`);
        console.log(`     - Bonus: ${pack.bonus_credits.toLocaleString()} credits (${pack.bonus_percentage}%)`);
        console.log(`     - Total: ${totalCredits.toLocaleString()} credits`);
        console.log(`     - Pack ID: ${pack.id}`);
      });
    } else {
      console.log('❌ No active boost packs found');
    }

    // 4. Check recent credit transactions
    console.log('\n4️⃣ Checking recent credit transactions...');
    const { data: transactions } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    if (transactions && transactions.length > 0) {
      console.log(`✅ Found ${transactions.length} recent transaction(s):`);
      transactions.forEach(tx => {
        const sign = tx.credits_delta > 0 ? '+' : '';
        console.log(`   • ${tx.created_at}: ${tx.activity_type}`);
        console.log(`     - Delta: ${sign}${tx.credits_delta.toLocaleString()} tokens`);
        console.log(`     - Balance After: ${tx.balance_after.toLocaleString()} tokens`);
        console.log(`     - Description: ${tx.description}`);
        if (tx.metadata) {
          console.log(`     - Metadata: ${JSON.stringify(tx.metadata)}`);
        }
      });
    } else {
      console.log('⚠️  No credit transactions found');
    }

    // 5. Check boost pack purchases
    console.log('\n5️⃣ Checking boost pack purchases...');
    const { data: purchases } = await supabase
      .from('boost_pack_purchases')
      .select(`
        *,
        boost_packs (
          pack_name,
          pack_key
        )
      `)
      .eq('user_id', userId)
      .order('purchased_at', { ascending: false })
      .limit(5);

    if (purchases && purchases.length > 0) {
      console.log(`✅ Found ${purchases.length} boost pack purchase(s):`);
      purchases.forEach(purchase => {
        console.log(`   • ${purchase.purchased_at}: ${purchase.boost_packs?.pack_name}`);
        console.log(`     - Credits: ${purchase.credits_purchased.toLocaleString()} tokens`);
        console.log(`     - Bonus: ${purchase.bonus_credits.toLocaleString()} tokens`);
        console.log(`     - Price Paid: $${purchase.price_paid_usd}`);
        console.log(`     - Status: ${purchase.payment_status}`);
        console.log(`     - Stripe Payment Intent: ${purchase.stripe_payment_intent_id}`);
      });
    } else {
      console.log('❌ No boost pack purchases found');
      console.log('   ⚠️  This is the issue! User purchased but no record exists.');
    }

    // 6. Check AIS system config (for pilot credit cost)
    console.log('\n6️⃣ Checking AIS system configuration...');
    const { data: aisConfig } = await supabase
      .from('ais_system_config')
      .select('pilot_credit_cost_usd')
      .single();

    if (aisConfig) {
      console.log(`✅ Pilot Credit Cost: $${aisConfig.pilot_credit_cost_usd}`);
      console.log(`   (1 credit = ${(1 / aisConfig.pilot_credit_cost_usd).toFixed(0)} tokens)`);
    } else {
      console.log('⚠️  AIS system config not found');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📋 SUMMARY\n');

    const hasSub = subData && subData.status === 'active';
    const hasBoostPacks = boostPacks && boostPacks.length > 0;
    const hasPurchases = purchases && purchases.length > 0;
    const hasTransactions = transactions && transactions.length > 0;

    console.log(`Subscription Active: ${hasSub ? '✅ YES' : '❌ NO'}`);
    console.log(`Active Boost Packs: ${hasBoostPacks ? '✅ YES' : '❌ NO'}`);
    console.log(`Purchase Records: ${hasPurchases ? '✅ YES' : '❌ NO'}`);
    console.log(`Credit Transactions: ${hasTransactions ? '✅ YES' : '❌ NO'}`);

    if (!hasPurchases && hasTransactions) {
      console.log('\n⚠️  ISSUE DETECTED:');
      console.log('   Credit transactions exist but no boost pack purchase records.');
      console.log('   This suggests the webhook is updating credits but not creating');
      console.log('   the boost_pack_purchases record.');
      console.log('\n💡 NEXT STEPS:');
      console.log('   1. Check Stripe Dashboard for recent payments');
      console.log('   2. Verify webhook events show "checkout.session.completed"');
      console.log('   3. Check webhook logs for any errors');
      console.log('   4. Verify boost_pack_id is in Stripe session metadata');
    } else if (!hasPurchases && !hasTransactions) {
      console.log('\n⚠️  ISSUE DETECTED:');
      console.log('   No purchase records or credit transactions found.');
      console.log('   This suggests the webhook may not be firing or processing correctly.');
      console.log('\n💡 NEXT STEPS:');
      console.log('   1. Check if payment appears in Stripe Dashboard');
      console.log('   2. Check if webhook endpoint is configured in Stripe');
      console.log('   3. Verify STRIPE_WEBHOOK_SECRET is correct in .env');
      console.log('   4. Check application logs for webhook errors');
    }

    console.log('\n📖 For detailed debugging steps, see:');
    console.log('   docs/DEBUG_BOOST_PACK_PURCHASE.md\n');

  } catch (error: any) {
    console.error('\n❌ Error during diagnosis:', error.message);
  }
}

// Get user email from command line argument
const userEmail = process.argv[2];

if (!userEmail) {
  console.log('\n❌ Usage: npx tsx scripts/diagnose-boost-purchase.ts <user-email>\n');
  process.exit(1);
}

diagnoseBoostPurchase(userEmail);
