-- Fix RLS policies for website-images bucket
-- Drop existing policies if they exist and recreate them

-- First ensure the bucket exists
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'website-images',
  'website-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload website images" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their website images" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their website images" ON storage.objects;
DROP POLICY IF EXISTS "Website images are publicly readable" ON storage.objects;

-- Recreate RLS policies
-- Upload policy: user can upload to their own folder (user_id/...)
CREATE POLICY "Users can upload website images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'website-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Update policy: user can update files in their folder
CREATE POLICY "Users can update their website images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'website-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Delete policy: user can delete files in their folder
CREATE POLICY "Users can delete their website images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'website-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Public read policy: anyone can view website images
CREATE POLICY "Website images are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'website-images');
