-- Channel insights — give daily metrics a channel dimension
-- Last Updated: 2026-08-27
--
-- WHY THIS EXISTS
--
-- `channel_metrics_daily` was keyed (user_id, platform, account_id, metric_date)
-- because that fit the platforms it was built for: one Facebook Page IS one
-- channel, one Business Profile listing IS one channel.
--
-- Google Analytics breaks that assumption. One GA4 property reports traffic from
-- MANY channels — instagram, google, direct, referral — all on the same day for
-- the same account. Without a channel column every one of those rows collides on
-- the unique key and the last write silently wins.
--
-- WHY GA4 GETS ITS OWN METRIC COLUMNS
--
-- Meta `reach` is people who saw a post ON Instagram. A GA4 session is a visit
-- that arrived AT your website FROM Instagram. Those are different populations
-- of different magnitude, so folding sessions into `reach` — or into
-- `website_clicks`, which on Meta means taps on the link in your profile —
-- would make a channel look dramatically better purely because of which account
-- the user happened to connect.

-- =============================================
-- 1. CHANNEL DIMENSION
-- =============================================

ALTER TABLE channel_metrics_daily
  -- '_account' means "this row is the whole account, and the account is the
  -- channel" — how Meta and Business Profile report.
  --
  -- A sentinel rather than NULL: NULL is never equal to NULL in a unique
  -- constraint, so a nullable column would let the nightly upsert insert a
  -- duplicate row every single night instead of updating.
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT '_account',

  -- Visits, not reach. Kept separate so the two can never be summed by accident.
  ADD COLUMN IF NOT EXISTS sessions BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS visitors BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN channel_metrics_daily.channel IS
  'Acquisition channel, from lib/business-os/channel-insights/channelFromReferrer.ts. ''_account'' means the account itself is the channel (Meta, Business Profile).';
COMMENT ON COLUMN channel_metrics_daily.sessions IS
  'GA4 sessions — visits to a property the business owns. NOT reach: a visit is not an impression.';
COMMENT ON COLUMN channel_metrics_daily.visitors IS
  'GA4 activeUsers — distinct people behind those sessions, as the platform counts them.';

-- =============================================
-- 2. UNIQUE KEY
-- =============================================

ALTER TABLE channel_metrics_daily
  DROP CONSTRAINT IF EXISTS channel_metrics_daily_unique_day;

ALTER TABLE channel_metrics_daily
  ADD CONSTRAINT channel_metrics_daily_unique_day
  UNIQUE (user_id, platform, account_id, metric_date, channel);

-- One taxonomy, enforced by the database. A future writer cannot quietly
-- introduce a second vocabulary — the insert fails instead.
ALTER TABLE channel_metrics_daily
  DROP CONSTRAINT IF EXISTS channel_metrics_daily_channel_check;

ALTER TABLE channel_metrics_daily
  ADD CONSTRAINT channel_metrics_daily_channel_check
  CHECK (channel IN (
    '_account', 'instagram', 'facebook', 'google', 'whatsapp',
    'tiktok', 'linkedin', 'youtube', 'email', 'referral', 'direct'
  ));

CREATE INDEX IF NOT EXISTS idx_channel_metrics_user_channel_date
  ON channel_metrics_daily (user_id, channel, metric_date DESC);

-- =============================================
-- 3. OVERLAP DETECTION
-- =============================================
-- Which hostnames a GA4 property actually measures, recorded by the sync from
-- the report itself. This is how we know whether GA4 is watching the
-- AgentPilot-hosted site (so our own page views would double-count) or an
-- external Wix/Squarespace site (so both sources are additive) — derived
-- server-side, never asked of the user.

ALTER TABLE channel_connections
  ADD COLUMN IF NOT EXISTS measured_hosts TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN channel_connections.measured_hosts IS
  'Hostnames this property reports traffic for. Used to detect overlap with AgentPilot-hosted pages so visits are not counted twice.';
