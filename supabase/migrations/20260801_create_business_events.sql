-- Business Events Table
-- Unified event log for all business activities across the AI Business OS
-- Used by the Insight System to detect patterns, generate insights, and trigger automations

CREATE TABLE IF NOT EXISTS business_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Event classification
  event_type TEXT NOT NULL,
  category TEXT NOT NULL, -- acquisition, conversion, sales, cash_flow, retention, operations, pricing

  -- Entity reference
  entity_type TEXT NOT NULL, -- contact, booking, invoice, service, page, session, proposal
  entity_id UUID NOT NULL,

  -- Optional relationships
  contact_id UUID REFERENCES crm_contacts(id) ON DELETE SET NULL,
  session_id TEXT, -- For web session tracking

  -- Value tracking
  value_usd DECIMAL(10, 2),
  value_delta DECIMAL(10, 2), -- Change from previous value

  -- Flexible metadata
  metadata JSONB DEFAULT '{}',

  -- Source tracking
  source_capability TEXT NOT NULL, -- scheduling, payments, crm, website, email, kernel

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Performance indexes for time-series queries
CREATE INDEX idx_business_events_user_time ON business_events(user_id, created_at DESC);
CREATE INDEX idx_business_events_category ON business_events(user_id, category, created_at DESC);
CREATE INDEX idx_business_events_type ON business_events(user_id, event_type, created_at DESC);
CREATE INDEX idx_business_events_contact ON business_events(contact_id, created_at DESC);
CREATE INDEX idx_business_events_entity ON business_events(entity_type, entity_id);

-- RLS policies
ALTER TABLE business_events ENABLE ROW LEVEL SECURITY;

-- Users can only read their own events
CREATE POLICY "Users can view own business events"
  ON business_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own events
CREATE POLICY "Users can insert own business events"
  ON business_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role can do everything (for triggers and cron jobs)
CREATE POLICY "Service role has full access to business events"
  ON business_events
  FOR ALL
  USING (auth.role() = 'service_role');

-- Add comments for documentation
COMMENT ON TABLE business_events IS 'Unified event log for Business OS insight system. Captures all business activities for pattern detection and automation.';
COMMENT ON COLUMN business_events.category IS 'Business vector: acquisition, conversion, sales, cash_flow, retention, operations, pricing';
COMMENT ON COLUMN business_events.source_capability IS 'Which capability emitted this event: scheduling, payments, crm, website, email, kernel';
