-- Record the user's response to the post-creation calibration prompt.
-- This is distinct from calibration OUTCOME (is_calibrated / last_successful_calibration_id /
-- calibration_history): it captures whether the user, when offered calibration right after
-- agent creation, explicitly accepted or declined — so we can tell a deliberate skip apart
-- from never having been prompted (NULL).

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS calibration_prompt_decision TEXT DEFAULT NULL
  CHECK (calibration_prompt_decision IN ('accepted', 'declined')),
ADD COLUMN IF NOT EXISTS calibration_prompt_decided_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

COMMENT ON COLUMN agents.calibration_prompt_decision IS
  'User response to the post-creation calibration prompt: accepted | declined | NULL (never prompted).';
COMMENT ON COLUMN agents.calibration_prompt_decided_at IS
  'Timestamp when calibration_prompt_decision was set.';
