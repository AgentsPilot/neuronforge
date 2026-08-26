-- Migration: Add semantic stage_type classification to crm_pipeline_stages
-- This enables reliable client identification across all business verticals

-- 1. Add stage_type column with constraint
ALTER TABLE crm_pipeline_stages
ADD COLUMN IF NOT EXISTS stage_type TEXT NOT NULL DEFAULT 'lead'
CONSTRAINT crm_pipeline_stages_stage_type_check
CHECK (stage_type IN ('lead', 'prospect', 'client', 'past_client', 'lost', 'archived'));

-- 2. Add is_primary_client_stage flag (only one per user)
ALTER TABLE crm_pipeline_stages
ADD COLUMN IF NOT EXISTS is_primary_client_stage BOOLEAN NOT NULL DEFAULT false;

-- 3. Create index for efficient filtering by stage_type
CREATE INDEX IF NOT EXISTS idx_crm_pipeline_stages_stage_type
ON crm_pipeline_stages(user_id, stage_type);

-- 4. Create partial unique index to enforce only one primary client stage per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_pipeline_stages_primary_client
ON crm_pipeline_stages(user_id) WHERE is_primary_client_stage = true;

-- 5. Backfill existing stages based on known stage_key mappings

-- Client stages (active customers across all verticals)
UPDATE crm_pipeline_stages
SET stage_type = 'client'
WHERE stage_key IN (
  'active_client',      -- therapist
  'active',             -- coach, consultant (Active Client/Project)
  'client',             -- default
  'closed_won',         -- sales
  'active_project',     -- consultant
  'active_case',        -- lawyer
  'active_student',     -- tutor/teacher
  'regular_client',     -- wellness
  'regular',            -- beauty
  'member',             -- fitness
  'premium',            -- fitness
  'vip',                -- beauty
  'family_enrolled',    -- parenting_coach
  'in_progress',        -- parenting_coach (active engagement)
  'active_engagement',  -- business_coach
  'retained',           -- lawyer
  'enrolled',           -- teacher
  'customer'            -- default/generic
)
AND stage_type = 'lead'; -- Only update if not already set

-- Past client stages (completed/churned)
UPDATE crm_pipeline_stages
SET stage_type = 'past_client'
WHERE stage_key IN (
  'past_client',
  'completed',
  'closed',
  'churned',
  'inactive',
  'attended'            -- workshop_leader
)
AND stage_type = 'lead';

-- Lost stages (did not convert)
UPDATE crm_pipeline_stages
SET stage_type = 'lost'
WHERE stage_key IN (
  'closed_lost',
  'lost',
  'rejected'
)
AND stage_type = 'lead';

-- Prospect stages (qualified, in conversation)
UPDATE crm_pipeline_stages
SET stage_type = 'prospect'
WHERE stage_key IN (
  'intake',
  'proposal',
  'negotiation',
  'qualified',
  'discovery_call',
  'discovery',
  'consultation',
  'meeting',
  'first_session',
  'trial',
  'assessment',
  'initial_consultation',
  'registered',         -- workshop_leader
  'follow_up'
)
AND stage_type = 'lead';

-- Lead stages (inquiry, contacted) - already default 'lead', but be explicit
UPDATE crm_pipeline_stages
SET stage_type = 'lead'
WHERE stage_key IN (
  'lead',
  'inquiry',
  'contacted',
  'interested',
  'new_lead'
)
AND stage_type = 'lead';

-- 6. Set is_primary_client_stage for each user's first client stage
-- This uses a CTE to find the first client stage per user by position
WITH first_client_stages AS (
  SELECT DISTINCT ON (user_id) id
  FROM crm_pipeline_stages
  WHERE stage_type = 'client'
  ORDER BY user_id, position ASC
)
UPDATE crm_pipeline_stages
SET is_primary_client_stage = true
WHERE id IN (SELECT id FROM first_client_stages);

-- 7. Add comment for documentation
COMMENT ON COLUMN crm_pipeline_stages.stage_type IS
  'Semantic classification: lead, prospect, client, past_client, lost, archived. Used for cross-vertical queries.';

COMMENT ON COLUMN crm_pipeline_stages.is_primary_client_stage IS
  'If true, this is the stage contacts are promoted to after payment. Only one stage per user can be true.';
