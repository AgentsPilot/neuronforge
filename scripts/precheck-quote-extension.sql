/*
 * PRE-CHECK for 20261129_a_quote_put_back_on_the_table.sql
 *
 * Read-only. Proves the shape the migration expects before anything is applied.
 * Every row must read `ok`. Run it inside:
 *
 *     begin read only; <this file>; commit;
 *
 * What it establishes:
 *   P-1  `proposals` exists at all.
 *   P-2  neither column is already there, so the migration is adding and not
 *        colliding with something another branch landed.
 *   P-3  the constraint name is free.
 *   P-4  `valid_until` is still a DATE, because `extended_from` is declared to
 *        match it and a type drift here would make the pair incomparable.
 *   P-5  how many quotes exist, and how many have ever lapsed, so the apply has
 *        a before-figure to compare against. Informational, never a gate.
 */

WITH
p1 AS (
  SELECT
    'P-1' AS check,
    'proposals table exists' AS item,
    CASE WHEN to_regclass('public.proposals') IS NOT NULL THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(to_regclass('public.proposals')::text, 'absent') AS detail
),
p2 AS (
  SELECT
    'P-2' AS check,
    'neither column exists yet' AS item,
    CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'absent, as expected'
         ELSE 'already present: ' || string_agg(attname, ', ' ORDER BY attname) END AS detail
  FROM pg_attribute
  WHERE attrelid = 'public.proposals'::regclass
    AND NOT attisdropped
    AND attnum > 0
    AND attname IN ('extended_at', 'extended_from')
),
p3 AS (
  SELECT
    'P-3' AS check,
    'constraint name is free' AS item,
    CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'free' ELSE 'taken' END AS detail
  FROM pg_constraint
  WHERE conrelid = 'public.proposals'::regclass
    AND conname = 'proposals_extension_is_dated'
),
p4 AS (
  SELECT
    'P-4' AS check,
    'valid_until is a date' AS item,
    CASE WHEN format_type(atttypid, atttypmod) = 'date' THEN 'ok' ELSE 'FAIL' END AS status,
    format_type(atttypid, atttypmod) AS detail
  FROM pg_attribute
  WHERE attrelid = 'public.proposals'::regclass
    AND NOT attisdropped
    AND attname = 'valid_until'
),
p5 AS (
  SELECT
    'P-5' AS check,
    'quotes on the account, and how many ever lapsed' AS item,
    'ok' AS status,
    count(*)::text || ' quotes, ' || count(*) FILTER (WHERE status = 'expired')::text || ' currently expired' AS detail
  FROM public.proposals
)
SELECT * FROM p1
UNION ALL SELECT * FROM p2
UNION ALL SELECT * FROM p3
UNION ALL SELECT * FROM p4
UNION ALL SELECT * FROM p5
ORDER BY check;
