-- Create audit_trail table for enterprise-grade audit logging
-- Supports SOC2, GDPR, HIPAA, ISO27001, CCPA compliance

CREATE TABLE IF NOT EXISTS public.audit_trail (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User identification
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_id UUID, -- For delegated actions (e.g., admin acting on behalf of user)

  -- Event details
  action TEXT NOT NULL, -- e.g., 'AGENT_CREATED', 'SETTINGS_PROFILE_UPDATED'
  entity_type TEXT NOT NULL, -- e.g., 'agent', 'user', 'plugin', 'settings'
  entity_id TEXT, -- The ID of the affected resource
  resource_name TEXT, -- Human-readable name of the resource

  -- Change tracking
  changes JSONB, -- Before/after snapshots of changed fields
  details JSONB, -- Additional context (reason, metadata, etc.)

  -- Request context
  ip_address TEXT,
  user_agent TEXT,
  session_id TEXT,

  -- Classification
  severity TEXT CHECK (severity IN ('info', 'warning', 'critical')) DEFAULT 'info',
  compliance_flags TEXT[], -- e.g., ['GDPR', 'SOC2', 'HIPAA']

  -- Tamper detection (optional)
  hash TEXT, -- Cryptographic hash for immutability verification

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audit_trail_user_id ON public.audit_trail(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON public.audit_trail(action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_entity_type ON public.audit_trail(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_trail_entity_id ON public.audit_trail(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_severity ON public.audit_trail(severity);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created_at ON public.audit_trail(created_at DESC);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_trail_user_created ON public.audit_trail(user_id, created_at DESC);

-- GIN index for JSONB searching
CREATE INDEX IF NOT EXISTS idx_audit_trail_changes ON public.audit_trail USING GIN(changes);
CREATE INDEX IF NOT EXISTS idx_audit_trail_details ON public.audit_trail USING GIN(details);

-- GIN index for array searching (compliance flags)
CREATE INDEX IF NOT EXISTS idx_audit_trail_compliance ON public.audit_trail USING GIN(compliance_flags);

-- Enable Row Level Security (RLS)
ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only view their own audit logs
CREATE POLICY "Users can view their own audit logs"
  ON public.audit_trail
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can do everything (for backend operations)
CREATE POLICY "Service role has full access"
  ON public.audit_trail
  FOR ALL
  USING (auth.role() = 'service_role');

-- RLS Policy: Admins can view all audit logs
CREATE POLICY "Admins can view all audit logs"
  ON public.audit_trail
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE auth.users.id = auth.uid()
      AND auth.users.raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Grant permissions
GRANT SELECT ON public.audit_trail TO authenticated;
GRANT ALL ON public.audit_trail TO service_role;

-- Comment on table
COMMENT ON TABLE public.audit_trail IS 'Enterprise audit trail for compliance (SOC2, GDPR, HIPAA, ISO27001, CCPA)';

-- Comment on columns
COMMENT ON COLUMN public.audit_trail.user_id IS 'User who performed the action (nullable for system actions)';
COMMENT ON COLUMN public.audit_trail.actor_id IS 'For delegated actions (e.g., admin acting on behalf of user)';
COMMENT ON COLUMN public.audit_trail.action IS 'Type of action performed (e.g., AGENT_CREATED, SETTINGS_PROFILE_UPDATED)';
COMMENT ON COLUMN public.audit_trail.entity_type IS 'Type of resource affected (e.g., agent, user, plugin, settings)';
COMMENT ON COLUMN public.audit_trail.entity_id IS 'ID of the specific resource affected';
COMMENT ON COLUMN public.audit_trail.resource_name IS 'Human-readable name of the resource';
COMMENT ON COLUMN public.audit_trail.changes IS 'Before/after snapshots of changed fields (JSONB)';
COMMENT ON COLUMN public.audit_trail.details IS 'Additional context like reason, metadata, etc. (JSONB)';
COMMENT ON COLUMN public.audit_trail.ip_address IS 'IP address of the request';
COMMENT ON COLUMN public.audit_trail.user_agent IS 'User agent string from the request';
COMMENT ON COLUMN public.audit_trail.session_id IS 'Session identifier for the request';
COMMENT ON COLUMN public.audit_trail.severity IS 'Severity level: info, warning, or critical';
COMMENT ON COLUMN public.audit_trail.compliance_flags IS 'Array of compliance frameworks (e.g., GDPR, SOC2)';
COMMENT ON COLUMN public.audit_trail.hash IS 'Cryptographic hash for tamper detection (optional)';
