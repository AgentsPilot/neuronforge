/**
 * Business OS invites — revoke one (invite-only signup, Slice 0, FR-6).
 *
 *   POST /api/admin/business-os/invites/<uuid>/revoke   { reason }
 *
 * ADMIN ONLY. `requireAdmin` is the first statement.
 *
 * A pending or expired invite can be revoked; an accepted or already revoked
 * one cannot (409). The rule is one conditional UPDATE in the repository, so a
 * revoke racing a redemption cannot both win. Audit per C-5 / R-1: logged
 * non-blocking, then flushed before the response.
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import { revokeInviteForAdmin } from '@/lib/business-os/invites/adminInviteOps';
import { inviteIdSchema, revokeInviteSchema } from '@/lib/business-os/invites/inviteSchemas';
import { createLogger } from '@/lib/logger';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminBosInviteRevokeAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(request: NextRequest, context: { params: { inviteId: string } }) {
  const gate = await requireAdmin(logger.child({ route: 'bos-invite-revoke', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const parsedId = inviteIdSchema.safeParse(context.params.inviteId);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'invalid_invite_id' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = revokeInviteSchema.safeParse(body);
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

    const inviteId = parsedId.data;
    const outcome = await revokeInviteForAdmin(inviteId, parsed.data, {
      adminId,
      repository: businessOsInviteRepository,
      config: getEntitlementConfig(),
      now: new Date(),
    });

    if (!outcome.ok) {
      const log = outcome.status === 500 ? requestLogger.error.bind(requestLogger) : requestLogger.warn.bind(requestLogger);
      log({ inviteId, error: outcome.error }, 'Invite not revoked');
      return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    }

    requestLogger.info({ inviteId }, 'Invite revoked');

    await auditTrail
      .log({
        action: AUDIT_EVENTS.BOS_INVITE_REVOKED,
        entityType: 'business_os_invite',
        entityId: inviteId,
        userId: adminId,
        actorId: adminId,
        details: {
          correlationId,
          inviteType: outcome.row.invite_type,
          grantKind: outcome.row.grant_kind,
          grantId: outcome.row.grant_id,
          reason: outcome.row.revoke_reason,
        },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    return NextResponse.json({ success: true, data: { invite: outcome.invite } });
  } catch (error) {
    requestLogger.error({ err: error }, 'Invite revoke failed');
    return NextResponse.json(
      {
        success: false,
        error: 'could_not_revoke_invite',
        details:
          process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
