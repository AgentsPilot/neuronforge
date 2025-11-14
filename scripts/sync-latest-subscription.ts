// scripts/sync-latest-subscription.ts
// Automatically finds and syncs the latest active subscription

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

// Inline helper function
async function pilotCreditsToTokens(credits: number, supabase: any): Promise<number> {
  const { data } = await supabase
    .from('ais_system_config')
    .select('config_value')
    .eq('config_key', 'tokens_per_pilot_credit')
    .single();

  const tokensPerCredit = data ? parseInt(data.config_value) : 10;
  return credits * tokensPerCredit;
}

async function syncLatestSubscription() {
  const userEmail = 'offir.omer@gmail.com';

  console.log('🔍 Finding user...');
  const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
  const user = authData.users.find((u: any) => u.email === userEmail);

  if (!user) {
    console.error('❌ User not found');
    process.exit(1);
  }

  console.log('✅ Found user:', user.id);

  // Get user's subscription data
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('stripe_customer_id, balance, total_earned')
    .eq('user_id', user.id)
    .single();

  if (!userSub?.stripe_customer_id) {
    console.error('❌ No Stripe customer found');
    process.exit(1);
  }

  console.log('✅ Stripe Customer:', userSub.stripe_customer_id);

  // Find all subscriptions for this customer (any status)
  console.log('\n🔍 Searching for subscriptions...');
  const subscriptions = await stripe.subscriptions.list({
    customer: userSub.stripe_customer_id,
    limit: 10
  });

  console.log('📋 All subscriptions:', subscriptions.data.map(s => ({ id: s.id, status: s.status })));

  // Filter for active or trialing subscriptions
  const activeSubscriptions = subscriptions.data.filter(s =>
    s.status === 'active' || s.status === 'trialing'
  );

  if (activeSubscriptions.length === 0) {
    console.log('❌ No active or trialing subscriptions found');
    console.log('💡 Try canceling old subscriptions in Stripe dashboard and creating a new one');
    process.exit(1);
  }

  console.log(`✅ Found ${activeSubscriptions.length} active/trialing subscription(s)`);

  // Use the latest active subscription
  const latestSubscription = activeSubscriptions[0];

  const subscriptionId = latestSubscription.id;

  console.log('\n📋 Latest Subscription:');
  console.log('ID:', subscriptionId);
  console.log('Status:', latestSubscription.status);
  console.log('Customer:', latestSubscription.customer);
  console.log('Metadata:', latestSubscription.metadata);

  const periodStart = (latestSubscription as any).current_period_start;
  const periodEnd = (latestSubscription as any).current_period_end;

  if (periodStart && periodEnd) {
    console.log('Current period:', {
      start: new Date(periodStart * 1000).toISOString(),
      end: new Date(periodEnd * 1000).toISOString()
    });
  }

  const pilotCredits = parseInt(latestSubscription.metadata?.credits || '0');

  if (pilotCredits === 0) {
    console.error('❌ No credits found in subscription metadata');
    process.exit(1);
  }

  const tokens = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

  console.log(`\n💰 Converting ${pilotCredits} Pilot Credits → ${tokens} tokens`);

  // Calculate monthly amount in USD
  const { data: costConfigData } = await supabaseAdmin
    .from('ais_system_config')
    .select('config_value')
    .eq('config_key', 'pilot_credit_cost_usd')
    .single();

  const pilotCreditCostUsd = costConfigData ? parseFloat(costConfigData.config_value) : 0.00048;
  const monthlyAmountUsd = pilotCredits * pilotCreditCostUsd;

  console.log(`💵 Monthly amount: ${pilotCredits} credits × $${pilotCreditCostUsd} = $${monthlyAmountUsd}`);

  // Get current balance
  console.log('\n📊 Current State:');
  console.log('Balance:', userSub.balance, 'tokens =', (userSub.balance || 0) / 10, 'Pilot Credits');
  console.log('Total earned:', userSub.total_earned, 'tokens');

  const currentBalance = userSub.balance || 0;
  const currentTotalEarned = userSub.total_earned || 0;
  const newBalance = currentBalance + tokens;
  const newTotalEarned = currentTotalEarned + tokens;

  console.log('\n🎯 New State:');
  console.log('Balance:', newBalance, 'tokens =', newBalance / 10, 'Pilot Credits');
  console.log('Total earned:', newTotalEarned, 'tokens');

  // Get latest invoice for amount
  const invoices = await stripe.invoices.list({
    subscription: subscriptionId,
    limit: 1
  });

  const latestInvoice = invoices.data[0];
  const amountUsd = latestInvoice ? (latestInvoice.amount_paid / 100) : 0;

  console.log('\n💳 Latest Invoice:');
  console.log('ID:', latestInvoice?.id);
  console.log('Amount:', amountUsd, 'USD');
  console.log('Status:', latestInvoice?.status);

  // Update database
  console.log('\n🔄 Updating database...');

  const { error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned,
      monthly_amount_usd: monthlyAmountUsd,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: latestSubscription.customer as string,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      last_payment_attempt: new Date().toISOString(),
      payment_retry_count: 0,
      status: 'active',
      agents_paused: false
    })
    .eq('user_id', user.id);

  if (updateError) {
    console.error('❌ Error updating subscription:', updateError);
    throw updateError;
  }

  console.log('✅ Subscription updated');

  // Create credit transaction
  await supabaseAdmin
    .from('credit_transactions')
    .insert({
      user_id: user.id,
      credits_delta: tokens,
      balance_before: currentBalance,
      balance_after: newBalance,
      transaction_type: 'allocation',
      activity_type: 'subscription_renewal',
      description: `Monthly credit allocation: ${tokens.toLocaleString()} tokens (${pilotCredits.toLocaleString()} Pilot Credits)`,
      metadata: {
        stripe_subscription_id: subscriptionId,
        stripe_invoice_id: latestInvoice?.id,
        amount_paid_cents: latestInvoice?.amount_paid,
        manual_sync: true
      }
    });

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: user.id,
      event_type: 'renewal_success',
      credits_delta: tokens,
      description: `Subscription synced: ${tokens.toLocaleString()} tokens (${pilotCredits.toLocaleString()} Pilot Credits) awarded`,
      stripe_event_id: subscriptionId,
      amount_cents: latestInvoice?.amount_paid || 0,
      currency: latestInvoice?.currency || 'usd'
    });

  console.log('\n✅ Subscription synced successfully!');
  console.log('\n📝 Verify with: npx ts-node scripts/check-subscription-details.ts');
}

syncLatestSubscription().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
