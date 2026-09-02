-- The web address a business publishes under, stored on the business.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Every public surface a business owns is served from one subdomain —
-- `{subdomain}.agentspilot.com/{slug}` — but it was only ever stored on
-- `website_pages.subdomain`, and only ever read off the HOMEPAGE. So:
--
--   * a business with no website had no address anywhere, and a landing page
--     was created with `subdomain: null`;
--   * publishing that landing page was refused — "This page has no web address
--     yet. Choose a subdomain before publishing it." — while the only field
--     that sets one lives in the website's settings screen, which a business
--     without a website never sees;
--   * an address chosen while publishing a landing page had nowhere to live
--     that a website created afterwards would find, so the website would go on
--     to generate a different one and the business would be split across two.
--
-- The address is a property of the business, like its logo and its theme. This
-- is where it lives. `website_pages.subdomain` stays as the per-page copy the
-- public routes resolve by, and is kept in step with this one.
-- ---------------------------------------------------------------------------

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS subdomain text;

COMMENT ON COLUMN business_profiles.subdomain IS
  'The web address every public surface of this business publishes under, without the domain. Set by whichever surface is published first — a website''s settings or a landing page''s publish step — and inherited by every page created after. Falls back to user_code when never chosen.';

-- Backfill from whatever the business is already publishing under.
--
-- The homepage first, because that is the one chosen deliberately in the
-- website wizard; any other published page otherwise.
UPDATE business_profiles bp
SET subdomain = chosen.subdomain
FROM (
  SELECT DISTINCT ON (user_id)
    user_id,
    subdomain
  FROM website_pages
  WHERE subdomain IS NOT NULL
  ORDER BY user_id, (page_type = 'homepage') DESC, created_at ASC
) AS chosen
WHERE chosen.user_id = bp.user_id
  AND bp.subdomain IS NULL;

-- One business per address.
CREATE UNIQUE INDEX IF NOT EXISTS business_profiles_subdomain_key
  ON business_profiles (subdomain)
  WHERE subdomain IS NOT NULL;
