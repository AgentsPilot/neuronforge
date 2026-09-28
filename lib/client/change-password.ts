/**
 * The one way a password changes from the browser.
 *
 * Three settings screens each had their own copy of this, and all three called
 * `supabase.auth.updateUser({ password })` directly — which never checks the
 * current password and never records the change. This goes through
 * `/api/user/change-password`, which does both.
 *
 * Returns a verdict rather than throwing: every caller needs to put the failure
 * on screen next to the form, and the server's message is already written for
 * the person reading it.
 */

export type ChangePasswordCode =
  | 'invalid_input'
  | 'unchanged'
  | 'invalid_current_password'
  | 'oauth_only'
  | 'update_failed'
  | 'unauthorized'
  | 'network';

export interface ChangePasswordResult {
  success: boolean;
  /** Ready to display. Absent on success. */
  error?: string;
  code?: ChangePasswordCode;
  /** On `oauth_only`: "Google". */
  provider?: string | null;
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  try {
    const response = await fetch('/api/user/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });

    const body = await response.json().catch(() => null);

    if (response.ok && body?.success) return { success: true };

    if (response.status === 401 && !body?.code) {
      return { success: false, code: 'unauthorized', error: 'Please sign in again.' };
    }

    return {
      success: false,
      code: (body?.code as ChangePasswordCode) ?? 'update_failed',
      error: body?.error ?? 'We could not change your password. Please try again.',
      provider: body?.provider ?? null,
    };
  } catch {
    // A thrown fetch is the network, not the server — say so rather than
    // implying the password was rejected.
    return {
      success: false,
      code: 'network',
      error: 'We could not reach the server. Check your connection and try again.',
    };
  }
}
