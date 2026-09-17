-- Migration: purge_business_data — the destructive commit (phase 2 of 3)
-- Purpose: delete one business's data in ONE transaction, in a caller-supplied
--          order, scoped to exactly one user, or delete nothing at all.
-- Created: 2026-09-16
-- Slice:   2 (Reset)
-- Requirement: FR-15, FR-17, FR-18, FR-28, §10.9
--
-- ============================================================================
-- 🔴 DO NOT APPLY THIS MIGRATION UNTIL THE service_role KEY HAS BEEN ROTATED.
-- ============================================================================
-- As of 2026-09-16 the project's `service_role` key is published in a tracked
-- file on the PUBLIC `origin/main` (`docs/VERCEL_DEPLOYMENT_SETUP.md`, line 19,
-- committed `e22afc4f` on 2025-10-30). It is byte-identical to the key this
-- application is using.
--
-- Every guard this feature has — `authorizePurge`, the D9 flag, the dry-run
-- token, typed confirmation, the pre-flight gate, the snapshot — lives in the
-- TypeScript layer ABOVE this function. PostgREST exposes this function
-- directly. `GRANT EXECUTE ... TO service_role` sounds like a control, but it
-- is not one while the service_role key is public.
--
-- Applying this before rotation converts a known credential leak into a
-- remote, unauthenticated "delete any business by user id" endpoint — a single
-- call that is transactional, correctly ordered, and works around all sixteen
-- FK blockers on the attacker's behalf. Today an attacker with that key would
-- have to reconstruct the ordering themselves; this function does it for them.
--
-- Rotate first. Then apply.
--
-- ============================================================================
-- WHY THIS FILE IS IN supabase/held/ AND NOT supabase/migrations/
-- ============================================================================
-- This repo has `supabase/config.toml`, so `supabase db push` applies every
-- file in `migrations/` — and it does not read this header. A "DO NOT APPLY"
-- comment inside a file in the apply path is not a hold; it is a hope.
--
-- The release procedure, in order, is in `supabase/held/README.md`. Note step 7
-- there in particular: after applying, run `NOTIFY pgrst, 'reload schema';` or
-- PostgREST cannot see the function, Reset keeps refusing with
-- `rpc_not_applied`, and it looks like a bug when it is a stale cache.
--
-- ============================================================================
-- THE DESCRIPTOR CONTRACT
-- ============================================================================
-- This function does NOT contain a table list. It executes an ORDERED list
-- supplied by the caller, because requirement §10.9 requires the executor to
-- iterate exactly one declarative structure and forbids table names appearing
-- anywhere else. That structure is `lib/business-os/purge/descriptors.ts`, and
-- duplicating it here in SQL would create a second inventory that drifts.
--
-- `p_tables` is a JSONB array, in delete order, of:
--     { "table": "crm_contacts",  "scope": "user_id" }
--     { "table": "website_blocks","scope": "via", "parent": "website_pages", "fk": "page_id" }
--
-- ============================================================================
-- WHY A CALLER-SUPPLIED TABLE LIST IS NOT AN INJECTION HOLE
-- ============================================================================
-- Four independent controls, applied to every element before it is used:
--   1. The identifier must match `^[a-z][a-z0-9_]*$`.
--   2. The table must EXIST as a base table in `public` (information_schema).
--   3. It is interpolated with `format('%I')`, which quotes identifiers safely.
--   4. 🔴 The scoping column must EXIST ON THAT TABLE. A `user_id`-scoped
--      descriptor naming a table with no `user_id` column is REFUSED, not
--      silently widened.
--
-- Control 4 is the important one. It is a SERVER-SIDE RE-DERIVATION of the
-- guarantee the descriptor set makes in TypeScript: this function will not emit
-- an unscoped DELETE even if handed a descriptor set that asks it to. AC-45
-- proves the property at build time; this proves it again at run time, where
-- the rows actually are.
--
-- ============================================================================
-- PARAMETER NAMING (§1.2)
-- ============================================================================
-- Every parameter is `p_`-prefixed and none shares a name with a column it
-- filters. `supabase/SQL Scripts/delete_user_by_id.sql` (since removed) declared
-- a variable named `user_id` and filtered a column named `user_id`, producing
-- `WHERE user_id = user_id` — constantly true under one `plpgsql.variable_conflict`
-- setting, and a platform-wide delete. That file is why this comment exists.

