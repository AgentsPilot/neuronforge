// scripts/sync-stripe-subscription.ts
// Sync subscription from Stripe to database

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

async function syncSubscription() {
  const subscriptionId = 'sub_1SQGHL56GTXD0wwiWkWTts2a'; // Latest subscription - 1,000 Pilot Credits
  const userId = '08456106-aa50-4810-b12c-7ca84102da31';

  console.log('🔄 Syncing subscription from Stripe...');
  console.log('Subscription ID:', subscriptionId);
  console.log('User ID:', userId);

  // Get subscription from Stripe
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  console.log('\n📋 Subscription Details:');
  console.log('Status:', subscription.status);
  console.log('Customer:', subscription.customer);
  console.log('Metadata:', subscription.metadata);

  const periodStart = (subscription as any).current_period_start;
  const periodEnd = (subscription as any).current_period_end;

  if (periodStart && periodEnd) {
    console.log('Current period:', {
      start: new Date(periodStart * 1000).toISOString(),
      end: new Date(periodEnd * 1000).toISOString()
    });
  }

  const pilotCredits = parseInt(subscription.metadata?.credits || '0');
  const tokens = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

  console.log(`\n💰 Converting ${pilotCredits} Pilot Credits → ${tokens} tokens`);

  // Get current balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  console.log('\n📊 Current State:');
  console.log('Balance:', userSub?.balance, 'tokens =', (userSub?.balance || 0) / 10, 'Pilot Credits');
  console.log('Total earned:', userSub?.total_earned, 'tokens');

  const currentBalance = userSub?.balance || 0;
  const currentTotalEarned = userSub?.total_earned || 0;
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
  const amountUsd = latestInvoice ? (latestInvoice.amount_paid / 100) : 10; // Default to $10 if no invoice

  console.log('\n💳 Latest Invoice:');
  console.log('ID:', latestInvoice?.id);
  console.log('Amount:', amountUsd, 'USD');
  console.log('Status:', latestInvoice?.status);
  console.log('Note: Using', amountUsd, 'USD for monthly_amount_usd');

  // Update database
  console.log('\n🔄 Updating database...');

  //  Just update balance and subscription IDs, don't touch monthly_amount_usd (constraint issues)
  const { data: updateData, error: updateError } = await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned,
      stripe_subscription_id: subscriptionId,
      stripe_customer_id: subscription.customer as string,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      last_payment_attempt: new Date().toISOString(),
      payment_retry_count: 0,
      status: 'active',
      agents_paused: false
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('❌ Error updating subscription:', updateError);
    throw updateError;
  }

  console.log('✅ Subscription updated:', updateData);

  // Create credit transaction
  await supabaseAdmin
    .from('credit_transactions')
    .insert({
      user_id: userId,
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
      user_id: userId,
      event_type: 'renewal_success',
      credits_delta: tokens,
      description: `Subscription synced: ${tokens.toLocaleString()} tokens (${pilotCredits.toLocaleString()} Pilot Credits) awarded`,
      stripe_event_id: subscriptionId,
      amount_cents: latestInvoice?.amount_paid || 0,
      currency: latestInvoice?.currency || 'usd'
    });

  console.log('\n✅ Subscription synced successfully!');
  console.log('\nVerify with: npx ts-node scripts/check-subscription-details.ts');
}

syncSubscription().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
