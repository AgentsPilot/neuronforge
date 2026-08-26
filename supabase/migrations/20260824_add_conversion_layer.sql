-- Conversion Layer Migration
-- Purpose: Add smart_links table, source_metadata to contacts, and user_code to business_profiles
-- Last Updated: 2026-08-24

-- =============================================
-- 1. ADD USER_CODE TO BUSINESS_PROFILES
-- =============================================
-- user_code is a short unique identifier for public conversion pages
-- Format: 6 alphanumeric characters (e.g., "abc123")

ALTER TABLE business_profiles
ADD COLUMN IF NOT EXISTS user_code VARCHAR(10) UNIQUE;

-- Function to generate unique user_code
CREATE OR REPLACE FUNCTION generate_user_code(length INT DEFAULT 6)
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
  result TEXT := '';
  i INT;
BEGIN
  FOR i IN 1..length LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function to ensure unique user_code
CREATE OR REPLACE FUNCTION ensure_unique_user_code()
RETURNS TRIGGER AS $$
DECLARE
  new_code TEXT;
  attempts INT := 0;
BEGIN
  -- Only generate if user_code is null
  IF NEW.user_code IS NULL THEN
    LOOP
      new_code := generate_user_code(6);
      -- Check if code already exists
      IF NOT EXISTS (SELECT 1 FROM business_profiles WHERE user_code = new_code) THEN
        NEW.user_code := new_code;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts > 10 THEN
        -- If we've tried 10 times, use a longer code
        new_code := generate_user_code(8);
        IF NOT EXISTS (SELECT 1 FROM business_profiles WHERE user_code = new_code) THEN
          NEW.user_code := new_code;
          EXIT;
        END IF;
      END IF;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'Unable to generate unique user_code after 20 attempts';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate user_code on insert
CREATE TRIGGER ensure_user_code_on_insert
  BEFORE INSERT ON business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION ensure_unique_user_code();

-- Index for user_code lookups (used by conversion pages)
CREATE INDEX IF NOT EXISTS idx_business_profiles_user_code
  ON business_profiles(user_code)
  WHERE user_code IS NOT NULL;

-- Generate user_codes for existing profiles that don't have one
DO $$
DECLARE
  profile_record RECORD;
  new_code TEXT;
  attempts INT;
BEGIN
  FOR profile_record IN
    SELECT id FROM business_profiles WHERE user_code IS NULL
  LOOP
    attempts := 0;
    LOOP
      new_code := (SELECT generate_user_code(6));
      IF NOT EXISTS (SELECT 1 FROM business_profiles WHERE user_code = new_code) THEN
        UPDATE business_profiles SET user_code = new_code WHERE id = profile_record.id;
        EXIT;
      END IF;
      attempts := attempts + 1;
      IF attempts > 10 THEN
        new_code := (SELECT generate_user_code(8));
        IF NOT EXISTS (SELECT 1 FROM business_profiles WHERE user_code = new_code) THEN
          UPDATE business_profiles SET user_code = new_code WHERE id = profile_record.id;
          EXIT;
        END IF;
      END IF;
      IF attempts > 20 THEN
        RAISE WARNING 'Unable to generate user_code for profile %', profile_record.id;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- =============================================
-- 2. ADD SOURCE_METADATA TO CRM_CONTACTS
-- =============================================
-- Stores attribution data: UTM params, referrer, smart link info

ALTER TABLE crm_contacts
ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT '{}';

-- Index for querying by source (e.g., find all contacts from Instagram)
CREATE INDEX IF NOT EXISTS idx_contacts_source_metadata
  ON crm_contacts
  USING gin(source_metadata);

-- Partial index for contacts with UTM source
CREATE INDEX IF NOT EXISTS idx_contacts_utm_source
  ON crm_contacts ((source_metadata->>'utm_source'))
  WHERE source_metadata->>'utm_source' IS NOT NULL;

COMMENT ON COLUMN crm_contacts.source_metadata IS 'Attribution data including UTM params, referrer, smart link info, and capture channel';

