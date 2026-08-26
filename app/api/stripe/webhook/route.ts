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

    try {
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
    } catch (stripeError: any) {
      // This can happen if the customer/subscription doesn't exist in our platform's Stripe account
      // This is likely a Connect event that wasn't properly identified (missing stripe-account header)
      console.log('⚠️ [Webhook] Failed to lookup subscription/customer - likely a Connect event without stripe-account header:', stripeError.message);
      console.log('ℹ️  [Webhook] Invoice details:', { invoiceId: invoice.id, customer: invoice.customer, metadata: invoice.metadata });
      return; // Exit early - let the Connect handler process it if it's re-sent
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

  // Calculate remaining boost, reward, and welcome bonus credits (these roll over)
  const { data: boostTransactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('credits_delta')
    .eq('user_id', userId)
    .eq('activity_type', 'boost_pack_purchase');

  const totalBoostCredits = boostTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;

  const { data: rewardTransactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('credits_delta')
    .eq('user_id', userId)
    .eq('activity_type', 'reward_credit');

  const totalRewardCredits = rewardTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;

  const { data: welcomeTransactions } = await supabaseAdmin
    .from('credit_transactions')
    .select('credits_delta')
    .eq('user_id', userId)
    .eq('activity_type', 'welcome_bonus');

  const totalWelcomeCredits = welcomeTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;

  console.log(`🔄 [Webhook] Preserving credits - Boost: ${totalBoostCredits}, Rewards: ${totalRewardCredits}, Welcome: ${totalWelcomeCredits}`);

  // Calculate new balance based on whether this is an upgrade or renewal
  let newBalance;
  if (hasProration) {
    // SUBSCRIPTION UPGRADE: Add prorated credits to existing balance
    // User keeps everything they had + gets the upgrade amount
    newBalance = currentBalance + credits;
    console.log(`📈 [Webhook] Upgrade detected: Adding ${credits.toLocaleString()} to existing balance ${currentBalance.toLocaleString()}`);
  } else {
    // SUBSCRIPTION RENEWAL: Replace subscription credits, preserve boost/reward/welcome
    // SUBSCRIPTION CREDITS DO NOT ROLL OVER - replace with new allocation
    // BUT boost, reward, and welcome credits DO roll over - preserve them
    newBalance = credits + totalBoostCredits + totalRewardCredits + totalWelcomeCredits;
    console.log(`🔄 [Webhook] Renewal detected: New subscription ${credits.toLocaleString()} + rolling credits`);
  }
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
      agents_paused: false,
      // Clear free tier expiration on purchase (user is now a paying customer)
      free_tier_expires_at: null,
      account_frozen: false
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

  // AUDIT TRAIL: Log payment and credit allocation
  try {
    const { auditLog } = await import('@/lib/services/AuditTrailService');

    await auditLog({
      action: hasProration ? 'SUBSCRIPTION_UPGRADED' : 'SUBSCRIPTION_RENEWED',
      entityType: 'subscription',
      entityId: String((invoice as any).subscription || invoice.id),
      userId: userId,
      resourceName: `Subscription Payment`,
      details: {
        stripe_invoice_id: invoice.id,
        stripe_payment_intent_id: (invoice as any).payment_intent,
        amount_paid_cents: invoice.amount_paid,
        amount_paid_usd: (invoice.amount_paid / 100).toFixed(2),
        credits_allocated: credits,
        pilot_credits: pilotCredits,
        is_prorated: hasProration,
        balance_before: currentBalance,
        balance_after: newBalance,
        period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        total_boost_credits: totalBoostCredits,
        total_reward_credits: totalRewardCredits,
        total_welcome_credits: totalWelcomeCredits
      },
      severity: 'info',
      complianceFlags: ['SOC2']
    });

    console.log('✅ [Webhook] Audit trail logged for payment');
  } catch (auditError) {
    console.error('⚠️ [Webhook] Audit logging failed (non-critical):', auditError);
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

  // AUDIT TRAIL: Log payment failure
  try {
    const { auditLog } = await import('@/lib/services/AuditTrailService');

    await auditLog({
      action: 'PAYMENT_FAILED',
      entityType: 'subscription',
      entityId: String((invoice as any).subscription || invoice.id),
      userId: userId,
      resourceName: `Subscription Payment Failure`,
      details: {
        stripe_invoice_id: invoice.id,
        amount_due_cents: invoice.amount_due,
        amount_due_usd: (invoice.amount_due / 100).toFixed(2),
        retry_count: retryCount,
        grace_period_days: gracePeriodDays,
        days_since_period_end: daysSincePeriodEnd,
        agents_paused: shouldPauseAgents,
        status: shouldPauseAgents ? 'past_due' : 'active'
      },
      severity: shouldPauseAgents ? 'critical' : 'warning',
      complianceFlags: ['SOC2']
    });

    console.log('✅ [Webhook] Audit trail logged for payment failure');
  } catch (auditError) {
    console.error('⚠️ [Webhook] Audit logging failed (non-critical):', auditError);
  }

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
    console.log('🎁 [Webhook] Processing boost pack purchase');
    console.log('📦 [Webhook] Session metadata:', session.metadata);

    const pilotCredits = parseInt(session.metadata?.credits || '0');
    const boostPackId = session.metadata?.boost_pack_id;

    console.log(`💰 [Webhook] Boost pack details: ${pilotCredits} Pilot Credits, boost_pack_id: ${boostPackId}`);

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

    // BOOST PACKS ROLL OVER - accumulate on top of existing balance
    const newBalance = currentBalance + credits;
    const newTotalEarned = currentTotalEarned + credits;

    // Update balance
    await supabaseAdmin
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: newTotalEarned,
        // Clear free tier expiration on purchase (user is now a paying customer)
        free_tier_expires_at: null,
        account_frozen: false
      })
      .eq('user_id', userId);

    // Create credit transaction and capture the ID
    const { data: creditTransaction, error: creditTxError } = await supabaseAdmin
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
      })
      .select('id')
      .single();

    if (creditTxError) {
      console.error('❌ [Webhook] Failed to create credit transaction for boost pack:', creditTxError);
    } else {
      console.log('✅ [Webhook] Credit transaction created:', creditTransaction?.id);
    }

    // Record boost pack purchase with proper schema
    if (boostPackId) {
      const { error: boostPackError } = await supabaseAdmin
        .from('boost_pack_purchases')
        .insert({
          user_id: userId,
          boost_pack_id: boostPackId,
          transaction_id: creditTransaction?.id || null,
          credits_purchased: credits,
          bonus_credits: 0, // Bonus already included in credits
          price_paid_usd: (session.amount_total || 0) / 100, // Numeric, not string
          stripe_payment_intent_id: session.payment_intent as string,
          payment_status: 'succeeded',
          metadata: {
            stripe_session_id: session.id,
            boost_pack_id: boostPackId,
            amount_total: session.amount_total
          }
        });

      if (boostPackError) {
        console.error('❌ [Webhook] Failed to insert into boost_pack_purchases:', boostPackError);
      } else {
        console.log('✅ [Webhook] Boost pack purchase recorded in boost_pack_purchases table');
      }
    } else {
      console.warn('⚠️  [Webhook] No boostPackId in session metadata - skipping boost_pack_purchases insert');
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

    // Calculate remaining boost and reward credits (these roll over)
    const { data: boostTransactions } = await supabaseAdmin
      .from('credit_transactions')
      .select('credits_delta')
      .eq('user_id', userId)
      .eq('activity_type', 'boost_pack_purchase');

    const totalBoostCredits = boostTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;

    const { data: rewardTransactions } = await supabaseAdmin
      .from('credit_transactions')
      .select('credits_delta')
      .eq('user_id', userId)
      .eq('activity_type', 'reward_credit');

    const totalRewardCredits = rewardTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;

    console.log(`🔄 [Webhook] Initial subscription - Preserving credits - Boost: ${totalBoostCredits}, Rewards: ${totalRewardCredits}`);

    // SUBSCRIPTION CREDITS DO NOT ROLL OVER - replace with new allocation
    // This applies to initial subscription purchase (free tier → paid transition)
    // BUT boost and reward credits DO roll over - preserve them
    const newBalance = credits + totalBoostCredits + totalRewardCredits;
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
        monthly_amount_usd: monthlyAmountUsd,
        // Clear free tier expiration on purchase (user is now a paying customer)
        free_tier_expires_at: null,
        account_frozen: false
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
        activity_type: 'subscription_renewal',
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

    // Check if this is a NEW subscription (first-time subscriber)
    // Award welcome bonus if user has never had a subscription before
    const { data: existingTransactions } = await supabaseAdmin
      .from('credit_transactions')
      .select('id')
      .eq('user_id', userId)
      .eq('activity_type', 'welcome_bonus')
      .limit(1);

    const isNewUser = !existingTransactions || existingTransactions.length === 0;

    if (isNewUser) {
      console.log('🎁 [Webhook] New subscriber detected! Awarding welcome bonus...');

      // Award 10,417 Pilot Tokens as welcome bonus (half of 20,834)
      const WELCOME_BONUS_TOKENS = 10417;

      // Convert Pilot Credits to tokens
      const welcomeBonusCredits = await pilotCreditsToTokens(WELCOME_BONUS_TOKENS, supabaseAdmin);

      // Get updated balance
      const { data: currentSub } = await supabaseAdmin
        .from('user_subscriptions')
        .select('balance, total_earned')
        .eq('user_id', userId)
        .single();

      const balanceBeforeBonus = currentSub?.balance || 0;
      const totalEarnedBeforeBonus = currentSub?.total_earned || 0;
      const balanceAfterBonus = balanceBeforeBonus + welcomeBonusCredits;
      const totalEarnedAfterBonus = totalEarnedBeforeBonus + welcomeBonusCredits;

      // Update subscription with welcome bonus
      await supabaseAdmin
        .from('user_subscriptions')
        .update({
          balance: balanceAfterBonus,
          total_earned: totalEarnedAfterBonus
        })
        .eq('user_id', userId);

      // Create credit transaction for welcome bonus
      await supabaseAdmin
        .from('credit_transactions')
        .insert({
          user_id: userId,
          credits_delta: welcomeBonusCredits,
          balance_before: balanceBeforeBonus,
          balance_after: balanceAfterBonus,
          transaction_type: 'allocation',
          activity_type: 'welcome_bonus',
          description: `Welcome to NeuronForge! ${WELCOME_BONUS_TOKENS.toLocaleString()} free Pilot Tokens`,
          metadata: {
            pilot_tokens: WELCOME_BONUS_TOKENS,
            raw_tokens: welcomeBonusCredits,
            stripe_subscription_id: session.subscription
          }
        });

      // Log billing event for welcome bonus
      await supabaseAdmin
        .from('billing_events')
        .insert({
          user_id: userId,
          event_type: 'welcome_bonus',
          credits_delta: welcomeBonusCredits,
          description: `Welcome bonus: ${WELCOME_BONUS_TOKENS.toLocaleString()} Pilot Tokens`,
          stripe_event_id: session.id,
          amount_cents: 0, // Free bonus
          currency: 'usd'
        });

      console.log(`✅ [Webhook] Welcome bonus awarded: ${WELCOME_BONUS_TOKENS} Pilot Tokens (${welcomeBonusCredits} raw tokens)`);
      console.log(`   New balance: ${balanceAfterBonus.toLocaleString()} tokens`);

      // Re-allocate quotas with welcome bonus included
      try {
        const quotaService = new QuotaAllocationService(supabaseAdmin);
        const updatedQuotaResult = await quotaService.allocateQuotasForUser(userId);

        if (updatedQuotaResult.success) {
          console.log(`✅ [Webhook] Updated quotas with welcome bonus: ${updatedQuotaResult.storageQuotaMB} MB storage, ${updatedQuotaResult.executionQuota ?? 'unlimited'} executions`);
        }
      } catch (quotaError: any) {
        console.error('❌ [Webhook] Error re-allocating quotas with welcome bonus:', quotaError.message);
      }
    } else {
      console.log('ℹ️  [Webhook] Existing subscriber - no welcome bonus awarded');
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

  // Recalculate storage and execution quotas based on new subscription tier
  try {
    console.log('📊 [Webhook] Recalculating quotas after subscription update');
    const quotaService = new QuotaAllocationService(supabaseAdmin);
    const quotaResult = await quotaService.allocateQuotasForUser(userId);

    if (quotaResult.success) {
      console.log('✅ [Webhook] Quotas allocated after subscription update:', {
        storage: quotaResult.storageQuotaMB,
        executions: quotaResult.executionQuota
      });
    } else {
      console.error('❌ [Webhook] Quota allocation returned failure:', quotaResult.error);
    }
  } catch (error) {
    console.error('❌ [Webhook] Error allocating quotas after subscription update:', error);
    // Don't fail the webhook if quota allocation fails
  }

  console.log('✅ [Webhook] Subscription updated:', { userId, pilotCredits, stripeAmountUsd });
}

/**
 * Handle business invoice.paid event (from Connect accounts)
 * - Update payment_invoices status to 'paid'
 * - Create payment_transaction record
 */
async function handleConnectInvoicePaid(invoice: Stripe.Invoice, connectAccountId: string) {
  console.log('💳 [Webhook] Processing Connect invoice.paid:', invoice.id, 'Account:', connectAccountId);
  console.log('💳 [Webhook] Invoice metadata:', JSON.stringify(invoice.metadata || {}));

  // Look up the platform invoice by Stripe invoice ID
  let platformInvoice: {
    id: string;
    user_id: string;
    contact_id: string;
    invoice_number: string;
    booking_id?: string | null;
    amount?: number;
  } | null = null;

  const { data: invoiceByStripeId, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('*')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (invoiceByStripeId) {
    platformInvoice = invoiceByStripeId;
    console.log('✅ [Webhook] Found platform invoice by stripe_invoice_id:', platformInvoice.id);
  } else {
    console.log('ℹ️  [Webhook] No platform invoice found by stripe_invoice_id, checking metadata...');

    // Fallback: Look up by invoice_id from Checkout Session metadata
    // When paying via Checkout Session, the invoice.metadata contains invoice_id
    const metadataInvoiceId = invoice.metadata?.invoice_id;

    if (metadataInvoiceId) {
      console.log('🔍 [Webhook] Looking up by metadata.invoice_id:', metadataInvoiceId);
      const { data: invoiceByMetadata, error: metadataLookupError } = await supabaseAdmin
        .from('payment_invoices')
        .select('*')
        .eq('id', metadataInvoiceId)
        .single();

      if (invoiceByMetadata && !metadataLookupError) {
        platformInvoice = invoiceByMetadata;
        console.log('✅ [Webhook] Found platform invoice by metadata.invoice_id:', platformInvoice.id);

        // Update the invoice with stripe_invoice_id for future lookups
        await supabaseAdmin
          .from('payment_invoices')
          .update({
            stripe_invoice_id: invoice.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', platformInvoice.id);
        console.log('✅ [Webhook] Updated invoice with stripe_invoice_id');
      }
    }
  }

  if (!platformInvoice) {
    console.log('ℹ️  [Webhook] No platform invoice found for Stripe invoice:', invoice.id);
    // This might be a Stripe invoice created directly in Stripe, not through our platform
    return;
  }

  console.log('✅ [Webhook] Found platform invoice:', platformInvoice.id, platformInvoice.invoice_number);

  // Update platform invoice to paid
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_hosted_invoice_url: invoice.hosted_invoice_url,
      stripe_invoice_pdf: invoice.invoice_pdf,
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    console.error('❌ [Webhook] Failed to update platform invoice:', updateError);
    return;
  }

  // Create payment_transaction record
  const { error: txError } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      user_id: platformInvoice.user_id,
      contact_id: platformInvoice.contact_id,
      invoice_id: platformInvoice.id,
      amount: invoice.amount_paid / 100, // Convert from cents
      currency: invoice.currency.toUpperCase(),
      status: 'succeeded',
      payment_method: 'card',
      description: `Payment for invoice ${platformInvoice.invoice_number}`,
      processor_type: 'stripe',
      stripe_payment_intent_id: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent?.id || null,
      stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null,
      paid_at: new Date().toISOString(),
      metadata: {
        stripe_invoice_id: invoice.id,
        connect_account_id: connectAccountId,
        invoice_number: platformInvoice.invoice_number
      },
      refund_status: 'none',
      refunded_amount: 0
    });

  if (txError) {
    console.error('❌ [Webhook] Failed to create payment transaction:', txError);
  } else {
    console.log('✅ [Webhook] Payment transaction created for invoice:', platformInvoice.invoice_number);
  }

  // Update linked booking's payment_status if invoice has a booking_id
  if (platformInvoice.booking_id) {
    console.log('🔄 [Webhook] Updating booking payment_status:', platformInvoice.booking_id);
    const { error: bookingUpdateError } = await supabaseAdmin
      .from('scheduling_bookings')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', platformInvoice.booking_id);

    if (bookingUpdateError) {
      console.error('❌ [Webhook] Failed to update booking payment status:', bookingUpdateError);
    } else {
      console.log('✅ [Webhook] Booking payment status updated to paid');
    }
  } else {
    // Fallback: Try to find booking by contact_id, user_id, and matching amount
    console.log('⚠️ [Webhook] Invoice has no booking_id, attempting to find matching booking');

    const { data: matchingBooking, error: matchError } = await supabaseAdmin
      .from('scheduling_bookings')
      .select('id, service:scheduling_services(price)')
      .eq('user_id', platformInvoice.user_id)
      .eq('contact_id', platformInvoice.contact_id)
      .in('payment_status', ['pending', null])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (matchingBooking && !matchError) {
      const servicePrice = (matchingBooking.service as { price?: number } | null)?.price || 0;
      const invoiceAmount = platformInvoice.amount || invoice.amount_paid / 100;

      if (Math.abs(servicePrice - invoiceAmount) < 0.01) {
        // Update booking payment status
        await supabaseAdmin
          .from('scheduling_bookings')
          .update({
            payment_status: 'paid',
            updated_at: new Date().toISOString()
          })
          .eq('id', matchingBooking.id);

        // Also update invoice with booking_id for future reference
        await supabaseAdmin
          .from('payment_invoices')
          .update({
            booking_id: matchingBooking.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', platformInvoice.id);

        console.log('✅ [Webhook] Found and updated matching booking:', matchingBooking.id);
      } else {
        console.log('ℹ️  [Webhook] Found booking but amount mismatch:', { servicePrice, invoiceAmount });
      }
    } else {
      console.log('ℹ️  [Webhook] No matching pending booking found for invoice');
    }
  }

  // Log audit event
  try {
    const { auditLog } = await import('@/lib/services/AuditTrailService');
    await auditLog({
      action: 'INVOICE_PAID',
      entityType: 'payment_invoice',
      entityId: platformInvoice.id,
      userId: platformInvoice.user_id,
      resourceName: platformInvoice.invoice_number,
      details: {
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        stripe_invoice_id: invoice.id,
        connect_account_id: connectAccountId
      },
      severity: 'info'
    });
  } catch (auditError) {
    console.warn('⚠️ [Webhook] Audit logging failed:', auditError);
  }

  console.log('✅ [Webhook] Connect invoice paid processed:', platformInvoice.invoice_number);
}

/**
 * Handle Connect checkout.session.completed event
 * - For invoice payments: Update payment_invoices status to 'paid'
 * - For booking payments: Update booking payment status
 */
async function handleConnectCheckoutCompleted(session: Stripe.Checkout.Session, connectAccountId: string) {
  console.log('💳 [Webhook] Processing Connect checkout.session.completed:', session.id, 'Account:', connectAccountId);

  const invoiceId = session.metadata?.invoice_id;
  const bookingId = session.metadata?.booking_id;

  // Handle invoice payment via Checkout Session
  if (invoiceId) {
    console.log('📄 [Webhook] Checkout session for invoice:', invoiceId);

    // Look up the platform invoice
    const { data: platformInvoice, error: lookupError } = await supabaseAdmin
      .from('payment_invoices')
      .select('*')
      .eq('id', invoiceId)
      .single();

    if (lookupError || !platformInvoice) {
      console.error('❌ [Webhook] Platform invoice not found:', invoiceId, lookupError);
      return;
    }

    if (platformInvoice.status === 'paid') {
      console.log('ℹ️  [Webhook] Invoice already marked as paid:', invoiceId);
      return;
    }

    // Update invoice to paid
    const { error: updateError } = await supabaseAdmin
      .from('payment_invoices')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', invoiceId);

    if (updateError) {
      console.error('❌ [Webhook] Failed to update invoice status:', updateError);
      return;
    }

    console.log('✅ [Webhook] Invoice marked as paid:', platformInvoice.invoice_number);

    // Create payment transaction record
    const amountPaid = (session.amount_total || 0) / 100;
    const { error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        user_id: platformInvoice.user_id,
        contact_id: platformInvoice.contact_id,
        invoice_id: invoiceId,
        type: 'payment',
        amount: amountPaid,
        currency: platformInvoice.currency || 'USD',
        status: 'completed',
        payment_method: 'card',
        stripe_payment_intent_id: session.payment_intent as string,
        description: `Payment for invoice ${platformInvoice.invoice_number}`,
        metadata: {
          checkout_session_id: session.id,
          connect_account_id: connectAccountId
        }
      });

    if (txError) {
      console.error('❌ [Webhook] Failed to create payment transaction:', txError);
    } else {
      console.log('✅ [Webhook] Payment transaction created for invoice:', platformInvoice.invoice_number);
    }

    // Update CRM contact stage to 'customer' if applicable
    if (platformInvoice.contact_id) {
      const { error: contactError } = await supabaseAdmin
        .from('crm_contacts')
        .update({
          stage: 'customer',
          updated_at: new Date().toISOString()
        })
        .eq('id', platformInvoice.contact_id)
        .neq('stage', 'customer'); // Only update if not already a customer

      if (contactError) {
        console.warn('⚠️ [Webhook] Failed to update contact stage:', contactError);
      }
    }

    // Update linked booking's payment_status if invoice has a booking_id
    if (platformInvoice.booking_id) {
      console.log('📅 [Webhook] Updating booking payment status for invoice booking:', platformInvoice.booking_id);
      const { error: bookingError } = await supabaseAdmin
        .from('scheduling_bookings')
        .update({
          payment_status: 'paid',
          updated_at: new Date().toISOString()
        })
        .eq('id', platformInvoice.booking_id);

      if (bookingError) {
        console.error('❌ [Webhook] Failed to update booking payment status:', bookingError);
      } else {
        console.log('✅ [Webhook] Booking payment status updated for invoice:', platformInvoice.booking_id);
      }
    }

    return;
  }

  // Handle booking payment via Checkout Session
  if (bookingId) {
    console.log('📅 [Webhook] Checkout session for booking:', bookingId);

    // Update booking payment status
    const { error: bookingError } = await supabaseAdmin
      .from('scheduling_bookings')
      .update({
        payment_status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', bookingId);

    if (bookingError) {
      console.error('❌ [Webhook] Failed to update booking payment status:', bookingError);
    } else {
      console.log('✅ [Webhook] Booking payment status updated:', bookingId);
    }

    return;
  }

  console.log('ℹ️  [Webhook] Connect checkout session with no invoice_id or booking_id - skipping');
}

/**
 * Handle business invoice.payment_failed event (from Connect accounts)
 * - Update payment_invoices status to 'overdue'
 */
async function handleConnectInvoicePaymentFailed(invoice: Stripe.Invoice, connectAccountId: string) {
  console.log('⚠️ [Webhook] Processing Connect invoice.payment_failed:', invoice.id, 'Account:', connectAccountId);

  // Look up the platform invoice by Stripe invoice ID
  const { data: platformInvoice, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('id, invoice_number, user_id')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (lookupError || !platformInvoice) {
    console.log('ℹ️  [Webhook] No platform invoice found for Stripe invoice:', invoice.id);
    return;
  }

  // Update platform invoice to overdue
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'overdue',
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    console.error('❌ [Webhook] Failed to update platform invoice:', updateError);
    return;
  }

  console.log('✅ [Webhook] Connect invoice payment failed processed:', platformInvoice.invoice_number);
}

/**
 * Handle business invoice.finalized event (from Connect accounts)
 * - Update stripe_hosted_invoice_url and stripe_invoice_pdf
 */
async function handleConnectInvoiceFinalized(invoice: Stripe.Invoice, connectAccountId: string) {
  console.log('📋 [Webhook] Processing Connect invoice.finalized:', invoice.id, 'Account:', connectAccountId);

  // Look up the platform invoice by Stripe invoice ID
  const { data: platformInvoice, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('id, invoice_number')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (lookupError || !platformInvoice) {
    console.log('ℹ️  [Webhook] No platform invoice found for Stripe invoice:', invoice.id);
    return;
  }

  // Update with hosted URL and PDF
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      stripe_hosted_invoice_url: invoice.hosted_invoice_url,
      stripe_invoice_pdf: invoice.invoice_pdf,
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    console.error('❌ [Webhook] Failed to update platform invoice:', updateError);
    return;
  }

  console.log('✅ [Webhook] Connect invoice finalized processed:', platformInvoice.invoice_number);
}

/**
 * Handle business invoice.marked_uncollectible event (from Connect accounts)
 * - Update payment_invoices status to 'cancelled'
 */
async function handleConnectInvoiceUncollectible(invoice: Stripe.Invoice, connectAccountId: string) {
  console.log('❌ [Webhook] Processing Connect invoice.marked_uncollectible:', invoice.id, 'Account:', connectAccountId);

  // Look up the platform invoice by Stripe invoice ID
  const { data: platformInvoice, error: lookupError } = await supabaseAdmin
    .from('payment_invoices')
    .select('id, invoice_number')
    .eq('stripe_invoice_id', invoice.id)
    .single();

  if (lookupError || !platformInvoice) {
    console.log('ℹ️  [Webhook] No platform invoice found for Stripe invoice:', invoice.id);
    return;
  }

  // Update platform invoice to cancelled
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString()
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    console.error('❌ [Webhook] Failed to update platform invoice:', updateError);
    return;
  }

  console.log('✅ [Webhook] Connect invoice marked uncollectible:', platformInvoice.invoice_number);
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

    console.log('📥 [Webhook] Received event:', event.type, 'ID:', event.id);

    // ============================================================================
    // IDEMPOTENCY CHECK: Prevent duplicate processing of the same webhook event
    // ============================================================================
    const { data: existingEvent, error: checkError } = await supabaseAdmin
      .from('processed_webhook_events')
      .select('event_id')
      .eq('event_id', event.id)
      .maybeSingle();

    if (checkError) {
      console.error('❌ [Webhook] Error checking for duplicate event:', checkError);
      // Continue processing - don't fail webhook if check fails
    }

    if (existingEvent) {
      console.log(`⏭️  [Webhook] Event ${event.id} already processed, skipping duplicate`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Record this event as being processed (before actual processing to handle concurrent requests)
    const { error: insertError } = await supabaseAdmin
      .from('processed_webhook_events')
      .insert({
        event_id: event.id,
        event_type: event.type,
        processed_at: new Date().toISOString(),
        metadata: {
          created: event.created,
          livemode: event.livemode
        }
      });

    if (insertError) {
      // If insert fails due to unique constraint (race condition), another request is processing this
      if (insertError.code === '23505') { // PostgreSQL unique violation
        console.log(`⏭️  [Webhook] Event ${event.id} is being processed by another request, skipping`);
        return NextResponse.json({ received: true, duplicate: true });
      }
      console.error('❌ [Webhook] Error recording event:', insertError);
      // Continue processing even if we couldn't record the event
    }

    console.log(`✅ [Webhook] Event ${event.id} recorded, processing...`);

    // Check if this is a Connect webhook (from a connected account)
    const connectAccountId = request.headers.get('stripe-account');
    const isConnectEvent = !!connectAccountId;

    if (isConnectEvent) {
      console.log(`🔗 [Webhook] Connect event from account: ${connectAccountId}`);
    }

    // Process event based on type
    switch (event.type) {
      case 'invoice.paid':
        if (isConnectEvent) {
          // Business user's client paid an invoice
          await handleConnectInvoicePaid(event.data.object as Stripe.Invoice, connectAccountId!);
        } else {
          // Platform subscription invoice paid
          await handleInvoicePaid(event.data.object as Stripe.Invoice);
        }
        break;

      case 'invoice.payment_failed':
        if (isConnectEvent) {
          // Business user's client failed to pay
          await handleConnectInvoicePaymentFailed(event.data.object as Stripe.Invoice, connectAccountId!);
        } else {
          // Platform subscription payment failed
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        }
        break;

      case 'invoice.finalized':
        if (isConnectEvent) {
          // Business user's invoice was finalized (ready for payment)
          await handleConnectInvoiceFinalized(event.data.object as Stripe.Invoice, connectAccountId!);
        }
        // No platform handler for finalized - platform uses Stripe's automatic invoicing
        break;

      case 'invoice.marked_uncollectible':
        if (isConnectEvent) {
          // Business user's invoice marked as uncollectible
          await handleConnectInvoiceUncollectible(event.data.object as Stripe.Invoice, connectAccountId!);
        }
        // No platform handler - not applicable to subscription invoices
        break;

      case 'checkout.session.completed':
        if (isConnectEvent) {
          // Business user's client completed a checkout (invoice payment, booking payment, etc.)
          await handleConnectCheckoutCompleted(event.data.object as Stripe.Checkout.Session, connectAccountId!);
        } else {
          // Platform checkout (boost packs, subscriptions)
          await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        }
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
