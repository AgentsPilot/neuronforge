SET default_transaction_read_only = on;

WITH bucket_state AS (
  SELECT watched.bucket_id,
         storage.buckets.id AS found_id,
         storage.buckets.public AS is_public,
         storage.buckets.file_size_limit AS size_limit,
         storage.buckets.allowed_mime_types AS mime_types
  FROM (VALUES ('website-images')) AS watched (bucket_id)
  LEFT JOIN storage.buckets ON storage.buckets.id = watched.bucket_id
),
expected_types AS (
  SELECT ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[] AS mime_types
),
dropped_policies AS (
  SELECT dropped.policy_name, dropped.policy_order
  FROM (VALUES
    ('Users can upload website images', 1),
    ('Users can update their website images', 2),
    ('Users can delete their website images', 3),
    ('Website images are publicly readable', 4)
  ) AS dropped (policy_name, policy_order)
),
object_policies AS (
  SELECT pg_policies.policyname,
         pg_policies.cmd,
         COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, '') AS policy_text
  FROM pg_policies
  WHERE pg_policies.schemaname = 'storage'
    AND pg_policies.tablename = 'objects'
),
checks AS (
  SELECT 1000 AS sort_order,
         'C1 bucket website images exists' AS check_name,
         CASE WHEN bucket_state.found_id IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS result,
         CASE WHEN bucket_state.found_id IS NOT NULL THEN 'present' ELSE 'missing' END AS detail
  FROM bucket_state

  UNION ALL
  SELECT 1001,
         'C2 bucket website images still public',
         CASE WHEN COALESCE(bucket_state.is_public, false) THEN 'PASS' ELSE 'FAIL' END,
         'public ' || COALESCE(bucket_state.is_public::text, 'missing') || ' expected true'
  FROM bucket_state

  UNION ALL
  SELECT 1002,
         'C3 bucket website images size limit kept at 5242880',
         CASE WHEN bucket_state.size_limit = 5242880 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(bucket_state.size_limit::text, 'none') || ' found 5242880 expected'
  FROM bucket_state

  UNION ALL
  SELECT 1003,
         'C4 bucket website images types are exactly the four images with no svg',
         CASE WHEN bucket_state.mime_types IS NOT NULL
                   AND bucket_state.mime_types @> expected_types.mime_types
                   AND bucket_state.mime_types <@ expected_types.mime_types
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(bucket_state.mime_types::text, 'none') || ' found'
  FROM bucket_state
  CROSS JOIN expected_types

  UNION ALL
  SELECT 1100,
         'C5 policies naming website images',
         CASE WHEN (SELECT count(*) FROM object_policies
                    WHERE strpos(object_policies.policy_text, 'website-images') > 0) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*) FROM object_policies
          WHERE strpos(object_policies.policy_text, 'website-images') > 0)::text || ' found 0 expected'

  UNION ALL
  SELECT 1200 + dropped_policies.policy_order,
         'C6 policy gone ' || dropped_policies.policy_name,
         CASE WHEN EXISTS (SELECT 1 FROM object_policies
                           WHERE object_policies.policyname = dropped_policies.policy_name)
              THEN 'FAIL' ELSE 'PASS' END,
         CASE WHEN EXISTS (SELECT 1 FROM object_policies
                           WHERE object_policies.policyname = dropped_policies.policy_name)
              THEN 'still present' ELSE 'absent' END
  FROM dropped_policies

  UNION ALL
  SELECT 1300,
         'C7 policies on storage objects naming no bucket id',
         CASE WHEN (SELECT count(*) FROM object_policies
                    WHERE strpos(object_policies.policy_text, 'bucket_id') = 0) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(
           (SELECT string_agg(object_policies.policyname || ' ' || object_policies.cmd, ' AND NEXT ' ORDER BY object_policies.policyname)
            FROM object_policies
            WHERE strpos(object_policies.policy_text, 'bucket_id') = 0),
           'none'
         )

  UNION ALL
  SELECT 1400,
         'C8 rls still on storage objects',
         CASE WHEN COALESCE(
                (SELECT pg_class.relrowsecurity
                 FROM pg_class
                 JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
                 WHERE pg_namespace.nspname = 'storage'
                   AND pg_class.relname = 'objects'), false)
              THEN 'PASS' ELSE 'FAIL' END,
         'expected true'
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
