// lib/audit/recordRefusedAccess.ts
//
// The ONE writer of SECURITY_UNAUTHORIZED_ACCESS.
//
// Three surfaces refuse a signed-in account admin access — the API gate
// (`requireAdmin`, 85 call sites), the page gate (`requireAdminPage`, 12 pages)
// and a refused act-as (`route-identity`) — and until now all three only logged.
// The admin audit trail, the Health landing and the owner-facing monitoring page
// all READ this event; nothing wrote it, so every one of them said "no
// unauthorised access" when the truth was "we never looked".
//
// One function, three call sites, so the payload cannot drift between surfaces.
//
// ── What a row carries, and what it must never carry ───────────────────────
// `details` is a CLOSED, hand-written key set. No email, no cookie, no header
// dump, no request body, no admin identity.
//
// `request` is NEVER passed to the audit service, even though that is the
// obvious way to populate the ip_address / user_agent columns:
// `extractRequestContext` copies a live bearer or refresh token into
// `session_id` (AuditTrailService.ts:210-216). A refusal row is read by admins
// investigating a probe; it must not hand them the prober's credential, and it
// must not become a place credentials accumulate.
//
// So IP and user agent go in `details` instead (SA D-1, option a). The columns
// stay NULL on these rows, which is invisible: app/admin/audit-trail/page.tsx
// renders no ip_address column.
//
// Severity and compliance flags are NOT passed either. The registration in
// events.ts owns the classification — the lesson of PR #157 / #160, where a
// route's `severity: 'critical'` outlived the decision behind it.
//
// NEVER THROWS. Both gates call this immediately before refusing; an audit
// failure must not turn a 403 into a 500, and must certainly never grant
// access.
//
// ── An accepted cost, written down because the bound IS the cost ───────────
// A refused call now occupies up to AUDIT_FLUSH_TIMEOUT_MS of serverless
// compute instead of tens of milliseconds, across 85 route call sites, and
// there is no rate limiter anywhere (a per-IP limit is owed from the invite
// work). So "we bounded it at 2 s" is not a mitigation of that — it is the
// amplification factor. Accepted because the normal case is one small insert
// far below the bound, and because access is already denied before this runs:
// a slow database can delay a refusal, never grant one.

import { headers } from 'next/headers';

import type { AuditLogInput } from './types';
import { AUDIT_EVENTS } from './events';
import { logAndFlush, type AuditFlushLogger } from './boundedAuditFlush';

/**
 * Which surface said no. Recorded instead of a path, because `requireAdmin`
 * cannot know its own route without a parameter and a partial path is worse
 * than an exact surface (SA D-2). Vercel's `x-matched-path` is read nowhere in
 * this repo, so relying on it inside a fail-closed path would be an unverified
 * dependency.
 *
 * Pinned as a list by test so a fourth call site cannot invent a spelling.
 */
export const REFUSED_SURFACES = ['admin_api', 'admin_page', 'act_as'] as const;
export type RefusedSurface = (typeof REFUSED_SURFACES)[number];

/** The only reason this writer records. A refusal that is not this is a bug. */
export const REFUSAL_REASON = 'not_an_admin';

/**
 * Caller-supplied request metadata, for the one site that holds a
 * `NextRequest` and so must not reach for the ambient `headers()` (SA D-1
 * condition 3). Omit it and the values are read from `next/headers` instead.
 */
export interface RefusedAccessHeaders {
  ip?: string | null;
  userAgent?: string | null;
}

export interface RecordRefusedAccessParams {
  /**
   * The refused SESSION user. Required and non-null — never the act-as target,
   * and never omitted: `buildLogEntry` falls back to SYSTEM_ADMIN_USER_ID when
   * `userId` is empty (AuditTrailService.ts:145-148), which would attribute a
   * customer's refusal to the platform.
   */
  userId: string;
  surface: RefusedSurface;
  logger: AuditFlushLogger;
  /** Known only where the caller has it (the act-as site). Omitted elsewhere. */
  route?: string | null;
  /** Act-as only: who the caller asked to act as. Never the row's `user_id`. */
  requestedUserId?: string | null;
  /** Act-as only: derived from the request the caller already holds. */
  headers?: RefusedAccessHeaders;
}

/**
 * IP and user agent from the ambient request, or `undefined` for either.
 *
 * `headers()` throws outside a request scope (and in a unit test), and this
 * function sits one statement before a 403. It must not be able to raise.
 */
function readAmbientHeaders(): RefusedAccessHeaders {
  try {
    const h = headers();
    return {
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip'),
      userAgent: h.get('user-agent'),
    };
  } catch {
    return {};
  }
}

/**
 * Record one refused admin access, and write it out before the caller refuses.
 *
 * Resolves either way; never rejects.
 */
export async function recordRefusedAccess(params: RecordRefusedAccessParams): Promise<void> {
  const { userId, surface, logger, route, requestedUserId } = params;
  const { ip, userAgent } = params.headers ?? readAmbientHeaders();

  /*
   * Unknown values OMIT their key rather than writing 'unknown'.
   *
   * A deliberate divergence from the precedent this is otherwise modelled on
   * (app/api/user/change-password/route.ts:67-73 writes the string 'unknown'),
   * on SA's ruling: "not captured" and "captured as unknown" have to stay
   * distinguishable, or nobody can tell a proxy-stripped header from a gap in
   * this code. Same principle as CLAUDE.md § Currency & Timezone's
   * NULL-vs-'UTC' rule.
   */
  const details: Record<string, unknown> = { surface, reason: REFUSAL_REASON };
  if (route) details.route = route;
  if (requestedUserId) details.requestedUserId = requestedUserId;
  if (ip) details.ip_address = ip;
  if (userAgent) details.user_agent = userAgent;

  const entry: AuditLogInput = {
    action: AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS,
    // The refusal happened to a platform surface, not to anyone's record, so
    // there is no row it happened to. 'system' is the registered entity type
    // for platform-level entries (precedent: lib/audit/admin-helpers.ts:19).
    entityType: 'system',
    entityId: null,
    // Both the subject and the actor: a refusal is about the caller, and
    // nobody else was involved.
    userId,
    actorId: userId,
    details,
    // No severity, no complianceFlags, no request. See the module header.
  };

  await logAndFlush(entry, logger, {
    reason: 'refused admin access',
    continues: 'the refusal is unaffected',
  });
}
