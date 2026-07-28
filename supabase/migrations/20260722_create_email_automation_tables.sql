-- Email Automation Tables Migration
-- Creates email sequence and campaign functionality

-- =====================================================
-- 1. Email Sequences Table
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Sequence details
  name TEXT NOT NULL,
  description TEXT,

  -- Trigger configuration
  trigger_type TEXT NOT NULL, -- 'manual', 'contact_created', 'booking_confirmed', 'payment_received', 'tag_added'
  trigger_config JSONB DEFAULT '{}', -- Additional trigger settings (e.g., {"tag": "ADHD Course"})

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Statistics
  total_sent INT DEFAULT 0,
  total_opened INT DEFAULT 0,
  total_clicked INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_sequences_user_id ON email_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sequences_active ON email_sequences(is_active);
CREATE INDEX IF NOT EXISTS idx_email_sequences_trigger_type ON email_sequences(trigger_type);

-- RLS Policies
ALTER TABLE email_sequences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sequences" ON email_sequences;
CREATE POLICY "Users can view their own sequences"
  ON email_sequences FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own sequences" ON email_sequences;
CREATE POLICY "Users can insert their own sequences"
  ON email_sequences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own sequences" ON email_sequences;
CREATE POLICY "Users can update their own sequences"
  ON email_sequences FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own sequences" ON email_sequences;
