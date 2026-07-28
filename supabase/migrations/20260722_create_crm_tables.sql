-- CRM Tables Migration
-- Creates core CRM functionality: contacts, activities, pipeline stages

-- =====================================================
-- 1. CRM Contacts Table
-- =====================================================
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Basic info
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,

  -- Pipeline
  stage TEXT NOT NULL DEFAULT 'lead', -- 'lead', 'client', 'past_client' (vertical-specific)
  tags TEXT[] DEFAULT '{}',

  -- Custom fields (vertical-specific JSONB)
  -- Example for therapist: { "insurance_provider": "Blue Cross", "session_type": "Individual", "diagnosis": "...", "referral_source": "..." }
  -- Example for coach: { "coaching_focus": "Business", "package": "6-month", "payment_plan": "Monthly" }
  custom_fields JSONB DEFAULT '{}',

  -- Metadata
  source TEXT, -- 'website_form', 'manual', 'import', 'booking', 'campaign'

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_crm_contacts_user_id ON crm_contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON crm_contacts(stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_tags ON crm_contacts USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_created_at ON crm_contacts(created_at DESC);

-- RLS Policies
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own contacts" ON crm_contacts;
CREATE POLICY "Users can view their own contacts"
  ON crm_contacts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own contacts" ON crm_contacts;
CREATE POLICY "Users can insert their own contacts"
  ON crm_contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own contacts" ON crm_contacts;
CREATE POLICY "Users can update their own contacts"
  ON crm_contacts FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own contacts" ON crm_contacts;
CREATE POLICY "Users can delete their own contacts"
  ON crm_contacts FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. CRM Activities Table
-- =====================================================
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,

  activity_type TEXT NOT NULL, -- 'note', 'email', 'call', 'meeting', 'booking', 'payment'
  title TEXT NOT NULL,
  description TEXT,

  -- Auto-logged metadata (for activities created by other capabilities)
  auto_logged BOOLEAN DEFAULT false,
  source_capability TEXT, -- 'scheduling', 'payments', 'email', 'campaigns', 'manual'
  source_entity_id UUID, -- Link to appointment, payment, email, etc.

  activity_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_activities_user_id ON crm_activities(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_contact_id ON crm_activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_crm_activities_type ON crm_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_crm_activities_date ON crm_activities(activity_date DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_source ON crm_activities(source_capability);

-- RLS Policies
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own activities" ON crm_activities;
CREATE POLICY "Users can view their own activities"
  ON crm_activities FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own activities" ON crm_activities;
CREATE POLICY "Users can insert their own activities"
  ON crm_activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own activities" ON crm_activities;
CREATE POLICY "Users can update their own activities"
  ON crm_activities FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own activities" ON crm_activities;
CREATE POLICY "Users can delete their own activities"
  ON crm_activities FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 3. CRM Pipeline Stages Table
-- =====================================================
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  vertical TEXT NOT NULL, -- 'therapist', 'coach', 'consultant', etc.
  stage_key TEXT NOT NULL, -- 'lead', 'client', 'past_client'
  stage_label TEXT NOT NULL, -- Display name (can be customized)
  position INT NOT NULL, -- Order in pipeline (0, 1, 2, ...)
  color TEXT, -- Hex color for UI

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, stage_key)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_user_id ON crm_pipeline_stages(user_id);
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_vertical ON crm_pipeline_stages(vertical);

-- RLS Policies
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own pipeline stages" ON crm_pipeline_stages;
CREATE POLICY "Users can view their own pipeline stages"
  ON crm_pipeline_stages FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own pipeline stages" ON crm_pipeline_stages;
CREATE POLICY "Users can insert their own pipeline stages"
  ON crm_pipeline_stages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own pipeline stages" ON crm_pipeline_stages;
CREATE POLICY "Users can update their own pipeline stages"
  ON crm_pipeline_stages FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own pipeline stages" ON crm_pipeline_stages;
CREATE POLICY "Users can delete their own pipeline stages"
  ON crm_pipeline_stages FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. Seed Default Pipeline Stages by Vertical
-- =====================================================

-- Note: This will be populated when user completes onboarding
-- Default stages for therapist vertical (example)
-- INSERT INTO crm_pipeline_stages (user_id, vertical, stage_key, stage_label, position, color) VALUES
--   (user_id, 'therapist', 'inquiry', 'Inquiry', 0, '#94A3B8'),
--   (user_id, 'therapist', 'intake', 'Intake', 1, '#60A5FA'),
--   (user_id, 'therapist', 'active_client', 'Active Client', 2, '#34D399'),
--   (user_id, 'therapist', 'completed', 'Completed', 3, '#A78BFA'),
--   (user_id, 'therapist', 'inactive', 'Inactive', 4, '#F87171');

-- =====================================================
-- 5. Updated_at Trigger for Contacts
-- =====================================================
CREATE OR REPLACE FUNCTION update_crm_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_crm_contacts_updated_at_trigger ON crm_contacts;
CREATE TRIGGER update_crm_contacts_updated_at_trigger
  BEFORE UPDATE ON crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_contacts_updated_at();
