/**
 * Keep a service's `payment_plans` row in step with the service itself.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE WERE TWO ANSWERS TO "IS THIS SERVICE PAID IN INSTALMENTS", AND THE
 * SERVICES SETTINGS WROTE NEITHER OF THEM TO THE ONE THE CLIENT SEES.
 *
 *   `scheduling_services.payment_type` + `installment_count`
 *       what the SERVER trusts — `isInstallmentPlan()`, read by
 *       `website/payment-intent`, `website/checkout` and `booking/finalize`
 *
 *   a row in `payment_plans`
 *       what the CLIENT is shown — `loadServicePaymentPlans()`, read by the
 *       public booking dialog, the contact drawer and `PaymentReminderService`
 *
 * The Services settings save wrote only the first. So a service configured as
 * instalments there had a server that knew it was a plan and a dialog that did
 * not, and every symptom followed from the disagreement: the dialog quoted the
 * full price, the payment step charged the full price, `finalize` recorded no
 * transaction because it correctly deferred to the webhook, and the refund
 * dialog then had nothing to refund. Tested live on 2026-09-29: a 200 ILS
 * service configured as 2 × 100 quoted 200 and banked nothing.
 *
 * This is the write that closes it. Called wherever a service is saved, so the
 * two answers cannot drift again.
 *
 * WHY A ROW AND NOT A DERIVED OBJECT. `loadServicePaymentPlans` could invent a
 * plan on read when no row exists, and that would fix the dialog's price and
 * nothing else: `bindPlanSubscription` needs a real row **id** to link a Stripe
 * subscription to, and `PaymentReminderService` keys a reminder to an instalment
 * row. A derived object has no id, so the drawer and the reminders would stay
 * blind. One written row fixes all four surfaces.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/syncServicePaymentPlan
 */

import { createLogger } from '@/lib/logger';
import { paymentPlanRepository, type InstallmentFrequency } from '@/lib/repositories/PaymentPlanRepository';
import { isInstallmentPlan } from './PaymentPlanService';
import { planPhases } from './planSchedule';
import { fromMinorUnits } from './refundMath';

const logger = createLogger({ module: 'SyncServicePaymentPlan' });

/** The service fields this reads. Any row shape carrying them will do. */
export interface ServicePlanFacts {
  id: string;
  service_name?: string | null;
  price?: number | null;
  currency?: string | null;
  payment_type?: string | null;
  installment_count?: number | null;
  installment_frequency?: string | null;
}

export type SyncOutcome =
  | { action: 'created'; planId: string }
  | { action: 'updated'; planId: string }
  | { action: 'deactivated'; planIds: string[] }
  | { action: 'none' };

export interface SyncResult {
  outcome: SyncOutcome;
  /**
   * Active rows beyond the one that was written, left exactly as they were.
   *
   * Found in live data: one service carried two active plans that disagreed
   * (2000 ILS as 3×600 and 8500 ILS as 2×4250). Which is correct is the owner's
   * decision, not this function's, so duplicates are reported and never
   * resolved. See `targetRow` for why the one written is the OLDEST.
   */
  duplicatePlanIds: string[];
}

/**
 * The row the client is actually shown.
 *
 * `loadServicePaymentPlans` orders `created_at` ASCENDING and keeps the first,
 * so the oldest active row is the one the public dialog quotes.
 * `PaymentPlanRepository.findByServiceId` orders DESCENDING — so taking its
 * first result would update the newest and leave the dialog quoting the stale
 * one, which is the bug this module exists to fix, arriving by a subtler route.
 */
function targetRow<T extends { id: string; created_at?: string | null }>(rows: readonly T[]): T | null {
  if (rows.length === 0) return null;

  return [...rows].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))[0];
}

/**
 * Reconcile the service's plan row against its own configuration.
 *
 * Returns rather than throws on a repository failure: the caller decides how
 * loud to be. The service save treats it as fatal, because a service saved
 * without its plan row is the exact state this prevents.
 */
