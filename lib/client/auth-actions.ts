/**
 * Client-side auth actions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The sign-in FORM lives on the marketing site (a separate app on its own
 * origin — see `lib/utils/marketingUrl.ts`). The auth CALLS themselves are
 * plain Supabase browser-client calls, and nothing stops this app from making
 * them: `supabase` is `createBrowserClient` from `@supabase/ssr`, so a
 * successful sign-in here writes the same chunked `sb-*-auth-token` cookies the
 * marketing handoff produces, which is what `getUser()` reads on every API
 * route.
 *
 * This module exists so an in-app sign-in (today: the /test-business-os
 * harness, where crossing to :3001 and back for every persona switch is the
 * slowest part of testing) behaves exactly like the real thing — same methods,
 * same audit events, same storage hygiene on the way out — instead of a second,
 * subtly different auth path.
 *
 * Methods the product offers, and therefore this module:
 *   • email + password   (`signInWithPassword`)
 *   • Google OAuth       (`signInWithOAuth`, PKCE, via /auth/callback)
 *   • Google ID token    (`signInWithIdToken`; only after an invite was redeemed
 *                         with that token, Slice 3b)
 *   • password reset     (`resetPasswordForEmail`)
 *   • sign-out           (local or global)
 *
 * Not wired here because the product does not offer them: magic-link OTP,
 * phone auth, any other OAuth provider. Adding one means adding it to the
 * marketing login first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabaseClient';
import { clientLogger } from '@/lib/logger/client';

const logger = clientLogger.child({ module: 'AuthActions' });

/**
 * Browser-storage keys that belong to a PERSON rather than the device.
 *
 * Kept as one list because leaving any of them behind hands the next account
 * signed in on this browser the previous one's onboarding state, cached profile
 * and language — the exact cross-persona bleed that makes a test harness lie.
 * Theme keys (`app-theme`, `v2-theme-mode`) are deliberately absent: they
 * describe the device and identify nobody.
 *
 * The SESSION is not in this list: it is cleared by shape, see
 * `SESSION_KEY_PATTERN`.
 */
export const PERSON_SCOPED_STORAGE_KEYS = [
  'onboarding_completed', 'onboarding_data', 'onboarding_goal',
  'onboarding_mode', 'onboarding_build_complete', 'onboarding_build_settled',
  'user_profile', 'user_domain',
  'business-os-language', 'business-os-currency',
  'agent_builder_session_key', 'agent_builder_user_view_preference',
  'helpBotContext', 'helpBotOpen',
] as const;

/**
 * Two session key names this list used to carry. Supabase never writes either
 * (the real key is `sb-<ref>-auth-token`, matched by `SESSION_KEY_PATTERN`),
 * but legacy agent-builder code still READS them, so a copy an older build left
 * behind is removed on every sign-out. Not exported.
 */
const LEGACY_SESSION_KEYS = ['sb-auth-token', 'supabase.auth.token'] as const;

export interface AuthActionResult {
  ok: boolean;
  user?: User | null;
  error?: string;
}

/**
 * Best-effort audit write. Never blocks or fails an auth action: a user who
 * pressed sign-out must end up signed out even if the audit endpoint is down.
 */
async function auditAuthEvent(payload: {
  action: 'USER_LOGIN' | 'USER_LOGIN_FAILED' | 'USER_LOGOUT';
  userId: string | null;
  resourceName: string;
  details: Record<string, unknown>;
  severity: 'info' | 'warning';
}): Promise<void> {
  try {
    await fetch('/api/audit/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': payload.userId || 'anonymous',
      },
      body: JSON.stringify({
        action: payload.action,
        entityType: 'user',
        entityId: payload.userId,
        userId: payload.userId,
        resourceName: payload.resourceName,
        details: { ...payload.details, timestamp: new Date().toISOString() },
        severity: payload.severity,
        complianceFlags: ['SOC2'],
      }),
    });
  } catch (err) {
    logger.warn({ err, action: payload.action }, 'Auth audit log failed (non-blocking)');
  }
}

