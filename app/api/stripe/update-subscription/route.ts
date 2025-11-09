// app/api/stripe/update-subscription/route.ts
// API route to update (upgrade/downgrade) an existing subscription

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getStripeService } from '@/lib/stripe/StripeService';
import { pilotCreditsToTokens, getPricingConfig } from '@/lib/utils/pricingConfig';

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

    const body = await request.json();
    const { newPilotCredits } = body;

    if (!newPilotCredits || newPilotCredits < 1000) {
      return NextResponse.json(
        { error: 'Minimum 1,000 Pilot Credits required' },
        { status: 400 }
      );
    }

    // Get user's current subscription
    const { data: userSub, error: subError } = await supabase
      .from('user_subscriptions')
      .select('stripe_subscription_id, monthly_amount_usd, status')
      .eq('user_id', user.id)
      .single();

    console.log('📋 [Update] User subscription:', { userSub, error: subError });

    if (subError || !userSub?.stripe_subscription_id) {
      console.error('❌ [Update] No subscription found:', { subError, userSub });
      return NextResponse.json(
        { error: 'No active subscription found. Please make sure you\'re logged in.' },
        { status: 404 }
      );
    }

    // Get pricing config
    const pricingConfig = await getPricingConfig(supabase);
    const newAmountUsd = newPilotCredits * pricingConfig.pilot_credit_cost_usd;
    const newTokens = await pilotCreditsToTokens(newPilotCredits, supabase);

    // Update subscription in Stripe
    const stripeService = getStripeService();
    const updatedSubscription = await stripeService.updateSubscriptionAmount(
      userSub.stripe_subscription_id,
      newAmountUsd,
      newPilotCredits, // Pass Pilot Credits (user-facing)
      userSub.monthly_amount_usd || 0 // Pass current amount for upgrade/downgrade detection
    );

    // Update database with both monthly_amount_usd AND monthly_credits
    await supabase
      .from('user_subscriptions')
      .update({
        monthly_amount_usd: newAmountUsd,
        monthly_credits: newPilotCredits // Update the monthly credits displayed in UI
      })
      .eq('user_id', user.id);

    // Log billing event
    const oldMonthlyAmount = userSub.monthly_amount_usd || 0;
    const oldPilotCredits = Math.round(oldMonthlyAmount / pricingConfig.pilot_credit_cost_usd);
    await supabase
      .from('billing_events')
      .insert({
        user_id: user.id,
        event_type: 'subscription_updated',
        description: `Subscription updated: ${oldPilotCredits.toLocaleString()} → ${newPilotCredits.toLocaleString()} Pilot Credits/month`,
        amount_cents: Math.round(newAmountUsd * 100),
        currency: 'usd'
      });

    return NextResponse.json({
      success: true,
      newAmount: newPilotCredits,
      newPrice: newAmountUsd,
      effectiveDate: (updatedSubscription as any).current_period_end
        ? new Date((updatedSubscription as any).current_period_end * 1000).toISOString()
        : null
    });

  } catch (error: any) {
    console.error('Error updating subscription:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update subscription' },
      { status: 500 }
    );
  }
}
