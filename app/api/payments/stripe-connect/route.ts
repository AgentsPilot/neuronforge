/**
 * The owner's Stripe Connect account, as this platform knows it.
 *
 * GET only. It reads the stored record so the UI can show whether the business
 * can take card payments; it is called from the configuration dialog, the
 * invoice surfaces, the service modal and the website editor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO POST AND NO PUT, AND THAT IS THE FIX (FX-1).
 *
 * Both existed and neither had a single caller — every one of the seven call
 * sites fetches this path bare, which is a GET. What they did have was a
 * schema that accepted Stripe's OWN verdict from the browser:
 *
 *     charges_enabled, payouts_enabled, details_submitted, onboarding_completed
 *
 * So a signed-in owner, or anyone holding their session, could PUT
 * `charges_enabled: true` and make this platform believe Stripe had approved an
 * account it had never seen. No money moves wrongly — a real charge is still
 * refused by Stripe — but the app shows "Connected", switches payment features
 * on, and stops asking the owner to finish setup.
 *
 * POST was the worse of the two and was not in the original report: it took
 * `stripe_account_id` from the caller as well, so the record could be pointed
 * at an arbitrary Stripe account while claiming it was ready to charge.
 *
 * Removed rather than tightened, on the precedent of the DELETE on
 * `/api/website/upload`: a handler with no caller is not hardened, it is
 * deleted. Next.js answers 405.
 *
 * WHERE THESE FIELDS COME FROM INSTEAD. Stripe, always — `refresh-status`
 * retrieves the account, and the four creation routes (`create-account`,
 * `create-account-custom`, `create-minimal`, `callback`) write the record only
 * after Stripe has answered. Stripe is the sole source of truth for Connect
 * status; nothing a browser says may set it.
 *
 * @module app/api/payments/stripe-connect
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'StripeConnectAPI' });

// GET /api/payments/stripe-connect - Get user's Stripe Connect account
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Fetching Stripe Connect account');

    const { data, error } = await stripeConnectRepository.findByUserId(user.id);
    requestLogger.debug({ hasData: !!data, error }, 'Stripe Connect query result');

    if (error) {
      // Actual database error
      requestLogger.error({ err: error, userId: user.id }, 'Database error fetching Stripe Connect account');
      return NextResponse.json(
        { success: false, error: 'Failed to fetch Stripe account' },
        { status: 500 }
      );
    }

    if (!data) {
      // No account found - user hasn't connected Stripe yet
      requestLogger.info({ userId: user.id }, 'No Stripe Connect account found');
      return NextResponse.json({
        success: true,
        data: null,
        message: 'No Stripe account connected'
      });
    }

    requestLogger.info({ userId: user.id, stripeAccountId: data.stripe_account_id }, 'Stripe Connect account found');
    return NextResponse.json({ success: true, data });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