-- =============================================
-- 3. CREATE SMART_LINKS TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS smart_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Link identification
  code VARCHAR(10) UNIQUE NOT NULL,  -- Short code for URL (e.g., "abc123")
  name VARCHAR(255),                  -- User-friendly name (e.g., "Instagram Bio Link")

  -- Destination
  destination_url TEXT NOT NULL,      -- Where the link redirects to
  destination_type VARCHAR(50),       -- 'booking', 'form', 'payment', 'landing', 'website'

  -- Attribution (auto-added to destination URL as UTM params)
  source VARCHAR(100),                -- utm_source (e.g., 'instagram', 'facebook')
  medium VARCHAR(100),                -- utm_medium (e.g., 'social', 'email', 'bio')
  campaign VARCHAR(100),              -- utm_campaign (e.g., 'summer-sale-2026')
  content VARCHAR(100),               -- utm_content (e.g., 'bio-link')

  -- Analytics (updated via triggers or cron)
  click_count INTEGER DEFAULT 0,
  conversion_count INTEGER DEFAULT 0,
  revenue_cents INTEGER DEFAULT 0,    -- Total revenue attributed to this link (in cents)

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE smart_links ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own smart_links"
  ON smart_links FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own smart_links"
  ON smart_links FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own smart_links"
  ON smart_links FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own smart_links"
  ON smart_links FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_smart_links_user_id ON smart_links(user_id);
CREATE INDEX idx_smart_links_code ON smart_links(code);
CREATE INDEX idx_smart_links_active ON smart_links(user_id, is_active) WHERE is_active = true;

-- Updated_at trigger
CREATE TRIGGER update_smart_links_timestamp
  BEFORE UPDATE ON smart_links
  FOR EACH ROW
  EXECUTE FUNCTION update_website_pages_updated_at();

-- =============================================
-- 4. CREATE SMART_LINK_CLICKS TABLE
-- =============================================
-- Tracks individual clicks for analytics

CREATE TABLE IF NOT EXISTS smart_link_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  smart_link_id UUID NOT NULL REFERENCES smart_links(id) ON DELETE CASCADE,

  -- Click metadata
  clicked_at TIMESTAMPTZ DEFAULT now(),
  ip_hash VARCHAR(64),          -- Hashed IP for unique visitor counting
  user_agent TEXT,
  referer TEXT,                 -- Where the click came from

  -- Parsed info (for analytics)
  device_type VARCHAR(20),      -- 'desktop', 'mobile', 'tablet'
  country_code VARCHAR(2),      -- ISO country code

  -- Conversion tracking
  session_id UUID,              -- Links click to conversion if they complete
  converted BOOLEAN DEFAULT false,
  conversion_type VARCHAR(50),  -- 'booking', 'form', 'payment'
  converted_at TIMESTAMPTZ
);

-- Enable RLS (inherits from smart_links via JOIN)
ALTER TABLE smart_link_clicks ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only see clicks for their own links
CREATE POLICY "Users can view clicks for own smart_links"
  ON smart_link_clicks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM smart_links
      WHERE smart_links.id = smart_link_clicks.smart_link_id
      AND smart_links.user_id = auth.uid()
    )
  );

-- Service role can insert (for public redirect endpoint)
CREATE POLICY "Service can insert clicks"
  ON smart_link_clicks FOR INSERT
  WITH CHECK (true);

-- Indexes
CREATE INDEX idx_smart_link_clicks_link_id ON smart_link_clicks(smart_link_id);
CREATE INDEX idx_smart_link_clicks_session ON smart_link_clicks(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_smart_link_clicks_date ON smart_link_clicks(clicked_at);

-- =============================================
-- 5. FUNCTION TO INCREMENT CLICK COUNT
-- =============================================

CREATE OR REPLACE FUNCTION increment_smart_link_click_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE smart_links
  SET click_count = click_count + 1,
      updated_at = now()
  WHERE id = NEW.smart_link_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER increment_click_count_on_insert
  AFTER INSERT ON smart_link_clicks
  FOR EACH ROW
  EXECUTE FUNCTION increment_smart_link_click_count();

-- =============================================
-- 6. COMMENTS
-- =============================================

COMMENT ON TABLE smart_links IS 'Trackable short links for lead capture with attribution';
COMMENT ON TABLE smart_link_clicks IS 'Click tracking for smart links analytics';
COMMENT ON COLUMN business_profiles.user_code IS 'Unique short code for public conversion pages (e.g., /c/abc123/book)';
COMMENT ON COLUMN smart_links.code IS 'Short URL code (e.g., go.agentpilot.io/abc123)';
COMMENT ON COLUMN smart_links.destination_type IS 'Type of destination: booking, form, payment, landing, website';
COMMENT ON COLUMN smart_link_clicks.session_id IS 'UUID to track conversion from click to completed action';
