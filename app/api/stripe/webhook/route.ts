// app/api/stripe/webhook/route.ts
// Stripe webhook handler - processes payment events and updates database

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getStripeService } from '@/lib/stripe/StripeService';
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';
import { QuotaAllocationService } from '@/lib/services/QuotaAllocationService';
import Stripe from 'stripe';

// Disable body parsing for webhook signature verification
export const runtime = 'nodejs';

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

/**
 * Handle invoice.paid event
 * - Award credits to user
 * - Record invoice in database
 * - Create credit transaction
 */
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  console.log('🎯 [Webhook] Processing invoice.paid:', invoice.id);

  let userId = invoice.metadata?.user_id;
  let pilotCredits = parseInt(invoice.metadata?.credits || '0');

  // If metadata not in invoice, fetch from subscription
  const invoiceSubscription = (invoice as any).subscription;
  if (!userId) {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY!);

    // Try to get subscription from invoice.subscription field
    if (invoiceSubscription) {
      console.log('📋 [Webhook] Fetching metadata from invoice.subscription:', invoiceSubscription);
      const subscription = await stripe.subscriptions.retrieve(invoiceSubscription as string);
      userId = subscription.metadata?.user_id;
      pilotCredits = parseInt(subscription.metadata?.credits || '0');
      console.log('✅ [Webhook] Found metadata in subscription:', { userId, pilotCredits });
    }
    // If still no userId, try getting subscription from customer
    else if (invoice.customer) {
      console.log('📋 [Webhook] Invoice has no subscription field, looking up by customer:', invoice.customer);
      const subscriptions = await stripe.subscriptions.list({
        customer: invoice.customer as string,
        limit: 1
      });

      if (subscriptions.data.length > 0) {
        const subscription = subscriptions.data[0];
        userId = subscription.metadata?.user_id;
        pilotCredits = parseInt(subscription.metadata?.credits || subscription.metadata?.pilot_credits || '0');
        console.log('✅ [Webhook] Found metadata from customer subscription:', { userId, pilotCredits });
      }
    }
  }

  if (!userId) {
    console.error('❌ [Webhook] No user_id in invoice or subscription metadata');
    return;
  }

  // Check if this is a prorated invoice (subscription upgrade/downgrade mid-cycle)
  // Proration is detected by:
  // 1. Multiple line items (typically one negative for unused time, one positive for new subscription)
  // 2. Line item descriptions containing "Unused time" or "Remaining time"
  const hasMultipleItems = invoice.lines.data.length > 1;
  const hasProrationDescriptions = invoice.lines.data.some(line =>
    line.description?.includes('Unused time') ||
    line.description?.includes('Remaining time')
  );
  const hasProration = hasMultipleItems && hasProrationDescriptions;

  if (hasProration) {
    console.log('🔄 [Webhook] Prorated invoice detected - calculating prorated credits');
    console.log('📦 Line items:', invoice.lines.data.map(l => ({ desc: l.description, amount: l.amount })));

    // For prorated invoices, calculate credits based on amount paid
    // Get pricing config to convert amount to credits
    const { data: configData } = await supabaseAdmin
      .from('ais_system_config')
      .select('pilot_credit_cost_usd')
      .single();

    const pilotCreditCostUsd = configData?.pilot_credit_cost_usd || 0.00048;
    const amountPaidUsd = invoice.amount_paid / 100; // Convert cents to USD

    // Calculate prorated Pilot Credits from amount paid
    pilotCredits = Math.floor(amountPaidUsd / pilotCreditCostUsd);

    console.log(`💰 [Webhook] Prorated calculation: $${amountPaidUsd.toFixed(2)} ÷ $${pilotCreditCostUsd} = ${pilotCredits} Pilot Credits`);
  }

  // Convert Pilot Credits to tokens for storage (fetched from database)
  const credits = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

  console.log(`💰 Converting ${pilotCredits} Pilot Credits → ${credits} tokens`);

  // Get current user balance
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('balance, total_earned')
    .eq('user_id', userId)
    .single();

  const currentBalance = userSub?.balance || 0;
  const currentTotalEarned = userSub?.total_earned || 0;
  const newBalance = currentBalance + credits;
  const newTotalEarned = currentTotalEarned + credits;

  // Update user subscription balance
  const periodStart = invoice.lines?.data[0]?.period?.start;
  const periodEnd = invoice.lines?.data[0]?.period?.end;

  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      balance: newBalance,
      total_earned: newTotalEarned,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      last_payment_attempt: new Date().toISOString(),
      payment_retry_count: 0, // Reset on successful payment
      status: 'active',
      agents_paused: false
    })
    .eq('user_id', userId);

  // Create credit transaction
  const { error: txError } = await supabaseAdmin
    .from('credit_transactions')
    .insert({
      user_id: userId,
      credits_delta: credits,
      balance_before: currentBalance,
      balance_after: newBalance,
      transaction_type: 'allocation',
      activity_type: hasProration ? 'subscription_upgrade' : 'subscription_renewal',
      description: hasProration
        ? `Subscription upgrade (prorated): ${credits.toLocaleString()} credits`
        : `Monthly credit allocation: ${credits.toLocaleString()} credits`,
      metadata: {
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: (invoice as any).payment_intent,
        amount_paid_cents: invoice.amount_paid,
        is_prorated: hasProration,
        period_start: invoice.lines?.data[0]?.period?.start ? new Date(invoice.lines.data[0].period.start * 1000).toISOString() : new Date().toISOString(),
        period_end: invoice.lines?.data[0]?.period?.end ? new Date(invoice.lines.data[0].period.end * 1000).toISOString() : new Date().toISOString()
      }
    });

  if (txError) {
    console.error('❌ [Webhook] Failed to create credit transaction:', txError);
  } else {
    console.log('✅ [Webhook] Credit transaction created successfully');
  }

  // Record invoice in database
  await supabaseAdmin
    .from('subscription_invoices')
    .insert({
      user_id: userId,
      stripe_invoice_id: invoice.id,
      stripe_invoice_pdf: invoice.invoice_pdf || null,
      stripe_hosted_invoice_url: invoice.hosted_invoice_url || null,
      stripe_payment_intent_id: (invoice as any).payment_intent || null,
      invoice_number: invoice.number || `INV-${Date.now()}`,
      amount_due: (invoice.amount_due / 100).toFixed(2),
      amount_paid: (invoice.amount_paid / 100).toFixed(2),
      status: 'paid',
      credits_allocated: credits,
      invoice_date: new Date(invoice.created * 1000).toISOString(),
      due_date: invoice.due_date ? new Date(invoice.due_date * 1000).toISOString() : null,
      paid_at: new Date().toISOString(),
      period_start: invoice.lines?.data[0]?.period?.start ? new Date(invoice.lines.data[0].period.start * 1000).toISOString() : new Date().toISOString(),
      period_end: invoice.lines?.data[0]?.period?.end ? new Date(invoice.lines.data[0].period.end * 1000).toISOString() : new Date().toISOString(),
      metadata: {
        stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id,
        stripe_subscription_id: (invoice as any).subscription,
        line_items: invoice.lines.data.map(line => ({
          description: line.description,
          amount: line.amount,
          quantity: line.quantity
        }))
      }
    });

  // Log billing event
  const { error: billingError } = await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: hasProration ? 'subscription_upgraded' : 'renewal_success',
      credits_delta: credits,
      description: hasProration
        ? `Subscription upgraded (prorated): ${credits.toLocaleString()} credits awarded`
        : `Subscription renewed: ${credits.toLocaleString()} credits awarded`,
      stripe_event_id: invoice.id,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_paid,
      currency: invoice.currency
    });

  if (billingError) {
    console.error('❌ [Webhook] Failed to create billing event:', billingError);
  } else {
    console.log('✅ [Webhook] Billing event created successfully');
  }

  console.log('✅ [Webhook] Invoice processed successfully:', {
    userId,
    credits,
    newBalance
  });

  // Allocate storage and execution quotas based on new balance
  try {
    const quotaService = new QuotaAllocationService(supabaseAdmin);
    const quotaResult = await quotaService.allocateQuotasForUser(userId);

    if (quotaResult.success) {
      console.log(`✅ [Webhook] Quotas allocated: ${quotaResult.storageQuotaMB} MB storage, ${quotaResult.executionQuota ?? 'unlimited'} executions`);
    } else {
      console.error('❌ [Webhook] Failed to allocate quotas:', quotaResult.error);
    }
  } catch (quotaError: any) {
    console.error('❌ [Webhook] Error allocating quotas (non-critical):', quotaError.message);
  }
}

