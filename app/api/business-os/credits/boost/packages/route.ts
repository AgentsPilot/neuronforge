/**
 * GET /api/business-os/credits/boost/packages — the boost packages an owner can
 * see (credits boost slice 5a; requirement FR-1, FR-5, FR-28, FR-29, FR-42;
 * user decision B, 2026-10-07).
 *
 * Every signed-in owner may read it: the packages are public prices. It sells
 * nothing. `purchaseAvailable` (slice 5b, SA C-2) is decided here, on the
 * server: the checkout switch and allow-list for THIS account, and a browser
 * Stripe key in the same mode as the server key (`isBoostPurchaseAvailableFor`).
 * The checkout route stays the authority whatever the panel shows.
 *
 * - No input: no body, and any query string is ignored (so no Zod schema).
 * - Any rejection from the catalogue, or an empty list, is 503
 *   `packages_unavailable`: an empty picker would hide a broken catalogue as
 *   "nothing to sell" (slice 1 C-7 E-2). The issues are logged, never returned.
 * - `Cache-Control: private, no-store` (5a SA Q-2, revisited in 5b): the
 *   answer is now per account and follows the switch.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { codeBoostPackageSource } from '@/lib/business-os/entitlements/boostCatalogue';
import { toBoostPackageView } from '@/lib/business-os/boost/boostPackagesView';
import { isBoostPurchaseAvailableFor } from '@/lib/business-os/boost/boostCheckoutAccess';
import type { BoostPackagesPayload } from '@/lib/business-os/boost/boostPackagesTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BoostPackagesAPI' });

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    let packages;
    try {
      packages = await codeBoostPackageSource().listActive();
    } catch (error) {
      const issues = (error as { issues?: unknown })?.issues;
      requestLogger.error(
        { errorName: error instanceof Error ? error.name : typeof error, issues: Array.isArray(issues) ? issues : undefined },
        'bos_boost_packages_unavailable: the catalogue was rejected'
      );
      return NextResponse.json({ success: false, error: 'packages_unavailable' }, { status: 503, headers: NO_STORE });
    }
    if (packages.length === 0) {
      requestLogger.error({}, 'bos_boost_packages_unavailable: the catalogue has no active package');
      return NextResponse.json({ success: false, error: 'packages_unavailable' }, { status: 503, headers: NO_STORE });
    }

    const data: BoostPackagesPayload = {
      packages: packages.map(toBoostPackageView),
      purchaseAvailable: isBoostPurchaseAvailableFor(user.id, requestLogger),
    };
    requestLogger.info({ userId: user.id, count: data.packages.length, purchaseAvailable: data.purchaseAvailable }, 'Boost packages read');
    return NextResponse.json({ success: true, data }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to read the boost packages');
    return NextResponse.json(
      {
        success: false,
        error: 'packages_unavailable',
        details:
          process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 503, headers: NO_STORE }
    );
  }
}
