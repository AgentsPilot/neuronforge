// app/api/stripe/webhook/route.ts
// Handles Stripe webhook events for subscription and payment updates

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/stripe';
import { supabase } from '@/lib/supabaseClient';
import Stripe from 'stripe';

// Disable body parsing for webhook
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      console.error('❌ No Stripe signature found');
      return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('❌ STRIPE_WEBHOOK_SECRET not configured');
      return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    console.log(`🔔 Received webhook: ${event.type}`);

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      default:
        console.log(`ℹ️  Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('❌ Webhook handler error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

// Handle completed checkout session
async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  console.log('💳 Checkout completed:', session.id);

  const userId = session.metadata?.user_id;
  if (!userId) {
    console.error('❌ No user_id in checkout session metadata');
    return;
  }

  const mode = session.metadata?.mode;

  if (mode === 'subscription') {
    // Handle subscription checkout
    const subscriptionId = session.subscription as string;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await handleSubscriptionUpdate(subscription);
  } else if (mode === 'boost_pack') {
    // Handle boost pack purchase
    const boostPackId = session.metadata?.boost_pack_id;
    const paymentIntentId = session.payment_intent as string;

    if (!boostPackId) {
      console.error('❌ No boost_pack_id in checkout session metadata');
      return;
    }

    // Get boost pack details from database
    const { data: boostPack } = await supabase
      .from('boost_packs')
      .select('*')
      .eq('id', boostPackId)
      .single();

    if (!boostPack) {
      console.error('❌ Boost pack not found:', boostPackId);
      return;
    }

    const creditsToAdd = boostPack.credits_amount + (boostPack.bonus_credits || 0);

    // Get current subscription
    const { data: userSub } = await supabase
      .from('user_subscriptions')
      .select('balance')
      .eq('user_id', userId)
      .single();

    const currentBalance = userSub?.balance || 0;
    const newBalance = currentBalance + creditsToAdd;

    // Update balance
    await supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
      })
      .eq('user_id', userId);

    // Create transaction record
    await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: creditsToAdd,
        transaction_type: 'boost_pack',
        activity_type: 'boost_pack_purchase',
        description: `Purchased ${boostPack.pack_name}`,
        balance_before: currentBalance,
        balance_after: newBalance,
        stripe_payment_intent_id: paymentIntentId,
        metadata: {
          boost_pack_id: boostPackId,
          pack_key: boostPack.pack_key,
          credits_amount: boostPack.credits_amount,
          bonus_credits: boostPack.bonus_credits,
          session_id: session.id,
        },
      });

    // Log billing event
    await supabase
      .from('billing_events')
      .insert({
        user_id: userId,
        event_type: 'boost_pack_purchased',
        amount_usd: boostPack.price_usd,
        credits_affected: creditsToAdd,
        stripe_event_id: session.id,
        description: `Purchased ${boostPack.pack_name}`,
      });

    console.log(`✅ Boost pack applied: ${creditsToAdd} Pilot Credits`);
  }
}

// Handle subscription created or updated
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  console.log('📝 Subscription updated:', subscription.id);

  const userId = subscription.metadata.user_id;
  if (!userId) {
    console.error('❌ No user_id in subscription metadata');
    return;
  }

  const subscriptionType = subscription.metadata.subscription_type || 'dynamic';
  const monthlyCredits = parseInt(subscription.metadata.monthly_credits || '0', 10);

  if (!monthlyCredits || monthlyCredits <= 0) {
    console.error('❌ Invalid monthly_credits in subscription metadata');
    return;
  }

  // Calculate monthly amount from credits
  const monthlyAmount = Math.max(monthlyCredits * 0.00048, 10.00);

  // Get current subscription
  const { data: currentSub } = await supabase
    .from('user_subscriptions')
    .select('balance, monthly_credits, stripe_subscription_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isUpdate = currentSub && currentSub.stripe_subscription_id === subscription.id;
  const currentBalance = currentSub?.balance || 0;

  // Update user subscription record
  await supabase
    .from('user_subscriptions')
    .upsert({
      user_id: userId,
      monthly_amount_usd: monthlyAmount,
      monthly_credits: monthlyCredits,
      subscription_type: subscriptionType,
      stripe_customer_id: subscription.customer as string,
      stripe_subscription_id: subscription.id,
      stripe_price_id: subscription.items.data[0]?.price.id,
      status: subscription.status === 'active' ? 'active' : subscription.status as any,
      cancel_at_period_end: subscription.cancel_at_period_end,
      last_calculator_inputs: subscription.metadata.calculator_inputs
        ? JSON.parse(subscription.metadata.calculator_inputs)
        : null,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });

  console.log(`✅ Subscription ${isUpdate ? 'updated' : 'created'}: ${monthlyCredits} credits/month at $${monthlyAmount.toFixed(2)}/month`);
}

// Handle subscription deleted/canceled
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  console.log('🗑️  Subscription deleted:', subscription.id);

  const userId = subscription.metadata.user_id;
  if (!userId) return;

  // Update subscription status
  await supabase
    .from('user_subscriptions')
    .update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  console.log('✅ Subscription marked as canceled');
}

// Handle invoice paid
async function handleInvoicePaid(invoice: Stripe.Invoice) {
  console.log('💰 Invoice paid:', invoice.id);

  // Get user_id from invoice metadata or subscription
  let userId = invoice.metadata?.user_id;

  if (!userId && invoice.subscription) {
    // Fetch subscription to get user_id
    const stripeSubscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
    userId = stripeSubscription.metadata?.user_id;
  }

  if (!userId) {
    console.error('❌ No user_id found in invoice or subscription metadata');
    return;
  }

  // Get subscription record
  const { data: subscription, error: subError } = await supabase
    .from('user_subscriptions')
    .select('id, monthly_credits, balance, subscription_type')
    .eq('user_id', userId)
    .single();

  if (subError || !subscription) {
    console.error('❌ Subscription not found for user:', userId);
    return;
  }

  // Check if this is a subscription renewal (not boost pack)
  const isSubscriptionInvoice = invoice.subscription !== null;

  if (isSubscriptionInvoice && subscription.monthly_credits > 0) {
    // Add monthly credits to balance
    const currentBalance = subscription.balance || 0;
    const newBalance = currentBalance + subscription.monthly_credits;

    await supabase
      .from('user_subscriptions')
      .update({
        balance: newBalance,
        total_earned: (subscription as any).total_earned
          ? (subscription as any).total_earned + subscription.monthly_credits
          : subscription.monthly_credits,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // Create credit transaction
    await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        credits_delta: subscription.monthly_credits,
        transaction_type: 'allocation',
        activity_type: 'subscription_topup',
        description: 'Monthly subscription credit allocation',
        balance_before: currentBalance,
        balance_after: newBalance,
        stripe_invoice_id: invoice.id,
        metadata: {
          invoice_id: invoice.id,
          subscription_id: invoice.subscription,
          subscription_type: subscription.subscription_type,
        },
      });

    // Log billing event
    await supabase
      .from('billing_events')
      .insert({
        user_id: userId,
        event_type: 'subscription_renewed',
        amount_usd: invoice.amount_paid / 100,
        credits_affected: subscription.monthly_credits,
        stripe_event_id: invoice.id,
        description: `Subscription renewed - ${subscription.monthly_credits} credits allocated`,
      });

    console.log(`✅ Credits allocated: ${subscription.monthly_credits} (new balance: ${newBalance})`);
  }

  // Save invoice record
  const { error: invoiceError } = await supabase
    .from('subscription_invoices')
    .upsert({
      user_id: userId,
      subscription_id: subscription.id,
      invoice_number: invoice.number || `INV-${invoice.id.substring(0, 8)}`,
      amount_due: invoice.amount_due,
      amount_paid: invoice.amount_paid,
      status: 'paid',
      stripe_invoice_id: invoice.id,
      stripe_invoice_pdf: invoice.invoice_pdf || undefined,
      stripe_hosted_invoice_url: invoice.hosted_invoice_url || undefined,
      invoice_date: new Date(invoice.created * 1000).toISOString(),
      paid_at: invoice.status_transitions.paid_at
        ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
        : new Date().toISOString(),
      period_start: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : new Date().toISOString(),
      period_end: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : new Date().toISOString(),
      plan_name: subscription.subscription_type === 'dynamic'
        ? `Dynamic Plan (${subscription.monthly_credits} credits/month)`
        : 'Unknown',
      credits_allocated: isSubscriptionInvoice ? subscription.monthly_credits : 0,
      metadata: {
        invoice_id: invoice.id,
        subscription_id: invoice.subscription,
        subscription_type: subscription.subscription_type,
      },
    }, {
      onConflict: 'stripe_invoice_id',
    });

  if (invoiceError) {
    console.error('❌ Error saving invoice record:', invoiceError);
  } else {
    console.log('✅ Invoice record saved');
  }
}

// Handle invoice payment failed
async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  console.log('❌ Invoice payment failed:', invoice.id);

  // Get user_id from invoice metadata or subscription
  let userId = invoice.metadata?.user_id;

  if (!userId && invoice.subscription) {
    // Fetch subscription to get user_id
    const stripeSubscription = await stripe.subscriptions.retrieve(invoice.subscription as string);
    userId = stripeSubscription.metadata?.user_id;
  }

  if (!userId) {
    console.error('❌ No user_id found in invoice metadata');
    return;
  }

  // Update subscription status to past_due
  await supabase
    .from('user_subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  // Log billing event
  await supabase
    .from('billing_events')
    .insert({
      user_id: userId,
      event_type: 'payment_failed',
      amount_usd: invoice.amount_due / 100,
      stripe_event_id: invoice.id,
      description: 'Subscription payment failed',
    });

  console.log('⚠️  Subscription marked as past_due');
}
