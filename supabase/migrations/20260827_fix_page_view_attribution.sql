-- Website analytics — make page views attributable to a channel
-- Last Updated: 2026-08-27
--
-- WHY THIS EXISTS
--
-- Page views could not be attributed to a channel, and the visitor count was
-- measuring the wrong person.
--
-- `app/site/[subdomain]/page.tsx` fetches its own API server-to-server without
-- forwarding the visitor's headers, so the tracking code read the headers of
-- that INTERNAL request: `referer` was always null, `user_agent` was Node's, and
-- the hashed IP was the app server's — one "visitor" for every real person.
--
-- Meanwhile every row that did carry real data came from the owner previewing
-- their own site, so `visitors_30d` on the dashboard was counting the business
-- owner rather than their customers.
--
-- The collector moves to a browser beacon (see POST /api/website/analytics/track).
-- That yields `document.referrer`, which survives cases the Referer header drops,
-- plus the landing URL's UTM parameters — which is what makes a channel knowable.

-- =============================================
-- 1. ATTRIBUTION COLUMNS
-- =============================================
-- The referer header alone cannot carry UTM: it is the PREVIOUS page's URL, not
-- the current one's query string. A tagged smart link therefore loses its
-- campaign unless the landing URL's parameters are captured separately.

ALTER TABLE website_page_views
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  -- Set when the viewer is the page's own owner. Kept rather than discarded so
  -- the owner can still see their preview activity, but excluded from every
  -- visitor metric — previously these were indistinguishable from customers.
  ADD COLUMN IF NOT EXISTS is_owner_view BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN website_page_views.utm_source IS
  'utm_source from the landing URL, captured client-side. Exact where the referer is only a guess.';
COMMENT ON COLUMN website_page_views.is_owner_view IS
  'True when the business owner viewed their own page. Must be excluded from visitor counts.';

-- =============================================
-- 2. INDEXES
-- =============================================
-- Every visitor query is scoped to one user and excludes owner views, so that
-- predicate belongs in the index rather than being filtered afterwards.

CREATE INDEX IF NOT EXISTS idx_page_views_user_viewed_real
  ON website_page_views (user_id, viewed_at DESC)
  WHERE is_owner_view = false;

CREATE INDEX IF NOT EXISTS idx_page_views_user_referer
  ON website_page_views (user_id, referer)
  WHERE referer IS NOT NULL AND is_owner_view = false;

-- =============================================
-- 3. BACKFILL
-- =============================================
-- Existing rows are known to be owner previews: they were written by the
-- preview screen, and every one carries a /business-os/website/preview/ referer.
-- Marking them keeps historical counts honest instead of leaving the dashboard
-- reporting the owner as an audience.

UPDATE website_page_views
SET is_owner_view = true
WHERE referer LIKE '%/business-os/website/preview/%';
