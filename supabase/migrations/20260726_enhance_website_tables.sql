-- Enhance Website Tables for Full Website Capability
-- Purpose: Add subdomain hosting, custom domains, status, and block enable flags
-- Last Updated: 2026-07-26

-- =============================================
-- ENHANCE WEBSITE_PAGES TABLE
-- =============================================

-- Add subdomain for public hosting (user.agentpilot.io)
ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS subdomain TEXT UNIQUE;

-- Add custom domain support
ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS custom_domain TEXT;

ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS custom_domain_verified BOOLEAN DEFAULT false;

-- Add status for draft/live workflow
ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'archived'));

-- Add last published timestamp
ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS last_published_at TIMESTAMPTZ;

-- Add favicon and social sharing
ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS favicon_url TEXT;

ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS og_image_url TEXT;

-- =============================================
-- ENHANCE WEBSITE_BLOCKS TABLE
-- =============================================

-- Add enabled flag for toggling blocks on/off
ALTER TABLE website_blocks
ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;

-- Add capability integration config
ALTER TABLE website_blocks
ADD COLUMN IF NOT EXISTS capability_config JSONB DEFAULT '{}';

-- =============================================
-- NEW INDEXES
-- =============================================

-- Index for subdomain lookups (public site routing)
CREATE INDEX IF NOT EXISTS idx_website_pages_subdomain ON website_pages(subdomain) WHERE subdomain IS NOT NULL;

-- Index for custom domain lookups
CREATE INDEX IF NOT EXISTS idx_website_pages_custom_domain ON website_pages(custom_domain) WHERE custom_domain IS NOT NULL;

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_website_pages_status ON website_pages(status);

-- Index for enabled blocks
CREATE INDEX IF NOT EXISTS idx_website_blocks_enabled ON website_blocks(page_id, enabled);

-- =============================================
-- PUBLIC ACCESS POLICY FOR LIVE SITES
-- =============================================

-- Allow public read access to live website pages (for subdomain rendering)
CREATE POLICY IF NOT EXISTS "Public can view live pages by subdomain"
  ON website_pages FOR SELECT
  USING (status = 'live' AND subdomain IS NOT NULL);

-- Allow public read access to blocks of live pages
CREATE POLICY IF NOT EXISTS "Public can view blocks of live pages"
  ON website_blocks FOR SELECT
  USING (
    enabled = true AND
    EXISTS (
      SELECT 1 FROM website_pages
      WHERE website_pages.id = website_blocks.page_id
      AND website_pages.status = 'live'
    )
  );

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Function to check subdomain availability
CREATE OR REPLACE FUNCTION check_subdomain_available(subdomain_to_check TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM website_pages WHERE subdomain = subdomain_to_check
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to generate a unique subdomain from business name
CREATE OR REPLACE FUNCTION generate_subdomain(business_name TEXT)
RETURNS TEXT AS $$
DECLARE
  base_subdomain TEXT;
  final_subdomain TEXT;
  counter INT := 0;
BEGIN
  -- Clean and normalize the business name
  base_subdomain := lower(regexp_replace(business_name, '[^a-zA-Z0-9]', '-', 'g'));
  base_subdomain := regexp_replace(base_subdomain, '-+', '-', 'g');
  base_subdomain := trim(both '-' from base_subdomain);
  base_subdomain := substring(base_subdomain from 1 for 30);

  final_subdomain := base_subdomain;

  -- Check availability and append number if needed
  WHILE NOT check_subdomain_available(final_subdomain) LOOP
    counter := counter + 1;
    final_subdomain := base_subdomain || '-' || counter;
  END LOOP;

  RETURN final_subdomain;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON COLUMN website_pages.subdomain IS 'Unique subdomain for public hosting (e.g., mysite.agentpilot.io)';
COMMENT ON COLUMN website_pages.custom_domain IS 'Custom domain pointing to this site (e.g., www.mysite.com)';
COMMENT ON COLUMN website_pages.custom_domain_verified IS 'Whether the custom domain DNS is verified';
COMMENT ON COLUMN website_pages.status IS 'Site status: draft (not public), live (publicly accessible), archived';
COMMENT ON COLUMN website_pages.last_published_at IS 'Timestamp of the last publish action';

COMMENT ON COLUMN website_blocks.enabled IS 'Whether the block is visible on the page';
COMMENT ON COLUMN website_blocks.capability_config IS 'Configuration for capability integration (service_ids, price_id, etc.)';
