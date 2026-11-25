/*
 * Dropping `update_overdue_installments()`, which stranded money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DID
 *
 * Defined in `20260723_enhance_payments.sql`:
 *
 *     UPDATE payment_plan_installments
 *     SET status = 'overdue', updated_at = NOW()
 *     WHERE status = 'pending' AND due_date < CURRENT_DATE;
 *
 * SECURITY DEFINER, no `user_id` predicate, and -- the part that cost money --
 * no test for whether the period had ever been INVOICED.
 *
 * The application's own rule is the opposite, and `PaymentReminderService`
 * states it in a comment beside its own flip: *a period nobody has invoiced is
 * not late, it is unasked*. That flip carries
 * `.not('invoice_id','is',null)` for exactly this reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE STATE IT CREATED IS WORSE THAN A WRONG LABEL
 *
 * A period stamped `overdue` with no invoice is stranded in BOTH directions:
 *
 *   · it cannot be billed. `billDueDatedStages` selected `status = 'pending'`,
 *     so no invoice would ever be raised for it.
 *   · it cannot be chased. The invoice pass needs an invoice; the instalment
 *     pass reads `pending`. Neither can see it.
 *
 * And it is not silent: `CashRevenueAtRiskDetector` counts `overdue` as
 * outstanding, so it raises a card for the owner every cycle. The owner is told
 * weekly about money the platform has made uncollectable, with no action that
 * resolves it.
 *
 * Measured on production 2026-11-24: three such periods, 1,300 ILS, due since
 * 12 and 22 October, each chased exactly once (the day after it fell due, while
 * still `pending`) and never again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY DROP RATHER THAN FIX
 *
 * Nothing calls it. There are zero `.rpc('update_overdue_installments')` hits
 * in the repo, no cron is wired to it, and `PaymentReminderService` does its
 * own user-scoped, invoice-tested UPDATE instead. `20261004` already revoked
 * EXECUTE from PUBLIC, `anon` and `authenticated` after finding it callable
 * with the public anon key -- one unauthenticated call would have flipped every
 * tenant's periods.
 *
 * So it is unreferenced code whose only behaviour is a defect. Adding the
 * missing conditions would leave a second, unused implementation of a rule the
 * service already applies correctly, and the next person would have to work out
 * which one wins. Dropping it removes the only path that can create the
 * stranded state.
 *
 * Recovery for rows already in it does NOT depend on this file:
 * `billDueDatedStages` now reads `overdue` as well, bounded by
 * `invoice_id IS NULL`, so a stranded period gets an invoice raised and the
 * invoice chaser takes it from there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TIMING: EITHER SIDE OF THE DEPLOY
 *
 * Case 1 of the timing test, and in fact both directions are safe. No deployed
 * code calls this function, so removing it changes nothing that runs. Apply
 * before or after the merge.
 */

BEGIN;

/*
 * No argument list to guess at: the function takes none. `IF EXISTS` so a
 * database where it was already removed by hand is not an error, and no
 * CASCADE -- if anything unexpectedly depends on it, this must fail loudly
 * rather than drop that too.
 */
DROP FUNCTION IF EXISTS public.update_overdue_installments();

COMMIT;
