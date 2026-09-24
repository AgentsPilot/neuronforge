/**
 * Sign-in and sign-up, which live on the marketing site.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `/login` AND `/signup` ARE NOT ROUTES IN THIS APP.
 *
 * They belong to the marketing site, a separate Next application on a separate
 * origin. Sixteen places used to navigate to a bare `/login` and every one of
 * them was a live 404: signing out, an expired session on a protected page, a
 * failed session handoff, the OAuth error paths.
 *
 * Anything that sends someone to sign in or sign up goes through this module.
 * A relative `/login` is always a bug.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The origin itself now comes from `origins.ts`, which owns every address this
 * system hands out. This module is the two auth destinations on top of it, kept
 * as its own file because fourteen call sites import these names.
 */

import { marketingOrigin, marketingUrl } from './origins';

export { marketingOrigin, marketingUrl };

/**
 * The sign-in page, on the marketing site.
 *
 * `search` carries a reason across the origin boundary — `?error=no_session`,
 * for instance — and is passed through verbatim, leading `?` included.
 */
export function marketingLoginUrl(search = ''): string {
  return marketingUrl(`/login${search}`);
}

/** The sign-up page, on the marketing site. `search` as above. */
export function marketingSignupUrl(search = ''): string {
  return marketingUrl(`/signup${search}`);
}

/**
 * Sign-out, on the marketing site.
 *
 * Signing out of the platform does NOT sign anyone out of the marketing site:
 * browser storage is per-origin, so that origin keeps its own copy of the
 * session, and `getSession()` there returns the still-unexpired access token
 * without asking the server. Its `/auth/callback` and `/onboarding` both trust
 * that copy and hand the person straight back to the platform.
 *
 * So a sign-out ends on the marketing site's own sign-out route, which clears
 * that origin before showing the login form. Sending people to `/login`
 * directly is what left the other half of the session alive.
 */
export function marketingLogoutUrl(search = ''): string {
  return marketingUrl(`/logout${search}`);
}