/** Email + password sign-in. Writes the session cookies on success. */
export async function signInWithPassword(
  email: string,
  password: string
): Promise<AuthActionResult> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    await auditAuthEvent({
      action: 'USER_LOGIN_FAILED',
      userId: null,
      resourceName: email,
      details: { email, error: error.message, login_method: 'password' },
      severity: 'warning',
    });
    // No address in the log line (PII); the audit row above is where the attempt is recorded.
    logger.warn({ authStatus: error.status ?? null, authCode: error.code ?? null }, 'Password sign-in rejected');
    return { ok: false, error: error.message };
  }

  await auditAuthEvent({
    action: 'USER_LOGIN',
    userId: data.user?.id ?? null,
    resourceName: data.user?.email || email,
    details: { email: data.user?.email, login_method: 'password' },
    severity: 'info',
  });
  logger.info({ userId: data.user?.id }, 'Password sign-in succeeded');
  return { ok: true, user: data.user };
}

/**
 * Google OAuth. Returns only on failure — on success the browser leaves for
 * Google and comes back to `redirectPath` on this origin.
 *
 * The default lands on `/auth/callback`, the same place the product uses, which
 * ensures a profile row exists and then routes by onboarding state.
 *
 * To return somewhere specific, keep the callback and give it a target —
 * `'/auth/callback?next=/test-business-os'`. The callback validates `next` with
 * `safeNextPath` and honours it only once onboarding is complete.
 *
 * Passing a path that BYPASSES the callback also works — the browser client has
 * `detectSessionInUrl` on, so it exchanges the PKCE `?code=` on whichever page
 * loads — but the OAuth USER_LOGIN audit entry is written by the callback page,
 * so such a sign-in records none. Prefer `?next=`.
 */
export async function signInWithGoogle(
  redirectPath = '/auth/callback'
): Promise<AuthActionResult> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${redirectPath}` },
  });

  if (error) {
    logger.warn({ err: error }, 'Google sign-in could not start');
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/**
 * Sign in with a Google ID token the page already holds (invite-only signup,
 * Slice 3b, D-1). Used only after the server has redeemed an invite with that
 * same token: Supabase verifies the token again itself, finds the confirmed
 * account by Google's verified email, LINKS the Google identity to it, and
 * writes the session cookies. The server minted no session.
 *
 * `nonce` is the RAW nonce; Google was given its SHA-256, which is what the
 * token carries, and Supabase hashes this value to compare (its documented
 * contract).
 *
 * Neither the token nor the nonce is logged or audited. The failure audit has
 * no address: the browser never decodes the token, so it does not know one.
 */
export async function signInWithGoogleIdToken(
  idToken: string,
  nonce: string
): Promise<AuthActionResult> {
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken, nonce });

  if (error) {
    await auditAuthEvent({
      action: 'USER_LOGIN_FAILED',
      userId: null,
      resourceName: 'google_id_token',
      details: { error: error.message, login_method: 'google_id_token' },
      severity: 'warning',
    });
    logger.warn({ authStatus: error.status ?? null }, 'Google ID-token sign-in rejected');
    return { ok: false, error: error.message };
  }

  await auditAuthEvent({
    action: 'USER_LOGIN',
    userId: data.user?.id ?? null,
    resourceName: data.user?.email || 'google_id_token',
    details: { email: data.user?.email, login_method: 'google_id_token' },
    severity: 'info',
  });
  logger.info({ userId: data.user?.id }, 'Google ID-token sign-in succeeded');
  return { ok: true, user: data.user };
}

/** Send the password-reset email. `redirectPath` is where the emailed link lands. */
export async function sendPasswordResetEmail(
  email: string,
  redirectPath = '/reset-password'
): Promise<AuthActionResult> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${redirectPath}`,
  });

  if (error) {
    logger.warn({ err: error }, 'Password reset email failed');
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * SIGN-OUT (Business OS settings drawer review, slice C-c, F-23)
 *
 * Every sign-out control in the product calls `signOutUser`, and each one
 * navigates AFTER it returns. So the promise this function makes is what keeps
 * a person from being stuck: it never rejects, it resolves within the three
 * deadlines below (9 s), and on return this browser holds no session, whatever
 * the server said.
 *
 * Three things the plain `supabase.auth.signOut()` does not give:
 *
 * 1. A deadline. A request that never settles is not caught by try/catch, and
 *    left the log-out spinner (and the settings dialog, which cannot close
 *    while it spins) on forever.
 *
 * 2. A local clear when the server does not confirm. auth-js keeps the session
 *    on any error other than 401/403/404 — a 5xx or a network failure — and
 *    even `scope: 'local'` calls the server first. The person was sent to the
 *    login page while this browser stayed signed in.
 *
 * 3. The session is in COOKIES, not localStorage. `lib/supabaseClient.ts` is
 *    `@supabase/ssr`'s browser client, which stores `sb-<ref>-auth-token` (or
 *    its chunks `.0`, `.1`, …) through `document.cookie`. A clear of storage
 *    alone signs nobody out.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The audit write is best-effort; it may delay leaving by this much at most. */
