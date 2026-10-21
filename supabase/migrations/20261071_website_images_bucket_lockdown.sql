BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
WHERE id = 'website-images';

DO $$
DECLARE
  lockdown_offenders text;
  lockdown_bucket_rows bigint;
BEGIN
  lockdown_offenders := (
    SELECT string_agg(pg_policies.policyname, ', ' ORDER BY pg_policies.policyname)
    FROM pg_policies
    WHERE pg_policies.schemaname = 'storage'
      AND pg_policies.tablename = 'objects'
      AND (COALESCE(pg_policies.qual, '') || COALESCE(pg_policies.with_check, '')) LIKE '%website-images%'
  );
  IF lockdown_offenders IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Website images lockdown still sees these policies so nothing was applied: ' || lockdown_offenders;
  END IF;

  lockdown_bucket_rows := (
    SELECT count(*)
    FROM storage.buckets
    WHERE storage.buckets.id = 'website-images'
      AND storage.buckets.public
      AND storage.buckets.file_size_limit = 5242880
      AND storage.buckets.allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']::text[]
  );
  IF lockdown_bucket_rows <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Website images lockdown bucket row is missing, not public, not 5 MB, or its type list did not take so nothing was applied';
  END IF;
END
$$;

COMMIT;
