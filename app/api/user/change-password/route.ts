/**
 * Change the signed-in user's password.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CURRENT PASSWORD IS VERIFIED HERE, BECAUSE THE CLIENT NEVER DID.
 *
 * Three settings screens collected a "Current password", checked only that it
 * was non-empty, and then called `supabase.auth.updateUser({ password })` from
 * the browser — which does not take the old password and does not check one.
 * Any characters at all in that box changed the password.
 *
 * So anyone reaching an unlocked laptop or a live session could lock the real
 * owner out of their business without knowing a single credential, past a field
 * that looked like it was stopping exactly that.
 *
 * This route is the only place a password changes now. It verifies the current
 * one by signing in with it, and it records the attempt either way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A GOOGLE ACCOUNT IS REFUSED, NOT QUIETLY GIVEN A PASSWORD.
 *
 * `updateUser({ password })` SUCCEEDS on an account that signs in with Google:
 * it adds a password rather than changing one, since there is nothing to
 * change. Under a heading that says "Change password", that silently mints a
 * second credential the owner does not know exists — and it does not touch
 * their Google password, which is the one they were trying to rotate.
 *
 * The verification step would already fail for them (there is no password to
 * sign in with), but it fails as "current password is incorrect", which is a
 * lie: there is no current password. `oauth_only` says what is actually true so
 * the UI can point them at Google.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { auditLog } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { isOAuthOnlyAccount, oauthProviderLabel } from '@/lib/authIdentities';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'ChangePasswordAPI' });

/**
 * Eight characters, matching every client that calls this.
 *
 * The previous version required six while all three UIs required eight, so the
 * only reachable effect of the difference was to accept a password the user had
 * already been told was too short.
 */
const MIN_PASSWORD_LENGTH = 8;

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(
    MIN_PASSWORD_LENGTH,
    `Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`
  ),
});

/** What the audit trail records about the caller. Never the password. */
function requestContext(request: NextRequest) {
  return {
    ip_address:
      request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    user_agent: request.headers.get('user-agent') || 'unknown',
  };
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name) => cookieStore.get(name)?.value,
          set: async () => {},
          remove: async () => {},
        },
      }
    );

    // 1. Authenticate FIRST — before reading the body, so an unauthenticated
    //    caller cannot even submit a candidate password to be checked.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // 2. An account with no password cannot have one "changed".
    if (isOAuthOnlyAccount(user)) {
      const provider = oauthProviderLabel(user);
      requestLogger.info(
        { userId: user.id, provider },
        'Refused a password change on an account that signs in with a provider'
      );
      return NextResponse.json(
        {
          success: false,
          code: 'oauth_only',
          provider,
          error: `You sign in with ${provider ?? 'a connected account'}, so there is no password to change here.`,
        },
        { status: 400 }
      );
    }

    // 3. Validate input.
    const body = await request.json().catch(() => null);
    const parsed = ChangePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, code: 'invalid_input', error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
        { status: 400 }
      );
    }
    const { currentPassword, newPassword } = parsed.data;

    if (currentPassword === newPassword) {
      return NextResponse.json(
        { success: false, code: 'unchanged', error: 'Your new password must be different from your current one.' },
        { status: 400 }
      );
    }

    // 4. Verify the current password by signing in with it.
    //    The cookie writers above are no-ops, so this cannot overwrite the
    //    caller's session with the one it mints.
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });

    if (verifyError) {
      requestLogger.warn({ userId: user.id }, 'Current password verification failed');

      void auditLog({
        action: 'USER_PASSWORD_CHANGE_FAILED',
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User',
        details: { reason: 'Current password verification failed', ...requestContext(request) },
        severity: 'warning',
        complianceFlags: ['SOC2'],
      }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

      return NextResponse.json(
        { success: false, code: 'invalid_current_password', error: 'That is not your current password.' },
        { status: 401 }
      );
    }

    // 5. Change it.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });

    if (updateError) {
      requestLogger.error({ err: updateError, userId: user.id }, 'Password update failed');

      void auditLog({
        action: 'USER_PASSWORD_CHANGE_FAILED',
        entityType: 'user',
        entityId: user.id,
        userId: user.id,
        resourceName: user.email || 'User',
        details: { reason: updateError.message, ...requestContext(request) },
        severity: 'warning',
        complianceFlags: ['SOC2'],
      }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

      return NextResponse.json(
        {
          success: false,
          code: 'update_failed',
          error: 'We could not change your password. Please try again.',
          details: process.env.NODE_ENV === 'development' ? updateError.message : undefined,
        },
        { status: 500 }
      );
    }

    requestLogger.info({ userId: user.id }, 'Password changed');

    void auditLog({
      action: AUDIT_EVENTS.USER_PASSWORD_CHANGED,
      entityType: 'user',
      entityId: user.id,
      userId: user.id,
      resourceName: user.email || 'User',
      // Never the password, old or new.
      details: requestContext(request),
      /*
       * NO severity and NO complianceFlags.
       *
       * AuditTrailService resolves `input.severity || metadata.severity`, so a
       * caller's value wins — which is how a route and a registration came to
       * disagree in the first place. The registration in lib/audit/events.ts is
       * the single owner of the classification: 'warning' (recorded, not
       * alerted) with ['SOC2', 'GDPR'].
       *
       * Deleting the ['SOC2'] override here is what makes a password change
       * carry the GDPR flag — correct for a credential change, and the
       * registration's job. Pinned by
       * lib/audit/__tests__/passwordChangeSeverity.guard.test.ts.
       */
    }).catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'));

    return NextResponse.json({ success: true });

  } catch (error) {
    requestLogger.error({ err: error }, 'Password change request failed');
    return NextResponse.json(
      { success: false, error: 'We could not change your password. Please try again.' },
      { status: 500 }
    );
  }
}
