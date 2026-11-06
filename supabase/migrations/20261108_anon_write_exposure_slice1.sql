-- S11.2 slice 1 — close the four RLS policies that hand PUBLIC/anon real data.
--
-- ---------------------------------------------------------------------------
-- WHAT IS BROKEN
--
-- One mistake, repeated: policies NAMED "Service role can …" but granted to
-- PUBLIC with a `true` expression. `polroles = '{0}'` is PUBLIC, which includes
-- `anon` — so these are readable and writable by anyone holding the publishable
-- key, a key designed NOT to be secret. They give `service_role` nothing it did
-- not already have, because `service_role` has BYPASSRLS. Pure exposure, zero
-- benefit.
--
-- Confirmed live on 2026-11-05 with the publishable key and no authentication,
-- each attempt paired with a control on the same path:
--
--   agent_memories             HTTP 200, real rows with user_id   <- leak
--   workflow_step_executions   HTTP 200, 24111 rows               <- leak
--   agents            (control) HTTP 200, []                      <- RLS working
--   crm_contacts      (control) HTTP 200, []                      <- RLS working
--
-- The controls are what make it conclusive: the same key on the same path is
-- refused wherever a policy consults `auth.uid()`, so the two leaks are not an
-- outage or a bad probe.
--
-- ---------------------------------------------------------------------------
-- WHY EACH FIX IS SHAPED THIS WAY
--
-- Verified per table which client actually reaches it, because the obvious
-- tightening breaks the app in two of the four cases:
--
--   agent_memories             only consumer is app/api/agents/[id]/memory/
--                              count/route.ts, which uses
--                              createServerSupabaseClient() -> service role ->
--                              BYPASSRLS. Dropping the policy costs nothing.
--
--   workflow_step_executions   written through supabaseAdmin, with an explicit
--                              "bypass RLS policies for server-side operations"
--                              comment at lib/pilot/StateManager.ts:1074. It has
--                              NO policy for `authenticated` at all today, so
--                              nothing legitimate depends on the anon policies.
--
--   execution_insights         already has correct own-row SELECT/UPDATE/DELETE
--                              policies. Only its INSERT was open. Replacing
--                              `true` with `auth.uid() = user_id` keeps a
--                              cookie-client insert of one's own row working and
--                              refuses anon, whose auth.uid() is NULL.
--
--   workflow_approval_requests DO NOT scope this to the `approvers` predicate
--                              that its SELECT policy uses. lib/pilot/
--                              ApprovalTracker.ts takes an INJECTED client, so
--                              on the user path it runs as `authenticated` and
--                              updates status for workflows whose owner is not
--                              in `approvers` — the predicate would refuse
--                              legitimate status transitions. Restricting the
--                              policies to the `authenticated` ROLE closes the
--                              anon hole without changing who passes among
--                              signed-in callers. Tightening within
--                              `authenticated` needs an owner-column decision
--                              and is a follow-up, recorded on the task.
--
-- ---------------------------------------------------------------------------
-- NOT IN THIS SLICE, ON PURPOSE
--
--   * smart_link_clicks and website_page_views also carry PUBLIC INSERT with
--     `true`. Those may be legitimate — a visitor's browser recording a click or
--     a page view holds only the publishable key. Deciding that needs a product
--     answer, not a migration.
--   * ais_scoring_weights (24 rows), ais_system_config (59) and
--     system_settings_config (216) are world-readable by deliberate
--     "Anyone can read …" policies. They expose internal routing thresholds and
--     model configuration. Tightening them is a separate, larger call.
--   * `anon` holds INSERT/UPDATE/DELETE GRANTS on 129 public tables. RLS refuses
--     it everywhere except the policies above, so the grants are not currently
--     exploitable — but they are wrong, and they are the reason a single bad
--     policy becomes a breach. Revoking them is its own slice, because some anon
--     paths are legitimate.
--
-- Separate defect found while scoping, NOT fixed here: MetricsCollector reads
-- workflow_step_executions with its injected client. On the user-cookie path
-- that is `authenticated`, which has no SELECT policy, so RLS returns zero rows
-- with no error and metrics are computed from zero steps. Dropping the anon
-- policies does not change that — `authenticated` never matched them.
--
-- Re-runnable: every statement below is idempotent.
--
-- @see docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md (S11.2)

-- ---------------------------------------------------------------------------
-- PART A — workflow_step_executions: remove the three anon policies.
--          24111 rows of per-tenant automation telemetry were world-readable,
--          and anon could forge or alter rows through the INSERT/UPDATE ones.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Enable read for anon role"   ON public.workflow_step_executions;
DROP POLICY IF EXISTS "Enable insert for anon role" ON public.workflow_step_executions;
DROP POLICY IF EXISTS "Enable update for anon role" ON public.workflow_step_executions;

-- ---------------------------------------------------------------------------
-- PART B — agent_memories: remove the PUBLIC ALL policy.
--          `USING (true)` for ALL commands meant anon could read, insert,
--          update AND delete every tenant's agent memories.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Service role can access all agent memories" ON public.agent_memories;

-- ---------------------------------------------------------------------------
-- PART C — execution_insights: the open INSERT becomes an own-row INSERT.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Service role can insert insights" ON public.execution_insights;

CREATE POLICY "Users can insert own insights"
  ON public.execution_insights
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- PART D — workflow_approval_requests: same expressions, restricted to the
--          `authenticated` role so anon can no longer create an approval
--          request or approve one. See the ApprovalTracker note above for why
--          the expression is deliberately unchanged.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "approval_requests_insert_policy" ON public.workflow_approval_requests;

CREATE POLICY "approval_requests_insert_policy"
  ON public.workflow_approval_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "approval_requests_update_policy" ON public.workflow_approval_requests;

CREATE POLICY "approval_requests_update_policy"
  ON public.workflow_approval_requests
  FOR UPDATE
  TO authenticated
  USING (true);
