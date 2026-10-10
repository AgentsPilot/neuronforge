SET default_transaction_read_only = on;

WITH table_state AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND replace(pg_class.relname::text, chr(95), ' ') = 'business os boost purchases'
    AND pg_class.relkind = 'r'
),
planned_indexes AS (
  SELECT planned.index_words, planned.index_order
  FROM (VALUES
    ('business os boost purchases reconcile idx', 1),
    ('business os boost purchases receipt backfill idx', 2)
  ) AS planned (index_words, index_order)
),
table_indexes AS (
  SELECT pg_indexes.indexname::text AS index_name
  FROM pg_indexes
  WHERE pg_indexes.schemaname = 'public'
    AND replace(pg_indexes.tablename::text, chr(95), ' ') = 'business os boost purchases'
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 100,
         'Q1 business os boost purchases',
         CASE WHEN EXISTS (SELECT 1 FROM table_state) THEN 'exists' ELSE 'MISSING stop here' END

  UNION ALL
  SELECT 200 + planned_indexes.index_order,
         'Q2 index absent ' || planned_indexes.index_words,
         CASE WHEN EXISTS (SELECT 1 FROM pg_indexes
                           WHERE pg_indexes.schemaname = 'public'
                             AND replace(pg_indexes.indexname::text, chr(95), ' ') = planned_indexes.index_words)
              THEN 'NO it already exists stop here' ELSE 'yes' END
  FROM planned_indexes

  UNION ALL
  SELECT 300,
         'Q3 indexes on business os boost purchases',
         COALESCE((SELECT string_agg(table_indexes.index_name, ' AND ' ORDER BY table_indexes.index_name) FROM table_indexes), 'none')

  UNION ALL
  SELECT 400, 'Q4 rows in total',
         (SELECT count(*) FROM public.business_os_boost_purchases)::text

  UNION ALL
  SELECT 410, 'Q4 rows pending or awaiting payment',
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row
          WHERE purchase_row.status IN ('pending', 'awaiting' || chr(95) || 'payment'))::text

  UNION ALL
  SELECT 420, 'Q4 rows paid with no receipt link',
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row
          WHERE purchase_row.status = 'paid'
            AND purchase_row.receipt_url IS NULL)::text

  UNION ALL
  SELECT 430, 'Q4 rows disputed',
         (SELECT count(*) FROM public.business_os_boost_purchases AS purchase_row
          WHERE purchase_row.status = 'disputed')::text

  UNION ALL
  SELECT 900, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
