// app/api/stripe/cancel-subscription/route.ts
// API route to cancel user's Stripe subscription

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-10-29.clover'
});

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
    // Create Supabase client with cookie handler
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

    console.log('🚫 [Cancel Subscription] Request from user:', user.id);

    // Get user's subscription
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_subscription_id, stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (!userSub?.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'No active subscription found' },
        { status: 404 }
      );
    }

    // Cancel subscription at period end (user keeps credits until then)
    const subscription = await stripe.subscriptions.update(
      userSub.stripe_subscription_id,
      {
        cancel_at_period_end: true
      }
    );

    console.log('✅ [Cancel Subscription] Subscription canceled at period end:', subscription.id);

    // Update database
    const { error: updateError } = await supabaseAdmin
      .from('user_subscriptions')
      .update({
        cancel_at_period_end: true,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('❌ [Cancel Subscription] Database update failed:', updateError);
    }

    // AUDIT TRAIL: Log subscription cancellation
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get('origin') || 'http://localhost:3000';
    await fetch(`${baseUrl}/api/audit/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.id
      },
      body: JSON.stringify({
        action: 'SUBSCRIPTION_CANCELED',
        entityType: 'subscription',
        entityId: subscription.id,
        userId: user.id,
        resourceName: 'Subscription Cancellation',
        details: {
          subscription_id: subscription.id,
          cancel_at_period_end: true,
          current_period_end: subscription.current_period_end,
          timestamp: new Date().toISOString()
        },
        severity: 'info',
        complianceFlags: ['SOC2', 'FINANCIAL']
      })
    });

    return NextResponse.json({
      success: true,
      message: 'Subscription canceled successfully. You will retain access until the end of your billing period.',
      current_period_end: subscription.current_period_end
    });

  } catch (error: any) {
    console.error('❌ [Cancel Subscription] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to cancel subscription' },
      { status: 500 }
    );
  }
}
