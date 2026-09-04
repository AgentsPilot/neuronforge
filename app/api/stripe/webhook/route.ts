// app/api/stripe/webhook/route.ts
// Stripe webhook handler - processes payment events and updates database

import { NextRequest, NextResponse } from 'next/server';
import { crmActivityRepository } from '@/lib/repositories/CRMActivityRepository';
import { activitySentence } from '@/lib/business-os/activityText';
import { createClient } from '@supabase/supabase-js';
import { getStripeService } from '@/lib/stripe/StripeService';
import { pilotCreditsToTokens } from '@/lib/utils/pricingConfig';
import { QuotaAllocationService } from '@/lib/services/QuotaAllocationService';
import { resolveAccountOwner } from '@/lib/payments/stripeAccountContext';
import { subscriptionIdFromInvoice, subscriptionMetadataFromInvoice } from '@/lib/payments/invoiceSubscription';
import { bindPlanSubscription } from '@/lib/payments/bindPlanSubscription';
import { fromMinorUnits } from '@/lib/payments/refundMath';
import { resolveInvoicePaymentIntent } from '@/lib/payments/invoicePaymentIntent';
import { syncBookingsForTransactions } from '@/lib/payments/syncBookingPaymentState';
import { resolveProcessorFee, feeColumns } from '@/lib/payments/processorFee';
import { promoteToClientStage } from '@/lib/crm/StageTypeUtils';
import { phaseDurationFor, planPhases, planSchedule, type PlanFrequency } from '@/lib/payments/planSchedule';
import { paymentPlanSubscriptionRepository } from '@/lib/repositories/PaymentPlanSubscriptionRepository';
import { describeChargeAccount } from '@/lib/payments/stripeAccountContext';
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
  const invoiceSubscription = subscriptionIdFromInvoice(invoice);
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
        stripe_subscription_id: subscriptionIdFromInvoice(invoice),
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
      entityId: String(subscriptionIdFromInvoice(invoice) || invoice.id),
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
      entityId: String(subscriptionIdFromInvoice(invoice) || invoice.id),
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
/**
 * A refund that happened at Stripe rather than here.
 *
 * Someone refunding from the Stripe dashboard is a normal thing to do, and until
 * now it was invisible: the app's numbers kept reporting money it no longer had.
 * Worse, the next refund attempted in the app would compute what remains from a
 * stale total and could return more than the charge held.
 *
 * Every refund Stripe reports is written into the ledger, keyed on its own id.
 * The unique index on `processor_refund_id` is what makes this converge with the
 * app and the reconciler instead of counting the same refund three times — this
 * handler can run repeatedly and produce the same single row. The transaction
 * and invoice totals then follow by trigger.
 */
async function handleChargeRefunded(charge: Stripe.Charge, connectAccountId: string | null) {
  console.log('💸 [Webhook] Processing charge.refunded:', charge.id);

  const paymentIntentId =
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;

  // Located by either reference, because which one was recorded depends on the
  // flow that created the payment.
  let query = supabaseAdmin
    .from('payment_transactions')
    .select('id, user_id, invoice_id, currency')
    .limit(1);

  query = paymentIntentId
    ? query.eq('stripe_payment_intent_id', paymentIntentId)
    : query.eq('stripe_charge_id', charge.id);

  const { data: matches } = await query;
  const transaction = matches?.[0];

  if (!transaction) {
    // Refunded money against a payment this app never recorded. Not droppable —
    // it means the books are wrong in a way only Stripe can see.
    console.error('❌ [Webhook] charge.refunded for an unknown payment:', {
      chargeId: charge.id,
      paymentIntentId
    });
    return;
  }

  for (const stripeRefund of charge.refunds?.data ?? []) {
    const refundCurrency = (stripeRefund.currency || transaction.currency).toUpperCase();

    /*
     * `/ 100` made the ledger disagree with itself.
     *
     * `amount_minor` was recorded correctly straight from Stripe, while `amount`
     * assumed two decimal places — and `amount` is the column the guard and the
     * recompute trigger read. For a ¥5,000 refund the ledger said 50.00, so the
     * transaction read ~1% refunded and the guard would have allowed the
     * "remaining" 99% to be refunded again.
     *
     * `fromMinorUnits` was already imported in this file and used correctly for
     * plan periods a few hundred lines below.
     */
    const amountMajor = fromMinorUnits(stripeRefund.amount, refundCurrency);

    const { error } = await supabaseAdmin.from('payment_refunds').upsert(
      {
        user_id: transaction.user_id,
        transaction_id: transaction.id,
        invoice_id: transaction.invoice_id,
        amount: amountMajor,
        amount_minor: stripeRefund.amount,
        currency: refundCurrency,
        // Stripe can report a refund as still pending for some payment methods;
        // only a succeeded one may count toward the refunded total.
        status: stripeRefund.status === 'succeeded' ? 'succeeded' : 'pending',
        processor_type: 'stripe',
        processor_refund_id: stripeRefund.id,
        stripe_connect_account_id: connectAccountId,
        // Deterministic, so a redelivery of this event cannot open a second row.
        idempotency_key: `stripe:${stripeRefund.id}`,
        source: 'webhook',
        succeeded_at:
          stripeRefund.status === 'succeeded'
            ? new Date(stripeRefund.created * 1000).toISOString()
            : null,
        metadata: { origin: 'charge.refunded', charge_id: charge.id }
      },
      { onConflict: 'processor_refund_id' }
    );

    if (error) {
      console.error('❌ [Webhook] Failed to record refund:', error);
      throw new Error(`Failed to record refund ${stripeRefund.id}: ${error.message}`);
    }
  }

  /*
   * The booking behind the payment, so a refund taken in the Stripe dashboard
   * reaches it too.
   *
   * `propagate_refund_to_booking` does this by trigger and is the authority —
   * it is the only mechanism that can, since this path has no request behind
   * it. Called explicitly as well so the behaviour is right before that
   * migration is applied; it derives the same value from the same rows, so
   * afterwards it changes nothing.
   */
  await syncBookingsForTransactions([transaction.id], transaction.user_id);

  console.log('✅ [Webhook] Recorded', charge.refunds?.data?.length ?? 0, 'refund(s) for', charge.id);
}

