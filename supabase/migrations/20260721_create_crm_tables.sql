-- CRM Tables
-- Purpose: Contact database, pipeline management, and activity tracking
-- Last Updated: 2026-07-21

-- =============================================
-- CRM CONTACTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Basic info
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,

  -- Pipeline
  stage TEXT NOT NULL DEFAULT 'lead', -- 'lead', 'client', 'past_client' (vertical-specific)
  tags TEXT[] DEFAULT '{}',

  -- Custom fields (vertical-specific - stored as JSONB for flexibility)
  custom_fields JSONB DEFAULT '{}',

  -- Metadata
  source TEXT, -- 'website_form', 'manual', 'import', 'booking', 'campaign'
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- CRM ACTIVITIES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE CASCADE NOT NULL,

  -- Activity type
  activity_type TEXT NOT NULL, -- 'note', 'email', 'call', 'meeting', 'booking', 'payment'
  title TEXT NOT NULL,
  description TEXT,

  -- Auto-logged metadata
  auto_logged BOOLEAN DEFAULT false,
  source_capability TEXT, -- 'scheduling', 'payments', 'email', 'manual', 'ai_employee'
  source_entity_id UUID, -- Link to appointment, payment, email, etc.

  -- Timing
  activity_date TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- =============================================
-- CRM PIPELINE STAGES TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL,

  -- Stage configuration
  vertical TEXT NOT NULL,
  stage_key TEXT NOT NULL, -- 'lead', 'prospect', 'client', etc.
  stage_label TEXT NOT NULL, -- Display label
  position INT NOT NULL, -- Order in pipeline (0, 1, 2, ...)
  color TEXT, -- Hex color for UI

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Constraints
  UNIQUE(user_id, stage_key)
);

-- =============================================
-- ROW-LEVEL SECURITY
-- =============================================
ALTER TABLE crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- Policies for crm_contacts
CREATE POLICY "Users can view own contacts"
  ON crm_contacts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own contacts"
  ON crm_contacts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own contacts"
  ON crm_contacts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own contacts"
  ON crm_contacts FOR DELETE
  USING (auth.uid() = user_id);

-- Policies for crm_activities
CREATE POLICY "Users can view own activities"
  ON crm_activities FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own activities"
  ON crm_activities FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own activities"
  ON crm_activities FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own activities"
  ON crm_activities FOR DELETE
  USING (auth.uid() = user_id);

-- Policies for crm_pipeline_stages
CREATE POLICY "Users can view own pipeline stages"
  ON crm_pipeline_stages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own pipeline stages"
  ON crm_pipeline_stages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pipeline stages"
  ON crm_pipeline_stages FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own pipeline stages"
  ON crm_pipeline_stages FOR DELETE
  USING (auth.uid() = user_id);

-- =============================================
-- INDEXES
-- =============================================
CREATE INDEX idx_crm_contacts_user_id ON crm_contacts(user_id);
CREATE INDEX idx_crm_contacts_email ON crm_contacts(user_id, email);
CREATE INDEX idx_crm_contacts_stage ON crm_contacts(user_id, stage);
CREATE INDEX idx_crm_contacts_tags ON crm_contacts USING GIN(tags);
CREATE INDEX idx_crm_contacts_created_at ON crm_contacts(created_at);

CREATE INDEX idx_crm_activities_user_id ON crm_activities(user_id);
CREATE INDEX idx_crm_activities_contact_id ON crm_activities(contact_id);
CREATE INDEX idx_crm_activities_type ON crm_activities(activity_type);
CREATE INDEX idx_crm_activities_date ON crm_activities(activity_date);
CREATE INDEX idx_crm_activities_auto_logged ON crm_activities(auto_logged);

CREATE INDEX idx_crm_pipeline_stages_user_id ON crm_pipeline_stages(user_id);
CREATE INDEX idx_crm_pipeline_stages_vertical ON crm_pipeline_stages(vertical);
CREATE INDEX idx_crm_pipeline_stages_position ON crm_pipeline_stages(user_id, position);

-- =============================================
-- TRIGGERS
-- =============================================
CREATE OR REPLACE FUNCTION update_crm_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_crm_contacts_timestamp
  BEFORE UPDATE ON crm_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_crm_contacts_updated_at();

-- =============================================
-- COMMENTS
-- =============================================
COMMENT ON TABLE crm_contacts IS 'Contact database with pipeline stages and custom fields';
COMMENT ON TABLE crm_activities IS 'Activity log for contacts (notes, emails, calls, auto-logged events)';
COMMENT ON TABLE crm_pipeline_stages IS 'User-configured pipeline stages by vertical';

COMMENT ON COLUMN crm_contacts.stage IS 'Current pipeline stage (lead, client, past_client, etc.)';
COMMENT ON COLUMN crm_contacts.custom_fields IS 'Vertical-specific custom fields (insurance, diagnosis, etc.)';
COMMENT ON COLUMN crm_contacts.source IS 'How this contact was created (website_form, manual, booking, etc.)';

COMMENT ON COLUMN crm_activities.auto_logged IS 'Was this activity automatically logged by a capability?';
COMMENT ON COLUMN crm_activities.source_capability IS 'Which capability created this activity (scheduling, payments, etc.)';
COMMENT ON COLUMN crm_activities.source_entity_id IS 'Reference to the source entity (appointment_id, payment_id, etc.)';

-- =============================================
-- DEFAULT PIPELINE STAGES (SEED DATA)
-- =============================================
-- Note: These will be inserted via a separate seed migration or during onboarding
-- based on the user's vertical

-- Example therapist pipeline:
-- lead → intake → active_client → completed → inactive

-- Example coach pipeline:
-- lead → discovery_call → client → completed → alumni

-- Example consultant pipeline:
-- lead → consultation → retained → active_case → closed
