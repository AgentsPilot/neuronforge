/*
 * PRE-CHECK for 20261131_one_stripe_invoice_is_one_bill.sql
 *
 * Read-only. Proves the migration can succeed before anything is applied. Run
 * inside:
 *
 *     begin read only; <this file>; commit;
 *
 * Every GATE row must read `ok`. P-3 is the one that matters: a unique index
 * over data that already contains a duplicate fails, and because the migration
 * is a single transaction that failure is clean — but it is better refused here
 * with the offending ids named than discovered from an error message.
 *
 * Gates:
 *   P-1  `payment_invoices` exists.
 *   P-2  `stripe_invoice_id` exists on it, and is text.
 *   P-3  NO duplicate non-null `stripe_invoice_id` exists. Names them if any do.
 *   P-4  the index name is free, so this is creating and not colliding with
 *        something another branch landed.
 *
 * Info (never a gate):
 *   P-5  how many rows carry an id, and how many distinct — the before-figure
 *        the checker is compared against.
 */

WITH
p1 AS (
  SELECT
    'P-1' AS check,
    'GATE' AS kind,
    'payment_invoices exists' AS item,
    CASE WHEN to_regclass('public.payment_invoices') IS NOT NULL THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(to_regclass('public.payment_invoices')::text, 'absent') AS detail
),
p2 AS (
  SELECT
    'P-2' AS check,
    'GATE' AS kind,
    'stripe_invoice_id exists and is text' AS item,
    CASE WHEN count(*) = 1 AND min(format_type(atttypid, atttypmod)) = 'text'
         THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(min(format_type(atttypid, atttypmod)), 'column absent') AS detail
  FROM pg_attribute
  WHERE attrelid = 'public.payment_invoices'::regclass
    AND NOT attisdropped
    AND attnum > 0
    AND attname = 'stripe_invoice_id'
),
dups AS (
  SELECT stripe_invoice_id, count(*) AS n
  FROM public.payment_invoices
  WHERE stripe_invoice_id IS NOT NULL
  GROUP BY stripe_invoice_id
  HAVING count(*) > 1
),
p3 AS (
  SELECT
    'P-3' AS check,
    'GATE' AS kind,
    'no duplicate stripe_invoice_id' AS item,
    CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'none - the unique index will build'
         ELSE count(*)::text || ' duplicated id(s), settle by hand first: '
              || string_agg(stripe_invoice_id || ' x' || n::text, ', ' ORDER BY stripe_invoice_id) END AS detail
  FROM dups
),
p4 AS (
  SELECT
    'P-4' AS check,
    'GATE' AS kind,
    'index name is free' AS item,
    CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'free' ELSE 'already exists' END AS detail
  FROM pg_class
  WHERE relname = 'payment_invoices_stripe_invoice_id_key'
    AND relnamespace = 'public'::regnamespace
),
p5 AS (
  SELECT
    'P-5' AS check,
    'INFO' AS kind,
    'rows carrying a Stripe invoice id' AS item,
    'ok' AS status,
    count(*) FILTER (WHERE stripe_invoice_id IS NOT NULL)::text || ' with an id, '
      || count(DISTINCT stripe_invoice_id)::text || ' distinct, '
      || count(*) FILTER (WHERE stripe_invoice_id IS NULL)::text || ' with none' AS detail
  FROM public.payment_invoices
)
SELECT * FROM p1
UNION ALL SELECT * FROM p2
UNION ALL SELECT * FROM p3
UNION ALL SELECT * FROM p4
UNION ALL SELECT * FROM p5
ORDER BY check;
