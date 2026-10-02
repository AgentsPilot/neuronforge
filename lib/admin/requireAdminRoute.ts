/**
 * The shared admin gate for `/api/admin/*` route handlers.
 *
 * Extracted (Layer 2 Step 0, Q-1) from the inline precedent in
 * `app/api/admin/business-os/llm-usage/route.ts:49-64`, because Step 0 applies
 * the same three lines to six handlers in three files. The precedent routes are
 * left unchanged.
 *
 * Rules this encodes, none of them optional:
 * - Admin identity comes from `AdminAccessService` (the `admin_users` table)
 *   and NEVER from `profiles.role`, which is user-writable
 *   (see docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md).
 * - Fail closed: an admin check that throws is a "no", not an error page.
 * - Order: 401 signed out → 403 not an admin. Nothing else (no body parse, no
 *   database read, no write) may happen before this returns a user.
 * - Logs carry `userId` only — never the email, which is personal data and is
 *   not needed to investigate a denial.
 * - A refusal that ANSWERED NO is written to the audit trail before the 403,
 *   through a bounded flush. A refusal because the check THREW is not: see the
 *   comment at the write.
 *
 * Middleware does not protect `/api` (`middleware.ts:83`), so this gate is the
 * only thing between an anonymous request and an admin handler.
 *
 * @module lib/admin/requireAdminRoute
 */

import { NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { recordRefusedAccess } from '@/lib/audit/recordRefusedAccess';
import { AdminAccessService } from '@/lib/services/AdminAccessService';

/** The subset of the authenticated user an admin handler needs. */
export interface AdminRouteUser {
  id: string;
  email?: string;
}

/**
 * Only the levels this helper uses, so a route can pass either a Pino logger or
 * a child logger without a structural-type fight.
 */
export interface AdminGateLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

/**
 * Discriminated union: a `NextResponse` means "already refused, return it as
 * is"; anything else carries the admin.
 */
export type RequireAdminResult = { user: AdminRouteUser } | NextResponse;

/**
 * Resolve the caller to an admin, or to the response that refuses them.
 *
 * ```ts
 * const gate = await requireAdmin(requestLogger);
 * if (gate instanceof NextResponse) return gate;
 * const { user } = gate;
 * ```
 */
export async function requireAdmin(logger: AdminGateLogger): Promise<RequireAdminResult> {
  // `getUser()` can throw on a Supabase outage or a malformed cookie jar. Without
  // this guard the exception escaped to the handler's outer catch and the caller
  // got a 500, contradicting this helper's contract (QA D-Q3). Treated as "not
  // signed in": no session could be established, and no data access follows.
  let user: Awaited<ReturnType<typeof getUser>> = null;
  try {
    user = await getUser();
  } catch (err) {
    logger.error({ err }, 'Auth lookup threw; treating the caller as signed out');
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  /*
   * Three-valued, not a boolean, so the write below can tell "we asked and the
   * answer was no" from "we could not ask".
   *
   * A thrown check used to leave `isAdmin === false` and fall into the same
   * branch as a real refusal — which would make a Supabase outage look like a
   * burst of unauthorised access attempts on the admin Health landing. Starts
   * at 'threw' so a future `return` added inside the try cannot leave it
   * accidentally optimistic.
   */
  let answer: 'yes' | 'no' | 'threw' = 'threw';
  try {
    answer = (await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email }))
      ? 'yes'
      : 'no';
  } catch (err) {
    // Fail closed: a check that cannot answer is a "no".
    logger.error({ err, userId: user.id }, 'Admin check threw; denying access');
  }

  if (answer !== 'yes') {
    logger.warn({ userId: user.id }, 'Non-admin attempted an admin request');
    /*
     * Awaited on purpose. This handler is about to return and the serverless
     * instance may freeze immediately, so a queued-but-unflushed row is lost —
     * which is why nothing was ever recorded here. `recordRefusedAccess` never
     * throws and is bounded at 2 s, so the worst case is a slow 403: access is
     * already denied before the write runs, and a failing audit trail can
     * never grant it.
     *
     * Only on 'no'. A check that threw produces NO row (OQ-3(a)): the tile this
     * feeds must mean "someone was refused", not "the database was down".
     */
    if (answer === 'no') {
      await recordRefusedAccess({ userId: user.id, surface: 'admin_api', logger });
    }
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  return { user: { id: user.id, email: user.email } };
}
