import 'server-only';

/**
 * The admin invite operations: create, list, revoke, and the form's options
 * (FR-1 to FR-7, C-5, C-6, C-8, C-9).
 *
 * Pure functions that receive their repositories and clock, following
 * `entitlements/adminOps.ts`, so every rule is testable without a request. The
 * routes stay thin: gate, HTTP shape, audit.
 *
 * ── The raw token (C-3) ─────────────────────────────────────────────────────
 * It is generated here, hashed at once, and leaves this module only inside the
 * `link` string of a successful create. It is never logged, never put in an
 * outcome's error, and never stored: the row holds the hash.
 *
 * ── The list view (R-7) ─────────────────────────────────────────────────────
 * `toInviteListView` is the one mapper from a row to what an admin sees, used by
 * both the list and the create response, so neither can ever carry
 * `token_hash`, `issuer_admin_id`, `internal_reason` or `redeemed_account_id`.
 * Slice 2a adds the derived `emailStatus` and `emailStatusAt`, never the
 * provider message id, the problem detail or the Reply-To snapshot.
 *
 * ── The invitation email (Slice 2a) ─────────────────────────────────────────
 * Sent inline by `createInviteForAdmin`, AFTER the row exists, through
 * `sendInvitationEmail` (which never throws). The plan's name is computed here
 * with `planLabel` and passed in, so the email module imports nothing from the
 * entitlements module (SA R-12). A failed send never fails the create: the
 * admin still gets the link once (FR-16).
 */

import { defaultLocale, locales, type Locale } from '@/lib/i18n/config';
import {
  CHAMPION_ACCESS_MONTHS_MAX,
  INVITE_ISSUANCE_POLICY,
  INVITE_LINK_EXPIRY,
  INVITE_TYPES,
  PAID_INVITE_TYPE,
  type InviteTypeId,
} from '@/lib/business-os/entitlements/config/invites';
import { planLabel, planMonthlyPriceUsd } from '@/lib/business-os/entitlements/planPresentation';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { UserProfileRepository } from '@/lib/repositories/UserProfileRepository';
import type {
  AgentRepositoryResult,
  BusinessOsAccountLineageLevel,
  BusinessOsInvite,
  BusinessOsPaidInvoiceFacts,
  BusinessOsPaidInvoicePair,
} from '@/lib/repositories/types';