/**
 * A standalone payment on a connected account.
 *
 * Upserted on `stripe_payment_intent_id`, which is UNIQUE, so this cannot
 * duplicate a row that `booking/finalize` or `checkout.session.completed`
 * already wrote — whichever arrives first wins and the other is a no-op.
 *
 * Invoice-backed payments are skipped: `invoice.paid` handles those, and it
 * knows which invoice to attach the payment to, which this does not.
 */
async function handleConnectPaymentIntentSucceeded(
  intent: Stripe.PaymentIntent,
  connectAccountId: string
) {
  /*
   * `intent.invoice` is GONE on this API version — Stripe removed the
   * PaymentIntent→Invoice back-reference in Basil, the same release that moved
   * `invoice.subscription` into `invoice.parent`. The cast that used to read it
   * silently returned undefined, so the guard it protected never fired.
   *
   * Nothing was double-recorded, because the owner check below catches the same
   * intents for a different reason: an invoice's PaymentIntent is created by
   * STRIPE at finalisation and carries no metadata of ours, so it has no
   * `owner_id` and is dropped there. That is the guard doing its job by
   * accident, which is worth saying out loud rather than relying on quietly.
   *
   * Payment-plan periods take exactly this path — every one of them — so the
   * "no owner_id" case is separated below from a genuinely untagged charge,
   * which is a real fault and still an error.
   */
  const ownerId = intent.metadata?.owner_id;
  if (!ownerId) {
    const looksStripeGenerated = Object.keys(intent.metadata || {}).length === 0;

    if (looksStripeGenerated) {
      // An invoice or subscription period. `invoice.paid` owns it.
      console.log('ℹ️  [Webhook] Untagged payment_intent (invoice-backed); invoice.paid owns it:', intent.id);
    } else {
      // Tagged by one of our surfaces, but not with an owner — a charge path is
      // not identifying the business it belongs to, and the money cannot be
      // attributed. That is a fault.
      console.error('❌ [Webhook] payment_intent.succeeded with no owner_id in metadata:', intent.id);
    }
    return;
  }

  if (!(await accountOwns(connectAccountId, ownerId))) {
    // `owner_id` is metadata on the connected account's own object, so the
    // account writes it. Inserted unchecked it becomes a payment row under any
    // user_id the account chooses — money in the attacker's balance, revenue on
    // the victim's books.
    console.error(
      '🚨 [Webhook] payment_intent.succeeded claims an owner that does not own this account — refusing',
      { connectAccountId, claimedOwnerId: ownerId, intentId: intent.id }
    );
    return;
  }

  const { data: existing } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('stripe_payment_intent_id', intent.id)
    .limit(1)
    .maybeSingle();

  if (existing) {
    console.log('ℹ️  [Webhook] Payment already recorded:', intent.id);
    return;
  }

  const currency = intent.currency.toUpperCase();

  /*
   * What Stripe kept.
   *
   * Recorded at collection time because it is cheapest to know then — the
   * charge is fresh and the account is already resolved. Null when the charge
   * has not settled yet, which is a real state: the reconciler comes back for
   * those rather than this guessing a rate.
   */
  const fee = await resolveProcessorFee({
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
    account: connectAccountId,
    paymentIntentId: intent.id,
  });

  const { error } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: ownerId,
    contact_id: intent.metadata?.contact_id || null,
    // `/ 100` assumed every currency has two decimal places. JPY has none, so a
    // ¥5,000 payment was recorded as 50 — under-reporting revenue a hundredfold
    // and leaving the refund guard comparing figures on two different scales.
    amount: fromMinorUnits(intent.amount_received, currency),
    currency,
    status: 'succeeded',
    processor_type: 'stripe',
    payment_method: 'card',
    stripe_payment_intent_id: intent.id,
    // THE COLUMNS, not metadata. Both readers — `findSettledForBooking` and
    // `resolveRefundTarget` — query the columns, so money written only into
    // metadata was money that could not be refunded or attributed to its work.
    booking_id: intent.metadata?.booking_id || null,
    service_id: intent.metadata?.service_id || null,
    ...feeColumns(fee),
    paid_at: new Date(intent.created * 1000).toISOString(),
    description: intent.description || 'Website payment',
    refund_status: 'none',
    refunded_amount: 0,
    metadata: {
      // Kept as well, not instead: rows written before this carry it only here.
      booking_id: intent.metadata?.booking_id || null,
      service_id: intent.metadata?.service_id || null,
      source: 'payment_intent_webhook'
    },
    ...describeChargeAccount(connectAccountId)
  });

  if (error) {
    console.error('❌ [Webhook] Failed to record payment:', error);
    throw new Error(`Failed to record payment ${intent.id}: ${error.message}`);
  }

  console.log('✅ [Webhook] Recorded standalone payment:', intent.id);
}

/**
 * One period of a payment plan was collected.
 *
 * Returns true when this invoice belonged to a plan, so the caller knows not to
 * treat it as an ordinary invoice. Dedupes on the Stripe invoice id, which the
 * unique index on `payment_plan_installments.stripe_invoice_id` also enforces —
 * a redelivered webhook must not mark a second period paid.
 */
