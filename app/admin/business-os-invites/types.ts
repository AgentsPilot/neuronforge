/**
 * The shapes this screen receives over HTTP, and nothing else.
 *
 * Declared here rather than imported from `lib/business-os/invites`, because the
 * screen imports nothing from outside its own folder (see the source guard): the
 * server decides every option, label and state, and this file only describes
 * what arrives. `payload.contract` would be the place to pin the two together;
 * the route tests pin the server side of it.
 */

export type InviteState = 'pending' | 'expired' | 'revoked' | 'accepted';

export type EnforcementMode = 'off' | 'shadow' | 'enforce';

/**
 * Slice 2a: what happened to the invitation email, derived on the server
 * (`deriveInviteEmailStatus`). `unknown` means an attempt with no recorded
 * outcome (a send cut off, or a result that could not be written).
 */
export type InviteEmailStatus = 'not_emailed' | 'sent' | 'sent_untracked' | 'not_sent' | 'unknown';

/** One invite, as the list and the create response carry it. */
export interface InviteRow {
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
  /** Slice 1b: the invitation circle (1 for an admin invite), or null. */
  level: number | null;
  /** Slice 1b (FR-12a, T-16): the signup stopped halfway (derived on the server). */
  redemptionStoppedHalfway: boolean;
  /** Slice 1b (SA D-2): the last recorded failure. Never an email. */
  redemptionFailure: {
    at: string;
    step: string;
    errorCode: string | null;
    errorMessage: string | null;
    accountId: string | null;
  } | null;
  /** Slice 2a: the invitation email. Absent from an older server: nothing is shown. */
  emailStatus?: InviteEmailStatus;
  emailStatusAt?: string | null;
  /**
   * Slice 5a (F5a-11): who issued it. `account` is a champion's friend invite;
   * `issuerAccountId` is then that champion's account id. Absent from an older
   * server: the row reads as an admin invite.
   */
  issuerKind?: InviteIssuerKind;
  issuerAccountId?: string | null;
  /** Slice 5a (F5a-8): revoked by the champion who sent it, not by an admin. */
  revokedByInviter?: boolean;
}

/** Slice 5a: who issued an invite. */
export type InviteIssuerKind = 'admin' | 'account';

/** T-16: the banner summary (counts and invite ids only). */
export interface StoppedHalfwaySummary {
  count: number;
  inviteIds: string[];
}

export interface InviteTypeOption {
  type: string;
  label: string;
  available: boolean;
  unavailableReason: string | null;
  requiresAccess: boolean;
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

/** GET /api/admin/business-os/invites → `data`. */
export interface InvitesPayload {
  invites: InviteRow[];
  /** Slice 1b (T-16). Absent from an older server: treated as none. */
  stoppedHalfway?: StoppedHalfwaySummary;
  /** Slice 1c: the server's list ceiling was reached; older invites exist. Absent from an older server. */
  truncated?: boolean;
  formOptions: InviteFormOptions;
  enforcementMode: EnforcementMode;
}

/** POST /api/admin/business-os/invites → `data`. The link is shown once. */
export interface CreatedInvite {
  invite: InviteRow;
  link: string;
  /** Slice 2a: status words only (no address, message id or error). Absent from an older server. */
  email?: { requested: boolean; status: InviteEmailStatus };
}

/** What the create form sends. Built from the options; never names a plan. */
export interface CreateInviteRequest {
  inviteType: string;
  email: string;
  linkExpiryDays: number;
  language: string;
  personalNote?: string;
  reason: string;
  access?: { kind: 'open_ended' } | { kind: 'months'; months: number };
  grantId?: string;
  /** Slice 2a (FR-14): email the invitation now. Required by the server. */
  sendEmail: boolean;
}
