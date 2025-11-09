// scripts/reset-stripe-subscription.ts
// Reset user's Stripe subscription and database state for clean testing
// Run with: npx tsx scripts/reset-stripe-subscription.ts <user-email>

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

async function resetSubscription(userEmail: string) {

  console.log('🔍 Finding user...');
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find((u: any) => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    return;
  }

  console.log('✅ Found user:', user.id);

  // Get current subscription data
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single();

  console.log('\n📊 Current State:');
  console.log('Balance:', userSub?.balance, 'tokens =', (userSub?.balance || 0) / 10, 'Pilot Credits');
  console.log('Monthly credits:', userSub?.monthly_credits || 'None');
  console.log('Stripe Customer:', userSub?.stripe_customer_id || 'None');
  console.log('Stripe Subscription:', userSub?.stripe_subscription_id || 'None');

  // Get counts for cleanup
  const { data: transactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('*')
    .eq('user_id', user.id);

  const { data: boostPurchases } = await supabaseAdmin
    .from('boost_pack_purchases')
    .select('*')
    .eq('user_id', user.id);

  const { data: billingEvents } = await supabaseAdmin
    .from('billing_events')
    .select('*')
    .eq('user_id', user.id);

  console.log('Credit Transactions:', transactions?.length || 0);
  console.log('Boost Purchases:', boostPurchases?.length || 0);
  console.log('Billing Events:', billingEvents?.length || 0);

  // Cancel Stripe subscription if exists
  if (userSub?.stripe_subscription_id) {
    console.log('\n🔄 Canceling Stripe subscription...');
    try {
      await stripe.subscriptions.cancel(userSub.stripe_subscription_id);
      console.log('✅ Stripe subscription canceled');
    } catch (error: any) {
      console.error('⚠️  Error canceling subscription:', error.message);
      console.log('   (This is OK if subscription was already canceled)');
    }
  }

  // Delete all transactions
  console.log('\n🧹 Cleaning up database...');

  console.log('Deleting credit transactions...');
  await supabaseAdmin
    .from('credit_transactions')
    .delete()
    .eq('user_id', user.id);
  console.log(`✅ Deleted ${transactions?.length || 0} transaction(s)`);

  console.log('Deleting boost pack purchases...');
  await supabaseAdmin
    .from('boost_pack_purchases')
    .delete()
    .eq('user_id', user.id);
  console.log(`✅ Deleted ${boostPurchases?.length || 0} boost purchase(s)`);

  console.log('Deleting billing events...');
  await supabaseAdmin
    .from('billing_events')
    .delete()
    .eq('user_id', user.id);
  console.log(`✅ Deleted ${billingEvents?.length || 0} billing event(s)`);

  // Reset database to initial state (zero balance for clean testing)
  console.log('\n🔄 Resetting user subscription to zero state...');

  // Database constraints require monthly_amount_usd >= 10 and monthly_credits >= 1000
  // when stripe_subscription_id is not null OR status is active/past_due
  // For a truly clean state, we set status to 'canceled' and clear subscription ID
  const { error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: 0,
      total_earned: 0,
      total_spent: 0,
      stripe_subscription_id: null, // This allows us to set monthly values to 0
      current_period_start: null,
      current_period_end: null,
      canceled_at: new Date().toISOString(),
      cancel_at_period_end: false,
      last_payment_attempt: null,
      payment_retry_count: 0,
      agents_paused: false,
      status: 'canceled'
    })
    .eq('user_id', user.id);

  // After clearing subscription ID, we can set monthly values to 0
  if (!updateError) {
    await supabaseAdmin
      .from('user_subscriptions')
      .update({
        monthly_credits: 0,
        monthly_amount_usd: 0
      })
      .eq('user_id', user.id);
  }

  if (updateError) {
    console.error('❌ Error resetting database:', updateError);
    return;
  }

  console.log('✅ Database reset complete');

  // Show final state
  const { data: finalSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .single();

  console.log('\n🎯 Final State:');
  console.log('Balance:', finalSub?.balance, 'tokens =', (finalSub?.balance || 0) / 10, 'Pilot Credits');
  console.log('Monthly Credits:', finalSub?.monthly_credits || 0, 'Pilot Credits');
  console.log('Monthly Amount USD: $' + (finalSub?.monthly_amount_usd || 0));
  console.log('Stripe Customer:', finalSub?.stripe_customer_id || 'Preserved');
  console.log('Stripe Subscription:', finalSub?.stripe_subscription_id || 'None');
  console.log('Status:', finalSub?.status);

  console.log('\n' + '='.repeat(60));
  console.log('\n✅ CLEANUP COMPLETE! Ready for clean testing.\n');
  console.log('What was cleaned:');
  console.log('  ✓ All credit transactions deleted');
  console.log('  ✓ All boost pack purchases deleted');
  console.log('  ✓ All billing events deleted');
  console.log('  ✓ Stripe subscription canceled (if existed)');
  console.log('  ✓ Balance reset to 0');
  console.log('  ✓ Monthly credits reset to 0');
  console.log('  ✓ Status set to inactive');
  console.log('\nWhat was preserved:');
  console.log('  ✓ Stripe customer ID (for future subscriptions)');
  console.log('  ✓ User account and profile');

  console.log('\n📝 Test Scenarios You Can Now Run:');
  console.log('\n1️⃣ NEW SUBSCRIPTION:');
  console.log('   • Go to: http://localhost:3000/settings?tab=billing');
  console.log('   • Use calculator to select amount (e.g., 2,000 Pilot Credits)');
  console.log('   • Click "Start Subscription"');
  console.log('   • Complete payment with: 4242 4242 4242 4242');
  console.log('   • Verify: Balance updated, monthly credits shown');

  console.log('\n2️⃣ UPDATE SUBSCRIPTION:');
  console.log('   • After creating subscription above');
  console.log('   • Change amount in calculator (e.g., 5,000 Pilot Credits)');
  console.log('   • Click "Update Subscription"');
  console.log('   • Verify: New amount shown (takes effect next cycle)');

  console.log('\n3️⃣ BOOST PACK PURCHASE:');
  console.log('   • Go to boost packs section');
  console.log('   • Click "Buy Now" on any pack');
  console.log('   • Complete payment with: 4242 4242 4242 4242');
  console.log('   • Verify: Balance increased immediately');

  console.log('\n4️⃣ WEBHOOK TESTING:');
  console.log('   • All above actions should trigger webhooks');
  console.log('   • Check application logs for webhook processing');
  console.log('   • Verify billing_events table for audit trail\n');
}

// Get user email from command line
const userEmail = process.argv[2];

if (!userEmail) {
  console.log('\n❌ Usage: npx tsx scripts/reset-stripe-subscription.ts <user-email>');
  console.log('\nExample:');
  console.log('npx tsx scripts/reset-stripe-subscription.ts offir.omer@gmail.com\n');
  process.exit(1);
}

resetSubscription(userEmail).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