/**
 * Handle invoice.payment_failed event
 * - Increment retry count
 * - Check grace period
 * - Pause agents if grace period exceeded
 */
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log('⚠️ [Webhook] Processing invoice.payment_failed:', invoice.id);

  const userId = invoice.metadata?.user_id;

  if (!userId) {
    console.error('❌ [Webhook] No user_id in invoice metadata');
    return;
  }

  // Get user subscription
  const { data: userSub } = await supabaseAdmin
    .from('user_subscriptions')
    .select('payment_retry_count, grace_period_days, current_period_end')
    .eq('user_id', userId)
    .single();

  const retryCount = (userSub?.payment_retry_count || 0) + 1;

  // Fetch grace period from system config if not set per-user
  let gracePeriodDays = userSub?.grace_period_days;

  if (!gracePeriodDays) {
    // Fetch default from system_settings_config
    const { data: configData } = await supabaseAdmin
      .from('system_settings_config')
      .select('value')
      .eq('key', 'payment_grace_period_days')
      .maybeSingle();

    gracePeriodDays = configData ? parseInt(configData.value as string) : 3;
  }

  // Calculate if grace period is exceeded
  const periodEnd = userSub?.current_period_end ? new Date(userSub.current_period_end) : new Date();
  const daysSincePeriodEnd = Math.floor((Date.now() - periodEnd.getTime()) / (1000 * 60 * 60 * 24));
  const shouldPauseAgents = daysSincePeriodEnd > gracePeriodDays;

  // Update user subscription
  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      payment_retry_count: retryCount,
      last_payment_attempt: new Date().toISOString(),
      status: shouldPauseAgents ? 'past_due' : 'active',
      agents_paused: shouldPauseAgents
    })
    .eq('user_id', userId);

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'renewal_failed',
      credits_delta: 0,
      description: `Payment failed (attempt ${retryCount}). ${shouldPauseAgents ? 'Agents paused due to grace period exceeded.' : `Grace period active (${gracePeriodDays} days).`}`,
      stripe_event_id: invoice.id,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_due,
      currency: invoice.currency
    });

  console.log('✅ [Webhook] Payment failure processed:', {
    userId,
    retryCount,
    shouldPauseAgents,
    daysSincePeriodEnd,
    gracePeriodDays
  });

  // TODO: Send email notification to user about payment failure
}