const AUDIT_DEADLINE_MS = 2000;
/** The requested sign-out (global revokes every device: the slowest call). */
const SIGN_OUT_DEADLINE_MS = 5000;
/**
 * The network-free local sign-out after a failure. It can still wait: auth-js
 * runs every auth call under one lock with no timeout, so after a HUNG
 * requested sign-out this one usually queues behind it and times out here.
 * The cookie clear before it is what has already signed the browser out.
 */
const LOCAL_FALLBACK_DEADLINE_MS = 2000;

/**
 * Every name the browser client writes for a session: the key, its chunks, and
 * the two side keys auth-js removes with it. The ref is a hostname label
 * (letters, digits, hyphens); the chunk suffix mirrors `@supabase/ssr`'s
 * `isChunkLike`. Matched by shape so it holds in every environment.
 */
const SESSION_KEY_PATTERN = /^sb-[A-Za-z0-9-]+-auth-token(?:-code-verifier|-user)?(?:\.(?:0|[1-9]\d*))?$/;

export type SignOutOutcome = 'signed_out' | 'server_error' | 'timeout' | 'threw';

export interface SignOutResult extends AuthActionResult {
  /** What the REQUESTED sign-out did. `ok` is true only for `signed_out`. */
  outcome: SignOutOutcome;
  /** True when no session cookie or storage key was found in this browser afterwards. */
  clearedLocally: boolean;
}

type DeadlineResult<T> =
  | { kind: 'done'; value: T }
  | { kind: 'threw'; err: unknown }
  | { kind: 'timeout' };

/**
 * Run `work` with a deadline it cannot outlive. Never throws, and leaves no
 * timer behind when the work settles first. A rejection that arrives after the
 * deadline is absorbed by `settled`, so it cannot surface as an
 * `unhandledrejection`.
 */
async function withDeadline<T>(work: () => Promise<T>, ms: number): Promise<DeadlineResult<T>> {
  let pending: Promise<T>;
  try {
    pending = work();
  } catch (err) {
    return { kind: 'threw', err };
  }

  const settled = Promise.resolve(pending).then(
    (value): DeadlineResult<T> => ({ kind: 'done', value }),
    (err: unknown): DeadlineResult<T> => ({ kind: 'threw', err })
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<DeadlineResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), ms);
  });

  try {
    return await Promise.race([settled, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The status and class name of an auth error, and nothing else. The raw error
 * object is never logged: auth-js errors can carry request context, and the
 * client logger's redaction is only a backstop.
 */
function describeAuthError(err: unknown): { authStatus: number | null; authName: string | null } {
  if (!err || typeof err !== 'object') return { authStatus: null, authName: null };
  const { status, name } = err as { status?: unknown; name?: unknown };
  return {
    authStatus: typeof status === 'number' ? status : null,
    authName: typeof name === 'string' ? name : null,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Sign-out failed';
}

/** The browser storages that can be read here; a disabled one is skipped. */
function availableStorages(): Storage[] {
  const stores: Storage[] = [];
  for (const pick of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const store = pick();
      if (store) stores.push(store);
    } catch {
      // Private mode or storage disabled: nothing stored there to clear.
    }
  }
  return stores;
}

function sessionCookieNames(): string[] {
  try {
    return document.cookie
      .split(';')
      .map((part) => {
        const eq = part.indexOf('=');
        return (eq < 0 ? part : part.slice(0, eq)).trim();
      })
      .filter((name) => SESSION_KEY_PATTERN.test(name));
  } catch {
    return [];
  }
}

function sessionStorageKeys(store: Storage): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key && SESSION_KEY_PATTERN.test(key)) keys.push(key);
    }
  } catch {
    // A storage that refuses to be read has nothing we can clear.
  }
  return keys;
}

