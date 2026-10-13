-- Migration: let `contact-documents` accept a scan and a phone photo
-- Purpose: attaching a scanned TIFF to a proposal failed with "Failed to upload file"
-- Created: 2026-10-13
--
-- ============================================================================
-- WHY
-- ============================================================================
--
-- The bucket was created (20260722) with an allow-list that covers PDFs, Office
-- documents, JPEG/PNG/GIF/WebP and text. Two formats that matter were missing:
--
--   image/tiff            what a desk scanner produces. Attaching a scanned
--                         quote to a proposal is exactly what the attachment
--                         field asks for, and it was refused.
--
--   image/heic, image/heif  what an iPhone camera produces by default. A
--                         business photographing a document on their phone is
--                         the most likely upload there is, and every one of
--                         them was turned away.
--
-- The refusal happened inside Supabase Storage, several steps after the request
-- was accepted, and surfaced as a 500 reading "Failed to upload file" — which
-- says nothing about the file's TYPE being the problem. The route now checks
-- the type up front and answers with a message that names it; this migration is
-- the other half, because an app-level check that allows a format the bucket
-- still refuses just moves the same failure one step later.
--
-- NOTE ON THE APPLICATION CODE: `createBucket`'s `allowedMimeTypes` applies at
-- CREATION only. The bucket already exists, so widening the list in TypeScript
-- changes nothing by itself — this statement is what updates the live bucket.
--
-- ============================================================================
-- THE CHANGE
-- ============================================================================
--
-- Idempotent, and additive: the existing entries are kept exactly as they are
-- and only the missing ones are appended, so re-running this is a no-op and no
-- format that works today stops working.
--
-- `allowed_mime_types IS NOT NULL` is deliberate. In Supabase a NULL list means
-- "no restriction"; replacing that with a three-element array would TIGHTEN a
-- bucket that currently accepts everything. If some environment has it NULL,
-- leaving it alone is the correct answer.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY(
  SELECT DISTINCT unnest(
    allowed_mime_types || ARRAY['image/tiff', 'image/heic', 'image/heif']::text[]
  )
)
WHERE id = 'contact-documents'
  AND allowed_mime_types IS NOT NULL;
