// scripts/manually-process-invoice.ts
// Manually process the invoice to award credits

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

// Inline pilotCreditsToTokens function
async function pilotCreditsToTokens(credits: number, supabase: any): Promise<number> {
  const { data } = await supabase
    .from('ais_system_config')
    .select('config_value')
    .eq('config_key', 'tokens_per_pilot_credit')
    .single();

  const tokensPerCredit = data ? parseInt(data.config_value) : 10;
  return credits * tokensPerCredit;
}

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

async function processInvoice() {
  const invoiceId = 'in_1SQFLY56GTXD0wwicooEjXNO';
  const userId = '08456106-aa50-4810-b12c-7ca84102da31';
  const pilotCredits = 10000; // 10,000 Pilot Credits

  console.log('🔄 Manually processing invoice:', invoiceId);
  console.log('User ID:', userId);
  console.log('Pilot Credits:', pilotCredits);

  // Get invoice from Stripe
  const invoice = await stripe.invoices.retrieve(invoiceId) as any;
  console.log('\n📄 Invoice Details:');
  console.log('Status:', invoice.status);
  console.log('Amount paid:', invoice.amount_paid, 'cents');
  console.log('Subscription:', invoice.subscription);

  // Get subscription to extract metadata
  if (invoice.subscription) {
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
    console.log('\n📋 Subscription Metadata:');
    console.log('User ID:', subscription.metadata?.user_id);
    console.log('Credits:', subscription.metadata?.credits);
  }

  // Convert Pilot Credits to tokens
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

  // Update user subscription
  const periodStart = (invoice.lines?.data[0]?.period as any)?.start;
  const periodEnd = (invoice.lines?.data[0]?.period as any)?.end;

  console.log('\n🔄 Updating database...');

  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned,
      monthly_pilot_credits: tokens,
      stripe_subscription_id: invoice.subscription as string,
      stripe_customer_id: invoice.customer as string,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      last_payment_attempt: new Date().toISOString(),
      payment_retry_count: 0,
      status: 'active',
      agents_paused: false
    })
    .eq('user_id', userId);

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
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: invoice.payment_intent,
        amount_paid_cents: invoice.amount_paid,
        period_start: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
        period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
        manual_processing: true
      }
    });

  // Record invoice in database
  await supabaseAdmin
    .from('subscription_invoices')
    .insert({
      user_id: userId,
      invoice_number: invoice.number || `INV-${invoice.id}`,
      stripe_invoice_id: invoice.id,
      stripe_subscription_id: invoice.subscription as string,
      amount_paid: (invoice.amount_paid / 100).toFixed(2),
      currency: invoice.currency,
      credits_allocated: tokens,
      status: invoice.status || 'paid',
      invoice_date: new Date(invoice.created * 1000).toISOString(),
      period_start: periodStart ? new Date(periodStart * 1000).toISOString() : new Date().toISOString(),
      period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString()
    });

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'renewal_success',
      credits_delta: tokens,
      description: `Subscription renewed: ${tokens.toLocaleString()} tokens (${pilotCredits.toLocaleString()} Pilot Credits) awarded`,
      stripe_event_id: invoice.id,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency
    });

  console.log('\n✅ Invoice processed successfully!');
  console.log('\nVerify with: npx ts-node scripts/check-subscription-details.ts');
}

processInvoice().then(() => {
  console.log('\n✅ Done!');
  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
