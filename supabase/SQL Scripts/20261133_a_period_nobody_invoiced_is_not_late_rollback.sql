/*
 * Rollback for 20261133_a_period_nobody_invoiced_is_not_late.sql
 *
 * Recreates `update_overdue_installments()` exactly as `20260723_enhance_payments.sql`
 * defined it.
 *
 * ── READ THIS BEFORE RUNNING IT ─────────────────────────────────────────────
 *
 * This restores a DEFECT, deliberately, because a rollback's job is to return
 * the schema to the state the previous deploy expected and not to improve on
 * it. The function it brings back:
 *
 *   · has no `user_id` predicate, and is SECURITY DEFINER, so one call flips
 *     every tenant's past-due periods
 *   · has no `invoice_id` test, so it strands periods in a state that can
 *     neither be billed nor chased, while still raising a weekly card for the
 *     owner
 *
 * Nothing calls it, which is why dropping it was safe and why restoring it is
 * inert unless somebody calls it. Run this only to undo the migration, never
 * as a way to mark periods overdue.
 *
 * ── WHAT IS NOT RESTORED ────────────────────────────────────────────────────
 *
 * The GRANTs. `20261004` revoked EXECUTE from PUBLIC, `anon` and
 * `authenticated`, and a freshly created function gets PostgreSQL's default
 * `EXECUTE TO PUBLIC` -- so this file revokes them again rather than leaving
 * the hole that migration closed. Re-opening the lockdown is not part of
 * undoing this change.
 *
 * ── NO DATA TO RESTORE ──────────────────────────────────────────────────────
 *
 * The migration dropped a function and touched no rows, so there is nothing to
 * put back. Periods that `billDueDatedStages` has since billed keep their
 * invoices; that is the recovery working, not something this undoes.
 */

BEGIN;

CREATE OR REPLACE FUNCTION public.update_overdue_installments()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE payment_plan_installments
  SET
    status = 'overdue',
    updated_at = NOW()
  WHERE
    status = 'pending'
    AND due_date < CURRENT_DATE;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

/*
 * The `search_path` pin is R-c of the SECURITY DEFINER surface guard, and it
 * is not paperwork. A SECURITY DEFINER function runs as its owner, so an
 * unpinned one resolves `payment_plan_installments` through whatever path the
 * CALLER happens to have set — which is how a definer function is made to
 * write somebody else's table.
 *
 * This file restores a function that is being dropped precisely because it
 * was dangerous; restoring it unpinned would hand back the defect with a
 * second one attached. Pinned here even though the rollback is expected never
 * to run.
 */

/*
 * The lockdown from 20261004, reapplied. A new function carries the default
 * EXECUTE TO PUBLIC, so without this line the rollback would restore the
 * defect AND re-open the route to it with the public anon key.
 *
 * ONE statement naming all three roles, not three naming one each. That is
 * R-a of the SECURITY DEFINER surface guard, and the reason is the better
 * form anyway: a single REVOKE either applies or does not. Three can be
 * half-applied — an error on the second leaves `authenticated` holding
 * EXECUTE on a definer function with no `user_id` predicate, which is the
 * exact exposure 20261004 was written to close.
 */
REVOKE EXECUTE ON FUNCTION public.update_overdue_installments()
  FROM PUBLIC, anon, authenticated;

COMMIT;
