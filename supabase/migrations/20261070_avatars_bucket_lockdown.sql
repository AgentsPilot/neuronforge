BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE storage.buckets
SET file_size_limit = 4194304,
    allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
WHERE id = 'avatars';

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
      AND (COALESCE(pg_policies.qual, '') || COALESCE(pg_policies.with_check, '')) LIKE '%avatars%'
  );
  IF lockdown_offenders IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'Avatars lockdown still sees these policies so nothing was applied: ' || lockdown_offenders;
  END IF;

  lockdown_bucket_rows := (
    SELECT count(*)
    FROM storage.buckets
    WHERE storage.buckets.id = 'avatars'
      AND storage.buckets.public
      AND storage.buckets.file_size_limit = 4194304
      AND storage.buckets.allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
  );
  IF lockdown_bucket_rows <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'Avatars lockdown bucket row is missing, not public, or its limits did not take so nothing was applied';
  END IF;
END
$$;

COMMIT;
