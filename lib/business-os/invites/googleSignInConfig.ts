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
 * particular it never falls back to `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: that is the
 * PLUGIN client (Gmail, Drive, …), it is already set in production, and reading
 * it would switch this feature on the moment it deploys, before Google has the
 * invite page's origins registered (SA Q-3). Unset or blank means off, so the
 * slice merges inert.
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
