-- =====================================================
-- Migrate CRM contacts to use dynamic pipeline stages
-- Maps old hardcoded stage values to new stage_key values
-- =====================================================

-- First, ensure the crm_pipeline_stages table exists
-- (should already exist from previous migration)

-- Map old stage values to new stage_key values for therapist vertical
-- Old: lead -> inquiry (first stage)
-- Old: client -> active_client
-- Old: past_client -> inactive (last stage)

-- For users who have pipeline stages configured, update contacts
-- to use valid stage_key values from their configured stages

-- Step 1: Update contacts with 'lead' stage to first stage in user's pipeline
UPDATE crm_contacts c
SET stage = (
  SELECT stage_key
  FROM crm_pipeline_stages ps
  WHERE ps.user_id = c.user_id
  ORDER BY position ASC
  LIMIT 1
)
WHERE c.stage = 'lead'
AND EXISTS (
  SELECT 1 FROM crm_pipeline_stages ps WHERE ps.user_id = c.user_id
);

-- Step 2: Update contacts with 'client' stage to middle/active stage
-- Look for 'active_client' or 'active' or any stage with 'active' in the key
UPDATE crm_contacts c
SET stage = COALESCE(
  (
    SELECT stage_key
    FROM crm_pipeline_stages ps
    WHERE ps.user_id = c.user_id
    AND (stage_key = 'active_client' OR stage_key = 'active')
    LIMIT 1
  ),
  (
    SELECT stage_key
    FROM crm_pipeline_stages ps
    WHERE ps.user_id = c.user_id
    AND stage_key LIKE '%active%'
    LIMIT 1
  ),
  (
    -- Fallback: use middle stage by position
    SELECT stage_key
    FROM crm_pipeline_stages ps
    WHERE ps.user_id = c.user_id
    ORDER BY position ASC
    OFFSET (SELECT COUNT(*) / 2 FROM crm_pipeline_stages ps2 WHERE ps2.user_id = c.user_id)
    LIMIT 1
  )
)
WHERE c.stage = 'client'
AND EXISTS (
  SELECT 1 FROM crm_pipeline_stages ps WHERE ps.user_id = c.user_id
);

-- Step 3: Update contacts with 'past_client' stage to last stage in user's pipeline
UPDATE crm_contacts c
SET stage = (
  SELECT stage_key
  FROM crm_pipeline_stages ps
  WHERE ps.user_id = c.user_id
  ORDER BY position DESC
  LIMIT 1
)
WHERE c.stage = 'past_client'
AND EXISTS (
  SELECT 1 FROM crm_pipeline_stages ps WHERE ps.user_id = c.user_id
);

-- Step 4: For any contacts with stages that don't exist in their user's pipeline,
-- move them to the first stage (safe fallback)
UPDATE crm_contacts c
SET stage = (
  SELECT stage_key
  FROM crm_pipeline_stages ps
  WHERE ps.user_id = c.user_id
  ORDER BY position ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM crm_pipeline_stages ps WHERE ps.user_id = c.user_id
)
AND NOT EXISTS (
  SELECT 1 FROM crm_pipeline_stages ps
  WHERE ps.user_id = c.user_id AND ps.stage_key = c.stage
);

-- Add a comment explaining the stage column
COMMENT ON COLUMN crm_contacts.stage IS 'References stage_key from crm_pipeline_stages table. Configured by Business Architect during onboarding.';

-- Create an index for faster lookups by stage
CREATE INDEX IF NOT EXISTS idx_crm_contacts_stage ON crm_contacts(stage);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_user_stage ON crm_contacts(user_id, stage);
