SET default_transaction_read_only = on;

WITH submit_function AS (
  SELECT to_regprocedure('public.ai_price_submit_pending(uuid, text, jsonb, jsonb)') AS function_oid
),
submit_proc AS (
  SELECT pg_proc.oid, pg_proc.prosecdef, pg_proc.proconfig, pg_proc.prosrc, pg_proc.proacl
  FROM pg_proc JOIN submit_function ON pg_proc.oid = submit_function.function_oid
),
checks AS (
  SELECT 100 AS sort_order, 'S1 submit function exists' AS check_name,
         CASE WHEN (SELECT submit_function.function_oid FROM submit_function) IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         coalesce((SELECT submit_function.function_oid::text FROM submit_function), 'missing') AS detail
  UNION ALL
  SELECT 101, 'S1 submit function is security invoker',
         CASE WHEN (SELECT NOT submit_proc.prosecdef FROM submit_proc) THEN 'PASS' ELSE 'FAIL' END,
         'not security definer'
  UNION ALL
  SELECT 102, 'S1 submit function has an empty search path',
         CASE WHEN (SELECT submit_proc.proconfig = ARRAY['search_path=""'] FROM submit_proc) THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT array_to_string(submit_proc.proconfig, ' ') FROM submit_proc), 'none')
  UNION ALL
  SELECT 103, 'S1 submit function result is the slice 3 table',
         CASE WHEN (SELECT pg_get_function_result(submit_proc.oid) FROM submit_proc)
                   = 'TABLE(out_proposal_id uuid, out_line_id uuid, out_line_index integer, out_superseded_line_id uuid)'
              THEN 'PASS' ELSE 'FAIL' END,
         coalesce((SELECT pg_get_function_result(submit_proc.oid) FROM submit_proc), 'missing')
  UNION ALL
  SELECT 200, 'S2 service_role can execute the submit function',
         CASE WHEN (SELECT has_function_privilege('service_role', submit_proc.oid, 'EXECUTE') FROM submit_proc)
              THEN 'PASS' ELSE 'FAIL' END,
         'execute held'
  UNION ALL
  SELECT 201, 'S2 anon and authenticated cannot execute the submit function',
         CASE WHEN (SELECT NOT has_function_privilege('anon', submit_proc.oid, 'EXECUTE')
                       AND NOT has_function_privilege('authenticated', submit_proc.oid, 'EXECUTE')
                    FROM submit_proc)
              THEN 'PASS' ELSE 'FAIL' END,
         'anon and authenticated refused'
  UNION ALL
  SELECT 202, 'S2 no PUBLIC entry on the submit function',
         CASE WHEN EXISTS (SELECT 1 FROM submit_proc WHERE submit_proc.proacl IS NOT NULL)
               AND NOT EXISTS (SELECT 1 FROM submit_proc CROSS JOIN LATERAL aclexplode(submit_proc.proacl) AS acl_entry
                               WHERE acl_entry.grantee = 0)
              THEN 'PASS' ELSE 'FAIL' END,
         'explicit grants only'
  UNION ALL
  SELECT 300, 'S3 the new body is live and writes the cross check columns',
         CASE WHEN (SELECT position('cross_check_verdict' IN submit_proc.prosrc) > 0
                       AND position('cross_check_diff_pct' IN submit_proc.prosrc) > 0
                    FROM submit_proc)
              THEN 'PASS' ELSE 'FAIL' END,
         'cross_check_verdict and cross_check_diff_pct named'
  UNION ALL
  SELECT 301, 'S3 the body never names a live price table',
         CASE WHEN (SELECT position('ai_model_pricing' IN submit_proc.prosrc) = 0
                       AND position('ai_model_image_pricing' IN submit_proc.prosrc) = 0
                    FROM submit_proc)
              THEN 'PASS' ELSE 'FAIL' END,
         'pending only writes'
)
SELECT report.check_name, report.result, report.detail
FROM (
  SELECT 0 AS sort_order,
         'VERDICT' AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM checks WHERE checks.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM checks WHERE checks.result = 'FAIL') || ' fail' AS detail
  UNION ALL
  SELECT checks.sort_order, checks.check_name, checks.result, checks.detail FROM checks
) AS report
ORDER BY report.sort_order, report.check_name;
