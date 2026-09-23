/**
 * Business OS entitlements — inspect and change ONE account.
 *
 * ADMIN ONLY. `requireAdmin` is the first statement of both handlers, and the
 * CI guard (`Admin authz surface guard`, a required check on main) reads each
 * exported handler's own body — so the gate is written out in each, not
 * factored into a shared wrapper.
 *
 *   GET  /api/admin/business-os/entitlements/accounts/<uuid>
 *   POST /api/admin/business-os/entitlements/accounts/<uuid>
 *
 * The GET answers "what is this account entitled to, and WHY" — every value
 * with the layer that decided it (FR-10). The POST is a validated `op` union;
 * all of its rules live in `lib/business-os/entitlements/adminOps.ts`, because
 * they are worth testing without a request and must not be re-implemented by
 * the next route.
 *
 * Order, and nothing before it: 401 → 403 → 400 (Zod) → 404/409 (pre-checks) →
 * write → cache invalidation → audit (flushed before the response, WC-7).
 *
 * @module app/api/admin/business-os/entitlements/accounts/[accountId]
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import {
  businessOsAccountPlanRepository,
  type BusinessOsEntitlementOverride,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { onboardingConversationRepository } from '@/lib/repositories/OnboardingConversationRepository';
import { adminOpSchema, executeAdminOp } from '@/lib/business-os/entitlements/adminOps';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { getEntitlementService, CACHE_TTL_SECONDS } from '@/lib/business-os/entitlements/EntitlementService';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { getEntitlementMode } from '@/lib/business-os/entitlements/mode';

const logger = createLogger({ module: 'AdminBosEntitlementsAccountAPI' });
const auditTrail = AuditTrailService.getInstance();

// Node: Pino, the catalog and the repositories are all Node-only. An
// admin-and-cookie dependent route must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const accountIdSchema = z.string().uuid();

export async function GET(request: NextRequest, context: { params: { accountId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-entitlements-account', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const parsedId = accountIdSchema.safeParse(context.params.accountId);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'invalid_account_id' }, { status: 400 });
    }

    const accountId = resolveAccountId(parsedId.data);
    const snapshot = await getEntitlementService().getSnapshot(accountId, { bypassCache: true });

    if (snapshot.unavailable || !snapshot.resolution) {
      return NextResponse.json({ success: false, error: 'entitlement_inputs_unavailable' }, { status: 503 });
    }

    const inputs = await businessOsAccountPlanRepository.findEntitlementInputs(accountId);

    requestLogger.info({ accountId }, 'Admin inspected an account\'s entitlements');

    return NextResponse.json({
      success: true,
      data: {
        accountId,
        mode: getEntitlementMode(),
        state: snapshot.resolution.state,
        basis: snapshot.resolution.basis,
        lifecycle: snapshot.resolution.lifecycle,
        anomaly: snapshot.resolution.anomaly ?? null,
        matrixVersion: snapshot.resolution.matrixVersion,
        // FR-10: the value AND the layer that decided it, per capability.
        capabilities: snapshot.resolution.values,
        ignoredOverrides: snapshot.resolution.ignoredOverrides,
        // The admin view is the ONE place override reason text appears: the
        // shadow report deliberately carries none (RC-16).
        overrides: (inputs.data?.overrides ?? []).map((row: BusinessOsEntitlementOverride) => ({
          id: row.id,
          capability: row.capability,
          op: row.op,
          value: row.value,
          reason: row.reason,
          expiresAt: row.expires_at,
          endedAt: row.ended_at,
          endedReason: row.ended_reason,
          createdAt: row.created_at,
        })),
        plan: inputs.data?.plan ?? null,
        effectiveWithinSeconds: CACHE_TTL_SECONDS,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to inspect entitlements');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: { accountId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-entitlements-account', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const parsedId = accountIdSchema.safeParse(context.params.accountId);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'invalid_account_id' }, { status: 400 });
    }

    const accountId = resolveAccountId(parsedId.data);
    const config = getEntitlementConfig();

    const body = await request.json().catch(() => null);
    const parsed = adminOpSchema(config).safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'invalid_body',
          details:
            process.env.NODE_ENV === 'development'
              ? parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
              : undefined,
        },
        { status: 400 }
      );
    }

    const outcome = await executeAdminOp(parsed.data, {
      accountId,
      adminId: gate.user.id,
      config,
      now: new Date(),
      planRepository: businessOsAccountPlanRepository,
      profileRepository: businessProfileRepository,
      onboardingRepository: onboardingConversationRepository,
    });

    if (!outcome.ok) {
      requestLogger.warn({ accountId, op: parsed.data.op, error: outcome.error }, 'Admin entitlement op refused');
      return NextResponse.json(
        { success: false, error: outcome.error, details: outcome.details },
        { status: outcome.status }
      );
    }

    // Local-instance invalidation. Other instances are bounded by the 30 s TTL,
    // which every decision already carries as `effectiveWithinSeconds`.
    getEntitlementService().invalidate(accountId);

    requestLogger.info({ accountId, op: parsed.data.op, action: outcome.action }, 'Admin entitlement op applied');

    await auditTrail
      .log({
        // The fallback cannot fire: `adminOps.test.ts` asserts that every
        // action literal in `adminOps.ts` is a registered `AUDIT_EVENTS` key,
        // by source sweep AND by running every op (SA C5-2 / QA-2). It stays
        // because an unregistered action should still produce an audit row
        // rather than `undefined` — a row named oddly beats no row at all.
        action: AUDIT_EVENTS[outcome.action as keyof typeof AUDIT_EVENTS] ?? outcome.action,
        entityType: 'business_os_account_plan',
        entityId: accountId,
        userId: accountId,
        actorId: gate.user.id,
        changes: { before: outcome.before, after: outcome.after } as unknown as Record<string, unknown>,
        details: { reason: parsed.data.reason, op: parsed.data.op, correlationId, ...outcome.data },
        severity: 'warning',
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    // WC-7: flushed BEFORE the response. A serverless instance can be frozen
    // the moment it responds, and an entitlement change with no audit row is
    // the one kind this module cannot have.
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    return NextResponse.json({ success: true, data: { accountId, op: parsed.data.op, ...outcome.data } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Admin entitlement op failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
