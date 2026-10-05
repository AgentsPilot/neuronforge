/**
 * A champion's friend invites (invite-only signup, Slice 5a; FR-28 to FR-31,
 * requirement §17 T-17 to T-21, F5a-5).
 *
 *   GET  /api/business-os/friend-invites   eligible? + "N of <allowance> left" + own list
 *   POST /api/business-os/friend-invites   send one friend invite; the link is shown ONCE
 *
 * ── A customer route: `requireAdmin` does NOT belong here ──────────────────
 * `getUser()` first, 401 without a session. The account is
 * `resolveAccountId(user.id)`, never read from the request (T-20). It sits
 * outside `/api/admin/**`, so the admin authz guard's counts do not move.
 *
 * ── Tenant isolation (tenant-isolation-guard) ──────────────────────────────
 * GET takes no input at all (the `my-plan` precedent: it never reads the query
 * string). POST takes a `.strict()` body of email, note and language only: the
 * plan, type, expiry, issuer, level and cap come from config and the session,
 * and any other key is a 400 with nothing written (AC-16). The body is parsed
 * BEFORE any business read (CLAUDE.md rule 2, SA R-3).
 *
 * ── The token (C-3) ─────────────────────────────────────────────────────────
 * Exists only inside the `link` of a 201. Every response is
 * `Cache-Control: no-store`. Nothing logged or audited carries the friend's
 * email, the note, the link, the token or its hash (F5a-13).
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_FRIENDS_SLICE_5A_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { friendInviteConfig, friendInviteEmailDeps, friendInviteRepositories } from '@/lib/business-os/invites/friendInviteDeps';
import {
  friendInviteRefusalMessage,
  getFriendInviteSummary,
  sendFriendInvite,
} from '@/lib/business-os/invites/friendInviteOps';
import { sendFriendInviteSchema } from '@/lib/business-os/invites/inviteSchemas';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// The invitation is sent inline after the insert (the admin route's 2a rule):
// room for one slow provider plus the fallbacks.
export const maxDuration = 30;

const logger = createLogger({ module: 'BosFriendInvitesAPI' });
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

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return failure('Unauthorized', 401);

    // The ONLY account this route can resolve (T-20). Not a parameter, by design.
    const accountId = resolveAccountId(user.id);
    const outcome = await getFriendInviteSummary({
      accountId,
      plans: friendInviteRepositories.plans,
      repository: friendInviteRepositories.repository,
      preferences: friendInviteRepositories.preferences,
      listLimit: friendInviteRepositories.listLimit,
      now: new Date(),
      logger: requestLogger,
    });

    if (!outcome.ok) {
      requestLogger.error({ accountId }, 'Could not read the friend-invite summary');
      return failure('Could not load your invites', 500);
    }

    requestLogger.info(
      outcome.summary.eligible
        ? { accountId, eligible: true, remaining: outcome.summary.remaining, invites: outcome.summary.invites.length }
        : { accountId, eligible: false },
      'Friend-invite summary read'
    );
    return NextResponse.json({ success: true, data: outcome.summary }, { status: 200, headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Friend-invite summary failed');
    return failure('Could not load your invites', 500, error instanceof Error ? error.message : String(error));
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) return failure('Unauthorized', 401);
    const accountId = resolveAccountId(user.id);

    // Zod before any business read (CLAUDE.md rule 2, SA R-3).
    const body = await request.json().catch(() => null);
    const parsed = sendFriendInviteSchema.safeParse(body);
    if (!parsed.success) {
      return failure('invalid_input', 400, parsed.error.flatten());
    }

    const outcome = await sendFriendInvite(parsed.data, {
      accountId,
      sessionEmail: user.email ?? null,
      plans: friendInviteRepositories.plans,
      repository: friendInviteRepositories.repository,
      profileRepository: friendInviteRepositories.profileRepository,
      config: friendInviteConfig(),
      now: new Date(),
      logger: requestLogger,
      email: friendInviteEmailDeps(requestLogger),
    });

    if (!outcome.ok) {
      if (outcome.refusal === null) {
        requestLogger.error({ accountId }, 'Friend invite not created');
        return failure('Could not send the invite', 500);
      }

      if (outcome.refusal === 'not_eligible') {
        // N-4 (Slice 5b, D-12): never audited, whether the switch is off or
        // the caller is not an in-force champion. Any signed-in account can
        // send this POST, so auditing it would let anyone add audit rows at
        // will, and "a non-champion was refused" carries nothing worth a
        // permanent row. Logged instead, with the correlation id.
        requestLogger.info({ accountId, refusal: outcome.refusal }, 'Friend invite refused (not audited)');
      } else {
        requestLogger.warn({ accountId, refusal: outcome.refusal }, 'Friend invite refused');
        await auditTrail
          .log({
            action: AUDIT_EVENTS.BOS_FRIEND_INVITE_REFUSED,
            entityType: 'business_os_invite',
            entityId: null,
            userId: accountId,
            actorId: accountId,
            details: { correlationId, reason: outcome.refusal },
            request,
          })
          .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));
        await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));
      }

      return NextResponse.json(
        { success: false, error: outcome.refusal, message: friendInviteRefusalMessage(outcome.refusal) },
        { status: outcome.status, headers: NO_STORE }
      );
    }

    const email = outcome.email;
    requestLogger.info({ accountId, inviteId: outcome.inviteId, emailStatus: email.status }, 'Friend invite created');

    await auditTrail
      .log({
        action: AUDIT_EVENTS.BOS_FRIEND_INVITE_CREATED,
        entityType: 'business_os_invite',
        entityId: outcome.inviteId,
        userId: accountId,
        actorId: accountId,
        details: { correlationId, language: outcome.language },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    const sent = email.status === 'sent' || email.status === 'sent_untracked';
    await auditTrail
      .log({
        action: sent ? AUDIT_EVENTS.BOS_INVITE_EMAIL_SENT : AUDIT_EVENTS.BOS_INVITE_EMAIL_NOT_SENT,
        entityType: 'business_os_invite',
        entityId: outcome.inviteId,
        userId: accountId,
        actorId: accountId,
        details:
          email.status === 'not_sent' || email.status === 'unknown'
            ? { correlationId, reason: email.reason }
            : {
                correlationId,
                provider: email.provider,
                ...(email.providerMessageId ? { providerMessageId: email.providerMessageId } : {}),
              },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    return NextResponse.json(
      {
        success: true,
        data: {
          invite: outcome.invite,
          link: outcome.link,
          // Status words only: no address, message id, error text or link (§8.1).
          email: { status: email.status },
        },
      },
      { status: 201, headers: NO_STORE }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Friend invite send failed');
    return failure('Could not send the invite', 500, error instanceof Error ? error.message : String(error));
  }
}
