// app/api/stripe/sync-subscription/route.ts
// Formerly: manual agent-platform subscription sync (fallback for delayed webhooks).
//
// Refused since plan payments P-10 (CF-3). It listed the caller's Stripe
// subscriptions, read `metadata.credits` and, on the service role, rewrote the
// caller's balance and monthly credits, cleared `account_frozen` /
// `free_tier_expires_at`, and inserted a `subscription_renewal` credit row: the
// last user-callable route that still turned Stripe metadata into Pilot
// Credits. Credit subscriptions are no longer sold (reuse plan §4.6 *Dies*,
// L-7), so it now authenticates and returns 410, like `update-subscription`.
// Kept as a stub rather than deleted so a stale caller gets a clear answer
// (SA Q-4).

import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'StripeSyncSubscriptionAPI' });

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

    // No Stripe call, no database read or write, no audit entry.
    logger.warn(
      { event: 'stripe_sync_subscription_refused', userId: user.id },
      'Credit subscription sync refused: no longer sold'
    );
    return NextResponse.json(
      { success: false, error: 'Credit subscriptions are no longer sold' },
      { status: 410 }
    );
  } catch (error: unknown) {
    logger.error({ err: error }, 'Sync-subscription refusal failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to sync subscription',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
