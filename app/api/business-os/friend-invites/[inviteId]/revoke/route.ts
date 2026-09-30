/**
 * A champion revokes one of their own friend invites (invite-only signup,
 * Slice 5a; FR-32, requirement §17 T-20, F5a-8).
 *
 *   POST /api/business-os/friend-invites/[inviteId]/revoke   (body absent or `{}`)
 *
 * ── A customer route, and the tenant-isolation boundary ─────────────────────
 * `getUser()` first, 401 without a session; the account is
 * `resolveAccountId(user.id)`. The ONE caller-supplied value is `inviteId`
 * (`z.string().uuid()`), and ownership is checked INSIDE the UPDATE
 * (`issuer_kind = 'account' AND issuer_account_id = <session account>`), so
 * there is no gap between checking and writing. Not found, not yours and no
 * longer revocable are one identical 404 (tenant-isolation-guard step 7).
 *
 * ── Not gated by the switch or the cohort (SA Q-2) ──────────────────────────
 * Withdrawing an invite is never harmful, so a champion whose cohort lapsed, or
 * who revokes after friend invites are switched off, can still take back a
 * live invite. It is also what makes the production no-match check possible.
 *
 * Every response is `Cache-Control: no-store`.
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_FRIENDS_SLICE_5A_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { friendInviteRepositories } from '@/lib/business-os/invites/friendInviteDeps';
import { revokeFriendInvite } from '@/lib/business-os/invites/friendInviteOps';
import { friendInviteIdSchema, revokeFriendInviteSchema } from '@/lib/business-os/invites/inviteSchemas';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BosFriendInviteRevokeAPI' });
const auditTrail = AuditTrailService.getInstance();

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function failure(error: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      success: false,
      error,
      details: process.env.NODE_ENV === 'development' ? details : undefined,
    },
    { status, headers: NO_STORE }
  );
}

/** An absent or empty body is `{}`; anything else must still pass the `.strict()` schema. */
async function readBody(request: NextRequest): Promise<unknown> {
  const text = await request.text().catch(() => '');
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest, { params }: { params: { inviteId: string } }) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return failure('Unauthorized', 401);
    const accountId = resolveAccountId(user.id);

    // Zod before anything else touches the database (CLAUDE.md rule 2).
    const id = friendInviteIdSchema.safeParse(params?.inviteId);
    const body = revokeFriendInviteSchema.safeParse(await readBody(request));
    if (!id.success || !body.success) {
      return failure('invalid_input', 400, !id.success ? id.error.flatten() : body.success ? undefined : body.error.flatten());
    }

    const outcome = await revokeFriendInvite({
      accountId,
      inviteId: id.data,
      repository: friendInviteRepositories.repository,
      now: new Date(),
    });

    if (!outcome.ok) {
      if (outcome.status === 500) {
        requestLogger.error({ accountId, inviteId: id.data }, 'Friend invite revoke failed');
        return failure('Could not revoke the invite', 500);
      }
      // One answer for not found, not yours, and no longer revocable.
      requestLogger.info({ accountId, inviteId: id.data }, 'Friend invite revoke matched no row');
      return failure('not_found', 404);
    }

    requestLogger.info({ accountId, inviteId: id.data }, 'Friend invite revoked');
    await auditTrail
      .log({
        action: AUDIT_EVENTS.BOS_FRIEND_INVITE_REVOKED,
        entityType: 'business_os_invite',
        entityId: id.data,
        userId: accountId,
        actorId: accountId,
        details: { correlationId },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    return NextResponse.json({ success: true, data: { revoked: true } }, { status: 200, headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Friend invite revoke failed');
    return failure('Could not revoke the invite', 500, error instanceof Error ? error.message : String(error));
  }
}
