// app/api/stripe/create-checkout/route.ts
// API route to create a Stripe checkout session for a boost pack.
//
// Credit subscriptions (`custom_credits`) are no longer sold (plan payments P-1,
// PF-12): their invoices are now denied by the webhook's Business OS router, so
// selling one would take money that is never credited. The request is refused
// with 410 before any Stripe or database call. The boost-pack branch stays (TK-5).

import { NextRequest, NextResponse } from 'next/server';
import { platformOrigin } from '@/lib/utils/origins';
import { z } from 'zod';
import { AuditTrail as auditTrail } from '@/lib/services/AuditTrailService';
import { createLogger } from '@/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { supabaseServer } from '@/lib/supabaseServer';
import { cookies } from 'next/headers';
import { getStripeService } from '@/lib/stripe/StripeService';

const logger = createLogger({ module: 'StripeCreateCheckoutAPI' });

// `custom_credits` is still parsed (other fields ignored) so the refusal is a
// clear 410 rather than a 400 that reads as a client bug.
const checkoutBodySchema = z.discriminatedUnion('purchaseType', [
  z.object({ purchaseType: z.literal('custom_credits') }),
  z.object({ purchaseType: z.literal('boost_pack'), boostPackId: z.string().optional() }),
]);

export async function POST(request: NextRequest) {
  try {
    // Create Supabase client with cookie handler (same pattern as working API routes)
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

    logger.debug({ hasUser: !!user, userId: user?.id, hasAuthError: !!authError }, 'Stripe checkout auth check');

    if (authError || !user) {
      logger.error({ err: authError }, 'Stripe checkout auth failed');
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const rawBody: unknown = await request.json().catch(() => null);
    const parsed = checkoutBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid purchase type' },
        { status: 400 }
      );
    }
    const body = parsed.data;

    if (body.purchaseType === 'custom_credits') {
      logger.warn(
        { event: 'stripe_checkout_subscription_refused', userId: user.id },
        'Credit subscription checkout refused: no longer sold'
      );
      return NextResponse.json(
        { success: false, error: 'Credit subscriptions are no longer sold' },
        { status: 410 }
      );
    }

    // One-time boost pack purchase
    const { boostPackId } = body;
    if (!boostPackId) {
      return NextResponse.json(
        { error: 'Boost pack ID is required' },
        { status: 400 }
      );
    }

    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, display_name')
      .eq('id', user.id)
      .single();

    const userName = profile?.full_name || profile?.display_name || undefined;

    // Get Stripe service
    const stripeService = getStripeService();

    // Construct URLs
    const baseUrl = request.headers.get('origin') || platformOrigin();
    const successUrl = `${baseUrl}/v2/billing?success=true`;
    const cancelUrl = `${baseUrl}/v2/billing?canceled=true`;

    const session = await stripeService.createBoostPackCheckout({
      // P0-FT-RLS (W-4): this reaches StripeService.getOrCreateCustomer, which
      // UPDATEs/INSERTs `user_subscriptions` to persist `stripe_customer_id`.
      // That table no longer accepts writes from `anon`/`authenticated`
      // (supabase/migrations/20261001_user_subscriptions_write_lockdown.sql), and
      // neither result is checked, so with the cookie client it would fail 42501
      // in silence. `userId` below comes from the verified session and every
      // statement inside is `.eq('user_id', userId)`.
      supabase: supabaseServer,
      userId: user.id,
      email: user.email!,
      name: userName,
      boostPackId,
      successUrl,
      cancelUrl
    });

    // AUDIT TRAIL: Log boost pack checkout initiated
    // In-process, not an HTTP call to /api/audit/log: that route now takes the
    // account from the session, which a server-to-server fetch does not carry.
    // Severity and flags come from EVENT_METADATA, set to exactly what this
    // route sent before (Layer 3 step 0, Q-1, WC-12). Not awaited.
    void auditTrail
      .log({
        action: 'BOOST_PACK_CHECKOUT_INITIATED',
        entityType: 'boost_pack',
        entityId: boostPackId,
        resourceName: 'Boost Pack Purchase',
        details: {
          boost_pack_id: boostPackId,
          session_id: session.id,
          timestamp: new Date().toISOString()
        },
        userId: user.id,
      })
      .catch((err: unknown) => logger.error({ err, userId: user.id }, 'Audit entry could not be queued'));

    return NextResponse.json({
      sessionId: session.id,
      clientSecret: session.client_secret // For embedded checkout
    });

  } catch (error: unknown) {
    logger.error({ err: error }, 'Creating the checkout session failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create checkout session',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
