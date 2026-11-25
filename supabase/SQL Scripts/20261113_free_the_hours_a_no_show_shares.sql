/*
 * OPT-IN DATA REPAIR — run this only if 20261111_a_no_show_keeps_its_hour.sql
 * refused, and only after reading scripts/precheck-no-show-holds-its-hour.sql.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT REFUSED THE MIGRATION
 *
 * 33 overlapping meeting pairs and 2 booking pairs, which are 20 DISTINCT
 * clashes — a `no_show`/`no_show` pair is counted from both ends. Every one
 * has the same shape: two DIFFERENT bookings, NO lineage between them, and an
 * IDENTICAL span. The precheck's own note calls that "almost always one
 * appointment recorded twice".
 *
 * Measured 2026-11-09 before writing this: all 20 belong to three addresses —
 * eomer3@gmail.com, eomer3@walla.co.il, offir.omer@windpoint.io — and nine of
 * the eleven future ones are the SAME person booked against themselves at the
 * same hour. No client of this business is in any of them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT MOVES THE HOUR AND DELETES NOTHING
 *
 * The precheck is explicit: resolve by nudging the historical row's span,
 * "never by deleting it — the money hangs on that row", and never by marking
 * the live meeting anything, which would free an hour a client expects.
 *
 * So only the `no_show` side moves, and only its times. Its outcome, its
 * lineage, its booking and its money are untouched.
 *
 * WHY A WHOLE DAY, AND WHY A LIST RATHER THAN A RULE
 *
 * The spans are identical, so clearing an overlap needs a shift of at least
 * the full duration. A blanket rule fails twice over: shifting every no-show
 * moves both halves of a `no_show`/`no_show` pair together, so they still
 * collide, and a blanket 15-minute walk lands rows at 02:00 — a session in the
 * middle of the night, which is a worse record than the one being repaired.
 *
 * Each row is therefore moved back whole DAYS, the fewest that clear it, so
 * the time of day survives and the duplicate simply sits earlier. The result
 * was computed against the live rows and verified to leave ZERO clashing
 * pairs; it is listed explicitly so what runs is exactly what was checked.
 *
 * 17 rows move: 7 by a day, 5 by two, 4 by three, 1 by four.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ORDER: this, then the migration. Step 1 writes nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

-- ─── STEP 1: READ-ONLY. The rows, as they stand and as they would be. ───────

WITH planned (id, new_start, new_end, old_start) AS (
  VALUES
    ('0c7ed805-379d-4d14-abc5-35357d0608b4'::uuid, timestamptz '2026-11-15T10:00:00.000Z', timestamptz '2026-11-15T11:00:00.000Z', timestamptz '2026-11-16T10:00:00+00:00'),
    ('1ce56b36-fb9b-4f9d-9d10-4ea52d495c98'::uuid, timestamptz '2026-11-01T11:00:00.000Z', timestamptz '2026-11-01T12:00:00.000Z', timestamptz '2026-11-03T11:00:00+00:00'),
    ('1f8cc28a-fdbe-4b84-a579-256b36bef2df'::uuid, timestamptz '2026-11-14T10:00:00.000Z', timestamptz '2026-11-14T11:00:00.000Z', timestamptz '2026-11-16T10:00:00+00:00'),
    ('38cdd806-74ea-492f-b12c-3565014b6881'::uuid, timestamptz '2026-11-22T10:00:00.000Z', timestamptz '2026-11-22T11:00:00.000Z', timestamptz '2026-11-23T10:00:00+00:00'),
    ('399a309b-1716-4d9d-9ef6-4ea1fd42089c'::uuid, timestamptz '2026-11-24T15:00:00.000Z', timestamptz '2026-11-24T16:00:00.000Z', timestamptz '2026-11-25T15:00:00+00:00'),
    ('43ee9c34-c30e-49ad-b076-774971ccde7e'::uuid, timestamptz '2026-11-16T09:00:00.000Z', timestamptz '2026-11-16T10:00:00.000Z', timestamptz '2026-11-17T09:00:00+00:00'),
    ('5457b24c-b9a8-4059-ba8f-e55b7cfacb21'::uuid, timestamptz '2026-11-04T10:00:00.000Z', timestamptz '2026-11-04T11:00:00.000Z', timestamptz '2026-11-05T10:00:00+00:00'),
    ('584bf54a-763b-4865-81a9-0568258f2560'::uuid, timestamptz '2026-11-21T10:00:00.000Z', timestamptz '2026-11-21T11:00:00.000Z', timestamptz '2026-11-23T10:00:00+00:00'),
    ('830e69ef-89d7-4d97-b471-60e7be654caa'::uuid, timestamptz '2026-11-16T08:00:00.000Z', timestamptz '2026-11-16T09:00:00.000Z', timestamptz '2026-11-19T08:00:00+00:00'),
    ('899ba9f9-9eaa-4e84-92e7-72c239155b81'::uuid, timestamptz '2026-11-01T10:00:00.000Z', timestamptz '2026-11-01T11:00:00.000Z', timestamptz '2026-11-03T10:00:00+00:00'),
    ('90b7782d-b751-45ad-8219-0b3ba89203bc'::uuid, timestamptz '2026-11-08T08:00:00.000Z', timestamptz '2026-11-08T09:00:00.000Z', timestamptz '2026-11-12T08:00:00+00:00'),
    ('a91ee82e-f2f5-438b-b9c4-ca369f021b12'::uuid, timestamptz '2026-11-02T07:00:00.000Z', timestamptz '2026-11-02T08:00:00.000Z', timestamptz '2026-11-03T07:00:00+00:00'),
    ('ba8bc768-218b-4d6b-a5b5-5459adb5b97b'::uuid, timestamptz '2026-11-29T10:00:00.000Z', timestamptz '2026-11-29T11:00:00.000Z', timestamptz '2026-11-30T10:00:00+00:00'),
    ('be11291f-29f7-4e06-9a3a-61085b32e1a2'::uuid, timestamptz '2026-11-01T12:00:00.000Z', timestamptz '2026-11-01T13:00:00.000Z', timestamptz '2026-11-03T12:00:00+00:00'),
    ('c772b0f1-3e7e-4ee7-af93-391829670aa1'::uuid, timestamptz '2026-11-01T07:00:00.000Z', timestamptz '2026-11-01T08:00:00.000Z', timestamptz '2026-11-04T07:00:00+00:00'),
    ('d515f331-7630-4715-a890-e144abc3580a'::uuid, timestamptz '2026-10-31T07:00:00.000Z', timestamptz '2026-10-31T08:00:00.000Z', timestamptz '2026-11-03T07:00:00+00:00'),
    ('e05d6ccf-acea-44b8-8736-492d6760bbeb'::uuid, timestamptz '2026-10-25T07:00:00.000Z', timestamptz '2026-10-25T08:00:00.000Z', timestamptz '2026-10-28T07:00:00+00:00')
)
SELECT
  m.id,
  m.booking_id,
  m.meeting_status,
  m.start_time        AS now_starts,
  p.new_start         AS would_start,
  (p.old_start - p.new_start)             AS moved_back,
  m.start_time = p.old_start              AS still_where_we_measured
FROM public.scheduling_meetings AS m
JOIN planned AS p ON p.id = m.id
ORDER BY m.start_time;

/*
 * `still_where_we_measured` must be true on every row. A false means the row
 * moved after this was computed, so re-run the precheck rather than this.
 */