import type { UserPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';

import {
  deriveInviteEmailStatus,
  sendInvitationEmail,
  type InvitationEmailDeps,
  type InvitationEmailOutcome,
  type InviteEmailStatus,
} from './inviteEmail';
import { INVITE_EMAIL_NOT_SENT } from './inviteEmailPolicy';
import { normaliseReplyToAddress } from './inviteSender';
import { deriveInviteState, type InviteState } from './inviteState';
import { buildInviteLink, generateInviteToken, hashInviteToken } from './inviteToken';
import { describeInviteAccess, isInviteGrantAvailable } from './inviteOffer';
import type { CreateInviteBody, RevokeInviteBody } from './inviteSchemas';
import { isAwaitingPayment } from './paymentHold';
import { claimLeaseCutoff, isClaimLive } from './signupCodePolicy';
// SA C-3 (P-9.2): the one tier rule for an admin Paid invite is "a Stripe
// price exists" (`sellableTiers`, P-4.1 M-1), at issuance as at redemption and
// at the held checkout. An invites → billing import: billing imports
// `invites/paymentHold` as a TYPE only, so there is no runtime cycle. Nothing
// else from billing is imported here.
import { sellableTiers } from '@/lib/business-os/billing/planCheckoutEligibility';

/** The name shown when the inviting admin has none on record (BQ-9, C-9). */
export const INVITER_NAME_FALLBACK = 'AgentPilot';

/** The longest inviter name stored; mirrors the database CHECK. */
export const INVITER_NAME_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only the logger levels these operations use. */
export interface InviteOpsLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

/** The repository methods the admin operations use. */
export type AdminInviteRepository = Pick<
  BusinessOsInviteRepository,
  'createForAdmin' | 'listRecentForAdmin' | 'findByIdForAdmin' | 'revokeForAdmin' | 'recordInviteEmailOutcome'
>;

/** One invite, as the admin list and the create response show it. */
export interface InviteListView {
  id: string;
  email: string;
  inviteType: string;
  grantLabel: string;
  accessSummary: string;
  inviterDisplayName: string;
  language: string;
  createdAt: string;
  linkExpiryDays: number;
  linkExpiresAt: string;
  state: InviteState;
  firstViewedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
  redeemedAt: string | null;
  /** Slice 1a (FR-8a): the invite was opened by an email that already had an account. */
  openedByExistingAccountAt: string | null;
  /** Slice 1b: the account created from this invite, once accepted. */
  redeemedAccountId: string | null;
  /** Slice 1b: the invitation circle of that account (1 for every admin invite), or `null`. */
  level: number | null;
  /**
   * Slice 5b (FR-36): the account that account was invited under, read from
   * its lineage row. `null` for an L1 champion, a pending invite, or a failed
   * lineage read.
   */
  parentAccountId: string | null;
  /**
   * Slice 1b (FR-12a, SA D-3, T-16): a signup that stopped halfway, derived
   * from data: not redeemed AND (a failure is recorded OR a claim is older than
   * the lease). The second half catches a function killed by its timeout, which
   * could record nothing.
   */
  redemptionStoppedHalfway: boolean;
  /** Slice 1b (SA D-2): the last recorded failure. Never an email. */
  redemptionFailure: InviteRedemptionFailureView | null;
  /** Slice 2a (D-7): the invitation email, derived by `deriveInviteEmailStatus`. */
  emailStatus: InviteEmailStatus;
  /** Slice 2a: when that status was reached, or `null` for "not emailed". */
  emailStatusAt: string | null;
  /** Slice 5a (F5a-11): who issued it. `account` is a champion's friend invite. */
  issuerKind: 'admin' | 'account';
  /** Slice 5a (F5a-11): the issuing champion's account id, or `null` for an admin invite. */
  issuerAccountId: string | null;
  /**
   * Slice 5a (F5a-8): revoked by the champion who sent it. An account-issued
   * invite revoked with no admin id was revoked by its inviter; an admin's
   * revoke always stamps the admin's id.
   */
  revokedByInviter: boolean;
  /**
   * Plan payments P-5b.2 (FR-25, S5-8): the payment of the account created
   * from this invite, or `null` when there is nothing to show (not accepted,
   * no lineage row, or an account that neither paid nor is held).
   */
  payment: InvitePaymentView | null;
}

/**
 * Plan payments P-5b.2 (FR-25, S5-8, SA Q-8, Q-12). One accepted invite's
 * payment, as the admin row shows it:
 *
 *   - `awaiting_payment`: held on the payment screen, by the gate's own
 *     predicate (`isAwaitingPayment`), with the invite's grant kind ("Signed
 *     up, not paid").
 *   - `paid_recorded`: the first payment, with the date and the amount paid (tax
 *     included) from the money history `business_os_billing_events`, matched
 *     on the account AND the invoice together. Never copied from lineage
 *     (AC-F2.2). `livemode: false` is a test payment (P5-N1).
 *   - `paid_record_missing`: lineage says paid but no money row matches the
 *     pair (a deleted account detached its rows, or the ref is wrong). No date
 *     or amount is guessed (Q-8).
 *   - `unknown`: a read this answer depends on failed. Never "not paid".
 *
 * A union, so P-13 can add `{ state: 'waived' }` without reshaping it (S5-9).
 */
export type InvitePaymentView =
  | { state: 'awaiting_payment' }
  | { state: 'paid_recorded'; paidAt: string; amountMinor: number; currency: 'usd'; livemode: boolean }
  | { state: 'paid_record_missing' }
  | { state: 'unknown' };

/**
 * The one money-history read the paid line needs, described structurally so
 * this module never names the money-history repository (its caller guard keeps
 * that to the route that wires it, SA C-7).
 */
export interface PaidInvoiceReader {
  findPaidInvoicesForAccounts(pairs: BusinessOsPaidInvoicePair[]): Promise<AgentRepositoryResult<BusinessOsPaidInvoiceFacts[]>>;
}

/** The FR-12a record as the admin row shows it (SA D-2, T-16). */
export interface InviteRedemptionFailureView {
  at: string;
  step: string;
  errorCode: string | null;
  errorMessage: string | null;
  accountId: string | null;
}

/** The exact keys of `InviteListView`, for tests that pin the allow-list. */
export const INVITE_LIST_VIEW_KEYS: ReadonlyArray<keyof InviteListView> = [
  'id',
  'email',
  'inviteType',
  'grantLabel',
  'accessSummary',
  'inviterDisplayName',
  'language',
  'createdAt',
  'linkExpiryDays',
  'linkExpiresAt',
  'state',
  'firstViewedAt',
  'revokedAt',
  'revokeReason',
  'redeemedAt',
  'openedByExistingAccountAt',
  'redeemedAccountId',
  'level',
  'parentAccountId',
  'redemptionStoppedHalfway',
  'redemptionFailure',
  'emailStatus',
  'emailStatusAt',
  'issuerKind',
  'issuerAccountId',
  'revokedByInviter',
  'payment',
];

/** The D-3 derivation, in one place (the C-11 one-derivation rule). */
export function isRedemptionStoppedHalfway(row: BusinessOsInvite, now: Date): boolean {
  if (row.redeemed_at) return false;
  if (row.redemption_failed_at) return true;
  return row.claimed_at !== null && !isClaimLive(row.claimed_at, now);
}

/** The one row → view mapper (R-7). Built field by field; nothing is spread. */
export function toInviteListView(
  row: BusinessOsInvite,
  config: EntitlementConfig,
  now: Date,
  level: number | null = null,
  parentAccountId: string | null = null,
  payment: InvitePaymentView | null = null
): InviteListView {
  const email = deriveInviteEmailStatus(row);
  return {
    id: row.id,
    email: row.email,
    inviteType: row.invite_type,
    grantLabel: planLabel(config, row.grant_id),
    accessSummary: describeInviteAccess(row),
    inviterDisplayName: row.inviter_display_name,
    language: row.language,
    createdAt: row.created_at,
    linkExpiryDays: row.link_expiry_days,
    linkExpiresAt: row.link_expires_at,
    state: deriveInviteState(row, now),
    firstViewedAt: row.first_viewed_at,
    revokedAt: row.revoked_at,
    revokeReason: row.revoke_reason,
    redeemedAt: row.redeemed_at,
    openedByExistingAccountAt: row.opened_by_existing_account_at,
    redeemedAccountId: row.redeemed_account_id,
    level,
    parentAccountId,
    redemptionStoppedHalfway: isRedemptionStoppedHalfway(row, now),
    redemptionFailure: row.redemption_failed_at
      ? {
          at: row.redemption_failed_at,
          step: row.redemption_failed_step ?? 'unknown',
          errorCode: row.redemption_error_code,
          errorMessage: row.redemption_error_message,
          accountId: row.redemption_failed_account_id,
        }
      : null,
    emailStatus: email.status,
    emailStatusAt: email.at,
    issuerKind: row.issuer_kind,
    issuerAccountId: row.issuer_kind === 'account' ? row.issuer_account_id : null,
    revokedByInviter: row.issuer_kind === 'account' && row.revoked_at !== null && row.revoked_by_admin_id === null,
    payment,
  };
}

// ── Form options ────────────────────────────────────────────────────────────

export interface InviteTypeOption {
  type: string;
  label: string;
  /** May the admin issue it right now? The server enforces the same rule (C-6). */
  available: boolean;
  unavailableReason: string | null;
  /** A cohort grant needs an access decision (RC-4). The form reads this, not a type name. */
  requiresAccess: boolean;
  /** The plans the admin chooses between. Empty when the grant is fixed by config. */
  grants: Array<{ id: string; label: string; default: boolean }>;
  /**
   * P-9.2 (§3.6): one line the form shows under the plan select, or `null`.
   * English (admin surface). Set for a Paid (tier) type only.
   */
  note: string | null;
}

/** P-9.2 (§3.6): what an admin is told about a Paid invite before issuing it. */
export const PAID_INVITE_FORM_NOTE = 'The invitee pays this plan at signup and cannot use AgentPilot until they have paid.';

/** P-9.2: shown when no plan has a Stripe price, so nothing could be paid for. */
export const PAID_INVITE_NO_PRICED_PLAN = 'No plan has a price yet';

/**
 * P-9.2 (SA C-3, C-4): a Paid grant's label, "<plan> · $<price> a month". The
 * price comes from `planMonthlyPriceUsd` on the SAME injected config as the
 * name, never from the tier matrix directly. Display only: Stripe charges
 * from its own price, checked by the checkout.
 */
function paidGrantLabel(config: EntitlementConfig, tier: string): string {
  return `${planLabel(config, tier)} · $${planMonthlyPriceUsd(config, tier)} a month`;
}

/**
 * P-9.2 (SA C-3): may an admin Paid invite sell this tier? The two tier
 * halves of the redemption's own predicate (`adminPaidInviteRedemption`): the
 * config still carries it for an invite type, and `sellableTiers()` (a Stripe
 * price exists). Never `buyableTiers()`: an admin Paid invite is
 * sales-assisted, not the public shelf (P-4.1 M-1).
 */
function isPayablePaidGrant(config: EntitlementConfig, tier: string): boolean {
  return (
    isInviteGrantAvailable(config, { grant_kind: 'tier', grant_id: tier }) &&
    (sellableTiers() as readonly string[]).includes(tier)
  );
}

export interface InviteFormOptions {
  expiryDays: number[];
  defaultExpiryDays: number;
  languages: string[];
  defaultLanguage: string;
  championAccessMonthsMax: number;
  inviteTypes: InviteTypeOption[];
}

/** May the issuing admin issue this type right now? One rule, two readers. */
function refusalFor(type: InviteTypeId): 'invite_type_not_allowed' | 'paid_invites_not_available' | null {
  if (!INVITE_ISSUANCE_POLICY.admin.includes(type)) return 'invite_type_not_allowed';
  if (INVITE_TYPES[type].grantKind === 'tier' && !INVITE_ISSUANCE_POLICY.paidInvitesAvailable) {
    return 'paid_invites_not_available';
  }
  return null;
}

/**
 * Everything the create form offers, decided here so the page decides nothing
 * (D-10). The language default is the inviter's saved preference (Slice 2a,
 * C-8 as amended, D-8), resolved by `resolveInviteFormLanguage`; `en` when
 * none is given or it is not a language the product speaks.
 */
export function buildInviteFormOptions(config: EntitlementConfig, defaultLanguage: Locale = defaultLocale): InviteFormOptions {
  return {
    expiryDays: [...INVITE_LINK_EXPIRY.optionsDays],
    defaultExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    languages: [...locales],
    defaultLanguage: (locales as readonly string[]).includes(defaultLanguage) ? defaultLanguage : defaultLocale,
    championAccessMonthsMax: CHAMPION_ACCESS_MONTHS_MAX,
    inviteTypes: INVITE_ISSUANCE_POLICY.admin.map((type) => {
      const definition = INVITE_TYPES[type];
      const refusal = refusalFor(type);
      const isCohort = definition.grantKind === 'cohort';

      if (isCohort) {
        return {
          type,
          label: `${definition.label} (${planLabel(config, definition.defaultGrantId)})`,
          available: refusal === null,
          unavailableReason: refusal === 'paid_invites_not_available' ? INVITE_ISSUANCE_POLICY.paidUnavailableReason : null,
          requiresAccess: true,
          grants: [],
          note: null,
        };
      }

      // P-9.2 (SA C-3): a Paid type offers only tiers that can be paid for
      // (a Stripe price exists) and that the config still carries for it.
      const payable = sellableTiers().filter((tier) => isPayablePaidGrant(config, tier));
      const defaultId = (payable as readonly string[]).includes(definition.defaultGrantId) ? definition.defaultGrantId : payable[0];
      const nothingPayable = refusal === null && payable.length === 0;
      return {
        type,
        label: definition.label,
        available: refusal === null && !nothingPayable,
        unavailableReason:
          refusal === 'paid_invites_not_available'
            ? INVITE_ISSUANCE_POLICY.paidUnavailableReason
            : nothingPayable
              ? PAID_INVITE_NO_PRICED_PLAN
              : null,
        requiresAccess: false,
        grants: payable.map((id) => ({ id, label: paidGrantLabel(config, id), default: id === defaultId })),
        note: PAID_INVITE_FORM_NOTE,
      };
    }),
  };
}

const PREFERENCE_UNREADABLE = "Could not read the admin's language preference; the form defaults to English";

/**
 * The create form's language pre-select (Slice 2a, C-8 as amended, D-8, T-12):
 * the issuing admin's `user_preferences.preferred_language` when it names a
 * language the product speaks, otherwise `en`. A failed read is a warning and
 * `en`: a wrong pre-select costs the admin one click (SA F-3), a failed page
 * costs the whole screen.
 */
export async function resolveInviteFormLanguage(deps: {
  adminId: string;
  preferences: Pick<UserPreferencesRepository, 'findPreferredLanguage'>;
  logger: InviteOpsLogger;
}): Promise<Locale> {
  try {
    const { data, error } = await deps.preferences.findPreferredLanguage(deps.adminId);
    if (error) {
      deps.logger.warn({ adminId: deps.adminId }, PREFERENCE_UNREADABLE);
      return defaultLocale;
    }
    return data && (locales as readonly string[]).includes(data) ? (data as Locale) : defaultLocale;
  } catch {
    deps.logger.warn({ adminId: deps.adminId }, PREFERENCE_UNREADABLE);
    return defaultLocale;
  }
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * What happened to the invitation email of one create (Slice 2a). Carries no
 * address, link, token, hash or error text: the route turns it into the
 * response's `email` and the audit entry.
 */
export type CreateInviteEmailResult = { requested: false; status: 'not_emailed' } | ({ requested: true } & InvitationEmailOutcome);

export type CreateInviteOutcome =
  | { ok: true; invite: InviteListView; link: string; row: BusinessOsInvite; email: CreateInviteEmailResult }
  | {
      ok: false;
      status: 409 | 500;
      error: 'invite_type_not_allowed' | 'paid_invites_not_available' | 'grant_not_available' | 'could_not_create_invite';
    };

export interface CreateInviteDeps {
  adminId: string;
  /**
   * The issuing admin's auth email, from the gate (`requireAdmin`), never from
   * the body. Snapshotted, normalised, as the invitation's Reply-To (D-2).
   * Optional on the gate, so it may be missing: the email then has no Reply-To.
   */
  adminEmail?: string | null;
  repository: Pick<AdminInviteRepository, 'createForAdmin' | 'recordInviteEmailOutcome'>;
  profileRepository: Pick<UserProfileRepository, 'findById'>;
  config: EntitlementConfig;
  now: Date;
  logger: InviteOpsLogger;
  /** Slice 2a: how to send and record the invitation email. The repository comes from `repository`. */
  email: Omit<InvitationEmailDeps, 'repository'>;
}

/**
 * The inviter's name as it is snapshotted (C-9): `profiles.full_name`, trimmed
 * and capped at `INVITER_NAME_MAX` code points; otherwise "AgentPilot".
 *
 * Shared by admin invites and, from Slice 5a, a champion's friend invites (SA
 * R-1): a nameless champion is "AgentPilot" too, NEVER their email, because the
 * snapshot is shown on the public page to anyone holding the link and an
 * address in a From display name is a phishing pattern.
 */
export function inviterNameFromProfile(fullName: unknown): string {
  const name = typeof fullName === 'string' ? Array.from(fullName.trim()).slice(0, INVITER_NAME_MAX).join('').trim() : '';
  return name.length > 0 ? name : INVITER_NAME_FALLBACK;
}

/**
 * The inviter's name, snapshotted onto the invite (C-9), so the public page
 * never reads admin data. A failed read is a warning, not a failed invite.
 */
async function inviterDisplayNameFor(deps: CreateInviteDeps): Promise<string> {
  const { data, error } = await deps.profileRepository.findById(deps.adminId);
  if (error) {
    deps.logger.warn({ err: error, adminId: deps.adminId }, 'Could not read the inviting admin\'s name; using the fallback');
    return INVITER_NAME_FALLBACK;
  }

  return inviterNameFromProfile(data?.full_name);
}

/**
 * Create one invite.
 *
 * Order: issuance policy (C-6: a tier grant is refused while Paid is off, BEFORE
 * any write or read) → grant still in config (GR-1) → inviter name (C-9) →
 * token and hash → stamp the expiry (T-14) → insert through the explicit
 * allow-list. The body was already validated by the route's Zod schema; only
 * named fields are read from it, so an extra property cannot reach the row.
 */
export async function createInviteForAdmin(body: CreateInviteBody, deps: CreateInviteDeps): Promise<CreateInviteOutcome> {
  const type = body.inviteType;
  const refusal = refusalFor(type);
  if (refusal) return { ok: false, status: 409, error: refusal };

  const definition = INVITE_TYPES[type];
  const grantKind = definition.grantKind;
  const grantId = body.inviteType === PAID_INVITE_TYPE ? body.grantId : definition.defaultGrantId;

  if (!isInviteGrantAvailable(deps.config, { grant_kind: grantKind, grant_id: grantId })) {
    return { ok: false, status: 409, error: 'grant_not_available' };
  }

  // P-9.2 (SA C-3, C-4): a Paid grant nobody could pay for is refused before
  // any read or write, or the invitee would be held on "coming soon" forever.
  if (grantKind === 'tier' && !isPayablePaidGrant(deps.config, grantId)) {
    return { ok: false, status: 409, error: 'grant_not_available' };
  }

  // RC-4: a cohort grant carries an explicit access decision; a tier has neither.
  let accessOpenEnded: boolean | null = null;
  let accessMonths: number | null = null;
  if (body.inviteType !== PAID_INVITE_TYPE) {
    accessOpenEnded = body.access.kind === 'open_ended';
    accessMonths = body.access.kind === 'months' ? body.access.months : null;
  }

  const inviterDisplayName = await inviterDisplayNameFor(deps);
  const token = generateInviteToken();
  const note = body.personalNote && body.personalNote.length > 0 ? body.personalNote : null;
  const replyTo = normaliseReplyToAddress(deps.adminEmail);
  if (deps.adminEmail && !replyTo) {
    deps.logger.warn({ adminId: deps.adminId }, 'The admin email is not a usable Reply-To; the invitation will have none');
  }

  const { data, error } = await deps.repository.createForAdmin({
    token_hash: hashInviteToken(token),
    email: body.email,
    invite_type: type,
    grant_kind: grantKind,
    grant_id: grantId,
    access_open_ended: accessOpenEnded,
    access_months: accessMonths,
    issuer_admin_id: deps.adminId,
    inviter_display_name: inviterDisplayName,
    language: body.language,
    personal_note: note,
    internal_reason: body.reason,
    link_expiry_days: body.linkExpiryDays,
    link_expires_at: new Date(deps.now.getTime() + body.linkExpiryDays * DAY_MS).toISOString(),
    inviter_reply_to: replyTo,
    // D-5: stamped with the row, so a function killed mid-send still shows "Unknown".
    email_attempted_at: body.sendEmail ? deps.now.toISOString() : null,
  });

  if (error || !data) return { ok: false, status: 500, error: 'could_not_create_invite' };

  if (!body.sendEmail) {
    return {
      ok: true,
      invite: toInviteListView(data, deps.config, deps.now),
      link: buildInviteLink(token),
      row: data,
      email: { requested: false, status: 'not_emailed' },
    };
  }

  const outcome = await sendInvitationEmail(
    { row: data, token, planName: planLabel(deps.config, grantId), replyTo },
    { ...deps.email, repository: deps.repository }
  );

  // The row as the list will read it next time: the outcome only when it was
  // written (otherwise the list honestly says "Unknown").
  // One clock for the whole create: the row the admin sees uses the create's `now`.
  const recordedAt = deps.now.toISOString();
  // A timeout (`unknown`) is never recorded, so it takes the first branch.
  const shown: BusinessOsInvite = !outcome.recorded
    ? data
    : outcome.status === 'not_sent'
      ? { ...data, email_problem: INVITE_EMAIL_NOT_SENT, email_problem_at: recordedAt }
      : { ...data, email_sent_at: recordedAt, email_provider_message_id: outcome.providerMessageId };

  return {
    ok: true,
    invite: toInviteListView(shown, deps.config, deps.now),
    link: buildInviteLink(token),
    row: data,
    email: { requested: true, ...outcome },
  };
}

// ── List ────────────────────────────────────────────────────────────────────

/** The T-16 banner: counts and invite ids only. */
export interface StoppedHalfwaySummary {
  count: number;
  inviteIds: string[];
}

/**
 * Slice 1c (SA F-9, D-9): the admin list reads at most this many invites,
 * newest first, and the screen filters and searches within them. Raised from
 * 200. The repository clamps to the same number (`BUSINESS_OS_INVITE_LIST_LIMIT`);
 * the repository test pins the two together.
 */
export const INVITE_LIST_CEILING = 500;

/**
 * The lineage lookup refuses more than 200 ids at once (a long `in (...)` list
 * is a long URL), so the accepted rows are read in batches of this size. The
 * ops test pins it to `LINEAGE_LOOKUP_LIMIT`.
 */
export const INVITE_LINEAGE_BATCH = 200;

/**
 * P-5b.2: the money-history read takes at most 200 pairs at once (the
 * repository refuses more); the ops test pins the batching.
 */
export const INVITE_PAID_INVOICE_BATCH = 200;

const pairKey = (accountId: string, invoiceId: string) => `${accountId}|${invoiceId}`;

/** What the money history answered for the stamped lineage rows of one page. */
interface PaidInvoiceLookup {
  byPair: Map<string, BusinessOsPaidInvoiceFacts>;
  /** Pairs whose batch failed (or no reader was wired): their payment is `unknown`. */
  unread: Set<string>;
}

/**
 * P-5b.2 (S5-8, SA C-11): the paid invoices of the stamped lineage rows. Pairs
 * are built ONLY from lineage (`account_id`, `first_payment_ref`); the
 * repository keeps a money row only for an exact pair.
 */
async function readPaidInvoices(
  lineageRows: BusinessOsAccountLineageLevel[],
  reader: PaidInvoiceReader | undefined,
  logger: InviteOpsLogger | undefined
): Promise<PaidInvoiceLookup> {
  const lookup: PaidInvoiceLookup = { byPair: new Map(), unread: new Set() };
  const pairs: BusinessOsPaidInvoicePair[] = [];
  const seen = new Set<string>();
  for (const row of lineageRows) {
    if (typeof row.first_paid_at !== 'string' || typeof row.first_payment_ref !== 'string') continue;
    const key = pairKey(row.account_id, row.first_payment_ref);
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ accountId: row.account_id, invoiceId: row.first_payment_ref });
  }
  if (pairs.length === 0) return lookup;

  for (let start = 0; start < pairs.length; start += INVITE_PAID_INVOICE_BATCH) {
    const batch = pairs.slice(start, start + INVITE_PAID_INVOICE_BATCH);
    let facts: BusinessOsPaidInvoiceFacts[] | null = null;
    if (reader) {
      try {
        const read = await reader.findPaidInvoicesForAccounts(batch);
        facts = read.error ? null : read.data;
      } catch {
        facts = null;
      }
    }
    if (!facts) {
      // Ids and counts only (C-3): never an amount, a date or an address.
      logger?.warn({ event: 'bos_invite_admin_payment_unread', pairs: batch.length, wired: Boolean(reader) }, 'Could not read the money history for the invite list; payments show as unknown');
      for (const pair of batch) lookup.unread.add(pairKey(pair.accountId, pair.invoiceId));
      continue;
    }
    for (const fact of facts) lookup.byPair.set(pairKey(fact.accountId, fact.invoiceId), fact);
  }
  return lookup;
}

