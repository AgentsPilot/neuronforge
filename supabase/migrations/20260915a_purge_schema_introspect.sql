-- Migration: FR-1 live schema introspection for the Business OS purge engine
-- Purpose: give the purge engine a runtime oracle for what actually exists in
--          the database, so it can fail closed when the live schema and the
--          descriptor set disagree (AC-37).
-- Created: 2026-09-15
-- Workplan: docs/workplans/business-os-business-data-purge.md (T1)
--
-- ============================================================================
-- WHY A RUNTIME RPC AND NOT A BUILD-TIME MANIFEST
-- ============================================================================
-- A committed manifest cannot detect a table added after it was generated —
-- which is precisely how the requirement's own table inventory became
-- incomplete twice during authoring. AC-37 is a D9 un-gating condition, so
-- certifying a manifest rather than the database would be certifying the wrong
-- oracle. The existing tools cannot substitute: `generate-business-catalog.ts`
-- introspects a hard-coded 25-table allow-list and its committed output is
-- stale, and `schema:check` only replays `.select()` calls already present in
-- source — neither can see a table that no code references.
--
-- ============================================================================
-- SECURITY — READ THIS BEFORE CHANGING THE GRANTS
-- ============================================================================
-- This function is SECURITY DEFINER and returns `information_schema` +
-- `pg_catalog` contents. That makes it a complete schema-disclosure endpoint:
-- every table, column, type, constraint, trigger and RLS policy in the
-- database. PostgREST exposes any function the caller's role may EXECUTE, so
-- granting this to `authenticated` would publish the entire schema to every
-- signed-in user through a plain HTTP call.
--
-- Therefore:
--   * EXECUTE is granted to `service_role` ONLY.
--   * EXECUTE is explicitly REVOKED from PUBLIC, `anon` and `authenticated`.
--   * `search_path` is pinned, so a caller-controlled search_path cannot
--     redirect the catalog reads.
--
-- It is also strictly read-only: it performs no DML and no DDL.

-- ============================================================================
-- 1. USER-SCOPED TABLE / COLUMN INVENTORY
-- ============================================================================
-- Returns one row per column of every base table in `public`. The engine needs
-- full columns (not just the `user_id` ones) for two reasons: to decide whether
-- a table is user-scoped at all, and to build the no-PII customer snapshot by
-- selecting an explicit column list rather than `*`.

CREATE OR REPLACE FUNCTION purge_schema_introspect()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'generated_at', now(),

    -- ------------------------------------------------------------------
    -- Columns of every base table in `public`.
    -- ------------------------------------------------------------------
    'columns', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'table_name',  c.table_name,
               'column_name', c.column_name,
               'data_type',   c.data_type,
               'is_nullable', c.is_nullable
             ) ORDER BY c.table_name, c.ordinal_position)
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name   = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type   = 'BASE TABLE'
    ), '[]'::jsonb),

    -- ------------------------------------------------------------------
    -- Every table in `public` carrying a `user_id` column.
    --
    -- This is the set AC-37 checks: a user-scoped table present here but in
    -- neither the delete set nor the enumerated exclusion set must fail the
    -- run closed. Tables WITHOUT a `user_id` (e.g. the platform-learning
    -- aggregates `workflow_patterns` / `global_failure_patterns`) never appear
    -- here and therefore need no descriptor.
    -- ------------------------------------------------------------------
    'user_scoped_tables', COALESCE((
      SELECT jsonb_agg(DISTINCT c.table_name ORDER BY c.table_name)
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name   = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type   = 'BASE TABLE'
        AND c.column_name  = 'user_id'
    ), '[]'::jsonb),

    -- ------------------------------------------------------------------
    -- Foreign keys, with their ON DELETE action.
    --
    -- The delete order (T3) is derived from THIS, not from migration files:
    -- duplicate CRM migrations disagree with each other about CASCADE, and an
    -- unknown number of migrations may be unapplied. `confdeltype` is the
    -- single-char action code: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL,
    -- d=SET DEFAULT.
    --
    -- C-2: the engine fingerprints this set at run time and fails closed in
    -- phase 1 if it differs from the set T3 derived the order from — otherwise
    -- a FK added later surfaces as an opaque constraint error inside the
    -- phase-2 transaction. Safe (it rolls back) but undiagnosable.
    -- ------------------------------------------------------------------
    'foreign_keys', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'constraint_name', con.conname,
               'table_name',      src.relname,
               'references',      tgt.relname,
               'on_delete',       con.confdeltype
             ) ORDER BY src.relname, con.conname)
      FROM pg_constraint con
      JOIN pg_class     src ON src.oid = con.conrelid
      JOIN pg_class     tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace ns  ON ns.oid  = src.relnamespace
      WHERE con.contype = 'f'
        AND ns.nspname  = 'public'
    ), '[]'::jsonb),

    -- ------------------------------------------------------------------
    -- Triggers. Trigger residue is handled by DELETE ORDERING, never by
    -- suppression: `ALTER TABLE ... DISABLE TRIGGER` is table-owner-only and
    -- `SET session_replication_role = replica` is superuser-only, so neither
    -- is reliably available to the service role on Supabase.
    --
    -- `tgisinternal` filters out FK-enforcement triggers, which are already
    -- covered by `foreign_keys` above.
    -- ------------------------------------------------------------------
    'triggers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'trigger_name', tg.tgname,
               'table_name',   rel.relname,
               'definition',   pg_get_triggerdef(tg.oid)
             ) ORDER BY rel.relname, tg.tgname)
      FROM pg_trigger   tg
      JOIN pg_class     rel ON rel.oid = tg.tgrelid
      JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
      WHERE ns.nspname = 'public'
        AND NOT tg.tgisinternal
    ), '[]'::jsonb),

    -- ------------------------------------------------------------------
    -- RLS policies. Recorded because ~20 of the in-scope tables give the
    -- logged-in user no DELETE policy at all, which is why this is a
    -- service-role operation — and because two public INSERT policies
    -- (`website_page_views`, `smart_link_clicks`) are `WITH CHECK (true)`.
    -- ------------------------------------------------------------------
    'policies', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'table_name',  pol.tablename,
               'policy_name', pol.policyname,
               'command',     pol.cmd,
               'roles',       pol.roles,
               'using_expr',  pol.qual,
               'check_expr',  pol.with_check
             ) ORDER BY pol.tablename, pol.policyname)
      FROM pg_policies pol
      WHERE pol.schemaname = 'public'
    ), '[]'::jsonb)
  )
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION purge_schema_introspect() IS
  'FR-1 runtime schema oracle for the Business OS purge engine. Read-only. '
  'SECURITY DEFINER + information_schema means this is a full schema-disclosure '
  'endpoint: EXECUTE must remain granted to service_role ONLY, never to '
  'authenticated or anon.';

-- ============================================================================
-- GRANTS — service_role only. Revokes first so re-running cannot widen access.
-- ============================================================================
REVOKE ALL ON FUNCTION purge_schema_introspect() FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_schema_introspect() FROM anon;
REVOKE ALL ON FUNCTION purge_schema_introspect() FROM authenticated;
GRANT EXECUTE ON FUNCTION purge_schema_introspect() TO service_role;
