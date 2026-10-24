/**
 * A plan is the sum of the stages that can still be collected.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `payment_plans` carries `total_amount` and `installment_count`, and both are
 * read as "what this client owes, over how many payments". Neither is derived:
 * they are stored, and whoever changes the stages has to change them too.
 *
 * Adding a session to a running package already does, in both directions. The
 * two paths that CANCEL stages did not agree:
 *
 *   · calling off one session lowered `total_amount` and left the count alone;
 *   · stopping the whole booking closed every stage and lowered neither, so a
 *     stopped package still read "1,066.74 over 11 payments" with nothing left
 *     that anyone could collect.
 *
 * One definition, used by both, so the plan cannot disagree with its own stages
 * depending on which button stopped the work.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT TAKES THE CLIENT
 *
 * Its two callers hold different ones: the repository works through `this
 * .supabase`, and `BookingLifecycleService` through `supabaseServer` on paths
 * that run for clients as well as owners. Passing it in keeps this module free
 * of both and free of any import back into the repository layer.
 *
 * Every statement is scoped by `user_id` (CLAUDE.md rule 4).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'PlanFollowsItsStages' });

/** The shape both callers already select when they close stages. */
export interface CancelledStage {
  amount?: number | string | null;
  payment_plan_id?: string | null;
}

/**
 * The minimum of a Supabase client this needs.
 *
 * `from` returns `any` deliberately, and this is the CLAUDE.md rule 6 note for
 * it. Spelling the builder out structurally — select → eq → eq → maybeSingle,
 * update → eq → eq — made the compiler recurse through Supabase's schema
 * generics and fail with "type instantiation is excessively deep". The builder
 * is generic over the whole database type, and a structural shape asks it to
 * unify all of that at every link in the chain.
 *
 * Nothing is lost by it: the two call sites pass REAL clients, so the table and
 * column names below are checked against the schema there, and this file has
 * only two statements in it.
 */
interface PlanWriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

/**
 * Take a set of just-cancelled stages off their plans.
 *
 * Groups by plan first, so a package whose six stages are closed at once costs
 * one read and one write rather than six of each, and so the arithmetic is done
 * on one number instead of being applied six times to a value that moves
 * underneath.
 *
 * Never throws. A plan left overstating is wrong on a dashboard; a throw here
 * would fail the cancellation itself, which is the thing the owner actually
 * asked for.
 */
export async function lowerPlansForCancelledStages(
  db: PlanWriter,
  userId: string,
  stages: readonly CancelledStage[]
): Promise<void> {
  if (!stages.length) return;

  /** plan id -> what came off it, and how many payments went with it. */
  const byPlan = new Map<string, { amount: number; count: number }>();

  for (const stage of stages) {
    const planId = stage.payment_plan_id ? String(stage.payment_plan_id) : null;
    if (!planId) continue;

    const current = byPlan.get(planId) ?? { amount: 0, count: 0 };
    byPlan.set(planId, {
      amount: current.amount + (Number(stage.amount) || 0),
      count: current.count + 1,
    });
  }

  for (const [planId, off] of byPlan) {
    try {
      /*
       * ───────────────────────────────────────────────────────────────────────
       * ONLY A PLAN THAT BELONGS TO ONE BOOKING.
       *
       * `payment_plans` is not always one client's balance. A service sold on
       * instalments has ONE plan row that every booking of that service hangs
       * its stages off: on this account eight plans are shared that way, one of
       * them by ten bookings. For those rows `total_amount` and
       * `installment_count` describe the TERMS — 800 over 2 — not what any
       * particular client owes.
       *
       * Decrementing a shared row would take one client's cancellation off
       * everybody else's terms, and the next booking of that service would
       * quote a lower price than the owner set. Silently, and compounding with
       * every cancellation.
       *
       * The test is the stages themselves: a plan whose stages name more than
       * one booking is shared. A dedicated plan — the kind a quote's acceptance
       * creates — names exactly one, and is the only kind whose numbers are a
       * running balance worth keeping in step.
       * ───────────────────────────────────────────────────────────────────────
       */
      const { data: siblings } = await db
        .from('payment_plan_installments')
        .select('booking_id')
        .eq('payment_plan_id', planId)
        .eq('user_id', userId);

      const bookings = new Set(
        (siblings ?? [])
          .map((row: { booking_id?: string | null }) => row.booking_id)
          .filter((id: string | null | undefined): id is string => Boolean(id))
      );

      if (bookings.size > 1) {
        logger.info(
          { planId, userId, bookings: bookings.size },
          'Plan is shared by several bookings; its terms are left alone'
        );
        continue;
      }

      const { data: plan } = await db
        .from('payment_plans')
        .select('total_amount, installment_count')
        .eq('id', planId)
        .eq('user_id', userId)
        .maybeSingle();

      if (!plan) continue;

      /*
       * Clamped at zero, both of them. The stages are the source of truth and
       * these two numbers are a cache of them, so a cache that has drifted low
       * must not be driven negative by a correction: a plan reading -133.33
       * would be read as a credit by anything summing it.
       */
      const total = Math.max(0, Number(plan.total_amount ?? 0) - off.amount);
      const count = Math.max(0, Number(plan.installment_count ?? 0) - off.count);

      const { error } = await db
        .from('payment_plans')
        .update({ total_amount: total, installment_count: count })
        .eq('id', planId)
        .eq('user_id', userId);

      if (error) {
        logger.error(
          { err: error, planId, userId },
          'Stages were cancelled but their plan still totals them'
        );
      }
    } catch (err) {
      logger.error(
        { err, planId, userId },
        "Could not bring a plan into line with the stages that were just cancelled"
      );
    }
  }
}
