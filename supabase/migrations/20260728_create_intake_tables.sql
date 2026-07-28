-- Intake Forms Tables
-- Purpose: Store intake form templates and user settings for collecting client information
-- Last Updated: 2026-07-28

-- ============================================
-- 1. Intake Form Templates (system-level)
-- ============================================
CREATE TABLE IF NOT EXISTS intake_form_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,  -- 'therapist_initial', 'coach_discovery'
  vertical TEXT NOT NULL,             -- 'therapist', 'coach', 'consultant', 'lawyer', 'fitness', 'other'

  -- Multilingual display names
  name_en TEXT NOT NULL,
  name_es TEXT NOT NULL,
  name_he TEXT NOT NULL,

  -- Multilingual descriptions
  description_en TEXT,
  description_es TEXT,
  description_he TEXT,

  -- Field definitions (JSON array of field objects)
  -- Each field: { key, type, label_en, label_es, label_he, required, options?, placeholder_en?, placeholder_es?, placeholder_he? }
  fields JSONB NOT NULL DEFAULT '[]',

  is_default BOOLEAN DEFAULT false,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for filtering by vertical
CREATE INDEX IF NOT EXISTS idx_intake_templates_vertical ON intake_form_templates(vertical);

-- Comments
COMMENT ON TABLE intake_form_templates IS 'Pre-built intake form templates for each business vertical';
COMMENT ON COLUMN intake_form_templates.template_key IS 'Unique key for the template (e.g., therapist_initial)';
COMMENT ON COLUMN intake_form_templates.vertical IS 'Business vertical: therapist, coach, consultant, lawyer, fitness, other';
COMMENT ON COLUMN intake_form_templates.fields IS 'JSON array of field definitions with multilingual labels';


-- ============================================
-- 2. User Intake Settings (per-user configuration)
-- ============================================
CREATE TABLE IF NOT EXISTS user_intake_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,

  -- Selected template
  template_id UUID REFERENCES intake_form_templates(id),

  -- Enable/disable intake forms
  is_enabled BOOLEAN DEFAULT false,

  -- When to collect intake
  collect_during_booking BOOLEAN DEFAULT true,   -- Part of booking flow
  send_after_booking BOOLEAN DEFAULT false,      -- Email link after booking

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for user lookup
CREATE INDEX IF NOT EXISTS idx_user_intake_settings_user_id ON user_intake_settings(user_id);

-- Row-Level Security
ALTER TABLE user_intake_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own intake settings"
  ON user_intake_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own intake settings"
  ON user_intake_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own intake settings"
  ON user_intake_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own intake settings"
  ON user_intake_settings FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_user_intake_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_intake_settings_timestamp
  BEFORE UPDATE ON user_intake_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_intake_settings_updated_at();

-- Comments
COMMENT ON TABLE user_intake_settings IS 'User-specific intake form configuration (global assignment - one template per user)';
COMMENT ON COLUMN user_intake_settings.template_id IS 'Reference to the selected intake template';
COMMENT ON COLUMN user_intake_settings.is_enabled IS 'Whether intake forms are enabled for this user';
COMMENT ON COLUMN user_intake_settings.collect_during_booking IS 'Show intake form during booking flow';
COMMENT ON COLUMN user_intake_settings.send_after_booking IS 'Send intake form link via email after booking';


-- ============================================
-- 3. Add intake columns to scheduling_bookings
-- ============================================
ALTER TABLE scheduling_bookings
ADD COLUMN IF NOT EXISTS intake_responses JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMPTZ DEFAULT NULL;

-- Comments
COMMENT ON COLUMN scheduling_bookings.intake_responses IS 'JSON object with template_id, template_key, and responses';
COMMENT ON COLUMN scheduling_bookings.intake_completed_at IS 'Timestamp when intake form was completed';
