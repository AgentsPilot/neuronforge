-- The look belongs to the business, not to one web page.
--
-- The theme has always lived on `website_pages.theme`, which made it a website
-- setting. It never was one: the invoice PDF, every transactional email, each
-- landing page and every smart link are drawn from the same colours and fonts.
--
-- The consequence fell on exactly the businesses least able to absorb it. A
-- business reaching clients by booking link has no website page, so it had
-- nowhere to store a look at all — `handleSaveDesign` began with
-- `if (!page) return;`, `resolveEmailBranding` read the homepage and found
-- nothing, and the design step on the readiness chain could never complete.
-- The template chosen during onboarding reached the site and stopped there.
--
-- So the profile holds the business's look, one row per business, and a page
-- may still carry its own `theme` as an override for a landing page that
-- deliberately differs. Everything else reads the profile.

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS theme JSONB;

COMMENT ON COLUMN business_profiles.theme IS
  'The business look — colours and fonts — used by the website, landing pages, smart links, transactional emails and the invoice PDF. Seeded from the template chosen during onboarding and editable on the Design tab. A website_pages.theme overrides it for that page only. NULL means the platform default.';

-- Seeded from whatever the homepage already looks like, so nothing changes
-- appearance on deploy. A business with no page keeps NULL and picks up the
-- platform default until it sets one — which it can now do.
UPDATE business_profiles p
SET theme = w.theme
FROM website_pages w
WHERE w.user_id = p.user_id
  AND p.theme IS NULL
  AND w.theme IS NOT NULL
  AND COALESCE(w.page_type, 'website') <> 'landing';
