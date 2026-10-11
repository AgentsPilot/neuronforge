/**
 * TEST ONLY — remove with the harness tab.
 *
 * POST /api/admin/business-os/test/take-credits — take N PLAN credits from one
 * Business OS account, for testing low, zero and over-plan states on the
 * `/test-business-os` "Test credits" tab (slice TC-1,
 * docs/requirements/BUSINESS_OS_TEST_TAKE_CREDITS_REQUIREMENT.md, TC-1 to TC-3,
 * SA C-1 to C-6).
 *
 * "Take N credits" records ONE test charge of N credits on the credit ledger,
 * through the existing `business_os_record_credit_charge` RPC
 * (`BusinessOsCreditChargeRepository.recordCharge`): `used` rises by N, exactly
 * as N credits of real use would. Extra credits (lots) are not touched. There is
 * no undo: the ledger is append-only. It may go below zero (over plan).
 *
 * ── Order, and nothing before it ────────────────────────────────────────────
 *   requireAdmin (401 / 403) → switch off: 404 `not_enabled` → Zod `.strict()`
 *   (400) → lower-case + the account seam → platform account 409 → the admin's
 *   own account 403 → tenant (500 / 404 `not_a_tenant`) → write → audit (only
 *   when `recorded: true`, flushed and bounded, WC-7) → 200.
 *
 * The account comes from the validated body and is checked above
 * (tenant-isolation-guard). The RPC scopes its write by `p_user_id`; the charge
 * repository runs on the service role by design (its header). `action_id` is
 * unique across all accounts, so a request id reused against another account
 * answers `recorded: false` and writes nothing: the response then says
 * "already recorded", never "taken", and no audit entry is written.
 *
 * Logs carry ids and statuses only, never the reason.
 *
 * @module app/api/admin/business-os/test/take-credits
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { isTestCreditToolsEnabled } from '@/lib/business-os/credits/testCreditToolsFlag';
import {
  ADMIN_CREDIT_GRANT_CEILING,
  CREDIT_REASON_MAX,
  CREDIT_REASON_MIN,
  refuseCreditOpForPlatformAccount,
} from '@/lib/business-os/credits/creditAdminOps';
import { isBusinessOsTenant } from '@/lib/business-os/entitlements/adminOps';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { currentCreditValue } from '@/lib/business-os/entitlements/config/creditValue';
import { businessOsCreditChargeRepository } from '@/lib/repositories/BusinessOsCreditChargeRepository';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminBosTestTakeCreditsAPI' });
const ROUTE = '/api/admin/business-os/test/take-credits';

/** The charge fields that make a test charge recognisable everywhere (requirement §1). */
const TEST_CHARGE_SERVICE = 'test_harness';
const TEST_CHARGE_ACTION_TYPE = 'test_take_credits';

const TakeCreditsSchema = z
  .object({
    accountId: z.string().uuid(),
    amount: z.number().int().positive().max(ADMIN_CREDIT_GRANT_CEILING),
    // The same bounds as a lot reason (`creditAdminOps.ts`).
    reason: z.string().trim().min(CREDIT_REASON_MIN).max(CREDIT_REASON_MAX),
    // Minted by the form once per opening; the RPC is idempotent on it. A uuid,
    // because `action_id` and `group_id` are uuid columns.
    requestId: z.string().uuid(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement. Nothing above it reads the body or touches a table.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    // The switch: off everywhere but a developer's .env.local (TC-3). Distinct
    // code so the panel can tell it from "not a tenant" (SA C-3).
    if (!isTestCreditToolsEnabled()) {
      return NextResponse.json({ success: false, error: 'not_enabled' }, { status: 404 });
    }

    const body: unknown = await request.json().catch(() => undefined);
    const parsed = TakeCreditsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.flatten() : undefined,
        },
        { status: 400 }
      );
    }
    const { amount, reason } = parsed.data;
    // Canonical form (W11b-1): Postgres matches uuids case-insensitively, JS does not.
    const accountId = resolveAccountId(parsed.data.accountId.toLowerCase());
    const requestId = parsed.data.requestId.toLowerCase();

    const platform = refuseCreditOpForPlatformAccount(accountId);
    if (platform) {
      return NextResponse.json({ success: false, error: platform.error }, { status: platform.status });
    }

    // S11-BQ-1 (requirement Q-2): never on the admin's own account.
    if (resolveAccountId(adminId).toLowerCase() === accountId) {
      return NextResponse.json({ success: false, error: 'own_account' }, { status: 403 });
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
      return NextResponse.json({ success: false, error: 'not_a_tenant' }, { status: 404 });
    }

    const written = await businessOsCreditChargeRepository.recordCharge({
      actionId: requestId,
      accountId,
      groupId: requestId,
      service: TEST_CHARGE_SERVICE,
      actionType: TEST_CHARGE_ACTION_TYPE,
      // "Automatic": never reads as the owner's own use.
      trigger: 'external',
      outcome: 'succeeded',
      credits: amount,
      // No money is involved: finance totals in USD do not move.
      costUsd: 0,
      creditValueVersion: currentCreditValue().version,
      isFallbackPriced: false,
    });
    if (written.error || !written.data) {
      requestLogger.error({ adminId, accountId, actionId: requestId }, 'Test take credits: charge write failed');
      return NextResponse.json({ success: false, error: 'charge_write_failed' }, { status: 500 });
    }
    const { recorded, periodStart, anchorSource } = written.data;

    if (!recorded) {
      // A replay, or the id already used on any account: nothing was written.
      requestLogger.info({ adminId, accountId, actionId: requestId }, 'Test take credits replayed; nothing written, no audit entry');
      return NextResponse.json({
        success: true,
        data: { accountId, credits: null, periodStart, recorded: false, status: 'already_recorded' },
      });
    }

    await logAndFlush(
      {
        action: AUDIT_EVENTS.BOS_TEST_CREDITS_TAKEN,
        entityType: 'business_os_credit_period',
        entityId: accountId,
        userId: accountId,
        actorId: adminId,
        severity: 'warning',
        details: {
          credits: amount,
          reason,
          actionId: requestId,
          periodStart,
          anchorSource,
          service: TEST_CHARGE_SERVICE,
          testOnly: true,
          correlationId,
        },
        request,
      },
      requestLogger,
      { reason: 'test take credits', continues: 'the charge stands' }
    );

    requestLogger.info({ adminId, accountId, actionId: requestId, credits: amount }, 'Test take credits recorded');
    return NextResponse.json({
      success: true,
      data: { accountId, credits: amount, periodStart, recorded: true, status: 'taken' },
    });
  } catch (error) {
    requestLogger.error({ err: error, adminId }, 'Test take credits failed');
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
