/**
 * Business OS invites — list and create (invite-only signup, Slice 0).
 *
 *   GET  /api/admin/business-os/invites   the newest 500 invites + the form's options
 *                                         (Slice 1c: the screen filters and searches them;
 *                                         the route takes no query parameters)
 *   POST /api/admin/business-os/invites   create one invite; the link is shown ONCE, and
 *                                         (Slice 2a) the invitation is emailed when
 *                                         `sendEmail` is true
 *
 * ADMIN ONLY. `requireAdmin` is the first statement of each handler, with
 * nothing above it that touches a body, the database or a queue; the repo-wide
 * `Admin authz surface guard` reads each handler's own body for exactly that.
 *
 * Every rule lives in `lib/business-os/invites/adminInviteOps.ts`. This file is
 * the HTTP shape: validate (Zod, `.strict()`), call, audit, respond.
 *
 * ── The token (C-3) ─────────────────────────────────────────────────────────
 * The raw token exists only inside the `link` of a 201, sent with
 * `Cache-Control: no-store`. It is never logged and never audited: the log line
 * and the audit entry carry the invite id, the grant and the expiry, and
 * neither carries the token, its hash or the invited email.
 *
 * ── The audit (C-5, R-1) ────────────────────────────────────────────────────
 * Non-blocking, then flushed before the response (WC-7): a serverless instance
 * can be frozen the moment it responds, and neither call can fail the request.
 * The invite row itself is the durable record (§8.3).
 *
 * ── The invitation email (Slice 2a, FR-14 to FR-16) ─────────────────────────
 * Sent inline after the row exists (`createInviteForAdmin`), so `maxDuration`
 * covers a slow provider. A failed send is still a 201 WITH the link: the
 * response's `email.status` says `not_sent` and the admin copies the link. The
 * audit writes `BOS_INVITE_CREATED`, then `BOS_INVITE_EMAIL_SENT` or
 * `BOS_INVITE_EMAIL_NOT_SENT`, each with the admin as actor (SA R-8), and
 * neither carries the invitee email, the link, the token or the hash. The
 * Reply-To is the admin's own email from the gate, never a body field.
 *
 * ── The language default (Slice 2a, D-8) ────────────────────────────────────
 * GET pre-selects the admin's saved language (`user_preferences`); a failed
 * read is a warning and English.
 *
 * @see docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { getEntitlementMode } from '@/lib/business-os/entitlements/mode';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import {
  buildInviteFormOptions,
  createInviteForAdmin,
  listInvitesForAdmin,
  resolveInviteFormLanguage,
} from '@/lib/business-os/invites/adminInviteOps';
import { createInviteSchema } from '@/lib/business-os/invites/inviteSchemas';
import { createLogger } from '@/lib/logger';
import { platformSenderAddress, sendEmail } from '@/lib/notifications/emailTransport';
import { businessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import { businessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { userProfileRepository } from '@/lib/repositories/UserProfileRepository';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

// Node: node:crypto, Pino and the repositories. Admin- and cookie-dependent,
// so never cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Slice 2a (D-5): the invitation is sent inline, after the insert. A provider
// that hangs must not leave the admin without the link, so the function gets
// room for one slow send plus the fallbacks.
export const maxDuration = 30;

const logger = createLogger({ module: 'AdminBosInvitesAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'bos-invites', method: 'GET' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });

  try {
    const config = getEntitlementConfig();
    const listed = await listInvitesForAdmin({
      repository: businessOsInviteRepository,
      lineage: businessOsAccountLineageRepository,
      config,
      now: new Date(),
      logger: requestLogger,
    });

    if (!listed.ok) {
      requestLogger.error('Failed to read invites');
      return NextResponse.json({ success: false, error: 'could_not_read_invites' }, { status: 500 });
    }

    const defaultLanguage = await resolveInviteFormLanguage({
      adminId: gate.user.id,
      preferences: userPreferencesRepository,
      logger: requestLogger,
    });

    requestLogger.info({ invites: listed.invites.length, truncated: listed.truncated }, 'Admin read the invite list');

    return NextResponse.json({
      success: true,
      data: {
        invites: listed.invites,
        // T-16: "N signups stopped halfway" (counts and invite ids only).
        stoppedHalfway: listed.stoppedHalfway,
        // Slice 1c: the ceiling was reached; older invites are not in this list.
        truncated: listed.truncated,
        formOptions: buildInviteFormOptions(config, defaultLanguage),
        // GR-5: the page states that champion access is recorded, not enforced.
        enforcementMode: getEntitlementMode(),
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Invite list failed');
    return NextResponse.json(
      {
        success: false,
        error: 'could_not_read_invites',
        details:
          process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'bos-invites', method: 'POST' }));
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const adminId = gate.user.id;
  const requestLogger = logger.child({ correlationId, adminId });

  try {
    const body = await request.json().catch(() => null);
    const parsed = createInviteSchema.safeParse(body);

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

    const outcome = await createInviteForAdmin(parsed.data, {
      adminId,
      // D-2: the Reply-To snapshot comes from the gate, never the body.
      adminEmail: gate.user.email ?? null,
      repository: businessOsInviteRepository,
      profileRepository: userProfileRepository,
      config: getEntitlementConfig(),
      now: new Date(),
      logger: requestLogger,
      email: {
        sendEmail,
        senderAddress: platformSenderAddress,
        now: () => new Date(),
        logger: requestLogger,
      },
    });

    if (!outcome.ok) {
      const log = outcome.status === 500 ? requestLogger.error.bind(requestLogger) : requestLogger.warn.bind(requestLogger);
      log({ inviteType: parsed.data.inviteType, error: outcome.error }, 'Invite not created');
      return NextResponse.json({ success: false, error: outcome.error }, { status: outcome.status });
    }

    const row = outcome.row;
    const email = outcome.email;
    requestLogger.info(
      {
        inviteId: row.id,
        inviteType: row.invite_type,
        grantKind: row.grant_kind,
        linkExpiryDays: row.link_expiry_days,
        emailRequested: email.requested,
        emailStatus: email.status,
      },
      'Invite created'
    );

    await auditTrail
      .log({
        action: AUDIT_EVENTS.BOS_INVITE_CREATED,
        entityType: 'business_os_invite',
        entityId: row.id,
        userId: adminId,
        actorId: adminId,
        details: {
          correlationId,
          inviteType: row.invite_type,
          grantKind: row.grant_kind,
          grantId: row.grant_id,
          accessOpenEnded: row.access_open_ended,
          accessMonths: row.access_months,
          linkExpiryDays: row.link_expiry_days,
          linkExpiresAt: row.link_expires_at,
          language: row.language,
          reason: row.internal_reason,
          emailRequested: email.requested,
        },
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    if (email.requested) {
      // R-8: the admin is the actor, as for the create. Never the address, the
      // link, the token, the hash or a provider's error text.
      // QA2a-1: a send not confirmed in time is audited as NOT_SENT with the
      // reason `send_timeout` (it may still arrive; the row says "Unknown").
      const sent = email.status === 'sent' || email.status === 'sent_untracked';
      await auditTrail
        .log({
          action: sent ? AUDIT_EVENTS.BOS_INVITE_EMAIL_SENT : AUDIT_EVENTS.BOS_INVITE_EMAIL_NOT_SENT,
          entityType: 'business_os_invite',
          entityId: row.id,
          userId: adminId,
          actorId: adminId,
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
    }

    await auditTrail.flush().catch((err) => requestLogger.error({ err }, 'Audit flush failed'));

    return NextResponse.json(
      {
        success: true,
        data: {
          invite: outcome.invite,
          link: outcome.link,
          // Status words only: no address, message id, error text or link (§8.1).
          email: { requested: email.requested, status: email.status },
        },
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    requestLogger.error({ err: error }, 'Invite creation failed');
    return NextResponse.json(
      {
        success: false,
        error: 'could_not_create_invite',
        details:
          process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : String(error)) : undefined,
      },
      { status: 500 }
    );
  }
}
