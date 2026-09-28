/**
 * Business OS plans — the read endpoint behind the Tiers admin screen.
 *
 * ── Why a route at all, when the config is a module ──────────────────────
 * Because the screen is a client component, and that is deliberate: if the page
 * could import the config it could also re-derive from it, and every re-derived
 * answer is a second copy of a rule that already exists. Keeping the boundary
 * at HTTP means the page has nothing to compute — it renders fields.
 * `adminPlansView` is `server-only`, so the alternative is a build error rather
 * than a review finding.
 *
 * ── The gate ──────────────────────────────────────────────────────────────
 * `requireAdmin` is the FIRST statement, with nothing above it that touches a
 * body, the database or a queue. The repo-wide `Admin authz surface guard`
 * inspects each handler body for exactly that, and the neighbouring
 * `llm-usage` route — which hand-rolls its own check — is one of the seven
 * parked inline handlers and is not the pattern to copy.
 *
 * ── Read-only ─────────────────────────────────────────────────────────────
 * There is no POST here. The write operations live on
 * `…/entitlements/accounts/[accountId]`, audited, and stay there until the user
 * asks for buttons (v1 decision D-4).
 *
 * @see docs/workplans/business-os-tiers-admin-page.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { buildAdminPlansView } from '@/lib/business-os/entitlements/adminPlansView';
import { createLogger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosEntitlementPlansAdminAPI' });

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'bos-entitlement-plans' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const view = buildAdminPlansView();

    requestLogger.info(
      { plans: view.plans.length, mode: view.mode, matrixVersion: view.matrixVersion },
      'Business OS plans read for the admin screen'
    );

    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    // A config that cannot load is the interesting failure: the loader refuses
    // a tier that grants something unbuilt, so this is where that would surface.
    requestLogger.error({ err: error }, 'Failed to build the Business OS plans view');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not read the Business OS plans',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
