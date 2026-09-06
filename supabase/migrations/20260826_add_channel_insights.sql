-- Business OS — channel insights storage
-- Last Updated: 2026-08-26
--
-- WHY THESE TABLES EXIST
--
-- BizQL, the insight detectors and the Business OS chat can only read Postgres
-- tables — the catalog maps logical entities to physical tables and has no
-- concept of a remote source. Fetching from Meta or Google on request would also
-- put a multi-second API call on the reports page, and the platforms restate
-- trailing days as late engagement lands, so a point-in-time read is not even
-- self-consistent with itself.
--
-- So a nightly job pulls the numbers into `channel_metrics_daily`, and everything
-- downstream queries Postgres as it already does.
--
-- WHAT IS STORED, AND WHAT IS NOT
--
-- Only aggregate counts per channel per day: how many people saw the business,
-- engaged, viewed the profile, clicked through. No follower identities, no
-- messages, no demographic breakdowns. Nothing here identifies an individual.
--
-- Ratios (engagement rate, CTR) are deliberately absent. They cannot be summed
-- across days or averaged across channels without being wrong; they are computed
-- after aggregation instead.

-- =============================================
-- 1. CONNECTIONS — the opt-in record and the sync cursor
-- =============================================
-- Connecting a plugin is not the same as consenting to have a business's reach
-- ingested, stored for 90 days and analysed: a user may have connected Meta for
-- an agent workflow. A row here, with insights_enabled = true, is the consent.

CREATE TABLE IF NOT EXISTS channel_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  platform TEXT NOT NULL
    CONSTRAINT channel_connections_platform_check
    CHECK (platform IN ('facebook_page', 'instagram', 'google_business_profile', 'ga4')),

  -- Which plugin connection backs this, so the sync knows what to call.
  plugin_key TEXT NOT NULL,

  -- The account/page/property selected at connect time. Chosen automatically
  -- when the user has exactly one, which is the ordinary case.
  account_id TEXT NOT NULL,
  account_name TEXT,

  -- Page-scoped tokens differ from the user token and are needed for Page
  -- insights. Null where the platform doesn't use them.
  account_token TEXT,

  -- The consent switch. Turning this off stops ingestion without disconnecting
  -- the plugin, which may still be in use by an agent.
  insights_enabled BOOLEAN NOT NULL DEFAULT true,

  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ,
  last_sync_error TEXT,
  -- Null until the first 90-day backfill finishes; lets the UI say "still
  -- fetching your history" rather than showing an empty chart as if it were zero.
  backfill_completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT channel_connections_unique_account UNIQUE (user_id, platform, account_id)
);

-- The cron's selection query: enabled connections that are due a sync.
CREATE INDEX IF NOT EXISTS idx_channel_connections_due
  ON channel_connections (last_synced_at)
  WHERE insights_enabled = true;

CREATE INDEX IF NOT EXISTS idx_channel_connections_user
  ON channel_connections (user_id, platform);

-- =============================================
-- 2. DAILY METRICS
-- =============================================
-- One row per account per day. Metric names are normalized across platforms so
-- a single query can compare Instagram reach with Google Business Profile
-- impressions; `raw` keeps the untouched payload so adding a metric later needs
-- no migration.
--
-- Platform mapping:
--   facebook_page            page_impressions -> impressions,
--                            page_impressions_unique -> reach,
--                            page_post_engagements -> engagements,
--                            page_views_total -> profile_views,
--                            page_website_clicks -> website_clicks
--   instagram                impressions, reach, profile_views, website_clicks (direct)
--   google_business_profile  BUSINESS_IMPRESSIONS_* -> impressions,
--                            CALL_CLICKS -> actions_calls,
--                            BUSINESS_DIRECTION_REQUESTS -> actions_directions,
--                            WEBSITE_CLICKS -> website_clicks
--   ga4                      screenPageViews -> impressions,
--                            activeUsers -> reach,
--                            sessions -> website_clicks

CREATE TABLE IF NOT EXISTS channel_metrics_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  platform TEXT NOT NULL
    CONSTRAINT channel_metrics_daily_platform_check
    CHECK (platform IN ('facebook_page', 'instagram', 'google_business_profile', 'ga4')),

  account_id TEXT NOT NULL,
  metric_date DATE NOT NULL,

  impressions BIGINT NOT NULL DEFAULT 0,
  reach BIGINT NOT NULL DEFAULT 0,
  engagements BIGINT NOT NULL DEFAULT 0,
  profile_views BIGINT NOT NULL DEFAULT 0,
  website_clicks BIGINT NOT NULL DEFAULT 0,
  actions_calls BIGINT NOT NULL DEFAULT 0,
  actions_directions BIGINT NOT NULL DEFAULT 0,

  -- A running total at the time of sync, not a daily figure. Nullable because
  -- some platforms withhold it for small accounts.
  followers_count BIGINT,

  raw JSONB NOT NULL DEFAULT '{}',

  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The nightly job re-fetches a trailing window and upserts on this key, so the
  -- table converges on platform truth without any delete logic.
  CONSTRAINT channel_metrics_daily_unique_day
    UNIQUE (user_id, platform, account_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_channel_metrics_user_date
  ON channel_metrics_daily (user_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_channel_metrics_user_platform_date
  ON channel_metrics_daily (user_id, platform, metric_date DESC);

-- =============================================
-- 3. ROW-LEVEL SECURITY
-- =============================================
-- Mirrors external_calendar_events: a user reaches only their own rows, and the
-- service role is allowed through for the cron, which runs without a user session.

ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own channel connections" ON channel_connections;
CREATE POLICY "Users manage own channel connections"
  ON channel_connections FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages all channel connections" ON channel_connections;
CREATE POLICY "Service role manages all channel connections"
  ON channel_connections FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users read own channel metrics" ON channel_metrics_daily;
CREATE POLICY "Users read own channel metrics"
  ON channel_metrics_daily FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages all channel metrics" ON channel_metrics_daily;
CREATE POLICY "Service role manages all channel metrics"
  ON channel_metrics_daily FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =============================================
-- 4. TRIGGERS
-- =============================================

CREATE OR REPLACE FUNCTION touch_channel_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channel_connections_updated_at ON channel_connections;
CREATE TRIGGER trg_channel_connections_updated_at
  BEFORE UPDATE ON channel_connections
  FOR EACH ROW EXECUTE FUNCTION touch_channel_connections_updated_at();

COMMENT ON TABLE channel_connections IS
  'Which social/listing accounts a user has opted into having analysed. insights_enabled is the consent record; connecting the plugin alone is not consent.';
COMMENT ON TABLE channel_metrics_daily IS
  'Daily reach and engagement per connected channel. Aggregate counts only — nothing here identifies an individual.';
