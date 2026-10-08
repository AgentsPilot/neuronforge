/**
 * GET /api/business-os/credits/boost/purchases?sessionId=cs_… — what happened
 * to the owner's own boost payment (credits boost slice 5b.1; FR-11; SA C-1,
 * C-3, Q-1).
 *
 * The dashboard's return notice polls this after Stripe sends the owner back.
 * It only READS our purchase row: it never credits, and never trusts the
 * session id beyond looking it up. Credits arrive only through the webhook.
 *
 * - The account is the session's (`getUser()`), never a parameter.
 * - The read is scoped to that account (`findForAccountBySessionId`), so
 *   another owner's session answers `{ purchase: null }`, exactly like a
 *   missing one, never a 403 that would confirm it exists.
 * - The answer is the owner view only: no Stripe ids, session id, flag reason,
 *   mode or lot id.
 * - Slice 5b.2 adds the list (no `sessionId`); until then `sessionId` is required.
 * - `Cache-Control: private, no-store`. No audit: it is a read.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { businessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPurchaseView } from '@/lib/business-os/boost/boostPurchasesView';
import type { BoostLabels } from '@/lib/business-os/boost/boostPackagesTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BoostPurchasesAPI' });
const NO_STORE = { 'Cache-Control': 'private, no-store' };

const querySchema = z
  .object({
    sessionId: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{1,190}$/),
  })
  .strict();

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
