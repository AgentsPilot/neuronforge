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
 * ── An email that already has an account (Slice 1a, FR-8a, L-3) ──────────
 * A pending, grant-available invite whose email already has an account gets
 * the narrow `existing_account` state: the page sends the person to the normal
 * sign-in page. Nothing here authenticates anyone, burns the invite or touches
 * a plan (BQ-7). The email is read by its own narrow method, keyed by the id of
 * the row the token matched (workplan D-12), handed to the account lookup and
 * to nothing else: it is never part of any response and never logged. The
 * check runs BEFORE the offer is built and before `first_viewed_at` is stamped,
 * because this visitor is not going to sign up from here. A failure of either
 * read is `{ ok: false }` (the route says "try again"): "no account" is never
 * the answer by default, or signup would be offered to an existing customer.
 *
 * ── Nothing sensitive is logged ─────────────────────────────────────────────
 * This module logs nothing itself except a failed first-view stamp, keyed by the
 * invite id. The route logs the outcome. Neither ever sees the token again after
 * hashing, and neither logs the hash.
 */

import { defaultLocale, isValidLocale } from '@/lib/i18n/config';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { AuthAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';

import { deriveInviteState } from './inviteState';
import { hashInviteToken, isWellFormedInviteToken } from './inviteToken';
import { describeInviteOffer, isInviteGrantAvailable, type InviteOffer } from './inviteOffer';

/** The states the page can show. `unavailable` is derived, never stored (D-8). */
export type PublicInviteState =
  | 'not_recognised'
  | 'valid'
  | 'existing_account'
  | 'expired'
  | 'revoked'
  | 'used'
  | 'unavailable';

/** The matched states that carry only the language and the inviter's name. */
type NarrowState = 'existing_account' | 'expired' | 'revoked' | 'used' | 'unavailable';

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
      state: NarrowState;
      language: string;
      inviterDisplayName: string;
    };

/** The one response for every token that did not match, whatever the reason. */
export const NOT_RECOGNISED: PublicInviteResponse = Object.freeze({ state: 'not_recognised' as const });

export type PublicInviteRepository = Pick<
  BusinessOsInviteRepository,
  'findByTokenHashForPublicView' | 'markFirstViewed' | 'findInviteeEmailForPublicCheck' | 'markOpenedByExistingAccount'
>;

/** The account lookup (L-3). Only ever asked about the matched row's own email. */
export type PublicInviteAccountLookup = Pick<AuthAccountRepository, 'emailHasAccount'>;

export interface PublicInviteLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

export type ViewInviteOutcome =
  | {
      ok: true;
      response: PublicInviteResponse;
      inviteId: string | null;
      /**
       * Present (and `true`) only when THIS view set `opened_by_existing_account_at`,
       * so the route writes the audit entry once, not on every reload (D-13).
       */
      firstOpenByExistingAccount?: true;
    }
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
  deps: {
    repository: PublicInviteRepository;
    accounts: PublicInviteAccountLookup;
    config: EntitlementConfig;
    now: Date;
    logger: PublicInviteLogger;
  }
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
  const narrow = (state: NarrowState): ViewInviteOutcome => ({
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

  // FR-8a / L-3: does the invited email already have an account? Asked only
  // here, only about THIS row's email (D-12, R-4). Either read failing is "try
  // again", never "no account".
  const invitee = await deps.repository.findInviteeEmailForPublicCheck(row.id);
  if (invitee.error || !invitee.data) return { ok: false };
  const account = await deps.accounts.emailHasAccount(invitee.data);
  if (account.error || typeof account.data !== 'boolean') return { ok: false };

  if (account.data) {
    // BQ-7: not burned, nothing changed, no session. Only the delivery fact is
    // recorded, once; a failure to record it must not cost the visitor the page.
    const marked = await deps.repository.markOpenedByExistingAccount(row.id, deps.now);
    if (marked.error) {
      deps.logger.warn({ err: marked.error, inviteId: row.id }, 'Could not record an open by an existing account');
    }
    const outcome = narrow('existing_account');
    return marked.data === true && outcome.ok ? { ...outcome, firstOpenByExistingAccount: true } : outcome;
  }

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
