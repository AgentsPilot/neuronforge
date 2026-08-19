/**
 * Server-side identity resolution for API routes that historically accepted a
 * caller-supplied `userId`.
 *
 * THE RULE: a `userId` in a request body or query string is NEVER an identity claim.
 * Identity comes from the session cookie. A supplied id is at most a request to *act as*
 * someone else, and that is granted only to platform admins.
 *
 * Why this exists: several `/api/plugins/*` and `/api/plugin-connections` handlers took
 * `userId` from the caller with no authentication at all, which allowed anonymous
 * execution of plugin actions, credential reads/writes, and destructive disconnects
 * against arbitrary accounts. See
 * docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md.
 *
 * Fails closed at every step: no session → 401; malformed target id → 400;
 * non-admin act-as → 403; admin lookup error → 403 (AdminAccessService returns false).
 */

import { NextRequest } from 'next/server';
import { getUser } from '@/lib/auth';
import { adminAccessService } from '@/lib/services/AdminAccessService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'RouteIdentity' });
const auditTrail = AuditTrailService.getInstance();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IdentityResolution =
  | {
      ok: true;
      /** The user the route should act on behalf of. Use this — never the raw input. */
      userId: string;
      /** The authenticated session user (equals userId unless actingAs). */
      sessionUserId: string;
      sessionUserEmail: string | null;
      /** True when an admin is acting on another user's behalf (audited). */
      actingAs: boolean;
    }
  | { ok: false; status: 400 | 401 | 403; error: string };

export interface ResolveIdentityOptions {
  /** The id the caller asked to act as, if any (body or query). */
  requestedUserId?: string | null;
  /** Route identifier for logging + the audit trail, e.g. 'POST /api/plugins/execute'. */
  route: string;
  /** Passed to the audit trail so IP / user-agent / session context is captured. */
  request?: NextRequest;
  /** Extra audit detail, e.g. { pluginName, actionName }. */
  details?: Record<string, unknown>;
}

/**
 * Resolve the acting user for a route.
 *
 * Deliberately uses `getUser()` rather than `getCachedUser()`: this is a security
 * boundary, so no auth-result caching, and `getUser()` builds a `createServerClient`
 * over `cookieStore.getAll()`, which handles the CHUNKED Supabase auth cookies this
 * project sets (`sb-<ref>-auth-token.0/.1/…`). Helpers that look up a single unchunked
 * cookie name silently miss those sessions — which is what the removed
 * "fall back to a caller-supplied userId" branches were masking.
 *
 * When an admin acts as another user, this writes the audit entry itself so no call
 * site can forget to.
 */
export async function resolveActingUserIdentity(
  options: ResolveIdentityOptions
): Promise<IdentityResolution> {
  const { requestedUserId, route, request, details } = options;

  // getUser() has no internal try/catch — a Supabase network error throws, and that
  // must be a 401, never an unhandled 500.
  let sessionUser: Awaited<ReturnType<typeof getUser>> = null;
  const authStartedAt = Date.now();
  try {
    sessionUser = await getUser();
  } catch (error) {
    logger.error({ err: error, route }, 'Session lookup failed — refusing request');
    return { ok: false, status: 401, error: 'Authentication required' };
  } finally {
    // Measured, not argued: this is the cost of dropping the (chunk-unaware) auth cache.
    // If it proves material, the fix is a chunk-aware cache INSIDE this resolver with an
    // explicit staleness/revocation decision — never a caller-supplied-id fallback.
    logger.debug({ route, durationMs: Date.now() - authStartedAt }, 'Session lookup completed');
  }

  if (!sessionUser) {
    return { ok: false, status: 401, error: 'Authentication required' };
  }

  const sessionUserId = sessionUser.id;
  const sessionUserEmail = sessionUser.email ?? null;

  // No target at all → not an act-as.
  if (!requestedUserId) {
    return { ok: true, userId: sessionUserId, sessionUserId, sessionUserEmail, actingAs: false };
  }

  // Validate before anything else: an unvalidated string would otherwise flow into cache
  // keys, executor lookups and audit rows.
  if (!UUID_RE.test(requestedUserId)) {
    return { ok: false, status: 400, error: 'userId must be a valid UUID' };
  }

  // Canonicalise. Postgres compares `uuid` case-insensitively, but our in-process cache
  // keys (`plugin-status-${userId}`) are plain strings — an act-as with an upper-case
  // UUID would otherwise address a second, parallel cache entry for the same account.
  // Comparing canonically also means passing your OWN id in upper case is still a
  // self-target, not a 403.
  const targetUserId = requestedUserId.toLowerCase();

  if (targetUserId === sessionUserId.toLowerCase()) {
    return { ok: true, userId: sessionUserId, sessionUserId, sessionUserEmail, actingAs: false };
  }

  // isAdmin (not isAdminById): it also honours the seeded-by-email self-heal and the
  // ADMIN_EMAILS bootstrap, so an operator whose admin_users row is not yet bound to a
  // user_id is not locked out. admin_users is the only trusted admin signal — never
  // profiles.role (CLAUDE.md security rules).
  // AdminAccessService already swallows its own errors and returns false, but do not
  // depend on that contract: if it ever throws, this must still deny rather than become
  // an unhandled 500.
  let isAdmin = false;
  try {
    isAdmin = await adminAccessService.isAdmin({ id: sessionUserId, email: sessionUserEmail });
  } catch (error) {
    logger.error({ err: error, route, sessionUserId }, 'Admin check failed — denying act-as');
    return { ok: false, status: 403, error: 'Not permitted to act on behalf of another user' };
  }

  if (!isAdmin) {
    logger.warn(
      { route, sessionUserId, requestedUserId },
      'Act-as refused — session user is not a platform admin'
    );
    return { ok: false, status: 403, error: 'Not permitted to act on behalf of another user' };
  }

  logger.info({ route, sessionUserId, targetUserId }, 'Admin acting on behalf of user');

  // userId = the subject of the action, actorId = who actually did it (audit schema).
  // Non-blocking: an audit failure must not deny a legitimate admin action.
  auditTrail
    .log({
      action: AUDIT_EVENTS.PLUGIN_ACT_AS,
      entityType: 'connection',
      entityId: targetUserId,
      userId: targetUserId,
      actorId: sessionUserId,
      details: { route, adminEmail: sessionUserEmail, ...(details ?? {}) },
      severity: 'critical',
      complianceFlags: ['SOC2'],
      request,
    })
    .catch((err) => logger.error({ err, route }, 'Act-as audit write failed (non-blocking)'));

  return {
    ok: true,
    userId: targetUserId,
    sessionUserId,
    sessionUserEmail,
    actingAs: true,
  };
}
