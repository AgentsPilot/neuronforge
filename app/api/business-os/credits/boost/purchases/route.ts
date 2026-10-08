/**
 * GET /api/business-os/credits/boost/purchases — the owner's own boost
 * purchases (credits boost slices 5b.1 and 5b.2; FR-11, FR-26, BQ-B1, R-10;
 * SA C-1, C-3, Q-1, Q-3, Q-4).
 *
 * Two shapes, both owner-scoped reads that never credit anything:
 *   - `?sessionId=cs_…` (5b.1): what happened to one payment. The dashboard's
 *     return notice polls this after Stripe sends the owner back.
 *     → `{ purchase: BoostPurchaseView | null }`
 *   - no `sessionId` (5b.2): the Purchases list in the Top up panel, newest
 *     first, the current Stripe mode only (R-10), at most `limit` (default
 *     and maximum 50). → `{ purchases: BoostPurchaseView[] }`
 *
 * The session id is never trusted beyond looking it up. Credits arrive only
 * through the webhook.
 *
 * - The account is the session's (`getUser()`), never a parameter.
 * - The read is scoped to that account (`findForAccountBySessionId`), so
 *   another owner's session answers `{ purchase: null }`, exactly like a
 *   missing one, never a 403 that would confirm it exists.
 * - The answer is the owner view only: no Stripe ids, session id, flag reason,
 *   mode or lot id.
 * - The list reuses the repository's `listForAccount` (explicit columns,
 *   `.eq('user_id')`, `.eq('livemode')`, newest first, clamped limit).
 * - `Cache-Control: private, no-store`. No audit: it is a read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPurchaseView } from '@/lib/business-os/boost/boostPurchasesView';
import { currentStripeMode, isLiveMode } from '@/lib/business-os/billing/stripeMode';
import type { BoostLabels } from '@/lib/business-os/boost/boostPackagesTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BoostPurchasesAPI' });
const NO_STORE = { 'Cache-Control': 'private, no-store' };

/** The list's default and maximum length (5b.2). */
export const BOOST_PURCHASES_LIST_LIMIT = 50;

const querySchema = z
  .object({
    sessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{1,190}$/).optional(),
    limit: z.coerce.number().int().min(1).max(BOOST_PURCHASES_LIST_LIMIT).optional(),
  })
  .strict()
  // `limit` belongs to the list only; a status read is one row.
  .refine((query) => !(query.sessionId !== undefined && query.limit !== undefined), { message: 'limit is for the list only' });

/** Package names from the active catalogue; an unreadable catalogue leaves names out, never fails the read. */
async function packageNames(): Promise<Map<string, BoostLabels>> {
  try {
    const packages = await codeBoostPackageSource().listActive();
    return new Map(packages.map((pkg) => [pkg.id, pkg.labels.name]));
  } catch {
    return new Map();
  }
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400, headers: NO_STORE }
      );
    }

    if (parsed.data.sessionId === undefined) {
      // 5b.2: the Purchases list. The current Stripe mode only (R-10): test-mode
      // rows never mix with live ones on the production database.
      let livemode: boolean;
      try {
        livemode = isLiveMode(currentStripeMode());
      } catch (error) {
        requestLogger.error({ errorName: error instanceof Error ? error.name : typeof error, userId: user.id }, 'Boost purchases list: the Stripe mode is unknown');
        return NextResponse.json({ success: false, error: 'Could not load the purchases' }, { status: 500, headers: NO_STORE });
      }
      const listed = await businessOsBoostPurchaseRepository.listForAccount(user.id, {
        livemode,
        limit: parsed.data.limit ?? BOOST_PURCHASES_LIST_LIMIT,
      });
      if (listed.error || !listed.data) {
        requestLogger.error({ errorName: listed.error?.name ?? null, userId: user.id }, 'Boost purchases list read failed');
        return NextResponse.json({ success: false, error: 'Could not load the purchases' }, { status: 500, headers: NO_STORE });
      }
      const names = listed.data.length > 0 ? await packageNames() : new Map<string, BoostLabels>();
      const purchases = listed.data.map((row) => toBoostPurchaseView(row, names));
      requestLogger.info({ userId: user.id, count: purchases.length }, 'Boost purchases listed');
      return NextResponse.json({ success: true, data: { purchases } }, { headers: NO_STORE });
    }

    const found = await businessOsBoostPurchaseRepository.findForAccountBySessionId(user.id, parsed.data.sessionId);
    if (found.error) {
      requestLogger.error({ errorName: found.error.name, userId: user.id }, 'Boost purchase status read failed');
      return NextResponse.json({ success: false, error: 'Could not load the purchase' }, { status: 500, headers: NO_STORE });
    }

    const purchase = found.data ? toBoostPurchaseView(found.data, await packageNames()) : null;
    requestLogger.info({ userId: user.id, found: purchase !== null, status: purchase?.status ?? null }, 'Boost purchase status read');
    return NextResponse.json({ success: true, data: { purchase } }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the boost purchase');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load the purchase',
        details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500, headers: NO_STORE }
    );
  }
}
