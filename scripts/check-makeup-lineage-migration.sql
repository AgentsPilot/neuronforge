-- 20261109 checker. Read-only
-- Run it ONCE BEFORE the apply: rows 1 to 3 must read FAIL. A checker that is already all ok
-- cannot detect the apply, and goes back to Dev
-- Run it AFTER the apply: every row must read ok
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure(
    'public.move_meeting(uuid, uuid, timestamptz, timestamptz, text)'
  ) AS oid
),
body AS (
  SELECT p.prosrc AS src, p.prosecdef AS secdef
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = (SELECT fn.oid FROM fn)
),
checks AS (
  SELECT 1 AS ord, 'move_meeting carries the 20261109 stamp c4e8b1f07d3a6295' AS check_name,
    EXISTS (SELECT 1 FROM body WHERE position('c4e8b1f07d3a6295' in body.src) > 0) AS passed
  UNION ALL
  SELECT 2, 'its INSERT column list includes replaces_meeting_id',
    EXISTS (SELECT 1 FROM body WHERE position('replaces_meeting_id' in body.src) > 0)
  UNION ALL
  SELECT 3, 'it inserts the OLD row''s value, v_old.replaces_meeting_id, not a literal',
    EXISTS (SELECT 1 FROM body WHERE position('v_old.replaces_meeting_id' in body.src) > 0)
  UNION ALL
  SELECT 4, 'the rest of 20261087 survives: the FOR UPDATE lock, the no-op return and the moved stamp',
    EXISTS (
      SELECT 1 FROM body
      WHERE position('FOR UPDATE' in body.src) > 0
        AND position('v_old.start_time = p_start' in body.src) > 0
        AND position('v_old.meeting_status IS NULL' in body.src) > 0
        AND position('occurrence_number + 1' in body.src) > 0
    )
  UNION ALL
  SELECT 5, 'it is still SECURITY INVOKER, as 20261087 left it',
    EXISTS (SELECT 1 FROM body WHERE NOT body.secdef)
  UNION ALL
  SELECT 6, 'the EXECUTE grants CREATE OR REPLACE preserves are intact (service_role and authenticated)',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.has_function_privilege('service_role', (SELECT fn.oid FROM fn), 'EXECUTE')
    AND pg_catalog.has_function_privilege('authenticated', (SELECT fn.oid FROM fn), 'EXECUTE')
  UNION ALL
  SELECT 7, 'its comment records what the new attempt inherits',
    coalesce(
      pg_catalog.obj_description((SELECT fn.oid FROM fn)::oid, 'pg_proc'),
      ''
    ) LIKE '%replaces_meeting_id (20261109)%'
),
info AS (
  SELECT 100 AS ord,
    'info: ' || (
      SELECT count(*)::text
      FROM public.scheduling_meetings AS m
      JOIN public.scheduling_meetings AS prev
        ON prev.booking_id = m.booking_id
       AND prev.user_id = m.user_id
       AND prev.session_number = m.session_number
       AND prev.occurrence_number = m.occurrence_number - 1
      WHERE m.replaces_meeting_id IS NULL
        AND prev.replaces_meeting_id IS NOT NULL
    ) || ' existing moved attempts still carry no link (the opt-in repair restores these)' AS check_name,
    NULL::boolean AS passed
)
SELECT u.ord, u.check_name,
  CASE WHEN u.passed IS NULL THEN 'info' WHEN u.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM (SELECT * FROM checks UNION ALL SELECT * FROM info) AS u
ORDER BY u.ord;
