/**
 * The Supabase session cookie of THIS deployment's project: its name, and the
 * access token inside it (PROD-1a, A2; SA rulings D-1, D-3, D-6, C-6).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE NAME IS DERIVED, AND FROM WHICH VARIABLE
 *
 * The middleware used to look for one hardcoded cookie name, the development
 * project's. Against any other project it never found a session, and the
 * onboarding gate passed everyone through, with no error anywhere.
 *
 * The browser's cookie name is not ours to choose: supabase-js builds it as
 * `sb-<first host label>-auth-token` from the address the browser client was
 * built with, which is `NEXT_PUBLIC_SUPABASE_URL`. So the name is derived from
 * that same variable, read as the literal `process.env.NEXT_PUBLIC_SUPABASE_URL`
 * (never destructured, never `process.env[name]`) so Next inlines into the
 * middleware exactly the value it inlines into the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NULL EXACTLY WHERE SUPABASE-JS WOULD THROW (C-6)
 *
 * `supabaseProjectRef` follows supabase-js `validateSupabaseUrl`: trimmed,
 * http(s) only, parsed with a trailing slash, first label of the hostname.
 * When it returns null, no Supabase client can be built from the address, so
 * no browser can sign in and there is no session for the gate to act on
 * (D-1). The earlier helper also refused labels outside `[A-Za-z0-9-]`, which
 * supabase-js accepts; in that case users could sign in while the gate went
 * silently off. The parity test pins the property both ways.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EDGE-SAFE, AND NOTHING AT IMPORT
 *
 * Imported by `middleware.ts`, which runs in the Edge Runtime on every path.
 * Only `@supabase/ssr` is imported: no logger, no `Buffer`, no `fs`, no
 * `next/headers`. Every function reads the address when called, never at
 * module load, so a missing or broken address cannot take the site down. The
 * caller does the logging.
 *
 * The session is read with the library's own reader halves: `combineChunks`
 * (the unchunked name first, then `.0`, `.1`, ..., as `@supabase/ssr` writes
 * it) and `stringFromBase64URL` (the exact inverse of its writer).
 *
 * @module lib/supabaseAuthCookie
 */

import { combineChunks, stringFromBase64URL } from '@supabase/ssr';

/** What `@supabase/ssr` prefixes to a base64url-encoded cookie value. */
const BASE64_PREFIX = 'base64-';

/**
 * The project ref Supabase builds the storage key from: the first label of the
 * project host. Null exactly where supabase-js `createClient` would reject the
 * address (missing, empty, not http(s), or unparseable).
 */
export function supabaseProjectRef(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const withSlash = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
    return new URL(withSlash).hostname.split('.')[0];
  } catch {
    return null;
  }
}

/**
 * The session cookie's base name, `sb-<ref>-auth-token`: supabase-js's default
 * storage key for this address. Null when the ref cannot be derived.
 */
export function supabaseAuthStorageKey(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  const ref = supabaseProjectRef(url);
  return ref === null ? null : `sb-${ref}-auth-token`;
}

/**
 * The access token in the session stored under `storageKey`, or null when
 * there is no session cookie or the session holds no access token.
 *
 * Throws on a malformed value (bad base64url or bad JSON). That is the
 * existing contract: the middleware's catch logs it and lets the request
 * through.
 */
export async function readSessionAccessToken(
  getCookie: (name: string) => string | undefined,
  storageKey: string
): Promise<string | null> {
  const raw = await combineChunks(storageKey, (name) => getCookie(name) ?? null);
  if (!raw) return null;

  // Plain JSON when the prefix is absent, as the library's own reader does.
  const json = raw.startsWith(BASE64_PREFIX) ? stringFromBase64URL(raw.substring(BASE64_PREFIX.length)) : raw;
  const session: unknown = JSON.parse(json);
  if (!session || typeof session !== 'object') return null;

  const token = (session as { access_token?: unknown }).access_token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}
