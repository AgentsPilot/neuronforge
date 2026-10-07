// lib/business-os/purge/confirmation.ts
//
// The typed confirmation (purge FR-11, admin delete FR-A6): what the caller
// must type before a destructive run, looked up SERVER-SIDE, and how the typed
// text is compared. Moved here from the internal commit route (AD-2a T5) so
// the internal surface and the admin surface share one rule.
//
// ── Fails closed (SA AC2-8) ─────────────────────────────────────────────────
// The route-local version ignored the profile repository's `error`, so a read
// failure silently became "no business name" and the EMAIL became the thing to
// type. Here a read error (returned or thrown) is `unverified`, and both
// callers refuse with a 500. Only a genuinely absent name (no profile row, or
// an empty `company_name`) falls back to the email.
//
// No logging here: the value is a business name or an email, and neither may
// reach Pino (ids only). The callers log the outcome with ids.

import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

export type ConfirmKind = 'business name' | 'account email';

export type ConfirmationTarget =
  /** The value to type, and what it is. */
  | { status: 'ok'; kind: ConfirmKind; value: string }
  /** No business name and no email: nothing to confirm against. */
  | { status: 'none' }
  /** The business profile could not be read: refuse, never fall back. */
  | { status: 'unverified' };

/** Normalise for comparison: trimmed, case-insensitive, internal whitespace collapsed. */
export function normaliseConfirmation(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** True when the typed text matches the server's value (after normalising both). */
export function confirmationMatches(typed: string, expected: string): boolean {
  return normaliseConfirmation(typed) === normaliseConfirmation(expected);
}

/**
 * What the user must type: the business name, or the account email if there is
 * no business name. `userId` is the TARGET (the session user on the internal
 * surface, the path id on the admin surface); the read is equality-scoped to it
 * by the repository.
 */
export async function resolveConfirmationTarget(userId: string, email: string | null): Promise<ConfirmationTarget> {
  try {
    const { data: profile, error } = await businessProfileRepository.findByUserId(userId);
    if (error) return { status: 'unverified' };
    const name = profile?.company_name;
    if (name && name.trim()) return { status: 'ok', kind: 'business name', value: name };
  } catch {
    return { status: 'unverified' };
  }
  return email ? { status: 'ok', kind: 'account email', value: email } : { status: 'none' };
}