CREATE POLICY "Users can delete their own sequences"
  ON email_sequences FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. Email Sequence Steps Table
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Step details
  step_number INT NOT NULL, -- Order in sequence (0, 1, 2, ...)
  delay_minutes INT NOT NULL DEFAULT 0, -- Wait time after previous step (0 for first step)

  -- Email content
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT, -- Plain text version

  -- Statistics
  sent_count INT DEFAULT 0,
  opened_count INT DEFAULT 0,
  clicked_count INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(sequence_id, step_number)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_sequence_steps_sequence_id ON email_sequence_steps(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_steps_user_id ON email_sequence_steps(user_id);

-- RLS Policies
ALTER TABLE email_sequence_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sequence steps" ON email_sequence_steps;
CREATE POLICY "Users can view their own sequence steps"
  ON email_sequence_steps FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own sequence steps" ON email_sequence_steps;
CREATE POLICY "Users can insert their own sequence steps"
  ON email_sequence_steps FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own sequence steps" ON email_sequence_steps;
CREATE POLICY "Users can update their own sequence steps"
  ON email_sequence_steps FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own sequence steps" ON email_sequence_steps;
CREATE POLICY "Users can delete their own sequence steps"
  ON email_sequence_steps FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 3. Email Campaigns Table (Broadcasts)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Campaign details
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT,

  -- Targeting
  segment_filter JSONB DEFAULT '{}', -- Filter for which contacts to send to (e.g., {"tags": ["VIP"], "stage": "client"})

  -- Status
  status TEXT DEFAULT 'draft', -- 'draft', 'scheduled', 'sending', 'sent'
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,

  -- Statistics
  recipients_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  opened_count INT DEFAULT 0,
  clicked_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_campaigns_user_id ON email_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_scheduled_at ON email_campaigns(scheduled_at);

-- RLS Policies
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own campaigns" ON email_campaigns;
CREATE POLICY "Users can view their own campaigns"
  ON email_campaigns FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own campaigns" ON email_campaigns;
CREATE POLICY "Users can insert their own campaigns"
  ON email_campaigns FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own campaigns" ON email_campaigns;
CREATE POLICY "Users can update their own campaigns"
  ON email_campaigns FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own campaigns" ON email_campaigns;
CREATE POLICY "Users can delete their own campaigns"
  ON email_campaigns FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. Email Sends Table (Individual email tracking)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,

  -- Source (sequence or campaign)
  sequence_id UUID REFERENCES email_sequences(id) ON DELETE SET NULL,
  sequence_step_id UUID REFERENCES email_sequence_steps(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,

  -- Email details
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  to_email TEXT NOT NULL,

  -- Delivery status
  status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,

  -- Provider details
  provider TEXT DEFAULT 'sendgrid', -- 'sendgrid', 'resend'
  provider_message_id TEXT,
  error_message TEXT,

  -- Tracking
  open_count INT DEFAULT 0,
  click_count INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_sends_user_id ON email_sends(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_contact_id ON email_sends(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_sequence_id ON email_sends(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_campaign_id ON email_sends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_status ON email_sends(status);
CREATE INDEX IF NOT EXISTS idx_email_sends_provider_message_id ON email_sends(provider_message_id);

-- RLS Policies
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sends" ON email_sends;
CREATE POLICY "Users can view their own sends"
  ON email_sends FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own sends" ON email_sends;
CREATE POLICY "Users can insert their own sends"
  ON email_sends FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own sends" ON email_sends;
CREATE POLICY "Users can update their own sends"
  ON email_sends FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own sends" ON email_sends;
CREATE POLICY "Users can delete their own sends"
  ON email_sends FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 5. Email Unsubscribes Table
-- =====================================================
CREATE TABLE IF NOT EXISTS email_unsubscribes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,

  email TEXT NOT NULL,
  reason TEXT,
  unsubscribed_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, email)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_user_id ON email_unsubscribes(user_id);
CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_email ON email_unsubscribes(email);

-- RLS Policies
ALTER TABLE email_unsubscribes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own unsubscribes" ON email_unsubscribes;
CREATE POLICY "Users can view their own unsubscribes"
  ON email_unsubscribes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own unsubscribes" ON email_unsubscribes;
CREATE POLICY "Users can insert their own unsubscribes"
  ON email_unsubscribes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own unsubscribes" ON email_unsubscribes;
CREATE POLICY "Users can delete their own unsubscribes"
  ON email_unsubscribes FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 6. Sequence Enrollments Table
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sequence_id UUID NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES crm_contacts(id) ON DELETE CASCADE,

  -- Enrollment status
  status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed', 'cancelled'
  current_step_number INT DEFAULT 0,
  next_send_at TIMESTAMPTZ,

  -- Timestamps
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,

  UNIQUE(sequence_id, contact_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_sequence_enrollments_user_id ON email_sequence_enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_enrollments_sequence_id ON email_sequence_enrollments(sequence_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_enrollments_contact_id ON email_sequence_enrollments(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_sequence_enrollments_status ON email_sequence_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_email_sequence_enrollments_next_send ON email_sequence_enrollments(next_send_at);

-- RLS Policies
ALTER TABLE email_sequence_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own enrollments" ON email_sequence_enrollments;
CREATE POLICY "Users can view their own enrollments"
  ON email_sequence_enrollments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own enrollments" ON email_sequence_enrollments;
CREATE POLICY "Users can insert their own enrollments"
  ON email_sequence_enrollments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own enrollments" ON email_sequence_enrollments;
CREATE POLICY "Users can update their own enrollments"
  ON email_sequence_enrollments FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own enrollments" ON email_sequence_enrollments;
CREATE POLICY "Users can delete their own enrollments"
  ON email_sequence_enrollments FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 7. Updated_at Triggers
-- =====================================================
CREATE OR REPLACE FUNCTION update_email_sequences_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_email_sequences_updated_at_trigger ON email_sequences;
CREATE TRIGGER update_email_sequences_updated_at_trigger
  BEFORE UPDATE ON email_sequences
  FOR EACH ROW
  EXECUTE FUNCTION update_email_sequences_updated_at();

CREATE OR REPLACE FUNCTION update_email_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_email_campaigns_updated_at_trigger ON email_campaigns;
CREATE TRIGGER update_email_campaigns_updated_at_trigger
  BEFORE UPDATE ON email_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_email_campaigns_updated_at();

-- =====================================================
-- 8. Trigger: Auto-create CRM activity when email is sent
-- =====================================================
CREATE OR REPLACE FUNCTION log_email_activity()
RETURNS TRIGGER AS $$
DECLARE
  activity_title TEXT;
  activity_desc TEXT;
BEGIN
  -- Only log when email is sent
  IF NEW.status = 'sent' AND (OLD IS NULL OR OLD.status != 'sent') THEN
    activity_title := 'Email Sent: ' || NEW.subject;

    -- Determine description based on source
    IF NEW.sequence_id IS NOT NULL THEN
      activity_desc := 'Automated email from sequence';
    ELSIF NEW.campaign_id IS NOT NULL THEN
      activity_desc := 'Campaign email';
    ELSE
      activity_desc := 'Manual email';
    END IF;

    -- Create activity
    INSERT INTO crm_activities (
      user_id,
      contact_id,
      activity_type,
      title,
      description,
      auto_logged,
      source_capability,
      source_entity_id,
      activity_date
    ) VALUES (
      NEW.user_id,
      NEW.contact_id,
      'email',
      activity_title,
      activity_desc,
      true,
      'email_automation',
      NEW.id,
      NEW.sent_at
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_email_activity_trigger ON email_sends;
CREATE TRIGGER log_email_activity_trigger
  AFTER INSERT OR UPDATE OF status ON email_sends
  FOR EACH ROW
  EXECUTE FUNCTION log_email_activity();
