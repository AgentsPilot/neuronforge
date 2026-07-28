-- Migration: Create contact-documents storage bucket
-- Purpose: Storage bucket for CRM contact documents (contracts, intake forms, etc.)
-- Created: 2026-07-22

-- ============================================================================
-- CREATE STORAGE BUCKET
-- ============================================================================

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contact-documents',
  'contact-documents',
  false,  -- Private bucket
  52428800,  -- 50MB file size limit
  ARRAY[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'text/plain',
    'text/csv'
  ]::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- STORAGE POLICIES
-- ============================================================================

-- Drop existing policies if they exist (for idempotency)
DROP POLICY IF EXISTS "Users can upload documents to their folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;

-- Users can upload documents to their own folder
CREATE POLICY "Users can upload documents to their folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'contact-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can view their own documents
CREATE POLICY "Users can view their own documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'contact-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can update their own documents
CREATE POLICY "Users can update their own documents"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'contact-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Users can delete their own documents
CREATE POLICY "Users can delete their own documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'contact-documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON POLICY "Users can upload documents to their folder" ON storage.objects IS 'Allows users to upload documents to their user_id folder in contact-documents bucket';
COMMENT ON POLICY "Users can view their own documents" ON storage.objects IS 'Allows users to view/download their own documents';
COMMENT ON POLICY "Users can update their own documents" ON storage.objects IS 'Allows users to update/replace their own documents';
COMMENT ON POLICY "Users can delete their own documents" ON storage.objects IS 'Allows users to delete their own documents';
