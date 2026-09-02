-- The business's template: one look, chosen once, worn by everything.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- A template decides colours, fonts and brand voice, and every generated
-- element is built from it — the website's blocks, a landing page's sections, a
-- smart link's styling, the invoice PDF, every transactional email. But it was
-- only ever stored per page (`website_pages.template_id`), so:
--
--   * a landing page created before a website had no template to follow and
--     asked the business to pick a style of its own;
--   * changing the template on the website changed that page and nothing else;
--   * a business with no website at all — one reaching clients by booking link
--     — had no template anywhere, and its emails and invoices fell back to
--     platform colours.
--
-- `business_profiles.theme` already existed and already carried the colours and
-- fonts for exactly this purpose (`lib/email/branding.ts` reads it). What was
-- missing was the identity of the template those values came from, without
-- which nothing can say "this business is on Warm & Welcoming" or offer to
-- change it.
--
-- This adds that. The theme column stays the source of the values; this column
-- is the source of the choice.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS template_id text;

COMMENT ON COLUMN business_profiles.template_id IS
  'The business''s chosen website template. Established by whichever public surface is created first (an onboarding website, or the first landing page) and adopted by every one created after. Changing it restyles every surface. Values are ids from lib/website-builder/templates.ts; the matching colours and fonts live in business_profiles.theme.';

-- Backfill from the homepage for accounts that already have a site.
--
-- Their template was chosen when that page was created, so it is already the
-- business's — this only records where it was.
UPDATE business_profiles bp
SET template_id = wp.template_id
FROM website_pages wp
WHERE wp.user_id = bp.user_id
  AND wp.page_type = 'homepage'
  AND wp.template_id IS NOT NULL
  AND bp.template_id IS NULL;

-- Same for the theme, where it was never written.
--
-- `theme` predates this migration but was only populated by website generation,
-- so an account whose site came from anywhere else has the page theme and a
-- null business theme, and its emails are still in platform colours.
UPDATE business_profiles bp
SET theme = wp.theme
FROM website_pages wp
WHERE wp.user_id = bp.user_id
  AND wp.page_type = 'homepage'
  AND wp.theme IS NOT NULL
  AND bp.theme IS NULL;
