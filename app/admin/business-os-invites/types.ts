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
  formOptions: InviteFormOptions;
  enforcementMode: EnforcementMode;
}

/** POST /api/admin/business-os/invites → `data`. The link is shown once. */
export interface CreatedInvite {
  invite: InviteRow;
  link: string;
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
}