-- ─── STEP 2: THE REPAIR. Read step 1 first. SAVE THE OUTPUT. ────────────────

BEGIN;

WITH planned (id, new_start, new_end, old_start) AS (
  VALUES
    ('0c7ed805-379d-4d14-abc5-35357d0608b4'::uuid, timestamptz '2026-11-15T10:00:00.000Z', timestamptz '2026-11-15T11:00:00.000Z', timestamptz '2026-11-16T10:00:00+00:00'),
    ('1ce56b36-fb9b-4f9d-9d10-4ea52d495c98'::uuid, timestamptz '2026-11-01T11:00:00.000Z', timestamptz '2026-11-01T12:00:00.000Z', timestamptz '2026-11-03T11:00:00+00:00'),
    ('1f8cc28a-fdbe-4b84-a579-256b36bef2df'::uuid, timestamptz '2026-11-14T10:00:00.000Z', timestamptz '2026-11-14T11:00:00.000Z', timestamptz '2026-11-16T10:00:00+00:00'),
    ('38cdd806-74ea-492f-b12c-3565014b6881'::uuid, timestamptz '2026-11-22T10:00:00.000Z', timestamptz '2026-11-22T11:00:00.000Z', timestamptz '2026-11-23T10:00:00+00:00'),
    ('399a309b-1716-4d9d-9ef6-4ea1fd42089c'::uuid, timestamptz '2026-11-24T15:00:00.000Z', timestamptz '2026-11-24T16:00:00.000Z', timestamptz '2026-11-25T15:00:00+00:00'),
    ('43ee9c34-c30e-49ad-b076-774971ccde7e'::uuid, timestamptz '2026-11-16T09:00:00.000Z', timestamptz '2026-11-16T10:00:00.000Z', timestamptz '2026-11-17T09:00:00+00:00'),
    ('5457b24c-b9a8-4059-ba8f-e55b7cfacb21'::uuid, timestamptz '2026-11-04T10:00:00.000Z', timestamptz '2026-11-04T11:00:00.000Z', timestamptz '2026-11-05T10:00:00+00:00'),
    ('584bf54a-763b-4865-81a9-0568258f2560'::uuid, timestamptz '2026-11-21T10:00:00.000Z', timestamptz '2026-11-21T11:00:00.000Z', timestamptz '2026-11-23T10:00:00+00:00'),
    ('830e69ef-89d7-4d97-b471-60e7be654caa'::uuid, timestamptz '2026-11-16T08:00:00.000Z', timestamptz '2026-11-16T09:00:00.000Z', timestamptz '2026-11-19T08:00:00+00:00'),
    ('899ba9f9-9eaa-4e84-92e7-72c239155b81'::uuid, timestamptz '2026-11-01T10:00:00.000Z', timestamptz '2026-11-01T11:00:00.000Z', timestamptz '2026-11-03T10:00:00+00:00'),
    ('90b7782d-b751-45ad-8219-0b3ba89203bc'::uuid, timestamptz '2026-11-08T08:00:00.000Z', timestamptz '2026-11-08T09:00:00.000Z', timestamptz '2026-11-12T08:00:00+00:00'),
    ('a91ee82e-f2f5-438b-b9c4-ca369f021b12'::uuid, timestamptz '2026-11-02T07:00:00.000Z', timestamptz '2026-11-02T08:00:00.000Z', timestamptz '2026-11-03T07:00:00+00:00'),
    ('ba8bc768-218b-4d6b-a5b5-5459adb5b97b'::uuid, timestamptz '2026-11-29T10:00:00.000Z', timestamptz '2026-11-29T11:00:00.000Z', timestamptz '2026-11-30T10:00:00+00:00'),
    ('be11291f-29f7-4e06-9a3a-61085b32e1a2'::uuid, timestamptz '2026-11-01T12:00:00.000Z', timestamptz '2026-11-01T13:00:00.000Z', timestamptz '2026-11-03T12:00:00+00:00'),
    ('c772b0f1-3e7e-4ee7-af93-391829670aa1'::uuid, timestamptz '2026-11-01T07:00:00.000Z', timestamptz '2026-11-01T08:00:00.000Z', timestamptz '2026-11-04T07:00:00+00:00'),
    ('d515f331-7630-4715-a890-e144abc3580a'::uuid, timestamptz '2026-10-31T07:00:00.000Z', timestamptz '2026-10-31T08:00:00.000Z', timestamptz '2026-11-03T07:00:00+00:00'),
    ('e05d6ccf-acea-44b8-8736-492d6760bbeb'::uuid, timestamptz '2026-10-25T07:00:00.000Z', timestamptz '2026-10-25T08:00:00.000Z', timestamptz '2026-10-28T07:00:00+00:00')
)
UPDATE public.scheduling_meetings AS m
   SET start_time = p.new_start,
       end_time   = p.new_end
  FROM planned AS p
 WHERE m.id = p.id
   /* Refuses anything that has moved since this was measured. */
   AND m.start_time = p.old_start
RETURNING m.id, m.booking_id, p.old_start AS restored_to_if_undone, m.start_time AS now_starts;

COMMIT;

/*
 * Expect 17 rows. Fewer means some had already moved — re-run the precheck
 * and recompute before applying the migration.
 */

-- ─── STEP 3: UNDO. Puts every moved row back where it was. ──────────────────
--
-- BEGIN;
--
-- WITH planned (id, new_start, new_end, old_start) AS (
--   VALUES
--     ('00000000-0000-0000-0000-000000000000'::uuid, NULL::timestamptz, NULL::timestamptz, NULL::timestamptz)
--   -- paste the VALUES block from step 2 here
-- )
-- UPDATE public.scheduling_meetings AS m
--    SET start_time = p.old_start,
--        end_time   = p.old_start + (m.end_time - m.start_time)
--   FROM planned AS p
--  WHERE m.id = p.id
--    AND m.start_time = p.new_start;
--
-- COMMIT;
