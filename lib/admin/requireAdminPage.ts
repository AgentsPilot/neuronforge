/**
 * The shared admin gate for `/admin` PAGES — the page-surface sibling of
 * `requireAdminRoute`.
 *
 * Rules this encodes, none of them optional, and all shared with the route gate:
 * - Admin identity comes from `AdminAccessService` (the `admin_users` table)
 *   and NEVER from `profiles.role`, which is user-writable.
 * - Fail closed: a check that throws is a "no", not an error page.
 * - Logs carry `userId` only — never the email.
 *
 * ── Why a redirect instead of a 403 page ──────────────────────────────────
 * BQ-3, answered by the user: a non-admin is silently sent to their normal
 * dashboard. On a public repository, pre-launch, we do not confirm to someone
 * probing a guessed URL that an admin area exists there.
 *
 * The constraint that makes that worth anything: **an anonymous visitor and a
 * signed-in non-admin must get the same RESPONSE.** If anonymous went to
 * `/login` and a non-admin went to `/business-os`, the difference between the
 * two responses would itself be the disclosure the choice was meant to prevent.
 * So both get the same redirect, and a test asserts it.
 *
 * ONE QUALIFIER, added when the refusal became audited (SA review M-4): the
 * responses are identical, the LATENCY is not. A signed-in non-admin's redirect
 * waits on a bounded audit flush (up to 2 s); an anonymous visitor's does not,
 * because there is no identity to record. That is a timing side channel, and it
 * is accepted: the secret this property protects is "does an admin area exist
 * at this URL", and only a caller who already holds a valid session can observe
 * the slow path — at which point it tells them nothing they did not know by
 * being signed in. Do not "fix" it by deleting the `await`; that would silently
 * stop recording refused page loads, which is the thing this exists to record.
 *
 * ── Three escapes this does NOT close ─────────────────────────────────────
 *  E1  A `route.ts` under `app/admin/` is not wrapped by layouts at all. None
 *      exists; CI guard rule R3 keeps it that way. This is the real escape.
 *  E2  Layouts do not re-render on client-side soft navigation between sibling
 *      pages, so this runs on entry to the `/admin` subtree and on full loads —
 *      not on every in-app navigation. Acceptable only because the API routes
 *      behind these pages are themselves gated; the API gate is the security
 *      boundary and this is defence-in-depth.
 *  E3  Admin content served from a URL outside `/admin` is outside this
 *      boundary entirely. Out of scope, stated so it is not assumed away.
 *
 * ── Implementation notes that are cheap to get wrong ──────────────────────
 * `getUser()` reads cookies, so the whole `/admin` segment becomes dynamically
 * rendered. That is correct, and harmless here — all 22 pages fetch at runtime.
 *
 * `redirect()` throws a control-flow signal to unwind the render. It MUST NOT
 * sit inside a `try/catch` that swallows it, so the auth lookup gets its own
 * narrow try/catch and the redirect happens outside.
 *
 * @module lib/admin/requireAdminPage
 */

import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import { recordRefusedAccess } from '@/lib/audit/recordRefusedAccess';
import { createLogger } from '@/lib/logger';
import { AdminAccessService } from '@/lib/services/AdminAccessService';

const logger = createLogger({ module: 'requireAdminPage' });

/** Where a non-admin is sent. The app's normal signed-in home. */
export const NON_ADMIN_REDIRECT = '/business-os';

/**
 * Allow an admin through, or redirect everyone else away.
 *
 * Returns the admin's identity for the caller to use; never returns for a
 * non-admin, because `redirect()` throws.
 */
export async function requireAdminPage(): Promise<{ id: string; email?: string }> {
  let user: Awaited<ReturnType<typeof getUser>> = null;

  try {
    user = await getUser();
  } catch (err) {
    // A Supabase outage or a malformed cookie jar is "not signed in", not a
    // crash — and certainly not access.
    logger.error({ err }, 'Auth lookup threw on an admin page; treating as signed out');
    user = null;
  }

  /*
   * Three-valued, not a boolean, so the audit write below can tell "we asked
   * and the answer was no" from "we could not ask" — a thrown check must not
   * look like a refused admin on the Health landing. 'threw' is also the
   * correct state for an anonymous visitor: nothing was asked, nothing is
   * recorded.
   */
  let answer: 'yes' | 'no' | 'threw' = 'threw';
  if (user) {
    try {
      answer = (await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email }))
        ? 'yes'
        : 'no';
    } catch (err) {
      // Fail closed: a check that cannot answer is a "no".
      logger.error({ err, userId: user.id }, 'Admin check threw on an admin page; denying');
    }
  }

  if (answer !== 'yes') {
    // Logged only when we know who it was. An anonymous visitor produces no
    // identifying line, and — importantly — no DIFFERENT response either.
    if (user) {
      logger.warn({ userId: user.id }, 'Non-admin attempted to open an admin page');
    }
    /*
     * Awaited, immediately before the redirect, and OUTSIDE every try/catch.
     *
     * `recordRefusedAccess` never throws and never rejects, so awaiting it here
     * can neither swallow the redirect signal nor raise one of its own; and
     * `redirect()` must stay outside a catch, so this is the only correct
     * position. Not awaiting it would lose the row: `redirect()` unwinds the
     * render immediately.
     *
     * The response is unchanged for both populations; only the latency differs,
     * and only for a caller who already holds a session. See the header's
     * qualifier before changing this.
     */
    if (answer === 'no' && user) {
      await recordRefusedAccess({ userId: user.id, surface: 'admin_page', logger });
    }
    // Outside any try/catch: this throws to unwind the render.
    redirect(NON_ADMIN_REDIRECT);
  }

  return { id: user!.id, email: user!.email };
}
