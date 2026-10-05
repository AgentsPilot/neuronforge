import 'server-only';

/**
 * Friend invites from a champion account (invite-only signup, Slice 5a;
 * requirement §7.9 FR-28 to FR-33, §17 T-17 to T-21, F5a-1 to F5a-16).
 *
 * Pure functions that receive their repositories and clock, following
 * `adminInviteOps.ts`, so every rule is testable without a request. The routes
 * stay thin: auth, Zod, HTTP shape, audit.
 *
 * ── Who may invite (FR-28, BQ-14, T-17 mode, T-18) ──────────────────────────
 * `accountInvitesAvailable` is on AND the account's plan row holds the issuer
 * cohort from config, not past `cohort_expires_at`. Read from the plan row
 * (`findEntitlementInputs`), never through `check()` or `getSnapshot()`: the
 * allowance is a business rule, so `shadow` or `off` must not change it. This
 * TypeScript check only decides what the GET shows and saves the POST a round
 * trip; the SQL send function re-checks it under the lock and is what decides.
 *
 * ── The count (T-17) ────────────────────────────────────────────────────────
 * `isCountedFriendInvite` mirrors the SQL predicate in migration 20261023
 * exactly (a text test pins the two together): not revoked AND (accepted OR
 * claimed OR not yet expired). The display uses it; the SQL refusal is what
 * counts.
 *
 * ── What a champion is shown (F5a-9) ────────────────────────────────────────
 * `toFriendInviteView` returns id, email, dates, status and whether the slot
 * came back. Never whether the friend opened the link or whether the address
 * has an account.
 *
 * ── The raw token (C-3) ─────────────────────────────────────────────────────
 * Generated here, hashed at once, and returned only inside the `link` of a
 * successful send. Never logged, audited or stored.
 */

import { locales, type Locale } from '@/lib/i18n/config';
import { FRIEND_INVITE_LIMITS, INVITE_ISSUANCE_POLICY, INVITE_LINK_EXPIRY } from '@/lib/business-os/entitlements/config/invites';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { UserPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import type { UserProfileRepository } from '@/lib/repositories/UserProfileRepository';
import type { BusinessOsFriendInviteListRow } from '@/lib/repositories/types';

import { INVITER_NAME_FALLBACK, inviterNameFromProfile, resolveInviteFormLanguage } from './adminInviteOps';
import { sendInvitationEmail, type InvitationEmailDeps, type InvitationEmailOutcome } from './inviteEmail';
import type { SendFriendInviteBody } from './inviteSchemas';
import { normaliseReplyToAddress } from './inviteSender';
import { deriveInviteState } from './inviteState';
import { buildInviteLink, generateInviteToken, hashInviteToken } from './inviteToken';
import { claimLeaseCutoff } from './signupCodePolicy';

/** `internal_reason` is required by the table (3–500); a champion supplies none (§17.1, D-4). */
export const FRIEND_INVITE_INTERNAL_REASON = 'Friend invite from a champion account';

/**
 * `revoke_reason` is required on a revoked row. With `revoked_by_admin_id` left
 * NULL it records a revoke by the inviting champion (F5a-8, D-4).
 */
export const FRIEND_INVITE_REVOKE_REASON = 'Revoked by the inviting champion';

// Re-exported so a test can pin the nameless-champion rule (SA R-1) without
// reaching into the admin module.
export { INVITER_NAME_FALLBACK };

/** Only the logger levels these operations use. */
export interface FriendInviteLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
}

export type FriendInviteRepository = Pick<
  BusinessOsInviteRepository,
  | 'createForIssuerAccount'
  | 'listForIssuerAccount'
  | 'revokeForIssuerAccount'
  | 'findRedeemedForIssuerAccount'
  | 'recordInviteEmailOutcome'
>;

/** The plan-row facts eligibility reads. */
export interface IssuerPlanFacts {
  cohort: string | null;
  cohort_expires_at: string | null;
}

/**
 * The one plan-row read eligibility needs: `findEntitlementInputs` on the plan
 * repository, described structurally so this module never names that
 * repository (RC-15: only the wiring in `friendInviteDeps.ts` does, read-only).
 */
