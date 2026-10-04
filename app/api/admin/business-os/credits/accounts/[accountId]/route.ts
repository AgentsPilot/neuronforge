/**
 * The credit position of ONE Business OS account, for the admin Businesses
 * panel (credit deduction slice 11c, workplan "11c — Admin per-account credit
 * view"; requirement S11-AC-6 as corrected by S11-CR-3).
 *
 *   GET /api/admin/business-os/credits/accounts/<uuid>
 *
 * ADMIN ONLY, and a deliberate CROSS-ACCOUNT, READ-ONLY read of one
 * admin-selected account, in CREDITS only: the plan allowance and the layer
 * that decided it, used this period (by the owner / automatic), plan left,
 * over the plan, extra credits, and the account's lots with their take-backs.
 * No USD, cost, token, model or idempotency key; no combined "remaining" of
 * plan and extra credits (S11-CR-3: that figure is slice 9's).
 *
 * Order, and nothing before it: requireAdmin (401 / 403) → 400 (Zod) →
 * lower-case + the account seam → 409 platform account (pure, no read) →
 * tenancy (the SAME `isBusinessOsTenant` the entitlements and summary routes
 * use: 500 / 404) → the reads. The account comes ONLY from the URL path: no
 * body is read and the query string is ignored (tenant-isolation-guard).
 *
 * The reads run on the service role (`adminCreditPositionDeps.ts` documents
 * why and how each is scoped to this one account). Two blocks, each failing on
 * its own (SA OP-26): `usage` (the owner card's builder, `readCreditPosition`,
 * so the figures match the card by construction) and `extra` (`extraCreditsAt`,
 * the one definition, S11-SQ-4). An unavailable entitlement snapshot is
 * `allowanceStatus: 'unavailable'`, never "no allowance".
 *
 * Display only: `getSnapshot`, never `check()` / `decide()`; it refuses
 * nothing. No write of any kind (SA W11c-16) and no audit row (a plain read,
 * SA OP-36). The log carries ids, statuses and counts, never a reason or a
 * figure.
 *
 * @module app/api/admin/business-os/credits/accounts/[accountId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { isBusinessOsTenant } from '@/lib/business-os/entitlements/adminOps';
import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { creditAllowanceDecision } from '@/lib/business-os/entitlements/creditAllowanceView';
import { readCreditPosition } from '@/lib/business-os/credits/ownerCreditUsage';
import { adminCreditPositionDeps } from '@/lib/business-os/credits/adminCreditPositionDeps';
import { extraCreditsAt } from '@/lib/business-os/credits/creditLots';
import { computeCreditBalance, roundToLedger } from '@/lib/business-os/credits/creditBalance';
import {
  ADMIN_CREDIT_GRANT_CEILING,
  CREDIT_REASON_MAX,
  CREDIT_REASON_MIN,
} from '@/lib/business-os/credits/creditAdminOps';
import type {
  AdminCreditAllowanceLayer,
  AdminCreditExtraBlock,
  AdminCreditLot,
  AdminCreditPosition,
  AdminCreditUsageBlock,
} from '@/lib/business-os/credits/adminCreditPositionTypes';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';
import type { BusinessOsCreditLotRow } from '@/lib/repositories/BusinessOsCreditLotRepository';

const logger = createLogger({ module: 'AdminBosCreditPositionAPI' });

// Node: Pino and the repositories are Node-only. An admin- and cookie-dependent
// GET must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accountIdSchema = z.string().uuid();

/** Newest first, for display. Ties keep the repository's order. */
function newestFirst(rows: readonly BusinessOsCreditLotRow[]): BusinessOsCreditLotRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Date.parse(b.row.createdAt) - Date.parse(a.row.createdAt) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * The `extra` block. Positions are joined to rows by `id`, never by index (SA
 * W11c-11). A lot with no position was created after `now` (clock skew between
 * the server and the database, typically on the re-read straight after a
 * gift): it is listed with its granted credits, not counted and not offered
 * for Take back, exactly as the one function decides.
 */
function buildExtraBlock(rows: readonly BusinessOsCreditLotRow[], now: Date): AdminCreditExtraBlock {
  const position = extraCreditsAt(rows, now);
  if (!position) return { status: 'error' };
  const byId = new Map(position.lots.map((lot) => [lot.id, lot]));

  const lots: AdminCreditLot[] = newestFirst(rows).map((row) => {
    const at = byId.get(row.id);
    return {
      id: row.id,
      source: row.source,
      credits: row.creditsGranted,
      remaining: at ? at.remaining : row.creditsGranted,
      expired: at ? at.expired : false,
      counted: at !== undefined,
      expiresAt: row.expiresAt,
      reason: row.reason,
      actorKind: row.actorKind,
      actorAdminId: row.actorAdminId,
      createdAt: row.createdAt,
      takeBacks: row.draws.map((draw) => ({
        id: draw.id,
        credits: draw.credits,
        reason: draw.reason,
        actorAdminId: draw.actorAdminId,
        createdAt: draw.createdAt,
      })),
    };
  });

  return {
    status: 'ok',
    extraCredits: position.extraCredits,
    hasInconsistentLot: position.hasInconsistentLot,
    lots,
  };
}