async function recordPlanPeriodPaid(
  invoice: Stripe.Invoice,
  subscriptionId: string,
  connectAccountId: string
): Promise<boolean> {
  const plan = await paymentPlanSubscriptionRepository.findBySubscriptionId(subscriptionId);
  if (!plan.data) return false;

  // The plan is found by a globally unique Stripe id, so ownership still has to
  // be proved against the account the event came from.
  if (!(await accountOwns(connectAccountId, plan.data.user_id))) {
    console.error(
      '🚨 [Webhook] Plan period from an account that does not own the plan — refusing',
      { connectAccountId, subscriptionId }
    );
    return true;
  }

  /*
   * A period is paid when MONEY ARRIVED — not when Stripe says `paid`.
   *
   * Cancelling a plan mid-cycle makes Stripe issue a proration CREDIT: an
   * invoice with a negative total, `amount_paid: 0`, and status `paid`, because
   * there is nothing to collect. `invoice.paid` fires for it like any other.
   *
   * Taken at face value that credit was recorded as "Payment 2 of 3" — a
   * succeeded transaction of $0 — it marked the ₪333.33 second instalment PAID,
   * and it advanced `periods_paid` to 2. The books then claimed ₪666.66
   * collected from a client who had paid ₪333.33 once.
   *
   * Returning true, not false: this invoice DOES belong to a plan, so the
   * ordinary invoice path must not pick it up either. It is simply not a
   * payment.
   */
  const collected = invoice.amount_paid ?? 0;

  if (collected <= 0) {
    console.log(
      'ℹ️  [Webhook] Plan invoice collected nothing (credit or zero-value); not a period payment:',
      invoice.id,
      'total=' + String(invoice.total)
    );
    return true;
  }

  const { data: alreadyRecorded } = await supabaseAdmin
    .from('payment_plan_installments')
    .select('id')
    .eq('stripe_invoice_id', invoice.id)
    .maybeSingle();

  if (alreadyRecorded) {
    console.log('ℹ️  [Webhook] Plan period already recorded:', invoice.id);
    return true;
  }

  const currency = (invoice.currency || plan.data.currency).toUpperCase();
  const amount = fromMinorUnits(collected, currency);
  const periodsPaid = plan.data.periods_paid + 1;

  /*
   * The payment intent, so this period can be refunded.
   *
   * Recorded without one, every plan installment was permanently unrefundable:
   * `RefundService` needs a payment intent or a charge to refund against, finds
   * neither, and throws `missing_reference` — AFTER writing a ledger row that
   * then has to be marked failed. The owner saw a 502 whose real reason is
   * hidden in production, on a button the UI went on offering.
   *
   * The `invoice.paid` path below has always resolved this; the plan path was
   * written without it. Same resolver, same warning when it comes back empty,
   * so both read the same way in the logs.
   */
  const planPaymentIntent = await resolveInvoicePaymentIntent(invoice, new Stripe(process.env.STRIPE_SECRET_KEY!), connectAccountId).catch(err => {
    console.warn('⚠️  [Webhook] Could not resolve the payment intent for a plan period:', err);
    return null;
  });

  if (!planPaymentIntent) {
    console.warn(
      '⚠️  [Webhook] Plan period recorded with no payment intent — this payment will not be refundable:',
      invoice.id
    );
  }

  // The money first, then the plan's own state — the same order settlement
  // follows everywhere else, so a failure leaves money recorded and a count
  // behind, never a count ahead of money that never arrived.
  // The fee on this period, from the same charge the payment intent points at.
  const planFee = await resolveProcessorFee({
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
    account: connectAccountId,
    paymentIntentId: planPaymentIntent,
  });

  const { data: periodTransaction, error: txError } = await supabaseAdmin.from('payment_transactions').insert({
    user_id: plan.data.user_id,
    contact_id: plan.data.contact_id,
    booking_id: plan.data.booking_id,
    service_id: plan.data.service_id,
    amount,
    currency,
    status: 'succeeded',
    processor_type: 'stripe',
    payment_method: 'card',
    stripe_payment_intent_id: planPaymentIntent,
    ...feeColumns(planFee),
    paid_at: new Date().toISOString(),
    description: `Payment ${periodsPaid} of ${plan.data.installment_count}`,
    refund_status: 'none',
    refunded_amount: 0,
    /*
     * The Stripe invoice id lives in metadata, NOT in a column.
     *
     * `payment_transactions` has no `stripe_invoice_id` — it has `invoice_id`,
     * a UUID pointing at `payment_invoices`. Writing the Stripe id to a column
     * that does not exist made PostgREST reject the whole insert ("Could not
     * find the 'stripe_invoice_id' column ... in the schema cache"), which threw
     * and failed the webhook, so no plan period was ever recorded.
     *
     * Dedupe does not depend on this: it is enforced by the unique index on
     * `payment_plan_installments.stripe_invoice_id`, which is a real column,
     * and checked above before anything is written.
     */
    /*
     * The numbers travel beside the description.
     *
     * `description` below is written in English, once, and read by every
     * locale — so the drawer showed a Hebrew reader "Payment 1 of 3". The UI
     * phrases it from these instead; the description stays as a stable
     * English record for support and export.
     */
    metadata: {
      source: 'payment_plan',
      subscription_id: subscriptionId,
      stripe_invoice_id: invoice.id,
      installment_number: periodsPaid,
      installment_count: plan.data.installment_count,
    },
    ...describeChargeAccount(connectAccountId),
  })
    .select('id')
    .single();

  if (txError) {
    console.error('❌ [Webhook] Could not record a plan period:', txError);
    throw txError;
  }

  /*
   * Mark the projected instalment, so "2 of 3 paid" is answerable locally.
   *
   * The same six fields `PaymentPlanRepository.markInstallmentPaid` writes on
   * the owner-driven path. This wrote three, so a period collected by Stripe
   * had no `payment_method`, no `processor_type`, and — the one that matters —
   * no `transaction_id`: nothing tied the period to the money that settled it,
   * which is the link a refund has to follow to find its charge.
   *
   * `updated_at` is set explicitly. There is no trigger on this table, so the
   * row that was marked paid still claimed it had not been touched since it was
   * projected.
   */
  await supabaseAdmin
    .from('payment_plan_installments')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      stripe_invoice_id: invoice.id,
      payment_method: 'card',
      processor_type: 'stripe',
      transaction_id: periodTransaction?.id ?? null,
      next_retry_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('subscription_id', plan.data.id)
    .eq('installment_number', periodsPaid);

  /*
   * When the next period falls due.
   *
   * `recordPeriodPaid` has always taken this and no caller ever passed it, so
   * every payment wrote `next_charge_at` and `next_charge_amount` back to NULL
   * — the row could say "1 of 3 paid" but never when the next ₪333 was coming.
   * Read from the projection rather than asked of Stripe: the periods are
   * already local, and a webhook should not make a network call to answer a
   * question it can answer from its own tables.
   */
  const { data: nextPeriod } = await supabaseAdmin
    .from('payment_plan_installments')
    .select('due_date, amount')
    .eq('subscription_id', plan.data.id)
    .eq('status', 'pending')
    .order('installment_number')
    .limit(1)
    .maybeSingle();

  await paymentPlanSubscriptionRepository.recordPeriodPaid(plan.data.id, periodsPaid, {
    chargeAt: nextPeriod?.due_date ?? null,
    amount: nextPeriod ? Number(nextPeriod.amount) : null,
  });

  if (periodsPaid >= plan.data.installment_count) {
    await paymentPlanSubscriptionRepository.close(plan.data.id, 'completed');
  }

  console.log('✅ [Webhook] Plan period recorded:', periodsPaid, 'of', plan.data.installment_count);
  return true;
}

