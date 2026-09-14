-- Make the reuse index usable as an ON CONFLICT target.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY
--
-- `20260925_user_media.sql` created the reuse index as a PARTIAL index:
--
--   CREATE UNIQUE INDEX ... ON user_media (user_id, source_ref)
--     WHERE source_ref IS NOT NULL;
--
-- and `UserMediaRepository.record()` upserts with
-- `onConflict: 'user_id,source_ref'`.
--
-- PostgreSQL cannot infer a partial index from a bare `ON CONFLICT (a, b)`. The
-- statement has to repeat the index predicate — `ON CONFLICT (a, b) WHERE b IS
-- NOT NULL` — and PostgREST sends only column names, so there is no way to say
-- that through supabase-js. Every insert therefore failed with "no unique or
-- exclusion constraint matching the ON CONFLICT specification".
--
-- `record()` swallows its own errors on purpose: the file is already uploaded
-- and already rendering by the time it runs, and losing the index row must not
-- fail a website build. So the failure was completely silent. Generation
-- reported success, the picture appeared on the page, and the library stayed
-- empty — which read as "the picker is broken" rather than "every insert is
-- being rejected".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY DROPPING THE PREDICATE IS SAFE
--
-- The predicate was there to let many rows carry a NULL `source_ref` — an
-- upload has no stock id and no prompt. But a unique index already permits
-- that: PostgreSQL treats NULLs as distinct, so any number of
-- `(user_id, NULL)` rows coexist without conflicting. The partial clause bought
-- nothing and cost every insert.
-- ─────────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_user_media_user_source_ref;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_media_user_source_ref
  ON user_media (user_id, source_ref);

COMMENT ON INDEX idx_user_media_user_source_ref IS
  'Reuse lookup, and the ON CONFLICT target for UserMediaRepository.record(). Deliberately NOT partial: a partial index cannot be inferred from a bare ON CONFLICT, which silently rejected every insert. Rows with a NULL source_ref never collide, because NULLs are distinct in a unique index.';
