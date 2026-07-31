-- Website Page Views Analytics Table
-- Tracks page views for public websites

CREATE TABLE IF NOT EXISTS website_page_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID NOT NULL REFERENCES website_pages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subdomain TEXT NOT NULL,

    -- View metadata
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    referer TEXT,
    ip_hash TEXT, -- Hashed IP for unique visitor counting (privacy-safe)
    country_code TEXT,
    device_type TEXT, -- 'desktop', 'mobile', 'tablet'

    -- Session tracking (optional)
    session_id TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_website_page_views_page_id ON website_page_views(page_id);
CREATE INDEX idx_website_page_views_user_id ON website_page_views(user_id);
CREATE INDEX idx_website_page_views_subdomain ON website_page_views(subdomain);
CREATE INDEX idx_website_page_views_viewed_at ON website_page_views(viewed_at DESC);
CREATE INDEX idx_website_page_views_ip_hash ON website_page_views(ip_hash);

-- Composite index for common queries
CREATE INDEX idx_website_page_views_subdomain_date ON website_page_views(subdomain, viewed_at DESC);
CREATE INDEX idx_website_page_views_user_date ON website_page_views(user_id, viewed_at DESC);

-- Enable RLS
ALTER TABLE website_page_views ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only view their own website analytics
CREATE POLICY "Users can view own website analytics"
    ON website_page_views
    FOR SELECT
    USING (auth.uid() = user_id);

-- Service role can insert views (for public API tracking)
CREATE POLICY "Service role can insert page views"
    ON website_page_views
    FOR INSERT
    WITH CHECK (true);

-- Aggregated stats view for efficient dashboard queries
CREATE OR REPLACE VIEW website_analytics_summary AS
SELECT
    user_id,
    subdomain,
    COUNT(*) as total_views,
    COUNT(DISTINCT ip_hash) as unique_visitors,
    COUNT(*) FILTER (WHERE viewed_at >= CURRENT_DATE) as views_today,
    COUNT(DISTINCT ip_hash) FILTER (WHERE viewed_at >= CURRENT_DATE) as visitors_today,
    COUNT(*) FILTER (WHERE viewed_at >= DATE_TRUNC('month', CURRENT_DATE)) as views_this_month,
    COUNT(DISTINCT ip_hash) FILTER (WHERE viewed_at >= DATE_TRUNC('month', CURRENT_DATE)) as visitors_this_month,
    COUNT(*) FILTER (WHERE viewed_at >= CURRENT_DATE - INTERVAL '30 days') as views_30d,
    COUNT(DISTINCT ip_hash) FILTER (WHERE viewed_at >= CURRENT_DATE - INTERVAL '30 days') as visitors_30d,
    COUNT(*) FILTER (WHERE viewed_at >= CURRENT_DATE - INTERVAL '7 days') as views_7d,
    COUNT(DISTINCT ip_hash) FILTER (WHERE viewed_at >= CURRENT_DATE - INTERVAL '7 days') as visitors_7d
FROM website_page_views
GROUP BY user_id, subdomain;

-- Grant access to the view
GRANT SELECT ON website_analytics_summary TO authenticated;

COMMENT ON TABLE website_page_views IS 'Tracks page views for public websites';
COMMENT ON VIEW website_analytics_summary IS 'Aggregated website analytics for dashboard display';
