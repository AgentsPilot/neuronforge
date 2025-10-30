// app/api/stripe/create-checkout-session/route.ts
// Creates a Stripe Checkout session for plan subscription or boost pack purchase

import { NextRequest, NextResponse } from 'next/server';
import { stripe, getPriceId, getBoostPackPriceId } from '@/lib/stripe/stripe';
import { supabase } from '@/lib/supabaseClient';

export async function POST(req: NextRequest) {
  try {
    const { planKey, billingCycle, boostPackSize, mode } = await req.json();

    // Get authenticated user
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get or create Stripe customer
    const { data: subscription } = await supabase
      .from('user_subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', user.id)
      .single();

    let customerId = subscription?.stripe_customer_id;

    // Create new customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_id: user.id,
        },
      });
      customerId = customer.id;

      // Save customer ID
      await supabase
        .from('user_subscriptions')
        .upsert({
          user_id: user.id,
          stripe_customer_id: customerId,
        }, {
          onConflict: 'user_id',
        });
    }

    // Determine checkout mode and line items
    const checkoutMode = mode === 'subscription' ? 'subscription' : 'payment';
    let lineItems: any[] = [];

    if (mode === 'subscription') {
      // Subscription checkout
      const priceId = getPriceId(planKey, billingCycle);
      if (!priceId) {
        return NextResponse.json(
          { error: 'Invalid plan or price not configured' },
          { status: 400 }
        );
      }

      lineItems = [{
        price: priceId,
        quantity: 1,
      }];
    } else if (mode === 'boost_pack') {
      // One-time boost pack purchase
      const priceId = getBoostPackPriceId(boostPackSize);
      if (!priceId) {
        return NextResponse.json(
          { error: 'Invalid boost pack or price not configured' },
          { status: 400 }
        );
      }

      lineItems = [{
        price: priceId,
        quantity: 1,
      }];
    } else {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: checkoutMode,
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing&success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=billing&canceled=true`,
      metadata: {
        user_id: user.id,
        plan_key: planKey || '',
        billing_cycle: billingCycle || '',
        boost_pack_size: boostPackSize || '',
        mode,
      },
      subscription_data: mode === 'subscription' ? {
        metadata: {
          user_id: user.id,
          plan_key: planKey,
          billing_cycle: billingCycle,
        },
      } : undefined,
    });

    console.log('✅ Checkout session created:', session.id);

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('❌ Error creating checkout session:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
