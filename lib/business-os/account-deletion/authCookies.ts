/**
 * Expire the Supabase session cookies on a response (data export DE-10b.2,
 * workplan §2.6, X-1; SA workplan review O2-5, V-3).
 *
 * After a self-delete the function has already removed every session and
 * refresh token, so the cookies only point at nothing. They still have to go:
 * a browser holding a dead session loops on protected pages.
 * `createAuthenticatedServerClient` cannot clear them (its cookie `set` and
 * `remove` are no-ops), so the delete route expires them here, and the drawer
 * then signs the browser out locally (V-4).
 *
 * Only cookies PRESENT on the request are expired, and only these names, where
 * `<ref>` comes from `NEXT_PUBLIC_SUPABASE_URL`, never from a cookie name:
 *
 *   sb-<ref>-auth-token            the session
 *   sb-<ref>-auth-token.<n>        its chunks (`@supabase/ssr` splits at 3180 chars)
 *   sb-<ref>-auth-token-code-verifier (and its chunks)  the PKCE side key
 *
 * Attributes mirror what `@supabase/ssr` 0.6 writes (`DEFAULT_COOKIE_OPTIONS`):
 * `Path=/`, `SameSite=Lax`, not `httpOnly`, no `Secure`, no `Domain`. A cookie
 * is only replaced by one with the same name, path and domain.
 *
 * @module lib/business-os/account-deletion/authCookies
 */

import type { NextResponse } from 'next/server';

/** The project ref Supabase builds the storage key from: the first label of the project host. */
export function supabaseProjectRef(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!url) return null;
  try {
    const ref = new URL(url).hostname.split('.')[0];
    return /^[A-Za-z0-9-]+$/.test(ref) ? ref : null;
  } catch {
    return null;
  }
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The session cookie names of this project, by shape. Null when the project ref is unknown. */
export function authCookiePattern(ref: string | null = supabaseProjectRef()): RegExp | null {
  if (!ref) return null;
  return new RegExp(`^sb-${escapeRegExp(ref)}-auth-token(?:-code-verifier)?(?:\\.\\d+)?$`);
}

interface RequestCookieNames {
  getAll(): Array<{ name: string }>;
}

/** Expire every session cookie of this project that the request carried. Returns the names expired. */
export function expireAuthCookies(
  requestCookies: RequestCookieNames,
  response: NextResponse,
  ref: string | null = supabaseProjectRef()
): string[] {
  const pattern = authCookiePattern(ref);
  if (!pattern) return [];
  const names = requestCookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter((name) => pattern.test(name));
  for (const name of names) {
    response.cookies.set({ name, value: '', path: '/', maxAge: 0, sameSite: 'lax', httpOnly: false, secure: false });
  }
  return names;
}
