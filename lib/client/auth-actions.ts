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
 */
export const PERSON_SCOPED_STORAGE_KEYS = [
  'onboarding_completed', 'onboarding_data', 'onboarding_goal',
  'onboarding_mode', 'onboarding_build_complete', 'onboarding_build_settled',
  'user_profile', 'user_domain',
  'business-os-language', 'business-os-currency',
  'agent_builder_session_key', 'agent_builder_user_view_preference',
  'helpBotContext', 'helpBotOpen',
  'sb-auth-token', 'supabase.auth.token',
] as const;

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
    logger.warn({ email }, 'Password sign-in rejected');
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
 * ensures a profile row exists and then routes by onboarding state. Pass a path
 * to come straight back to a harness instead: the browser client has
 * `detectSessionInUrl` on, so it exchanges the PKCE `?code=` on whichever page
 * loads. The USER_LOGIN audit entry for OAuth is written by the callback page,
 * so a path that bypasses it records none — which is why the default keeps it.
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

/**
 * Sign out. `scope: 'global'` ends the session on every device; `'local'` ends
 * it in this browser only, which is what you want when hopping between test
 * personas without killing your other sessions.
 *
 * Person-scoped browser storage is cleared either way — see
 * `PERSON_SCOPED_STORAGE_KEYS`. The caller decides where to navigate
 * afterwards; nothing here redirects.
 */
export async function signOutUser(
  opts: { scope?: 'global' | 'local'; user?: { id: string; email?: string | null } | null } = {}
): Promise<AuthActionResult> {
  const { scope = 'local', user = null } = opts;

  // Before the sign-out: afterwards there is no session to attribute it to.
  if (user?.id) {
    await auditAuthEvent({
      action: 'USER_LOGOUT',
      userId: user.id,
      resourceName: user.email || 'User',
      details: { method: 'in-app', scope },
      severity: 'info',
    });
  }

  let error: string | undefined;
  try {
    const { error: signOutError } = await supabase.auth.signOut({ scope });
    if (signOutError) error = signOutError.message;
  } catch (err) {
    // Log it and clear locally anyway: someone who pressed sign out must end up
    // signed out of this browser even if the server call failed.
    error = (err as Error).message;
    logger.error({ err }, 'Sign-out call failed — clearing local state regardless');
  }

  try {
    PERSON_SCOPED_STORAGE_KEYS.forEach((key) => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    sessionStorage.removeItem('onboarding_preview_data');
  } catch {
    // Private mode, or storage disabled. The sign-out above is what matters.
  }

  return { ok: !error, error };
}
