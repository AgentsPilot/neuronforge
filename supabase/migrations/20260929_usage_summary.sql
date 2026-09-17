-- The credits card, answered in Postgres instead of in Node.
--
-- ---------------------------------------------------------------------------
-- WHAT IT COSTS TODAY
--
-- `AIAnalyticsService.getUsageAnalytics` reads `token_usage` with `select('*')`,
-- pages through every matching row 1,000 at a time, and sums them in
-- JavaScript. Measured on the busiest real account, 30-day window:
--
--     1,991 rows · 1.77 MB · 2 sequential round trips · ~1,190 ms
--
-- to render one number, a ring and five breakdown lines. `select('*')` is 31
-- columns including `request_payload`, `response_metadata` and `metadata` —
-- JSON blobs nothing in the card ever reads, and roughly 890 bytes a row.
--
-- The cost rises with exactly what the card reports: Business OS chat writes a
-- `token_usage` row on every turn. At 3,000 rows it is three sequential pages,
-- at 5,000 it is five.
--
-- WHY NOT JUST NARROW THE SELECT
--
-- It would cut ~95% of the bytes and none of the round trips — PostgREST caps a
-- page at 1,000 rows whatever the width, so the paging loop stays and keeps
-- growing. And PostgREST aggregate functions are disabled on this project
-- (`PGRST123: Use of aggregate functions is not allowed`), so the sum cannot be
-- pushed down from the client either. A function is the only way to return the
-- answer instead of the evidence.
--
-- The paging itself is NOT a mistake and is not being undone: the comment above
-- it records a real account understated by 52% when the query silently
-- truncated at 1,000 rows. That fallback stays in the route for the window
-- between deploying this code and running this migration.
--
-- WHY NOT SECURITY DEFINER
--
-- The only caller is the usage route, which holds the service-role key and
-- bypasses RLS already — so definer rights would buy nothing and would turn
-- `p_user_id` into a parameter that reads any tenant's usage. Invoker rights
-- plus the REVOKE below means an anon or authenticated caller cannot reach it
-- at all, and the route passes the session's own user id, never a body field.
-- ---------------------------------------------------------------------------

-- Both groupings in one round trip. A union rather than two functions because
-- the card needs both every time and two calls would be two trips.
CREATE OR REPLACE FUNCTION business_os_usage_summary(
  p_user_id UUID,
  p_since   TIMESTAMPTZ
)
RETURNS TABLE (
  bucket TEXT,   -- 'feature' or 'day'
  key    TEXT,   -- the feature name, or a YYYY-MM-DD date
  tokens BIGINT,
  calls  BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    'feature'::TEXT,
    -- The same fallback the JavaScript used, so a row written without a feature
    -- keeps landing in the category map's "other" bucket rather than vanishing.
    COALESCE(NULLIF(feature, ''), 'unknown')::TEXT,
    COALESCE(SUM(total_tokens), 0)::BIGINT,
    COUNT(*)::BIGINT
  FROM token_usage
  WHERE user_id = p_user_id
    AND created_at >= p_since
  GROUP BY 2

  UNION ALL

  SELECT
    'day'::TEXT,
    -- UTC, because the route fills the gaps in the series with
    -- `toISOString().slice(0, 10)`. Bucketing in any other zone would produce
    -- dates the chart cannot match and would silently drop a day.
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')::TEXT,
    COALESCE(SUM(total_tokens), 0)::BIGINT,
    COUNT(*)::BIGINT
  FROM token_usage
  WHERE user_id = p_user_id
    AND created_at >= p_since
  GROUP BY 2;
$$;

COMMENT ON FUNCTION business_os_usage_summary(UUID, TIMESTAMPTZ) IS
  'Per-user token_usage totals grouped by feature and by UTC day, for the Business OS credits card. Replaces paging every matching row into Node to sum it there. Service-role only.';

-- Nobody but the server. The route is the only caller and it holds the service
-- role key; a browser must never be able to ask this for an arbitrary user id.
REVOKE ALL ON FUNCTION business_os_usage_summary(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION business_os_usage_summary(UUID, TIMESTAMPTZ) FROM anon, authenticated;

-- The access path both branches of the union take. Without it each call is a
-- scan of the whole table, which is the one way a function could end up slower
-- than the paging it replaces.
CREATE INDEX IF NOT EXISTS idx_token_usage_user_created
  ON token_usage (user_id, created_at DESC);
