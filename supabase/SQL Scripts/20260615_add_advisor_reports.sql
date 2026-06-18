-- Migration: Add advisor_reports table for caching AI-generated reports
-- Created: 2026-06-15
-- Purpose: Store AI Advisor reports so users don't need to regenerate on every page visit

-- Create advisor_reports table
CREATE TABLE IF NOT EXISTS advisor_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  org_id UUID REFERENCES organizations ON DELETE CASCADE,

  -- Report content (stored as JSONB for flexibility)
  report_data JSONB NOT NULL,

  -- Metadata
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),

  -- Tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure one report per user (latest wins)
  CONSTRAINT advisor_reports_user_unique UNIQUE (user_id)
);

-- Add RLS policies
ALTER TABLE advisor_reports ENABLE ROW LEVEL SECURITY;

-- Users can only see their own reports
CREATE POLICY "Users can view own advisor reports"
  ON advisor_reports FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own reports
CREATE POLICY "Users can insert own advisor reports"
  ON advisor_reports FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own reports
CREATE POLICY "Users can update own advisor reports"
  ON advisor_reports FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own reports
CREATE POLICY "Users can delete own advisor reports"
  ON advisor_reports FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_advisor_reports_user_id ON advisor_reports(user_id);

-- Index for cleanup of expired reports
CREATE INDEX IF NOT EXISTS idx_advisor_reports_expires_at ON advisor_reports(expires_at);

-- Add comment
COMMENT ON TABLE advisor_reports IS 'Caches AI Advisor reports to avoid regenerating on every page visit. Reports expire after 24 hours.';
