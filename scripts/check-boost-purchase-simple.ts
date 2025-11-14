// Simple script to check boost pack purchase status
// Run with: npx tsx scripts/check-boost-purchase-simple.ts

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkBoostPurchase() {
  console.log('\n🔍 Checking Boost Pack Purchase Status\n');
  console.log('='.repeat(60));

  try {
    // 1. Check all boost pack purchases (regardless of user)
    console.log('\n1️⃣ All Boost Pack Purchases:');
    const { data: allPurchases, error: purchasesError } = await supabase
      .from('boost_pack_purchases')
      .select('*')
      .order('purchased_at', { ascending: false })
      .limit(10);

    if (purchasesError) {
      console.log('❌ Error querying purchases:', purchasesError.message);
    } else if (!allPurchases || allPurchases.length === 0) {
      console.log('❌ No boost pack purchases found in database');
      console.log('   This table is completely empty!');
    } else {
      console.log(`✅ Found ${allPurchases.length} purchase(s):`);
      allPurchases.forEach((p, i) => {
        console.log(`\n   Purchase #${i + 1}:`);
        console.log(`   - User ID: ${p.user_id}`);
        console.log(`   - Boost Pack ID: ${p.boost_pack_id}`);
        console.log(`   - Credits: ${p.credits_purchased.toLocaleString()}`);
        console.log(`   - Price: $${p.price_paid_usd}`);
        console.log(`   - Status: ${p.payment_status}`);
        console.log(`   - Date: ${p.purchased_at}`);
        console.log(`   - Stripe PI: ${p.stripe_payment_intent_id}`);
      });
    }

    // 2. Check all credit transactions (especially boost pack purchases)
    console.log('\n\n2️⃣ Recent Credit Transactions (boost_pack_purchase type):');
    const { data: boostTransactions, error: txError } = await supabase
      .from('credit_transactions')
      .select('*')
      .eq('activity_type', 'boost_pack_purchase')
      .order('created_at', { ascending: false })
      .limit(10);

    if (txError) {
      console.log('❌ Error querying transactions:', txError.message);
    } else if (!boostTransactions || boostTransactions.length === 0) {
      console.log('❌ No boost pack purchase transactions found');
      console.log('   No boost pack purchases have been processed yet');
    } else {
      console.log(`✅ Found ${boostTransactions.length} boost pack transaction(s):`);
      boostTransactions.forEach((tx, i) => {
        console.log(`\n   Transaction #${i + 1}:`);
        console.log(`   - User ID: ${tx.user_id}`);
        console.log(`   - Credits Delta: +${tx.credits_delta.toLocaleString()} tokens`);
        console.log(`   - Balance After: ${tx.balance_after.toLocaleString()} tokens`);
        console.log(`   - Description: ${tx.description}`);
        console.log(`   - Date: ${tx.created_at}`);
        if (tx.metadata) {
          console.log(`   - Metadata:`, JSON.stringify(tx.metadata, null, 2));
        }
      });
    }

    // 3. Check active boost packs
    console.log('\n\n3️⃣ Active Boost Packs Configuration:');
    const { data: boostPacks, error: packsError } = await supabase
      .from('boost_packs')
      .select('*')
      .eq('is_active', true)
      .order('price_usd', { ascending: true });

    if (packsError) {
      console.log('❌ Error querying boost packs:', packsError.message);
    } else if (!boostPacks || boostPacks.length === 0) {
      console.log('❌ No active boost packs found');
    } else {
      console.log(`✅ Found ${boostPacks.length} active boost pack(s):\n`);
      boostPacks.forEach(pack => {
        const total = pack.credits_amount + pack.bonus_credits;
        console.log(`   ${pack.pack_name} ($${pack.price_usd}):`);
        console.log(`   - Pack ID: ${pack.id}`);
        console.log(`   - Base Credits: ${pack.credits_amount.toLocaleString()}`);
        console.log(`   - Bonus Credits: ${pack.bonus_credits.toLocaleString()} (${pack.bonus_percentage}%)`);
        console.log(`   - Total: ${total.toLocaleString()}`);
        console.log('');
      });
    }

    // 4. Check for any users with subscriptions
    console.log('\n4️⃣ Users with Subscriptions:');
    const { data: subscriptions, error: subError } = await supabase
      .from('user_subscriptions')
      .select('user_id, status, balance, total_earned, monthly_credits')
      .order('created_at', { ascending: false })
      .limit(5);

    if (subError) {
      console.log('❌ Error querying subscriptions:', subError.message);
    } else if (!subscriptions || subscriptions.length === 0) {
      console.log('❌ No user subscriptions found');
    } else {
      console.log(`✅ Found ${subscriptions.length} subscription(s):\n`);
      subscriptions.forEach((sub, i) => {
        console.log(`   User #${i + 1}:`);
        console.log(`   - User ID: ${sub.user_id}`);
        console.log(`   - Status: ${sub.status}`);
        console.log(`   - Balance: ${sub.balance.toLocaleString()} tokens`);
        console.log(`   - Total Earned: ${sub.total_earned.toLocaleString()} tokens`);
        console.log(`   - Monthly Credits: ${sub.monthly_credits} Pilot Credits`);
        console.log('');
      });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📋 DIAGNOSIS:\n');

    const hasPurchases = allPurchases && allPurchases.length > 0;
    const hasTransactions = boostTransactions && boostTransactions.length > 0;
    const hasPacks = boostPacks && boostPacks.length > 0;

    if (!hasPurchases && !hasTransactions) {
      console.log('❌ CRITICAL ISSUE: No boost pack purchases or transactions found');
      console.log('\n   This means either:');
      console.log('   1. No boost pack purchase has been attempted yet');
      console.log('   2. The Stripe webhook is not firing');
      console.log('   3. The Stripe webhook is failing silently');
      console.log('\n   Next steps:');
      console.log('   → Check Stripe Dashboard for recent payments');
      console.log('   → Check Stripe Dashboard → Webhooks for events');
      console.log('   → Verify STRIPE_WEBHOOK_SECRET in .env');
      console.log('   → Check application logs for webhook errors');
    } else if (hasTransactions && !hasPurchases) {
      console.log('⚠️  PARTIAL ISSUE: Credits were added but no purchase record');
      console.log('\n   This means:');
      console.log('   - The webhook IS processing payments');
      console.log('   - Credits ARE being added to user balance');
      console.log('   - But the boost_pack_purchases insert is failing');
      console.log('\n   Next steps:');
      console.log('   → Check if boost_pack_id is in Stripe session metadata');
      console.log('   → Check webhook logs for database insert errors');
      console.log('   → Verify foreign key constraint on boost_pack_id');
    } else if (hasPurchases) {
      console.log('✅ System is working correctly!');
      console.log('   Boost pack purchases are being recorded properly.');
    }

    if (!hasPacks) {
      console.log('\n❌ WARNING: No active boost packs configured');
      console.log('   Run: npx tsx scripts/initialize-boost-packs.ts');
    }

    console.log('\n📖 For detailed debugging, see: docs/DEBUG_BOOST_PACK_PURCHASE.md\n');

  } catch (error: any) {
    console.error('\n❌ Unexpected error:', error.message);
    console.error(error);
  }
}

checkBoostPurchase();
