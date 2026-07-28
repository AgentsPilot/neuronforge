-- Business Profiles Table
-- Purpose: Store comprehensive business profile data extracted from user bio during onboarding
-- Last Updated: 2026-07-21

CREATE TABLE IF NOT EXISTS business_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL,

  -- Vertical identification
  vertical TEXT NOT NULL, -- therapist, lawyer, coach, consultant, course_creator, etc.
  sub_vertical TEXT, -- e.g., 'life_coach', 'business_coach', 'family_therapist'

  -- Business metrics
  company_name TEXT,
  company_size TEXT, -- 'solo', '2-5', '6-10', '11-50', '50+'
  clients_per_week INT,
  revenue_tier TEXT, -- 'startup', 'growing', 'established'

  -- Online presence
  website_url TEXT,
  landing_pages TEXT[] DEFAULT '{}',
  website_analysis JSONB, -- Scraped website data and AI analysis

  -- Connected tools (for capability recommendations)
  connected_plugins TEXT[] DEFAULT '{}',
  primary_crm TEXT,
  primary_calendar TEXT,
  primary_payment TEXT,

  -- Onboarding state
  onboarding_completed BOOLEAN DEFAULT false,
  onboarding_conversation JSONB, -- Full conversation history from chat
  profile_completeness INT DEFAULT 0, -- 0-100 percentage

  -- Language preference
  language TEXT DEFAULT 'en', -- 'en', 'es', 'he'

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Row-Level Security
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own profile
CREATE POLICY "Users can view own profile"
  ON business_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON business_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON business_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Indexes for performance
CREATE INDEX idx_business_profiles_user_id ON business_profiles(user_id);
CREATE INDEX idx_business_profiles_vertical ON business_profiles(vertical);
CREATE INDEX idx_business_profiles_onboarding_completed ON business_profiles(onboarding_completed);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_business_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_business_profiles_timestamp
  BEFORE UPDATE ON business_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_business_profiles_updated_at();

-- Comments for documentation
COMMENT ON TABLE business_profiles IS 'Comprehensive business profile data extracted from user bio during onboarding';
COMMENT ON COLUMN business_profiles.vertical IS 'Primary business vertical (therapist, coach, consultant, etc.)';
COMMENT ON COLUMN business_profiles.website_analysis IS 'AI-extracted data from user website (services, target audience, brand voice)';
COMMENT ON COLUMN business_profiles.onboarding_conversation IS 'Full chat conversation history from onboarding';
COMMENT ON COLUMN business_profiles.profile_completeness IS 'Percentage (0-100) indicating how complete the profile is';
