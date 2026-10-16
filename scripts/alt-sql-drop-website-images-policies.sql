BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Users can upload website images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their website images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their website images" ON storage.objects;
DROP POLICY IF EXISTS "Website images are publicly readable" ON storage.objects;

COMMIT;
