/**
 * Session cookies exactly as `@supabase/ssr` writes them, for middleware tests
 * (PROD-1a, SA C-7).
 *
 * Built with the library's own writer halves, `stringToBase64URL` behind the
 * `base64-` prefix and `createChunks` for the split, so a fixture can never be
 * in a form the real browser would not produce. A hand-built fixture in
 * standard base64 (`+`, `/`) fails to decode, the middleware's catch lets the
 * request through, and every "the onboarding check was not reached" assertion
 * goes green for the wrong reason.
 *
 * The cookie name comes from `supabaseAuthStorageKey()`, the same derivation
 * the middleware uses, so the fixture follows whatever address the Jest setup
 * configured instead of naming one project.
 */

import { createChunks, stringToBase64URL } from '@supabase/ssr';

import { supabaseAuthStorageKey } from '@/lib/supabaseAuthCookie';

export interface CookiePair {
  name: string;
  value: string;
}

/** The storage key for the configured address; throws when the setup left none. */
export function configuredStorageKey(): string {
  const key = supabaseAuthStorageKey();
  if (key === null) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not a valid address in this test');
  return key;
}

/** A session holding `accessToken`, optionally padded so it no longer fits one cookie. */
export function sessionWith(accessToken: string, padding = 0): Record<string, unknown> {
  const session: Record<string, unknown> = { access_token: accessToken, token_type: 'bearer', refresh_token: 'r' };
  if (padding > 0) session.user = { user_metadata: { padding: 'p'.repeat(padding) } };
  return session;
}

/** The cookies `@supabase/ssr` would set for `session` under `key`: one, or `.0`, `.1`, ... */
export function sessionCookies(session: Record<string, unknown>, key: string = configuredStorageKey()): CookiePair[] {
  return createChunks(key, `base64-${stringToBase64URL(JSON.stringify(session))}`);
}

/** A `Cookie` request header carrying `pairs`. */
export function cookieHeader(pairs: CookiePair[]): string {
  return pairs.map(({ name, value }) => `${name}=${value}`).join('; ');
}
