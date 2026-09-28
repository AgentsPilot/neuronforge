/**
 * An invite's state, derived from its timestamps (requirement §4.1, C-11, AC-3).
 *
 * ── Why derived, and why here only ──────────────────────────────────────────
 * `expired` is never written: no cron moves an invite between states, so there
 * is no job that can fail to run (the `CRON_SECRET` lesson). Both the admin list
 * and the public page call THIS function; neither compares `link_expires_at`
 * itself, so the two can never disagree about whether a link still works.
 *
 * It takes no config. The expiry was stamped on the row at creation, so changing
 * the expiry setting later cannot change an existing invite's state (AC-3).
 *
 * Precedence: accepted over revoked over expired over pending. The database
 * forbids revoked AND accepted together; the order is still fixed here so the
 * answer never depends on which check happens to run first.
 *
 * Pure: no I/O, no clock of its own.
 */

export type InviteState = 'pending' | 'expired' | 'revoked' | 'accepted';

/** Every state, in precedence order (for tests and the admin list's labels). */
export const INVITE_STATES: readonly InviteState[] = ['accepted', 'revoked', 'expired', 'pending'];

/** The timestamps the state is derived from. */
export interface InviteStateFacts {
  link_expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
}

/**
 * The state of one invite at `now`.
 *
 * The expiry instant itself counts as expired: a link "valid for 30 days" is not
 * valid at the first instant of day 31. An unreadable expiry is treated as
 * expired too, so a damaged row fails closed rather than open.
 */
export function deriveInviteState(row: InviteStateFacts, now: Date): InviteState {
  if (row.redeemed_at) return 'accepted';
  if (row.revoked_at) return 'revoked';

  const expiresAt = Date.parse(row.link_expires_at);
  if (!Number.isFinite(expiresAt) || now.getTime() >= expiresAt) return 'expired';

  return 'pending';
}
