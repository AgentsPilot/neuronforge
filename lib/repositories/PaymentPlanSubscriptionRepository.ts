/**
 * A client's live payment plan, as this platform records it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe executes the schedule — it charges each period, retries a decline,
 * chases an expiring card, handles SCA. This table is the local record every
 * read goes through, because insights, detectors and the money list query
 * Postgres, and a detector that made a network call per plan would be slow,
 * rate-limited, and unavailable exactly when Stripe is.
 *
 * ORDER OF WRITES: the row is created BEFORE Stripe is called, in `pending`,
 * and the Stripe references are filled in afterwards. A crash mid-flight then
 * leaves evidence of an attempt rather than an invisible half-made plan — the
 * same rule the refund ledger follows, for the same reason.
 *
 * NO CARD DATA. Only Stripe references and the display metadata Stripe reports
 * back: brand, last four, expiry. Expiry earns its place beyond display — it
 * makes "this card expires before their final payment" something an insight can
 * find, rather than something discovered when the charge fails.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/repositories/PaymentPlanSubscriptionRepository
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'PaymentPlanSubscriptionRepository' });

export type PlanSubscriptionStatus =
  | 'pending'
  | 'active'
  | 'past_due'
  | 'paused'
  | 'completed'
  | 'cancelled';

export interface PlanSubscription {
  id: string;
  user_id: string;
  contact_id: string | null;
  booking_id: string | null;
  service_id: string | null;
  stripe_subscription_id: string | null;
  stripe_schedule_id: string | null;
  stripe_customer_id: string | null;
  stripe_connect_account_id: string | null;
  installment_count: number;
  installment_amount: number;
  currency: string;
  frequency: string;
  periods_paid: number;
  status: PlanSubscriptionStatus;
  next_charge_at: string | null;
  next_charge_amount: number | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp_month: number | null;
  card_exp_year: number | null;
}

export interface CreatePlanSubscriptionInput {
  userId: string;
  contactId?: string | null;
  bookingId?: string | null;
  serviceId?: string | null;
  installmentCount: number;
  installmentAmount: number;
  currency: string;
  frequency: string;
  stripeConnectAccountId: string | null;
}

export interface PlanSubscriptionResult<T> {
  data: T | null;
  error: Error | null;
}

export class PaymentPlanSubscriptionRepository {
  private supabase = supabaseServer;

  /**
   * Record the intent to charge, before Stripe is asked to.
   *
   * The unique index on `booking_id` for live statuses is what stops a second
   * plan being created for one appointment — refused by the database rather
   * than by whichever code path happens to check.
   */
  async create(input: CreatePlanSubscriptionInput): Promise<PlanSubscriptionResult<PlanSubscription>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .insert({
          user_id: input.userId,
          contact_id: input.contactId ?? null,
          booking_id: input.bookingId ?? null,
          service_id: input.serviceId ?? null,
          installment_count: input.installmentCount,
          installment_amount: input.installmentAmount,
          currency: input.currency,
          frequency: input.frequency,
          stripe_connect_account_id: input.stripeConnectAccountId,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, userId: input.userId, bookingId: input.bookingId }, 'Could not record the payment plan');
      return { data: null, error: error as Error };
    }
  }

  /** Fill in what Stripe answered, and mark the plan live. */
  async attachStripe(
    id: string,
    userId: string,
    stripe: {
      subscriptionId?: string | null;
      scheduleId?: string | null;
      customerId?: string | null;
    }
  ): Promise<PlanSubscriptionResult<PlanSubscription>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .update({
          stripe_subscription_id: stripe.subscriptionId ?? null,
          stripe_schedule_id: stripe.scheduleId ?? null,
          stripe_customer_id: stripe.customerId ?? null,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Could not attach Stripe references to the plan');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Find the plan a Stripe subscription belongs to.
   *
   * Not user-scoped: the caller is a webhook, which has no session and is
   * identified by a globally unique Stripe id. Every caller must still check
   * that the resolved `user_id` matches the account the event came from.
   */
  async findBySubscriptionId(subscriptionId: string): Promise<PlanSubscriptionResult<PlanSubscription>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .select('*')
        .eq('stripe_subscription_id', subscriptionId)
        .maybeSingle();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, subscriptionId }, 'Could not find the plan for this subscription');
      return { data: null, error: error as Error };
    }
  }

  /**
   * A period was collected.
   *
   * `periods_paid` is what "2 of 3 paid" reads from, and it is incremented from
   * the row rather than recomputed, so a redelivered webhook does not
   * double-count — the caller dedupes on the Stripe invoice id first, which the
   * unique index on `payment_plan_installments.stripe_invoice_id` enforces.
   */
  async recordPeriodPaid(
    id: string,
    periodsPaid: number,
    next: { chargeAt?: string | null; amount?: number | null } = {}
  ): Promise<PlanSubscriptionResult<PlanSubscription>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .update({
          periods_paid: periodsPaid,
          next_charge_at: next.chargeAt ?? null,
          next_charge_amount: next.amount ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Could not record a paid period');
      return { data: null, error: error as Error };
    }
  }

  /** Why the last period failed, so the business can be told something useful. */
  async recordFailure(
    id: string,
    failureCode: string | null
  ): Promise<PlanSubscriptionResult<PlanSubscription>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .update({
          status: 'past_due',
          last_failure_code: failureCode,
          last_failure_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id }, 'Could not record a plan failure');
      return { data: null, error: error as Error };
    }
  }

  /** The plan reached its end, or was stopped. */
  async close(
    id: string,
    status: 'completed' | 'cancelled'
  ): Promise<PlanSubscriptionResult<PlanSubscription>> {
    try {
      const { data, error } = await this.supabase
        .from('payment_plan_subscriptions')
        .update({
          status,
          [status === 'completed' ? 'completed_at' : 'cancelled_at']: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error({ err: error, id, status }, 'Could not close the plan');
      return { data: null, error: error as Error };
    }
  }
}

export const paymentPlanSubscriptionRepository = new PaymentPlanSubscriptionRepository();
