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
 *   Paid invites (C-6). It stays `false` until Slice 5, when the Business OS
 *   checkout (reuse-plan S-4a) exists. Flipping it is a config edit, not code.
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
 * Checked at creation and, from Slice 1, re-checked at redemption. The future
 * champion-to-friend invites add one entry here (an `account` issuer that may
 * issue Paid only); nothing else changes.
 */
export const INVITE_ISSUANCE_POLICY = {
  admin: [CHAMPION_INVITE_TYPE, PAID_INVITE_TYPE] as readonly InviteTypeId[],
  /** The C-6 switch. `false` until Slice 5: the server refuses every Paid invite. */
  paidInvitesAvailable: false as boolean,
  /** What the form says beside the disabled Paid option (FR-1). */
  paidUnavailableReason: 'available when payments are live',
} as const;
