/**
 * The gate in front of the test and debug surface (PROD-1c, A6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT GUARDS
 *
 * The test harness pages (`/test-business-os`, `/test-plugins-v2`) and the
 * routes only they use: `app/api/test/**`, `app/api/debug/**`,
 * `app/api/v2/debug/**`, the `app/api/v6/*test*` routes and the plugin tester's
 * audit route. Two of those had no authentication at all, and one spends LLM
 * money attributed to the platform, so on production they were open to anyone.
 *
 * WHAT IT DOES
 *
 * Off production it does nothing: local runs, Jest and Vercel previews behave
 * exactly as before. On production it refuses everyone who is not an admin,
 * and lets an admin through to the route's or page's own checks:
 *   - a test or debug ROUTE answers a real HTTP 404 (JSON, the project format);
 *   - a test PAGE shows a non-admin the not-found screen, with a `noindex` tag and no harness content, but at
 * HTTP 200, not 404: `PlatformShell` is loaded through `next/dynamic`
 * (`components/PlatformChrome.tsx`), whose Suspense boundary catches the
 * `notFound()` before the status is set (F-10, accepted by SA as B-3
 * option (c)).
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
import { isProductionDeployment } from '@/lib/utils/deploymentEnvironment';

/** The only Vercel environments on which the test surface stays open. */
const OPEN_VERCEL_ENVS = new Set(['preview', 'development']);

/**
 * Is the test surface closed on this deployment?
 *
 * FAIL CLOSED (SA D-10). Closed on production, and also on Vercel whenever
 * `VERCEL_ENV` is anything other than exactly `preview` or `development`: a
 * misspelled, padded or empty value must not open it. This is the inverse
 * direction to `isProductionDeployment()`, which treats an unexpected value as
 * "not production" because that is the safe answer for ITS callers.
 *
 * `VERCEL_ENV=production` without `VERCEL` also closes, through
 * `isProductionDeployment()`; that is what lets a local `next start` probe the
 * production behaviour.
 *
 * Literal `process.env.X` defaults, one per parameter, so the admin Environment
 * page's drift guard can see what this reads (SA N-3). The parameters exist for
 * tests; callers pass nothing.
 */
export function isTestSurfaceClosed(
  vercelEnv: string | undefined = process.env.VERCEL_ENV,
  onVercel: string | undefined = process.env.VERCEL
): boolean {
  if (isProductionDeployment(vercelEnv)) return true;
  if (!onVercel) return false;
  return !OPEN_VERCEL_ENVS.has(vercelEnv ?? '');
}

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
 * `null` means carry on. Anything else is a 404 to return as is.
 */
export async function testSurfaceRouteGate(logger: AdminGateLogger): Promise<NextResponse | null> {
  if (!isTestSurfaceClosed()) return null;

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
 * Returns for an admin, or where the surface is open. Otherwise
 * `requireAdminPage` calls `notFound()`, which throws to unwind the render, so
 * it is deliberately NOT wrapped in a try/catch here (SA B-2).
 */
export async function testSurfacePageGate(): Promise<void> {
  if (!isTestSurfaceClosed()) return;
  await requireAdminPage({ onRefusal: 'notFound' });
}
