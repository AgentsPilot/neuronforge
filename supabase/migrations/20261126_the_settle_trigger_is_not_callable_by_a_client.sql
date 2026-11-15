/*
 * Revoke a SECURITY DEFINER function that was never locked down.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS OPEN, AND FOR HOW LONG
 *
 * `20261123` created three SECURITY DEFINER functions and revoked two of them.
 * `settle_refund_request_on_refund()` — the trigger that marks a client's
 * refund request settled when money actually goes back — kept the default
 * EXECUTE grant to PUBLIC.
 *
 * SECURITY DEFINER means it runs with the DEFINER's rights, not the caller's.
 * So any signed-in client could call it directly, outside the trigger, and it
 * writes `refund_requests.status`. The practical reach is small — it reads
 * `NEW` and a direct call passes none — but "small" is not the standard, and
 * the two functions beside it were held to the right one.
 *
 * Found by `security-definer-surface.guard` (rule R-a) on PR #661, not by
 * anybody reading the migration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND MIGRATION RATHER THAN A FIX IN PLACE
 *
 * `20261123` has already been applied. Editing an applied file changes the
 * repository and not the database, so the grant would stay exactly as it is in
 * production while the file claimed otherwise — the worst of both. The lines
 * are added THERE for the guard, which reads the file that creates the
 * function, and applied HERE for the database.
 *
 * Nothing changes behaviour: a trigger executes as the table owner and never
 * consults the caller's EXECUTE grant.
 */

BEGIN;

REVOKE EXECUTE ON FUNCTION public.settle_refund_request_on_refund() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_refund_request_on_refund() TO service_role;

COMMIT;
