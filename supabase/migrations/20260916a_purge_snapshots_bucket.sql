-- Migration: the pre-purge snapshot bucket
-- Purpose: somewhere to write the forensic record of what a purge deleted,
--          BEFORE it deletes it.
-- Created: 2026-09-16
-- Slice:   2 (Reset)
-- Requirement: §10.7, SA-4, AC-36
--
-- ============================================================================
-- ✅ SAFE TO APPLY NOW — this is the one purge migration that does NOT wait on
--    the service_role key rotation.
-- ============================================================================
-- It creates a storage bucket and grants nothing. Contrast
-- `supabase/held/20260916b_purge_business_data.sql` — kept out of this directory
-- on purpose — which MUST NOT be applied until the key
-- is rotated: that one creates a function which, reachable through PostgREST
-- with a published service_role key, becomes a remote "delete any business"
-- endpoint. This file has no such property — an attacker gains nothing from the
-- existence of an empty private bucket.
--
-- ============================================================================
-- HOW TO RUN IT, AND WHAT ACTUALLY RAN
-- ============================================================================
-- Run in the Supabase dashboard → SQL Editor. Verified 2026-09-16: the INSERT
-- below EXECUTES CLEANLY from the SQL-editor role, and is how the live bucket
-- was created.
--
-- An earlier draft of this file also contained `COMMENT ON TABLE storage.buckets`
-- and `DROP POLICY ... ON storage.objects`. The COMMENT failed with:
--
--     ERROR: 42501: must be owner of table buckets
--
-- because `storage.buckets` is owned by `supabase_storage_admin`, not by the
-- SQL-editor role. Both statements have been removed rather than guarded:
--
--   * The COMMENT was decoration. Its content is this header.
--   * The DROP POLICY statements were attempting to guarantee "no policy
--     exists" by removing policies that were never created. That is the wrong
--     instrument — the guarantee comes from never creating one, and it is now
--     CHECKED by the assertion at the bottom of this file, which reads
--     `pg_policies` (a system view any role may read) instead of requiring
--     ownership to drop from it.
--
-- A migration that errors halfway is worse than a verbose one, because the
-- operator is left guessing which statements landed.
--
-- ============================================================================
-- WHY THIS BUCKET HAS NO RLS POLICY, AND THAT IS THE POINT
-- ============================================================================
-- The two existing content buckets (`contact-documents`, `website-images`)
-- each carry policies of the form
--     (storage.foldername(name))[1] = auth.uid()::text
-- so a signed-in user can reach their own folder from the browser.
--
-- This bucket deliberately gets NONE of that. No policy for `anon` or
-- `authenticated`, for any verb. Only the service role — which bypasses RLS —
-- can read or write it, and no route exposes its contents.
--
-- The reason is what the snapshot contains: a complete row-level copy of a
-- business's CRM contacts, messages, invoices and bookings, assembled at the
-- one moment that data is about to stop existing anywhere else. It is the
-- highest-value object this system ever writes. A policy granting the owner
-- read access would sound reasonable and be wrong — it would make the snapshot
-- reachable with a stolen session, and no product flow needs to fetch it.
--
-- AC-36 verified empirically against the live bucket, 2026-09-16:
--     write (service role)      -> 200
--     read back (service role)  -> 200, byte-identical
--     read with the anon key    -> 400 denied
--     public object URL         -> 400 denied
--
-- ============================================================================
-- RETENTION
-- ============================================================================
-- SA-4 requires short retention WITH A SHIPPED ENFORCER, or a no-PII snapshot
-- on the customer path. Slice 2 is the internal surface only, so the full row
-- dump is in scope here — but the enforcer must ship with, or before, the
-- customer surface (slice 5).
--
-- The enforcer must NOT be hosted on `/api/auth/cleanup-incomplete`: that route
-- returns 500 before doing any work while CRON_SECRET is unset, so a retention
-- job living there would silently never have run, from day one.

-- ============================================================================
-- BUCKET
-- ============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'business-purge-snapshots',
  'business-purge-snapshots',
  false,                       -- PRIVATE. Never flip this.
  524288000,                   -- 500MB: a large business's full row dump
  ARRAY['application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- ASSERTION — the absence of policies is the control, so verify it
-- ============================================================================
-- Read-only: `pg_policies` is a system view, so this needs no ownership and
-- runs cleanly from the SQL editor. It fails loudly if anyone has added a
-- policy that could expose snapshots to `anon` or `authenticated`.
--
-- Storage policies are written against `storage.objects` as a whole rather than
-- per bucket, so this looks for any policy whose definition mentions this
-- bucket by name — which is how such a policy would have to be written.
DO $$
DECLARE
  v_offenders text;
BEGIN
  SELECT string_agg(policyname, ', ')
    INTO v_offenders
    FROM pg_policies
   WHERE schemaname = 'storage'
     AND tablename  = 'objects'
     AND (COALESCE(qual, '') || COALESCE(with_check, '')) LIKE '%business-purge-snapshots%';

  IF v_offenders IS NOT NULL THEN
    RAISE EXCEPTION
      'AC-36 violated: policy/policies reference the snapshot bucket (%). This bucket must be service-role only — see the header of this migration.',
      v_offenders;
  END IF;

  RAISE NOTICE 'business-purge-snapshots: no storage policies reference this bucket (correct).';
END;
$$;
