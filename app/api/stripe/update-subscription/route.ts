// app/api/stripe/update-subscription/route.ts
// Formerly: upgrade/downgrade an agent-platform credit subscription.
//
// Refused since plan payments P-1 (SA ruling Q-3, PF-12). The upgrade used
// `proration_behavior: 'always_invoice'`, which charges a proration invoice
// immediately, and the webhook's Business OS router now denies every platform
// invoice whose price is not a Business OS plan price. Taking that money would
// mean charging a customer and crediting nothing. Credit subscriptions are on
// the reuse plan's "Dies" list (§4.6); the UI that calls this route is removed
// in P-10. `cancel-subscription` and `reactivate-subscription` take no money and
// stay.

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StripeUpdateSubscriptionAPI' });

export async function POST() {
  try {
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

    // Auth first, so an anonymous caller still gets 401, as before.
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // No Stripe call, no database write, no audit entry: nothing was changed.
    logger.warn(
      { event: 'stripe_subscription_update_refused', userId: user.id },
      'Credit subscription update refused: no longer sold'
    );
    return NextResponse.json(
      { success: false, error: 'Credit subscriptions are no longer sold' },
      { status: 410 }
    );
  } catch (error: unknown) {
    logger.error({ err: error }, 'Update-subscription refusal failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update subscription',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