/**
 * Handle checkout.session.completed event
 * - For boost packs: apply credits immediately
 * - For subscriptions: record subscription details
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('🎉 [Webhook] Processing checkout.session.completed:', session.id);

  const userId = session.metadata?.user_id;
  const purchaseType = session.metadata?.purchase_type;

  if (!userId) {
    console.error('❌ [Webhook] No user_id in session metadata');
    return;
  }

  if (session.mode === 'payment' && purchaseType === 'boost_pack') {
    // One-time boost pack purchase
    const pilotCredits = parseInt(session.metadata?.credits || '0');
    const boostPackId = session.metadata?.boost_pack_id;

    // Convert Pilot Credits to tokens for storage (fetched from database)
    const credits = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

    console.log(`💰 Converting ${pilotCredits} Pilot Credits → ${credits} tokens`);

    // Get current balance
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('balance, total_earned')
      .eq('user_id', userId)
      .single();

    const currentBalance = userSub?.balance || 0;
    const currentTotalEarned = userSub?.total_earned || 0;
    const newBalance = currentBalance + credits;
    const newTotalEarned = currentTotalEarned + credits;

    // Update balance
    await supabaseAdmin
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned
      })
      .eq('user_id', userId);

    // Create credit transaction
    await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: credits,
        balance_before: currentBalance,
        balance_after: newBalance,
        transaction_type: 'allocation',
        activity_type: 'boost_pack_purchase',
        description: `Boost pack purchase: ${credits.toLocaleString()} credits`,
        metadata: {
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
          boost_pack_id: boostPackId,
          amount_paid_cents: session.amount_total
        }
      });

    // Record boost pack purchase
    if (boostPackId) {
      await supabaseAdmin
        .from('boost_pack_purchases')
        .insert({
          user_id: userId,
          boost_pack_id: boostPackId,
          credits_purchased: credits,
          bonus_credits: 0, // Bonus already included in credits
          price_paid_usd: ((session.amount_total || 0) / 100).toFixed(2), // Convert cents to USD
          stripe_payment_intent_id: session.payment_intent as string,
          payment_status: 'succeeded'
        });
    }

    console.log('✅ [Webhook] Boost pack processed:', {
      userId,
      credits,
      newBalance
    });

    // Allocate storage and execution quotas based on new balance
    try {
      const quotaService = new QuotaAllocationService(supabaseAdmin);
      const quotaResult = await quotaService.allocateQuotasForUser(userId);

      if (quotaResult.success) {
        console.log(`✅ [Webhook] Quotas allocated: ${quotaResult.storageQuotaMB} MB storage, ${quotaResult.executionQuota ?? 'unlimited'} executions`);
      } else {
        console.error('❌ [Webhook] Failed to allocate quotas:', quotaResult.error);
      }
    } catch (quotaError: any) {
      console.error('❌ [Webhook] Error allocating quotas (non-critical):', quotaError.message);
    }

  } else if (session.mode === 'subscription') {
    // Subscription created - allocate initial credits and update subscription IDs
    const pilotCredits = parseInt(session.metadata?.credits || '0');

    if (!pilotCredits) {
      console.error('❌ [Webhook] No credits in session metadata for subscription');
      return;
    }

    // Convert Pilot Credits to tokens for storage (fetched from database)
    const credits = await pilotCreditsToTokens(pilotCredits, supabaseAdmin);

    console.log(`💰 Converting ${pilotCredits} Pilot Credits → ${credits} tokens`);

    // Get current balance
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('balance, total_earned')
      .eq('user_id', userId)
      .single();

    const currentBalance = userSub?.balance || 0;
    const currentTotalEarned = userSub?.total_earned || 0;
    const newBalance = currentBalance + credits;
    const newTotalEarned = currentTotalEarned + credits;

    // Calculate monthly amount from credits
    const { data: configData } = await supabaseAdmin
      .from('ais_system_config')
      .select('pilot_credit_cost_usd')
      .single();

    const pilotCreditCostUsd = configData?.pilot_credit_cost_usd || 0.00048;
    const monthlyAmountUsd = pilotCredits * pilotCreditCostUsd;

    // Update subscription with IDs, initial balance, and monthly amounts
    const { error: updateError } = await supabaseAdmin
      .from('user_subscriptions')
      .update({
        stripe_subscription_id: session.subscription as string,
        stripe_customer_id: session.customer as string,
        status: 'active',
        balance: newBalance,
        total_earned: newTotalEarned,
        monthly_credits: pilotCredits,
        monthly_amount_usd: monthlyAmountUsd
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('❌ [Webhook] Failed to update subscription:', updateError);
    } else {
      console.log('✅ [Webhook] Subscription updated successfully with monthly_credits:', pilotCredits);
    }

    // Create credit transaction for initial subscription
    const { error: txError } = await supabaseAdmin
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: credits,
        balance_before: currentBalance,
        balance_after: newBalance,
        transaction_type: 'allocation',
        activity_type: 'subscription_created',
        description: `Initial subscription: ${credits.toLocaleString()} credits`,
        metadata: {
          stripe_session_id: session.id,
          stripe_subscription_id: session.subscription,
          amount_paid_cents: session.amount_total
        }
      });

    if (txError) {
      console.error('❌ [Webhook] Failed to create credit transaction:', txError);
    } else {
      console.log('✅ [Webhook] Credit transaction created successfully');
    }

    // Log billing event
    const { error: billingError } = await supabaseAdmin
      .from('billing_events')
      .insert({
        user_id: userId,
        event_type: 'subscription_created',
        credits_delta: credits,
        description: `Subscription created: ${credits.toLocaleString()} credits awarded`,
        stripe_event_id: session.id,
        amount_cents: session.amount_total,
        currency: 'usd'
      });

    if (billingError) {
      console.error('❌ [Webhook] Failed to create billing event:', billingError);
    } else {
      console.log('✅ [Webhook] Billing event created successfully');
    }

    console.log('✅ [Webhook] Subscription checkout completed:', {
      userId,
      subscriptionId: session.subscription,
      credits,
      newBalance
    });

    // Allocate storage and execution quotas based on new balance
    try {
      const quotaService = new QuotaAllocationService(supabaseAdmin);
      const quotaResult = await quotaService.allocateQuotasForUser(userId);

      if (quotaResult.success) {
        console.log(`✅ [Webhook] Quotas allocated: ${quotaResult.storageQuotaMB} MB storage, ${quotaResult.executionQuota ?? 'unlimited'} executions`);
      } else {
        console.error('❌ [Webhook] Failed to allocate quotas:', quotaResult.error);
      }
    } catch (quotaError: any) {
      console.error('❌ [Webhook] Error allocating quotas (non-critical):', quotaError.message);
    }
  }
}

/**
 * Handle customer.subscription.updated event
 * - Sync subscription amount and credits when changed in Stripe
 * - Update monthly_credits and monthly_amount_usd in database
 */
