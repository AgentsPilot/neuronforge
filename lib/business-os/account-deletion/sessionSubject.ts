/**
 * Who the self-delete routes act on (data export DE-10b.2; SA Review 2 C2-10,
 * TQ-10; SA workplan review V-1), and their throttle key (O2-2).
 *
 * Identity comes ONLY from `createAuthenticatedServerClient().auth.getUser()`,
 * which verifies the session with Supabase Auth: never `getSession()` (an
 * unverified cookie read), never the shared `getUser()` cache in `lib/auth`
 * (a deleted account must not be served from a cache), never a body, header
 * or query value.
 *
 * @module lib/business-os/account-deletion/sessionSubject
 */

import 'server-only';
import { createHash } from 'crypto';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';

export interface SessionSubject {
  id: string;
  /** Null for a login without an email (phone only): such an account cannot self-delete (V-1). */
  email: string | null;
}

/** The verified session user, or null when there is none (or Auth could not verify it). */
export async function readSessionSubject(): Promise<SessionSubject | null> {
  const supabase = await createAuthenticatedServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) return null;
  const email = typeof data.user.email === 'string' && data.user.email.trim() !== '' ? data.user.email : null;
  return { id: data.user.id, email };
}

/**
 * The rate-limit route key: the route name plus a short hash of the account id,
 * so attempts count per account AND per IP (the limiter adds the hashed IP),
 * and no raw id sits in the rate-limit table or its log line.
 */
export function selfDeleteThrottleKey(route: 'account-delete' | 'account-deletion-check', userId: string): string {
  return `${route}:${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`;
}
