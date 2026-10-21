SET default_transaction_read_only = on;

WITH storage_tables AS (
  SELECT watched.table_name,
         watched.table_order,
         pg_class.oid AS table_oid,
         pg_class.relrowsecurity AS rls_on,
         pg_roles.rolname AS owner_name
  FROM (VALUES ('objects', 1), ('buckets', 2)) AS watched (table_name, table_order)
  LEFT JOIN pg_namespace ON pg_namespace.nspname = 'storage'
  LEFT JOIN pg_class ON pg_class.relnamespace = pg_namespace.oid
                    AND pg_class.relname = watched.table_name
                    AND pg_class.relkind = 'r'
  LEFT JOIN pg_roles ON pg_roles.oid = pg_class.relowner
),
watched_buckets AS (
  SELECT watched.bucket_id, watched.bucket_order, watched.expected_policy_count
  FROM (VALUES ('avatars', 1, 8), ('website-images', 2, 4)) AS watched (bucket_id, bucket_order, expected_policy_count)
),
expected_policies AS (
  SELECT expected.policy_name, expected.bucket_id, expected.policy_cmd, expected.policy_order
  FROM (VALUES
    ('Users can upload avatars', 'avatars', 'INSERT', 1),
    ('Users can update avatars', 'avatars', 'UPDATE', 2),
    ('Users can delete avatars', 'avatars', 'DELETE', 3),
    ('Users can upload their own avatar', 'avatars', 'INSERT', 4),
    ('Users can update their own avatar', 'avatars', 'UPDATE', 5),
    ('Users can delete their own avatar', 'avatars', 'DELETE', 6),
    ('Avatar images are publicly accessible', 'avatars', 'SELECT', 7),
    ('Public can view avatars', 'avatars', 'SELECT', 8),
    ('Users can upload website images', 'website-images', 'INSERT', 11),
    ('Users can update their website images', 'website-images', 'UPDATE', 12),
    ('Users can delete their website images', 'website-images', 'DELETE', 13),
    ('Website images are publicly readable', 'website-images', 'SELECT', 14)
  ) AS expected (policy_name, bucket_id, policy_cmd, policy_order)
),
object_policies AS (
  SELECT pg_policies.policyname,
         pg_policies.cmd,
         COALESCE(pg_policies.qual, '') || ' ' || COALESCE(pg_policies.with_check, '') AS policy_text
  FROM pg_policies
  WHERE pg_policies.schemaname = 'storage'
    AND pg_policies.tablename = 'objects'
),
report AS (
  SELECT 0 AS sort_order,
         'READ ME' AS item,
         'this session is now read only so run the migration in a NEW tab' AS detail

  UNION ALL
  SELECT 100, 'LC8 current user', current_user::text

  UNION ALL
  SELECT 110 + storage_tables.table_order,
         'LC8 owner of storage ' || storage_tables.table_name,
         COALESCE(storage_tables.owner_name::text, 'MISSING stop here')
  FROM storage_tables

  UNION ALL
  SELECT 120 + storage_tables.table_order,
         'LC8 current user is a member of the owner of storage ' || storage_tables.table_name,
         CASE WHEN storage_tables.owner_name IS NULL THEN 'MISSING stop here'
              ELSE pg_has_role(current_user, storage_tables.owner_name, 'MEMBER')::text
         END
  FROM storage_tables

  UNION ALL
  SELECT 130, 'LC8 current user may UPDATE storage buckets',
         has_table_privilege(current_user, 'storage.buckets', 'UPDATE')::text

  UNION ALL
  SELECT 135, 'LC8 current user bypasses rls',
         (SELECT 'bypassrls ' || pg_roles.rolbypassrls::text || ' superuser ' || pg_roles.rolsuper::text
          FROM pg_roles
          WHERE pg_roles.rolname = current_user)

  UNION ALL
  SELECT 136, 'LK2 owner of public operator_test_account_cleanup bypasses rls expected true',
         COALESCE(
           (SELECT string_agg(
                     'owner ' || pg_roles.rolname::text
                       || ' bypassrls ' || pg_roles.rolbypassrls::text
                       || ' superuser ' || pg_roles.rolsuper::text
                       || ' security definer ' || pg_proc.prosecdef::text,
                     ' AND NEXT ' ORDER BY pg_roles.rolname)
            FROM pg_proc
            JOIN pg_namespace AS proc_namespace ON proc_namespace.oid = pg_proc.pronamespace
            JOIN pg_roles ON pg_roles.oid = pg_proc.proowner
            WHERE proc_namespace.nspname = 'public'
              AND pg_proc.proname = 'operator_test_account_cleanup'),
           'MISSING'
         )

  UNION ALL
  SELECT 140 + storage_tables.table_order,
         'LC8 rls on storage ' || storage_tables.table_name,
         COALESCE(storage_tables.rls_on::text, 'MISSING')
  FROM storage_tables

  UNION ALL
  SELECT 200 + watched_buckets.bucket_order,
         'B bucket ' || watched_buckets.bucket_id,
         COALESCE(
           (SELECT 'public ' || storage.buckets.public::text
                   || ' size ' || COALESCE(storage.buckets.file_size_limit::text, 'none')
                   || ' types ' || COALESCE(storage.buckets.allowed_mime_types::text, 'none')
            FROM storage.buckets
            WHERE storage.buckets.id = watched_buckets.bucket_id),
           'MISSING stop here'
         )
  FROM watched_buckets

  UNION ALL
  SELECT 300 + watched_buckets.bucket_order,
         'P policies naming ' || watched_buckets.bucket_id,
         (SELECT count(*) FROM object_policies
          WHERE strpos(object_policies.policy_text, watched_buckets.bucket_id) > 0)::text
           || ' found ' || watched_buckets.expected_policy_count::text || ' expected'
  FROM watched_buckets

  UNION ALL
  SELECT 400 + expected_policies.policy_order,
         'P present ' || expected_policies.policy_name,
         COALESCE(
           (SELECT 'yes ' || object_policies.cmd
                   || CASE WHEN object_policies.cmd = expected_policies.policy_cmd THEN ''
                           ELSE ' NOT ' || expected_policies.policy_cmd || ' stop here' END
                   || CASE WHEN strpos(object_policies.policy_text, expected_policies.bucket_id) > 0 THEN ''
                           ELSE ' names no ' || expected_policies.bucket_id || ' stop here' END
            FROM object_policies
            WHERE object_policies.policyname = expected_policies.policy_name),
           'NO record it'
         )
  FROM expected_policies

  UNION ALL
  SELECT 500, 'P policies naming a watched bucket that this slice does not list',
         COALESCE(
           (SELECT string_agg(object_policies.policyname, ' AND NEXT ' ORDER BY object_policies.policyname)
            FROM object_policies
            WHERE (strpos(object_policies.policy_text, 'avatars') > 0
                   OR strpos(object_policies.policy_text, 'website-images') > 0)
              AND NOT EXISTS (SELECT 1 FROM expected_policies
                              WHERE expected_policies.policy_name = object_policies.policyname)),
           'none'
         )

  UNION ALL
  SELECT 510, 'P policies on storage objects naming no bucket id',
         COALESCE(
           (SELECT string_agg(object_policies.policyname || ' ' || object_policies.cmd, ' AND NEXT ' ORDER BY object_policies.policyname)
            FROM object_policies
            WHERE strpos(object_policies.policy_text, 'bucket_id') = 0),
           'none'
         )

  UNION ALL
  SELECT 600 + watched_buckets.bucket_order,
         'O objects in ' || watched_buckets.bucket_id,
         (SELECT count(*) || ' objects largest ' || COALESCE(max((storage.objects.metadata ->> 'size')::bigint), 0)
                 || ' over 4 MB ' || count(*) FILTER (WHERE (storage.objects.metadata ->> 'size')::bigint > 4194304)
                 || ' over 5 MB ' || count(*) FILTER (WHERE (storage.objects.metadata ->> 'size')::bigint > 5242880)
                 || ' svg ' || count(*) FILTER (WHERE storage.objects.metadata ->> 'mimetype' = 'image/svg+xml')
          FROM storage.objects
          WHERE storage.objects.bucket_id = watched_buckets.bucket_id)
  FROM watched_buckets

  UNION ALL
  SELECT 700, 'O generated pictures in website images',
         (SELECT count(*) || ' objects largest ' || COALESCE(max((storage.objects.metadata ->> 'size')::bigint), 0)
                 || ' over 4 MB ' || count(*) FILTER (WHERE (storage.objects.metadata ->> 'size')::bigint > 4194304)
          FROM storage.objects
          WHERE storage.objects.bucket_id = 'website-images'
            AND strpos(storage.objects.name, '/generated/') > 0)

  UNION ALL
  SELECT 900, 'checked at utc', (now() AT TIME ZONE 'UTC')::text
)
SELECT report.sort_order, report.item, report.detail
FROM report
ORDER BY report.sort_order, report.item;
