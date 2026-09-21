// app/api/stripe/update-subscription/route.ts
// API route to update (upgrade/downgrade) an existing subscription

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { cookies } from 'next/headers';
import { getStripeService } from '@/lib/stripe/StripeService';
import { pilotCreditsToTokens, getPricingConfig } from '@/lib/utils/pricingConfig';

const logger = createLogger({ module: 'StripeUpdateSubscriptionAPI' });

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

    logger.debug({ userId: user.id, hasSubscription: !!userSub?.stripe_subscription_id, err: subError }, 'Loaded user subscription');

    if (subError || !userSub?.stripe_subscription_id) {
      logger.error({ userId: user.id, err: subError }, 'No active subscription found');
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

    // Update database with both monthly_amount_usd AND monthly_credits.
    // P0-FT-RLS: `user_subscriptions` no longer accepts writes from
    // `anon`/`authenticated` (supabase/migrations/20261001_user_subscriptions_write_lockdown.sql),
    // so this write uses the service role, like its sibling routes
    // (cancel-subscription, reactivate-subscription, sync-subscription). It stays
    // scoped to `user.id` from the verified session, and to those two columns.
    const { error: subUpdateError } = await supabaseServer
      .from('user_subscriptions')
      .update({
        monthly_amount_usd: newAmountUsd,
        monthly_credits: newPilotCredits // Update the monthly credits displayed in UI
      })
      .eq('user_id', user.id);

    // SA RC9-5: this statement is the only thing that persists a paid plan change
    // locally - Stripe has already been charged by the call above. A silent
    // failure here (42501 if the lock-down migration is applied before this code
    // ships) would leave the user paying the new price while the app shows the
    // old plan, so it fails loudly instead.
    if (subUpdateError) {
      logger.error(
        { err: subUpdateError, userId: user.id, newPilotCredits },
        'Stripe subscription was updated but the local user_subscriptions row was not'
      );
      return NextResponse.json(
        {
          error: 'Your plan was updated with our payment provider, but we could not update your account. Please contact support.',
          details: process.env.NODE_ENV === 'development' ? subUpdateError.message : undefined
        },
        { status: 500 }
      );
    }

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
    logger.error({ err: error }, 'Failed to update subscription');
    return NextResponse.json(
      { error: error.message || 'Failed to update subscription' },
      { status: 500 }
    );
  }
}
