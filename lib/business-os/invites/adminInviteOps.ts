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
 */

import { defaultLocale, locales } from '@/lib/i18n/config';
import {
  CHAMPION_ACCESS_MONTHS_MAX,
  INVITE_ISSUANCE_POLICY,
  INVITE_LINK_EXPIRY,
  INVITE_TYPES,
  PAID_INVITE_TYPE,
  type InviteTypeId,
} from '@/lib/business-os/entitlements/config/invites';
import { planLabel } from '@/lib/business-os/entitlements/planPresentation';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { BusinessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { UserProfileRepository } from '@/lib/repositories/UserProfileRepository';
import type { BusinessOsInvite } from '@/lib/repositories/types';

import { deriveInviteState, type InviteState } from './inviteState';
import { buildInviteLink, generateInviteToken, hashInviteToken } from './inviteToken';
import { describeInviteAccess, isInviteGrantAvailable } from './inviteOffer';
import type { CreateInviteBody, RevokeInviteBody } from './inviteSchemas';
import { claimLeaseCutoff, isClaimLive } from './signupCodePolicy';

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
  'createForAdmin' | 'listRecentForAdmin' | 'findByIdForAdmin' | 'revokeForAdmin'
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
   * Slice 1b (FR-12a, SA D-3, T-16): a signup that stopped halfway, derived
   * from data: not redeemed AND (a failure is recorded OR a claim is older than
   * the lease). The second half catches a function killed by its timeout, which
   * could record nothing.
   */
  redemptionStoppedHalfway: boolean;
  /** Slice 1b (SA D-2): the last recorded failure. Never an email. */
  redemptionFailure: InviteRedemptionFailureView | null;
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
  'redemptionStoppedHalfway',
  'redemptionFailure',
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
  level: number | null = null
): InviteListView {
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
 * (D-10). The language default is `en` for Slice 0 (C-8 as amended by SA): the
 * inviter's saved preference arrives with Slice 2.
 */
export function buildInviteFormOptions(config: EntitlementConfig): InviteFormOptions {
  return {
    expiryDays: [...INVITE_LINK_EXPIRY.optionsDays],
    defaultExpiryDays: INVITE_LINK_EXPIRY.defaultDays,
    languages: [...locales],
    defaultLanguage: defaultLocale,
    championAccessMonthsMax: CHAMPION_ACCESS_MONTHS_MAX,
    inviteTypes: INVITE_ISSUANCE_POLICY.admin.map((type) => {
      const definition = INVITE_TYPES[type];
      const refusal = refusalFor(type);
      const isCohort = definition.grantKind === 'cohort';

      return {
        type,
        label: isCohort ? `${definition.label} (${planLabel(config, definition.defaultGrantId)})` : definition.label,
        available: refusal === null,
        unavailableReason: refusal === 'paid_invites_not_available' ? INVITE_ISSUANCE_POLICY.paidUnavailableReason : null,
        requiresAccess: isCohort,
        grants: isCohort
          ? []
          : (definition.grantIds as readonly string[]).map((id) => ({
              id,
              label: planLabel(config, id),
              default: id === definition.defaultGrantId,
            })),
      };
    }),
  };
}

// ── Create ──────────────────────────────────────────────────────────────────

export type CreateInviteOutcome =
  | { ok: true; invite: InviteListView; link: string; row: BusinessOsInvite }
  | {
      ok: false;
      status: 409 | 500;
      error: 'invite_type_not_allowed' | 'paid_invites_not_available' | 'grant_not_available' | 'could_not_create_invite';
    };

export interface CreateInviteDeps {
  adminId: string;
  repository: Pick<AdminInviteRepository, 'createForAdmin'>;
  profileRepository: Pick<UserProfileRepository, 'findById'>;
  config: EntitlementConfig;
  now: Date;
  logger: InviteOpsLogger;
}

/**
 * The inviter's name, snapshotted onto the invite (C-9), so the public page
 * never reads admin data. `profiles.full_name`, trimmed and capped; otherwise
 * "AgentPilot". A failed read is a warning, not a failed invite.
 */
async function inviterDisplayNameFor(deps: CreateInviteDeps): Promise<string> {
  const { data, error } = await deps.profileRepository.findById(deps.adminId);
  if (error) {
    deps.logger.warn({ err: error, adminId: deps.adminId }, 'Could not read the inviting admin\'s name; using the fallback');
    return INVITER_NAME_FALLBACK;
  }

  const name = typeof data?.full_name === 'string' ? Array.from(data.full_name.trim()).slice(0, INVITER_NAME_MAX).join('').trim() : '';
  return name.length > 0 ? name : INVITER_NAME_FALLBACK;
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
  });

  if (error || !data) return { ok: false, status: 500, error: 'could_not_create_invite' };

  return {
    ok: true,
    invite: toInviteListView(data, deps.config, deps.now),
    link: buildInviteLink(token),
    row: data,
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

export type ListInvitesOutcome =
  | { ok: true; invites: InviteListView[]; stoppedHalfway: StoppedHalfwaySummary; truncated: boolean }
  | { ok: false };

/**
 * The newest invites (up to `INVITE_LIST_CEILING`), each with its derived
 * state, the lineage level of accepted ones (Slice 1b), the T-16 banner summary,
 * and `truncated` (Slice 1c): the ceiling was reached, so older invites may
 * exist that the list, and therefore its filters and search, cannot see.
 *
 * Filtering and search happen on the screen over these rows, against the
 * server-derived `state`, `openedByExistingAccountAt` and
 * `redemptionStoppedHalfway` (C-11: one derivation of state, here).
 *
 * A failed lineage read does not fail the list: levels show as unknown.
 */
export async function listInvitesForAdmin(deps: {
  repository: Pick<AdminInviteRepository, 'listRecentForAdmin'>;
  lineage?: Pick<BusinessOsAccountLineageRepository, 'findByInviteIdsForAdmin'>;
  config: EntitlementConfig;
  now: Date;
  logger?: InviteOpsLogger;
}): Promise<ListInvitesOutcome> {
  const { data, error } = await deps.repository.listRecentForAdmin({ limit: INVITE_LIST_CEILING });
  if (error || !data) return { ok: false };

  const levels = new Map<string, number>();
  const redeemedIds = data.filter((row) => row.redeemed_at).map((row) => row.id);
  if (deps.lineage) {
    for (let start = 0; start < redeemedIds.length; start += INVITE_LINEAGE_BATCH) {
      const batch = redeemedIds.slice(start, start + INVITE_LINEAGE_BATCH);
      const lineage = await deps.lineage.findByInviteIdsForAdmin(batch);
      if (lineage.error) {
        // SA N-3: the list still answers (levels show as unknown), but it is said.
        deps.logger?.warn({ err: lineage.error, invites: batch.length }, 'Could not read lineage levels for the invite list');
      }
      for (const entry of lineage.data ?? []) {
        if (entry.invite_id) levels.set(entry.invite_id, entry.level);
      }
    }
  }

  const invites = data.map((row) => toInviteListView(row, deps.config, deps.now, levels.get(row.id) ?? null));
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
