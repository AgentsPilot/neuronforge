/**
 * The credit top-ups of ONE Business OS account, for the admin Businesses
 * panel (credits boost slice 6a; requirement FR-22, FR-38, R-12; SA N-3, C-4,
 * Q-7; workplan §3.1).
 *
 *   GET /api/admin/business-os/credits/accounts/<uuid>/boost
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT, READ-ONLY read of one
 * admin-selected account: its boost purchases in BOTH Stripe modes (at most 50
 * each, newest first, each row carrying its own mode), its spending limit (the
 * default, the active admin override) and the last 20 limit changes.
 *
 * Order, and nothing before it (the 11c credit view's order): requireAdmin
 * (401 / 403) → 400 (Zod) → lower-case + `resolveAccountId` → 409 platform
 * account (pure, no read) → tenancy (`isBusinessOsTenant`: 500 / 404) → the
 * reads. The account comes ONLY from the URL path: no body is read and the
 * query string is ignored (tenant-isolation-guard).
 *
 * Reads run on the service role through the boost repository, every one scoped
 * `.eq('user_id', accountId)`. No `…ForWebhook` finder (2a SA C-5). An override
 * detached by an account deletion has `user_id` NULL and so can never appear
 * here (2a QA I-2). Two blocks, each failing on its own (the 11c precedent):
 * `purchases` and `cap`.
 *
 * The payload is built field by field (`boostAdminView.ts`): ids, statuses,
 * amounts in minor units, credits and dates; no email, no secret, no client
 * secret. No write and no audit row (a plain read, the 11c precedent); the log
 * carries ids, statuses and counts only.
 *
 * @module app/api/admin/business-os/credits/accounts/[accountId]/boost
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { isBusinessOsTenant } from '@/lib/business-os/entitlements/adminOps';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { BOOST_PURCHASE_CAP_DEFAULT } from '@/lib/business-os/entitlements/config/boostPackages';
import { currentStripeMode } from '@/lib/business-os/billing/stripeMode';
import { mergeNewestFirst, toAdminActiveCap, toAdminCapChange } from '@/lib/business-os/boost/boostAdminView';
import type {
  AdminBoostCapBlock,
  AdminBoostPurchasesBlock,
  AdminBoostStripeMode,
  AdminBoostView,
} from '@/lib/business-os/boost/boostAdminViewTypes';
import { businessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';

const logger = createLogger({ module: 'AdminBosBoostViewAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accountIdSchema = z.string().uuid();

/** Rows per Stripe mode (SA Q-7: both modes, each row with its own badge). */
const ADMIN_BOOST_ROWS_PER_MODE = 50;

function serverMode(): AdminBoostStripeMode | null {
  try {
    return currentStripeMode();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, context: { params: { accountId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-boost-view', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const parsedId = accountIdSchema.safeParse(context.params.accountId);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'invalid_account_id' }, { status: 400 });
    }
    // Canonical form: Postgres matches uuids case-insensitively, JS string equality does not.
    const accountId = resolveAccountId(parsedId.data.toLowerCase());

    // Pure check first: the platform account's rows are not one business's.
    if (isPlatformAccount(accountId)) {
      return NextResponse.json({ success: false, error: 'platform_account' }, { status: 409 });
    }

    const isTenant = await isBusinessOsTenant({
      accountId,
      profileRepository: businessProfileRepository,
      onboardingRepository: onboardingConversationRepository,
      planRepository: businessOsAccountPlanRepository,
    });
    if (isTenant === null) {
      return NextResponse.json({ success: false, error: 'tenant_check_failed' }, { status: 500 });
    }
    if (!isTenant) {
      return NextResponse.json({ success: false, error: 'not_a_business_os_account' }, { status: 404 });
    }

    const repository = businessOsBoostPurchaseRepository;

    const readPurchases = async (): Promise<AdminBoostPurchasesBlock> => {
      const [test, live] = await Promise.all([
        repository.listForAccount(accountId, { livemode: false, limit: ADMIN_BOOST_ROWS_PER_MODE }),
        repository.listForAccount(accountId, { livemode: true, limit: ADMIN_BOOST_ROWS_PER_MODE }),
      ]);
      if (test.error || !test.data || live.error || !live.data) return { status: 'error' };
      return {
        status: 'ok',
        rows: mergeNewestFirst(test.data, live.data),
        truncated: { test: test.data.length >= ADMIN_BOOST_ROWS_PER_MODE, live: live.data.length >= ADMIN_BOOST_ROWS_PER_MODE },
      };
    };

    const readCap = async (): Promise<AdminBoostCapBlock> => {
      const [active, history] = await Promise.all([repository.findActiveCapOverride(accountId), repository.listCapOverrides(accountId)]);
      if (active.error || history.error || !history.data) return { status: 'error' };
      return {
        status: 'ok',
        default: {
          amountMinor: BOOST_PURCHASE_CAP_DEFAULT.amountMinor,
          currency: BOOST_PURCHASE_CAP_DEFAULT.currency,
          windowDays: BOOST_PURCHASE_CAP_DEFAULT.windowDays,
        },
        active: active.data ? toAdminActiveCap(active.data) : null,
        history: history.data.map(toAdminCapChange),
      };
    };

    const [purchases, cap] = await Promise.all([readPurchases(), readCap()]);

    const data: AdminBoostView = {
      accountId,
      isOwnAccount: gate.user.id.toLowerCase() === accountId,
      serverMode: serverMode(),
      purchases,
      cap,
    };

    // Ids, statuses and counts only: never a reason, an amount or a Stripe id.
    requestLogger.info(
      {
        accountId,
        purchasesStatus: purchases.status,
        capStatus: cap.status,
        purchaseCount: purchases.status === 'ok' ? purchases.rows.length : null,
        hasOverride: cap.status === 'ok' ? cap.active !== null : null,
      },
      'Admin read a Business OS account credit top-ups'
    );

    // SA N-1: an admin's view of one account's payments is never stored by a browser or a proxy.
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business OS account credit top-ups read failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined,
      },
      { status: 500 }
    );
  }
}