/** P-5b.2 (FR-25): one accepted row's payment, or `null` when there is nothing to show. */
function paymentViewFor(
  row: BusinessOsInvite,
  lineage: BusinessOsAccountLineageLevel | undefined,
  lineageUnread: boolean,
  paid: PaidInvoiceLookup,
  logger: InviteOpsLogger | undefined
): InvitePaymentView | null {
  if (lineageUnread) return { state: 'unknown' };
  if (!lineage) return null;

  if (typeof lineage.first_paid_at === 'string') {
    if (typeof lineage.first_payment_ref !== 'string') return { state: 'paid_record_missing' };
    const key = pairKey(lineage.account_id, lineage.first_payment_ref);
    if (paid.unread.has(key)) return { state: 'unknown' };
    const fact = paid.byPair.get(key);
    if (!fact) {
      // SA Q-8: said, never guessed from the lineage date (AC-F2.2). Ids only.
      logger?.warn(
        { event: 'bos_invite_admin_payment_record_missing', inviteId: row.id, accountId: lineage.account_id },
        'A stamped first payment has no matching money-history row'
      );
      return { state: 'paid_record_missing' };
    }
    return { state: 'paid_recorded', paidAt: fact.paidAt, amountMinor: fact.amountMinor, currency: fact.currency, livemode: fact.livemode };
  }

  // The gate's own predicate, with the grant kind already on the invite row: no extra read (P5-C10).
  return isAwaitingPayment(lineage, row.grant_kind) ? { state: 'awaiting_payment' } : null;
}