CREATE OR REPLACE FUNCTION purge_business_data(
  p_user_id uuid,
  p_level   text,
  p_options jsonb DEFAULT '{}'::jsonb,
  p_tables  jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry        jsonb;
  v_table        text;
  v_scope        text;
  v_parent       text;
  v_fk           text;
  v_deleted      bigint;
  v_counts       jsonb := '{}'::jsonb;
  v_total        bigint := 0;
  v_started      timestamptz := clock_timestamp();
  v_lock_key     bigint;
BEGIN
  -- ── Preconditions ───────────────────────────────────────────────────────
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'purge_business_data: p_user_id is required';
  END IF;

  IF p_level NOT IN ('reset', 'purge') THEN
    RAISE EXCEPTION 'purge_business_data: unknown level %', p_level;
  END IF;

  IF jsonb_typeof(p_tables) <> 'array' OR jsonb_array_length(p_tables) = 0 THEN
    -- An empty list would "succeed" having deleted nothing, and the caller
    -- would report a successful purge. Refuse instead.
    RAISE EXCEPTION 'purge_business_data: p_tables must be a non-empty ordered array';
  END IF;

  -- ── FR-28: transaction-scoped advisory lock ─────────────────────────────
  -- `pg_try_advisory_xact_lock`, NOT the session-scoped `pg_try_advisory_lock`
  -- wrapper that already exists. supabase-js speaks PostgREST over a POOLED
  -- connection, so a session lock yields both false passes (a concurrent call
  -- served by another backend does not observe it) and permanent false blocks
  -- (a run that dies leaves the lock held on a connection handed to unrelated
  -- traffic). An xact lock releases at COMMIT or ROLLBACK with no unlock call
  -- that can leak.
  v_lock_key := hashtextextended(p_user_id::text, 0);

  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'already_running',
      'user_id', p_user_id
    );
  END IF;

  -- ── Ordered deletes ─────────────────────────────────────────────────────
  -- The order is the caller's, derived from the live pg_constraint dump. This
  -- function does not re-derive it: it honours it, and refuses anything it
  -- cannot scope.
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_tables)
  LOOP
    v_table  := v_entry ->> 'table';
    v_scope  := COALESCE(v_entry ->> 'scope', 'user_id');
    v_parent := v_entry ->> 'parent';
    v_fk     := v_entry ->> 'fk';

    -- Control 1: identifier shape.
    IF v_table !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'purge_business_data: refusing malformed table name %', v_table;
    END IF;

    -- Control 2: the table exists as a base table in public.
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables t
      WHERE t.table_schema = 'public'
        AND t.table_name = v_table
        AND t.table_type = 'BASE TABLE'
    ) THEN
      RAISE EXCEPTION 'purge_business_data: refusing unknown table %', v_table;
    END IF;

    IF v_scope = 'user_id' THEN
      -- Control 4: the scoping column must exist ON THIS TABLE.
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = v_table
          AND c.column_name = 'user_id'
      ) THEN
        RAISE EXCEPTION
          'purge_business_data: refusing to delete from % — it has no user_id column, so this delete could not be scoped',
          v_table;
      END IF;

      -- Controls 3: identifiers quoted by format('%I'); the value is a bound
      -- parameter, never interpolated.
      EXECUTE format('DELETE FROM public.%I WHERE user_id = $1', v_table)
        USING p_user_id;

    ELSIF v_scope = 'via' THEN
      IF v_parent IS NULL OR v_fk IS NULL THEN
        RAISE EXCEPTION 'purge_business_data: via-scoped % is missing parent or fk', v_table;
      END IF;

      IF v_parent !~ '^[a-z][a-z0-9_]*$' OR v_fk !~ '^[a-z][a-z0-9_]*$' THEN
        RAISE EXCEPTION 'purge_business_data: refusing malformed via scope for %', v_table;
      END IF;

      -- The PARENT must be user_id-scoped, or the subquery below is unscoped
      -- and the delete escapes the tenant. This is the same control as above,
      -- applied one level up — which is where a `via` descriptor's scoping
      -- actually lives.
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = v_parent
          AND c.column_name = 'user_id'
      ) THEN
        RAISE EXCEPTION
          'purge_business_data: refusing via-delete from % — parent % has no user_id column',
          v_table, v_parent;
      END IF;

      EXECUTE format(
        'DELETE FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = $1)',
        v_table, v_fk, v_parent
      ) USING p_user_id;

    ELSE
      -- 'global' or anything else. A global-scoped descriptor must never reach
      -- this function; if one does, that is a bug upstream and this refuses.
      RAISE EXCEPTION 'purge_business_data: refusing unscoped delete for % (scope=%)', v_table, v_scope;
    END IF;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_counts := v_counts || jsonb_build_object(v_table, v_deleted);
    v_total  := v_total + v_deleted;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'level', p_level,
    'options', p_options,
    'counts', v_counts,
    'total_rows', v_total,
    'table_count', jsonb_array_length(p_tables),
    'committed_at', clock_timestamp(),
    'duration_ms', EXTRACT(MILLISECOND FROM (clock_timestamp() - v_started))
  );
END;
$$;

COMMENT ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) IS
  'Phase 2 of the Business OS purge: one transaction, one user, a caller-supplied '
  'ordered table list. Refuses any delete it cannot scope to p_user_id. '
  'service_role ONLY — and note that the guards which decide WHETHER a purge is '
  'permitted live in the application layer above this function, not in it.';

-- ============================================================================
-- GRANTS — service_role only. Revoked first so re-running cannot widen access.
-- ============================================================================
REVOKE ALL ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) TO service_role;
