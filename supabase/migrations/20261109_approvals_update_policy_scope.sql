-- S11.4 slice 2 — scope the approvals UPDATE policy to the caller, and pin its
-- WITH CHECK so escalation keeps working.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS IS, STATED ACCURATELY
--
-- `approval_requests_update_policy` on public.workflow_approval_requests is
-- `USING (true)` to `authenticated`, and `authenticated` holds the UPDATE
-- grant. Read on its own, that says any signed-in user can rewrite any
-- approval request -- flip `status` to 'approved', or replace `approvers`
-- with themselves -- and so unblock or kill another tenant's paused
-- human-in-the-loop run.
--
-- THAT IS NOT EXPLOITABLE TODAY, AND THIS MIGRATION IS DEFENCE IN DEPTH.
-- Measured, not assumed, before writing this (prod-dev, 2026-11-06):
--
--   as authenticated, jwt sub = a non-approver uuid
--     UPDATE ... SET status = 'approved' WHERE id = '<id read out of band>'
--     -> 0 rows
--   byte-identical statement, jwt sub = the row's real approver
--     -> 1 row
--
-- Both legs ran under an explicit role and jwt claim, with a value-identical
-- SET, inside a transaction that was rolled back. The control is what makes
-- the refusal readable: an unpaired 0 cannot be told from a broken probe, and
-- a first attempt at this probe DID return a false 0 because the id came from
-- a sub-select that the attacker's own SELECT policy had already emptied.
--
-- The reason the refusal happens is the point of this migration. PostgreSQL
-- applies SELECT policies to the rows an UPDATE must locate, and
-- `approval_requests_select_policy` is row-scoped:
--
--   (auth.uid())::text = ANY (approvers) OR (auth.uid())::text = ANY (escalated_to)
--
-- So the UPDATE hole is masked by an ADJACENT policy, not closed by its own.
-- Anyone who later widens SELECT -- for instance to let a workflow owner read
-- approvals they are not an approver for, which is a reasonable product
-- request -- reopens a cross-tenant write with no warning and nothing in the
-- UPDATE policy to stop it. This migration removes that hidden coupling by
-- making the UPDATE policy carry the same scope itself.
--
-- ---------------------------------------------------------------------------
-- WHY `WITH CHECK (true)` IS LOAD-BEARING AND MUST NOT BE "TIGHTENED"
--
-- Per CREATE POLICY: for UPDATE, when WITH CHECK is omitted, the USING
-- expression is applied to the NEW row as well.
--
-- `ApprovalTracker.escalateApproval` sets `approvers = escalateTo` and does
-- not touch `escalated_to`. On the new row the caller is therefore in neither
-- array, so an implicit check would REFUSE the escalation -- and that method
-- only console.errors, it never throws, so `waitForApproval` would poll every
-- 5 s until the serverless function died. The silent breakage comes from
-- OMITTING WITH CHECK, not from adding it.
--
-- `WITH CHECK (true)` is safe because USING has already pinned the caller to a
-- row where they are a named approver or an escalation target. The worst a
-- permitted caller can do is delegate a decision they were already entitled to
-- make, or remove themselves. RLS cannot see OLD, so "approvers unchanged" is
-- not expressible here without a trigger, which is out of scope.
--
-- ---------------------------------------------------------------------------
-- THE EXPRESSION IS COPIED FROM THE SELECT POLICY ON PURPOSE
--
-- Byte-for-byte identical to `approval_requests_select_policy`. Do not
-- "improve" one without the other (no coalesce, no array_position): because
-- ApprovalTracker reads through the same injected client before every write,
-- divergence between the two is how this becomes a silent breakage later.
-- A NULL `escalated_to` yields NULL and is therefore denied -- exactly what
-- SELECT already does, so a row with NULL `approvers` stays writable only by
-- `service_role`, matching its current readability.
--
-- ---------------------------------------------------------------------------
-- NOT IN THIS SLICE, ON PURPOSE
--
--   * INSERT keeps `WITH CHECK (true)` to `authenticated`. With no owner
--     column there is no predicate that CAN be written: the creator is not
--     reliably an approver and the row carries no caller-linked column.
--     `WorkflowPilot` creates these rows through the user-cookie client, so
--     tightening it breaks agent execution (slice 1 trap T-1).
--     Residual risk, stated rather than implied: any signed-in user can insert
--     a forged row for any `execution_id` (there is no FK). It is bounded --
--     the pilot only ever reads back the id it just minted, and the attacker
--     cannot read the row they forged. `getApprovalRequestByStep` would have
--     made forged rows reachable; it has NO callers today.
--   * DELETE: the grant exists with no policy, so RLS denies it. Left to the
--     grant-revocation slice rather than adding a `false` policy here.
--   * Moving the escalation and timeout writes to a server client, which is
--     what would let this policy carry a meaningful WITH CHECK, is its own
--     slice. So is replacing ApprovalTracker's direct Supabase access with a
--     repository (CLAUDE.md rule 1).
--   * `workflow_approval_responses` was measured in the same pass and is
--     already correctly scoped: INSERT is `WITH CHECK ((auth.uid())::text =
--     approver_id)`, so a response cannot be attributed to another user, and
--     it has no UPDATE or DELETE policy at all. Deliberately untouched.
--
-- Re-runnable: both statements are idempotent.
--
-- @see scripts/check-approvals-update-policy-migration.sql
-- @see supabase/migrations/20261108_anon_write_exposure_slice1.sql
-- @see https://app.clickup.com/t/1gaepavwv04

DROP POLICY IF EXISTS "approval_requests_update_policy"
  ON public.workflow_approval_requests;

CREATE POLICY "approval_requests_update_policy"
  ON public.workflow_approval_requests
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid())::text = ANY (approvers)
    OR (auth.uid())::text = ANY (escalated_to)
  )
  WITH CHECK (true);