/**
 * Does this connected account belong to the business that owns this record?
 *
 * Cached per invocation: a webhook may check the same account more than once,
 * and this is two queries.
 */
const accountOwnerCache = new Map<string, string | null>();

async function accountOwns(connectAccountId: string, ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return false;

  if (!accountOwnerCache.has(connectAccountId)) {
    accountOwnerCache.set(
      connectAccountId,
      await resolveAccountOwner(supabaseAdmin, connectAccountId)
    );
  }

  const owner = accountOwnerCache.get(connectAccountId) ?? null;

  // An account we cannot map to any business is not proof of ownership. It is
  // also not necessarily an attack — a newly connected account whose row has
  // not landed yet reads the same way — so it is logged rather than silent.
  if (!owner) {
    console.warn('⚠️  [Webhook] Connect account maps to no known business:', connectAccountId);
    return false;
  }

  return owner === ownerId;
}

async function handleConnectInvoicePaid(invoice: Stripe.Invoice, connectAccountId: string) {
  console.log('💳 [Webhook] Processing Connect invoice.paid:', invoice.id, 'Account:', connectAccountId);
  console.log('💳 [Webhook] Invoice metadata:', JSON.stringify(invoice.metadata || {}));

  /**
   * A payment plan period.
   *
   * Stripe raises one invoice per period against the subscription, so this is
   * where a plan's money actually arrives — every period after the first, and
   * the first one too. Without this branch a plan charged correctly and the
   * platform recorded none of it: the money list would show "0 of 12 paid"
   * forever while the client's card was debited every month.
   */
  const subscriptionId = subscriptionIdFromInvoice(invoice);

  if (subscriptionId) {
    /*
     * The first period of a plan sold through the BOOKING MODAL.
     *
     * The hosted Checkout page bounds its plans at `checkout.session.completed`,
     * because a session exists to be told about. The embedded flow has no
     * session: `/api/website/payment-intent` creates the subscription directly
     * with `default_incomplete` and the client confirms it in the modal, so the
     * first time this platform hears that the plan is real is right here, when
     * its opening invoice is paid.
     *
     * Bounding it is what stops it billing forever — `end_behavior: 'cancel'`
     * after the agreed number of periods. It happens BEFORE the period is
     * recorded because `recordPlanPeriodPaid` looks the plan up by its local
     * mirror, and until this runs there is no mirror to find.
     *
     * A schedule cannot be created from an `incomplete` subscription, which is
     * why this waits for payment rather than running at creation time. The
     * window is one period wide — a month, typically — so a retried delivery
     * has room to succeed before anything could be charged twice.
     */
    const planMeta = subscriptionMetadataFromInvoice(invoice);

    if (planMeta.plan_count && planMeta.owner_id) {
      if (await accountOwns(connectAccountId, planMeta.owner_id)) {
        try {
          const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);

          await bindPlanSubscription({
            stripe: stripeClient,
            connectAccountId,
            subscriptionId,
            customerId:
              typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null,
            ownerId: planMeta.owner_id,
            bookingId: planMeta.booking_id || null,
            serviceId: planMeta.service_id || null,
            planTotal: Number(planMeta.plan_total ?? 0),
            planCurrency: planMeta.plan_currency || invoice.currency?.toUpperCase() || 'USD',
            planCount: Number(planMeta.plan_count),
            planFrequency: (planMeta.plan_frequency || 'monthly') as PlanFrequency,
            paymentPlanId: planMeta.payment_plan_id || null,
          });
        } catch (bindError) {
          // Loud, and deliberately rethrown: an unbounded subscription charges a
          // client indefinitely. Failing the webhook makes Stripe retry, which
          // is the behaviour that protects the client.
          console.error('🚨 [Webhook] Could not bound a plan subscription:', subscriptionId, bindError);
          throw bindError;
        }
      } else {
        console.error(
          '🚨 [Webhook] Plan metadata claims an owner this account does not own — refusing',
          { connectAccountId, subscriptionId }
        );
      }
    }

    const handled = await recordPlanPeriodPaid(invoice, subscriptionId, connectAccountId);
    // A period belongs to its plan, not to a platform invoice. Returning here
    // stops the ordinary invoice path treating it as an unmatched Stripe
    // invoice and doing nothing with it twice.
    if (handled) return;
  }

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
    console.log('✅ [Webhook] Found platform invoice by stripe_invoice_id:', invoiceByStripeId.id);
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
        console.log('✅ [Webhook] Found platform invoice by metadata.invoice_id:', invoiceByMetadata.id);

        // Update the invoice with stripe_invoice_id for future lookups
        await supabaseAdmin
          .from('payment_invoices')
          .update({
            stripe_invoice_id: invoice.id,
            updated_at: new Date().toISOString()
          })
          .eq('id', invoiceByMetadata.id);
        console.log('✅ [Webhook] Updated invoice with stripe_invoice_id');
      }
    }
  }

  if (platformInvoice && !(await accountOwns(connectAccountId, platformInvoice.user_id))) {
    // The event came from one business's account, but names another business's
    // invoice. Both lookups above resolve by ID ALONE — a stripe_invoice_id or a
    // UUID in metadata — and metadata on a connected account is written by that
    // account. So without this check a business could create and pay an invoice
    // on its own account carrying a competitor's invoice UUID, and we would mark
    // the competitor's invoice paid and insert a payment row under their user_id
    // while the money sat in the attacker's balance.
    //
    // Refused rather than repaired: there is no benign reading of it.
    console.error(
      '🚨 [Webhook] Connect invoice.paid names an invoice owned by a different business — refusing',
      { connectAccountId, invoiceId: platformInvoice.id }
    );
    return;
  }

  if (!platformInvoice) {
    console.log('ℹ️  [Webhook] No platform invoice found for Stripe invoice:', invoice.id);
    // This might be a Stripe invoice created directly in Stripe, not through our platform
    return;
  }

  console.log('✅ [Webhook] Found platform invoice:', platformInvoice.id, platformInvoice.invoice_number);

  const paidAt = new Date().toISOString();

  // Already recorded? Stripe can deliver invoice.paid more than once, and a
  // failed attempt is now retried, so this handler has to be safe to run twice.
  // Without this guard a retry would add a second payment against one invoice
  // and double the recorded revenue.
  const { data: existingTx } = await supabaseAdmin
    .from('payment_transactions')
    .select('id')
    .eq('invoice_id', platformInvoice.id)
    .in('status', ['succeeded', 'refunded'])
    .limit(1)
    .maybeSingle();

  if (existingTx) {
    console.log('ℹ️  [Webhook] Payment already recorded for invoice:', platformInvoice.invoice_number);
    return;
  }

  // The payment intent, from wherever this API version keeps it.
  //
  // `invoice.payment_intent` was REMOVED from the Invoice object in the 2025
  // API versions; settlement now hangs off `invoice.payments[].payment`. This
  // account is already on the newer shape — all three paid invoices returned
  // `payment_intent: undefined` while carrying a real
  // `payments.data[0].payment.payment_intent`.
  //
  // Reading only the old field would record every invoice payment with a null
  // id, and Stripe needs the payment intent or the charge to refund against —
  // so each of those payments would be permanently unrefundable. Both shapes are
  // read, and the list is fetched if the webhook payload did not inline it.
  const paymentIntentId = await resolveInvoicePaymentIntent(invoice, new Stripe(process.env.STRIPE_SECRET_KEY!), connectAccountId);

  if (!paymentIntentId) {
    console.warn(
      '⚠️  [Webhook] invoice.paid carried no payment intent in either shape — this payment will not be refundable:',
      { invoiceId: platformInvoice.id, stripeInvoiceId: invoice.id }
    );
  }

  // The payment is recorded BEFORE the invoice is marked paid.
  //
  // It used to be the other way round with the failure only logged, so a failed
  // insert left an invoice that looked settled with no money behind it. This
  // order means a failure leaves the invoice UNPAID — visible, and retryable.
  const invoiceCurrency = invoice.currency.toUpperCase();

  // What Stripe kept out of this invoice payment.
  const invoiceFee = await resolveProcessorFee({
    stripe: new Stripe(process.env.STRIPE_SECRET_KEY!),
    account: connectAccountId,
    paymentIntentId,
  });

  const { error: txError } = await supabaseAdmin
    .from('payment_transactions')
    .insert({
      user_id: platformInvoice.user_id,
      contact_id: platformInvoice.contact_id,
      invoice_id: platformInvoice.id,
      /*
       * `/ 100` assumed every currency has two decimal places, and this was the
       * last place in the file still doing it. JPY has none and KWD has three,
       * so a ¥5,000 invoice payment was recorded as ¥50 — under-reporting the
       * money by a hundredfold and leaving the refund guard comparing two
       * different scales.
       */
      amount: fromMinorUnits(invoice.amount_paid, invoiceCurrency),
      currency: invoiceCurrency,
      status: 'succeeded',
      payment_method: 'card',
      description: `Payment for invoice ${platformInvoice.invoice_number}`,
      processor_type: 'stripe',
      stripe_payment_intent_id: paymentIntentId,
      stripe_customer_id: typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null,
      ...feeColumns(invoiceFee),
      paid_at: paidAt,
      metadata: {
        stripe_invoice_id: invoice.id,
        connect_account_id: connectAccountId,
        invoice_number: platformInvoice.invoice_number
      },
      refund_status: 'none',
      refunded_amount: 0,
      // Where this charge lives, taken from Stripe's own answer rather than
      // looked up again later. A refund issued against the wrong account does
      // not fail safely — it either errors or returns money from the wrong
      // balance — and after the fact there is nothing in the database that could
      // tell the two apart.
      ...describeChargeAccount(connectAccountId)
    });

  if (txError) {
    console.error('❌ [Webhook] Failed to create payment transaction:', txError);
    throw new Error(
      `Failed to record payment for invoice ${platformInvoice.id}: ${txError.message}`
    );
  }

  console.log('✅ [Webhook] Payment transaction created for invoice:', platformInvoice.invoice_number);

  // Then the invoice. The update_invoice_on_payment trigger also does this when
  // the transaction lands; this is idempotent and covers databases without it.
  const { error: updateError } = await supabaseAdmin
    .from('payment_invoices')
    .update({
      status: 'paid',
      paid_at: paidAt,
      stripe_hosted_invoice_url: invoice.hosted_invoice_url,
      stripe_invoice_pdf: invoice.invoice_pdf,
      updated_at: paidAt
    })
    .eq('id', platformInvoice.id);

  if (updateError) {
    console.error('❌ [Webhook] Failed to update platform invoice:', updateError);
    throw new Error(
      `Failed to mark invoice ${platformInvoice.id} paid: ${updateError.message}`
    );
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

  /**
   * A payment plan's first charge. Bound it, or it bills forever.
   *
   * A Checkout Session cannot create a Subscription Schedule, so the session is
   * opened in `subscription` mode and the schedule is attached here, the moment
   * the subscription exists. `end_behavior: 'cancel'` is what stops it after the
   * agreed number of periods — an open subscription would keep charging the
   * client past the end of what they signed up for, which is the single worst
   * outcome available in this file.
   *
   * Attached from the subscription rather than created fresh: releasing and
   * recreating would drop the payment method the client just entered.
   */
  if (session.mode === 'subscription' && session.subscription && session.metadata?.plan_count) {
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const ownerId = session.metadata?.owner_id;

    try {
      // The webhook has no module-level client; the one at the invoice handler
      // is function-scoped. Constructed here for the same reason.
      const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!);

      if (ownerId && (await accountOwns(connectAccountId, ownerId))) {
        await bindPlanSubscription({
          stripe: stripeClient,
          connectAccountId,
          subscriptionId,
          customerId:
            typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null,
          ownerId,
          bookingId: bookingId || null,
          serviceId: session.metadata?.service_id || null,
          planTotal: Number(session.metadata?.plan_total ?? 0),
          planCurrency: session.metadata?.plan_currency || 'USD',
          planCount: Number(session.metadata.plan_count),
          planFrequency: (session.metadata?.plan_frequency || 'monthly') as PlanFrequency,
        });
      } else {
        console.error(
          '🚨 [Webhook] Plan checkout names an owner this account does not own — refusing',
          { connectAccountId, subscriptionId }
        );
      }
    } catch (scheduleError) {
      // Loud, and deliberately not swallowed: an unbounded subscription charges
      // a client indefinitely, so this needs a human, not a log line.
      console.error(
        '🚨 [Webhook] Could not bound a payment plan — subscription may bill indefinitely:',
        { subscriptionId, connectAccountId, error: scheduleError }
      );
      throw scheduleError;
    }
  }

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

    if (!(await accountOwns(connectAccountId, platformInvoice.user_id))) {
      // Same hole as the invoice.paid path: the invoice is found by a UUID that
      // travelled in metadata written by the connected account.
      console.error(
        '🚨 [Webhook] Connect checkout names an invoice owned by a different business — refusing',
        { connectAccountId, invoiceId }
      );
      return;
    }

    if (platformInvoice.status === 'paid') {
      console.log('ℹ️  [Webhook] Invoice already marked as paid:', invoiceId);
      return;
    }

    // The payment is recorded BEFORE the invoice is marked paid.
    //
    // The order used to be the other way round, and the insert that followed
    // could never succeed: it set `type: 'payment'`, a column that does not
    // exist on payment_transactions, and `status: 'completed'`, which is not one
    // of pending/succeeded/failed/refunded. Postgres rejected every row, the
    // failure was only logged, and the invoice had already been marked paid — so
    // the money vanished from the records while the invoice looked settled.
    //
    // Writing the payment first means a failure here leaves the invoice UNPAID:
    // visible, wrong in the safe direction, and retryable.
    const paidAt = new Date().toISOString();
    const amountPaid = (session.amount_total || 0) / 100;

    const { error: txError } = await supabaseAdmin
      .from('payment_transactions')
      .insert({
        user_id: platformInvoice.user_id,
        contact_id: platformInvoice.contact_id,
        invoice_id: invoiceId,
        amount: amountPaid,
        currency: platformInvoice.currency || 'USD',
        status: 'succeeded',
        processor_type: 'stripe',
        payment_method: 'card',
        paid_at: paidAt,
        stripe_payment_intent_id: session.payment_intent as string,
        description: `Payment for invoice ${platformInvoice.invoice_number}`,
        metadata: {
          checkout_session_id: session.id,
          connect_account_id: connectAccountId
        },
        // Same reasoning as the invoice handler: recorded at charge time,
        // never inferred at refund time.
        ...describeChargeAccount(connectAccountId)
      });

    if (txError) {
      // Thrown, not logged and swallowed. The caller turns this into a non-2xx
      // so Stripe retries; swallowing it is what produced paid-looking invoices
      // with no payment behind them.
      console.error('❌ [Webhook] Failed to create payment transaction:', txError);
      throw new Error(`Failed to record payment for invoice ${invoiceId}: ${txError.message}`);
    }

    console.log('✅ [Webhook] Payment transaction created for invoice:', platformInvoice.invoice_number);

    // Now the invoice. The update_invoice_on_payment trigger already does this
    // when the transaction lands, so this is belt-and-braces for databases where
    // that trigger is not present — and it is idempotent either way.
    const { error: updateError } = await supabaseAdmin
      .from('payment_invoices')
      .update({
        status: 'paid',
        paid_at: paidAt,
        updated_at: paidAt
      })
      .eq('id', invoiceId);

    if (updateError) {
      console.error('❌ [Webhook] Failed to update invoice status:', updateError);
      throw new Error(`Failed to mark invoice ${invoiceId} paid: ${updateError.message}`);
    }

    console.log('✅ [Webhook] Invoice marked as paid:', platformInvoice.invoice_number);

    /*
     * They have paid, so move them along their OWN pipeline.
     *
     * This wrote `stage: 'customer'` — a key that exists only in the default
     * pipeline the onboarding service seeds. A business running its own stages
     * (this account's are פנייה → ייעוץ ראשוני → לקוח → הושלם) had its paying
     * clients written into a stage with no column on the board.
     *
     * `promoteToClientStage` reads the business's configured client stage and
     * refuses to demote anyone already at or past it.
     */
    if (platformInvoice.contact_id) {
      await promoteToClientStage(
        supabaseAdmin,
        platformInvoice.user_id,
        platformInvoice.contact_id
      );
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

  /**
   * A plan period that did not go through.
   *
   * Recorded against the plan so the business can be told something useful —
   * "their card was declined on payment 3 of 12" — rather than discovering it
   * when the total never arrives. Stripe keeps retrying on its own schedule;
   * this only mirrors the state.
   */
  const failedSubscriptionId = subscriptionIdFromInvoice(invoice);

  if (failedSubscriptionId) {
    const plan = await paymentPlanSubscriptionRepository.findBySubscriptionId(failedSubscriptionId);

    if (plan.data && (await accountOwns(connectAccountId, plan.data.user_id))) {
      await paymentPlanSubscriptionRepository.recordFailure(
        plan.data.id,
        (invoice as unknown as { last_finalization_error?: { code?: string } }).last_finalization_error?.code ?? null
      );

      console.log('⚠️ [Webhook] Plan marked past_due:', plan.data.id);
      return;
    }
  }

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

  /*
   * A failed payment, on the client's timeline.
   *
   * Only successful receipts were recorded, so "this client's card keeps
   * declining" was a pattern with no trail behind it — the invoice quietly
   * turned overdue and the drawer said nothing.
   */
  const { data: failedInvoice } = await supabaseAdmin
    .from('payment_invoices')
    .select('contact_id, amount, currency')
    .eq('id', platformInvoice.id)
    .maybeSingle();

  if (failedInvoice?.contact_id) {
    const { data: ownerProfile } = await supabaseAdmin
      .from('business_profiles')
      .select('language')
      .eq('user_id', platformInvoice.user_id)
      .maybeSingle();
    const ownerLocale = ownerProfile?.language || 'en';
    const currency = failedInvoice.currency || 'USD';

    crmActivityRepository.create({
      user_id: platformInvoice.user_id,
      contact_id: failedInvoice.contact_id,
      activity_type: 'payment_failed',
      title: activitySentence('payment_failed', {
        amount: new Intl.NumberFormat(
          ownerLocale === 'he' ? 'he-IL' : ownerLocale === 'es' ? 'es-ES' : 'en-US',
          { style: 'currency', currency }
        ).format(Number(failedInvoice.amount) || 0),
      }, ownerLocale),
      description: JSON.stringify({
        kind: 'payment_failed',
        amount: failedInvoice.amount,
        currency,
        invoiceNumber: platformInvoice.invoice_number || undefined,
      }),
      auto_logged: true,
      source_capability: 'payments',
      source_entity_id: platformInvoice.id,
    }).catch(err => console.warn('[Webhook] Payment-failed activity logging failed (non-blocking)', err));
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
 * A client's payment plan ended at Stripe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two ways to get here, and they mean different things:
 *
 *   · the schedule reached its last period — the plan COMPLETED, normally;
 *   · somebody cancelled it in the Stripe dashboard — the plan was STOPPED.
 *
 * `periods_paid` against `installment_count` is what separates them, and it
 * matters: a completed plan is a finished sale, a cancelled one has periods that
 * must come off the business's receivables.
 *
 * OWNERSHIP IS VERIFIED, and never taken from metadata. Subscriptions on a
 * connected account are created by that business, which controls their metadata
 * — so a `user_id` there could name any tenant. The subscription is looked up by
 * OUR OWN recorded id, and the account that sent the event must be the one that
 * owns the plan we found.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function handlePlanSubscriptionEnded(
  subscription: Stripe.Subscription,
  connectAccountId: string
) {
  const { data: plan } = await supabaseAdmin
    .from('payment_plan_subscriptions')
    .select('id, user_id, status, installment_count, periods_paid')
    .eq('stripe_subscription_id', subscription.id)
    .maybeSingle();

  // Not a plan this platform sold. Connected accounts have subscriptions of
  // their own and they are none of our business.
  if (!plan) return;

  if (!(await accountOwns(connectAccountId, plan.user_id))) {
    console.error(
      '🚫 [Webhook] Subscription ended on an account that does not own the plan it names:',
      subscription.id
    );
    return;
  }

  if (plan.status === 'cancelled' || plan.status === 'completed') return;

  const completed = (plan.periods_paid ?? 0) >= (plan.installment_count ?? 0);

  await supabaseAdmin
    .from('payment_plan_subscriptions')
    .update({
      status: completed ? 'completed' : 'cancelled',
      [completed ? 'completed_at' : 'cancelled_at']: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.id);

  // Periods that will now never be charged stop counting as owed. `cancelled`
  // is a settled status, which is what takes them out of receivables.
  if (!completed) {
    await supabaseAdmin
      .from('payment_plan_installments')
      .update({ status: 'cancelled', next_retry_at: null, updated_at: new Date().toISOString() })
      .eq('user_id', plan.user_id)
      .eq('subscription_id', subscription.id)
      .eq('status', 'pending');
  }

  console.log(
    `${completed ? '✅' : '🛑'} [Webhook] Payment plan ${completed ? 'completed' : 'cancelled'}:`,
    subscription.id
  );
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
  // Set once this request has claimed the event. The catch needs it to release
  // the claim, and it must survive out of the try block to do so.
  let processedEventId: string | null = null;

  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    // Either secret verifies.
    //
    // Connected-account events can arrive at the same endpoint as platform ones,
    // or at a separate endpoint with its own secret, depending on how Stripe is
    // configured — and that is a dashboard setting nobody here controls.
    // Accepting both means this code is correct either way, so the fix does not
    // have to be coordinated with a dashboard change.
    const secrets = [
      process.env.STRIPE_WEBHOOK_SECRET,
      process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    ].filter(Boolean) as string[];

    if (secrets.length === 0) {
      console.error('❌ No Stripe webhook secret configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    const stripeService = getStripeService();
    let event: Stripe.Event | null = null;
    let verificationError: unknown = null;

    for (const secret of secrets) {
      try {
        event = stripeService.constructWebhookEvent(body, signature, secret);
        break;
      } catch (err) {
        verificationError = err;
      }
    }

    if (!event) {
      // A signature that matches no configured secret is not ours. 400 is
      // correct here — unlike a handler failure, retrying will not help.
      console.error('❌ [Webhook] Signature verification failed:', verificationError);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log('📥 [Webhook] Received event:', event.type, 'ID:', event.id);

    // ============================================================================
    // IDEMPOTENCY CHECK: Prevent duplicate processing of the same webhook event
    // ============================================================================
    // Two-phase, because "seen" and "done" are different facts.
    //
    // Recording the id before processing is correct — it is what stops two
    // concurrent deliveries both running the handler. What was missing was any
    // way back: a handler that threw left its row behind, so every Stripe retry
    // of that event was discarded as a duplicate. For an event that moves money
    // that is a one-way valve, and it is how client payments were lost.
    //
    // Only 'completed' suppresses a retry now. A 'failed' row is reclaimed
    // below so Stripe's next delivery can do the work.
    const { data: existingEvent, error: checkError } = await supabaseAdmin
      .from('processed_webhook_events')
      .select('event_id, status')
      .eq('event_id', event.id)
      .maybeSingle();

    if (checkError) {
      console.error('❌ [Webhook] Error checking for duplicate event:', checkError);
      // Continue processing - don't fail webhook if check fails
    }

    if (existingEvent?.status === 'completed') {
      console.log(`⏭️  [Webhook] Event ${event.id} already processed, skipping duplicate`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (existingEvent?.status === 'processing') {
      // Another delivery of the same event is in flight right now.
      console.log(`⏭️  [Webhook] Event ${event.id} is being processed by another request, skipping`);
      return NextResponse.json({ received: true, duplicate: true });
    }

    if (existingEvent) {
      // A previous attempt failed. Claim it for this attempt.
      console.log(`🔁 [Webhook] Retrying previously failed event ${event.id}`);
      await supabaseAdmin
        .from('processed_webhook_events')
        .update({ status: 'processing', failure_message: null, processed_at: new Date().toISOString() })
        .eq('event_id', event.id);
      processedEventId = event.id;
    } else {
      const { error: insertError } = await supabaseAdmin
        .from('processed_webhook_events')
        .insert({
          event_id: event.id,
          event_type: event.type,
          status: 'processing',
          processed_at: new Date().toISOString(),
          metadata: {
            created: event.created,
            livemode: event.livemode
          }
        });

      if (insertError) {
        // Unique violation means another request claimed it between our SELECT
        // and this INSERT. Theirs wins.
        if (insertError.code === '23505') {
          console.log(`⏭️  [Webhook] Event ${event.id} is being processed by another request, skipping`);
          return NextResponse.json({ received: true, duplicate: true });
        }
        console.error('❌ [Webhook] Error recording event:', insertError);
        // Continue processing even if we couldn't record the event
      } else {
        processedEventId = event.id;
      }
    }

    console.log(`✅ [Webhook] Event ${event.id} recorded, processing...`);

    // Which account this event belongs to — a business's connected account, or
    // the platform.
    //
    // This read a `stripe-account` request header, which Stripe does not send on
    // webhook deliveries; a connected-account event carries its account on the
    // event body. So this was always false and no client payment ever reached
    // the handlers below: 12 invoices existed against zero payment
    // transactions, with paid ones still reading `overdue`.
    //
    // Platform events have no `event.account`, so they take exactly the path
    // they take today.
    const connectAccountId = event.account ?? null;
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

      // Platform subscriptions ONLY — this is the platform's own SaaS billing.
      //
      // These were the last money events not gated on `isConnectEvent`, and the
      // gap was a cross-tenant write. Both handlers key solely on
      // `subscription.metadata.user_id`, and on a Connect event that metadata is
      // written by the CONNECTED BUSINESS (subscriptions are created on
      // connected accounts by the Stripe plugin executor). So a business could
      // set `metadata.user_id` to another tenant's id and rewrite that tenant's
      // plan, credits and status — or cancel it outright.
      //
      // A connected account's own subscriptions are its business, not ours.
      case 'customer.subscription.updated':
        if (isConnectEvent) break;
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        if (isConnectEvent) {
          // A CLIENT's payment plan ending — either because it reached its last
          // period, or because someone stopped it from the Stripe dashboard.
          // Mirrored so the plan does not read `active` while nothing is being
          // charged, and so its remaining periods leave the books.
          await handlePlanSubscriptionEnded(
            event.data.object as Stripe.Subscription,
            connectAccountId!
          );
          break;
        }
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      // Refunds issued outside this app — from the Stripe dashboard, or by
      // Stripe itself. Handled for both platform and connected accounts:
      // wherever the charge lives, the ledger has to learn about it.
      case 'charge.refunded':
        await handleChargeRefunded(event.data.object as Stripe.Charge, connectAccountId);
        break;

      // A payment that succeeded without any invoice behind it — a website or
      // landing-page sale. Recorded here because the browser is not a reliable
      // reporter: `booking/finalize` runs client-side, so a customer who closes
      // the tab after paying leaves money in Stripe with no row at all.
      //
      // Connected accounts only. A platform payment_intent.succeeded belongs to
      // subscription billing, which is not this system's concern.
      case 'payment_intent.succeeded':
        if (isConnectEvent) {
          await handleConnectPaymentIntentSucceeded(
            event.data.object as Stripe.PaymentIntent,
            connectAccountId!
          );
        }
        break;

      default:
        console.log('ℹ️ [Webhook] Unhandled event type:', event.type);
    }

    // Only now is it safe to suppress future deliveries of this event.
    await supabaseAdmin
      .from('processed_webhook_events')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('event_id', event.id);

    return NextResponse.json({ received: true });

  } catch (error: any) {
    console.error('❌ [Webhook] Error:', error);

    // Release the event so Stripe's retry can reprocess it. Without this the id
    // stays claimed and every retry is discarded as a duplicate — the failure
    // mode that lost real payments.
    //
    // `processedEventId` is null when we failed before claiming anything (bad
    // signature, malformed body), where there is nothing to release.
    if (processedEventId) {
      try {
        await supabaseAdmin
          .from('processed_webhook_events')
          .update({
            status: 'failed',
            failure_message: String(error?.message ?? error).slice(0, 500)
          })
          .eq('event_id', processedEventId);
      } catch (releaseError) {
        // Nothing further to do — the original failure is the one that matters,
        // and swallowing this keeps it from masking the real error.
        console.error('❌ [Webhook] Could not release failed event:', releaseError);
      }
    }

    // 5xx, not 400. Stripe retries on any non-2xx, but a 4xx says "this request
    // was malformed, sending it again will not help" — which is the opposite of
    // true when our own handler threw.
    return NextResponse.json(
      { error: error.message || 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
