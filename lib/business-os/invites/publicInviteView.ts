import 'server-only';

/**
 * What the public invite page is told about a token (FR-8, FR-10, C-4, AC-2).
 *
 * ── One answer for every bad token (AC-2) ───────────────────────────────────
 * A malformed token, an unknown one and a real one with a character changed all
 * produce the SAME `{ state: 'not_recognised' }`. Expired, revoked, used and
 * unavailable are said only for a token whose hash matched, because only the
 * holder of a real link can learn them. A malformed token skips the database
 * (D-6): the enumeration risk is telling a real token from a well-formed guess,
 * and both of those take the same path, one indexed lookup.
 *
 * ── An explicit allow-list (C-4, D-7) ───────────────────────────────────────
 * Every response is built field by field. `valid` carries the language, the
 * inviter's snapshotted name, their note, the link expiry and the offer; every
 * other matched state carries only the language and the inviter's name, enough
 * for "ask Dana for a new one" in the invite's language. No state ever carries
 * the email, any id, the hash, an issuer, or a reason.
 *
 * ── Nothing sensitive is logged ─────────────────────────────────────────────
 * This module logs nothing itself except a failed first-view stamp, keyed by the
 * invite id. The route logs the outcome. Neither ever sees the token again after
 * hashing, and neither logs the hash.
 */

import { defaultLocale, isValidLocale } from '@/lib/i18n/config';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';

import { deriveInviteState } from './inviteState';
import { hashInviteToken, isWellFormedInviteToken } from './inviteToken';
import { describeInviteOffer, isInviteGrantAvailable, type InviteOffer } from './inviteOffer';

/** The states the page can show. `unavailable` is derived, never stored (D-8). */
export type PublicInviteState = 'not_recognised' | 'valid' | 'expired' | 'revoked' | 'used' | 'unavailable';

export type PublicInviteResponse =
  | { state: 'not_recognised' }
  | {
      state: 'valid';
      language: string;
      inviterDisplayName: string;
      personalNote: string | null;
      linkExpiresAt: string;
      offer: InviteOffer;
    }
  | {
      state: 'expired' | 'revoked' | 'used' | 'unavailable';
      language: string;
      inviterDisplayName: string;
    };

/** The one response for every token that did not match, whatever the reason. */
export const NOT_RECOGNISED: PublicInviteResponse = Object.freeze({ state: 'not_recognised' as const });

export type PublicInviteRepository = Pick<BusinessOsInviteRepository, 'findByTokenHashForPublicView' | 'markFirstViewed'>;

export interface PublicInviteLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

export type ViewInviteOutcome =
  | { ok: true; response: PublicInviteResponse; inviteId: string | null }
  | { ok: false };

/** A stored language the page can render, or the default. */
function pageLanguage(stored: string): string {
  return isValidLocale(stored) ? stored : defaultLocale;
}

/**
 * Resolve a presented token to what the page may show.
 *
 * `{ ok: false }` means the lookup itself failed: the route answers "try again"
 * (503), never "not recognised", because the link may well be real.
 */
export async function viewInviteByToken(
  rawToken: string,
  deps: { repository: PublicInviteRepository; config: EntitlementConfig; now: Date; logger: PublicInviteLogger }
): Promise<ViewInviteOutcome> {
  // C-3: the format is checked before anything is hashed or looked up.
  if (!isWellFormedInviteToken(rawToken)) {
    return { ok: true, response: NOT_RECOGNISED, inviteId: null };
  }

  const { data: row, error } = await deps.repository.findByTokenHashForPublicView(hashInviteToken(rawToken));
  if (error) return { ok: false };
  if (!row) return { ok: true, response: NOT_RECOGNISED, inviteId: null };

  const language = pageLanguage(row.language);
  const inviterDisplayName = row.inviter_display_name;
  const narrow = (state: 'expired' | 'revoked' | 'used' | 'unavailable'): ViewInviteOutcome => ({
    ok: true,
    response: { state, language, inviterDisplayName },
    inviteId: row.id,
  });

  const state = deriveInviteState(row, deps.now);
  if (state === 'accepted') return narrow('used');
  if (state === 'revoked') return narrow('revoked');
  if (state === 'expired') return narrow('expired');

  // GR-1 / D-8: a pending invite whose plan has left the config is refused
  // cleanly rather than described as something that no longer exists.
  if (!isInviteGrantAvailable(deps.config, row)) return narrow('unavailable');

  const offer = describeInviteOffer(row, deps.config, deps.now);

  // FR-10: the first successful load. Conditional in the repository, so a reload
  // never moves it; a failure here must not cost the visitor the page.
  if (row.first_viewed_at === null) {
    const marked = await deps.repository.markFirstViewed(row.id, deps.now);
    if (marked.error) {
      deps.logger.warn({ err: marked.error, inviteId: row.id }, 'Could not record the invite\'s first view');
    }
  }

  return {
    ok: true,
    inviteId: row.id,
    response: {
      state: 'valid',
      language,
      inviterDisplayName,
      personalNote: row.personal_note,
      linkExpiresAt: row.link_expires_at,
      offer,
    },
  };
}