export async function syncServicePaymentPlan(
  service: ServicePlanFacts,
  userId: string
): Promise<{ result: SyncResult | null; error: Error | null }> {
  const existing = await paymentPlanRepository.findByServiceId(service.id, userId);

  if (existing.error) {
    return { result: null, error: existing.error };
  }

  const active = existing.data ?? [];
  const target = targetRow(active);
  const duplicatePlanIds = active.filter(row => row.id !== target?.id).map(row => row.id);

  if (duplicatePlanIds.length > 0) {
    logger.warn(
      { serviceId: service.id, userId, writing: target?.id, duplicatePlanIds },
      'Service has more than one active payment plan — writing the one the public pages quote and leaving the rest alone'
    );
  }

  // Not a plan. A count of one is a single payment wearing a plan's clothes,
  // which `isInstallmentPlan` already refuses.
  if (!isInstallmentPlan(service)) {
    if (active.length === 0) return { result: { outcome: { action: 'none' }, duplicatePlanIds }, error: null };

    /*
     * Deactivated, NEVER deleted.
     *
     * An existing plan may already have instalments projected against it and a
     * Stripe subscription bound to it. `payment_plan_installments.payment_plan_id`
     * is a real FK, and a client's card is still being charged on that
     * subscription — deleting the row it points at would orphan money that has
     * already been collected.
     */
    for (const row of active) {
      const update = await paymentPlanRepository.update(row.id, userId, { is_active: false });
      if (update.error) return { result: null, error: update.error };
    }

    logger.info(
      { serviceId: service.id, userId, planIds: active.map(r => r.id) },
      'Service is no longer sold in instalments — its plan rows deactivated'
    );

    return {
      result: { outcome: { action: 'deactivated', planIds: active.map(r => r.id) }, duplicatePlanIds: [] },
      error: null,
    };
  }

  const total = Number(service.price);
  const count = service.installment_count ?? 1;
  const currency = (service.currency || 'USD').toUpperCase();
  const frequency = (service.installment_frequency || 'monthly') as InstallmentFrequency;

  /*
   * ONE PERIOD's amount, from the same splitter Stripe's prices are built from.
   *
   * `planPhases` puts the remainder on the FINAL period, so the first period is
   * the base amount and the plan still sums to exactly the agreed total. Taking
   * `total / count` here instead would quote a client 333.33 for a 1000 plan and
   * let Stripe charge 333.34 on the last period, and the two figures would
   * disagree with nothing to say which was right.
   */
  const installmentAmount = fromMinorUnits(planPhases(total, currency, count)[0].amountMinor, currency);

  const shape = {
    total_amount: total,
    currency,
    installment_count: count,
    installment_amount: installmentAmount,
    installment_frequency: frequency,
    is_active: true,
  };

  if (target) {
    const update = await paymentPlanRepository.update(target.id, userId, {
      // The name follows the service, so a renamed service does not leave the
      // client reading the old one on the payment step.
      name: service.service_name || 'Payment plan',
      ...shape,
    });

    if (update.error) return { result: null, error: update.error };

    logger.info(
      { serviceId: service.id, userId, planId: target.id, installmentAmount, count },
      'Service payment plan updated'
    );

    return { result: { outcome: { action: 'updated', planId: target.id }, duplicatePlanIds }, error: null };
  }

  const created = await paymentPlanRepository.create({
    user_id: userId,
    service_id: service.id,
    name: service.service_name || 'Payment plan',
    ...shape,
  });

  if (created.error) return { result: null, error: created.error };
  if (!created.data) return { result: null, error: new Error('Payment plan insert returned no row') };

  logger.info(
    { serviceId: service.id, userId, planId: created.data.id, installmentAmount, count },
    'Service payment plan created'
  );

  return { result: { outcome: { action: 'created', planId: created.data.id }, duplicatePlanIds }, error: null };
}
