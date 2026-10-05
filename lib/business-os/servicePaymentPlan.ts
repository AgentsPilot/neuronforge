/**
 * A service's payment plan, as the public surfaces need to show it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `payment_plans` is a template hanging off a service — "3 monthly payments of
 * ₪200" as an offer. It was invisible to everything a client actually sees:
 * grepping the website blocks and the website APIs for `payment_plan` returned
 * nothing at all. So the payment step showed one number, the full price, to
 * someone the business had decided could pay in instalments, and neither the
 * split nor what was due today appeared anywhere before the card form.
 *
 * This is the shape that travels, alongside `is_scheduled` and `collection` —
 * the two facts a service already sends the public widgets. It carries only
 * what a client needs to read: how many payments, how much each, how often, and
 * what the total comes to.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'ServicePaymentPlan' });

export type InstallmentFrequency = 'weekly' | 'biweekly' | 'monthly' | 'quarterly';

/** What a client is told about paying over time. */
export interface ServicePaymentPlan {
  id: string;
  name: string;
  /** What the service costs in total under this plan. */
  totalAmount: number;
  currency: string;
  installmentCount: number;
  installmentAmount: number;
  frequency: InstallmentFrequency;
  /**
   * WHEN the first payment falls, which decides what the client is told.
   *
   * Without these the dialog had no way to know a plan starts later, so it said
   * "Due today" beside the first instalment on every plan — including one whose
   * subscription now runs a trial and charges nothing today. A price that is
   * wrong about its date is as wrong as one that is wrong about its amount.
   *
   * They come from `scheduling_services`, not from `payment_plans`: that table
   * has no such columns, and the service is the authority the server already
   * reads them from (`isInstallmentPlan`, `planStartDate`). Adding columns to
   * mirror them would be a third copy of a fact that already has two homes.
   */
  firstPaymentDue: 'on_booking' | 'days_after';
  firstPaymentDays: number;
}

/**
 * The active plans for a user's services, keyed by service id.
 *
 * One query for every service rather than one per service: the public routes
 * build their whole catalogue in a single pass, and a per-service lookup there
 * would be a query per row on every page load.
 *
 * Only active plans, and only the first where a service somehow has several —
 * a client cannot be shown two answers to "how do I pay for this".
 */
export async function loadServicePaymentPlans(
  userId: string
): Promise<Record<string, ServicePaymentPlan>> {
  try {
    /*
     * Two reads, because the answer lives in two tables.
     *
     * `payment_plans` holds the amounts the client is quoted;
     * `scheduling_services` holds WHEN the first one falls. Asked together
     * rather than per service, for the same reason the plans are: the public
     * routes build a whole catalogue in one pass.
     */
    const [{ data, error }, timing] = await Promise.all([
      supabaseServer
        .from('payment_plans')
        .select('id, service_id, name, total_amount, currency, installment_count, installment_amount, installment_frequency')
        .eq('user_id', userId)
        .eq('is_active', true)
        .not('service_id', 'is', null)
        .order('created_at', { ascending: true }),
      supabaseServer
        .from('scheduling_services')
        .select('id, first_payment_due, first_payment_days')
        .eq('user_id', userId),
    ]);

    if (error) throw error;
    if (timing.error) throw timing.error;

    const timingByService = new Map(
      (timing.data ?? []).map(row => [
        row.id as string,
        {
          firstPaymentDue: (row.first_payment_due === 'days_after' ? 'days_after' : 'on_booking') as
            | 'on_booking'
            | 'days_after',
          firstPaymentDays: Number(row.first_payment_days ?? 0),
        },
      ])
    );

    const byService: Record<string, ServicePaymentPlan> = {};
    for (const plan of data || []) {
      const serviceId = plan.service_id as string;
      // First wins — `created_at` ascending, so the oldest active plan is the
      // one the business has been selling.
      if (byService[serviceId]) continue;

      byService[serviceId] = {
        id: plan.id,
        name: plan.name,
        totalAmount: Number(plan.total_amount),
        currency: plan.currency,
        installmentCount: plan.installment_count,
        installmentAmount: Number(plan.installment_amount),
        frequency: plan.installment_frequency as InstallmentFrequency,
        // An unknown service defaults to charging on booking, which is what
        // every plan did before a deferred start existed.
        ...(timingByService.get(serviceId) ?? { firstPaymentDue: 'on_booking' as const, firstPaymentDays: 0 }),
      };
    }

    return byService;
  } catch (error) {
    // A missing plan means the page shows a single price, which is what it did
    // before this existed. It must never stop a page rendering.
    logger.warn({ err: error, userId }, 'Could not load service payment plans');
    return {};
  }
}