/**
 * Expire every session cookie and remove every session storage key, by shape.
 *
 * Assumes what is true in this repo today (C-c workplan K-6): the browser
 * client is the only writer of the auth cookie, and it writes it host-only,
 * `Path=/`, not `httpOnly`, so an expiry with the same path from
 * `document.cookie` removes the very cookie the server reads. If the client
 * ever gets a `cookieOptions.domain` (a session shared across subdomains),
 * that domain must be mirrored here, or the cookie survives; `clearedLocally`
 * then reports false rather than assuming success.
 *
 * Never `SameSite=None`: a browser rejects it without `Secure`.
 */
function clearSessionByShape(): { cookies: number; storageKeys: number } {
  const cookieNames = sessionCookieNames();
  for (const name of cookieNames) {
    try {
      document.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; SameSite=Lax`;
    } catch {
      // Cookies disabled: nothing was stored there.
    }
  }

  let storageKeys = 0;
  for (const store of availableStorages()) {
    for (const key of sessionStorageKeys(store)) {
      try {
        store.removeItem(key);
        storageKeys++;
      } catch {
        // Counted as left by `countSessionLeft`.
      }
    }
  }
  return { cookies: cookieNames.length, storageKeys };
}

/** How many session cookies or storage keys are still here, re-read after the clear. */
function countSessionLeft(): number {
  return (
    sessionCookieNames().length +
    availableStorages().reduce((n, store) => n + sessionStorageKeys(store).length, 0)
  );
}

/** The person-scoped keys and the legacy session names, from both storages. */
function clearPersonScopedKeys(): void {
  for (const store of availableStorages()) {
    try {
      for (const key of [...PERSON_SCOPED_STORAGE_KEYS, ...LEGACY_SESSION_KEYS]) store.removeItem(key);
      store.removeItem('onboarding_preview_data');
    } catch {
      logger.warn({ step: 'person-scoped-keys' }, 'Browser storage unavailable during sign-out');
    }
  }
}

export interface SignOutOptions {
  scope?: 'global' | 'local';
  user?: { id: string; email?: string | null } | null;
  /**
   * Recorded as `details.method` on the USER_LOGOUT entry, so the audit trail
   * still says WHICH control someone left through. Each call site passes its
   * own — the values predate this module and are kept verbatim.
   */
  method?: string;
}

/**
 * One sign-out at a time per page. A double click (two controls have no busy
 * guard) joins the run already in progress instead of writing a second audit
 * entry and queueing a second auth call behind the auth lock.
 */
let inFlightSignOut: Promise<SignOutResult> | null = null;

/**
 * Sign out. `scope: 'global'` ends the session on every device; `'local'` ends
 * it in this browser only, which is what you want when hopping between test
 * personas without killing your other sessions.
 *
 * The contract every caller relies on:
 * - It never rejects.
 * - It resolves within about 9 s (2 s audit, 5 s sign-out, 2 s local fallback).
 * - On return this browser holds no session (`clearedLocally` says whether that
 *   was verified by re-reading), and person-scoped browser storage is cleared
 *   either way — see `PERSON_SCOPED_STORAGE_KEYS`.
 * - `ok` means the server confirmed the requested sign-out. When it is false
 *   after a GLOBAL sign-out, other devices may still be signed in; that cannot
 *   be fixed from this browser.
 *
 * The caller decides where to navigate afterwards; nothing here redirects.
 * A call made while another is running returns that run's promise.
 */
export function signOutUser(opts: SignOutOptions = {}): Promise<SignOutResult> {
  if (inFlightSignOut) {
    logger.debug({ method: opts.method ?? 'in-app' }, 'Sign-out already in progress; joining it');
    return inFlightSignOut;
  }
  // Assigned before anything awaits, so a second call in the same tick joins.
  const run = runSignOut(opts)
    // `runSignOut` catches everything except a throwing logger (CR-CC-1); even
    // then the contract holds: resolve, and do not claim the clear was verified.
    .catch((): SignOutResult => ({ ok: false, error: 'Sign-out failed', outcome: 'threw', clearedLocally: false }))
    .finally(() => {
      inFlightSignOut = null;
    });
  inFlightSignOut = run;
  return run;
}

async function runSignOut(opts: SignOutOptions): Promise<SignOutResult> {
  const { scope = 'local', user = null, method = 'in-app' } = opts;
  const startedAt = Date.now();
  let outcome: SignOutOutcome = 'threw';
  let error: string | undefined = 'Sign-out failed';
  let cookiesCleared = 0;
  let storageKeysCleared = 0;

  try {
    // Before the sign-out: afterwards there is no session to attribute it to.
    if (user?.id) {
      const audit = await withDeadline(
        () =>
          auditAuthEvent({
            action: 'USER_LOGOUT',
            userId: user.id,
            resourceName: user.email || 'User',
            details: { method, scope },
            severity: 'info',
          }),
        AUDIT_DEADLINE_MS
      );
      if (audit.kind === 'timeout') {
        logger.warn({ step: 'audit', deadlineMs: AUDIT_DEADLINE_MS }, 'Sign-out audit exceeded its deadline; continuing');
      }
    }

    const requested = await withDeadline(() => supabase.auth.signOut({ scope }), SIGN_OUT_DEADLINE_MS);

    if (requested.kind === 'done' && !requested.value.error) {
      outcome = 'signed_out';
      error = undefined;
    } else {
      let detail: { authStatus: number | null; authName: string | null } = { authStatus: null, authName: null };
      if (requested.kind === 'timeout') {
        outcome = 'timeout';
        error = 'timeout';
      } else if (requested.kind === 'threw') {
        outcome = 'threw';
        error = errorMessage(requested.err);
        detail = describeAuthError(requested.err);
      } else {
        outcome = 'server_error';
        error = requested.value.error?.message ?? 'Sign-out failed';
        detail = describeAuthError(requested.value.error);
      }

      const fields = { scope, method, outcome, ...detail, durationMs: Date.now() - startedAt };
      const message = 'Sign-out not confirmed by the server; clearing this browser locally';
      if (outcome === 'threw') logger.error(fields, message);
      else logger.warn(fields, message);

      // Cookies FIRST: with no session in storage, the local sign-out below
      // makes no network call; it only drops auth-js's memory and fires
      // SIGNED_OUT to the page's listeners.
      const first = clearSessionByShape();
      cookiesCleared += first.cookies;
      storageKeysCleared += first.storageKeys;

      const local = await withDeadline(() => supabase.auth.signOut({ scope: 'local' }), LOCAL_FALLBACK_DEADLINE_MS);
      if (local.kind !== 'done' || local.value.error) {
        logger.warn(
          { step: 'local-fallback', outcome: local.kind === 'done' ? 'server_error' : local.kind },
          'Local fallback sign-out did not complete; session keys already cleared'
        );
      }
    }
  } catch (err) {
    // Nothing above should throw; if something does, the clear below still runs.
    if (outcome !== 'signed_out') outcome = 'threw';
    logger.error({ step: 'unexpected', ...describeAuthError(err) }, 'Unexpected sign-out failure; clearing locally');
  }

  // Always, success included: idempotent, and it catches a cookie an in-flight
  // token refresh re-wrote while the calls above were running.
  let clearedLocally = false;
  try {
    const last = clearSessionByShape();
    cookiesCleared += last.cookies;
    storageKeysCleared += last.storageKeys;
    clearPersonScopedKeys();

    if (cookiesCleared + storageKeysCleared > 0) {
      logger.info({ cookies: cookiesCleared, storageKeys: storageKeysCleared }, 'Session keys cleared by shape');
    }

    const left = countSessionLeft();
    clearedLocally = left === 0;
    if (!clearedLocally) {
      logger.warn({ left }, 'Session keys survived the sign-out clear');
    }
  } catch {
    logger.warn({ step: 'final-clear' }, 'Browser storage unavailable during sign-out');
  }

  logger.info({ scope, method, outcome, clearedLocally, durationMs: Date.now() - startedAt }, 'Sign-out finished');
  return { ok: outcome === 'signed_out', error, outcome, clearedLocally };
}
