/**
 * What cancellations cost this period, against what came in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A NUMBER ON ITS OWN DOES NOT LAND
 *
 * "₪14,866 was written off" is a fact an owner reads and files away. "You took
 * ₪30,000 and lost ₪10,000 — a third of what you earned" is the same fact and a
 * different conversation, and it is the one that makes somebody look at why.
 *
 * So this returns the ratio as well as the figures, and the ratio is lost
 * against COLLECTED — what fell through measured against what actually came in.
 * Not against what was billed, which would flatter a bad period by growing the
 * denominator with the very invoices that were cancelled.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH HALVES ARE THE RULES THE ORDERS PAGE ALREADY USES
 *
 * `cancelledMoneyOf` and `cancelledPlanMoneyOf` decide what a cancellation
 * cost; `collectedNotDoubleCounted` decides what came in. Neither is restated
 * here. The weekly note has to say the same thing the reports page shows, and
 * the way two surfaces come to disagree about what a business earned is by each
 * keeping its own copy of the arithmetic.
 *
 * ONE CURRENCY, NAMED. CLAUDE.md § Currency: nothing is converted and nothing
 * is summed across currencies. A business billing in two gets the larger one's
 * figures and the code beside them, so the sentence can say which money it
 * means rather than adding shekels to dollars.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { cancelledMoneyOf, cancelledPlanMoneyOf } from '@/lib/payments/moneyItems';
import { collectedNotDoubleCounted } from '@/lib/payments/revenueMath';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'cancellationCost' });

export interface CancellationCost {
  /** Net of refunds, in `currency`. */
  collected: number;
  /** Written off: cancelled invoices plus agreed phases nobody was ever billed for. */
  lost: number;
  /**
   * Lost as a percentage of collected, or null when nothing was collected.
   *
   * Null rather than zero or infinity: losing ₪5,000 in a period that took
   * nothing is not "0% lost", and it is not a number at all — it is a sentence
   * about a business with no income, which the narrative should reach for
   * instead of a ratio.
   */
  shareOfCollected: number | null;
  /** What both figures are denominated in. Null when there was no money at all. */
  currency: string | null;
  /** True when the business billed in more than one, so the figures are partial. */
  mixedCurrency: boolean;
}

const NOTHING: CancellationCost = {
  collected: 0,
  lost: 0,
  shareOfCollected: null,
  currency: null,
  mixedCurrency: false,
};

const round = (n: number) => Math.round(n * 100) / 100;

/** Which currency the period mostly ran in, by gross value. */
function dominant(rows: { currency?: string | null; amount?: number | string | null }[]): {
  currency: string | null;
  mixed: boolean;
} {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const key = (row.currency || '').toUpperCase();
    if (!key) continue;
    totals.set(key, (totals.get(key) ?? 0) + (Number(row.amount) || 0));
  }
  if (totals.size === 0) return { currency: null, mixed: false };

  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  return { currency: ranked[0][0], mixed: totals.size > 1 };
}

/**
 * The period's takings and write-offs.
 *
 * Fails SOFT to zeroes: this feeds a weekly note, and a note that cannot be
 * written is worse than one that omits a paragraph.
 *
 * @param userId CLAUDE.md rule 4, on all three reads.
 */
export async function cancellationCost(
  client: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<CancellationCost> {
  const [paidInvoices, transactions, cancelledInvoices, cancelledPhases] = await Promise.all([
    client
      .from('payment_invoices')
      .select('id, amount, refunded_amount, currency')
      .eq('user_id', userId)
      .in('status', ['paid', 'refunded', 'partially_refunded'])
      .gte('paid_at', from)
      .lt('paid_at', to),
    client
      .from('payment_transactions')
      .select('invoice_id, amount, refunded_amount, currency')
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .gte('created_at', from)
      .lt('created_at', to),
    client
      .from('payment_invoices')
      .select('id, status, amount, refunded_amount, currency, sent_at, booking_id')
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', from)
      .lt('updated_at', to),
    client
      .from('payment_plan_installments')
      .select('status, amount, invoice_id, currency')
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .gte('updated_at', from)
      .lt('updated_at', to),
  ]);

  const failed = [paidInvoices, transactions, cancelledInvoices, cancelledPhases].find(r => r.error);
  if (failed) {
    logger.error({ err: failed.error, userId, from, to }, 'Could not price the period’s cancellations');
    return NOTHING;
  }

  const invoiceRows = (paidInvoices.data ?? []) as {
    id: string;
    amount: number | string;
    refunded_amount: number | null;
    currency: string | null;
  }[];
  const txRows = (transactions.data ?? []) as {
    invoice_id: string | null;
    amount: number | string;
    refunded_amount: number | null;
    currency: string | null;
  }[];

  const cancelledRows = (cancelledInvoices.data ?? []) as {
    status: string;
    amount: number | string;
    refunded_amount: number | null;
    currency: string | null;
    sent_at: string | null;
    booking_id: string | null;
  }[];
  const phaseRows = (cancelledPhases.data ?? []) as {
    status: string;
    amount: number | string;
    invoice_id: string | null;
    currency: string | null;
  }[];

  /*
   * The currency comes from ALL the period's money, not just what came in.
   *
   * Taking it from the collections alone meant a period that collected nothing
   * had no currency, and the filter below then dropped the write-offs too — so
   * the worst month a business could have reported nothing lost. That is the
   * exact case this figure exists for.
   */
  const { currency, mixed } = dominant([
    ...txRows,
    ...invoiceRows,
    ...cancelledRows,
    ...phaseRows,
  ]);

  /* One currency only. Mixing them is the one thing never allowed here, so the
     dominant one's rows are the figures and the rest are left out rather than
     converted at a rate this platform does not have. */
  const inCurrency = <T extends { currency?: string | null }>(rows: T[]): T[] =>
    currency === null ? [] : rows.filter(r => (r.currency || '').toUpperCase() === currency);

  const collected = collectedNotDoubleCounted(inCurrency(invoiceRows), inCurrency(txRows));

  const lostFromInvoices = inCurrency(cancelledRows).reduce(
    (total, row) =>
      total +
      cancelledMoneyOf({
        status: row.status,
        amount: row.amount,
        refunded: row.refunded_amount,
        sentAt: row.sent_at ?? null,
        backedByBooking: Boolean(row.booking_id),
      }),
    0
  );

  const lostFromPhases = inCurrency(phaseRows).reduce(
    (total, row) =>
      total + cancelledPlanMoneyOf({ status: row.status, amount: row.amount, invoiceId: row.invoice_id }),
    0
  );

  const lost = round(lostFromInvoices + lostFromPhases);

  return {
    collected: round(collected),
    lost,
    shareOfCollected: collected > 0 ? round((lost / collected) * 100) : null,
    currency,
    mixedCurrency: mixed,
  };
}
