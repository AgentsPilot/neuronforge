SET default_transaction_read_only = on;

WITH billing_table AS (
  SELECT pg_class.oid AS table_oid
  FROM pg_class
  JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND pg_class.relname = 'billing_events'
),
report AS (
  SELECT 1 AS sort_order,
         'table exists' AS item,
         CASE WHEN EXISTS (SELECT 1 FROM billing_table) THEN 'yes' ELSE 'no' END AS detail

  UNION ALL
  SELECT 2,
         'trigger ' || pg_trigger.tgname::text,
         'function ' || trigger_function.proname::text
           || ' enabled ' || pg_trigger.tgenabled::text
           || ' definition ' || pg_get_triggerdef(pg_trigger.oid)
  FROM pg_trigger
  JOIN billing_table ON billing_table.table_oid = pg_trigger.tgrelid
  JOIN pg_proc AS trigger_function ON trigger_function.oid = pg_trigger.tgfoid
  WHERE NOT pg_trigger.tgisinternal

  UNION ALL
  SELECT 3,
         'trigger count',
         (SELECT count(*)
          FROM pg_trigger
          JOIN billing_table ON billing_table.table_oid = pg_trigger.tgrelid
          WHERE NOT pg_trigger.tgisinternal)::text

  UNION ALL
  SELECT 4,
         'function ' || function_schema.nspname::text || ' ' || pg_proc.proname::text,
         'security definer ' || pg_proc.prosecdef::text
           || ' language ' || function_language.lanname::text
           || ' arguments ' || pg_get_function_identity_arguments(pg_proc.oid)
  FROM pg_proc
  JOIN pg_namespace AS function_schema ON function_schema.oid = pg_proc.pronamespace
  JOIN pg_language AS function_language ON function_language.oid = pg_proc.prolang
  WHERE strpos(lower(pg_proc.prosrc), 'billing_events') > 0
    AND function_schema.nspname NOT IN ('pg_catalog', 'information_schema')

  UNION ALL
  SELECT 5,
         'function count',
         (SELECT count(*)
          FROM pg_proc
          JOIN pg_namespace AS function_schema ON function_schema.oid = pg_proc.pronamespace
          WHERE strpos(lower(pg_proc.prosrc), 'billing_events') > 0
            AND function_schema.nspname NOT IN ('pg_catalog', 'information_schema'))::text

  UNION ALL
  SELECT 9, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
