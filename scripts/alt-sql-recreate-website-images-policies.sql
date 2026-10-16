BEGIN;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Users can upload website images" ON storage.objects;
CREATE POLICY "Users can upload website images" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'website-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

DROP POLICY IF EXISTS "Users can update their website images" ON storage.objects;
CREATE POLICY "Users can update their website images" ON storage.objects AS PERMISSIVE FOR UPDATE TO authenticated USING (((bucket_id = 'website-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

DROP POLICY IF EXISTS "Users can delete their website images" ON storage.objects;
CREATE POLICY "Users can delete their website images" ON storage.objects AS PERMISSIVE FOR DELETE TO authenticated USING (((bucket_id = 'website-images'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

DROP POLICY IF EXISTS "Website images are publicly readable" ON storage.objects;
CREATE POLICY "Website images are publicly readable" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'website-images'::text));

COMMIT;
