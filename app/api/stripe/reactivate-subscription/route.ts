// app/api/stripe/reactivate-subscription/route.ts
// API route to reactivate user's Stripe subscription

import { NextRequest, NextResponse } from 'next/server';
import { AuditTrail as auditTrail } from '@/lib/services/AuditTrailService';
import { createLogger } from '@/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const logger = createLogger({ module: 'StripeReactivateSubscriptionAPI' });

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

    console.log('🔄 [Reactivate Subscription] Request from user:', user.id);

    // Get user's subscription
    const { data: userSub } = await supabaseAdmin
      .from('user_subscriptions')
      .select('stripe_subscription_id, stripe_customer_id, cancel_at_period_end')
      .eq('user_id', user.id)
      .single();

    if (!userSub?.stripe_subscription_id) {
      return NextResponse.json(
        { error: 'No subscription found' },
        { status: 404 }
      );
    }

    if (!userSub.cancel_at_period_end) {
      return NextResponse.json(
        { error: 'Subscription is not set to cancel' },
        { status: 400 }
      );
    }

    // Reactivate subscription by removing cancel_at_period_end
    const subscription = await stripe.subscriptions.update(
      userSub.stripe_subscription_id,
      {
        cancel_at_period_end: false
      }
    );

    console.log('✅ [Reactivate Subscription] Subscription reactivated:', subscription.id);

    // Update database
    const { error: updateError } = await supabaseAdmin
      .from('user_subscriptions')
      .update({
        cancel_at_period_end: false,
        canceled_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);

    if (updateError) {
      console.error('❌ [Reactivate Subscription] Database update failed:', updateError);
    }

    // AUDIT TRAIL: Log subscription reactivation
    // In-process, not an HTTP call to /api/audit/log: that route now takes the
    // account from the session, which a server-to-server fetch does not carry.
    // Severity and flags come from EVENT_METADATA, set to exactly what this
    // route sent before (Layer 3 step 0, Q-1, WC-12). Not awaited.
    void auditTrail
      .log({
        action: 'SUBSCRIPTION_REACTIVATED',
        entityType: 'subscription',
        entityId: subscription.id,
        resourceName: 'Subscription Reactivation',
        details: {
          subscription_id: subscription.id,
          cancel_at_period_end: false,
          current_period_end: subscription.current_period_end,
          timestamp: new Date().toISOString()
        },
        userId: user.id,
      })
      .catch((err: unknown) => logger.error({ err, userId: user.id }, 'Audit entry could not be queued'));

    return NextResponse.json({
      success: true,
      message: 'Subscription reactivated successfully. Billing will continue as normal.',
      current_period_end: subscription.current_period_end
    });

  } catch (error: any) {
    console.error('❌ [Reactivate Subscription] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to reactivate subscription' },
      { status: 500 }
    );
  }
}
