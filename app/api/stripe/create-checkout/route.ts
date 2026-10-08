// app/api/stripe/create-checkout/route.ts
// Formerly: create a Stripe checkout session for an agent-platform purchase
// (a credit subscription, or a one-time boost pack).
//
// Every purchase is now refused with 410 after auth and validation, before any
// Stripe, database or audit call:
//
//   - `custom_credits` since plan payments P-1 (PF-12): credit-subscription
//     invoices are denied by the webhook's Business OS router, so selling one
//     would take money that is never credited.
//   - `boost_pack` since plan payments P-10, which owns Credits Boost FR-40
//     (R-7, TK-5): the AgentsPilot boost purchase is switched off, not deleted.
//     `StripeService.createBoostPackCheckout`, the webhook's `boost_pack` branch
//     (so a session opened before this deploy still completes), the
//     `boost_packs` / `boost_pack_purchases` tables and their history are kept.
//     This 410 is the real control; `boost_packs.is_active = false` is display
//     only, and the admin billing page can flip it back on.
//
// The body is still validated (CLAUDE.md rule 2), so a malformed request stays a
// 400 that reads as a client bug, and a known purchase type gets a clear 410.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const logger = createLogger({ module: 'StripeCreateCheckoutAPI' });

const checkoutBodySchema = z.discriminatedUnion('purchaseType', [
  z.object({ purchaseType: z.literal('custom_credits') }),
  z.object({ purchaseType: z.literal('boost_pack'), boostPackId: z.string().optional() }),
]);

const REFUSAL_MESSAGE: Record<z.infer<typeof checkoutBodySchema>['purchaseType'], string> = {
  custom_credits: 'Credit subscriptions are no longer sold',
  boost_pack: 'Boost packs are no longer sold',
};

export async function POST(request: NextRequest) {
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
    const { purchaseType } = parsed.data;

    // No Stripe call, no database read or write, no audit entry.
    logger.warn(
      { event: 'stripe_checkout_refused', userId: user.id, purchaseType },
      'Checkout refused: no longer sold'
    );
    return NextResponse.json(
      { success: false, error: REFUSAL_MESSAGE[purchaseType] },
      { status: 410 }
    );
  } catch (error: unknown) {
    logger.error({ err: error }, 'Checkout refusal failed');
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
