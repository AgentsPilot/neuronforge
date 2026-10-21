BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']::text[]
WHERE id = 'website-images';

DO $$
DECLARE
  rollback_restored bigint;
BEGIN
  rollback_restored := (
    SELECT count(*)
    FROM pg_policies
    WHERE pg_policies.schemaname = 'storage'
      AND pg_policies.tablename = 'objects'
      AND pg_policies.policyname IN (
        'Users can upload website images',
        'Users can update their website images',
        'Users can delete their website images',
        'Website images are publicly readable'
      )
  );
  IF rollback_restored <> 4 THEN
    RAISE EXCEPTION USING MESSAGE = 'Website images rollback did not restore all four policies so nothing was applied';
  END IF;
END
$$;

COMMIT;