async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  console.log('🔄 [Webhook] Processing customer.subscription.updated:', subscription.id);

  const userId = subscription.metadata?.user_id;

  if (!userId) {
    console.error('❌ [Webhook] No user_id in subscription metadata');
    return;
  }

  // Get credits from metadata (try both 'credits' and 'pilot_credits')
  const pilotCredits = parseInt(subscription.metadata?.credits || subscription.metadata?.pilot_credits || '0');

  if (!pilotCredits) {
    console.error('❌ [Webhook] No credits in subscription metadata');
    return;
  }

  // Get subscription amount from Stripe
  const stripeAmountCents = subscription.items.data[0]?.price?.unit_amount || 0;
  const stripeAmountUsd = stripeAmountCents / 100;

  console.log(`💰 [Webhook] Syncing subscription: ${pilotCredits.toLocaleString()} Pilot Credits, $${stripeAmountUsd.toFixed(2)}`);

  // Update database including cancellation status
  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      monthly_credits: pilotCredits,
      monthly_amount_usd: stripeAmountUsd,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      status: subscription.status
    })
    .eq('user_id', userId);

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'subscription_updated',
      credits_delta: 0,
      description: `Subscription updated: ${pilotCredits.toLocaleString()} Pilot Credits/month ($${stripeAmountUsd.toFixed(2)})`,
      amount_cents: stripeAmountCents,
      currency: 'usd'
    });

  console.log('✅ [Webhook] Subscription updated:', { userId, pilotCredits, stripeAmountUsd });
}

/**
 * Handle customer.subscription.deleted event
 * - Mark subscription as canceled
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('❌ [Webhook] Processing customer.subscription.deleted:', subscription.id);

  const userId = subscription.metadata?.user_id;

  if (!userId) {
    console.error('❌ [Webhook] No user_id in subscription metadata');
    return;
  }

  await supabaseAdmin
    .from('user_subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      cancel_at_period_end: false
    })
    .eq('user_id', userId);

  // Log billing event
  await supabaseAdmin
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'subscription_canceled',
      credits_delta: 0,
      description: 'Subscription canceled'
    });

  console.log('✅ [Webhook] Subscription canceled:', { userId });
}

/**
 * Main webhook handler
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    // Verify webhook signature
    const stripeService = getStripeService();
    const event = stripeService.constructWebhookEvent(body, signature, webhookSecret);

    console.log('📥 [Webhook] Received event:', event.type);

    // Process event based on type
    switch (event.type) {
      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log('ℹ️ [Webhook] Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('❌ [Webhook] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 400 }
    );
  }
}
