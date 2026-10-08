/**
 * Start a credits boost purchase.
 *
 *   POST /api/business-os/credits/boost/checkout   body: { packageId }
 *
 * Credits boost slice 3 (workplan BUSINESS_OS_CREDITS_BOOST_SLICE_3_WORKPLAN.md;
 * requirement FR-6 to FR-12, FR-20 to FR-23; SA C-1 to C-7).
 *
 * Answers `{ success: true, data: { clientSecret, purchaseId, expiresAt } }`:
 * the client mounts Stripe's embedded checkout with the secret (slice 5).
 * Nothing is credited here; the webhook (4a) credits a paid session.
 *
 * ── OFF UNLESS THE FLAG IS ON (SA F-14, C-1) ─────────────────────────────────
 * While `BUSINESS_OS_CREDITS_BOOST_ENABLED` is off (the default) the route
 * answers 404 to every caller before reading the session. An optional test-
 * account list narrows it further (404 for anyone not on it). ⚠️ The flag stays
 * unset on Vercel until 4a is deployed (lib/utils/featureFlags.ts).
 *
 * ── INPUT: { packageId } AND NOTHING ELSE (FR-8) ─────────────────────────────
 * Strict Zod: a price, credits, currency or account in the body is a 400. The
 * account is `user.id` from the verified session; the price and credits come
 * from the catalogue; the mode from the server key.
 *
 * ── CLIENTS ──────────────────────────────────────────────────────────────────
 * The orchestration (`lib/business-os/boost/boostCheckout.ts`) writes through
 * `BusinessOsBoostPurchaseRepository` on the service-role client, by design:
 * the boost functions are granted to service_role only, and they take the
 * account from this route's session, never from the request. This file
 * imports nothing from the entitlements module.
 *
 * ── AUDIT ────────────────────────────────────────────────────────────────────
 * `BOS_BOOST_CHECKOUT_STARTED` on success, written out through `logAndFlush`
 * before the answer (WC-7, SA C-4, CR-3): a 2 s bound, and it never throws.
 *
 * @module app/api/business-os/credits/boost/checkout
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { BOOST_CHECKOUT_REFUSAL_STATUS, runBoostCheckout } from '@/lib/business-os/boost/boostCheckout';
import { boostReturnUrl, isBoostCheckoutOpenFor } from '@/lib/business-os/boost/boostCheckoutAccess';
import { boostCheckoutDeps } from '@/lib/business-os/boost/boostCheckoutDeps';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { isBusinessOsCreditsBoostEnabled } from '@/lib/utils/featureFlags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BusinessOsBoostCheckoutAPI' });
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** Exactly one field; the slug shape of the catalogue's package ids. */
const checkoutBodySchema = z
  .object({
    packageId: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
  })
  .strict();

const notFound = () => NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: NO_STORE });

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // Off: the route does not exist for anyone (before the session is read).
    if (!isBusinessOsCreditsBoostEnabled()) return notFound();

    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }
    if (!isBoostCheckoutOpenFor(user.id, requestLogger)) return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const parsed = checkoutBodySchema.safeParse(body);
    if (!parsed.success) {
      requestLogger.warn({ userId: user.id }, 'bos_boost_checkout_refused: invalid input');
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400, headers: NO_STORE }
      );
    }

    const returnUrl = boostReturnUrl();
    if (returnUrl === null) {
      requestLogger.error({ userId: user.id }, 'bos_boost_checkout_refused: the platform address is not a usable https origin');
      return NextResponse.json({ success: false, error: 'payments_unavailable' }, { status: 500, headers: NO_STORE });
    }

    const outcome = await runBoostCheckout(
      boostCheckoutDeps(),
      { accountId: user.id, email: user.email ?? null, packageId: parsed.data.packageId, returnUrl },
      requestLogger
    );

    if (!outcome.ok) {
      // Slice 5b SA C-5: the cap answer names the cap and its window (server
      // figures; an override included), never the amount already counted.
      const cap = outcome.error === 'cap_reached' && outcome.cap ? { capMinor: outcome.cap.capMinor, windowDays: outcome.cap.windowDays } : {};
      return NextResponse.json(
        { success: false, error: outcome.error, ...cap },
        { status: BOOST_CHECKOUT_REFUSAL_STATUS[outcome.error], headers: NO_STORE }
      );
    }

    // WC-7 (SA C-4, CR-3): a money write writes its audit entry out before
    // answering, through the bounded helper (2 s budget, never throws).
    await logAndFlush(
      {
        action: AUDIT_EVENTS.BOS_BOOST_CHECKOUT_STARTED,
        entityType: 'business_os_boost_purchase',
        entityId: outcome.purchaseId,
        userId: user.id,
        resourceName: outcome.packageId,
        details: {
          package_id: outcome.packageId,
          package_version: outcome.packageVersion,
          price_minor: outcome.priceMinor,
          currency: outcome.currency,
          livemode: outcome.livemode,
        },
        request,
      },
      requestLogger,
      { reason: 'boost checkout started', continues: 'the checkout answer is unaffected' }
    );

    return NextResponse.json(
      { success: true, data: { clientSecret: outcome.clientSecret, purchaseId: outcome.purchaseId, expiresAt: outcome.expiresAt } },
      { headers: NO_STORE }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Boost checkout request failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500, headers: NO_STORE }
    );
  }
}

