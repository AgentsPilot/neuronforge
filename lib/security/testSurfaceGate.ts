/**
 * The gate in front of the test and debug surface (PROD-1c, A6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT GUARDS
 *
 * The test harness pages (`/test-business-os`, `/test-plugins-v2`) and the
 * routes only they use: `app/api/test/**`, `app/api/debug/**`,
 * `app/api/v2/debug/**`, the `app/api/v6/*test*` routes and the plugin tester's
 * audit route. Two of those had no authentication at all, and one spent LLM
 * money attributed to the platform, so on production they were open to anyone.
 *
 * WHAT IT DOES
 *
 * On every deployment (production, Vercel previews, `next dev`, a local
 * `next start`, Jest) it refuses everyone who is not an admin, and lets an
 * admin through to the route's or page's own checks (PROD-1c F-2; until then
 * it did this on production only). There is no environment branch and no
 * opt-out: this module reads no environment variable, and its unit test pins
 * that. A refusal looks the same everywhere:
 *   - a test or debug ROUTE answers a real HTTP 404 (JSON, the project format);
 *   - a test PAGE shows a non-admin the not-found screen, with a `noindex` tag
 *     and no harness content, but at HTTP 200, not 404: `PlatformShell` is
 *     loaded through `next/dynamic` (`components/PlatformChrome.tsx`), whose
 *     Suspense boundary catches the `notFound()` before the status is set
 *     (F-10, accepted by SA as B-3 option (c)).
 *
 * Admin identity comes from the two canonical gates, `requireAdmin` for routes
 * and `requireAdminPage` for pages, and through them from the `admin_users`
 * table. Never `profiles.role`, which is user-writable. A refusal is audited by
 * those gates exactly as on `/admin` (`admin_api` / `admin_page`); this module
 * adds no surface of its own.
 *
 * THE PAGE GATE IS DEFENCE IN DEPTH; THE ROUTES ARE THE BOUNDARY (SA B-1).
 * A layout gate can be skipped by a crafted router-state header (OI-21 in
 * docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md). That is harmless here only
 * because every render entry point under `app/test-*` is a client component
 * with no server props, and every API they call enforces its own
 * authorisation; the test and debug routes do so through this gate. G-9 in
 * lib/__tests__/envConfigHardening.guard.test.ts keeps both true for the test
 * surface.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/security/testSurfaceGate
 */

import { NextResponse } from 'next/server';

import { requireAdmin, type AdminGateLogger } from '@/lib/admin/requireAdminRoute';
import { requireAdminPage } from '@/lib/admin/requireAdminPage';

/**
 * The project error format, as a 404. A gated route answers JSON while an
 * unknown path answers Next's HTML 404, so the two can be told apart. That is
 * accepted (SA N-5): these routes are named in a public repository, and
 * concealment is not the goal. Refusal is.
 */
function notFoundResponse(): NextResponse {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

/**
 * The route gate. Call it as the first `await` of every handler:
 *
 * ```ts
 * const gate = await testSurfaceRouteGate(requestLogger);
 * if (gate) return gate;
 * ```
 *
 * `null` means an admin: carry on. Anything else is a 404 to return as is.
 */
export async function testSurfaceRouteGate(logger: AdminGateLogger): Promise<NextResponse | null> {
  /*
   * `requireAdmin` never throws by contract (it turns an auth or admin-check
   * failure into a refusal). The catch is here anyway because this gate must
   * fail closed even if that contract is ever broken: an exception must not
   * reach the handler's own catch, which would answer 500 instead of 404.
   */
  try {
    const verdict = await requireAdmin(logger);
    if (verdict instanceof NextResponse) return notFoundResponse();
    return null;
  } catch (err) {
    logger.error({ err }, 'Admin check threw at the test-surface gate; refusing');
    return notFoundResponse();
  }
}

/**
 * The page gate. Call it as the first statement of the segment's layout.
 *
 * Returns for an admin. For anyone else `requireAdminPage` calls `notFound()`,
 * which throws to unwind the render, so it is deliberately NOT wrapped in a
 * try/catch here (SA B-2).
 */
export async function testSurfacePageGate(): Promise<void> {
  await requireAdminPage({ onRefusal: 'notFound' });
}
