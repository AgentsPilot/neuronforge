/**
 * What must be settled before an account can be deleted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PRODUCT DOES NOT DECIDE WHAT HAPPENS TO SOMEBODY'S MONEY.
 *
 * It declines to delete until they have — which is what Stripe, Shopify,
 * Kajabi, Teachable and Mindbody all do, and it removes every hard judgement
 * from the deletion flow.
 *
 * The alternative was asking the owner, plan by plan, what should keep
 * charging. That collapses on contact with reality: `PaymentPlanService`
 * creates a Stripe `subscriptionSchedule`, which bills the client's card
 * independently of this database. Delete our rows and the charges continue,
 * with nothing left in the product able to stop them. Deciding FOR the owner is
 * worse still — a plan may be paying off work already delivered, and cancelling
 * it takes money they earned.
 *
 * So: if money can still move, deletion is refused and the reason is named.
 * By the time it proceeds there is nothing left to cancel, which is why the
 * deletion itself never has to touch Stripe.
 *
 * READ ONLY. Nothing here writes, to this database or to Stripe.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { ISSUED_INVOICE_STATUSES } from '@/lib/repositories/PaymentRepository';
import { isPlanStopped } from '@/lib/payments/planStatus';

const logger = createLogger({ module: 'AccountDeletionBlockers' });

export type DeletionBlockerKind =
  | 'unpaid_invoices'
  | 'active_payment_plans'
  | 'scheduled_installments';

export interface DeletionBlocker {
  kind: DeletionBlockerKind;
  /** How many rows are outstanding. */
  count: number;
  /**
   * Outstanding value, per currency.
   *
   * Never summed across currencies — a business that invoices in both shekels
   * and dollars has two totals, and adding them produces a number that is true
   * of nothing.
   */
  totals: Array<{ currency: string; amount: number }>;
}

/** Money is still moving; deletion must not proceed. */
export function blocksDeletion(blockers: DeletionBlocker[]): boolean {
  return blockers.length > 0;
}

/** Group rows into per-currency totals, skipping anything without an amount. */
function totalByCurrency(
  rows: Array<{ amount?: number | null; currency?: string | null }>
): Array<{ currency: string; amount: number }> {
  const byCurrency = new Map<string, number>();

  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currency = (row.currency || 'unknown').toUpperCase();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
  }

  return [...byCurrency].map(([currency, amount]) => ({ currency, amount }));
}

/**
 * Everything standing between this account and deletion.
 *
 * An empty array means nothing is owed and nothing is scheduled.
 *
 * FAILS CLOSED, deliberately, and this is the opposite of how the rest of the
 * codebase treats a failed read. Elsewhere an unreadable check is allowed
 * through, because refusing to show a dashboard over a database hiccup is worse
 * than showing a stale one. Here the action is irreversible and involves other
 * people's money: not knowing whether a client is still being billed is a
 * reason to stop, not to continue.
 */
export async function findDeletionBlockers(userId: string): Promise<DeletionBlocker[]> {
  const blockers: DeletionBlocker[] = [];

  /*
   * ── Invoices a client still owes ───────────────────────────────────────
   *
   * PROCESSOR-AGNOSTIC, deliberately. An invoice is money owed whether it is
   * collected by card, by bank transfer, or by an envelope of cash — so this
   * filters on status and owner and nothing else. No `processor_type`, no
   * Stripe lookup, no assumption that money only moves through an integration.
   *
   * A business that invoices for everything and has never connected Stripe is
   * exactly the case that must still be blocked.
   */
  const { data: invoices, error: invoiceError } = await supabaseServer
    .from('payment_invoices')
    .select('id, amount, currency')
    .eq('user_id', userId)
    .in('status', [...ISSUED_INVOICE_STATUSES]);

  if (invoiceError) {
    logger.error({ err: invoiceError, userId }, 'Could not read invoices; refusing deletion');
    throw new Error('Could not check outstanding invoices');
  }

  if (invoices?.length) {
    blockers.push({
      kind: 'unpaid_invoices',
      count: invoices.length,
      totals: totalByCurrency(invoices),
    });
  }

  /*
   * ── Plans Stripe may still charge ──────────────────────────────────────
   *
   * Filtered in TypeScript rather than in the query on purpose: `isPlanStopped`
   * is the same predicate `cancelPlan` uses, and asking the database the same
   * question in its own dialect is how the two drift apart. The row count here
   * is per-business and small.
   */
  const { data: plans, error: planError } = await supabaseServer
    .from('payment_plan_subscriptions')
    .select('id, status, installment_amount, currency')
    .eq('user_id', userId);

  if (planError) {
    logger.error({ err: planError, userId }, 'Could not read payment plans; refusing deletion');
    throw new Error('Could not check payment plans');
  }

  const livePlans = (plans ?? []).filter(plan => !isPlanStopped(plan.status));

  if (livePlans.length) {
    blockers.push({
      kind: 'active_payment_plans',
      count: livePlans.length,
      // The instalment amount, not the remaining total: what the client is
      // charged each time is a figure the owner recognises.
      totals: totalByCurrency(
        livePlans.map(plan => ({ amount: plan.installment_amount, currency: plan.currency }))
      ),
    });
  }

  /*
   * ── Instalments not yet collected ──────────────────────────────────────
   *
   * Tested on `paid_at` rather than on a status vocabulary. The statuses this
   * table uses (`pending`, `billed`, …) are not exported anywhere, so matching
   * on them would mean writing a second copy of a list nobody maintains —
   * whereas "has no payment date" is a fact that cannot drift.
   *
   * Reported separately from the plans above because the two can disagree: a
   * manually-collected plan has instalments and no Stripe schedule, and a plan
   * closed early can still leave an unpaid instalment behind it.
   */
  const { data: installments, error: installmentError } = await supabaseServer
    .from('payment_plan_installments')
    .select('id, amount, currency, paid_at')
    .eq('user_id', userId)
    .is('paid_at', null);

  if (installmentError) {
    logger.error({ err: installmentError, userId }, 'Could not read instalments; refusing deletion');
    throw new Error('Could not check scheduled payments');
  }

  if (installments?.length) {
    blockers.push({
      kind: 'scheduled_installments',
      count: installments.length,
      totals: totalByCurrency(installments),
    });
  }

  logger.info(
    { userId, blockers: blockers.map(blocker => `${blocker.kind}:${blocker.count}`) },
    blockers.length ? 'Account deletion blocked by outstanding money' : 'No money outstanding'
  );

  return blockers;
}