export async function GET(request: NextRequest, context: { params: { accountId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-credit-position', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const parsedId = accountIdSchema.safeParse(context.params.accountId);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'invalid_account_id' }, { status: 400 });
    }
    // Canonical form (W11b-1 precedent): Postgres matches uuids case-insensitively,
    // JS string equality does not.
    const accountId = resolveAccountId(parsedId.data.toLowerCase());

    // Pure check first (S11-CR-1): the platform account's rows are not one business's.
    if (isPlatformAccount(accountId)) {
      return NextResponse.json({ success: false, error: 'platform_account' }, { status: 409 });
    }

    const isTenant = await isBusinessOsTenant({
      accountId,
      profileRepository: businessProfileRepository,
      onboardingRepository: onboardingConversationRepository,
      // L-4 (invite-only signup, Slice 1b): a plan row alone makes a tenant.
      planRepository: businessOsAccountPlanRepository,
    });
    if (isTenant === null) {
      return NextResponse.json({ success: false, error: 'tenant_check_failed' }, { status: 500 });
    }
    if (!isTenant) {
      return NextResponse.json({ success: false, error: 'not_a_business_os_account' }, { status: 404 });
    }

    // One `now` for every figure of this answer.
    const now = new Date();
    const deps = adminCreditPositionDeps();

    const readUsage = async (): Promise<AdminCreditUsageBlock> => {
      // The snapshot is read ONCE, fresh (as the entitlements GET does), for
      // both the allowance and the layer; the builder gets the allowance through
      // `readAllowance`, so "no plan row → no allowance" is still decided there.
      let allowanceStatus: 'ok' | 'unavailable' = 'ok';
      let decision: { allowance: { amount: number; per: 'month' | 'total' } | null; layer: AdminCreditAllowanceLayer | null } = {
        allowance: null,
        layer: null,
      };
      try {
        const snapshot = await getEntitlementService().getSnapshot(accountId, { bypassCache: true });
        if (snapshot.unavailable) allowanceStatus = 'unavailable';
        else decision = creditAllowanceDecision(snapshot);
      } catch (err) {
        requestLogger.error({ err, accountId }, 'Entitlement snapshot threw; credit view shows usage with no allowance');
        allowanceStatus = 'unavailable';
      }

      const read = await readCreditPosition(
        accountId,
        { ...deps, now: () => now, readAllowance: async () => decision.allowance },
        requestLogger,
        'Admin credit position read failed'
      );
      if (read.error || !read.data) return { status: 'error' };
      const position = read.data;

      const allowance = position.allowance ? { amount: position.allowance.amount, per: position.allowance.per } : null;
      return {
        status: 'ok',
        // The window comes from the position only: never re-derived here (SA W11c-13).
        period: { kind: position.kind, key: position.key, resetsOn: position.resetsOn },
        allowanceStatus,
        allowance,
        allowanceLayer: allowance ? decision.layer : null,
        used: position.used,
        usedByOwner: position.usedByOwner,
        usedAutomatic: position.usedAutomatic,
        planLeft: computeCreditBalance({ allowance: allowance?.amount ?? null, granted: 0, used: position.used }),
        overPlan: allowance ? Math.max(0, roundToLedger(position.used - allowance.amount)) : null,
      };
    };

    const readExtra = async (): Promise<AdminCreditExtraBlock> => {
      const listed = await deps.lots.listLotsWithDraws(accountId);
      // A read error, or the 1,000-row ceiling (the repository answers an error).
      if (listed.error || !listed.data) return { status: 'error' };
      return buildExtraBlock(listed.data, now);
    };

    const [usage, extra] = await Promise.all([readUsage(), readExtra()]);

    const data: AdminCreditPosition = {
      accountId,
      isOwnAccount: gate.user.id.toLowerCase() === accountId,
      limits: { grantCeiling: ADMIN_CREDIT_GRANT_CEILING, reasonMin: CREDIT_REASON_MIN, reasonMax: CREDIT_REASON_MAX },
      usage,
      extra,
    };

    // Never a reason and never a figure: ids, statuses and counts only.
    requestLogger.info(
      {
        accountId,
        usageStatus: usage.status,
        extraStatus: extra.status,
        lotCount: extra.status === 'ok' ? extra.lots.length : null,
      },
      'Admin read a Business OS account credit position'
    );

    return NextResponse.json({ success: true, data });
  } catch (error) {
    requestLogger.error({ err: error }, 'Business OS account credit position failed');
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
