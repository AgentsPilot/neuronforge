-- 20261106 checker. Read-only
-- Run it ONCE BEFORE the apply: rows 1 to 6 must read FAIL. A checker that is already all ok
-- cannot detect the apply, and goes back to Dev
-- Run it AFTER the apply: every row must read ok
WITH
tbl AS (
  SELECT pg_catalog.to_regclass('public.run_memories') AS oid
),
fn AS (
  SELECT pg_catalog.to_regprocedure('public.run_memories_assign_run_number()') AS oid
),
checks AS (
  SELECT 1 AS ord, 'the trigger function public.run_memories_assign_run_number() exists' AS check_name,
    (SELECT fn.oid FROM fn) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'its body carries the 20261106 stamp a7f20c53d1b84e69',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn)
        AND position('a7f20c53d1b84e69' in p.prosrc) > 0
    )
  UNION ALL
  SELECT 3, 'it holds the lock until COMMIT (pg_advisory_xact_lock, not pg_advisory_lock plus unlock)',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn)
        AND position('pg_advisory_xact_lock' in p.prosrc) > 0
        AND position('pg_advisory_unlock' in p.prosrc) = 0
    )
  UNION ALL
  SELECT 4, 'it is SECURITY INVOKER with a pinned search_path',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn)
        AND NOT p.prosecdef
        AND p.proconfig IS NOT NULL
        AND EXISTS (SELECT 1 FROM unnest(p.proconfig) AS c WHERE c LIKE 'search_path=%')
    )
  UNION ALL
  SELECT 5, 'the trigger run_memories_assign_run_number is BEFORE INSERT FOR EACH ROW on run_memories and calls that function',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS tg
      WHERE tg.tgrelid = (SELECT tbl.oid FROM tbl)
        AND tg.tgname = 'run_memories_assign_run_number'
        AND NOT tg.tgisinternal
        AND tg.tgenabled <> 'D'
        AND (tg.tgtype & 7) = 7
        AND tg.tgfoid = (SELECT fn.oid FROM fn)
    )
  UNION ALL
  SELECT 6, 'get_next_run_number(uuid) is re-commented as advisory only',
    coalesce(
      pg_catalog.obj_description(pg_catalog.to_regprocedure('public.get_next_run_number(uuid)')::oid, 'pg_proc'),
      ''
    ) LIKE 'ADVISORY ONLY%'
  UNION ALL
  SELECT 7, 'EXECUTE on the trigger function is service_role only (hygiene, never checked at fire time)',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.has_function_privilege('service_role', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('anon', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated', (SELECT fn.oid FROM fn), 'EXECUTE')
  UNION ALL
  SELECT 8, 'no agent has a duplicate run_number, which the unique constraint still enforces',
    NOT EXISTS (
      SELECT 1
      FROM public.run_memories AS m
      GROUP BY m.agent_id, m.run_number
      HAVING count(*) > 1
    )
),
info AS (
  SELECT 100 AS ord,
    'info: ' || (SELECT count(*)::text FROM public.run_memories) || ' run_memories rows, highest run_number ' ||
      coalesce((SELECT max(m.run_number)::text FROM public.run_memories AS m), 'none') AS check_name,
    NULL::boolean AS passed
)
SELECT u.ord, u.check_name,
  CASE WHEN u.passed IS NULL THEN 'info' WHEN u.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM (SELECT * FROM checks UNION ALL SELECT * FROM info) AS u
ORDER BY u.ord;
