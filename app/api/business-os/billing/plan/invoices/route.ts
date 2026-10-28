/**
 * GET /api/business-os/billing/plan/invoices
 *
 * The SIGNED-IN owner's last 12 plan invoices, read live from Stripe for OUR
 * billing row's customer, when the owner opens the list (plan payments P-7a.2;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.5; SA
 * C-1, C-6, TQ-6; F9, AC-F9.1, AC-F9.2, BQ-7).
 *
 * No input: any query parameter (such as an injected `customerId`) is a 400.
 *
 * 200 → { success: true, data: { invoices: PlanInvoiceRow[], hasMore } }.
 * `hasMore` → the screen offers "See all in Stripe" (the portal). One Stripe
 * page, never auto-paged; never our money history (AC-F9.2, RD-2); an owner
 * READ, never an access decision (SR-11).
 * Refusals answer { success: false, error, code } from PLAN_BILLING_DOCS_REFUSALS.
 *
 * The rows carry hosted-invoice links (bearer links to the invoice and its
 * receipt): the response carries `Cache-Control: no-store` and the list is
 * never logged (C-6), only counts. Not audited (TQ-9).
 *
 * Behind `BUSINESS_OS_PLAN_PRICES_ENABLED` (SA C-1; BQ-1: the price
 * recognition switch, NOT the checkout switch): while off the route answers
 * 404 before reading the session, the database or Stripe. The billing row is
 * the session user's (`getUser()`), never a request value. Imports nothing
 * from the entitlements module.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getUser } from '@/lib/auth';
import { PLAN_BILLING_DOCS_REFUSALS, listPlanInvoices } from '@/lib/business-os/billing/planBillingDocuments';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosPlanInvoicesAPI' });

/** No input at all: the session decides whose invoices these are. */
const InvoicesQuerySchema = z.object({}).strict();

/** C-6: the answer holds hosted-invoice links; never cached. */
const NO_STORE = { 'Cache-Control': 'no-store' };

function json(body: Record<string, unknown>, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
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

    const parsed = InvoicesQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
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

    const result = await listPlanInvoices({ userId: user.id }, { logger: requestLogger });
    if (!result.ok) {
      const refusal = PLAN_BILLING_DOCS_REFUSALS[result.code];
      return json({ success: false, error: refusal.message, code: result.code }, refusal.status);
    }
    return json({ success: true, data: { invoices: result.invoices, hasMore: result.hasMore } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Plan invoice list failed');
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
