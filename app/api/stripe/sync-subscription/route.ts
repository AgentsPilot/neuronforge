// app/api/stripe/sync-subscription/route.ts
// Manual subscription sync endpoint - fallback for when webhooks are delayed

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

// Create admin Supabase client (bypasses RLS)
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

export async function POST(request: NextRequest) {
  try {
    // Create Supabase client
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    console.log('🔄 [Sync] Manual subscription sync requested for user:', user.id);

    // Get user's Stripe customer ID
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_customer_id, balance, total_earned')
      .eq('user_id', user.id)
      .single();

    if (!userSub?.stripe_customer_id) {
      console.log('⚠️  [Sync] No Stripe customer found for user');
      return NextResponse.json(
        { error: 'No Stripe customer found' },
        { status: 404 }
      );
    }

    // Get all active/trialing subscriptions for this customer
    const allSubscriptions = await stripe.subscriptions.list({
      customer: userSub.stripe_customer_id,
      limit: 10
    });

    // Filter for active or trialing subscriptions
    const subscriptions = {
      data: allSubscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing')
    };

    console.log('📋 [Sync] Found', subscriptions.data.length, 'active subscriptions');

    if (subscriptions.data.length === 0) {
      console.log('⚠️  [Sync] No active subscriptions found');
      return NextResponse.json({ message: 'No active subscriptions found' });
    }

    // Get the latest subscription
    const latestSubscription = subscriptions.data[0];
    const subscriptionId = latestSubscription.id;

    console.log('🎯 [Sync] Processing subscription:', subscriptionId);
    console.log('📝 [Sync] Metadata:', latestSubscription.metadata);

    // Check if this subscription is already synced
    const { data: existingSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_subscription_id, balance')
      .eq('user_id', user.id)
      .single();

    if (existingSub?.stripe_subscription_id === subscriptionId) {
      console.log('✅ [Sync] Subscription already synced');
      return NextResponse.json({ message: 'Subscription already synced', alreadySynced: true });
    }

    // Get pilot credits from metadata
    const pilotCredits = parseInt(latestSubscription.metadata?.credits || '0');

    if (pilotCredits === 0) {
      console.log('⚠️  [Sync] No credits in subscription metadata');
      return NextResponse.json({ error: 'Invalid subscription metadata' }, { status: 400 });
    }

    // Convert to tokens
    const tokens = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

    console.log(`💰 [Sync] Converting ${pilotCredits} Pilot Credits → ${tokens} tokens`);

    // Calculate monthly amount in USD
    const { data: costConfigData } = await supabaseAdmin
      .from('ais_system_config')
      .select('config_value')
      .eq('config_key', 'pilot_credit_cost_usd')
      .single();

    const pilotCreditCostUsd = costConfigData ? parseFloat(costConfigData.config_value) : 0.00048;
    const monthlyAmountUsd = pilotCredits * pilotCreditCostUsd;

    console.log(`💵 [Sync] Monthly amount: ${pilotCredits} credits × $${pilotCreditCostUsd} = $${monthlyAmountUsd}`);

    // Calculate new balances
    const currentBalance = userSub.balance || 0;
    const currentTotalEarned = userSub.total_earned || 0;
    const newBalance = currentBalance + tokens;
    const newTotalEarned = currentTotalEarned + tokens;

    console.log('📊 [Sync] Balance update:', currentBalance, '→', newBalance);

    // Get subscription period from subscription items (Stripe stores dates there)
    const firstItem = (latestSubscription as any).items?.data?.[0];
    const periodStart = firstItem?.current_period_start;
    const periodEnd = firstItem?.current_period_end;

    // Update database
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
      console.error('❌ [Sync] Database update failed:', updateError);
      throw updateError;
    }

    // Get latest invoice
    const invoices = await stripe.invoices.list({
      subscription: subscriptionId,
      limit: 1
    });

    const latestInvoice = invoices.data[0];

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
          manual_sync: true,
          sync_trigger: 'checkout_complete'
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

    console.log('✅ [Sync] Subscription synced successfully!');

    return NextResponse.json({
      success: true,
      subscriptionId,
      pilotCredits,
      tokens,
      newBalance: newBalance / 10, // Return in Pilot Credits
      message: 'Subscription synced successfully'
    });

  } catch (error: any) {
    console.error('❌ [Sync] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Sync failed' },
      { status: 500 }
    );
  }
}
