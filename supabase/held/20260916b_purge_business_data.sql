-- Migration: purge_business_data — the destructive commit (phase 2 of 3)
-- Purpose: delete one business's data in ONE transaction, in a caller-supplied
--          order, scoped to exactly one user, or delete nothing at all.
-- Created: 2026-09-16
-- Slice:   2 (Reset); extended IN PLACE by purge slice 3b (2026-10-05) — see
--          "SLICE 3 ADDITIONS" below. Never applied anywhere, so there is no
--          migration history to preserve (slice 3 workplan OQ-2, SA-approved).
-- Requirement: FR-15, FR-17, FR-18, FR-28, §10.9; slice 3: §0.10 F-SA-3, SA C-2
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
--
-- ============================================================================
-- SLICE 3 ADDITIONS — three delete-graph controls (purge slice 3b, 2026-10-05)
-- ============================================================================
-- Controls 1–4 make each DELETE safe on its own. They say nothing about what
-- Postgres does NEXT: a CASCADE foreign key removes rows from a table the
-- caller never listed, and a RESTRICT / NO ACTION key fails the whole run if
-- the order is wrong. The TypeScript layer checks this (`deleteGraph.ts`), but
-- a direct PostgREST call skips the TypeScript layer — the threat this file is
-- held for. So the graph is re-checked HERE, against `pg_constraint`, before
-- the advisory lock and before the first DELETE:
--
--   5. Blocking order. Refuse when a RESTRICT / NO ACTION key has both ends in
--      the list and the child is listed AFTER its parent (the parent's DELETE
--      would fail, or worse, succeed on a different ordering assumption).
--   6. Cascade closure. Refuse when a CASCADE key's parent is listed and its
--      child is NOT (in `public`). This is the server-side guarantee that no
--      row the classification keeps (`never`, or unclassified) is lost
--      beneath it by cascade. It applies to Reset too (SA OQ-7).
--   7. Cascade tenancy (SA C-2). Refuse when, for a CASCADE key with both ends
--      listed whose child has a `user_id` column, any child row that
--      references one of this tenant's parent rows has a `user_id` that is NOT
--      `p_user_id` (another tenant's row, or nobody's). Children are deleted
--      child-first by `user_id`, so by the time the parent goes, its cascade
--      can only remove rows belonging to someone else. Keys that map
--      `user_id` to `user_id` are tenant-bounded by the schema itself and are
--      skipped. A listed parent with no `user_id` column cannot be bounded
--      here, so control 7 refuses it rather than guessing.
--      Widened by SA G-2 (2026-10-05) to every edge through which deleting
--      this tenant's parent rows WRITES another tenant's row:
--        * CASCADE keys with both ends listed, INCLUDING self-references (a
--          self-referencing CASCADE removes another tenant's row that points
--          at one of mine — "the same statement deletes it" holds only for
--          my own rows);
--        * SET NULL ('n') / SET DEFAULT ('d') keys whose parent is listed,
--          WHETHER OR NOT the child is listed: no row is lost, but another
--          tenant's column would be overwritten, which is a cross-tenant
--          write. My own kept rows are not flagged (they are `p_user_id`'s).
--
-- All three are RELATION-AGNOSTIC: they read `pg_constraint.confdeltype` and
-- the caller's list as data, and name no table, so the descriptor contract
-- above still holds. Control 7's dynamic SQL quotes every identifier with
-- `%I`, and every identifier it uses comes from `pg_catalog`, never from the
-- caller. Any RAISE rolls the whole call back.
--
-- Known limit (control 7): the check reads the rows as they are when the call
-- starts. A row inserted by another transaction between the check and the
-- parent's DELETE is not seen. That window is one statement long and inside
-- the same transaction; the TypeScript layer's snapshot is the forensic record.

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
  v_violation    record;
  v_edge         record;
  v_join         text;
  v_found        boolean;
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

  -- ── Slice 3: delete-graph controls 5, 6, 7 ──────────────────────────────
  -- AFTER the two preconditions above, so the existence probe's two
  -- rejections (null id, empty list) still fire first and the probe contract
  -- is unchanged. BEFORE the advisory lock and before any DELETE.

  -- Control 5: blocking order. A RESTRICT ('r') / NO ACTION ('a') key with
  -- both ends listed, child listed after its parent.
  SELECT pc.conname AS constraint_name, cc.relname AS child, pcl.relname AS parent
    INTO v_violation
  FROM pg_constraint pc
  JOIN pg_class cc     ON cc.oid = pc.conrelid
  JOIN pg_namespace cn ON cn.oid = cc.relnamespace AND cn.nspname = 'public'
  JOIN pg_class pcl    ON pcl.oid = pc.confrelid
  JOIN pg_namespace pn ON pn.oid = pcl.relnamespace AND pn.nspname = 'public'
  JOIN jsonb_array_elements(p_tables) WITH ORDINALITY AS child_run(e, ord)
       ON child_run.e ->> 'table' = cc.relname
  JOIN jsonb_array_elements(p_tables) WITH ORDINALITY AS parent_run(e, ord)
       ON parent_run.e ->> 'table' = pcl.relname
  WHERE pc.contype = 'f'
    AND pc.confdeltype IN ('r', 'a')
    AND pc.conrelid <> pc.confrelid
    AND child_run.ord > parent_run.ord
  ORDER BY pc.conname
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'purge_business_data: control 5 — % is listed after %, which it blocks (%). Refusing; nothing was deleted',
      v_violation.child, v_violation.parent, v_violation.constraint_name;
  END IF;

  -- Control 6: cascade closure. A CASCADE ('c') key whose parent is listed
  -- and whose child is not (in public). Self-references are excluded: the
  -- statement that deletes the parent deletes the child.
  -- NOT EXISTS, never NOT IN: an entry without a 'table' key yields NULL, and
  -- NOT IN over a NULL is NULL — which would silently pass every child.
  SELECT pc.conname AS constraint_name, cn.nspname || '.' || cc.relname AS child, pcl.relname AS parent
    INTO v_violation
  FROM pg_constraint pc
  JOIN pg_class pcl    ON pcl.oid = pc.confrelid
  JOIN pg_namespace pn ON pn.oid = pcl.relnamespace AND pn.nspname = 'public'
  JOIN pg_class cc     ON cc.oid = pc.conrelid
  JOIN pg_namespace cn ON cn.oid = cc.relnamespace
  WHERE pc.contype = 'f'
    AND pc.confdeltype = 'c'
    AND pc.conrelid <> pc.confrelid
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_tables) AS listed(e)
      WHERE listed.e ->> 'table' = pcl.relname
    )
    AND NOT (
      cn.nspname = 'public'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_tables) AS listed(e)
        WHERE listed.e ->> 'table' = cc.relname
      )
    )
  ORDER BY pc.conname
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'purge_business_data: control 6 — deleting % would cascade into %, which this run does not list (%). Refusing; nothing was deleted',
      v_violation.parent, v_violation.child, v_violation.constraint_name;
  END IF;

  -- Control 7: cascade tenancy (SA C-2, widened by G-2). For each key with a
  -- `user_id` column on the child, unless a key column pair maps `user_id` to
  -- `user_id` (tenant-bounded by the schema), that is either a CASCADE with
  -- both ends listed (self-references included), or a SET NULL / SET DEFAULT
  -- whose parent is listed (child listed or not).
  FOR v_edge IN
    SELECT pc.conname AS constraint_name,
           pc.conrelid AS child_oid, cc.relname AS child,
           pc.confrelid AS parent_oid, pcl.relname AS parent,
           pc.conkey, pc.confkey
    FROM pg_constraint pc
    JOIN pg_class cc     ON cc.oid = pc.conrelid
    JOIN pg_namespace cn ON cn.oid = cc.relnamespace AND cn.nspname = 'public'
    JOIN pg_class pcl    ON pcl.oid = pc.confrelid
    JOIN pg_namespace pn ON pn.oid = pcl.relnamespace AND pn.nspname = 'public'
    WHERE pc.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_tables) AS listed(e)
        WHERE listed.e ->> 'table' = pcl.relname
      )
      AND (
        pc.confdeltype IN ('n', 'd')
        OR (
          pc.confdeltype = 'c'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_tables) AS listed(e)
            WHERE listed.e ->> 'table' = cc.relname
          )
        )
      )
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = pc.conrelid AND a.attname = 'user_id'
          AND a.attnum > 0 AND NOT a.attisdropped
      )
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(pc.conkey, pc.confkey) AS k(child_att, parent_att)
        JOIN pg_attribute ca ON ca.attrelid = pc.conrelid  AND ca.attnum = k.child_att
        JOIN pg_attribute pa ON pa.attrelid = pc.confrelid AND pa.attnum = k.parent_att
        WHERE ca.attname = 'user_id' AND pa.attname = 'user_id'
      )
    ORDER BY pc.conname
  LOOP
    -- The parent's rows this run removes are `user_id = p_user_id`. Without
    -- that column they cannot be stated here, so refuse rather than guess.
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = v_edge.parent_oid AND a.attname = 'user_id'
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION
        'purge_business_data: control 7 — % cascades into % (%), but % has no user_id column, so the rows its delete would reach cannot be bounded to this tenant. Refusing; nothing was deleted',
        v_edge.parent, v_edge.child, v_edge.constraint_name, v_edge.parent;
    END IF;

    -- The join condition, from the key's own columns, in key order.
    SELECT string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' AND ' ORDER BY k.ord)
      INTO v_join
    FROM unnest(v_edge.conkey, v_edge.confkey) WITH ORDINALITY AS k(child_att, parent_att, ord)
    JOIN pg_attribute ca ON ca.attrelid = v_edge.child_oid  AND ca.attnum = k.child_att
    JOIN pg_attribute pa ON pa.attrelid = v_edge.parent_oid AND pa.attnum = k.parent_att;

    IF v_join IS NULL THEN
      RAISE EXCEPTION
        'purge_business_data: control 7 — could not read the key columns of %. Refusing; nothing was deleted',
        v_edge.constraint_name;
    END IF;

    -- IS DISTINCT FROM, so a child row with a NULL user_id (nobody's) is
    -- refused too. The value is a bound parameter, never interpolated.
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I c JOIN public.%I p ON %s WHERE p.user_id = $1 AND c.user_id IS DISTINCT FROM $1)',
      v_edge.child, v_edge.parent, v_join
    ) INTO v_found USING p_user_id;

    IF v_found THEN
      RAISE EXCEPTION
        'purge_business_data: control 7 — a row in % that does not belong to this tenant references a row of % that this run deletes, so its foreign key (%) would delete or overwrite it. Refusing; nothing was deleted',
        v_edge.child, v_edge.parent, v_edge.constraint_name;
    END IF;
  END LOOP;

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
  'ordered table list. Refuses any delete it cannot scope to p_user_id, and '
  '(slice 3) any list whose live foreign keys would block it, cascade outside '
  'it, or cascade into another tenant''s rows (controls 5, 6, 7). '
  'service_role ONLY — and note that the guards which decide WHETHER a purge is '
  'permitted live in the application layer above this function, not in it.';

-- ============================================================================
-- GRANTS — service_role only. Revoked first so re-running cannot widen access.
-- ============================================================================
REVOKE ALL ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION purge_business_data(uuid, text, jsonb, jsonb) TO service_role;
