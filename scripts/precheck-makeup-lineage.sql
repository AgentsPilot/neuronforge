-- 20261109 pre-check, step 1 of the apply. Read-only
-- Every row must say ok. Any FAIL row stops the apply, and nothing is pasted
-- It proves move_meeting is live under the signature 20261109 replaces, that it is still the 20261087
-- body (no lineage, no stamp), and that the column it is about to carry exists on the table
WITH
fn AS (
  SELECT pg_catalog.to_regprocedure(
    'public.move_meeting(uuid, uuid, timestamptz, timestamptz, text)'
  ) AS oid
),
tbl AS (
  SELECT pg_catalog.to_regclass('public.scheduling_meetings') AS oid
),
checks AS (
  SELECT 1 AS ord, 'move_meeting exists with the five argument signature' AS check_name,
    (SELECT fn.oid FROM fn) IS NOT NULL AS passed
  UNION ALL
  SELECT 2, 'its body does not carry the 20261109 stamp c4e8b1f07d3a6295 yet',
    NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn)
        AND position('c4e8b1f07d3a6295' in p.prosrc) > 0
    )
  UNION ALL
  SELECT 3, 'its body does not mention replaces_meeting_id yet (this is the 20261087 body)',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc AS p
      WHERE p.oid = (SELECT fn.oid FROM fn)
        AND position('replaces_meeting_id' in p.prosrc) = 0
    )
  UNION ALL
  SELECT 4, 'scheduling_meetings.replaces_meeting_id exists (20261097 is applied)',
    EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS att
      WHERE att.attrelid = (SELECT tbl.oid FROM tbl)
        AND att.attname = 'replaces_meeting_id'
        AND att.attnum > 0
        AND NOT att.attisdropped
    )
  UNION ALL
  SELECT 5, 'service_role can execute it, so the grants CREATE OR REPLACE preserves are there to preserve',
    (SELECT fn.oid FROM fn) IS NOT NULL
    AND pg_catalog.has_function_privilege('service_role', (SELECT fn.oid FROM fn), 'EXECUTE')
),
info AS (
  /* Information only. How many rows a move has already stripped the link from:
     the predecessor attempt of the same session carries one and this row does not.
     These are what the opt-in data repair would restore. */
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
    ) || ' moved attempts have lost the link to the hour they replace' AS check_name,
    NULL::boolean AS passed
)
SELECT u.ord, u.check_name,
  CASE WHEN u.passed IS NULL THEN 'info' WHEN u.passed THEN 'ok' ELSE 'FAIL' END AS status
FROM (SELECT * FROM checks UNION ALL SELECT * FROM info) AS u
ORDER BY u.ord;
