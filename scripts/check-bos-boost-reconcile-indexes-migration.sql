SET default_transaction_read_only = on;

WITH expected_indexes AS (
  SELECT expected.index_words, expected.index_order, expected.column_words, expected.predicate_word_one, expected.predicate_word_two
  FROM (VALUES
    ('business os boost purchases reconcile idx', 1, 'checkout expires at', 'pending', 'awaiting'),
    ('business os boost purchases receipt backfill idx', 2, 'paid at', 'paid', 'receipt')
  ) AS expected (index_words, index_order, column_words, predicate_word_one, predicate_word_two)
),
public_indexes AS (
  SELECT index_class.oid AS index_oid,
         replace(index_class.relname::text, chr(95), ' ') AS index_words
  FROM pg_class AS index_class
  JOIN pg_namespace ON pg_namespace.oid = index_class.relnamespace
  WHERE pg_namespace.nspname = 'public'
    AND index_class.relkind = 'i'
),
index_state AS (
  SELECT expected_indexes.index_words,
         expected_indexes.index_order,
         expected_indexes.column_words,
         expected_indexes.predicate_word_one,
         expected_indexes.predicate_word_two,
         public_indexes.index_oid,
         pg_index.indisvalid AS is_valid,
         pg_index.indisready AS is_ready,
         pg_index.indnatts AS column_count,
         replace(table_class.relname::text, chr(95), ' ') AS table_words,
         CASE WHEN pg_index.indpred IS NULL THEN NULL
              ELSE pg_get_expr(pg_index.indpred, pg_index.indrelid)
         END AS predicate_text,
         (SELECT replace(pg_attribute.attname::text, chr(95), ' ')
          FROM pg_attribute
          WHERE pg_attribute.attrelid = pg_index.indrelid
            AND pg_attribute.attnum = pg_index.indkey[0]) AS first_column_words
  FROM expected_indexes
  LEFT JOIN public_indexes ON public_indexes.index_words = expected_indexes.index_words
  LEFT JOIN pg_index ON pg_index.indexrelid = public_indexes.index_oid
  LEFT JOIN pg_class AS table_class ON table_class.oid = pg_index.indrelid
),
checks AS (
  SELECT 1000 + index_state.index_order * 10 AS sort_order,
         'C1 index exists ' || index_state.index_words AS check_name,
         CASE WHEN index_state.index_oid IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN index_state.index_oid IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM index_state

  UNION ALL
  SELECT 1001 + index_state.index_order * 10,
         'C2 on business os boost purchases ' || index_state.index_words,
         CASE WHEN index_state.table_words = 'business os boost purchases' THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(index_state.table_words, 'none')
  FROM index_state

  UNION ALL
  SELECT 1002 + index_state.index_order * 10,
         'C3 valid and ready ' || index_state.index_words,
         CASE WHEN COALESCE(index_state.is_valid, false) AND COALESCE(index_state.is_ready, false) THEN 'PASS' ELSE 'FAIL' END,
         'valid ' || COALESCE(index_state.is_valid::text, 'none') || ' ready ' || COALESCE(index_state.is_ready::text, 'none')
  FROM index_state

  UNION ALL
  SELECT 1003 + index_state.index_order * 10,
         'C4 one column ' || index_state.column_words || ' ' || index_state.index_words,
         CASE WHEN index_state.column_count = 1 AND index_state.first_column_words = index_state.column_words THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(index_state.column_count::text, 'none') || ' columns first ' || COALESCE(index_state.first_column_words, 'none')
  FROM index_state

  UNION ALL
  SELECT 1004 + index_state.index_order * 10,
         'C5 partial ' || index_state.index_words,
         CASE WHEN index_state.predicate_text IS NOT NULL
                   AND strpos(index_state.predicate_text, index_state.predicate_word_one) > 0
                   AND strpos(index_state.predicate_text, index_state.predicate_word_two) > 0
              THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN index_state.predicate_text IS NULL THEN 'no predicate'
              ELSE 'names ' || index_state.predicate_word_one || ' and ' || index_state.predicate_word_two
         END
  FROM index_state
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result <> 'PASS') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result <> 'PASS') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order;
