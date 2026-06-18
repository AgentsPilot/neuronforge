-- Migration: Add Organizations and Workflow Groups for Automation Intelligence Platform
-- Date: 2026-06-15
-- Description: Creates organization structure (1 org = 1 user for now, teams-ready),
--              workflow groups for user-defined categorization, and extends agents table.

-- ============================================================================
-- 1. ORGANIZATIONS TABLE
-- ============================================================================
-- Currently 1:1 with users (auto-created on signup), but designed for future teams support.

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by owner
CREATE INDEX IF NOT EXISTS idx_organizations_owner ON organizations(owner_user_id);

-- RLS: Users can only see their own organizations (or orgs they're members of)
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own organizations"
  ON organizations FOR SELECT
  USING (owner_user_id = auth.uid());

CREATE POLICY "Users can create their own organization"
  ON organizations FOR INSERT
  WITH CHECK (owner_user_id = auth.uid());

CREATE POLICY "Users can update their own organization"
  ON organizations FOR UPDATE
  USING (owner_user_id = auth.uid());

-- ============================================================================
-- 2. ORGANIZATION MEMBERS TABLE
-- ============================================================================
-- Currently just the owner, but ready for team members in the future.

CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'analyst', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(org_id, user_id)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_org_members_org ON organization_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);

-- RLS: Users can see memberships for orgs they belong to
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org memberships"
  ON organization_members FOR SELECT
  USING (user_id = auth.uid() OR org_id IN (
    SELECT org_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Org owners can manage members"
  ON organization_members FOR ALL
  USING (org_id IN (
    SELECT id FROM organizations WHERE owner_user_id = auth.uid()
  ));

-- ============================================================================
-- 3. WORKFLOW GROUPS TABLE
-- ============================================================================
-- User-defined groupings for organizing workflows (domain-agnostic).

CREATE TABLE IF NOT EXISTS workflow_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT,                    -- Hex color for UI visualization
  icon TEXT,                     -- Icon identifier (e.g., 'folder', 'star', 'bolt')
  parent_group_id UUID REFERENCES workflow_groups(id) ON DELETE SET NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_workflow_groups_org ON workflow_groups(org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_groups_parent ON workflow_groups(parent_group_id);

-- RLS: Users can see groups for their orgs
ALTER TABLE workflow_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their org groups"
  ON workflow_groups FOR SELECT
  USING (org_id IN (
    SELECT org_id FROM organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their org groups"
  ON workflow_groups FOR ALL
  USING (org_id IN (
    SELECT id FROM organizations WHERE owner_user_id = auth.uid()
  ));

-- ============================================================================
-- 4. AGENT GROUP MEMBERSHIPS TABLE
-- ============================================================================
-- Many-to-many relationship between agents and workflow groups.

CREATE TABLE IF NOT EXISTS agent_group_memberships (
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES workflow_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (agent_id, group_id)
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_agent_groups_agent ON agent_group_memberships(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_groups_group ON agent_group_memberships(group_id);

-- RLS: Users can see memberships for their agents
ALTER TABLE agent_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their agent group memberships"
  ON agent_group_memberships FOR SELECT
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can manage their agent group memberships"
  ON agent_group_memberships FOR ALL
  USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ));

-- ============================================================================
-- 5. EXTEND AGENTS TABLE
-- ============================================================================
-- Add org_id and tags columns to agents table.

-- Add org_id column (nullable for backward compatibility with existing agents)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

-- Add tags array column for flexible categorization
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';

-- Index for org-based queries
CREATE INDEX IF NOT EXISTS idx_agents_org ON agents(org_id);

-- GIN index for tag searches
CREATE INDEX IF NOT EXISTS idx_agents_tags ON agents USING GIN(tags);

-- ============================================================================
-- 6. EXTEND EXECUTION_INSIGHTS TABLE
-- ============================================================================
-- Add organization and action tracking fields to insights.

ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS group_ids UUID[] DEFAULT '{}';
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS custom_labels JSONB DEFAULT '{}';
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS estimated_annual_savings NUMERIC;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS actual_savings NUMERIC;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS savings_confidence TEXT;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS action_taken TEXT;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS action_taken_at TIMESTAMPTZ;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS action_result JSONB;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS priority_score NUMERIC;
ALTER TABLE execution_insights ADD COLUMN IF NOT EXISTS requires_attention BOOLEAN DEFAULT false;

-- Index for org-based insight queries
CREATE INDEX IF NOT EXISTS idx_insights_org ON execution_insights(org_id);
CREATE INDEX IF NOT EXISTS idx_insights_attention ON execution_insights(requires_attention) WHERE requires_attention = true;

-- ============================================================================
-- 7. HELPER FUNCTION: GET OR CREATE USER ORGANIZATION
-- ============================================================================
-- Auto-creates an organization for a user if they don't have one.

CREATE OR REPLACE FUNCTION get_or_create_user_organization(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id UUID;
  v_user_email TEXT;
BEGIN
  -- Check if user already has an organization
  SELECT id INTO v_org_id
  FROM organizations
  WHERE owner_user_id = p_user_id
  LIMIT 1;

  IF v_org_id IS NOT NULL THEN
    RETURN v_org_id;
  END IF;

  -- Get user email for org name
  SELECT email INTO v_user_email
  FROM auth.users
  WHERE id = p_user_id;

  -- Create new organization
  INSERT INTO organizations (name, owner_user_id)
  VALUES (COALESCE(v_user_email, 'My Organization'), p_user_id)
  RETURNING id INTO v_org_id;

  -- Add user as owner member
  INSERT INTO organization_members (org_id, user_id, role)
  VALUES (v_org_id, p_user_id, 'owner');

  RETURN v_org_id;
END;
$$;

-- ============================================================================
-- 8. TRIGGER: AUTO-SET ORG_ID ON NEW AGENTS
-- ============================================================================
-- When a new agent is created without org_id, auto-assign to user's organization.

CREATE OR REPLACE FUNCTION auto_set_agent_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.org_id IS NULL AND NEW.user_id IS NOT NULL THEN
    NEW.org_id := get_or_create_user_organization(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_auto_set_agent_org_id ON agents;
CREATE TRIGGER trigger_auto_set_agent_org_id
  BEFORE INSERT ON agents
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_agent_org_id();

-- ============================================================================
-- 9. BACKFILL EXISTING AGENTS WITH ORG_ID
-- ============================================================================
-- Create organizations for existing users and assign their agents.

DO $$
DECLARE
  r RECORD;
  v_org_id UUID;
BEGIN
  -- For each user with agents that don't have org_id
  FOR r IN
    SELECT DISTINCT user_id
    FROM agents
    WHERE org_id IS NULL AND user_id IS NOT NULL
  LOOP
    -- Get or create organization for this user
    v_org_id := get_or_create_user_organization(r.user_id);

    -- Update all their agents with the org_id
    UPDATE agents
    SET org_id = v_org_id
    WHERE user_id = r.user_id AND org_id IS NULL;
  END LOOP;
END;
$$;

-- ============================================================================
-- DONE
-- ============================================================================
