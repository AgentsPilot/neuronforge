/*
 * CHECKER for 20261131_one_stripe_invoice_is_one_bill.sql
 *
 * Read-only. Run inside:
 *
 *     begin read only; <this file>; commit;
 *
 * Returns 5 rows. All four GATE rows must read `ok`. Before the apply, C-1
 * through C-4 must read `FAIL` — that is what proves the checker can detect
 * anything at all, and it is run once against the pre-apply state for exactly
 * that reason.
 *
 * Gates:
 *   C-1  the index exists, under the exact name the comment and the rollback
 *        both name.
 *   C-2  it is UNIQUE. A non-unique index of the same name would satisfy C-1
 *        and guarantee nothing, which is the failure worth catching.
 *   C-3  it is PARTIAL, and on the right predicate. Without checking the
 *        predicate this passes for an index over every row, which would be a
 *        different (larger) object than the one reviewed.
 *   C-4  it covers exactly `stripe_invoice_id`, and nothing else. A composite
 *        index on (user_id, stripe_invoice_id) would also be unique, also be
 *        partial, and would NOT stop the duplicate: two rows for one Stripe
 *        invoice under one owner is precisely the shape being prevented.
 *
 * Info (never a gate):
 *   C-5  the row counts, to compare against the pre-check's P-5. A unique index
 *        cannot change them; a difference means something else wrote in between.
 */

WITH
idx AS (
  SELECT
    i.indisunique,
    i.indpred IS NOT NULL AS is_partial,
    pg_get_expr(i.indpred, i.indrelid) AS predicate,
    pg_get_indexdef(i.indexrelid) AS def,
    (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
     FROM unnest(i.indkey) WITH ORDINALITY AS k(att, ord)
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.att) AS cols
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'payment_invoices_stripe_invoice_id_key'
    AND c.relnamespace = 'public'::regnamespace
),
c1 AS (
  SELECT
    'C-1' AS check,
    'GATE' AS kind,
    'the index exists' AS item,
    CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 1 THEN 'present' ELSE 'absent' END AS detail
  FROM idx
),
c2 AS (
  SELECT
    'C-2' AS check,
    'GATE' AS kind,
    'it is unique' AS item,
    CASE WHEN count(*) = 1 AND bool_and(indisunique) THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'index absent'
         WHEN bool_and(indisunique) THEN 'unique'
         ELSE 'NOT unique - guarantees nothing' END AS detail
  FROM idx
),
c3 AS (
  SELECT
    'C-3' AS check,
    'GATE' AS kind,
    'partial, on stripe_invoice_id IS NOT NULL' AS item,
    CASE WHEN count(*) = 1
           AND bool_and(is_partial)
           AND bool_and(predicate = '(stripe_invoice_id IS NOT NULL)')
         THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'index absent'
         WHEN NOT bool_and(is_partial) THEN 'not partial - covers every row'
         ELSE coalesce(min(predicate), 'none') END AS detail
  FROM idx
),
c4 AS (
  SELECT
    'C-4' AS check,
    'GATE' AS kind,
    'covers exactly stripe_invoice_id' AS item,
    CASE WHEN count(*) = 1 AND bool_and(cols = 'stripe_invoice_id') THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'index absent' ELSE coalesce(min(cols), 'none') END AS detail
  FROM idx
),
c5 AS (
  SELECT
    'C-5' AS check,
    'INFO' AS kind,
    'rows, unchanged by the apply' AS item,
    'ok' AS status,
    count(*) FILTER (WHERE stripe_invoice_id IS NOT NULL)::text || ' with an id, '
      || count(DISTINCT stripe_invoice_id)::text || ' distinct, '
      || count(*) FILTER (WHERE stripe_invoice_id IS NULL)::text || ' with none' AS detail
  FROM public.payment_invoices
)
SELECT * FROM c1
UNION ALL SELECT * FROM c2
UNION ALL SELECT * FROM c3
UNION ALL SELECT * FROM c4
UNION ALL SELECT * FROM c5
ORDER BY check;
