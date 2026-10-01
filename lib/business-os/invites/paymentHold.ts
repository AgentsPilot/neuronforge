/**
 * The payment hold (invite-only signup Slice 5b; requirement GR-4, FR-24,
 * FR-35; T-13 layer 2; F5b-4; workplan D-7, SA R-3).
 *
 * An account created from a PAID invite that has not paid yet is held on the
 * "payment coming soon" screen: no onboarding, no Business OS pages, no trial
 * and no free use (BQ-13). Until 5c, every such account is a champion's friend.
 *
 * ── Keyed on lineage, never on `origin` (T-13) ──────────────────────────────
 * Held ⇔ the account has a lineage row AND `first_paid_at` is NULL AND
 * (`source = 'account_invite'` OR the invite it came from has a TIER grant).
 * `origin` is provenance for humans, not a control value. The second clause
 * already covers 5c's admin Paid invites (`admin_invite` + tier grant).
 *
 * ── Mode-independent (GR-5, F5b-4) ──────────────────────────────────────────
 * Nothing here reads the entitlements mode, `EntitlementService`, `check()` or a
 * plan row. So `shadow` and `off` cannot open it. This module imports nothing
 * from the entitlements module (a source guard in the test pins that).
 *
 * ── The short circuit (SA R-3) ──────────────────────────────────────────────
 * An unpaid `account_invite` row is held on the lineage read ALONE: the invite
 * is never read, so no error reading it can release a friend. The invite is
 * read only for an unpaid `admin_invite` row (5c's case), where its grant kind
 * decides.
 *
 * ── Failing open, and only then (SA Q-2) ────────────────────────────────────
 * `{ ok: false }` is returned only when a read that DECIDES failed: the lineage
 * read (nothing is known, and holding every customer on a blip is worse), or,
 * for an `admin_invite` row, the invite read. The gate treats it as "not held"
 * and logs at `error`; T-13 layer 1 still stops a trial. The holding screen
 * treats it as an error state and never releases (SA R-4).
 *
 * Pure orchestration over injected readers, so every branch is testable. The
 * account id is the SESSION's, resolved by the caller; never a request value.
 */

import type { BusinessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { BusinessOsAccountHoldFacts, BusinessOsInviteGrantKind } from '@/lib/repositories/types';

/** Where a held account is sent, and where a friend lands after signup (FR-35, SA Q-4). */
export const AWAITING_PAYMENT_PATH = '/invite/awaiting-payment';

export interface PaymentHoldReaders {
  lineage: Pick<BusinessOsAccountLineageRepository, 'findHoldFactsForAccount'>;
  invites: Pick<BusinessOsInviteRepository, 'findHoldFactsById'>;
}

export type PaymentHold =
  | { ok: true; held: false }
  | { ok: true; held: true; inviteId: string | null }
  | { ok: false };

/**
 * The predicate, on facts already read. `inviteGrantKind` is needed only for an
 * `admin_invite` row; `undefined` there means "not read" and is never "held".
 */
export function isAwaitingPayment(
  lineage: Pick<BusinessOsAccountHoldFacts, 'source' | 'first_paid_at'> | null,
  inviteGrantKind?: BusinessOsInviteGrantKind | null
): boolean {
  if (!lineage || lineage.first_paid_at !== null) return false;
  if (lineage.source === 'account_invite') return true;
  return lineage.source === 'admin_invite' && inviteGrantKind === 'tier';
}

/** Is this account held? Reads at most two rows by primary key (D-7, R-3). */
export async function readPaymentHold(accountId: string, readers: PaymentHoldReaders): Promise<PaymentHold> {
  const lineage = await readers.lineage.findHoldFactsForAccount(accountId);
  if (lineage.error) return { ok: false };
  const facts = lineage.data;

  // No lineage (every pre-invite and organic account), or already paid.
  if (!facts || facts.first_paid_at !== null) return { ok: true, held: false };

  // R-3: an unpaid friend is held on the lineage alone.
  if (facts.source === 'account_invite') return { ok: true, held: true, inviteId: facts.invite_id };
  if (facts.source !== 'admin_invite' || !facts.invite_id) return { ok: true, held: false };

  // 5c's case: an admin invite holds only when it was a Paid (tier) invite.
  const invite = await readers.invites.findHoldFactsById(facts.invite_id);
  if (invite.error) return { ok: false };
  return isAwaitingPayment(facts, invite.data?.grant_kind ?? null)
    ? { ok: true, held: true, inviteId: facts.invite_id }
    : { ok: true, held: false };
}
