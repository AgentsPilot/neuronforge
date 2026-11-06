/**
 * The Google client id for "Continue with Google" on a champion invite
 * (invite-only signup, Slice 3b; D-9, SA Q-3, R-6).
 *
 * ONE accessor, used by all three places that need it:
 *   - the invite page, to decide whether to load Google's script and show the
 *     button at all;
 *   - the signup route, which answers 404 `google_signin_not_configured`
 *     before doing any work when this is unset;
 *   - the ID-token verifier, as the only accepted `aud`.
 *
 * It reads `NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID` and NOTHING else. In
 * particular it never falls back to `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: that named the
 * PLUGIN client (Gmail, Drive, …), and reading it would have switched this feature
 * on the moment it deployed, before Google had the invite page's origins registered
 * (SA Q-3). Unset or blank means off, so the slice merges inert.
 *
 * That variable was RETIRED by G-2 of
 * docs/requirements/GOOGLE_OAUTH_CLIENT_CONSOLIDATION_REQUIREMENT.md, so there is
 * nothing left to fall back to. The rule still matters, because the two clients are
 * split by ROLE — sign-in vs plugin data access — and a future reader looking for
 * "the Google client id" must not reach for the plugin one. Three suites assert the
 * no-fallback behaviour with a decoy value and are the executable proof of this
 * paragraph: app/api/public/invites/signup/__tests__/routes.test.ts,
 * app/invite/__tests__/page.render.test.tsx and
 * lib/business-os/invites/__tests__/googleIdToken.test.ts.
 *
 * The value must be the client id configured in Supabase's Google provider
 * (Auth → Providers → Google), so that the browser's `signInWithIdToken` accepts
 * the same token our route verified. See `docs/feature_flags.md`.
 *
 * Client-safe on purpose (no `server-only`): the page runs in the browser. The
 * variable is read with a LITERAL `process.env.NEXT_PUBLIC_…` member access,
 * because Next.js inlines public variables into the client bundle only for
 * that exact form. A `NEXT_PUBLIC_` value is fixed at BUILD time: changing it
 * needs a redeploy.
 */

export function googleSignInClientId(): string | null {
  const value = process.env.NEXT_PUBLIC_GOOGLE_SIGNIN_CLIENT_ID;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}
