/**
 * Business OS invites — the settings an admin chooses from, and who may issue
 * what. Invite-only signup, Slice 0 (requirement §4.1, §5, T-14, T-15, C-7).
 *
 * ── Why here, inside the entitlements config ────────────────────────────────
 * An invite's grant IS an entitlements basis (a cohort or a tier), so the ids an
 * invite may carry are read from `COHORT_IDS` and `TIER_ORDER` rather than
 * written again. This folder is also the one place the tier-literal guard
 * (FR-12) lets a plan id appear, which keeps every invite module outside it free
 * of plan names: they import these constants and name nothing.
 *
 * ── What changing a value here does ─────────────────────────────────────────
 * - `INVITE_LINK_EXPIRY`: the choices on the create form, and the only values
 *   the create route accepts. The chosen day count is stamped on each invite at
 *   creation, so a change affects NEW invites only (T-14, AC-3).
 * - `INVITE_ISSUANCE_POLICY.paidInvitesAvailable`: the server-side switch for
 *   Paid invites (C-6). It stays `false` until Slice 5c, when the Business OS
 *   checkout (reuse-plan S-4a) exists. Flipping it is a config edit, not code.
 * - `INVITE_ISSUANCE_POLICY.accountInvitesAvailable` (Slice 5a, T-18): the
 *   switch for champion-issued friend invites. `true` since 2026-10-01, when the
 *   user chose to switch it on (BQ-13). Rollback: the same one-line flip back
 *   to `false`.
 * - `FRIEND_INVITE_LIMITS` (Slice 5a, T-17, T-21): the lifetime allowance and
 *   the daily send limit, passed to the SQL send function as parameters.
 *
 * Pure data: no I/O, safe to import anywhere, including client bundles (the
 * admin page still receives these values through its GET payload rather than
 * importing them, so it cannot re-derive a rule).
 */

import { COHORT_IDS, type CohortId } from './cohorts';
import { TIER_ORDER, type TierId } from './tierMatrix';

/** Link expiry choices, in days (BQ-1). The default must be one of the options. */
export const INVITE_LINK_EXPIRY = {
  optionsDays: [15, 30, 60] as const,
  defaultDays: 30,
} as const;

/**
 * The longest champion access an admin may set, in months (D-13).
 *
 * A value policy, so it lives here and not in SQL: the database only checks
 * that a month count is positive.
 */
export const CHAMPION_ACCESS_MONTHS_MAX = 60;

/** The invite type that grants the free champion cohort. */
export const CHAMPION_INVITE_TYPE = 'champion' as const;

/** The invite type that grants a paid tier, bought at signup. */
export const PAID_INVITE_TYPE = 'paid' as const;

/** The one champion cohort, checked against the cohort config below. */
const CHAMPION_COHORT: CohortId = 'champion';

/**
 * The invite types, and which entitlements basis each may grant (GR-1).
 *
 * `grantKind` is what the database stores and what every rule keys on: a
 * `cohort` grant needs an access decision (RC-4), a `tier` grant needs payment.
 * No code outside this file branches on an invite type's NAME.
 *
 * There is no trial invite type (BQ-3), although the cohort stays in config.
 */
export const INVITE_TYPES = {
  [CHAMPION_INVITE_TYPE]: {
    label: 'Champion',
    grantKind: 'cohort',
    grantIds: COHORT_IDS.filter((id) => id === CHAMPION_COHORT) as readonly CohortId[],
    defaultGrantId: CHAMPION_COHORT as string,
  },
  [PAID_INVITE_TYPE]: {
    label: 'Paid',
    grantKind: 'tier',
    grantIds: TIER_ORDER as readonly TierId[],
    // Essentials by default, derived rather than written (C-7).
    defaultGrantId: TIER_ORDER[0] as string,
  },
} as const;

export type InviteTypeId = keyof typeof INVITE_TYPES;
export type InviteGrantKind = (typeof INVITE_TYPES)[InviteTypeId]['grantKind'];

/** Every invite type, in the order the form offers them. */
export const INVITE_TYPE_IDS = Object.keys(INVITE_TYPES) as InviteTypeId[];

/**
 * Who may issue which invite type (GR-3, T-15).
 *
 * Checked at creation and, from Slice 1, re-checked at redemption.
 *
 * `account` (Slice 5a, T-18): a champion account may issue ONE kind of invite,
 * Paid to the first tier, and nothing else (BQ-14, FR-30). It is an issuance
 * rule on WHO MAY INVITE, keyed on the cohort, not a capability: the allowance
 * lives in `FRIEND_INVITE_LIMITS` below, not in the catalog (SA T-17).
 *
 * The two switches are separate on purpose (T-18):
 * - `paidInvitesAvailable` means "payment is live" (C-6). It also gates admin
 *   Paid invites (F5c-3).
 * - `accountInvitesAvailable` means "champions may send friend invites". Code
 *   config, not an environment variable: turning it on or off is a one-line
 *   change released through the normal review. It was switched on 2026-10-01,
 *   after 5b shipped, by the user's choice (slice 5b workplan §10).
 */
export const INVITE_ISSUANCE_POLICY = {
  admin: [CHAMPION_INVITE_TYPE, PAID_INVITE_TYPE] as readonly InviteTypeId[],
  account: {
    /** The cohort an issuing account must hold, in force. */
    issuerCohort: CHAMPION_COHORT as string,
    /** The only type a champion may issue. */
    inviteType: PAID_INVITE_TYPE as InviteTypeId,
    /** Essentials, derived rather than written (C-7, FR-30). */
    grantId: TIER_ORDER[0] as string,
  },
  /** The C-6 switch. `false` until Slice 5c: the server refuses every Paid invite at redemption. */
  paidInvitesAvailable: false as boolean,
  /** The T-18 switch: friend invites from champion accounts. On since 2026-10-01, by the user's choice (BQ-13). */
  accountInvitesAvailable: true as boolean,
  /** What the form says beside the disabled Paid option (FR-1). */
  paidUnavailableReason: 'available when payments are live',
} as const;

/**
 * The friend-invite allowance and the anti-abuse limit (BQ-10, BQ-15, T-17, T-21).
 *
 * - `lifetimeAllowance`: a business allowance. Counted = not revoked AND
 *   (accepted OR claimed OR not yet expired), so revoked and expired invites
 *   give their slot back. Shown to the champion as "N of <allowance> left".
 * - `dailySendLimit` per `dailyWindowHours` (rolling): a RATE LIMIT on attempts,
 *   whatever their state. Never shown as a number.
 *
 * All three are passed to `business_os_create_friend_invite` as parameters, so
 * the SQL holds no number and moving the allowance to a capability later is a
 * TypeScript change with no migration.
 */
export const FRIEND_INVITE_LIMITS = {
  lifetimeAllowance: 5,
  dailySendLimit: 10,
  dailyWindowHours: 24,
} as const;