export type ListInvitesOutcome =
  | { ok: true; invites: InviteListView[]; stoppedHalfway: StoppedHalfwaySummary; truncated: boolean }
  | { ok: false };

/**
 * The newest invites (up to `INVITE_LIST_CEILING`), each with its derived
 * state, the lineage level of accepted ones (Slice 1b) and their parent account
 * (Slice 5b, FR-36), the T-16 banner summary,
 * and `truncated` (Slice 1c): the ceiling was reached, so older invites may
 * exist that the list, and therefore its filters and search, cannot see.
 *
 * Filtering and search happen on the screen over these rows, against the
 * server-derived `state`, `openedByExistingAccountAt` and
 * `redemptionStoppedHalfway` (C-11: one derivation of state, here).
 *
 * A failed lineage read does not fail the list: levels show as unknown.
 *
 * Plan payments P-5b.2 (FR-25, S5-8, SA C-11): each accepted row also gets its
 * `payment`. The (account, invoice) pairs come ONLY from the lineage rows read
 * here (`account_id`, `first_payment_ref` of a stamped row), are read in
 * batches through `billingEvents`, and the money history answers only for an
 * exact pair. A failed read shows `unknown`, never "not paid".
 */
export async function listInvitesForAdmin(deps: {
  repository: Pick<AdminInviteRepository, 'listRecentForAdmin'>;
  lineage?: Pick<BusinessOsAccountLineageRepository, 'findByInviteIdsForAdmin'>;
  /** P-5b.2: the money history, for the paid line. Missing: a paid row reads `unknown`. */
  billingEvents?: PaidInvoiceReader;
  config: EntitlementConfig;
  now: Date;
  logger?: InviteOpsLogger;
}): Promise<ListInvitesOutcome> {
  const { data, error } = await deps.repository.listRecentForAdmin({ limit: INVITE_LIST_CEILING });
  if (error || !data) return { ok: false };

  const lineageByInvite = new Map<string, BusinessOsAccountLineageLevel>();
  // P-5b.2: accepted invites whose lineage batch failed, so their payment is `unknown`.
  const lineageUnread = new Set<string>();
  const redeemedIds = data.filter((row) => row.redeemed_at).map((row) => row.id);
  if (deps.lineage) {
    for (let start = 0; start < redeemedIds.length; start += INVITE_LINEAGE_BATCH) {
      const batch = redeemedIds.slice(start, start + INVITE_LINEAGE_BATCH);
      const lineage = await deps.lineage.findByInviteIdsForAdmin(batch);
      if (lineage.error) {
        // SA N-3: the list still answers (levels show as unknown), but it is said.
        deps.logger?.warn({ err: lineage.error, invites: batch.length }, 'Could not read lineage levels for the invite list');
        for (const id of batch) lineageUnread.add(id);
      }
      for (const entry of lineage.data ?? []) {
        if (entry.invite_id) lineageByInvite.set(entry.invite_id, entry);
      }
    }
  }

  const paid = await readPaidInvoices([...lineageByInvite.values()], deps.billingEvents, deps.logger);

  const invites = data.map((row) => {
    const lineage = lineageByInvite.get(row.id);
    const payment = row.redeemed_at ? paymentViewFor(row, lineage, lineageUnread.has(row.id), paid, deps.logger) : null;
    return toInviteListView(row, deps.config, deps.now, lineage?.level ?? null, lineage?.parent_account_id ?? null, payment);
  });
  const stopped = invites.filter((invite) => invite.redemptionStoppedHalfway).map((invite) => invite.id);
  return {
    ok: true,
    invites,
    stoppedHalfway: { count: stopped.length, inviteIds: stopped },
    truncated: data.length >= INVITE_LIST_CEILING,
  };
}