export interface IssuerPlanReader {
  findEntitlementInputs(
    accountId: string
  ): Promise<{ data: { plan: IssuerPlanFacts | null } | null; error: Error | null }>;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

/** Is the friend-invite switch on? A config constant, no I/O (T-18). */
export function areFriendInvitesSwitchedOn(): boolean {
  return INVITE_ISSUANCE_POLICY.accountInvitesAvailable === true;
}

/**
 * Does this plan row hold the issuer cohort, in force at `now`? Mirrors the SQL
 * re-check: `cohort` equal AND (`cohort_expires_at` NULL OR later than now). An
 * unreadable expiry is not in force (fails closed).
 */
export function isInForceChampion(plan: IssuerPlanFacts | null | undefined, now: Date): boolean {
  if (!plan || plan.cohort !== INVITE_ISSUANCE_POLICY.account.issuerCohort) return false;
  if (plan.cohort_expires_at === null) return true;
  const endsAt = Date.parse(plan.cohort_expires_at);
  return Number.isFinite(endsAt) && endsAt > now.getTime();
}

export type EligibilityOutcome = { ok: true; eligible: boolean } | { ok: false };

/**
 * The switch, then the plan row. `{ ok: false }` means the plan read failed
 * (the route answers 500), never "not eligible" by default.
 */
export async function checkFriendInviteEligibility(deps: {
  accountId: string;
  plans: IssuerPlanReader;
  now: Date;
}): Promise<EligibilityOutcome> {
  if (!areFriendInvitesSwitchedOn()) return { ok: true, eligible: false };
  const { data, error } = await deps.plans.findEntitlementInputs(deps.accountId);
  if (error || !data) return { ok: false };
  return { ok: true, eligible: isInForceChampion(data.plan, deps.now) };
}

// ── The count and the status ────────────────────────────────────────────────

/** The row facts the count and the status are derived from. */
export type FriendInviteCountFacts = Pick<
  BusinessOsFriendInviteListRow,
  'link_expires_at' | 'revoked_at' | 'redeemed_at' | 'claimed_account_id'
>;

/**
 * T-17's counted predicate, mirroring migration 20261023 exactly: not revoked
 * AND (accepted OR claimed OR `link_expires_at > now`). A claimed invite keeps
 * its slot past its expiry, so a signup that finishes late cannot let one more
 * invite through.
 */
export function isCountedFriendInvite(row: FriendInviteCountFacts, now: Date): boolean {
  if (row.revoked_at !== null) return false;
  if (row.redeemed_at !== null || row.claimed_account_id !== null) return true;
  const expiresAt = Date.parse(row.link_expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

/**
 * What a champion's list says about one invite (FR-31). `joined` is derived
 * from `redeemed_at` only (F5b-7): the section words it "Signed up — not
 * subscribed yet", because a friend is held until payment (Slice 5c).
 */
export type FriendInviteStatus = 'pending' | 'expired' | 'revoked' | 'joined';

/**
 * The status, from `deriveInviteState` (C-11) and the counted predicate: a
 * claimed-past-expiry invite still holds its slot, so it stays Pending.
 */
export function friendInviteStatus(row: FriendInviteCountFacts, now: Date): FriendInviteStatus {
  const state = deriveInviteState(row, now);
  if (state === 'accepted') return 'joined';
  if (state === 'revoked') return 'revoked';
  return isCountedFriendInvite(row, now) ? 'pending' : 'expired';
}

/** One invite as the champion sees it (F5a-9). Nothing else, ever. */
export interface FriendInviteView {
  id: string;
  email: string;
  createdAt: string;
  linkExpiresAt: string;
  status: FriendInviteStatus;
  /** Revoked or expired: the slot is back in the allowance (FR-31, BQ-15). */
  slotReturned: boolean;
}

/** The exact keys of `FriendInviteView`, for tests that pin the allow-list. */
export const FRIEND_INVITE_VIEW_KEYS: ReadonlyArray<keyof FriendInviteView> = [
  'id',
  'email',
  'createdAt',
  'linkExpiresAt',
  'status',
  'slotReturned',
];

/** The one row → view mapper. Built field by field; nothing is spread. */
export function toFriendInviteView(row: BusinessOsFriendInviteListRow, now: Date): FriendInviteView {
  const status = friendInviteStatus(row, now);
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    linkExpiresAt: row.link_expires_at,
    status,
    slotReturned: status === 'revoked' || status === 'expired',
  };
}

/** Invites left, from the rows read: `allowance − counted`, never below 0 (D-8). */
export function remainingAllowance(rows: FriendInviteCountFacts[], now: Date): number {
  const counted = rows.filter((row) => isCountedFriendInvite(row, now)).length;
  return Math.max(FRIEND_INVITE_LIMITS.lifetimeAllowance - counted, 0);
}

// ── The summary (GET) ───────────────────────────────────────────────────────

export interface FriendInviteSummary {
  eligible: true;
  allowance: number;
  remaining: number;
  defaultLanguage: Locale;
  languages: readonly string[];
  invites: FriendInviteView[];
  /** The list reached its cap: older invites exist that it cannot see (SA Q-7). */
  truncated: boolean;
}

export type SummaryOutcome = { ok: true; summary: FriendInviteSummary | { eligible: false } } | { ok: false };

export async function getFriendInviteSummary(deps: {
  accountId: string;
  plans: IssuerPlanReader;
  repository: Pick<FriendInviteRepository, 'listForIssuerAccount'>;
  preferences: Pick<UserPreferencesRepository, 'findPreferredLanguage'>;
  listLimit: number;
  now: Date;
  logger: FriendInviteLogger;
}): Promise<SummaryOutcome> {
  const eligibility = await checkFriendInviteEligibility(deps);
  if (!eligibility.ok) return { ok: false };
  if (!eligibility.eligible) return { ok: true, summary: { eligible: false } };

  const { data, error } = await deps.repository.listForIssuerAccount(deps.accountId, { limit: deps.listLimit });
  if (error || !data) return { ok: false };

  // C-8: the champion's saved language, or English. Never `LanguageContext`.
  const defaultLanguage = await resolveInviteFormLanguage({
    adminId: deps.accountId,
    preferences: deps.preferences,
    logger: deps.logger,
  });

  return {
    ok: true,
    summary: {
      eligible: true,
      allowance: FRIEND_INVITE_LIMITS.lifetimeAllowance,
      remaining: remainingAllowance(data, deps.now),
      defaultLanguage,
      languages: locales,
      invites: data.map((row) => toFriendInviteView(row, deps.now)),
      truncated: data.length >= deps.listLimit,
    },
  };
}

// ── Send (POST) ─────────────────────────────────────────────────────────────

/** Why a send was refused. Audited by class only (F5a-13), except `not_eligible`, which is logged and never audited (N-4, Slice 5b). */
export type FriendInviteRefusal = 'not_eligible' | 'own_email' | 'allowance_reached' | 'daily_limit' | 'already_invited';

export type SendFriendInviteOutcome =
  | {
      ok: true;
      invite: FriendInviteView;
      link: string;
      inviteId: string;
      language: string;
      email: InvitationEmailOutcome;
    }
  | { ok: false; status: 403 | 409 | 429; refusal: FriendInviteRefusal }
  | { ok: false; status: 500; refusal: null };

/** The HTTP status of each refusal (T-21: 429 for the rate limit, 409 for the allowance or a duplicate). */
export const FRIEND_INVITE_REFUSAL_STATUS: Record<FriendInviteRefusal, 403 | 409 | 429> = {
  not_eligible: 403,
  own_email: 409,
  allowance_reached: 409,
  already_invited: 409,
  daily_limit: 429,
};

/**
 * One message per refusal (T-21: the allowance and a duplicate are 409 with
 * their own messages; the rate limit is 429 and never names its number). The
 * allowance is interpolated from config, never written (SA R-7). The settings
 * section maps the codes to en/he/es; these are the API's own words.
 */
export function friendInviteRefusalMessage(refusal: FriendInviteRefusal): string {
  switch (refusal) {
    case 'not_eligible':
      return 'Friend invites are not available for this account.';
    case 'own_email':
      return "You can't invite yourself.";
    case 'allowance_reached':
      return `All ${FRIEND_INVITE_LIMITS.lifetimeAllowance} of your invites are in use.`;
    case 'already_invited':
      return 'You already have a live invite to this address.';
    case 'daily_limit':
      return "You've sent a lot of invites today. Please try again tomorrow.";
  }
}

export interface SendFriendInviteDeps {
  accountId: string;
  /** The champion's auth email, from the verified session. Never from the body. */
  sessionEmail: string | null | undefined;
  plans: IssuerPlanReader;
  repository: Pick<FriendInviteRepository, 'createForIssuerAccount' | 'recordInviteEmailOutcome'>;
  profileRepository: Pick<UserProfileRepository, 'findById'>;
  config: EntitlementConfig;
  now: Date;
  logger: FriendInviteLogger;
  /** How to send and record the invitation email. The repository comes from `repository`. */
  email: Omit<InvitationEmailDeps, 'repository'>;
}

/** Trimmed and lower-cased, the way the body's email already is. */
function normaliseAddress(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  return address.length > 0 ? address : null;
}

/**
 * The champion's name, snapshotted onto the invite. A nameless champion, or a
 * failed read, is "AgentPilot", never the email (SA R-1).
 */
async function championDisplayName(deps: SendFriendInviteDeps): Promise<string> {
  const { data, error } = await deps.profileRepository.findById(deps.accountId);
  if (error) {
    deps.logger.warn({ accountId: deps.accountId }, "Could not read the champion's name; using the fallback");
    return INVITER_NAME_FALLBACK;
  }
  return inviterNameFromProfile(data?.full_name);
}

/**
 * Send one friend invite.
 *
 * Order (F5a-6 as amended by SA R-3; the body was ALREADY parsed by the
 * route's `.strict()` schema): switch (config, no I/O) → in-force champion →
 * own address → name, Reply-To and language → token → the SQL function (the
 * lock, cohort re-check, allowance, daily limit, per-recipient guard and
 * insert, T-17) → the email. A failed email never fails the send (FR-16): the
 * champion still gets the link.
 */
export async function sendFriendInvite(body: SendFriendInviteBody, deps: SendFriendInviteDeps): Promise<SendFriendInviteOutcome> {
  const eligibility = await checkFriendInviteEligibility(deps);
  if (!eligibility.ok) return { ok: false, status: 500, refusal: null };
  if (!eligibility.eligible) return { ok: false, status: 403, refusal: 'not_eligible' };

  const ownAddress = normaliseAddress(deps.sessionEmail);
  if (ownAddress !== null && ownAddress === normaliseAddress(body.email)) {
    return { ok: false, status: 409, refusal: 'own_email' };
  }

  const inviterDisplayName = await championDisplayName(deps);
  // FR-30: the champion's own account email, from the session. Never a field.
  const replyTo = normaliseReplyToAddress(deps.sessionEmail);
  const note = body.personalNote && body.personalNote.length > 0 ? body.personalNote : null;
  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const policy = INVITE_ISSUANCE_POLICY.account;

  const created = await deps.repository.createForIssuerAccount({
    issuerAccountId: deps.accountId,
    issuerCohort: policy.issuerCohort,
    inviteType: policy.inviteType,
    grantId: policy.grantId,
    allowance: FRIEND_INVITE_LIMITS.lifetimeAllowance,
    dailyLimit: FRIEND_INVITE_LIMITS.dailySendLimit,
    dailyWindowHours: FRIEND_INVITE_LIMITS.dailyWindowHours,
    tokenHash,
    email: body.email,
    inviterDisplayName,
    inviterReplyTo: replyTo,
    language: body.language,
    personalNote: note,
    internalReason: FRIEND_INVITE_INTERNAL_REASON,
    linkExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
  });

  if (created.error || !created.data) return { ok: false, status: 500, refusal: null };
  const result = created.data;
  if (result.outcome !== 'created') {
    return { ok: false, status: FRIEND_INVITE_REFUSAL_STATUS[result.outcome], refusal: result.outcome };
  }

  const email = await sendInvitationEmail(
    {
      row: {
        id: result.inviteId,
        email: body.email,
        grant_kind: 'tier',
        access_open_ended: null,
        access_months: null,
        inviter_display_name: inviterDisplayName,
        language: body.language,
        personal_note: note,
        link_expires_at: result.linkExpiresAt,
      },
      token,
      planName: planLabel(deps.config, policy.grantId),
      replyTo,
    },
    { ...deps.email, repository: deps.repository }
  );

  return {
    ok: true,
    inviteId: result.inviteId,
    language: body.language,
    link: buildInviteLink(token),
    email,
    invite: {
      id: result.inviteId,
      email: body.email,
      createdAt: deps.now.toISOString(),
      linkExpiresAt: result.linkExpiresAt,
      status: 'pending',
      slotReturned: false,
    },
  };
}

// ── Revoke ──────────────────────────────────────────────────────────────────

export type RevokeFriendInviteOutcome = { ok: true } | { ok: false; status: 404 | 409 | 500 };

/**
 * Revoke one of THIS account's invites (FR-32, F5a-8, SA Q-2): gated by the
 * session and by ownership INSIDE the UPDATE, not by the switch or the cohort,
 * so a champion can always withdraw their own pending invite.
 *
 * When the UPDATE matches nothing, a second read with the same issuer scope
 * (Slice 5b, 5a Q-3) tells "your friend already used it" (409) apart from
 * everything else. Not found, not yours and otherwise not revocable (already
 * revoked, a live claim) stay one 404, so another account's accepted invite is
 * still indistinguishable from a missing one.
 */
export async function revokeFriendInvite(deps: {
  accountId: string;
  inviteId: string;
  repository: Pick<FriendInviteRepository, 'revokeForIssuerAccount' | 'findRedeemedForIssuerAccount'>;
  now: Date;
}): Promise<RevokeFriendInviteOutcome> {
  const { data, error } = await deps.repository.revokeForIssuerAccount({
    id: deps.inviteId,
    issuerAccountId: deps.accountId,
    reason: FRIEND_INVITE_REVOKE_REASON,
    now: deps.now,
    claimLeaseCutoff: claimLeaseCutoff(deps.now),
  });
  if (error || data === null) return { ok: false, status: 500 };
  if (data) return { ok: true };

  const redeemed = await deps.repository.findRedeemedForIssuerAccount(deps.inviteId, deps.accountId);
  if (redeemed.error || redeemed.data === null) return { ok: false, status: 500 };
  return { ok: false, status: redeemed.data ? 409 : 404 };
}
