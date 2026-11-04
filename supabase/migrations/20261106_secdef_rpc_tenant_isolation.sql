-- S11.1 / F4 — five RPCs let any signed-in user write to another tenant's rows.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS BROKEN
--
-- Five functions in `public` ran with the definer's rights, were executable by
-- `authenticated`, and acted on a caller-supplied `user_id` or row id without
-- checking who the caller was. Row-level security never applied, because the
-- definer's rights bypass it. One signed-in user could therefore:
--
--   * burn another account's execution quota   (increment_executions_used)
--   * write another account's baselines        (update_execution_baseline)
--   * write another account's anomalies        (record_execution_anomaly)
--   * write another account's error patterns   (upsert_error_pattern)
--   * write another account's fix counters     (record_auto_fix_result)
--
-- Writes only; no cross-tenant read path was found. A repository-level
-- `.eq('user_id', userId)` does not help here: these paths call the RPC
-- directly and never pass through the repository scope.
--
-- ---------------------------------------------------------------------------
-- THE FIX, AND WHY IT IS SHAPED THIS WAY
--
-- Four of the five need no guard at all, because the tables they write
-- ALREADY carry correct policies (`user_id = auth.uid()`), and `authenticated`
-- ALREADY holds the table grants those policies need. For those four the
-- definer's rights were not granting required access — they were DEFEATING
-- working row-level security. Handing them back to the caller's own rights is
-- the whole fix, and no function body changes.
--
-- The fifth cannot follow: `authenticated` holds only SELECT on
-- `user_subscriptions` (locked down by the S-6 work), so the caller's own
-- rights cannot write the quota at all. It keeps the definer's rights and
-- takes an explicit caller check instead.
--
-- Verified against the live database before writing this, not assumed:
--   * `authenticated` holds DELETE/INSERT/SELECT/UPDATE on execution_baselines,
--     execution_anomalies and error_patterns — so the caller's own rights are
--     sufficient and no path starts failing with "permission denied".
--   * `authenticated` holds SELECT only on user_subscriptions.
--   * `service_role` has BYPASSRLS, so every server-side caller is unaffected
--     by this change.
--   * each of the three tables has RLS on with a `user_id = auth.uid()` policy
--     covering the command used (an ALL policy with no WITH CHECK reuses its
--     USING expression for the check, so forged inserts are refused).
--   * data is clean: 0 baselines whose user_id disagrees with the agent owner,
--     0 orphans, 0 NULL user_ids. Nothing legitimate starts failing.
--
-- ---------------------------------------------------------------------------
-- THREE TRAPS, EACH OF WHICH MAKES THE OBVIOUS FIX WRONG
--
-- T-1  DO NOT revoke EXECUTE from `authenticated` on any of the five. All five
--      are also reached through the USER-COOKIE client, not just the server
--      role: /api/run-agent, run-agent-sandbox, calibrate/resume,
--      v2/calibrate/batch and v6/execute-test all build
--      `new WorkflowPilot(supabase)` with the cookie client.
--      lib/pilot/StateManager.ts:143 documents this. Revoking breaks agent
--      execution for every user.
--
-- T-2  DO NOT write the guard as a bare `auth.uid() = p_user_id`. Server-side
--      callers (scheduledAgentRunner, the sentinel webhook, DryRunValidator)
--      run with `auth.uid()` NULL, so a bare equality refuses every scheduled
--      and webhook run. The guard must pass when there is no caller identity
--      and refuse only a mismatch.
--
-- T-3  `get_top_insights` and `is_platform_admin` are NOT part of this and are
--      deliberately untouched: both already consult `auth.uid()`, and
--      `is_platform_admin` MUST stay executable by `authenticated` or admin
--      gating breaks everywhere.
--
-- Not in this slice, on purpose:
--   * `search_path` is NOT set on the four below. Their bodies name tables
--     unqualified, so pinning an empty search_path would break them at
--     runtime; and for a function running with the caller's own rights a
--     mutable search_path is not a privilege escalation. SEC-2 owns that sweep.
--   * `update_execution_baseline` still selects FOR UPDATE by agent_id alone.
--     RLS now scopes that select, so the hole is closed; adding the predicate
--     to the body is defence-in-depth left for SEC-2.
--
-- Re-runnable: every statement below is idempotent.
--
-- @see docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md (S11.1)
-- @see https://app.clickup.com/t/868mnrnbb

-- ---------------------------------------------------------------------------
-- PART A — four functions hand execution back to the caller's own rights.
--          RLS then applies, and the existing `user_id = auth.uid()` policies
--          do the isolation. No function body changes.
-- ---------------------------------------------------------------------------

ALTER FUNCTION public.update_execution_baseline(
  uuid, uuid, numeric, numeric, integer, integer, boolean
) SECURITY INVOKER;

ALTER FUNCTION public.record_execution_anomaly(
  uuid, uuid, uuid, text, text, numeric, numeric, numeric, numeric, text, text, integer
) SECURITY INVOKER;

ALTER FUNCTION public.upsert_error_pattern(
  uuid, uuid, text, text, text, text, text, jsonb
) SECURITY INVOKER;

ALTER FUNCTION public.record_auto_fix_result(
  uuid, boolean
) SECURITY INVOKER;

-- ---------------------------------------------------------------------------
-- PART B — increment_executions_used keeps the definer's rights, because
--          `authenticated` cannot write user_subscriptions at all, and takes
--          an explicit caller check instead.
--
--          The guard reads: if there is a caller identity and it is not the
--          account being charged, refuse. A NULL identity is a server-side
--          caller and passes (T-2).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.increment_executions_used(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'increment_executions_used refused: a caller may only charge its own account'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_subscriptions
  SET executions_used = executions_used + 1
  WHERE user_id = p_user_id;
END;
$function$;

-- The SECDEF surface guard (supabase/__tests__/security-definer-surface.guard.test.ts)
-- requires one revoke naming all three of PUBLIC, anon and authenticated after
-- the last CREATE, then re-granting only the roles that must keep it.
-- `authenticated` is re-granted deliberately: see T-1.
REVOKE ALL ON FUNCTION public.increment_executions_used(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.increment_executions_used(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.increment_executions_used(uuid) IS
  'Charges one execution against p_user_id. Keeps the definer rights because authenticated holds SELECT only on user_subscriptions; a caller with an identity may only charge itself, a NULL identity is a server-side caller. S11.1.';
