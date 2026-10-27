/**
 * POST /api/business-os/billing/plan/portal
 *
 * Open Stripe's customer portal for the SIGNED-IN owner, on the Business OS
 * configuration (card and invoices only, SA-P10), to update the card or see
 * every invoice (plan payments P-7a.2; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.4; SA C-1, C-6,
 * TQ-7, TQ-8).
 *
 * Body (strict): `{ intent: 'update_card' | 'invoices', locale?: 'en' | 'he' | 'es' }`.
 * Any other key, such as an injected `userId` or `customerId`, is a 400;
 * unparsable JSON is a 400 too. `update_card` opens on the card form and
 * comes straight back to Settings → Plan when done; `invoices` opens the
 * portal home ("See all in Stripe"). `he` opens with Stripe's `auto` locale
 * (X-5: Stripe has no Hebrew portal).
 *
 * 200 → { success: true, data: { url } }: the client navigates to it.
 * Refusals answer { success: false, error, code } from PLAN_BILLING_DOCS_REFUSALS.
 *
 * THE URL IS A BEARER LINK to the customer's billing: never logged, never
 * audited, never in an error, and the response carries
 * `Cache-Control: no-store` (C-6). Opening the portal is logged (ids only),
 * not audited (TQ-9).
 *
 * Behind `BUSINESS_OS_PLAN_PRICES_ENABLED` (SA C-1; BQ-1: the price
 * recognition switch, NOT the checkout switch, so pausing sales never stops a
 * payer from fixing their card): while off the route answers 404 before
 * reading the session, the body, the database or Stripe. The billing row is
 * the session user's (`getUser()`), never a request value, and the portal's
 * return URL is built from the server-side platform origin, never from the
 * request's Host / Origin (C-6). Imports nothing from the entitlements module.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { PLAN_BILLING_DOCS_REFUSALS, openPlanBillingPortal } from '@/lib/business-os/billing/planBillingDocuments';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanPortalAPI' });

const PortalBodySchema = z
  .object({
    intent: z.enum(['update_card', 'invoices']),
    locale: z.enum(['en', 'he', 'es']).optional(),
  })
  .strict();

/** C-6: the answer holds a bearer link (or says why there is none); never cached. */
const NO_STORE = { 'Cache-Control': 'no-store' };

function json(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  // Off: the route looks absent, and nothing is read.
  if (!isPlanPriceRecognitionEnabled()) {
    return json({ success: false, error: 'Not found', code: 'not_available' }, 404);
  }

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: 'Invalid input', code: 'invalid_input' }, 400);
    }
    const parsed = PortalBodySchema.safeParse(body);
    if (!parsed.success) {
      return json(
        {
          success: false,
          error: 'Invalid input',
          code: 'invalid_input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        400
      );
    }

    requestLogger.info({ userId: user.id, intent: parsed.data.intent }, 'Plan billing portal requested');

    const result = await openPlanBillingPortal(
      { userId: user.id, intent: parsed.data.intent, language: parsed.data.locale },
      { logger: requestLogger }
    );

    if (!result.ok) {
      const refusal = PLAN_BILLING_DOCS_REFUSALS[result.code];
      return json({ success: false, error: refusal.message, code: result.code }, refusal.status);
    }
    return json({ success: true, data: { url: result.url } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan billing portal failed');
    return json(
      {
        success: false,
        error: 'Internal server error',
        details:
          process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      500
    );
  }
}
