-- Checker for 20261109_approvals_update_policy_scope.sql (S11.4 slice 2).
--
-- Read-only. Run it BEFORE the migration as well as after: before, C1, C2 and
-- C3 must FAIL. A checker that cannot fail has proved nothing, and the failing
-- baseline is the evidence that this one can.
--
-- C2 is the one that matters most over time. It pins `WITH CHECK` to exactly
-- `true`, because a future "tightening" that drops it makes PostgreSQL apply
-- the USING expression to the NEW row, which refuses every escalation --
-- silently, since ApprovalTracker.escalateApproval only console.errors.
--
-- C4 to C10 are the invariants the fix must NOT regress. C5 above all: the
-- INSERT policy must stay `WITH CHECK (true)` to `authenticated`, or
-- WorkflowPilot stops being able to create approval requests on the user path
-- (slice 1 trap T-1).
--
-- A catalogue PASS is not the whole proof. The live half is a role-impersonated
-- UPDATE with a value-identical SET, rolled back, hardcoding a row id read out
-- of band, paired with the same statement as the row's real approver:
--   non-approver -> 0 rows, real approver -> 1 row
-- An unpaired 0 cannot be told from a broken probe. A first attempt returned a
-- false 0 because the id came from a sub-select the attacker's own SELECT
-- policy had already emptied.
--
-- @see supabase/migrations/20261109_approvals_update_policy_scope.sql

SET default_transaction_read_only = on;

WITH live AS (
  SELECT c.relname AS tname,
         p.polname AS pname,
         p.polcmd,
         p.polroles,
         p.polpermissive,
         coalesce(pg_get_expr(p.polqual, p.polrelid), '')      AS using_expr,
         coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') AS check_expr
  FROM pg_policy p
  JOIN pg_class c ON c.oid = p.polrelid
  WHERE c.relnamespace = 'public'::regnamespace
    AND c.relname IN ('workflow_approval_requests', 'workflow_approval_responses')
),
upd AS (
  SELECT * FROM live
  WHERE live.tname = 'workflow_approval_requests' AND live.polcmd = 'w'
),
sel AS (
  SELECT * FROM live
  WHERE live.tname = 'workflow_approval_requests' AND live.polcmd = 'r'
),
checks AS (
  -- The change itself -------------------------------------------------------
  SELECT 1000 AS sort_order,
         'C1 the approvals UPDATE policy consults the caller identity' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM upd WHERE upd.using_expr ~* 'auth\.uid')
              THEN 'PASS' ELSE 'FAIL' END AS result,
         coalesce((SELECT upd.using_expr FROM upd LIMIT 1), 'no UPDATE policy') AS detail

  UNION ALL
  SELECT 1001,
         'C2 its WITH CHECK is exactly true, so escalation still works',
         CASE WHEN (SELECT upd.check_expr FROM upd LIMIT 1) = 'true'
              THEN 'PASS' ELSE 'FAIL' END,
         'check_expr = '
           || coalesce(nullif((SELECT upd.check_expr FROM upd LIMIT 1), ''), '<absent>')
           || '. Absent means USING is applied to the NEW row, refusing every escalation.'

  UNION ALL
  SELECT 1002,
         'C3 UPDATE and SELECT use the identical expression',
         CASE WHEN (SELECT upd.using_expr FROM upd LIMIT 1)
                 = (SELECT sel.using_expr FROM sel LIMIT 1)
              THEN 'PASS' ELSE 'FAIL' END,
         'they must not drift: ApprovalTracker reads through the same client before every write'

  -- Invariants that must not regress ---------------------------------------
  UNION ALL
  SELECT 1100,
         'C4 the UPDATE policy applies to authenticated, not to PUBLIC or anon',
         CASE WHEN EXISTS (
                SELECT 1 FROM upd
                WHERE 'authenticated'::regrole = ANY(upd.polroles)
                  AND upd.polroles <> '{0}'::oid[]
                  AND NOT ('anon'::regrole = ANY(upd.polroles)))
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT array_to_string(upd.polroles::regrole[], ',') FROM upd LIMIT 1), 'none')

  UNION ALL
  SELECT 1101,
         'C5 INSERT stays WITH CHECK true to authenticated (slice 1 trap T-1)',
         CASE WHEN EXISTS (
                SELECT 1 FROM live
                WHERE live.tname = 'workflow_approval_requests'
                  AND live.polcmd = 'a'
                  AND live.check_expr = 'true'
                  AND 'authenticated'::regrole = ANY(live.polroles))
              THEN 'PASS' ELSE 'FAIL' END,
         'WorkflowPilot creates these rows through the user-cookie client'

  UNION ALL
  SELECT 1102,
         'C6 the SELECT policy is still row-scoped',
         CASE WHEN EXISTS (SELECT 1 FROM sel WHERE sel.using_expr ~* 'auth\.uid')
              THEN 'PASS' ELSE 'FAIL' END,
         'if this is ever widened, C3 is what keeps UPDATE from widening with it'

  UNION ALL
  SELECT 1103,
         'C7 no DELETE policy exists, so RLS keeps denying DELETE',
         CASE WHEN NOT EXISTS (
                SELECT 1 FROM live
                WHERE live.tname = 'workflow_approval_requests' AND live.polcmd = 'd')
              THEN 'PASS' ELSE 'FAIL' END,
         'the DELETE grant is left to the grant-revocation slice'

  UNION ALL
  SELECT 1104,
         'C8 responses INSERT is still self-attributed',
         CASE WHEN EXISTS (
                SELECT 1 FROM live
                WHERE live.tname = 'workflow_approval_responses'
                  AND live.polcmd = 'a'
                  AND live.check_expr ~* 'auth\.uid.*::text = approver_id')
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT live.check_expr FROM live
                   WHERE live.tname = 'workflow_approval_responses'
                     AND live.polcmd = 'a' LIMIT 1), 'no INSERT policy')
           || ' -- a forgeable approver_id would let anyone plant a decision in another name'

  UNION ALL
  SELECT 1105,
         'C9 RLS still enabled on both approvals tables',
         CASE WHEN (SELECT count(*) FROM pg_class
                    WHERE pg_class.relnamespace = 'public'::regnamespace
                      AND pg_class.relname IN
                        ('workflow_approval_requests', 'workflow_approval_responses')
                      AND pg_class.relrowsecurity) = 2
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM pg_class
          WHERE pg_class.relnamespace = 'public'::regnamespace
            AND pg_class.relname IN
              ('workflow_approval_requests', 'workflow_approval_responses')
            AND pg_class.relrowsecurity) || ' of 2 with RLS on, 2 expected'

  UNION ALL
  SELECT 1106,
         'C10 service_role still bypasses RLS, so every server path is unaffected',
         CASE WHEN (SELECT pg_roles.rolbypassrls FROM pg_roles
                    WHERE pg_roles.rolname = 'service_role')
              THEN 'PASS' ELSE 'FAIL' END,
         'the scheduled and webhook pilot paths write these rows as service_role'
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result <> 'PASS')
              THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result <> 'PASS') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
