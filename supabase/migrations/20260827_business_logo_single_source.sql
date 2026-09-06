-- Business logo — one column, owned by the business profile
-- Last Updated: 2026-08-27
--
-- WHY
--
-- The logo lived in `invoice_logo_url`, a column named for invoices that seven
-- non-invoice surfaces already read: every transactional email, the booking
-- management and intake pages, and the public smart-link pages. Nothing in the
-- product ever wrote it — the only upload point was the website setup wizard,
-- which stored the logo inside a website header block instead — and saving
-- invoice settings set it back to NULL on every save.
--
-- So the logo is a property of the business, held once, read from here by
-- everything. The website, landing pages and smart links each get a flag for
-- whether to show it; none of them keeps its own copy of the image.

-- =============================================
-- 1. THE COLUMN
-- =============================================
-- A rename rather than a new column: there is one logo, and two would need a
-- precedence rule at every one of those seven surfaces. Renaming also carries
-- any existing value across untouched.

ALTER TABLE business_profiles
  RENAME COLUMN invoice_logo_url TO logo_url;

COMMENT ON COLUMN business_profiles.logo_url IS
  'The business''s logo. The single source for invoices, PDFs, emails, booking pages, smart links and the website — no surface stores its own copy.';

-- Smart-link pages (/c/[userCode]) render from the conversion config and have
-- no block model to carry a display flag, so theirs lives here. Defaults on:
-- a business that has uploaded a logo means to be seen wearing it.
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS show_logo_on_smart_links BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN business_profiles.show_logo_on_smart_links IS
  'Whether public smart-link pages display the business logo.';

-- =============================================
-- 2. RESCUE THE LOGOS THAT ARE ALREADY OUT THERE
-- =============================================
-- Anyone who used the website wizard has a logo in a header block and nothing
-- on their profile. Once the renderer reads the profile, that logo would simply
-- vanish from their site. Copy it up first.
--
-- One per user, preferring a live page over a draft and a newer page over an
-- older one, since a user may have several pages carrying different logos.

UPDATE business_profiles bp
SET logo_url = candidate.logo_url
FROM (
  SELECT DISTINCT ON (wp.user_id)
    wp.user_id,
    wb.content->>'logo_url' AS logo_url
  FROM website_blocks wb
  JOIN website_pages wp ON wp.id = wb.page_id
  WHERE wb.block_type = 'header'
    AND COALESCE(wb.content->>'logo_url', '') <> ''
  ORDER BY wp.user_id, (wp.status = 'live') DESC, wp.updated_at DESC NULLS LAST
) AS candidate
WHERE bp.user_id = candidate.user_id
  AND COALESCE(bp.logo_url, '') = '';

-- =============================================
-- 3. TURN EXISTING HEADERS INTO FLAGS
-- =============================================
-- A header that was showing a logo keeps showing one; the image now comes from
-- the profile. `logo_url` is deliberately left in the block content: it is no
-- longer read, and leaving it means this migration can be reversed without
-- having lost anything.

UPDATE website_blocks
SET content = jsonb_set(content, '{show_logo}', 'true'::jsonb, true)
WHERE block_type = 'header'
  AND COALESCE(content->>'logo_url', '') <> '';

-- Headers that never had a logo say so explicitly, so the renderer never has to
-- guess what an absent key meant.
UPDATE website_blocks
SET content = jsonb_set(content, '{show_logo}', 'false'::jsonb, true)
WHERE block_type = 'header'
  AND COALESCE(content->>'logo_url', '') = ''
  AND content->>'show_logo' IS NULL;
