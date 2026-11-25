/*
 * CHECKER for 20261129_a_quote_put_back_on_the_table.sql
 *
 * Read-only. Run it inside:
 *
 *     begin read only; <this file>; commit;
 *
 * Returns exactly 6 rows. Every one must read `ok`.
 *
 * ── IT MUST BE ABLE TO FAIL ─────────────────────────────────────────────────
 * Run this once BEFORE the apply: C-1 to C-5 must read FAIL. A checker that is
 * already green cannot detect the apply, and is worth nothing. C-6 reads `ok`
 * either way by design — it is the informational row.
 */

WITH
cols AS (
  SELECT attname, format_type(atttypid, atttypmod) AS type, attnotnull
  FROM pg_attribute
  WHERE attrelid = 'public.proposals'::regclass
    AND NOT attisdropped
    AND attnum > 0
),
c1 AS (
  SELECT
    'C-1' AS check,
    'extended_at exists, as timestamptz, nullable' AS item,
    CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(max(type) || CASE WHEN bool_or(attnotnull) THEN ' NOT NULL' ELSE ' nullable' END, 'absent') AS detail
  FROM cols
  WHERE attname = 'extended_at'
    AND type = 'timestamp with time zone'
    AND NOT attnotnull
),
c2 AS (
  SELECT
    'C-2' AS check,
    'extended_from exists, as date, nullable' AS item,
    CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(max(type), 'absent') AS detail
  FROM cols
  WHERE attname = 'extended_from'
    AND type = 'date'
    AND NOT attnotnull
),
c3 AS (
  SELECT
    'C-3' AS check,
    'the extension constraint exists' AS item,
    CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(max(conname), 'absent') AS detail
  FROM pg_constraint
  WHERE conrelid = 'public.proposals'::regclass
    AND conname = 'proposals_extension_is_dated'
    AND contype = 'c'
),
c4 AS (
  SELECT
    'C-4' AS check,
    'the constraint is the extended_from-implies-extended_at rule' AS item,
    CASE
      WHEN count(*) = 1 THEN 'ok'
      ELSE 'FAIL'
    END AS status,
    coalesce(max(pg_get_constraintdef(oid)), 'absent') AS detail
  FROM pg_constraint
  WHERE conrelid = 'public.proposals'::regclass
    AND conname = 'proposals_extension_is_dated'
    AND pg_get_constraintdef(oid) ILIKE '%extended_from IS NULL%'
    AND pg_get_constraintdef(oid) ILIKE '%extended_at IS NOT NULL%'
),
c5 AS (
  SELECT
    'C-5' AS check,
    'both columns are documented' AS item,
    CASE WHEN count(*) = 2 THEN 'ok' ELSE 'FAIL' END AS status,
    count(*)::text || ' of 2 have a comment' AS detail
  FROM cols
  JOIN pg_description ON pg_description.objoid = 'public.proposals'::regclass
    AND pg_description.objsubid = (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = 'public.proposals'::regclass AND attname = cols.attname
    )
  WHERE cols.attname IN ('extended_at', 'extended_from')
    AND length(coalesce(pg_description.description, '')) > 0
),
c6 AS (
  SELECT
    'C-6' AS check,
    'extensions recorded so far (informational)' AS item,
    'ok' AS status,
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM cols WHERE attname = 'extended_at')
        THEN 'column absent, nothing to count'
      ELSE 'see C-1; count once the column exists'
    END AS detail
)
SELECT * FROM c1
UNION ALL SELECT * FROM c2
UNION ALL SELECT * FROM c3
UNION ALL SELECT * FROM c4
UNION ALL SELECT * FROM c5
UNION ALL SELECT * FROM c6
ORDER BY check;
