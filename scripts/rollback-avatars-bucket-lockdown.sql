BEGIN;

SET LOCAL lock_timeout = '5s';

UPDATE storage.buckets
SET file_size_limit = NULL,
    allowed_mime_types = NULL
WHERE id = 'avatars';

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
        'Users can upload avatars',
        'Users can update avatars',
        'Users can delete avatars',
        'Users can upload their own avatar',
        'Users can update their own avatar',
        'Users can delete their own avatar',
        'Avatar images are publicly accessible',
        'Public can view avatars'
      )
  );
  IF rollback_restored <> 8 THEN
    RAISE EXCEPTION USING MESSAGE = 'Avatars rollback did not restore all eight policies so nothing was applied';
  END IF;
END
$$;

COMMIT;
