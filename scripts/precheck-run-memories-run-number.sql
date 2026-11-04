-- 20261106 pre-check, step 1 of the apply. Read-only
-- Every row must say ok. Any FAIL row stops the apply, and nothing is pasted
-- It proves the table and the constraint the migration is written against exist, that neither the
-- trigger nor its function is there yet, and that get_next_run_number (whose comment the migration
-- rewrites) is live under the signature the migration names
WITH
tbl AS (
  SELECT pg_catalog.to_regclass('public.run_memories') AS oid
),
checks AS (
  SELECT 1 AS ord, 'public.run_memories exists' AS check_name,
    (SELECT tbl.oid FROM tbl) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'the unique constraint run_memories_agent_id_run_number_key is on (agent_id, run_number)',
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint AS con
      WHERE con.conname = 'run_memories_agent_id_run_number_key'
        AND con.conrelid = (SELECT tbl.oid FROM tbl)
        AND con.contype = 'u'
        AND (
          SELECT array_agg(att.attname ORDER BY att.attname)
          FROM pg_catalog.pg_attribute AS att
          WHERE att.attrelid = con.conrelid
            AND att.attnum = ANY (con.conkey)
        ) = ARRAY['agent_id', 'run_number']
    )
  UNION ALL
  SELECT 3, 'no trigger named run_memories_assign_run_number exists yet',
    NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS tg
      WHERE tg.tgrelid = (SELECT tbl.oid FROM tbl)
        AND tg.tgname = 'run_memories_assign_run_number'
        AND NOT tg.tgisinternal
    )
  UNION ALL
  SELECT 4, 'the trigger function public.run_memories_assign_run_number() does not exist yet',
    pg_catalog.to_regprocedure('public.run_memories_assign_run_number()') IS NULL
  UNION ALL
  SELECT 5, 'public.get_next_run_number(uuid) exists, so the migration can re-comment it',
    pg_catalog.to_regprocedure('public.get_next_run_number(uuid)') IS NOT NULL
  UNION ALL
  SELECT 6, 'run_memories.run_number exists and is an integer type',
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT tbl.oid FROM tbl)
        AND att.attname = 'run_number'
        AND att.attnum > 0
        AND NOT att.attisdropped
        AND pg_catalog.format_type(att.atttypid, NULL) IN ('smallint', 'integer', 'bigint')
    )
),
info AS (
  -- Information only, never a gate: the shape the trigger will meet in production
  SELECT 100 AS ord,
    'info: run_number is ' ||
      CASE WHEN (
        SELECT att.attnotnull
        FROM pg_catalog.pg_attribute AS att
        WHERE att.attrelid = (SELECT tbl.oid FROM tbl) AND att.attname = 'run_number'
      ) THEN 'NOT NULL, so the NULL branch of the trigger is unreachable from a direct insert'
      ELSE 'nullable, so a caller may omit it and let the trigger number the row'
      END AS check_name,
    NULL::boolean AS passed
  UNION ALL
  SELECT 101,
    'info: ' || (SELECT count(*)::text FROM public.run_memories) || ' run_memories rows over ' ||
      (SELECT count(DISTINCT m.agent_id)::text FROM public.run_memories AS m) || ' agents',
    NULL::boolean
)
SELECT u.ord, u.check_name,
  CASE WHEN u.passed IS NULL THEN 'info' WHEN u.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM (SELECT * FROM checks UNION ALL SELECT * FROM info) AS u
ORDER BY u.ord;
