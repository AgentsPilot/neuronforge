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
 * ── A champion's friend invite (Slice 5a F5a-10, SA R-5; Slice 5b F5b-3) ────
 * Keyed on `issuer_kind = 'account'`, whatever the grant, and decided BEFORE
 * the existing-account check, which an account-issued invite NEVER reaches:
 * the champion holds the link (FR-30), so asking would tell them whether any
 * address they typed has an AgentPilot account. From Slice 5b, a pending
 * account-issued TIER invite with friend invites switched on gets `valid`,
 * with the signup form (the champion's name and note, the offer with its
 * price, and the masked address, which the champion typed anyway). The page
 * adds ONE payment statement for it, decided here (`payment`, below). Whether
 * the address already has an account is decided only
 * after mailbox proof, by the signup routes (`inviteRedemption.ts`). With the
 * switch off, or any other grant, it is `unavailable` (T-18). The issuer's
 * cohort is re-checked at redemption (T-19), not here (5a Q-6). The 5a state
 * `signup_opens_soon` is gone (SA Q-8): the switch now means friends may be
 * invited AND may sign up.
 *
 * ── An ADMIN Paid invite (plan payments P-9.1, SA C-2, A-2) ────────────────
 * An admin-issued tier invite is `unavailable` in exactly the cases the signup
 * refuses it (the Paid switch off, a type admins may not issue, a grant the
 * config no longer carries, a tier with no price), through the signup's own
 * predicate `adminPaidInviteRedemption`, so a visitor is never shown a form
 * the server would then refuse. Otherwise it is treated as a champion's: the
 * existing-account check, then the form. While the switch is off in
 * production, every admin Paid link reads "no longer available".
 *
 * ── The payment statement (FR-22; plan payments P-9.2, SA C-6, A-1) ────────
 * `valid` carries `payment`: `none` for a grant that is not a tier (a
 * champion's free plan); for a tier invite, `required` exactly when the
 * holding screen would offer Pay for the tier this invite makes its account
 * hold for, and `opens_later` otherwise. Decided by `heldInviteOffer`, the
 * same step behind the holding screen and the held checkout, with the same
 * three switches, so the page never says "payment is required at signup"
 * where the account would then read "payment coming soon". For a friend the
 * tier is the friend tier; for an admin Paid invite it is the row's own
 * `grant_id`. Switches are injectable for tests.
 *
 * ── Nothing sensitive is logged ─────────────────────────────────────────────
 * This module logs nothing itself except a failed first-view stamp, keyed by the
 * invite id. The route logs the outcome. Neither ever sees the token again after
 * hashing, and neither logs the hash.
 */

import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';
import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { AuthAccountRepository } from '@/lib/repositories/AuthAccountRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';

import { deriveInviteState } from './inviteState';
import { hashInviteToken, isWellFormedInviteToken } from './inviteToken';
import { adminPaidInviteRedemption, describeInviteOffer, isInviteGrantAvailable, type InviteOffer } from './inviteOffer';
import { maskEmail } from './signupCode';
// SA C-6: the page's payment statement and the holding screen's Pay share ONE
// step. Invites → billing, as `inviteOffer.ts` (SA C-3): billing imports
// `invites/paymentHold` as a TYPE only, so there is no runtime cycle.
import {
  heldInviteOffer,
  readHeldPaymentSwitches,
  type HeldInviteTier,
  type HeldPaymentSwitches,
} from '@/lib/business-os/billing/planCheckoutEligibility';

/**
 * FR-22: the one payment line under a `valid` offer. `required` only when the
 * account this invite creates could pay at once (SA C-6).
 */
export type InvitePaymentStatement = 'none' | 'required' | 'opens_later';

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
      /**
       * Slice 1b (R-6, F-6): the invited address as the signup form shows it
       * before mailbox proof: the first character of the local part and the
       * domain. The full email is returned only after a successful signup.
       */
      maskedEmail: string;
      /** FR-22 (P-9.2, SA C-6): which payment line the page shows, if any. */
      payment: InvitePaymentStatement;
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
function pageLanguage(stored: string): Locale {
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
    /** The three held-payment switches (SA C-6); production reads `readHeldPaymentSwitches`. */
    paymentSwitches?: () => HeldPaymentSwitches;
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

  // Slice 5a (F5a-10, SA R-5) and 5b (F5b-3): an account-issued invite NEVER
  // reaches the existing-account check below. With the switch on it gets the
  // signup form; the account question waits for mailbox proof.
  if (row.issuer_kind === 'account') {
    if (row.grant_kind !== 'tier' || !INVITE_ISSUANCE_POLICY.accountInvitesAvailable) return narrow('unavailable');
    const friend = await deps.repository.findInviteeEmailForPublicCheck(row.id);
    if (friend.error || !friend.data) return { ok: false };
    const friendOffer = describeInviteOffer(row, deps.config, deps.now, language);
    await markFirstView(row, deps);
    return {
      ok: true,
      inviteId: row.id,
      response: {
        state: 'valid',
        language,
        inviterDisplayName,
        personalNote: row.personal_note,
        linkExpiresAt: row.link_expires_at,
        offer: friendOffer,
        maskedEmail: maskEmail(friend.data),
        payment: paymentStatement({ source: 'account_invite' }, deps),
      },
    };
  }

  // Plan payments P-9.1 (SA C-2, A-2): an ADMIN Paid invite is offered only
  // when the signup would accept it, decided by the signup's own predicate.
  // `switch_off` and `unavailable` both read "no longer available" here.
  if (row.grant_kind === 'tier' && adminPaidInviteRedemption(row, deps.config) !== 'ok') return narrow('unavailable');

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

  // In the invite's own language (OI-10), the same one the page renders in.
  const offer = describeInviteOffer(row, deps.config, deps.now, language);
  await markFirstView(row, deps);

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
      maskedEmail: maskEmail(invitee.data),
      // A champion's cohort grant asks for no payment. A tier grant here is an
      // admin Paid invite the predicate above has already said `ok` to.
      payment: row.grant_kind === 'tier' ? paymentStatement({ source: 'admin_invite', grantId: row.grant_id }, deps) : 'none',
    },
  };
}

/**
 * FR-22 (SA C-6): `required` exactly when `heldInviteOffer` (the holding
 * screen's and the held checkout's step) would answer `pay` for the tier this
 * invite makes its account hold for; otherwise `opens_later`. Never re-derived.
 */
function paymentStatement(invite: HeldInviteTier, deps: { paymentSwitches?: () => HeldPaymentSwitches }): InvitePaymentStatement {
  const switches = (deps.paymentSwitches ?? readHeldPaymentSwitches)();
  return heldInviteOffer(invite, switches).kind === 'pay' ? 'required' : 'opens_later';
}

/**
 * FR-10: the first successful load. Conditional in the repository, so a reload
 * never moves it; a failure here must not cost the visitor the page.
 */
async function markFirstView(
  row: { id: string; first_viewed_at: string | null },
  deps: { repository: PublicInviteRepository; now: Date; logger: PublicInviteLogger }
): Promise<void> {
  if (row.first_viewed_at !== null) return;
  const marked = await deps.repository.markFirstViewed(row.id, deps.now);
  if (marked.error) {
    deps.logger.warn({ err: marked.error, inviteId: row.id }, "Could not record the invite's first view");
  }
}
