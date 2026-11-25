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
$$ LANGUAGE plpgsql SECURITY DEFINER;

/* The lockdown from 20261004, reapplied. A new function carries the default
   EXECUTE TO PUBLIC, so without these three lines this rollback would restore
   the defect AND re-open the route to it with the public anon key. */
REVOKE EXECUTE ON FUNCTION public.update_overdue_installments() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_overdue_installments() FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_overdue_installments() FROM authenticated;

COMMIT;