// ── Revoke ──────────────────────────────────────────────────────────────────

export type RevokeInviteOutcome =
  | { ok: true; invite: InviteListView; row: BusinessOsInvite }
  | {
      ok: false;
      status: 404 | 409 | 500;
      error: 'invite_not_found' | 'invite_not_revocable' | 'signup_in_progress' | 'could_not_revoke_invite';
    };

/**
 * Revoke a pending or expired invite (FR-6). One conditional UPDATE; when it
 * matches nothing, a read tells "no such invite" (404) from "accepted or
 * already revoked" (409).
 */
export async function revokeInviteForAdmin(
  inviteId: string,
  body: RevokeInviteBody,
  deps: {
    adminId: string;
    repository: Pick<AdminInviteRepository, 'revokeForAdmin' | 'findByIdForAdmin'>;
    config: EntitlementConfig;
    now: Date;
  }
): Promise<RevokeInviteOutcome> {
  const revoked = await deps.repository.revokeForAdmin({
    id: inviteId,
    adminId: deps.adminId,
    reason: body.reason,
    now: deps.now,
    // Slice 1b (I-2): a live signup claim blocks the revoke.
    claimLeaseCutoff: claimLeaseCutoff(deps.now),
  });

  if (revoked.error) return { ok: false, status: 500, error: 'could_not_revoke_invite' };
  if (revoked.data) {
    return { ok: true, invite: toInviteListView(revoked.data, deps.config, deps.now), row: revoked.data };
  }

  const existing = await deps.repository.findByIdForAdmin(inviteId);
  if (existing.error) return { ok: false, status: 500, error: 'could_not_revoke_invite' };
  if (!existing.data) return { ok: false, status: 404, error: 'invite_not_found' };
  const row = existing.data;
  if (!row.redeemed_at && !row.revoked_at && isClaimLive(row.claimed_at, deps.now)) {
    return { ok: false, status: 409, error: 'signup_in_progress' };
  }
  return { ok: false, status: 409, error: 'invite_not_revocable' };
}
