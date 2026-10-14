/**
 * The payment hold, for MANY accounts at once (plan payments P-5b.2; SA-P18,
 * T-9, P5-C10, SA C-8; workplan BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md §3.5).
 *
 * The shadow report and the launch dry run walk every plan row. A held friend's
 * plan row has no basis (T-13 layer 1), so without this the report lists them
 * as `no_assignment` anomalies and the dry run counts them as would-be free
 * champions. This classifies a set of accounts with the gate's OWN predicate,
 * `isAwaitingPayment` from `paymentHold.ts`, so the views and the gate can never
 * disagree about who is held.
 *
 * ── Batched, never one read per account (P5-C10) ────────────────────────────
 * Lineage is read in batches of `HOLD_BATCH_SIZE` accounts; the invites' grant
 * kinds are read in batches too, and ONLY for unpaid `admin_invite` rows (5c's
 * case). An unpaid `account_invite` row is held on the lineage alone, exactly
 * as `readPaymentHold` short-circuits it (SA R-3). `readPaymentHold` is never
 * called here.
 *
 * ── A failed read is said, never read as "nobody is held" ───────────────────
 * Any failed batch answers `{ ok: false }`. The caller decides what that means:
 * the report keeps the anomalies where they were, the dry run keeps the
 * accounts in its count (an upper bound, never an understatement).
 *
 * ── No cycle (SA C-8) ───────────────────────────────────────────────────────
 * `lib/business-os/entitlements/report.ts` imports this file, so it imports
 * nothing from the entitlements module (a source guard pins that), and only
 * repository TYPES: the readers are injected by the routes.
 */

import type { BusinessOsAccountLineageRepository } from '@/lib/repositories/BusinessOsAccountLineageRepository';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { BusinessOsAccountHoldFactsRow, BusinessOsInviteGrantKind } from '@/lib/repositories/types';

import { isAwaitingPayment } from './paymentHold';

/** One batch: the lineage and invite reads each accept at most 200 ids (pinned by test). */
export const HOLD_BATCH_SIZE = 200;

/** The two batched reads the classification needs (admin only). */
export interface AwaitingPaymentReaders {
  lineage: Pick<BusinessOsAccountLineageRepository, 'findHoldFactsForAccountsForAdmin'>;
  invites: Pick<BusinessOsInviteRepository, 'findGrantKindsByIdsForAdmin'>;
}

export type AwaitingPaymentClassification = { ok: true; held: ReadonlySet<string> } | { ok: false };

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size) out.push(items.slice(start, start + size));
  return out;
}

/**
 * Which of these accounts are held on the payment screen? Same answers as
 * `readPaymentHold`, account by account (a parity test pins it), in at most
 * `ceil(n / 200)` lineage reads plus `ceil(m / 200)` invite reads, where `m` is
 * the number of unpaid admin-invite rows. Never throws: a reader that throws is
 * a failed read.
 */
export async function readAwaitingPaymentAccounts(
  accountIds: readonly string[],
  readers: AwaitingPaymentReaders
): Promise<AwaitingPaymentClassification> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return { ok: true, held: new Set<string>() };

  try {
    const lineageRows: BusinessOsAccountHoldFactsRow[] = [];
    for (const batch of batches(unique, HOLD_BATCH_SIZE)) {
      const read = await readers.lineage.findHoldFactsForAccountsForAdmin(batch);
      if (read.error || !read.data) return { ok: false };
      lineageRows.push(...read.data);
    }

    // SA R-3: only an unpaid admin-invite row needs its invite; a friend row is decided already.
    const inviteIds = [
      ...new Set(
        lineageRows
          .filter((row) => row.first_paid_at === null && row.source === 'admin_invite' && typeof row.invite_id === 'string')
          .map((row) => row.invite_id as string)
      ),
    ];
    const grantKinds = new Map<string, BusinessOsInviteGrantKind>();
    for (const batch of batches(inviteIds, HOLD_BATCH_SIZE)) {
      const read = await readers.invites.findGrantKindsByIdsForAdmin(batch);
      if (read.error || !read.data) return { ok: false };
      for (const invite of read.data) grantKinds.set(invite.id, invite.grant_kind);
    }

    const held = new Set<string>();
    for (const row of lineageRows) {
      // `null` for a friend row (not needed) and for an admin invite with no row (never held).
      const grantKind = row.invite_id ? grantKinds.get(row.invite_id) ?? null : null;
      if (isAwaitingPayment(row, grantKind)) held.add(row.account_id);
    }
    return { ok: true, held };
  } catch {
    return { ok: false };
  }
}
