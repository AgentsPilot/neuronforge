-- When a page's copy was last written for this business.
--
-- Nothing recorded it, so there was no way to tell a page that has NEVER been
-- written from one whose copy somebody has since edited. That distinction is
-- what decides whether regenerating is safe: generation deletes every block on
-- the page and rebuilds it, so running it over an edited site destroys the
-- owner's work.
--
-- Not inferred from `template_id`: that column is about to start being written
-- on generation for unrelated reasons, and overloading it would make "has a
-- template" mean "has been written", which is not the same thing and would go
-- wrong the first time somebody only swapped a theme.
--
-- NULL means never generated — true for every existing page, which is correct:
-- pages built by the page-create route carry the static English scaffold, not
-- generated copy, and are exactly the ones that should be written on request.

ALTER TABLE website_pages
  ADD COLUMN IF NOT EXISTS content_generated_at TIMESTAMPTZ;

COMMENT ON COLUMN website_pages.content_generated_at IS
  'When AI last wrote this page''s content. NULL means never — the page holds the static scaffold, and generating is safe. Non-null means regenerating would replace copy the business may have edited, so it must be asked for explicitly.';
