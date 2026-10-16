SET default_transaction_read_only = on;

WITH object_policies AS (
  SELECT pg_policies.policyname,
         pg_policies.permissive,
         pg_policies.cmd,
         pg_policies.roles,
         pg_policies.qual,
         pg_policies.with_check
  FROM pg_policies
  WHERE pg_policies.schemaname = 'storage'
    AND pg_policies.tablename = 'objects'
),
report AS (
  SELECT 100 AS sort_order,
         'policy' AS kind,
         object_policies.policyname AS name,
         object_policies.permissive AS permissive,
         object_policies.cmd AS cmd,
         object_policies.roles::text AS roles,
         COALESCE(object_policies.qual, 'none') AS qual,
         COALESCE(object_policies.with_check, 'none') AS with_check,
         'CREATE POLICY ' || quote_ident(object_policies.policyname)
           || ' ON storage.objects AS ' || object_policies.permissive
           || ' FOR ' || object_policies.cmd
           || ' TO ' || array_to_string(object_policies.roles, ', ')
           || COALESCE(' USING (' || object_policies.qual || ')', '')
           || COALESCE(' WITH CHECK (' || object_policies.with_check || ')', '') AS rollback_statement
  FROM object_policies

  UNION ALL
  SELECT 200,
         'bucket',
         storage.buckets.id,
         'public ' || storage.buckets.public::text,
         'size ' || COALESCE(storage.buckets.file_size_limit::text, 'none'),
         'types ' || COALESCE(storage.buckets.allowed_mime_types::text, 'none'),
         'updated ' || COALESCE(storage.buckets.updated_at::text, 'none'),
         'none',
         'UPDATE storage.buckets SET file_size_limit = '
           || COALESCE(storage.buckets.file_size_limit::text, 'NULL')
           || ', allowed_mime_types = '
           || COALESCE(quote_literal(storage.buckets.allowed_mime_types::text) || '::text[]', 'NULL')
           || ' WHERE id = ' || quote_literal(storage.buckets.id)
  FROM storage.buckets
  WHERE storage.buckets.id IN ('avatars', 'website-images')

  UNION ALL
  SELECT 900, 'captured at utc', (now() AT TIME ZONE 'UTC')::text, 'none', 'none', 'none', 'none', 'none', 'none'
)
SELECT report.kind, report.name, report.permissive, report.cmd, report.roles, report.qual, report.with_check, report.rollback_statement
FROM report
ORDER BY report.sort_order, report.name;
